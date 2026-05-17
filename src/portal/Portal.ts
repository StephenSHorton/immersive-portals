import Maid from "@rbxts/maid";
import Signal from "@rbxts/signal";
import { Players, RunService, Workspace } from "@rbxts/services";

import type { PortalConfig } from "../types";
import { mirrorCFrameForCamera, mirrorCFrameForTeleport, segmentCrossesRect, Y_SPIN } from "../util/mirror";
import { PortalWindow } from "../window/PortalWindow";

/**
 * Resolve the parent for a portal's SurfaceGui. Roblox renders ViewportFrame
 * children only when the SurfaceGui is parented under a PlayerGui — parenting
 * the SurfaceGui directly to the BasePart causes plain Frames to render but
 * leaves ViewportFrame content invisible. So default to LocalPlayer.PlayerGui.
 */
function defaultGuiParent(): Instance {
	const player = Players.LocalPlayer;
	assert(player, "Portal: no LocalPlayer — this library is client-only. Run portals from a client controller / LocalScript.");
	return player.WaitForChild("PlayerGui");
}

let portalCounter = 0;

interface CharacterEntry {
	a: Map<Instance, Instance>;
	b: Map<Instance, Instance>;
}

type PortalSide = "A" | "B";

interface UpdateResult {
	cframe: CFrame;
	focus: CFrame;
}

/**
 * Layer 2 — paired portal teleporter. Owns two `PortalWindow`s mounted to
 * `partA` and `partB`. Each frame, the viewer's camera CFrame is mirrored
 * through each portal plane and the partner window is rendered from that
 * mirrored POV. If a humanoid is attached via `setHumanoid()`, crossing the
 * portal plane teleports the character (and the camera) through.
 *
 * Use `bind()` for standalone single-portal usage. For multiple portals
 * sharing one render loop, let `PortalGroup` call `update()` directly.
 */
export class Portal {
	readonly entered: Signal<(side: PortalSide) => void> = new Signal();
	readonly exited: Signal<(side: PortalSide) => void> = new Signal();
	readonly teleported: Signal<(fromSide: PortalSide, toSide: PortalSide) => void> = new Signal();

	private maid = new Maid();
	private partA: BasePart;
	private partB: BasePart;
	private windowA: PortalWindow;
	private windowB: PortalWindow;
	private config: Required<Pick<PortalConfig, "yawFlip" | "teleportCooldown">>;

	private humanoid?: Humanoid;
	private hrp?: BasePart;
	private lastHrpPosition?: Vector3;
	private teleportTick = 0;
	private inside: Map<PortalSide, boolean> = new Map();

	private world?: Model;
	private worldLookupA?: Map<Instance, Instance>;
	private worldLookupB?: Map<Instance, Instance>;
	private characterLookups = new Map<Model, CharacterEntry>();

	private lastCameraCFrame: CFrame;
	private lastCameraFocus: CFrame;
	private bound = false;
	private readonly bindingId: number;

	constructor(partA: BasePart, partB: BasePart, config: PortalConfig = {}) {
		this.bindingId = ++portalCounter;
		this.partA = partA;
		this.partB = partB;

		const camera = Workspace.CurrentCamera;
		this.lastCameraCFrame = camera ? camera.CFrame : new CFrame();
		this.lastCameraFocus = camera ? camera.Focus : new CFrame();

		this.config = {
			yawFlip: config.yawFlip ?? math.pi,
			teleportCooldown: config.teleportCooldown ?? 0.1,
		};

		const guiContainer = defaultGuiParent();
		this.windowA = PortalWindow.fromPart(
			partA,
			config.surfaceA ?? Enum.NormalId.Front,
			guiContainer,
			config.windowA ?? {},
		);
		this.windowB = PortalWindow.fromPart(
			partB,
			config.surfaceB ?? Enum.NormalId.Front,
			guiContainer,
			config.windowB ?? {},
		);

		this.maid.GiveTask(() => this.windowA.destroy());
		this.maid.GiveTask(() => this.windowB.destroy());
		this.maid.GiveTask(this.entered);
		this.maid.GiveTask(this.exited);
		this.maid.GiveTask(this.teleported);
	}

	getWindowA(): PortalWindow {
		return this.windowA;
	}

	getWindowB(): PortalWindow {
		return this.windowB;
	}

	getPartA(): BasePart {
		return this.partA;
	}

	getPartB(): BasePart {
		return this.partB;
	}

