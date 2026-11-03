# LITTLE WORLDS — Architecture Plan

An autonomous 2D civilization simulator for the browser. A small colony of
citizens lives on a procedurally generated island, gathers food and wood,
builds shelters, rests, forms relationships and remembers what happened to
them. The player watches, inspects, controls time and saves worlds; they do not
steer citizens directly.

Stack: Vite · React · TypeScript · PixiJS (v8) · Vitest · localStorage.

---

## 1. Guiding principles

1. **The simulation is a pure TypeScript library.** `src/sim` has no knowledge
   of React, PixiJS, the DOM, wall-clock time or storage. It could run in Node,
   a Web Worker or a test with no changes.
2. **Deterministic and tick-based.** `step(state)` advances exactly one tick.
   The same seed + the same number of ticks always produces the identical state,
   byte for byte when serialized.
3. **State is plain data.** `WorldState` is JSON-serializable: no classes,
   `Map`, `Set`, functions, `undefined`-dependent logic or circular references.
   The RNG state lives *inside* `WorldState`, so a saved world resumes exactly.
4. **One-way data flow.** Sim → (read-only) → renderer and UI. The UI never
   mutates sim state; it only calls controller methods (pause, speed, restart,
   load).
5. **Small, verifiable milestones.** Each milestone ends with passing tests
   and/or something visible in the browser.

---

## 2. Layering

```
┌──────────────────────────────────────────────────────────────┐
│ ui/  (React)        Controls · Dashboard · Inspector · Feed  │
│        ▲ throttled snapshots (≈5 Hz) via useSyncExternalStore│
├────────┼─────────────────────────────────────────────────────┤
│ app/   SimulationController  — rAF loop, fixed timestep,     │
│        pause/speed, restart(seed), save/load, subscriptions  │
├────────┼──────────────────────────────┬──────────────────────┤
│ render/ PixiRenderer (reads state     │ persistence/         │
│         every frame, never writes)    │ localStorage slots   │
├───────────────────────────────────────┴──────────────────────┤
│ sim/   createWorld · step · selectors · serialize            │
│        (pure TS, deterministic, no platform APIs)            │
└──────────────────────────────────────────────────────────────┘
```

Allowed imports (enforced by an architecture test, see §9):

| Layer          | May import                          |
| -------------- | ----------------------------------- |
| `sim/`         | `sim/` only                         |
| `render/`      | `sim/` (types, selectors), `pixi.js`|
| `persistence/` | `sim/` (serialize)                  |
| `app/`         | `sim/`, `render/`, `persistence/`   |
| `ui/`          | `app/`, `sim/` (types, selectors)   |

---

## 3. Simulation engine

### 3.1 Time

- `1 tick = 6 in-game minutes`; `TICKS_PER_DAY = 240`.
- **Tick zero:** `createWorld` returns a world at `tick = 0` = day 1, 06:00
  (dawn). No tick has been simulated yet; tick 0 emits `worldCreated`.
- **Stepping:** `step()` increments `tick` *first*, then runs the other
  systems, so every system in a step sees the tick being simulated (1, 2, …).
- **Day boundaries:** days begin at dawn. Day N starts at tick `(N-1) * 240`
  (always 06:00). When a step lands on a multiple of 240, a `dayStarted`
  event is emitted with the new day number.
- Day phases by tick-of-day: dawn `0–19` (06:00), day `20–139` (08:00),
  dusk `140–169` (20:00), night `170–239` (23:00–06:00, ≈29% of the day).
- Speeds: base rate **5 ticks/s**; 1x = 5, 3x = 15, 10x = 50 ticks/s.

### 3.2 Determinism rules

- All randomness comes from `rng.ts` (sfc32 seeded by a string hash). The four
  uint32 words of RNG state are stored in `WorldState.rng`.
- No `Math.random`, `Date`, `performance.now`, `crypto` in `sim/`.
- Iterate collections in a stable order (arrays, sorted by id). When object keys
  are iterated, sort them first.
- Restrict maths to `+ - * /`, `Math.floor/round/ceil/min/max/abs/sqrt`
  (IEEE-exact). Avoid `Math.sin/cos/exp/pow` in sim logic — results can differ
  between JS engines and break save portability.
- Ties are broken explicitly (by score, then by id / tile index).

### 3.3 Engine API (`sim/index.ts`)

```ts
createWorld(config: WorldConfig): WorldState   // seed → full initial state
step(state: WorldState): void                   // advance one tick, mutates in place
stepN(state: WorldState, n: number): void
serialize(state: WorldState): string
deserialize(json: string): WorldState           // validates + migrates
// selectors.ts — pure read-only helpers for UI/renderer
getCitizen, getCivStats, getDayPhase, getRecentEvents, ...
```

