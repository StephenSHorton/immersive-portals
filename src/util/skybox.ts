import type { SkyboxConfig } from "../types";

// Roblox hard-caps BasePart.Size at 2048 per axis. Anything larger is silently
// clamped, leaving cube faces too small to span the camera's view — you'd see
// the texture only in a narrow cone. The SkyboxFrame is behind the WorldFrame
// (ZIndex 1 vs 2), so the cube only needs to enclose the camera, not the world.
const DEFAULT_SIZE = 2000;

/**
 * One entry per cube face. `position` is the face-center offset from cube center,
 * `face` is the NormalId pointing inward (toward cube center) where the Decal lives,
 * and `extraRotation` rotates the part about its inward face-normal axis so the
 * decal's texture orientation matches Roblox's Sky convention.
 *
 * Decal "texture up" defaults differ per face (Top/Bottom decals end up rotated 90°
 * vs Front/Back/Left/Right). The rotations below were derived empirically so a Sky
 * cloned into the cube reads the same as Lighting's real sky.
 */
const FACE_LAYOUT: ReadonlyArray<{
	textureKey: keyof SkyboxConfig["faces"];
	offset: Vector3;
	faceNormal: Vector3; // outward from cube; decal goes on the OPPOSITE face
	partSize: (s: number) => Vector3;
	extraRotation?: CFrame;
}> = [
	// Standard Roblox Sky face → world direction mapping. The skybox cube follows
	// the synthetic camera each frame, so the textures appear at infinity in the
	// directions matching real-world Lighting.Sky. Whether the portal "looks
	// natural" depends on how the portals are oriented in the scene (opposing
	// walls = standard teleporter view; same-direction = behind-view).
	{
		textureKey: "front",
		offset: new Vector3(0, 0, -0.5),
		faceNormal: new Vector3(0, 0, -1),
		partSize: (s) => new Vector3(s, s, 1),
	},
	{
		textureKey: "back",
		offset: new Vector3(0, 0, 0.5),
		faceNormal: new Vector3(0, 0, 1),
		partSize: (s) => new Vector3(s, s, 1),
	},
	{
		textureKey: "right",
		offset: new Vector3(-0.5, 0, 0),
		faceNormal: new Vector3(-1, 0, 0),
		partSize: (s) => new Vector3(1, s, s),
	},
	{
		textureKey: "left",
		offset: new Vector3(0.5, 0, 0),
		faceNormal: new Vector3(1, 0, 0),
		partSize: (s) => new Vector3(1, s, s),
	},
	{
		textureKey: "top",
		offset: new Vector3(0, 0.5, 0),
		faceNormal: new Vector3(0, 1, 0),
		partSize: (s) => new Vector3(s, 1, s),
		extraRotation: CFrame.Angles(0, math.pi / 2, 0),
	},
	{
		textureKey: "bottom",
		offset: new Vector3(0, -0.5, 0),
		faceNormal: new Vector3(0, -1, 0),
		partSize: (s) => new Vector3(s, 1, s),
		extraRotation: CFrame.Angles(0, -math.pi / 2, 0),
	},
];

function inwardFaceFor(faceNormal: Vector3): Enum.NormalId {
	if (faceNormal.X > 0.5) return Enum.NormalId.Left;
	if (faceNormal.X < -0.5) return Enum.NormalId.Right;
	if (faceNormal.Y > 0.5) return Enum.NormalId.Bottom;
	if (faceNormal.Y < -0.5) return Enum.NormalId.Top;
	if (faceNormal.Z > 0.5) return Enum.NormalId.Front;
	return Enum.NormalId.Back;
}

function facesFromSky(sky: Sky): SkyboxConfig["faces"] {
	return {
		front: sky.SkyboxFt,
		back: sky.SkyboxBk,
		left: sky.SkyboxLf,
		right: sky.SkyboxRt,
		top: sky.SkyboxUp,
		bottom: sky.SkyboxDn,
	};
}

function isSkyboxConfig(source: Sky | SkyboxConfig): source is SkyboxConfig {
	// A Roblox Instance throws when you index a property it doesn't declare, so
	// `"faces" in source` blows up for a `Sky`. Tell them apart via typeIs.
	return typeIs(source, "table");
}

/**
 * Builds a Model of 6 thin Parts arranged as the inside of a cube, each carrying
 * a Decal on the face that points toward cube center. From the camera's POV at
 * the cube center, the textures surround the viewer like a real skybox.
 *
 * The returned model has no PrimaryPart; consumers should call `model:PivotTo()`
 * each frame to keep it centered on the rendering camera so the skybox always
 * appears at infinity.
 *
 * Pass a `Sky` instance, or a `SkyboxConfig` for explicit texture IDs.
 */
export function createSkyboxModel(source: Sky | SkyboxConfig): Model {
	const config = isSkyboxConfig(source);
	const faces = config ? source.faces : facesFromSky(source);
	const size = config ? (source.size ?? DEFAULT_SIZE) : DEFAULT_SIZE;

	const model = new Instance("Model");
	model.Name = "SkyboxModel";

	for (const entry of FACE_LAYOUT) {
		const part = new Instance("Part");
		part.Name = `Sky_${entry.textureKey}`;
		part.Anchored = true;
		part.CanCollide = false;
		part.CanQuery = false;
		part.CanTouch = false;
		part.CastShadow = false;
		part.Material = Enum.Material.SmoothPlastic;
		part.Transparency = 1; // hide part body; only Decal renders
		part.Size = entry.partSize(size);

		const basePos = entry.offset.mul(size);
		part.CFrame = new CFrame(basePos).mul(entry.extraRotation ?? new CFrame());

		const decal = new Instance("Decal");
		decal.Texture = faces[entry.textureKey];
		decal.Face = inwardFaceFor(entry.faceNormal);
		decal.Parent = part;

		part.Parent = model;
	}

	return model;
}