	/**
	 * Attach a humanoid for teleportation. Pass `undefined` to disable
	 * teleportation (rendering still works).
	 */
	setHumanoid(humanoid: Humanoid | undefined): void {
		this.humanoid = humanoid;
		this.hrp = humanoid?.RootPart;
		this.lastHrpPosition = this.hrp?.Position;
	}

	/**
	 * Clone a world model into both viewports. The partner portal part
	 * is excluded from each viewport's clone (so window A doesn't render
	 * its partner sitting in front of it, and vice versa). It's safe to
	 * pass a world model that contains the portal parts themselves —
	 * cloneInto skips ViewportFrames automatically so the windows don't
	 * recurse into themselves.
	 *
	 * Call once. Subsequent calls replace the world.
	 */
	setWorld(world: Model): void {
		this.clearWorld();
		this.world = world;
		const excludeFromA = new Set<Instance>([this.partB]);
		const excludeFromB = new Set<Instance>([this.partA]);
		this.worldLookupA = this.windowA.cloneInto([world], undefined, undefined, undefined, excludeFromA);
		this.worldLookupB = this.windowB.cloneInto([world], undefined, undefined, undefined, excludeFromB);
	}

	/** Clone a character into both viewports and sync each frame. */
	addCharacter(character: Model): void {
		this.removeCharacter(character);
		const humanoid = character.FindFirstChildOfClass("Humanoid");
		const previousDistance = humanoid?.DisplayDistanceType;
		if (humanoid) humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None;

		const wasArchivable = character.Archivable;
		character.Archivable = true;
		const entry: CharacterEntry = {
			a: this.windowA.cloneInto([character]),
			b: this.windowB.cloneInto([character]),
		};
		character.Archivable = wasArchivable;
		if (humanoid && previousDistance !== undefined) humanoid.DisplayDistanceType = previousDistance;

		this.characterLookups.set(character, entry);
	}

	removeCharacter(character: Model): void {
		const entry = this.characterLookups.get(character);
		if (!entry) return;
		entry.a.get(character)?.Destroy();
		entry.b.get(character)?.Destroy();
		this.characterLookups.delete(character);
	}