`step` mutates in place for performance (no per-tick allocation of the whole
world). Consumers that need an immutable copy use `structuredClone` or the
selector outputs.

### 3.4 Tick pipeline

Each tick runs systems in a fixed order:

1. **time** — `tick++`, compute day phase.
2. **needs** — decay satiety/energy/social at role/personality-adjusted rates.
3. **health** — damage when starving or exhausted, slow regen when well; death
   at 0 health.
4. **resources** — regrow berries/trees (every 10 ticks).
5. **decide** — citizens whose decision is due choose an action (utility AI).
6. **act** — advance each citizen's current task: movement step or work step.
7. **social** — resolve conversations between adjacent citizens.
8. **stats** — sample civilization metrics (every 24 ticks) for the dashboard.

### 3.5 Map

- 36 × 24 tiles, stored as a flat array indexed `y * width + x`.
- Generation: seeded 2D value noise for elevation and moisture (own
  implementation, polynomial smoothstep only) → terrain: `water`, `sand`,
  `grass`, `forest`, `rock`.
- Resource nodes: berry bushes on grass, trees in forest, each with
  `amount`/`max` and regrowth.
- Validation after generation: flood fill from the spawn tile; the largest
  passable region must hold the spawn, ≥ N berry tiles and ≥ M tree tiles.
  Otherwise regenerate with a derived seed (bounded retries, deterministic).
- `discovered` mask (fog of war): starts as a radius around spawn; explorers
  reveal more. Foragers/choppers only target discovered tiles.

### 3.6 Movement & pathfinding

- 4-directional grid movement; `water` and `rock` are impassable.
- Integer step costs: grass 2, sand 3, forest 3 (cost = ticks to cross).
- A* with a binary heap, Manhattan heuristic, deterministic tie-breaking
  (f, then h, then tile index), and an expansion cap.
- A citizen moves **one adjacent tile at a time**: `path` + `pathIndex` +
  `moveTicksLeft`. Never teleports. If the next tile becomes invalid, it
  repaths. The renderer interpolates between `pos` and the next path node using
  `moveTicksLeft` for smooth motion.
- Citizens may share tiles (no collision in MVP).

### 3.7 Utility AI

Each decision:

1. Build candidate actions: `eat`, `forage`, `chop`, `build`, `rest`,
   `socialize`, `explore`, `wander`.
2. Each action scores in `[0, 1]` as the **product of considerations**, each a
   response curve over an input (e.g. `1 - satiety/100`, distance to target,
   night-time, stockpile shortage). Products are compensated for consideration
   count so actions with more factors aren't penalised.
3. Multiply by **role weight** (forager → forage, builder → build/chop,
   explorer → explore) and **personality modifiers** (sociability → socialize,
   diligence → work, curiosity → explore).
4. Add **inertia** to the current action (hysteresis prevents flip-flopping) and
   small seeded jitter for variety.
5. Pick the highest score; ties by action order.

Re-evaluation happens when a task completes or fails, every
`DECISION_INTERVAL` ticks (staggered by citizen id), or immediately when a need
drops below a critical threshold. Each action module exports
`score(ctx)` and `start(ctx)`; the task executor advances its phases.

Tasks are serializable phase machines, e.g. forage:
`moveTo(berryTile) → gather(n ticks) → moveTo(stockpile) → deposit`.

Debug: the last decision's top scores are stored on the citizen
(`lastScores`) so the inspector can explain *why* a citizen is doing something.

### 3.8 Economy & construction

- A **campfire/stockpile** is placed at spawn: the colony's shared food and
  wood store and the default social and sleeping spot.
- Citizens carry one load at a time (`carrying`), deposited at the stockpile.
- **Shelters**: when there are homeless citizens and stockpile wood ≥ cost, a
  builder places a construction site near the campfire, hauls wood and adds
  build progress. A complete shelter houses up to 3 citizens. Resting in a home
  restores energy faster than sleeping rough.

### 3.9 Social: relationships & memory

- `relationships[otherId] = { affinity: -100..100, familiarity: 0..100,
  lastInteractionTick }`.
- Interactions between adjacent citizens: **chat** (+affinity, +social),
  **share food** (hungry partner, giver has food), **argue** (more likely when
  needs are low; −affinity). The outcome is a weighted, seeded roll influenced by
  personality and current affinity.
- `socialize` targets prefer high-affinity, nearby citizens.
- **Memory**: a capped (20) list of `{ tick, kind, subjectId?, tile?, valence }`
  entries — found food at X, argued with Y, built a shelter, saw Z die. Memory
  biases decisions (remembered resource tiles; avoiding disliked citizens) and
  is shown in the inspector. Oldest / least salient entries are evicted first.

