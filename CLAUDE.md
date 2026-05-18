# CLAUDE.md

## Project Overview

**@rbxts/immersive-portals** is a TypeScript-native library for roblox-ts that renders perspective-correct portal windows between paired surfaces in a Roblox world. Built on `ViewportFrame` with manual skybox proxies and seamless teleportation.

The library is composable in three layers:
1. **`PortalWindow`** — render primitive (a perspective-correct ViewportFrame on a part)
2. **`Portal`** — a paired teleporter built from two `PortalWindow`s
3. **`PortalGroup`** — orchestrator for many `Portal`s sharing one render loop

Each layer is independently useful. `PortalWindow` works standalone as a "magic window" (security camera, fish tank, magic mirror). `Portal` adds teleportation. `PortalGroup` adds bulk discovery + a shared per-frame budget.

## Commands

```bash
bun install        # Install dependencies
bun run build      # Compile TypeScript to Luau
bun run watch      # Watch mode
```

Compiled output lands in `out/`. Consumer projects link to this package via a junction to `out/`.

**Consumer sync:** Use the [rojo-push](https://github.com/StephenSHorton/rojo-push) fork in consuming projects so library rebuilds propagate to Studio reliably across junctions. Run `rojo serve --no-watch` once, then `rojo push` after every `bun run build` here. No watcher = no missed events, no restarts.

## Architecture

### Package Structure

```
src/
├── types.ts                    # All public types
├── window/
│   └── PortalWindow.ts         # Layer 1: render primitive
├── portal/
│   ├── Portal.ts               # Layer 2: paired teleporter
│   └── PortalGroup.ts          # Layer 3: many-portal coordinator
├── util/
│   ├── skybox.ts               # Sky → cube Model factory (pure)
│   ├── mirror.ts               # CFrame/Vector3 plane-mirror math (pure)
│   └── lighting.ts             # Snapshot/apply Lighting → ViewportFrame
└── index.ts                    # Public API barrel
```

### Layer 1 — `PortalWindow`

The render primitive. Wraps a `SurfaceGui` mounted to a `BasePart` face with two stacked `ViewportFrame`s (skybox layer behind, world layer in front) sharing one `Camera`. The `:render(viewerCFrame)` method recomputes the internal camera each frame so the viewport texture projects correctly onto the surface from the viewer's POV.

**Knows nothing about teleportation or other windows.** Standalone-useful.

```ts
const window = new PortalWindow(part, Enum.NormalId.Front, {
  canvasSize: new Vector2(1024, 1024),
  lightingMode: "snapshot",
});
window.setSkybox(game.Lighting.FindFirstChildOfClass("Sky"));
window.cloneInto(workspace.OtherRoom);

RunService.RenderStepped.Connect(() => {
  window.render(workspace.CurrentCamera.CFrame);
});
```

### Layer 2 — `Portal`

A paired portal. Owns two `PortalWindow`s (one per surface) and a per-frame loop. Each frame, the viewer's camera CFrame is mirrored through each portal plane and the partner window is rendered from that mirrored POV — so each portal shows the other side. If a viewer (Humanoid or Camera) is bound, crossing the portal plane teleports them through.

Surfaces are arbitrary `BasePart`s. The library does not care how they are positioned; the mirror math handles arbitrary orientation.

```ts
const portal = new Portal(partA, partB, {
  surfaceA: Enum.NormalId.Front,
  surfaceB: Enum.NormalId.Front,
  yawFlip: math.pi,
  teleportCooldown: 0.1,
});
portal.setWorld(workspace.PortalScene);
portal.setHumanoid(localPlayer.Character!.Humanoid);
portal.addCharacter(localPlayer.Character!);
portal.teleported.Connect((from, to) => print("crossed"));
portal.bind();
```

### Layer 3 — `PortalGroup`

Many-portal orchestrator. Shares one `RenderStepped` callback across all portals it owns (instead of each `Portal` binding its own). Supports auto-discovery via CollectionService tag + attribute pairing.

```ts
const group = new PortalGroup({
  autoDiscoverTag: "ImmersivePortal",
  pairAttribute: "PortalPair",    // parts with matching string value pair up
  faceAttribute: "PortalFace",    // optional NormalId override per part
  defaultPortalConfig: { teleportCooldown: 0.2 }, // applied to every discovered pair
});
group.enableAutoDiscovery();
group.setWorld(workspace.PortalScene);
group.trackAllPlayers(); // wires up Players.PlayerAdded + CharacterAdded + setHumanoid for local
group.bind();
```

## Key Design Decisions

### 1. Three concerns, three layers (not one God-class)

The current Shrink/Grow `Portal` ModuleScript bundles render math, scene capture, teleportation, and skybox handling into one class with hand-injected dependencies. We split:
- **Render math** lives in `PortalWindow`
- **Pairing / teleportation** lives in `Portal`
- **Bulk coordination** lives in `PortalGroup`
- **Skybox proxy construction** is a pure function in `util/skybox.ts`
- **Plane-mirror math** is pure functions in `util/mirror.ts`

This means consumers can use Layer 1 for non-portal use cases (peephole window into a hidden area, in-world cinematic shot, etc.) without buying the teleport logic.

### 2. No global mutation of `Lighting.Sky`

The current impl reparents `Lighting.Sky` to whichever side the viewer is on, every frame. That's invasive, breaks any other system that owns `Lighting`, and is unnecessary if each window holds its own skybox proxy.

In this library:
- Each `PortalWindow` has its own skybox model inside its own `ViewportFrame`.
- The real-world sky is never touched.
- If a consumer wants to change the *real* sky when a viewer crosses a portal, they listen to `portal.teleported` and do it themselves.

### 3. Lighting modes — first-class

The current `ViewportWindow.lua` samples `Lighting:GetSunDirection()` and `Lighting.Ambient` once at construction and never refreshes. Under modern lighting techs (especially `Future` + `Atmosphere`), `Ambient` alone is a poor approximation of the real scene because Atmosphere contributes most of the diffuse light — and Atmosphere doesn't render inside `ViewportFrame`.

We expose `lightingMode`:
- `"snapshot"` *(default)* — sample `Lighting.OutdoorAmbient`, `Lighting.ColorShift_Top`, and `Lighting:GetSunDirection()` once at construction. Best out-of-box match to the surrounding world.
- `"manual"` — consumer sets `ambient`, `lightColor`, and `sunDirection` explicitly. Most predictable.
- `"live"` — re-sample each frame. Use for day-night cycles. Slight cost.

Plus `:refreshLighting()` for manual one-shot updates.

Atmosphere/Clouds limitation is documented prominently in README — no automatic workaround exists short of rendering the real scene to a RenderTarget, which Roblox doesn't expose.

### 4. Tags and attributes over named children

`Portal.lua` finds the per-side sky by name: `partA:FindFirstChild("SkyA")`. Rename either child and the system silently no-ops. We replace this with:
- Explicit `setSkybox(sky)` calls on `PortalWindow` (most flexible)
- CollectionService tags + attributes in `PortalGroup`'s discovery layer (declarative authoring in Studio)

### 5. Maid-driven cleanup, no leaks

The current `Portal:Destroy()` unbinds `RenderStepped` but leaves cloned characters, world clones, and reparented Lighting state behind. Every class in this library owns a `Maid` (from `@rbxts/maid`) and releases everything on `:destroy()` — instances, signal connections, restored Lighting state. Destroying-then-recreating must not leak.

### 6. Surface API as documented contract

Each layer publishes its public methods as TypeScript class members with JSDoc. `Portal` does not duck-type into `PortalWindow` via guessed method names — it imports and constructs the class directly. roblox-ts catches breaking changes at compile time.

### 7. Signals over polling

Following navigate's convention. `Portal.teleported`, `Portal.entered`, `Portal.exited` use `@rbxts/signal`. Consumers connect; no polling.

### 8. Server/client split

`PortalWindow` and `Portal` render — they are **client-only**. Teleportation can be either:
- **Local** (default) — `Portal` moves the character locally for snappiness; physics replicate naturally
- **Server-authoritative** — consumer fires a RemoteEvent on `teleported` and lets the server confirm

The library does not own a RemoteEvent or assume a network model.

## What's Changing from Shrink/Grow's Current Impl

| Current (Studio) | New (this library) |
|---|---|
| `Portal` God-class wires Windows via duck-typed methods | Three layers, typed imports, compile-checked contracts |
| `Lighting.Sky` reparented every frame | Each window has its own skybox model; Lighting untouched |
| `SkyA`/`SkyB` named children | Explicit `setSkybox` per window; tags+attributes in groups |
| `:Destroy()` leaks clones, Lighting state | Maid-driven; clean teardown verified by tests |
| `Lighting` sampled once at construction, no refresh | `lightingMode: "manual" \| "snapshot" \| "live"` + `refreshLighting()` |
| `RenderStepped` per `Portal` | One shared loop per `PortalGroup` |
| Hardcoded 1024×1024 canvas | `canvasSize: Vector2` config option |
| Implicit dependencies on player `CameraModule.activeOcclusionModule` | `Portal` works without it; consumer opts in via `cameraModule` config |
| `ZERO`, dead code, shadowed locals | Strict TS + biome lint |

## roblox-ts Constraints

- **No getters/setters** — use explicit methods (`getCamera()`, `setSkybox()`)
- **`next` and `local` are reserved** — use `following`, `upcoming`, `localVec`, etc.
- **`index.ts` compiles to `init.luau`** — entry point for the package
- **No Roblox-style PascalCase methods on classes** — use camelCase consistently (the consumer is writing TS)

## Visualization

Unlike navigate, this library doesn't have debug "neon ball" visualizations of its own — the portal *is* the visualization. Future debug features might include:
- A red wireframe on each portal surface in Studio
- Logged camera-CFrame deltas
- A `PortalGroup.getStats()` returning per-portal render times

None of these are scaffolded yet.

## Consumer Pattern (target — not yet implemented)

In a Flamework client controller:

```typescript
@Controller()
export class PortalController implements OnStart {
  private group = new PortalGroup({ autoDiscoverTag: "ImmersivePortal" });

  onStart() {
    this.group.enableAutoDiscovery();
    this.group.setWorld(Workspace.WaitForChild("World"));
    this.group.trackAllPlayers();
    this.group.bind();
  }
}
```

Studio authoring: tag two `Part`s with `ImmersivePortal`, set `PortalPair` attribute to the same string on both, optionally set `PortalFace` to a `NormalId`. Done.
