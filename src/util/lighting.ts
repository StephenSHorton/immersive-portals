import { Lighting } from "@rbxts/services";

import type { LightingSnapshot, WindowConfig } from "../types";

// Defaults used by `manual` mode when the consumer doesn't override. Picked to
// produce a reasonably-lit, non-flat viewport even before the consumer thinks
// about lighting: white sun, mid-grey ambient, sun mostly overhead.
const DEFAULT_AMBIENT = new Color3(0.5, 0.5, 0.5);
const DEFAULT_LIGHT_COLOR = new Color3(1, 1, 1);
const DEFAULT_SUN_DIRECTION = new Vector3(0, -1, 0);

/**
 * Read the current Lighting service values that map cleanly onto a
 * ViewportFrame's three lighting inputs:
 * - `Ambient`     ← `Lighting.OutdoorAmbient` (the ambient applied to surfaces
 *   exposed to sky — the closest analog to "ambient light in the viewport").
 * - `LightColor`  ← `Lighting.ColorShift_Top` (Roblox's per-place sun tint).
 *   Falls back to white if ColorShift_Top is zero (the engine default), which
 *   in real rendering means "use the natural sun" — we approximate that as
 *   plain white inside the viewport.
 * - `LightDirection` ← `Lighting:GetSunDirection()`.
 */
export function snapshotLighting(): LightingSnapshot {
	const tint = Lighting.ColorShift_Top;
	const lightColor = tint.R === 0 && tint.G === 0 && tint.B === 0 ? DEFAULT_LIGHT_COLOR : tint;
	return {
		ambient: Lighting.OutdoorAmbient,
		lightColor,
		sunDirection: Lighting.GetSunDirection(),
	};
}

/**
 * Resolve the lighting values a PortalWindow should use, given its config and
 * the current `live` mode flag. Manual overrides win when explicitly set.
 */
export function resolveLighting(config: WindowConfig | undefined): LightingSnapshot {
	const mode = config?.lightingMode ?? "snapshot";
	if (mode === "manual") {
		return {
			ambient: config?.ambient ?? DEFAULT_AMBIENT,
			lightColor: config?.lightColor ?? DEFAULT_LIGHT_COLOR,
			sunDirection: config?.sunDirection ?? DEFAULT_SUN_DIRECTION,
		};
	}
	const snap = snapshotLighting();
	return {
		ambient: config?.ambient ?? snap.ambient,
		lightColor: config?.lightColor ?? snap.lightColor,
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
	frame.LightColor = snapshot.lightColor;
	frame.LightDirection = snapshot.sunDirection.mul(-1);
}
