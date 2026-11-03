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
| `ui/`          | `app/`, `sim/` (types, selectors), `render/` (MapView lazy-loads the renderer) |

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

Implemented so far (M7 — social and exploration run inside decide/act):
`time → needs (incl. health, death) → resources → construction → decide →
act → history` (`systems/time.ts`, `needs.ts`, `death.ts`,
`resources.ts`, `construction.ts`, `decide.ts`, `tasks.ts`). The other systems slot into the
positions above as their milestones land.

### 3.5 Map

- 36 × 24 tiles, stored as a flat array indexed `y * width + x`.
- **Own RNG:** attempt *k* is generated from a separate RNG seeded
  `"<seed>:map:<k>"`, not from `WorldState.rng`, so maps never change when
  citizen-creation code draws more or fewer random numbers.
- **Terrain:** seeded 2D value noise (lattice values from the RNG, bilinear +
  polynomial smoothstep) for elevation and moisture. Elevation falls off
  quadratically towards the edges to form an island. Terrain is assigned by
  elevation *rank*, so the mix is stable across seeds: lowest 30% water, next
  8% sand, top 5% rock; of the remaining land the wettest 35% is forest, the
  rest grass. The outer border is always water.
- **Campfire:** the grass tile closest to the map centre (Manhattan, ties by
  index) inside the largest connected land region, with at least
  `citizenCount` spawn tiles within `SPAWN_RADIUS` in its **start region**.
- **Start region:** tiles reachable from the campfire *without leaving the
  starting discovery radius*, i.e. walkable on initially discovered tiles
  only (citizens never walk in fog). Spawns and the guaranteed starting
  food/wood must lie in it. (M4 fix: M2 used plain reachability, which let a
  citizen spawn in a pocket connected to camp only through fog.)
- **Resources:** berries (max 6) on 10% of grass, trees (max 8 wood) on 55% of
  forest, one RNG draw per grass/forest tile in index order. Regrowth comes with
  the resources system (M4).
- **Validation & repair (deterministic):**
  1. Largest region < 30% of the map, or no valid campfire tile → next attempt
     (up to 12).
  2. Fewer than 6 berry / 3 tree tiles in the start region → plant berries
     on start-region grass, or turn start-region grass into forest with a
     tree, in seeded order.
  3. All attempts fail → fallback: carve a grass clearing around the centre
     (border stays water). This always validates. If even that can't fit the
     citizens, `createWorld` throws a clear error.
  `worldCreated` event data records `mapAttempt` (−1 = fallback) and
  `mapRepairs`. In sampling, 500 of 500 seeds passed on attempt 0.
- `discovered` mask (fog of war): starts as a radius of 6 around the campfire,
  which always contains reachable food and wood. Explorers reveal more.
  Foragers/choppers only target discovered tiles.

### 3.6 Movement & pathfinding

- 4-directional grid movement; `water` and `rock` are impassable.
- Integer step costs: grass 2, sand 3, forest 3 (cost = ticks to cross).
- A* (`path/astar.ts`) with a binary heap, Manhattan heuristic × the cheapest
  step cost (admissible, so paths are cost-optimal), neighbours in fixed
  N, E, S, W order, deterministic tie-breaking (f, then h, then tile index),
  and an optional `maxExpansions` cap.
- **Path-return convention:** `findPath(map, start, goal)` returns the tiles to
  step onto, **excluding `start` and including `goal`**; `[]` if
  `start === goal`; `null` if either endpoint is invalid or impassable, the
  goal is unreachable, or the cap was hit. Path cost = sum of `stepCost` of
  the path's tiles.
- `path/flood.ts`: reachability masks and region labelling for validation
  (and later for "can I get there at all?" checks).
- A citizen moves **one adjacent tile at a time** (`systems/movement.ts`):
  `path` (A* convention), `pathIndex` (next tile to enter) and
  `moveTicksLeft` (ticks until entering it). Entering a tile takes its step
  cost in ticks. Before every step the next tile must still be passable and a
  4-neighbour; otherwise the path is dropped and the task ends (the next
  decision plans afresh). Paths are planned once when a task starts, never
  recomputed mid-walk.
- `getVisualPosition(state, citizen, alpha)` interpolates between `pos` and
  the next path tile from step progress plus the controller's sub-tick
  `alpha`, for smooth motion.
