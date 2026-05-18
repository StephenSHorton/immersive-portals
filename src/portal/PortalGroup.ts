import Maid from "@rbxts/maid";
import { CollectionService, Lighting, Players, RunService, Workspace } from "@rbxts/services";

import type { PortalConfig, PortalGroupConfig } from "../types";
import { Portal } from "./Portal";

let groupCounter = 0;

interface GroupStats {
	portals: number;
	bound: boolean;
}

/**
 * Layer 3 — orchestrates multiple `Portal`s under a single shared
 * RenderStepped binding. Supports auto-discovery via CollectionService.
 *
 * Authoring contract (auto-discovery mode):
 * - Tag both portal `BasePart`s with the configured tag (default
 *   `"ImmersivePortal"`)
 * - Set a string attribute (default `PortalPair`) to the SAME value on
 *   both halves of a pair
 * - Optionally set an integer attribute (default `PortalFace`) to a
 *   `NormalId` enum value to override the surface face
 */
export class PortalGroup {
	private maid = new Maid();
	private portals = new Set<Portal>();
	private config: Required<PortalGroupConfig>;
	private bound = false;
	private humanoid?: Humanoid;
	private world?: Instance;
	private characters = new Set<Model>();
	private autoDiscoveryActive = false;
	private discoveredByPart = new Map<BasePart, Portal>();
	private discoveredByPairKey = new Map<string, BasePart>();
	private readonly bindingId: number;

	constructor(config: PortalGroupConfig = {}) {
		this.bindingId = ++groupCounter;
		this.config = {
			autoDiscoverTag: config.autoDiscoverTag ?? "ImmersivePortal",
			pairAttribute: config.pairAttribute ?? "PortalPair",
			faceAttribute: config.faceAttribute ?? "PortalFace",
			defaultPortalConfig: config.defaultPortalConfig ?? {},
		};
	}

	/** Manually register a portal. */
	addPortal(portal: Portal): void {
		if (this.portals.has(portal)) return;
		this.portals.add(portal);
		if (this.humanoid) portal.setHumanoid(this.humanoid);
		if (this.world) portal.setWorld(this.world, this.characters);
		// Auto-clone tracked characters into newly-added portals. Without this, a
		// character that registered before the portal was discovered (common when
		// auto-discovery completes after CharacterAdded fires) wouldn't appear in
		// the new portal's viewport.
		for (const character of this.characters) portal.addCharacter(character);
		// Auto-configure skybox per window. Priority:
		//   1. partA/partB has a Sky child (legacy pattern from Shrink/Grow Studio:
		//      window-A renders partB's Sky and vice versa, so each side sees the
		//      sky of the other portal's destination).
		//   2. Otherwise fall back to Lighting:FindFirstChildOfClass("Sky") so the
		//      viewports inherit the game's real sky for free.
		const partASky = portal.getPartA().FindFirstChildOfClass("Sky");
		const partBSky = portal.getPartB().FindFirstChildOfClass("Sky");
		const lightingSky = Lighting.FindFirstChildOfClass("Sky");
		portal.getWindowA().setSkybox(partBSky ?? lightingSky);
		portal.getWindowB().setSkybox(partASky ?? lightingSky);
	}

	removePortal(portal: Portal, destroyPortal = false): void {
		if (!this.portals.delete(portal)) return;
		if (destroyPortal) portal.destroy();
	}

	/** Forwarded to every owned portal. */
	setHumanoid(humanoid: Humanoid | undefined): void {
		this.humanoid = humanoid;
		for (const portal of this.portals) portal.setHumanoid(humanoid);
	}

	/**
	 * Register a character to be cloned into every owned portal's viewport, including
	 * portals that join the group later. The library auto-tracks character lifetime
	 * (drops the registration on Destroying) so consumers don't need to call
	 * `removeCharacter` themselves.
	 */
	addCharacter(character: Model): void {
		if (this.characters.has(character)) return;
		this.characters.add(character);
		for (const portal of this.portals) portal.addCharacter(character);
		this.maid.GiveTask(
			character.Destroying.Connect(() => {
				this.characters.delete(character);
				for (const portal of this.portals) portal.removeCharacter(character);
			}),
		);
	}