	/**
	 * Bind this portal's render+teleport loop to RenderStepped. Use for
	 * standalone single-portal usage. For multi-portal scenes, prefer
	 * `PortalGroup` which shares one binding across all portals.
	 */
	bind(): void {
		if (this.bound) return;
		this.bound = true;

		const beforeName = `Portal${this.bindingId}_BeforeInput`;
		const afterName = `Portal${this.bindingId}_AfterCamera`;

		RunService.BindToRenderStep(beforeName, Enum.RenderPriority.Input.Value - 1, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera) return;
			camera.CFrame = this.lastCameraCFrame;
			camera.Focus = this.lastCameraFocus;
		});

		RunService.BindToRenderStep(afterName, Enum.RenderPriority.Camera.Value + 1, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera) return;
			const result = this.update(camera.CFrame, camera.Focus);
			camera.CFrame = result.cframe;
			camera.Focus = result.focus;
		});

		this.maid.GiveTask(() => {
			RunService.UnbindFromRenderStep(beforeName);
			RunService.UnbindFromRenderStep(afterName);
		});
	}

	unbind(): void {
		if (!this.bound) return;
		this.bound = false;
		RunService.UnbindFromRenderStep(`Portal${this.bindingId}_BeforeInput`);
		RunService.UnbindFromRenderStep(`Portal${this.bindingId}_AfterCamera`);
	}

	/**
	 * Run one frame of the portal loop given the viewer's camera CFrame
	 * and focus. Returns the (possibly mirrored) camera CFrame/focus that
	 * the caller should write back to Workspace.CurrentCamera.
	 *
	 * Side effects: may teleport the bound humanoid, syncs cloned
	 * characters, renders both windows.
	 */
	update(camCFrame: CFrame, focusCFrame: CFrame): UpdateResult {
		const surfaceA = this.windowA.getSurfaceCFrame();
		const sizeA = this.windowA.getSurfaceSize();
		const surfaceB = this.windowB.getSurfaceCFrame();
		const sizeB = this.windowB.getSurfaceSize();

		let workingCam = camCFrame;
		let workingFocus = focusCFrame;

		if (this.hrp && this.humanoid && this.lastHrpPosition) {
			const now = os.clock();
			if (now - this.teleportTick > this.config.teleportCooldown) {
				if (segmentCrossesRect(this.lastHrpPosition, this.hrp.Position, surfaceA, sizeA)) {
					[workingCam, workingFocus] = this.performTeleport(workingCam, workingFocus, surfaceA, surfaceB);
					this.teleportTick = now;
					this.teleported.Fire("A", "B");
				} else if (segmentCrossesRect(this.lastHrpPosition, this.hrp.Position, surfaceB, sizeB)) {
					[workingCam, workingFocus] = this.performTeleport(workingCam, workingFocus, surfaceB, surfaceA);
					this.teleportTick = now;
					this.teleported.Fire("B", "A");
				}
			}
			this.lastHrpPosition = this.hrp.Position;
		}

		this.lastCameraCFrame = workingCam;
		this.lastCameraFocus = workingFocus;

		if (segmentCrossesRect(workingFocus.Position, workingCam.Position, surfaceA, sizeA)) {
			workingCam = mirrorCFrameForCamera(workingCam, surfaceA, surfaceB);
			workingFocus = mirrorCFrameForCamera(workingFocus, surfaceA, surfaceB);
			this.markInside("A", true);
		} else {
			this.markInside("A", false);
		}

		if (segmentCrossesRect(workingFocus.Position, workingCam.Position, surfaceB, sizeB)) {
			workingCam = mirrorCFrameForCamera(workingCam, surfaceB, surfaceA);
			workingFocus = mirrorCFrameForCamera(workingFocus, surfaceB, surfaceA);
			this.markInside("B", true);
		} else {
			this.markInside("B", false);
		}

		this.syncCharacters();

		const camThroughA = mirrorCFrameForCamera(workingCam, surfaceA, surfaceB);
		// The surface passed to render() represents the "window" in the virtual world the camera
		// inhabits. Since the camera was mirrored into partner B's space, the window is the partner's
		// surface. No Y_SPIN — both transforms cancel out cleanly when portals share an orientation.
		this.windowA.render(camThroughA, surfaceB, sizeB);

		const camThroughB = mirrorCFrameForCamera(workingCam, surfaceB, surfaceA);
		this.windowB.render(camThroughB, surfaceA, sizeA);

		return { cframe: workingCam, focus: workingFocus };
	}

	destroy(): void {
		this.unbind();
		this.clearWorld();
		for (const [character] of this.characterLookups) this.removeCharacter(character);
		this.maid.DoCleaning();
	}

	private clearWorld(): void {
		if (this.worldLookupA) {
			this.worldLookupA.get(this.world!)?.Destroy();
			this.worldLookupA.clear();
		}
		if (this.worldLookupB) {
			this.worldLookupB.get(this.world!)?.Destroy();
			this.worldLookupB.clear();
		}
		this.worldLookupA = undefined;
		this.worldLookupB = undefined;
		this.world = undefined;
	}

	private performTeleport(
		camCF: CFrame,
		focusCF: CFrame,
		from: CFrame,
		to: CFrame,
	): [CFrame, CFrame] {
		const hrp = this.hrp;
		const humanoid = this.humanoid;
		if (!hrp || !humanoid) return [camCF, focusCF];

		const hrpCF = hrp.CFrame;
		const localVel = hrpCF.VectorToObjectSpace(hrp.AssemblyLinearVelocity);
		const localMoveDir = hrpCF.VectorToObjectSpace(humanoid.MoveDirection);

		const newHRP = mirrorCFrameForTeleport(hrpCF, from, to);
		hrp.CFrame = newHRP;
		hrp.AssemblyLinearVelocity = newHRP.VectorToWorldSpace(localVel);
		humanoid.Move(newHRP.VectorToWorldSpace(localMoveDir));
		this.lastHrpPosition = hrp.Position;

		const newCam = mirrorCFrameForCamera(camCF, from, to);
		const newFocus = mirrorCFrameForCamera(focusCF, from, to);
		return [newCam, newFocus];
	}

	private markInside(side: PortalSide, isInside: boolean): void {
		const previously = this.inside.get(side) ?? false;
		if (previously === isInside) return;
		this.inside.set(side, isInside);
		if (isInside) this.entered.Fire(side);
		else this.exited.Fire(side);
	}

	private syncCharacters(): void {
		for (const [, entry] of this.characterLookups) {
			this.syncLookup(entry.a);
			this.syncLookup(entry.b);
		}
	}

	private syncLookup(lookup: Map<Instance, Instance>): void {
		for (const [real, fake] of lookup) {
			if (real.IsA("BasePart") && fake.IsA("BasePart")) {
				fake.CFrame = real.CFrame;
				fake.LocalTransparencyModifier = real.LocalTransparencyModifier;
			}
		}
	}
}
