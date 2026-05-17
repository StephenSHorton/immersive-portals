import Maid from "@rbxts/maid";
import { CollectionService, RunService, Workspace } from "@rbxts/services";

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
	private world?: Model;
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
		};
	}

	/** Manually register a portal. */
	addPortal(portal: Portal): void {
		if (this.portals.has(portal)) return;
		this.portals.add(portal);
		if (this.humanoid) portal.setHumanoid(this.humanoid);
		if (this.world) portal.setWorld(this.world);
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

	/** Clone this model into every owned portal's viewports. */
	attachWorld(world: Model): void {
		this.world = world;
		for (const portal of this.portals) portal.setWorld(world);
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

		let lastCFrame: CFrame | undefined;
		let lastFocus: CFrame | undefined;
		const beforeName = `PortalGroup${this.bindingId}_BeforeInput`;
		const afterName = `PortalGroup${this.bindingId}_AfterCamera`;

		RunService.BindToRenderStep(beforeName, Enum.RenderPriority.Input.Value - 1, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera || !lastCFrame || !lastFocus) return;
			camera.CFrame = lastCFrame;
			camera.Focus = lastFocus;
		});

		RunService.BindToRenderStep(afterName, Enum.RenderPriority.Camera.Value + 1, () => {
			const camera = Workspace.CurrentCamera;
			if (!camera) return;

			let workingCam = camera.CFrame;
			let workingFocus = camera.Focus;
			for (const portal of this.portals) {
				const result = portal.update(workingCam, workingFocus);
				workingCam = result.cframe;
				workingFocus = result.focus;
			}

			camera.CFrame = workingCam;
			camera.Focus = workingFocus;
			lastCFrame = workingCam;
			lastFocus = workingFocus;
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

		const config: PortalConfig = {
			surfaceA: this.faceFor(partner),
			surfaceB: this.faceFor(part),
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