- **Wander** (M3 placeholder behaviour, `ai/actions/wander.ts`): pick up to 8
  random tiles within Manhattan 7 that are passable and discovered, path to the
  first reachable one over *discovered tiles only* (`findPath` `canEnter`),
  walk, linger 4–16 ticks, repeat. If nothing is found, retry in 5 ticks.
  Task phases: `moveTo → linger`.
- Citizens may share tiles (no collision in MVP).

### 3.7 Needs (M4, `systems/needs.ts`)

All needs are 0..100, 100 = satisfied (the UI shows satiety inverted as
"Hunger"), clamped every tick. Rates are per tick (`constants.ts`), balanced
for a 240-tick day:

| Need    | Change per tick | Per day / notes |
| ------- | --------------- | --------------- |
| satiety | −0.2 | −48/day → ≈2 food (25 satiety each) per citizen per day |
| energy  | idle −0.2, walking −0.3, working (gather/construct) −0.4, sleeping outdoors +0.8, sleeping in own shelter +1.2 | awake drain ≈50/day, refilled by ≈65 ticks of sleep outdoors or ≈42 at home |
| social  | −0.12 alone, +0.4 with someone within 2 tiles | social *actions* come in M6 |
| health  | −0.15 at satiety 0, −0.1 at energy 0 (×(1 − 0.5·resilience)); +0.05 when satiety ≥ 40 and energy ≥ 25 | death at 0: a starving citizen (resilience 0) dies ≈667 ticks (2.8 days) after satiety hits 0 |

Activity comes from the task phase: `sleep` → resting, `gather` → working,
following a path → walking, otherwise idle.

### 3.8 Utility AI (M4, `ai/`)

**When:** a citizen decides at `nextDecisionTick` — the tick after a task ends,
otherwise every `DECISION_INTERVAL` (10) ticks while busy (staggered).

**Context** (`ai/context.ts`, one BFS per decision): step distances over
discovered tiles, campfire distance, nearest discovered, reachable, non-empty
berry bush and tree *not targeted by another citizen*, nearest rest spot
(within 2 of the campfire), night flag.

**Scores** (each in [0, 1], `ai/actions/*`, curves in `ai/curves.ts`):

