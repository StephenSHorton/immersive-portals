import type { SkyboxConfig } from "../types";

const DEFAULT_SIZE = 10000;

const SIDE_FACES: ReadonlyArray<[keyof SkyboxConfig["faces"], Enum.NormalId]> = [
	["back", Enum.NormalId.Back],
	["front", Enum.NormalId.Front],
	["left", Enum.NormalId.Left],
	["right", Enum.NormalId.Right],
];

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

function buildBaseFace(scale: Vector3): Part {
	const part = new Instance("Part");
	part.CanCollide = false;
	part.Anchored = true;
	part.Transparency = 1;
	part.Size = new Vector3(1, 1, 1);
	const mesh = new Instance("BlockMesh");
	mesh.Scale = scale;
	mesh.Parent = part;
	return part;
}

function isSkyboxConfig(source: Sky | SkyboxConfig): source is SkyboxConfig {
	// A Roblox Instance throws when you index a property it doesn't declare, so
	// `"faces" in source` blows up for a `Sky`. Tell them apart via typeIs: a
	// plain table config is `"table"`, an Instance is `"Instance"`.
	return typeIs(source, "table");
}

/**
 * Builds a Model of three Parts (sides, top, bottom) carrying decals that
 * mimic a Roblox Sky inside a ViewportFrame. Sky/Atmosphere/Clouds are not
 * rendered by ViewportFrame natively — this is the workaround.
 *
 * Pass a `Sky` instance, or a `SkyboxConfig` for explicit texture IDs.
 * Returned model is unparented; caller decides where it lives.
 */
export function createSkyboxModel(source: Sky | SkyboxConfig): Model {
	const config = isSkyboxConfig(source);
	const faces = config ? source.faces : facesFromSky(source);
	const size = config ? (source.size ?? DEFAULT_SIZE) : DEFAULT_SIZE;
	const scale = new Vector3(size, size, size);

	const sidePart = buildBaseFace(scale);
	const topPart = buildBaseFace(scale);
	const bottomPart = buildBaseFace(scale);

	for (const [key, face] of SIDE_FACES) {
		const decal = new Instance("Decal");
		decal.Texture = faces[key];
		decal.Face = face;
		decal.Parent = sidePart;
	}

	const topDecal = new Instance("Decal");
	topDecal.Texture = faces.top;
	topDecal.Face = Enum.NormalId.Top;
	topDecal.Parent = topPart;

	const bottomDecal = new Instance("Decal");
	bottomDecal.Texture = faces.bottom;
	bottomDecal.Face = Enum.NormalId.Bottom;
	bottomDecal.Parent = bottomPart;

	const mirror = new CFrame(0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 1);
	sidePart.CFrame = mirror.mul(CFrame.Angles(math.pi, math.pi, 0));
	topPart.CFrame = mirror.mul(CFrame.Angles(math.pi, math.pi / 2, 0));
	bottomPart.CFrame = mirror.mul(CFrame.Angles(math.pi, -math.pi / 2, 0));

	const model = new Instance("Model");
	model.Name = "SkyboxModel";
	sidePart.Parent = model;
	topPart.Parent = model;
	bottomPart.Parent = model;
	return model;
}
