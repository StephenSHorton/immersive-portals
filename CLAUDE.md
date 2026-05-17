# CLAUDE.md

## Project Overview

**@rbxts/immersive-portals** is a TypeScript-native library for roblox-ts that renders perspective-correct portal windows between paired surfaces in a Roblox world. Built on `ViewportFrame` with manual skybox proxies and seamless teleportation.

## Commands

```bash
bun install        # Install dependencies
bun run build      # Compile TypeScript to Luau
bun run watch      # Watch mode
```

After building, compiled output is in `out/`. Consumer projects link via a junction to `out/`.

**Important:** Rojo does not detect file changes through Windows junctions. After rebuilding this package, restart Rojo in the consuming project for changes to take effect.

## Status

Scaffolded from `@rbxts/navigate`. Library code TBD.

## roblox-ts Constraints

- **No getters/setters** — use explicit methods (`getStatus()`, `setVisualize()`)
- **`next` and `local` are reserved** — use `following`, `upcoming`, `offsetVec`, etc.
- **`index.ts` compiles to `init.luau`** — entry point for the package