	removeCharacter(character: Model): void {
		if (!this.characters.delete(character)) return;
		for (const portal of this.portals) portal.removeCharacter(character);
	}

	/**
	 * Convenience: track every player's character so they all appear in portal
	 * viewports. Wires up Players.PlayerAdded + CharacterAdded with the standard
	 * "wait for body parts + appearance" guard, and also attaches the LOCAL
	 * player's Humanoid for teleport detection.
	 *
	 * Replaces the boilerplate consumers would otherwise write themselves.
	 * Safe to call once at startup; covers already-joined players + future joins.
	 */
	trackAllPlayers(): void {
		const localPlayer = Players.LocalPlayer;
		const bind = (player: Player, character: Model) => {
			character.WaitForChild("Humanoid");
			character.WaitForChild("HumanoidRootPart");
			if (!player.HasAppearanceLoaded()) player.CharacterAppearanceLoaded.Wait();
			if (player === localPlayer) {
				const humanoid = character.WaitForChild("Humanoid") as Humanoid;
				this.setHumanoid(humanoid);
			}
			this.addCharacter(character);
		};
		const track = (player: Player) => {
			this.maid.GiveTask(player.CharacterAdded.Connect((c) => bind(player, c)));
			if (player.Character) task.spawn(bind, player, player.Character);
		};
		this.maid.GiveTask(Players.PlayerAdded.Connect(track));
		for (const player of Players.GetPlayers()) track(player);
	}

	/**
	 * Clone this instance (Model or Folder) into every owned portal's viewports.
	 * You can pass `workspace` itself — Camera, Terrain, and any characters tracked
	 * via `addCharacter` are automatically excluded so they don't clone twice.
	 */
	setWorld(world: Instance): void {
		this.world = world;
		for (const portal of this.portals) portal.setWorld(world, this.characters);
	}

	/**
	 * @deprecated Use `setWorld` instead — same behavior. Kept for back-compat.
	 */
	attachWorld(world: Instance): void {
		this.setWorld(world);
	}

	/**
	 * Begin watching CollectionService for the configured tag. Existing
	 * tagged parts are paired immediately; future additions/removals are
	 * handled live.
	 */
	enableAutoDiscovery(): void {
		if (this.autoDiscoveryActive) return;
		this.autoDiscoveryActive = true;

		for (const inst of CollectionService.GetTagged(this.config.autoDiscoverTag)) {
			if (inst.IsA("BasePart")) this.tryRegister(inst);
		}

		this.maid.GiveTask(
			CollectionService.GetInstanceAddedSignal(this.config.autoDiscoverTag).Connect((inst) => {
				if (inst.IsA("BasePart")) this.tryRegister(inst);
			}),
		);
		this.maid.GiveTask(
			CollectionService.GetInstanceRemovedSignal(this.config.autoDiscoverTag).Connect((inst) => {
				if (inst.IsA("BasePart")) this.tryUnregister(inst);
			}),
		);
	}

