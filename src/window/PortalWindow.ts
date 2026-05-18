import Maid from "@rbxts/maid";
import { CollectionService, Workspace } from "@rbxts/services";

import type { WindowConfig } from "../types";
import { applyLightingToFrame, resolveLighting } from "../util/lighting";
import { Y_SPIN } from "../util/mirror";
import { createSkyboxModel } from "../util/skybox";

const PI2 = math.pi / 2;
const UNIT_Y = new Vector3(0, 1, 0);
const UNIT_NZ = new Vector3(0, 0, -1);
const XZ_MASK = new Vector3(1, 0, 1);
const YZ_MASK = new Vector3(0, 1, 1);

const DEFAULT_CANVAS_SIZE = new Vector2(1024, 1024);
const DEFAULT_SURFACE = Enum.NormalId.Front;

interface SurfaceInfo {
	cframe: CFrame;
	size: Vector3;
}

/**
 * Layer 1 — render primitive. Wraps a SurfaceGui+ViewportFrame on a part face
 * and exposes `render(viewerCFrame)` to compute the perspective-correct
 * internal camera each frame so the surface texture projects as a real
 * window into another scene.
 *
 * Standalone-useful: a single PortalWindow can serve as a magic mirror,
 * security camera, or fish tank. It knows nothing about portal pairing or
 * teleportation.
 */
export class PortalWindow {
	private maid = new Maid();
	private surfaceGui: SurfaceGui;
	private camera: Camera;
	private worldFrame: ViewportFrame;
	private skyboxFrame: ViewportFrame;
	private skyboxModel?: Model;
	private skyboxBaseCFrames?: Map<BasePart, CFrame>;
	private config: WindowConfig;
	private liveMode: boolean;

	constructor(surfaceGui: SurfaceGui, config: WindowConfig = {}) {
		this.surfaceGui = surfaceGui;
		this.config = config;
		this.liveMode = config.lightingMode === "live";

		const camera = new Instance("Camera");
		camera.Parent = surfaceGui;
		this.camera = camera;

		this.worldFrame = this.buildFrame("WorldFrame", 2, "world");
		this.skyboxFrame = this.buildFrame("SkyboxFrame", 1, "skybox");

		this.refreshLighting();

		this.maid.GiveTask(surfaceGui);

		if (this.liveMode) {
			this.maid.GiveTask(
				game.GetService("RunService").Heartbeat.Connect(() => this.refreshLighting()),
			);
		}
	}

	/**
	 * Build a `PortalWindow` mounted to a face of an existing BasePart.
	 * Creates the SurfaceGui automatically.
	 */
	static fromPart(part: BasePart, surface: Enum.NormalId, parent: Instance, config: WindowConfig = {}): PortalWindow {
		const surfaceGui = new Instance("SurfaceGui");
		surfaceGui.Face = surface;
		surfaceGui.CanvasSize = config.canvasSize ?? DEFAULT_CANVAS_SIZE;
		surfaceGui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
		surfaceGui.Adornee = part;
		surfaceGui.LightInfluence = 0;
		surfaceGui.ClipsDescendants = true;
		// PlayerGui's default ResetOnSpawn=true destroys the SurfaceGui on respawn,
		// killing the portal. Disable when parented under PlayerGui.
		surfaceGui.ResetOnSpawn = false;
		surfaceGui.Parent = parent;
		return new PortalWindow(surfaceGui, { ...config, surface });
	}

	getAdornee(): BasePart | Model | undefined {
		return this.surfaceGui.Adornee;
	}

	getSurfaceCFrame(): CFrame {
		return this.computeSurface().cframe;
	}

	getSurfaceSize(): Vector3 {
		return this.computeSurface().size;
	}

	getCamera(): Camera {
		return this.camera;
	}

	getWorldFrame(): ViewportFrame {
		return this.worldFrame;
	}

	getSkyboxFrame(): ViewportFrame {
		return this.skyboxFrame;
	}

	/**
	 * Set the skybox shown behind cloned world contents. Pass a `Sky` (the
	 * library builds the cube model internally) or undefined to clear.
	 */
	setSkybox(sky: Sky | undefined): void {
		this.skyboxFrame.ClearAllChildren();
		this.skyboxModel = undefined;
		this.skyboxBaseCFrames = undefined;
		if (sky) {
			const model = createSkyboxModel(sky);
			model.Parent = this.skyboxFrame;
			this.skyboxModel = model;
			// Cache each face's at-origin CFrame so render() can translate them by the
			// camera position directly. PivotTo behaves unreliably inside a ViewportFrame
			// (it can rigid-rotate the model based on internal pivot rotation), so we
			// translate parts individually instead.
			const cframes = new Map<BasePart, CFrame>();
			for (const child of model.GetChildren()) {
				if (child.IsA("BasePart")) cframes.set(child, child.CFrame);
			}
			this.skyboxBaseCFrames = cframes;
		}
	}

