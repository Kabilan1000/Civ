# LITTLE WORLDS

Autonomous 2D civilization simulator for the browser.
Stack: Vite + React + TypeScript, PixiJS v8 (rendering), Vitest (tests), localStorage (saves).

Full design: `docs/ARCHITECTURE.md` — read it before structural changes and keep it in sync.

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest (engine tests, Node environment)
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run typecheck` / `npm run lint` — types only / oxlint

## Architecture rules (non-negotiable)

1. **`src/sim/` is pure TypeScript.** No imports from React, PixiJS, `app/`, `render/`, `ui/`, `persistence/`. No `window`, `document`, `localStorage`, `Math.random`, `Date`, `performance`, `crypto`. `tsconfig.sim.json` (no DOM/Node types) and `src/sim/__tests__/architecture.test.ts` enforce this.
2. **Deterministic.** All randomness via `sim/rng.ts`; RNG state lives in `WorldState`. Same seed + same ticks ⇒ identical `serialize()` output. Iterate in stable order; break ties explicitly (score, then id/tile index). Avoid `Math.sin/cos/exp/pow` in sim logic.
3. **Tick-based.** `step(state)` advances exactly one tick through the fixed system order in `world.ts`. No logic depends on real time. Tick 0 = day 1, 06:00; `step` increments `tick` first; day N starts at tick `(N-1)*240` (see `sim/systems/time.ts`).
4. **State is plain JSON.** No classes, `Map`/`Set`, functions or cycles in `WorldState`. Reference entities by numeric id. Bump `schemaVersion` and add a migration when the shape changes.
5. **No teleporting.** Citizens move one 4-neighbour tile at a time along A* paths, with per-terrain step costs.
6. **Utility AI.** Each action in `sim/ai/actions/` exports `score(ctx)` + `start(ctx)`; scores combine response curves × role × personality × demand × distance. Keep intention persistence (`SWITCH_MARGIN`) and store `lastScores` for the inspector.
7. **One-way data flow.** Renderer and UI read state; only `SimulationController` calls `step`, restart and load. UI-only state (selection, panels) stays in React.
8. **No external AI/network calls** in the MVP.
9. **Tuning numbers live in `sim/constants.ts`**, not inline.
10. **Event text is formatted in the UI**; sim events are structured data.
11. **Bump `map.version`** whenever terrain, resources or `discovered` change — the renderer only re-bakes the map when it does.
12. **Other layers import the sim only via `src/sim/index.ts`.** `render/` never imports React. One rAF loop (the `SimulationController`) drives simulation and rendering.
13. **Resources are conserved.** Move whole units only and record gathering, regrowth, eating and losses in `state.ledger`; wood held by structures counts too. The conservation test checks every tick. Citizens act only on discovered, reachable tiles.
14. **Shelters are solid.** Path and step checks use `structures.walkableFor`; site selection must never cut off tiles reachable from the campfire.
15. **Rendering: no full-screen overlays.** Use container tints, baked layers and small sprites; measure frame time in the browser after visual changes.
16. **Derived caches** (walk mask, frontiers) are allowed in `sim/` only if keyed on every input they depend on and never stored in `WorldState`; results must be identical without them.
17. **Memories record only real events**, written where the event happens. Social interactions require both participants alive and within `INTERACT_RADIUS`; nobody waits for an absent partner.
18. **Persistence stays outside `src/sim/`.** Saves go through `persistence/SaveStore` (result objects, never throws); a world is only swapped in via `SimulationController.loadWorld` after full validation. Browser timestamps live in save metadata, never in `WorldState`.

## Working style

- Work milestone by milestone (see `docs/ARCHITECTURE.md` §12). Keep each change small and independently verifiable.
- Every engine change ships with Vitest tests. Co-locate tests as `*.test.ts`; cross-cutting tests (determinism, save/resume, invariants, architecture, perf) live in `src/sim/__tests__/`.
- Before committing: `npm test` and `npm run build` must pass.
- Performance budget: `step()` ≤ 1 ms avg for 12 citizens; React updates ≤ 5 Hz; terrain baked once and re-baked only when `map.version` changes.
- Prefer simple, readable code over cleverness; no new dependencies without a clear reason.