### 3.10 Events

Structured events (`{ id, tick, kind, citizenIds, data }`) appended to a ring
buffer (cap 200) in state. Text is formatted in the UI (`ui/format/`), keeping
state small and the sim free of presentation.

---

## 4. Data model (`sim/types.ts`)

```ts
type TileIndex = number;            // y * width + x
interface Point { x: number; y: number }

type Terrain = 'water' | 'sand' | 'grass' | 'forest' | 'rock';
type ResourceKind = 'berries' | 'wood';
type Role = 'forager' | 'builder' | 'explorer';

interface ResourceNode { kind: ResourceKind; amount: number; max: number }

interface TileMap {
  width: number;                   // 36
  height: number;                  // 24
  terrain: Terrain[];
  resources: (ResourceNode | null)[];
  discovered: (0 | 1)[];
  version: number;                 // bump on any change → renderer dirty flag
}

interface Personality {           // each 0..1
  sociability: number;
  diligence: number;
  curiosity: number;
  resilience: number;              // slows health loss / mood swings
}

interface Needs {                  // each 0..100, 100 = fully satisfied
  satiety: number;                 // shown as "Hunger" in UI (inverted)
  energy: number;
  social: number;
  health: number;
}

type ActionKind =
  | 'eat' | 'forage' | 'chop' | 'build' | 'rest'
  | 'socialize' | 'explore' | 'wander' | 'idle';

interface Task {
  kind: ActionKind;
  phase: string;                   // action-specific phase name
  targetTile: TileIndex | null;
  targetId: number | null;         // citizen or structure id
  ticksLeft: number;
  startedTick: number;
}

interface Relationship { affinity: number; familiarity: number; lastTick: number }

type MemoryKind =
  | 'foundResource' | 'resourceDepleted' | 'chat' | 'argument'
  | 'receivedFood' | 'builtShelter' | 'sawDeath' | 'discovered';
interface Memory {
  tick: number; kind: MemoryKind;
  subjectId?: number; tile?: TileIndex; valence: number; // -1..1
}

interface Citizen {
  id: number;
  name: string;
  role: Role;
  personality: Personality;
  needs: Needs;
  pos: Point;                      // current tile
  path: TileIndex[];
  pathIndex: number;
  moveTicksLeft: number;
  task: Task | null;
  nextDecisionTick: number;
  carrying: { kind: ResourceKind; amount: number } | null;
  homeId: number | null;
  relationships: Record<string, Relationship>; // key = other citizen id
  memories: Memory[];
  lastScores: { kind: ActionKind; score: number }[];
  alive: boolean;
  diedTick: number | null;
}

type StructureKind = 'campfire' | 'shelter';
interface Structure {
  id: number;
  kind: StructureKind;
  tile: TileIndex;
  buildProgress: number;           // 0..buildCost
  buildCost: number;
  woodDelivered: number;
  complete: boolean;
  residentIds: number[];
}

type SimEventKind =
  | 'worldCreated' | 'shelterStarted' | 'shelterCompleted' | 'chat'
  | 'argument' | 'sharedFood' | 'discovered' | 'starving' | 'died'
  | 'friendship' | 'rivalry' | 'dayStarted';
interface SimEvent {
  id: number; tick: number; kind: SimEventKind;
  citizenIds: number[]; data?: Record<string, number | string>;
}

// Civilization stats (day, population, housed, food, wood, avgNeeds) are
// DERIVED by selectors.getCivStats(), not stored, so they can never go stale.
// The dashboard history series is added to state with the stats system (M7)
// together with a schema migration.

interface WorldConfig {
  seed: string;
  width: number;                   // default 36
  height: number;                  // default 24
  citizenCount: number;            // default 12
}

interface WorldState {
  schemaVersion: 1;
  config: WorldConfig;
  tick: number;
  rng: [number, number, number, number];
  nextId: number;
  map: TileMap;
  citizens: Citizen[];             // sorted by id; dead citizens kept (alive=false)
  structures: Structure[];
  stockpile: { food: number; wood: number };
  events: SimEvent[];              // ring buffer, cap 200
}
```

Tuning numbers (decay rates, costs, thresholds, curve parameters) live in
`sim/constants.ts`, never inlined.

---

## 5. App layer

`SimulationController` (plain class, no React):

- Holds `state`, `paused`, `speed`.
- `requestAnimationFrame` loop with a **fixed-timestep accumulator**: converts
  elapsed real time into whole ticks at the current speed, capped at
  `MAX_TICKS_PER_FRAME` to avoid a spiral of death after tab switches.
