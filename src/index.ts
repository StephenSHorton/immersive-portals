export { Portal } from "./portal/Portal";
export { PortalGroup } from "./portal/PortalGroup";
export { PortalWindow } from "./window/PortalWindow";

export { applyLightingToFrame, resolveLighting, snapshotLighting } from "./util/lighting";
export {
	mirrorCFrameForCamera,
	mirrorCFrameForTeleport,
	rayPlane,
	segmentCrossesRect,
	segmentCrossesRectBidirectional,
} from "./util/mirror";
export { createSkyboxModel } from "./util/skybox";

export type {
	LightingMode,
	LightingSnapshot,
	PortalConfig,
	PortalGroupConfig,
	SkyboxConfig,
	WindowConfig,
} from "./types";