	/**
	 * Clone a hierarchy into the world ViewportFrame, building a
	 * real→clone lookup map. Scripts and ViewportFrames are skipped
	 * (the latter prevents unbounded recursion when a window's own
	 * apparatus is a descendant of the cloned tree). Each clone has its
	 * children cleared and is repopulated recursively, so the resulting
	 * tree is a deep copy with no scripts attached.
	 *
	 * `cloneFunc(real, clone)` fires per cloned instance for custom mutation.
	 * `exclude` skips specific instances and does not recurse into them.
	 */
	cloneInto(
		children: ReadonlyArray<Instance>,
		cloneFunc?: (real: Instance, clone: Instance) => void,
		parent?: Instance,
		lookup?: Map<Instance, Instance>,
		exclude?: ReadonlySet<Instance>,
	): Map<Instance, Instance> {
		const map = lookup ?? new Map<Instance, Instance>();
		const dest = parent ?? this.worldFrame;
		for (const real of children) {
			if (real.IsA("LuaSourceContainer")) continue;
			if (real.IsA("ViewportFrame")) continue;
			// Skip classes that ViewportFrame can't render or that shouldn't be cloned.
			// Without this guard, `attachWorld(workspace)` would try to clone the live
			// Camera (which Roblox treats specially) and Terrain (which can't be cloned
			// inside a ViewportFrame at all).
			if (real.IsA("Camera")) continue;
			if (real.IsA("Terrain")) continue;
			if (exclude?.has(real)) continue;
			const wasArchivable = real.Archivable;
			real.Archivable = true;
			const clone = real.Clone();
			real.Archivable = wasArchivable;
			if (!clone) continue;
			clone.ClearAllChildren();
			// Strip CollectionService tags from the clone. ViewportFrame contents are
			// display-only — they shouldn't participate in tag-based systems. Without
			// this, cloning tagged parts (e.g. portal parts inside a cloned World)
			// fires GetInstanceAddedSignal endlessly and spams re-entrancy warnings.
			for (const tag of CollectionService.GetTags(clone)) {
				CollectionService.RemoveTag(clone, tag);
			}
			if (cloneFunc) cloneFunc(real, clone);
			clone.Parent = dest;
			this.cloneInto(real.GetChildren(), cloneFunc, clone, map, exclude);
			map.set(real, clone);
		}
		return map;
	}

	/**
	 * Render one frame from the given viewer CFrame. If surface info is
	 * omitted, it's computed from the adornee + configured face.
	 */
	render(viewerCFrame: CFrame, surfaceCFrame?: CFrame, surfaceSize?: Vector3): void {
		const camera = Workspace.CurrentCamera;
		if (!camera) return;

		let surfCF = surfaceCFrame;
		let surfSize = surfaceSize;
		if (!surfCF || !surfSize) {
			const info = this.computeSurface();
			surfCF = info.cframe;
			surfSize = info.size;
		}

		const tc = surfCF.mul(new Vector3(0, surfSize.Y / 2, 0));
		const bc = surfCF.mul(new Vector3(0, -surfSize.Y / 2, 0));

		const cross = viewerCFrame.LookVector.Cross(surfCF.UpVector);
		const right = cross.Dot(cross) > 0 ? cross.Unit : viewerCFrame.RightVector;

		const levelCamCF = CFrame.fromMatrix(
			viewerCFrame.Position,
			right,
			surfCF.UpVector,
			right.Cross(surfCF.UpVector),
		);
		const levelCamCFInv = levelCamCF.Inverse();

		const csbc = levelCamCFInv.mul(bc);
		const cstc = levelCamCFInv.mul(tc);
		const v1 = csbc.mul(YZ_MASK).Unit;
		const v2 = cstc.mul(YZ_MASK).Unit;
		const alpha = math.sign(v1.Y) * math.acos(v1.Dot(UNIT_NZ));
		const beta = math.sign(v2.Y) * math.acos(v2.Dot(UNIT_NZ));

		const fh = 2 * math.tan(math.rad(camera.FieldOfView) / 2);
		const hPrime = math.tan(beta) - math.tan(alpha);
		const refHeight = hPrime / fh;

		const c2p = surfCF.VectorToObjectSpace(surfCF.Position.sub(viewerCFrame.Position));
		const c2pXZ = c2p.mul(XZ_MASK);
		const c2pYZ = c2p.mul(YZ_MASK);

		const dpX = c2pXZ.Unit.Dot(UNIT_NZ);
		const camXZ = surfCF.VectorToObjectSpace(viewerCFrame.LookVector).mul(XZ_MASK);

		const scale = camXZ.Unit.Dot(c2pXZ.Unit) / UNIT_NZ.Dot(c2pXZ.Unit);
		const tanArcCos = math.sqrt(1 - dpX * dpX) / dpX;

		const w = 1;
		const h = surfSize.X / surfSize.Y;
		const dx = math.sign(c2p.X * c2p.Z) * tanArcCos;
		const dy = (c2pYZ.Y / c2pYZ.Z) * h;
		const d = math.abs(scale * refHeight * h);

		// Guard against degenerate geometry (camera on the plane, zero surface size,
		// etc.) that produces NaN/Inf. Assigning a NaN CFrame to Camera can hard-crash
		// Roblox's render pipeline.
		if (dx !== dx || dy !== dy || d !== d || dx === math.huge || dy === math.huge || d === math.huge) {
			return;
		}

		// Match original Lua exactly: (surfaceCF - surfaceCF.p) zeros the position, keeping rotation.
		// Roblox-ts .Rotation should be equivalent but the original uses the sub form, so we match it
		// to avoid any subtle precision difference.
		const skewed = surfCF.sub(surfCF.Position).mul(Y_SPIN).mul(new CFrame(0, 0, 0, w, 0, 0, 0, h, 0, dx, dy, d));
		const [px, py, pz, r00, r01, r02, r10, r11, r12, r20, r21, r22] = skewed.GetComponents();

		// Match original normalization: max of ALL 12 abs components, but only divide the 9 rotation components.
		// This produces the perspective skew that makes the surface look like a real window.
		const max = math.max(
			math.abs(px),
			math.abs(py),
			math.abs(pz),
			math.abs(r00),
			math.abs(r01),
			math.abs(r02),
			math.abs(r10),
			math.abs(r11),
			math.abs(r12),
			math.abs(r20),
			math.abs(r21),
			math.abs(r22),
		);

		if (max <= 0 || max !== max || max === math.huge) return;

		const normalized = new CFrame(
			px,
			py,
			pz,
			r00 / max,
			r01 / max,
			r02 / max,
			r10 / max,
			r11 / max,
			r12 / max,
			r20 / max,
			r21 / max,
			r22 / max,
		);

		const finalCam = normalized.add(viewerCFrame.Position);
		this.camera.FieldOfView = camera.FieldOfView;
		this.camera.CFrame = finalCam;
		this.camera.Focus = finalCam.mul(new CFrame(0, 0, viewerCFrame.PointToObjectSpace(surfCF.Position).Z));

		// Keep the skybox cube centered on the synthetic camera so its faces always
		// appear at infinity. We translate each face individually rather than calling
		// Model:PivotTo, because PivotTo behaves unreliably inside a ViewportFrame.
		if (this.skyboxBaseCFrames) {
			for (const [part, baseCF] of this.skyboxBaseCFrames) {
				part.CFrame = baseCF.add(finalCam.Position);
			}
		}
	}