- Calls `renderer.render(state, alpha)` every frame.
- Notifies subscribers at most ~5 Hz (and on pause/load/restart) by bumping a
  snapshot version; React reads via `useSyncExternalStore` + selectors.
- `restart(seed)`, `save(slot)`, `load(slot)`, `setSpeed(1|3|10)`, `togglePause()`.

UI-only state (selected citizen, open panels) lives in React, not in the sim.

## 6. Rendering (PixiJS v8)

- 24 px tiles → 864 × 576 canvas, scaled to fit with CSS.
- Layers (containers): terrain (baked once into a texture; re-baked when
  `map.version` changes), resources, structures, fog, citizens, selection/overlay.
- Procedural shapes (Graphics) only in MVP — no asset pipeline.
- Citizens: coloured by role, positions interpolated between tiles; small icon
  for current task; night tint over the scene from day phase.
- Click → tile → topmost citizen → `onSelectCitizen(id)` callback to React.
- Renderer owns Pixi objects keyed by entity id and reconciles each frame
  (create/update/destroy), never stores sim data of its own.

## 7. UI (React)

- **Controls**: pause/resume, 1x/3x/10x, seed input + restart, save/load slots.
- **Dashboard**: day & time, population, housed, food/wood, average needs,
  small history sparkline.
- **Citizen inspector**: name, role, personality bars, needs bars, current task
  and *why* (`lastScores`), carrying, home, relationships (sorted), memories.
- **Event feed**: newest first, click a citizen name to inspect.

## 8. Persistence

```ts
interface SaveFile {
  format: 'little-worlds-save';
  schemaVersion: number;
  savedAt: string;          // set by app layer, not sim
  state: WorldState;
}
```

- localStorage keys: `little-worlds:save:<slot>` (3 slots + autosave).
- `deserialize` validates shape and runs `migrations[schemaVersion]` stepwise.
- Corrupt/unknown saves fail gracefully with a UI message; never crash.
- Expected save size: well under 200 KB.

## 9. Testing strategy (Vitest, Node environment)

Engine tests live next to the code (`src/sim/**/*.test.ts`).

| Area           | Tests |
| -------------- | ----- |
| RNG            | same seed → same sequence; state round-trips; range bounds |
| Map gen        | deterministic per seed; correct size; spawn connected; resource minimums across 50 seeds |
| Pathfinding    | optimal paths on hand-built grids; avoids water/rock; unreachable → null; deterministic ties |
| Movement       | every tick a citizen stays or moves to a 4-neighbour (no teleport); never on impassable tile |
| Needs/health   | decay rates; starvation damages health; death at 0 |
| Utility AI     | hungry → eat/forage; exhausted at night → rest; role weights shift choices |
| Economy        | gathering moves resources map → carried → stockpile with conservation |
| Construction   | shelter completes given wood; residents assigned; capacity respected |
| Social         | interactions change affinity symmetrically-ish; memory cap enforced |
| **Determinism**| two runs × 5000 ticks, same seed → identical `serialize()` output; different seeds differ |
| **Save/resume**| run 1000 → serialize → deserialize → run 1000 equals run 2000 straight |
| Invariants     | needs in range, no negative stock, ids unique, events capped — checked every tick in a soak run |
| Architecture   | scan `src/sim` for forbidden imports/APIs (`react`, `pixi`, `window`, `document`, `localStorage`, `Math.random`, `Date`) |
| Performance    | 10 000 ticks of a default world in < 2 s in Node (soft budget) |
| Balance        | across 20 seeds, ≥ 75% of citizens alive after 10 days on average |

## 10. Performance budget

