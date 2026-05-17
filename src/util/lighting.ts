import { Lighting } from "@rbxts/services";

import type { LightingSnapshot, WindowConfig } from "../types";

const DEFAULT_AMBIENT = new Color3(1, 1, 1);
const DEFAULT_SUN_DIRECTION = new Vector3(0, -1, 0);

/** Read current Lighting service values as a snapshot. */
export function snapshotLighting(): LightingSnapshot {
	return {
		ambient: Lighting.Ambient,
		sunDirection: Lighting.GetSunDirection(),
	};
}

/**
 * Resolve the lighting values a PortalWindow should use, given its config and
 * the current `live` mode flag. Manual overrides win when explicitly set.
 */
export function resolveLighting(config: WindowConfig | undefined): LightingSnapshot {
	const mode = config?.lightingMode ?? "manual";
	if (mode === "manual") {
		return {
			ambient: config?.ambient ?? DEFAULT_AMBIENT,
			sunDirection: config?.sunDirection ?? DEFAULT_SUN_DIRECTION,
		};
	}
	const snap = snapshotLighting();
	return {
		ambient: config?.ambient ?? snap.ambient,
		sunDirection: config?.sunDirection ?? snap.sunDirection,
	};
}

/**
 * Apply a lighting snapshot to a ViewportFrame. LightDirection takes the
 * inverse of sunDirection because ViewportFrame.LightDirection points TOWARD
 * the sun, while Lighting:GetSunDirection() points AWAY from it.
 */
export function applyLightingToFrame(frame: ViewportFrame, snapshot: LightingSnapshot): void {
	frame.Ambient = snapshot.ambient;
	frame.LightDirection = snapshot.sunDirection.mul(-1);
}
