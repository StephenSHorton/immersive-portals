# Implementation Plan

Phased build of `@rbxts/immersive-portals`. Phases are gated — finish one before starting the next; let real consumer pain in Shrink/Grow SIMULATOR (the proving ground) drive Phase N+1's scope.

## Phase 0 — Scaffolding ✅

- Project scaffolded from `@rbxts/navigate` (build config, release workflow, tsconfig, LICENSE)
- Public types declared in `src/types.ts`
- Architecture committed to `CLAUDE.md`

## Phase 1 — Layer 1: `PortalWindow` ✅

Implemented in `src/window/PortalWindow.ts`. `cloneInto`, `setSkybox`, `render`, `refreshLighting`, `destroy`. Surface info computed from adornee + face. Supporting utils: `util/skybox.ts`, `util/lighting.ts`.

## Phase 2 — Layer 2: `Portal` ✅

Implemented in `src/portal/Portal.ts`. Owns two windows, drives mirror+teleport+render loop. Signals: `entered`, `exited`, `teleported`. `bind()/unbind()` for self-managed RenderStep, `update(camCF, focusCF)` for external orchestration. Supporting util: `util/mirror.ts` (rayPlane, segmentCrossesRect, mirrorCFrameForCamera, mirrorCFrameForTeleport).

## Phase 3 — Layer 3: `PortalGroup` ✅

Implemented in `src/portal/PortalGroup.ts`. Single shared RenderStep across owned portals. CollectionService auto-discovery via tag + pair attribute. `getStats()`.

## Phase 4 — Polish + Public Release

- [x] README with usage examples + lighting limitations
- [ ] Verify the full pipeline by loading into Shrink/Grow SIMULATOR (or a fresh test project) and exercising both `Portal` and `PortalGroup`
- [ ] Tag `v0.1.0` once verified → release workflow publishes `@rbxts/immersive-portals` to npm
- [ ] Update memory entry once shipped

## Deferred / Open Questions

- **Atmosphere/Clouds in viewports** — currently no Roblox-supported way to render these inside `ViewportFrame`. Document as a known limitation. Revisit if Roblox ships a fix.
- **Server-authoritative teleportation** — out of scope for v0.1. Library will fire client-side `teleported` signal; consumers can wire RemoteEvents themselves. May add an opt-in helper later.
- **Performance scaling** — how many concurrent portals before we need a "render only N nearest" budget? TBD from real usage.
- **Custom shaders / refraction** — not currently possible without engine changes. Out of scope.
- **Mobile camera input** — current `Portal:OnAfterCameraStep` reads `cameraModule.activeOcclusionModule` which assumes a PC-style camera. Library must work without that hook.
