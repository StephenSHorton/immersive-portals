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

## Authoring gotchas

A short list of things that will burn you exactly once if you don't know them up front.

### Portal orientation

Each portal part has a Front face (the `+LookVector` side). The library mounts the `SurfaceGui` on that face by default. **Walk-through detection accepts entry from either face** — the segment-cross check is bidirectional — but the visual viewport only renders on the Front. If you stand in front of the Back face you'll see the unadorned part instead of the portal effect, even though walking into it still teleports you.

Place portals with their Fronts facing where players approach. In a script:
```ts
portalPart.CFrame = CFrame.lookAt(portalPart.Position, somewhereTowardSpawn);
```

### Mirror math assumes the "doorway" model

The internal mirror applies a 180° yaw flip (Y_SPIN), which is the standard portal-physics convention: walking INTO portal A means walking OUT of portal B, facing-direction inverted. For partner portals oriented to face each other ("doorways"), this gives the natural effect.

If your partners face the SAME direction (parallel), the mirror still works but the viewport camera lands BEHIND the partner part — so the viewport shows whatever is on the partner's back side. **Put scenery there**, or the viewport will read as empty/sky-only.

### Character cloning needs a fully loaded character

`Player.CharacterAdded` fires the moment the Model is parented to Workspace, *before* body parts and accessories replicate. Calling `portal.addCharacter` at that instant clones a Shirt+Humanoid stub.

```ts
const bindCharacter = (character: Model) => {
  character.WaitForChild("Humanoid");
  character.WaitForChild("HumanoidRootPart");
  if (!player.HasAppearanceLoaded()) player.CharacterAppearanceLoaded.Wait();
  // now safe
  for (const portal of group.getPortals()) portal.addCharacter(character);
};
```

### SurfaceGui must be parented to PlayerGui

`ViewportFrame` content does not render when its SurfaceGui is parented to a `BasePart` directly — only Frames render in that case. `PortalWindow.fromPart` already handles this by defaulting the parent to `LocalPlayer.PlayerGui`, but if you construct a `PortalWindow` from a pre-existing SurfaceGui, parent it under PlayerGui yourself. The library also sets `ResetOnSpawn = false` on the SurfaceGui so it survives respawns.

### Tag stripping on cloned descendants

`cloneInto` strips CollectionService tags from clones it produces. ViewportFrame contents are display-only; leaving tags on them re-fires `GetInstanceAddedSignal` for the auto-discovery layer and can cascade into an exponential portal-creation loop. If you want tagged clones, copy the tag back inside `cloneFunc`.

### `World` for `attachWorld` can be a Folder or Model

The signature accepts any `Instance`. The library clones its children recursively. Putting your portal scene in a `Folder` named `World` and pointing `attachWorld` at it is the simplest pattern.

Top-level children added to the world after `attachWorld` are auto-synced via `ChildAdded`/`ChildRemoved`. Deep additions (descendants of an already-cloned subtree) are NOT — call `setWorld`/`attachWorld` again to re-snapshot those.

## Lighting

ViewportFrames don't render `Atmosphere`, `Clouds`, or `Sky` natively. The library provides a manual skybox proxy and exposes `lightingMode`:

| Mode | When to use |
|---|---|
| `"snapshot"` (default) | Sample `Lighting.OutdoorAmbient`, `Lighting.ColorShift_Top`, and `Lighting:GetSunDirection()` once at construction. Best out-of-the-box match to the surrounding world. |
| `"manual"` | You set `ambient` + `lightColor` + `sunDirection` yourself. Most predictable. |
| `"live"` | Re-sample each frame. Use for day-night cycles. Slight cost per window. |

## Limitations

### No post-processing in viewports

**Expect the portal view to look flatter than the main render.** ViewportFrame does not run any post-processing — no bloom, sun rays, depth of field, color correction, atmosphere scattering, or tonemapping — even when those effects are present in the parent place's `Lighting`. The library samples the three lighting inputs a ViewportFrame *does* support (`Ambient`, `LightColor`, `LightDirection`) and that's the ceiling Roblox gives us. A portal in a place with heavy atmosphere/bloom will read noticeably darker and less saturated than the world around it; no engine-supported workaround exists. Pre-multiplying `LightColor` to compensate just blows out highlights without restoring the missing effects, so the library intentionally doesn't do that — set expectations rather than fight the renderer.

### No nested-portal recursion

The Portal-game effect of one portal looking through itself into an infinite tunnel is **not possible** in Roblox. `ViewportFrame` doesn't render nested GUIs — if a partner portal part is visible in the cloned world, you see its bare geometry, not its viewport graphic. Roblox exposes no offscreen-render-to-texture or feedback-pass primitive, so true recursion can't be faked. Treat partner portals in view as flat surfaces.

## API surface

Classes:
- `PortalWindow`, `Portal`, `PortalGroup`

Pure functions:
- `createSkyboxModel(sky | config)` — `Sky` or `SkyboxConfig` → 3-part skybox `Model`
- `mirrorCFrameForCamera(cf, planeA, planeB)`, `mirrorCFrameForTeleport(cf, planeA, planeB)`
- `rayPlane(origin, direction, planePoint, planeNormal)`
- `segmentCrossesRect(from, to, planeCFrame, planeSize)` (one-way; used for camera-through-portal)
- `segmentCrossesRectBidirectional(from, to, planeCFrame, planeSize)` (used for teleport)
- `snapshotLighting()`, `resolveLighting(config)`, `applyLightingToFrame(frame, snapshot)`

Types:
- `WindowConfig`, `PortalConfig`, `PortalGroupConfig`, `SkyboxConfig`, `LightingMode`, `LightingSnapshot`

## License

MIT