	/**
	 * Bind the shared per-frame loop. One BeforeInput restore + one
	 * AfterCamera update, covering all owned portals.
	 */
	bind(): void {
		if (this.bound) return;
		this.bound = true;

		// Track RAW (pre-OffsetCam) state to restore in BeforeInput. The OffsetCam mirror
		// is a per-frame visual layer — if we cached the post-OffsetCam value here, CameraModule
		// would start each frame from a moved camera and the visual would oscillate. The
		// original Lua portal does exactly this split (LastCameraCFrame is assigned BEFORE the
		// OffsetCam if-block, but workspace.CurrentCamera.CFrame is set AFTER).
		let lastRawCFrame: CFrame | undefined;
		let lastRawFocus: CFrame | undefined;
		const beforeName = `PortalGroup${this.bindingId}_BeforeInput`;
		const afterName = `PortalGroup${this.bindingId}_AfterCamera`;

		RunService.BindToRenderStep(beforeName, Enum.RenderPriority.Input.Value - 1, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera || !lastRawCFrame || !lastRawFocus) return;
			camera.CFrame = lastRawCFrame;
			camera.Focus = lastRawFocus;
		});

		RunService.BindToRenderStep(afterName, Enum.RenderPriority.Camera.Value + 1, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera) return;

			let workingCam = camera.CFrame;
			let workingFocus = camera.Focus;
			let rawCam = workingCam;
			let rawFocus = workingFocus;
			for (const portal of this.portals) {
				const result = portal.update(workingCam, workingFocus);
				workingCam = result.cframe;
				workingFocus = result.focus;
				rawCam = result.rawCFrame;
				rawFocus = result.rawFocus;
			}

			camera.CFrame = workingCam;
			camera.Focus = workingFocus;
			lastRawCFrame = rawCam;
			lastRawFocus = rawFocus;
		});

		this.maid.GiveTask(() => {
			RunService.UnbindFromRenderStep(beforeName);
			RunService.UnbindFromRenderStep(afterName);
		});
	}

	unbind(): void {
		if (!this.bound) return;
		this.bound = false;
		RunService.UnbindFromRenderStep(`PortalGroup${this.bindingId}_BeforeInput`);
		RunService.UnbindFromRenderStep(`PortalGroup${this.bindingId}_AfterCamera`);
	}

	getPortals(): ReadonlyArray<Portal> {
		const arr: Portal[] = [];
		for (const portal of this.portals) arr.push(portal);
		return arr;
	}

	getStats(): GroupStats {
		return { portals: this.portals.size(), bound: this.bound };
	}

	destroy(): void {
		this.unbind();
		for (const portal of this.portals) portal.destroy();
		this.portals.clear();
		this.discoveredByPart.clear();
		this.discoveredByPairKey.clear();
		this.maid.DoCleaning();
	}

	private tryRegister(part: BasePart): void {
		if (this.discoveredByPart.has(part)) return;
		// Roblox's Clone() copies CollectionService tags. When setWorld clones a world
		// containing tagged portal parts into a ViewportFrame, the clones still bear the
		// tag and would re-fire GetInstanceAddedSignal, recursively creating new portals
		// that clone the world again — an exponential cascade. Restrict discovery to real
		// workspace descendants so viewport clones are ignored.
		if (!part.IsDescendantOf(Workspace)) return;
		const pairKey = part.GetAttribute(this.config.pairAttribute);
		if (typeIs(pairKey, "string") === false) return;
		const key = pairKey as string;

		const partner = this.discoveredByPairKey.get(key);
		if (!partner) {
			this.discoveredByPairKey.set(key, part);
			return;
		}
		if (partner === part) return;

		this.discoveredByPairKey.delete(key);

		// Merge the group's defaultPortalConfig with per-pair overrides. Per-part
		// attribute (PortalFace) wins over defaults for surfaceA/B.
		const config: PortalConfig = {
			...this.config.defaultPortalConfig,
			surfaceA: this.faceFor(partner) ?? this.config.defaultPortalConfig.surfaceA,
			surfaceB: this.faceFor(part) ?? this.config.defaultPortalConfig.surfaceB,
		};
		const portal = new Portal(partner, part, config);
		this.discoveredByPart.set(partner, portal);
		this.discoveredByPart.set(part, portal);
		this.addPortal(portal);
	}

	private tryUnregister(part: BasePart): void {
		const portal = this.discoveredByPart.get(part);
		if (!portal) {
			// part was waiting for its partner — clear the placeholder
			for (const [key, candidate] of this.discoveredByPairKey) {
				if (candidate === part) {
					this.discoveredByPairKey.delete(key);
					break;
				}
			}
			return;
		}
		this.discoveredByPart.delete(portal.getPartA());
		this.discoveredByPart.delete(portal.getPartB());
		this.removePortal(portal, true);
	}

	private faceFor(part: BasePart): Enum.NormalId | undefined {
		const raw = part.GetAttribute(this.config.faceAttribute);
		if (typeIs(raw, "number")) {
			return raw === Enum.NormalId.Top.Value
				? Enum.NormalId.Top
				: raw === Enum.NormalId.Bottom.Value
					? Enum.NormalId.Bottom
					: raw === Enum.NormalId.Left.Value
						? Enum.NormalId.Left
						: raw === Enum.NormalId.Right.Value
							? Enum.NormalId.Right
							: raw === Enum.NormalId.Back.Value
								? Enum.NormalId.Back
								: Enum.NormalId.Front;
		}
		return undefined;
	}
}
