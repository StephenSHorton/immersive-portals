# @rbxts/immersive-portals

Perspective-correct portal rendering for [roblox-ts](https://roblox-ts.com). Two paired surfaces become real-looking windows into each other — and walk through them to teleport.

```ts
import { Portal, PortalGroup, PortalWindow } from "@rbxts/immersive-portals";
```

## Install

```bash
npm install @rbxts/immersive-portals
```

## Three layers

### `PortalWindow` — render primitive

Wraps a `SurfaceGui` + `ViewportFrame` on a part face and re-projects its internal camera each frame so the texture appears as a true window. Standalone-useful for magic mirrors, security cameras, fish tanks.

```ts
import { PortalWindow } from "@rbxts/immersive-portals";

const window = PortalWindow.fromPart(part, Enum.NormalId.Front, part, {
  canvasSize: new Vector2(1024, 1024),
  lightingMode: "snapshot",
});
window.setSkybox(Lighting.FindFirstChildOfClass("Sky"));
window.cloneInto([Workspace.OtherRoom]);

RunService.RenderStepped.Connect(() => {
  const cam = Workspace.CurrentCamera;
  if (cam) window.render(cam.CFrame);
});
```

### `Portal` — paired teleporter

Two parts → two `PortalWindow`s + the per-frame loop that mirrors the camera through each portal plane and teleports the character when they cross.

```ts
import { Portal } from "@rbxts/immersive-portals";

const portal = new Portal(partA, partB, {
  surfaceA: Enum.NormalId.Front,
  surfaceB: Enum.NormalId.Front,
  teleportCooldown: 0.1,
});
portal.setWorld(Workspace.PortalScene);
portal.setHumanoid(Players.LocalPlayer.Character!.FindFirstChildOfClass("Humanoid"));
portal.addCharacter(Players.LocalPlayer.Character!);
portal.teleported.Connect((from, to) => print(`${from} → ${to}`));
portal.bind();
```

### `PortalGroup` — many portals, one render loop

Manages multiple portal pairs under a single shared `RenderStepped` binding. Supports auto-discovery via CollectionService.

```ts
import { PortalGroup } from "@rbxts/immersive-portals";

const group = new PortalGroup({
  autoDiscoverTag: "ImmersivePortal",
  pairAttribute: "PortalPair",  // string attribute matching across the pair
  faceAttribute: "PortalFace",  // optional integer NormalId per part
});
group.enableAutoDiscovery();
group.setHumanoid(Players.LocalPlayer.Character!.FindFirstChildOfClass("Humanoid"));
group.attachWorld(Workspace.PortalScene);
group.bind();
```

Studio authoring: tag two `BasePart`s with `ImmersivePortal`, set the `PortalPair` attribute to the same string on both, optionally set `PortalFace`. Done.

## Lighting

ViewportFrames don't render `Atmosphere`, `Clouds`, or `Sky` natively. The library provides a manual skybox proxy and exposes `lightingMode`:

| Mode | When to use |
|---|---|
| `"manual"` (default) | You set `ambient` + `sunDirection` yourself. Most predictable. |
| `"snapshot"` | Sample `Lighting:GetSunDirection()` + `Lighting.Ambient` once at construction. Matches legacy ViewportFrame demos. |
| `"live"` | Re-sample each frame. Use for day-night cycles. Slight cost per window. |

**Limitation:** `Atmosphere` contributes most of the diffuse light under `Future` lighting tech. The viewport sees only the `ambient` scalar, so heavily-atmospheric scenes will look slightly mismatched between the real world and the viewport. No engine-supported workaround exists.

## API surface

Classes:
- `PortalWindow`, `Portal`, `PortalGroup`

Pure functions:
- `createSkyboxModel(sky | config)` — `Sky` or `SkyboxConfig` → 3-part skybox `Model`
- `mirrorCFrameForCamera(cf, planeA, planeB)`, `mirrorCFrameForTeleport(cf, planeA, planeB)`
- `rayPlane(origin, direction, planePoint, planeNormal)`
- `segmentCrossesRect(from, to, planeCFrame, planeSize)`
- `snapshotLighting()`, `resolveLighting(config)`, `applyLightingToFrame(frame, snapshot)`

Types:
- `WindowConfig`, `PortalConfig`, `PortalGroupConfig`, `SkyboxConfig`, `LightingMode`, `LightingSnapshot`

## License

MIT