	/** Re-sample lighting (Ambient + sun direction) and apply to both frames. */
	refreshLighting(): void {
		const snap = resolveLighting(this.config);
		applyLightingToFrame(this.worldFrame, snap);
		applyLightingToFrame(this.skyboxFrame, snap);
	}

	destroy(): void {
		this.maid.DoCleaning();
	}

	private buildFrame(name: string, zIndex: number, layer: "world" | "skybox"): ViewportFrame {
		const frame = new Instance("ViewportFrame");
		frame.Name = name;
		frame.Size = new UDim2(1, 0, 1, 0);
		frame.Position = new UDim2(0, 0, 0, 0);
		frame.AnchorPoint = new Vector2(0, 0);
		frame.ZIndex = zIndex;
		frame.CurrentCamera = this.camera;
		// Default: both layers fully transparent. Empty viewports show the part/world
		// behind the SurfaceGui. Set `backdropColor` in the WindowConfig if you want the
		// skybox layer to fall back to an opaque color instead (useful for windows into
		// a hidden room where you don't want the real world bleeding through).
		frame.BackgroundTransparency = 1;
		if (layer === "skybox" && this.config.backdropColor) {
			frame.BackgroundTransparency = 0;
			frame.BackgroundColor3 = this.config.backdropColor;
		}
		frame.Parent = this.surfaceGui;
		this.config.customizeFrame?.(frame, layer);
		return frame;
	}

	private computeSurface(): SurfaceInfo {
		const adornee = this.surfaceGui.Adornee;
		assert(adornee, "PortalWindow.computeSurface: SurfaceGui has no Adornee");
		const part = adornee as BasePart;
		const partCF = part.CFrame;
		const partSize = part.Size;

		const face = this.config.surface ?? this.surfaceGui.Face;
		const back = Vector3.FromNormalId(face).mul(-1);
		const axis = math.abs(back.Y) === 1 ? new Vector3(back.Y, 0, 0) : UNIT_Y;
		const right = CFrame.fromAxisAngle(axis, PI2).mul(back);
		const top = back.Cross(right).Unit;

		const surfaceOffset = back.mul(partSize).mul(-0.5);
		const cframe = partCF.mul(CFrame.fromMatrix(surfaceOffset, right, top, back));
		const size = new Vector3(
			partSize.mul(right).Magnitude,
			partSize.mul(top).Magnitude,
			partSize.mul(back).Magnitude,
		);

		return { cframe, size };
	}
}
