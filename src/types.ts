/**
 * How a PortalWindow obtains its `ambient` and `sunDirection` for the
 * internal ViewportFrames. The viewport cannot render Atmosphere/Clouds —
 * these two scalars are the only lighting inputs ViewportFrames respect.
 */
export type LightingMode = "manual" | "snapshot" | "live";

export interface WindowConfig {
	/** Which face of the adornee Part the SurfaceGui mounts to. Defaults to Front. */
	surface?: Enum.NormalId;
	/** ViewportFrame canvas resolution. Defaults to 1024×1024. */
	canvasSize?: Vector2;
	/** Lighting source mode. Defaults to "snapshot" — pulls Ambient, LightColor and sun direction from Lighting at construction so portals match the world. */
	lightingMode?: LightingMode;
	/** Used when lightingMode is "manual"; otherwise overrides snapshot/live values. */
	ambient?: Color3;
	/** Used when lightingMode is "manual"; otherwise overrides snapshot/live values. */
	lightColor?: Color3;
	/** Used when lightingMode is "manual"; otherwise overrides snapshot/live values. */
	sunDirection?: Vector3;
	/**
	 * BackgroundColor3 of the SkyboxFrame ViewportFrame, used when nothing in the
	 * skybox layer covers a given pixel (no Sky set, or scene has gaps). Defaults to
	 * a pale blue so empty viewports degrade to "open sky" rather than pitch black.
	 * Set explicitly to `Color3.new(0, 0, 0)` if you want black.
	 */
	backdropColor?: Color3;
	/**
	 * Hook for consumers to mutate either internal ViewportFrame post-construction
	 * (e.g. tweak LightColor, add custom child instances).
	 */
	customizeFrame?: (frame: ViewportFrame, layer: "world" | "skybox") => void;
}

export interface PortalConfig {
	/** Surface face for partA. Defaults to Front. */
	surfaceA?: Enum.NormalId;
	/** Surface face for partB. Defaults to Front. */
	surfaceB?: Enum.NormalId;
	/** Per-window config (applied independently to each side). */
	windowA?: WindowConfig;
	windowB?: WindowConfig;
	/** Yaw applied to teleport-through orientation. Defaults to math.pi (180°). */
	yawFlip?: number;
	/** Seconds before a viewer can re-teleport after crossing. Defaults to 0.1. */
	teleportCooldown?: number;
}

export interface PortalGroupConfig {
	/** CollectionService tag for auto-discovery. If absent, manual addPortal only. */
	autoDiscoverTag?: string;
	/** Attribute name carrying the pair key (string). Defaults to "PortalPair". */
	pairAttribute?: string;
	/** Attribute name carrying the surface NormalId (number). Defaults to "PortalFace". */
	faceAttribute?: string;
	/**
	 * Default PortalConfig fields (e.g. `teleportCooldown`, `windowA`, `windowB`)
	 * applied to every auto-discovered Portal. Per-pair attribute overrides take
	 * precedence over these defaults where they overlap (e.g. surfaceA/B).
	 */
	defaultPortalConfig?: PortalConfig;
}

/** Snapshot of lighting values that a PortalWindow consumes. */
export interface LightingSnapshot {
	ambient: Color3;
	lightColor: Color3;
	sunDirection: Vector3;
}

/** Configuration for the skybox-model factory. */
export interface SkyboxConfig {
	/** Cube edge length in studs. Defaults to 10000. */
	size?: number;
	/** Decal IDs for each face. Required. */
	faces: {
		front: string;
		back: string;
		left: string;
		right: string;
		top: string;
		bottom: string;
	};
}