- `step()` ≤ 1 ms average for 12 citizens (10x speed = 50 ticks/s ⇒ ≤ 5% of a frame budget per second).
- No whole-state cloning per tick; A* only on decision/repath, not every tick.
- React re-renders ≤ 5 Hz; Pixi updates only dynamic layers each frame.
- If needed later, the sim can move to a Web Worker unchanged (it's pure).

---

## 11. File structure

```
little-worlds/
├── CLAUDE.md
├── docs/ARCHITECTURE.md
├── index.html
├── package.json · vite.config.ts (vitest config inside)
├── tsconfig.json            # references app / sim / test / node projects
├── tsconfig.sim.json        # src/sim checked with no DOM or Node types
└── src/
    ├── main.tsx
    ├── sim/                         # pure, deterministic engine
    │   ├── index.ts                 # public API barrel
    │   ├── types.ts
    │   ├── constants.ts             # all tuning values
    │   ├── config.ts                # WorldConfig defaults
    │   ├── rng.ts
    │   ├── world.ts                 # createWorld, step, stepN
    │   ├── serialize.ts             # serialize/deserialize, validate, migrations
    │   ├── selectors.ts
    │   ├── events.ts                # pushEvent (ring buffer)
    │   ├── grid.ts                  # index/point helpers, neighbours, passability, cost
    │   ├── ids.ts                   # allocateId (single shared id counter)
    │   ├── map/
    │   │   ├── placeholder.ts       # M1 grass + water-border map, revealAround (replaced in M2)
    │   │   ├── noise.ts
    │   │   └── generate.ts
    │   ├── path/
    │   │   ├── heap.ts
    │   │   └── astar.ts
    │   ├── citizens/
    │   │   ├── names.ts
    │   │   ├── create.ts
    │   │   ├── memory.ts
    │   │   └── relationships.ts
    │   ├── ai/
    │   │   ├── curves.ts            # response curves
    │   │   ├── utility.ts           # scoring framework
    │   │   ├── decide.ts
    │   │   └── actions/             # one module per action: score + start + phases
    │   │       ├── eat.ts  forage.ts  chop.ts  build.ts
    │   │       └── rest.ts socialize.ts explore.ts wander.ts
    │   ├── systems/
    │   │   ├── time.ts  needs.ts  health.ts  resources.ts
    │   │   └── tasks.ts movement.ts social.ts stats.ts
    │   └── __tests__/               # cross-cutting tests (determinism, invariants, arch, perf)
    ├── app/
    │   ├── SimulationController.ts
    │   └── useSimulation.ts
    ├── render/
    │   ├── PixiRenderer.ts
    │   ├── palette.ts
    │   └── layers/
    │       ├── terrainLayer.ts resourceLayer.ts structureLayer.ts
    │       └── fogLayer.ts citizenLayer.ts overlayLayer.ts
    ├── persistence/
    │   └── storage.ts
    └── ui/
        ├── App.tsx
        ├── styles.css
        ├── format/eventText.ts
        └── components/
            ├── MapView.tsx  Controls.tsx  Dashboard.tsx
            └── CitizenInspector.tsx  EventFeed.tsx
```

---

## 12. Milestones

Each milestone is merged only when its "done when" holds and `npm test`,
`npm run build` and `npm run lint` (typecheck) pass.

| # | Milestone | Done when |
| - | --------- | --------- |
| **M0** | **Scaffold** — Vite react-ts, `pixi.js`, `vitest`; scripts `dev/build/test/typecheck`; folder skeleton; architecture test. | App boots to a blank page; `npm test` runs the architecture test green. |
| **M1** | **Core engine** — types, constants, seeded RNG, `createWorld` (flat map placeholder, 12 citizens with names/roles/personalities), `step` with time system, events ring buffer, serialize/deserialize. | Determinism + save/resume tests pass; RNG tests pass. |
| **M2** | **Map & pathfinding** — noise map gen with validation, resources, discovered mask, A*. | Map gen tests across 50 seeds; A* tests; perf of A* on full map < 1 ms. |
| **M3** | **Render shell & loop** — `SimulationController`, Pixi terrain/resources/citizens, citizens `wander` via real paths, pause/resume, 1x/3x/10x. | Visible smooth tile-by-tile movement; no-teleport invariant test passes. |
| **M4** | **Needs & utility AI** — needs decay, health, utility framework, `eat`, `forage`, `chop`, `rest`, `wander`; stockpile; carrying. | AI choice tests; resource conservation test; colony survives 3 days on most seeds. |
| **M5** | **Shelter & day/night** — construction sites, building, housing, home rest bonus, night tint, death. | Construction tests; shelters appear over a few days in the browser. |
| **M6** | **Social, memory & exploration** — relationships, interactions, memory, `socialize`, `explore`, fog reveal. | Social & memory tests; explorers expand the discovered area. |
| **M7** | **UI** — dashboard, citizen inspector (incl. decision scores), event feed, click-to-select. | All panels live-update at ≤ 5 Hz without frame drops at 10x. |
| **M8** | **Persistence & restart** — save slots, autosave, load, restart with seed, migrations scaffold, error handling. | Save → reload page → load resumes identical world; corrupt save handled. |
| **M9** | **Balance & polish** — tune constants, balance test across seeds, soak/invariant test, perf pass. | Balance + perf tests pass; 30-minute 10x soak has no errors. |

### Out of scope for the MVP

Births/ageing, player commands, combat, trading, multiple settlements, map
sizes beyond config, Web Worker sim, sprites/art assets, external AI APIs.