| Action  | Score |
| ------- | ----- |
| eat     | `rising(hunger, 0.25, 0.85)` × access (1 if carrying berries, else distance factor to camp if stockpile has food; 0 = no food reachable). Hunger is judged at *arrival* (satiety minus the walk's expected decay, ≤ 10). Starving (< 15) ignores distance. Recent `sawDeath` memory: curve starts at 0.15. |
| rest    | 0 if energy ≥ 90; else `rising(tiredness, 0.1, 0.7)` + night bonus 0.35, tiredness judged at arrival in bed (walk cost ≤ 15 energy). ×0.6 when satiety < 40 and food is reachable (eat before bed), unless energy is critical. |
| share   | carrying berries, not hungry, a hungry (< 45) reachable neighbour: 0.9 × generosity × (0.4 + 0.6·their hunger) × distance (§3.10) |
| socialize | 0 if satiety/energy < 35 or on cooldown; rising(loneliness, 0.15, 0.8) × (0.6 + 0.6·sociability) × best partner factor, ×0.4 at night (§3.10) |
| explore | 0 unless satiety and energy ≥ 45; (0.25 + 0.3·curiosity) × role (explorer 1.6, others 0.3) × min(1, gain/20) × distance, ×1.15 after a recent discovery, ×0.3 at night (§3.12) |
| deliver | 0 if carrying nothing; else 0.25 + 0.55 × fullness (+0.1 if the village has no food). 0 for wood that a reachable planned site still needs (M9: that wood goes to the site — see the build/deliver loop fix in §3.9). |
| forage / chop | 0.5 × role × (0.8 + 0.4·diligence) × demand × distance factor × (1 − ½ fullness) × (½ at night). Demand rises from 0.15 with stockpile shortage (food: below 6 per citizen, or personal hunger; wood: below 40). |
| wander  | (0.1 + 0.08·curiosity) × role (explorer 1.5) — fallback |

Role weights: forager forage 1.3 / chop 0.5; builder forage 0.6 / chop 1.3;
explorer forage 0.8 / chop 0.7. A seeded jitter ≤ 0.02 is added to every
possible action (drawn in fixed order). Ties keep action order
`eat, rest, deliver, forage, chop, wander`.

**Hysteresis / intention persistence:** a running task is kept unless the best
alternative beats the task's own current score by `SWITCH_MARGIN` (0.2).
The margin is waived for eat/rest when that need is critical (satiety < 15,
energy < 25) or when its score is at maximum urgency (≥ 0.95 — scores are
capped at 1, so a 0.84 job could otherwise never be interrupted). Between
two survival tasks (eat ↔ rest) only a critical need the current task does
not address may cut in, so they never thrash. Talking, listening and giving
count as at least 0.6, so conversations finish unless something is urgent.
Interrupted citizens keep what they carry.

**Explainability:** every decision stores all six scores, best first, in
`citizen.lastScores`; the current intention is `citizen.task`.

**Tasks** are serializable phase machines: `moveTo` (A*, discovered tiles
only, planned once) → arrival phase (`ai/phases.ts`): `gather`, `deposit`,
`eat`, `sleep` or `linger`. See `systems/tasks.ts`.

### 3.9 Economy & construction

- A **campfire/stockpile** is placed at spawn: the colony's shared food and
  wood store and the default social and sleeping spot.
- **Inventory:** one load kind at a time (`carrying`): up to 6 berries or 4
  wood. Gathering takes 3 ticks per berry, 5 per wood; every unit taken bumps
  `map.version`.
- **Stockpile access:** depositing and eating from the stockpile only work
  within Manhattan 1 of the campfire. Eating uses carried berries first, one
  unit per 3 ticks, +25 satiety each, until satiety ≥ 90.
- **Regrowth** (`systems/resources.ts`): every 48 ticks each bush below max
  regrows 1 (5/day); every 480 ticks each tree regrows 1. Bushes hold 6,
  trees 8. Depleted nodes stay (bare bush / stump) and regrow.
- **Conservation:** all transfers move whole units, and `state.ledger`
  counts gathered, regrown and eaten units so that, at every tick,
  `map + carried + stockpile + eaten − regrown` is constant for food and
  `map + carried + stockpile − regrown` for wood (tested every tick).
- **Shelters** (M5, `systems/construction.ts`, `structures.ts`,
  `ai/actions/build.ts`):
  - **Cost:** 12 wood + 60 labour ticks; houses 3. Four shelters (48 wood)
    house the 12 starting citizens; with two builders on site, labour takes
    ≈30 ticks (3 h). In a 30-seed sweep all villages were fully housed by
    day 9, 26/30 by day 5.
  - **Stages:** `planned` (site chosen, waiting for wood) → `underConstruction`
    (all wood delivered; labour adds `buildProgress`) → `complete`.
  - **Planning:** every 10 ticks, if living citizens exceed shelter capacity
    (planned shelters included) and no shelter is unfinished, ONE site is
    planned on the valid tile with the shortest WALK from the campfire (BFS
    steps, at most `SITE_MAX_WALK_STEPS` = 12), then Manhattan, then index.
    (M9: Manhattan-first ordering picked a tile 3 tiles away but 23 steps
    round a rock ridge on one seed.)
  - **Valid sites:** discovered grass/sand/treeless forest with no resource
    node (bushes and trees — even depleted, they regrow), not another
    structure or an occupied tile, Manhattan 3–6 from the campfire, no other
    shelter in its 8 neighbours, and — critical-route rule — making the tile
    solid must not cut off anything reachable from the campfire.
  - **Solidity:** shelters block movement (A* and the per-step check), except
    a resident entering their own completed home. A site planned on someone's
    path makes that path "blocked" → the task ends and they replan.
  - **Build action:** `fetch` (at camp take `min(capacity, still-needed after
    wood in transit, stockpile)`) → carry on to a work tile next to the site
    → `supply` (site accepts at most what it still needs) → `construct`
    (+1 labour per worker per tick). At most 2 workers per site. Not offered
    for unreachable sites or when nothing can be done. Score: 0.55 × role
    (builder 1.4, explorer 0.5, forager 0.4) × diligence × distance × ½ at
    night; eat/rest still win when urgent (critical needs waive the switch
    margin).
  - **Wood demand:** the chop target becomes `20 + wood still needed for the
    open site + 12 per further shelter needed`, so builders keep chopping
    until everyone is housed.
  - **Interruptions & abandonment:** progress and delivered wood live on the
    site, so any builder resumes. A site with no delivery or labour for 480
    ticks is removed and its wood refunded to the stockpile.
- **Homes:** `assignHomes` runs when a shelter completes and when someone
  dies: living residents stay; free slots are filled by homeless living
  citizens in ascending id, shelters in ascending id. Rest targets the
  citizen's home when reachable (energy +1.2/tick inside), else a spot within
  2 of the campfire (+0.8/tick).
- **Death** (`systems/death.ts`): at health 0 the citizen dies of starvation
  (satiety 0) or exhaustion. They stay in `citizens` with `alive = false`,
  `diedTick`, `deathCause`; task/path cleared (releasing node, site and
  worker reservations); carried goods perish into `ledger.foodLost/woodLost`;
  home slot released and refilled; a `died` event records cause and day.
- **Conservation with construction:** wood = map + carried + stockpile +
  wood held by structures + woodLost − regrown is constant (tested every
  tick); food additionally counts foodLost.

### 3.10 Social: relationships, interactions & memory (M6)

**Relationships** (`citizens/relationships.ts`): directional records —
`citizen.relationships[otherId] = { affinity −100..100, familiarity 0..100,
lastTick }` is how *this* citizen sees the other. Familiarity is always
changed equally on both sides (so it stays symmetric); affinity may differ
(the receiver of food likes the giver more than vice versa). Records are
created lazily on the first completed interaction (no record = strangers,
0/0), keyed by id so duplicates are impossible; the validator rejects
self-references and unknown ids. Crossing affinity 50 / −40 emits a
`friendship` / `rivalry` event once per crossing.

**Interactions** (`systems/social.ts`, actions `socialize` and `share`):

| | Who | Time | Effects |
| --- | --- | --- | --- |
| chat | initiator + recruited listener, both alive and within 2 tiles | 8 ticks after the partner joins | social +30 each, familiarity +6, affinity +(5 + 6 × the *other's* sociability) — halved while one already resents the other (affinity < −10: grudges heal slowly), `chat` memory each |
| argue | same conversation, seeded roll: P = 0.05 + 0.2·(1 − mean sociability) + 0.3·stress + 0.25·bad blood, ≤ 0.6 | same | social +8, familiarity +3, affinity −(12 + 8·(1 − own resilience)), `argument` memory, event |
| share | giver carrying berries → hungry neighbour (< 55 satiety) within 2 tiles | 3 ticks | ≤ 2 berries move from the giver's load into the receiver's stomach (+25 satiety each, `ledger.foodEaten`), affinity +5 giver / +15 receiver, social +15 each, `gaveFood` / `receivedFood` memories, `sharedFood` event |

- **Partner choice:** available partners only — alive, not asleep, not in
  critical need, and idle, wandering or merely walking to a job; within 10
  BFS steps. Partner factor = (0.5 + 0.5·(affinity+100)/200) ×
  (1 + 0.3·familiarity/50) × distance, ×0.3 after a recent argument with
  them, ×1.3 if they recently fed us. Affinity < −50 → avoided.
- **No deadlocks:** the initiator walks to the partner; on arrival the
  partner is recruited into `listen` *only if still available and in reach*,
  otherwise the initiator gives up at once. Either side leaving, dying or
  drifting away ends the conversation with no effects.
- **Anti-spam:** personal cooldown 40 ticks, pair cooldown 120 ticks; plain
  chats create memories, not events (arguments, shares and milestones do).
- **Survival first:** social actions score 0 below 35 satiety/energy, and
  urgent eat/rest break conversations (hysteresis rules above).
- Social need now recovers **only** through these interactions (M4's
  proximity recovery is gone). 30-seed sweep: mean social ≈ 70, < 20 in
  0.3% of samples (mostly very unsociable citizens).

**Memory** (`citizens/memory.ts`): `{ id, tick, kind, subjectId?, tile?,
valence }`, recorded only where the event happens:

| Kind | Recorded when | Influences |
| --- | --- | --- |
| chat / argument | a conversation completes (both sides) | partner choice (argument ×0.3) |
| receivedFood / gaveFood | a share completes | reciprocity: share score +0.3 towards the giver; partner ×1.3 |
| foundResource / resourceDepleted | a unit is gathered / a node emptied | remembered productive nodes count as 3 steps closer |
| discovered | a survey reveals tiles | explore momentum ×1.15 |
| builtShelter | the crew finishing a shelter | — (history) |
| sawDeath | a death within 6 tiles | eat earlier (caution) |

Bounded at 24 per citizen. A repeat (same kind/subject/tile within 240
ticks) refreshes the old memory instead of adding one; when full, the least
salient (smallest |valence|, then oldest, then lowest id) is forgotten.
Memories influence decisions for 480 ticks.

### 3.12 Exploration (M6, `ai/actions/explore.ts`)

- **Frontier:** a walkable (discovered, passable, not solid) tile with an
  undiscovered 4-neighbour; **gain** = undiscovered tiles within 4. The
  explorer picks the best gain / (BFS steps + 5), ties by index, skipping
  frontiers within 4 of another explorer's target. Unreachable frontiers
  never appear in the BFS; surveyed ones lose their gain, so nothing is
  reselected in vain. Interrupted exploration simply re-plans later.
- **Survey:** after arriving, 4 ticks, then every tile within radius 4 is
  discovered (`revealAround` bumps `map.version`), a `discovered` memory is
  stored and, for ≥ 10 new tiles, a `discovered` event.
- Paths still cross discovered tiles only; new resources become gathering
  targets as soon as they are discovered and reachable.
- 30-seed sweep: discovered tiles grow from ≈113 to ≈767 of 864 in 10 days.

### 3.11 Events

Structured events (`{ id, tick, kind, citizenIds, data }`) appended to a ring
buffer (cap 200) in state. Text is formatted in the UI (`ui/format/text.ts`),
keeping state small and the sim free of presentation. Each kind maps to a
category (`selectors.EVENT_CATEGORIES`: social, construction, exploration,
survival, time); `getEvents(state, categories?)` returns the stored buffer
newest first. Plain chats are memories, not events.

### 3.12b History (M7, `systems/history.ts`)

A genuine snapshot is recorded at tick 0 and at the end of every tick that is
a multiple of `HISTORY_INTERVAL` (24 ticks = 10 per day); at most
`HISTORY_MAX` (600 = 60 days) are kept, oldest dropped first. Averages are
over the living, rounded to integers, so samples are compact and exactly
reproducible. Nothing is back-filled: a save migrated from v4 starts with an
empty history and records from its next interval.

### 3.13 Read-only selectors (M7, `sim/selectors.ts`)

`getCivStats` (population, dead, stockpile, shelters by stage, housing
capacity/occupied/homeless, explored %, average needs, friendships = mutual
affinity ≥ 50, rivalries = either side ≤ −40, living pairs only),
`getCitizenDetail`, `explainDecision` (facts only: decision tick, top and
runner-up scores, current task, and whether it is *persisted* — started
before the decision and kept by `SWITCH_MARGIN` — *fellBack* — started at
the decision because the top action could not start — or *recruited* into
someone's conversation), `getRelationships` (from the inspected citizen's
side, with the other side's affinity alongside), `getMemories` (newest
first), `getEvents`, `getHistory`. All pure; tested to leave the world
byte-identical.

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

// Civilization stats are DERIVED by selectors.getCivStats(), not stored, so
// they can never go stale. Only the bounded history series is stored (M7):
// history: HistorySample[] — { tick, population, food, wood, housed,
//   capacity, discovered, satiety, energy, health, social } (integers)

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
- **One** `requestAnimationFrame` loop drives both simulation and rendering;
  `start()` is idempotent and `stop()` cancels the pending frame, so there are
  never competing loops (React StrictMode start/stop/start is safe).
- **Fixed-timestep accumulator**: elapsed real time → whole ticks at
  `5 × speed` ticks/s. Spike protection: a frame counts at most 250 ms and runs
  at most 20 ticks; any excess backlog is dropped.
- Calls `renderer.render(state, alpha)` every frame, even while paused;
  rendering never advances the simulation.
- Publishes an immutable `SimulationSnapshot` (tick, day, clock, phase, paused,
  speed) at most every 200 ms while running and immediately on control
  changes; React reads it via `useSyncExternalStore` (`app/useSimulation.ts`).
- The frame scheduler is injectable, so the loop is unit-tested in Node.
- Done (M3): `setSpeed(1|3|10)`, `setPaused`, `togglePause`, `start/stop/dispose`,
  `setRenderer/detachRenderer`.
- M8: `loadWorld(state)` replaces the world in one assignment (after the
  save was fully validated elsewhere), pauses, resets the accumulator and
  bumps `worldId`; `restart(config)` = `loadWorld(createWorld(config))`;
  `markSaved()` clears the snapshot's `unsaved` flag. The frame loop is never
  restarted, so loads/restarts can't create a second loop.

UI-only state (selected citizen, open panels) lives in React, not in the sim.

## 6. Rendering (PixiJS v8)

- 24 px tiles → an 864 × 576 world, scaled to fit the map element
  (`render/layout.ts`); a `ResizeObserver` resizes the renderer and re-fits.
- Layers: **map** (terrain + fog drawn off-stage and baked into one texture;
  re-baked only when terrain/`discovered` or the display scale change),
  **resources** (`render/ResourceSprites.ts`: one 24 px sprite per bush/tree
  sharing 12 pre-rendered depletion-level textures; a change just swaps a
  texture), structures, citizens (with a cargo badge and dimmed while asleep).
  **Sim rule:** any change to terrain, resources or `discovered` must
  increment `map.version`; on a bump the renderer diffs terrain/`discovered`
  against its copies to decide whether the map needs a re-bake.
- Why sprites, not a baked resource layer: extra full-map transparent quads
  multiplied fill cost on software-rendered GPUs (≈3× slower at DPR 2), and
  re-baking on every gathered unit is wasteful at 10x.
- Citizens never stand in fog (they walk discovered tiles only), so fog sits
  under them.
- Pixi's own ticker is disabled (`autoStart: false`); the controller's loop
  calls `app.render()`. Main-canvas MSAA is off: it doubled frame cost on
  software-rendered GPUs, and the baked map is antialiased at bake time.
- **Lifecycle** (`render/AppLifecycle.ts`): Pixi 8 initialises
  asynchronously. The wrapper creates the app at most once, destroys it exactly
  once, and if `dispose()` runs before init finishes (StrictMode unmount) it
  destroys the app as soon as it is ready. `AppLifecycle.live` counts
  undestroyed apps for leak tests.
- Procedural shapes (Graphics) only in MVP — no asset pipeline.
- Citizens: coloured by role, positions interpolated between tiles; cargo
  badge; dimmed asleep, hidden while asleep inside their own shelter.
- Shelters by stage: staked outline with delivered logs → rising walls →
  house with roof, door and window.
- **Day/night** (`render/daylight.ts`): darkness from the clock (bright
  07:00–19:00, darkening to full night by 22:00, brightening 05:00–07:00).
  Implemented as **tints** on the map, resource and structure layers (and a
  lighter tint on citizens) — a colour multiply with zero extra fill — plus a
  small additive `lights` layer (campfire glow, lit shelter windows) whose
  opacity rises at night. No full-screen overlay. Measured frame time is
  unchanged from M4.
- PixiJS is code-split: `MapView` dynamic-imports the renderer.
- **Social badges** (M6): a tiny speech bubble while talking/listening/giving,
  then for 12 ticks tinted by the latest memory (white chat, red argument,
  pink shared food). Exploration's fog reveals re-bake the map layer through
  the existing `discovered` diff. Frame time measured identical to M5
  (interleaved runs).
- Click → tile → topmost citizen → `onSelectCitizen(id)` callback to React.
- Renderer owns Pixi objects keyed by entity id and reconciles each frame
  (create/update/destroy), never stores sim data of its own.

## 7. UI (React)

Layout: top bar (title, clock, controls); the map with the event feed and
history below it; a right sidebar with the dashboard and inspector. Below
980 px it becomes one column ordered map → dashboard/inspector → feed →
history (so a tapped citizen's details are right under the map).

- **Keyboard** (M9, `ui/shortcuts.ts`): Space play/pause, 1/2/3 speed,
  Escape closes the topmost dialog or deselects. Not while typing in a
  field, with Ctrl/⌘/Alt, or (for Space) on a focused control. A legend sits
  in the footer; controls carry `aria-keyshortcuts` and tooltips.
- **Clock wording**: times between midnight and dawn are shown as
  “(late night)” — days begin at 06:00, so they still belong to that day.
- **Accessibility**: visible `:focus-visible` rings, labelled controls,
  reduced-motion respected, text colours ≥ 4.5:1 against their panels.
  Dialogs (`components/Modal.tsx`) move focus in once on open and return it
  to the opener on close; their mount effect runs once (`onClose` via a ref)
  — M9 fix: re-running it on every 5 Hz re-render pulled focus back to the
  dialog every 200 ms, breaking keyboard navigation inside it.
- **Controls**: pause/resume, 1x/3x/10x, seed field (+ random seed) and
  Restart, Save and Load (M8; `•` on Save marks unsaved progress).
- **Dashboard** (`components/Dashboard.tsx`): population (and deaths), day &
  time, food, wood, housed/capacity with shelters built and building,
  explored %, friendships · rivalries, average satiety/energy/health/social
  meters. Fed by `snapshot.stats` (≤ 5 Hz).
- **Citizen inspector** (`components/Inspector.tsx`): empty state with a
  roster; then tabs — *Overview* (needs, task + destination, position,
  carrying, home + housemates, personality), *Decision* (sentences from
  `explainDecision` + all recorded scores, current task highlighted),
  *Bonds* (directional affinity both ways + familiarity, sort toggle),
  *Memories* (newest first, with day/time and tick).
- **Event feed** (`components/EventFeed.tsx`): the stored buffer newest
  first with day/time, category dot and label, clickable citizen names,
  category filter chips; states plainly that only the last 200 are kept.
- **History** (`components/HistoryCharts.tsx`, `LineChart.tsx`): four small
  multiples (population/housed, food/wood, explored %, average needs), plain
  SVG, one axis each, 2px lines, legend with current values, crosshair
  tooltip, and a table view. Colours: the dataviz reference palette's dark
  categorical slots in fixed order (`--series-1..4`), validated on the panel
  surface.
- **Selection** (UI state in `App`): click a citizen on the map
  (`render/selection.ts` hit-tests the positions drawn last frame, so it is
  exact while they move) or a name anywhere; a gold ring follows them; click
  empty ground or × to deselect. Dead citizens stay inspectable (no ring).
  The renderer's canvas listeners are removed in `destroy()`.
- Re-render cost: panels update at ≤ 5 Hz from the snapshot. The event
  feed and history charts are `React.memo` components that receive only
  `lastEventId` / `historyLength` / `worldId`, so they re-render only when an
  event or sample is added (M9). At 10x our JavaScript (sim + React +
  Pixi) is ≈5% of main-thread time; the rest of a headless frame is software
  rasterisation.
- Dev builds expose `window.__littleWorlds` (the controller) for automated
  browser checks; it is stripped from production builds.

## 8. Persistence (M8, `persistence/storage.ts`, `app/Autosaver.ts`)

```ts
interface SaveFile {
  format: 'little-worlds-save'
  fileVersion: 1
  meta: { seed, tick, day, hour, minute, population, schemaVersion, savedAt }
  world: WorldState            // plain serialize() output, any supported schema
}
```

- **Slots:** localStorage keys `little-worlds:save:slot1|slot2|slot3`
  (manual) and `little-worlds:save:autosave` (only the Autosaver writes it).
  `savedAt` is browser time in the file metadata only — never in the world.
- **SaveStore** (storage injectable for tests) returns result objects and
  never throws: `unavailable` (no/blocked storage), `quota` (full — nothing
  is half-written), `empty`, `corrupt` (bad JSON, wrong format, damaged
  details or failed validation, with the validator's path), `unsupported`
  (newer file or schema version). `list()` fully validates each occupied
  slot so damage is visible before loading; damaged slots keep their
  readable details.
- **Loading** runs `deserialize` (stepwise migrations v1→…→v5, then full
  validation); only a valid world is handed to `controller.loadWorld`, so a
  failed load never touches the running world.
- **Autosave:** a check every 10 s counts *running* (unpaused) time; after 5
  minutes it writes the autosave slot if the world (worldId + tick) changed
  since the last autosave. A `busy` flag prevents overlap; failures are
  reported (toast + dialog line) and the simulation keeps running. A
  best-effort attempt on `pagehide` is made, but nothing relies on it.
- **Renderer refresh on load:** `render/worldChange.ts` detects a different
  world by object identity (not `map.version`, which coincides between
  worlds) and the renderer drops all cached views, sprites, structures and
  the baked map before rebuilding.
- **UI:** the Save/Load dialog lists the four slots (seed, day/time,
  population, save date; Empty / Saved world / Damaged) with Save, Load and
  Delete; overwriting, deleting, loading over unsaved progress and
  restarting over unsaved progress all ask for confirmation. Loaded and
  restarted worlds start paused. The selection is keyed by `worldId`
  (`ui/selection.ts`), so it resets on load/restart.
- Typical save size ≈ 50–60 KB.

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
- Hot paths grow with explored territory, so: one BFS per decision over a
  per-tick shared walk mask (`structures.baseWalkMask`), inline-neighbour
  BFS (`path/flood.distanceFieldMask`), and frontiers cached by discovered-
  tile count. These are derived caches keyed on every input they depend on,
  never serialized; results are identical without them.
- Measured (Node, M9 sweep): ≈0.15 ms/tick averaged over 30 seeds × 30
  days and 100-day runs (budget 1 ms). Saves ≈105 KB at day 30 and ≈155 KB
  at day 100, where the 600-sample history cap is reached (bounded).
- **Adaptive render resolution** (`render/quality.ts`, M9): the canvas
  starts at min(devicePixelRatio, 2), also capped at ≈4.2 M device pixels.
  1.5 s windows of frame intervals are compared by median: two slow windows
  (> 28 ms) step down one level (2 → 1.5 → 1.25 → 1 → 0.75); six fast
  windows (< 18 ms) plus a 10 s cooldown step up; a level that proves slow
  again right after rising becomes a permanent ceiling (no oscillation).
  Changing level re-bakes the cached map/resource textures once; it never
  affects the simulation. Headless software-GPU, 1280×800: M8 117 ms/frame
  at DPR 2 and 33 ms at DPR 1 → M9 16.7 ms (60 fps) at both, settling at
  0.75×. Real GPUs that hold 60 fps stay at full density.
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
    │   │   ├── noise.ts             # seeded value noise
    │   │   ├── generate.ts          # terrain, campfire, resources, validation/repair
    │   │   └── discovery.ts         # revealAround, withinRadius
    │   ├── path/
    │   │   ├── heap.ts
    │   │   ├── astar.ts             # findPath, pathCost
    │   │   └── flood.ts             # reachableMask, labelRegions
    │   ├── citizens/
    │   │   ├── names.ts
    │   │   ├── create.ts
    │   │   ├── memory.ts
    │   │   └── relationships.ts
    │   ├── ai/
    │   │   ├── context.ts           # per-decision context (BFS, targets)
    │   │   ├── phases.ts            # arrival phase per task kind
    │   │   ├── travel.ts            # beginTask (A* over discovered tiles)
    │   │   ├── curves.ts            # response curves
    │   │   ├── utility.ts           # scoring framework
    │   │   ├── decide.ts
    │   │   └── actions/             # one module per action: score + start + phases
    │   │       ├── eat.ts  forage.ts  chop.ts  build.ts
    │   │       └── rest.ts socialize.ts explore.ts wander.ts
    │   ├── systems/
    │   │   ├── time.ts  needs.ts  health.ts  resources.ts
    │   │   ├── decide.ts            # utility AI + hysteresis
    │   │   ├── needs.ts             # needs decay/recovery
    │   │   ├── resources.ts         # regrowth
    │   │   └── tasks.ts movement.ts social.ts stats.ts
    │   └── __tests__/               # cross-cutting tests (determinism, invariants, arch, perf)
    ├── app/
    │   ├── SimulationController.ts  # loop, speed, pause, snapshots
    │   └── useSimulation.ts         # React hook (useSyncExternalStore)
    ├── render/
    │   ├── WorldRenderer.ts         # Pixi app, layers, structures, citizens
    │   ├── BakedLayer.ts            # container → cached texture
    │   ├── ResourceSprites.ts       # per-node sprites, depletion textures
    │   ├── AppLifecycle.ts          # async init/destroy guard
    │   ├── layout.ts                # fitWorld
    │   └── palette.ts
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
| **M9** | **Balance & polish** — long-run sweep (`npm run sweep`), evidence-based tuning, construction loop fix, adaptive render resolution, keyboard shortcuts, accessibility, README. | Sweep invariants hold over 30 seeds × 30 days and 3 × 100 days; perf tests pass; browser soak at 10x has no errors. |

All milestones M0–M9 are complete (the MVP).

### Out of scope for the MVP

Births/ageing, player commands, combat, trading, multiple settlements, map
sizes beyond config, Web Worker sim, sprites/art assets, external AI APIs.
