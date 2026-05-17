# Implementation Plan

Phased build of `@rbxts/immersive-portals`. Phases are gated — finish one before starting the next; let real consumer pain in Shrink/Grow SIMULATOR (the proving ground) drive Phase N+1's scope.

## Phase 0 — Scaffolding ✅

- Project scaffolded from `@rbxts/navigate` (build config, release workflow, tsconfig, LICENSE)
- Public types declared in `src/types.ts`
- Architecture committed to `CLAUDE.md`

## Phase 1 — Layer 1: `PortalWindow`

The render primitive in isolation. No portal pairing, no teleportation.

**Deliverables:**
- `PortalWindow.new(adornee, normalId, config?)`
- `:render(viewerCFrame)` — perspective-correct camera projection
- `:setSkybox(sky | model | undefined)` — accepts `Sky` instance or pre-built `Model`
- `:cloneInto(model, callback?)` — clone a world model into the WorldFrame, strip scripts, build a real→clone lookup
- `:getAdornee()`, `:getSurfaceCFrame()`, `:getSurfaceSize()`
- `:destroy()` — Maid teardown, no leaks
- `util/skybox.ts` — port + simplify the current SkyboxModel construction
- `util/lighting.ts` — `snapshotLighting()` + `applyLightingToFrame()` helpers

**Acceptance:**
- Drop a single `PortalWindow` on a Part in Shrink/Grow SIMULATOR. It shows a clone of a chosen Model with the player's correct perspective. No teleportation. No partner window.
- Destroy it; verify zero leaked Instances via `:GetDescendants()` count on the SurfaceGui's adornee.

## Phase 2 — Layer 2: `Portal`

Pair two windows + teleportation.

**Deliverables:**
- `Portal.new(partA, partB, config?)`
- Internally constructs two `PortalWindow`s facing each other
- Mirrors viewer CFrame through each portal plane each frame; drives `:render` on each window
- Optional `setViewer(humanoid | camera)` — enables teleportation
- Plane-crossing detection with debounce
- Camera-mirror when viewer's camera straddles the portal plane (the "see yourself through the back" effect)
- Signals: `entered`, `exited`, `teleported(from: Vector3, to: Vector3)`
- `util/mirror.ts` — `mirrorCFrameAcrossPair(cf, planeA, planeB, yawFlip)`, `mirrorVectorAcrossPlane(v, plane)`

**Acceptance:**
- Replace the current `Portal` ModuleScript in Shrink/Grow SIMULATOR with this library
- Visual parity (or better) with the existing system
- Confirmed leak-free across 10× create/destroy cycles
- `Lighting.Sky` is never reparented by the library

## Phase 3 — Layer 3: `PortalGroup`

Bulk coordination.

**Deliverables:**
- `PortalGroup.new(config?)`
- Auto-discovery via CollectionService tag + pairing attribute
- One shared `RenderStepped` callback that drives all owned portals
- `:addPortal(portal)`, `:removePortal(portal)`, `:attachWorld(model)`, `:setViewer(...)`, `:getStats()`
- Late-added/removed portals handled gracefully (CollectionService `:GetInstanceAddedSignal`)

**Acceptance:**
- A map authored entirely in Studio (no per-portal code) with 4+ portal pairs all working from a single tag.

## Phase 4 — Polish + Public Release

- README with usage examples + lighting-tech limitations call-out
- Test the full pipeline in a published build
- Tag `v0.1.0` → release workflow publishes `@rbxts/immersive-portals` to npm
- Update the navigate-style memory entry so future Claude knows this exists

## Deferred / Open Questions

- **Atmosphere/Clouds in viewports** — currently no Roblox-supported way to render these inside `ViewportFrame`. Document as a known limitation. Revisit if Roblox ships a fix.
- **Server-authoritative teleportation** — out of scope for v0.1. Library will fire client-side `teleported` signal; consumers can wire RemoteEvents themselves. May add an opt-in helper later.
- **Performance scaling** — how many concurrent portals before we need a "render only N nearest" budget? TBD from real usage.
- **Custom shaders / refraction** — not currently possible without engine changes. Out of scope.
- **Mobile camera input** — current `Portal:OnAfterCameraStep` reads `cameraModule.activeOcclusionModule` which assumes a PC-style camera. Library must work without that hook.
