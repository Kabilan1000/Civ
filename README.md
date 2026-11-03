# Little Worlds

An autonomous 2D civilization simulator for the browser. A small colony of
citizens gathers food and wood, builds shelters, rests, forms relationships and
remembers what happened to them — you watch, inspect and control time.

**Status:** Milestone M0 (project scaffold). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the design and milestone plan, and [`CLAUDE.md`](CLAUDE.md) for project rules.

## Requirements

- Node.js 20.19+ or 22.12+ (developed on Node 22)
- npm 10+

## Setup

```bash
npm install
```

## Scripts

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Start the Vite dev server (http://localhost:5173)  |
| `npm run build`      | Type-check all projects, then build to `dist/`     |
| `npm run preview`    | Serve the production build locally                 |
| `npm test`           | Run the Vitest suite once (Node environment)       |
| `npm run test:watch` | Run Vitest in watch mode                           |
| `npm run typecheck`  | Type-check only (`tsc -b`)                         |
| `npm run lint`       | Lint with oxlint                                   |

## Project layout

```
src/
  sim/          Pure, deterministic simulation engine (no DOM, React or PixiJS)
  app/          SimulationController: game loop, speed, save/load glue
  render/       PixiJS renderer (reads sim state, never writes it)
  persistence/  localStorage save slots
  ui/           React components
docs/           Architecture and design notes
```

TypeScript runs in strict mode. `src/sim` is additionally type-checked against a
DOM-free config (`tsconfig.sim.json`), and an architecture test
(`src/sim/__tests__/architecture.test.ts`) rejects forbidden imports and
non-deterministic APIs such as `Math.random` and `Date`.
