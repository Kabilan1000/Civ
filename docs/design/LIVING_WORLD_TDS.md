# Little Worlds — Living World Expansion
## Technical Design Specification (preproduction, revision 2)

Status: **design for review — nothing here is implemented.** This is the
companion to [`LIVING_WORLD_GDD.md`](LIVING_WORLD_GDD.md), which covers game
design and the roadmap. This document holds §6 (architecture) and §7 (the
detailed M10 specification). All rules in [`CLAUDE.md`](../../CLAUDE.md)
apply. The change log is at the end.

---

## 6. Technical architecture

### 6.0 What exists today (v0.1, schema v5)

| Area | Current behaviour (file) | Consequence |
|---|---|---|
| Resources | `map.resources[i]` = `{kind, amount, max}` or `null`; immortal; regrows at 0 (`types.ts`) | M10 extends `ResourceNode`. AI and renderer already ignore `amount ≤ 0`. |
| Regrowth | Stateless `tick % 48` / `% 160`, +1 per node below max (`systems/resources.ts`) | Replaced by `systems/ecology.ts`, still stateless and stage-aware. |
| Map gen | Moisture exists only during generation; resources use the map RNG (`map/generate.ts`) | Habitat uses terrain. Plant ages come from a separate stream, so the tick-0 map is unchanged. |
| IDs | **One shared counter** `nextId` for citizens, structures, memories **and events** (`ids.ts`, `events.ts:15`) | Any new event shifts all later IDs (§6.4). |
| ID use | Order only: memory eviction tie-break (`citizens/memory.ts:54`), shelter and homeless order (`construction.ts:92,100`), memory sort (`selectors.ts:302`). **No sim code reads `state.events`.** | Extra allocations preserve relative order and behaviour, but change serialized state. |
| `map.version` | Bumped by gather and regrowth. The renderer re-bakes only if terrain or fog changed; otherwise it syncs sprites in O(tiles) (`WorldRenderer.ts:306`). | Germination and death are cheap sprite updates. |
| Housing | `housingDeficit = living − shelters×3` (`structures.ts:76`); plan only if > 0 (`construction.ts:35`) | No spare capacity, ever. The M13 deadlock and its fix are in GDD §4.4. |
| Ledger | Conservation checked every tick | Gains `foodDecayed`/`woodDecayed`. |
| Saves | v5 ≈ 105 KB at day 30, 155 KB at day 100 | M10 adds ≈ 16 KB raw. |

### 6.1 Data models

The M10 block is normative once approved. The other blocks are reserved, to
avoid incompatibility.

```ts
// ── M10b/M10c (schema v6) ───────────────────────────────────────────────────
export type PlantStage = 'seedling' | 'young' | 'mature' | 'old' | 'dead'

export interface ResourceNode {
  kind: ResourceKind            // 'berries' | 'wood' (unchanged)
  amount: number                // whole units, 0..max
  max: number                   // cap for the current stage (stored: AI/renderer stay stage-agnostic)
  stage: PlantStage             // 'dead' only for wood (harvestable deadwood)
  bornTick: number              // may be negative (older than the world)
  lifespanDays: number          // whole days
  diedTick: number | null       // non-null iff stage === 'dead'
  // RESERVED (post-M13): species?: 'pioneer' | ...   — absent ⇒ pioneer
}

export interface EcologyState {
  rng: RngState                                   // dedicated stream (§6.4)
  counters: {
    births: { berries: number; wood: number }
    deaths: { berries: number; wood: number }
    seedsCast: number
    fallenFruitSprouts: number
  }
}

export interface Ledger {       // + 2 fields
  foodDecayed: number           // berries lost on bush death / old-age cap drop
  woodDecayed: number           // deadwood rot / cap drop
}

export interface HistorySample {  // + optional fields (absent in pre-v6 samples)
  bushes?: number; trees?: number; seedlings?: number; snags?: number
  standingFood?: number; standingWood?: number
  forageNearCamp?: number       // berries on discovered bushes ≤ 10 BFS steps from camp
  nearestRipeBushSteps?: number // −1 if none reachable
}

export interface WorldState {   // + 2 fields
  ecology: EcologyState
  /** Separate counter for event ids (v6+), so new event kinds never shift entity ids. */
  nextEventId: number
}
// No new SimEventKind in M10. No per-plant events.

// ── Reserved: M12–M13 ───────────────────────────────────────────────────────
// Citizen += { bornTick; parentIds: [number, number] | null; partnerId: number | null;
//              childIds: number[]; householdId: number }
// Household { id; memberIds: number[]; homeId: number | null; formedTick; lastBirthTick: number | null }
// DeathCause += 'oldAge'
// PersonRecord, YearSummary (GDD §4.5);  WorldState += { households, archive, chronicle }
// ── Reserved: M14 ───────────────────────────────────────────────────────────
// Structure += { condition; builtTick; lastRepairTick; salvageWood };  stage += 'ruin'
// Ledger += { woodUsed }
// ── Reserved: Hand phase / M10e prototype ───────────────────────────────────
// WorldState += { inputs: { tick: number; kind: string; tile?: number }[] }  (not in M10e: saving disabled)
```

### 6.2 System update order

```
1. time          tick++ (and existing dayStarted). No calendar events.
2. needs         unchanged (starvation / exhaustion death)
3. ecology       (M10b, replaces resources)
                   every tick: stage-aware regrowth (stateless modulo)
                   dawn (tick-of-day 0): stage pass (age → stage, cap drops, deaths,
                                         fallen fruit, deadwood rot), then seed pass
4. lifeCycle     (M12/M13) birthdays, household checks
5. construction  unchanged in M10, except chooseSite may claim seedling tiles
6. decide        unchanged
7. act           unchanged
8. history       + optional ecology fields (M10d)
```

Ecology takes the old regrowth slot, so the AI sees the dawn's changes in the
same tick. Dawn work happens while most citizens sleep. A plant that
disappears under a task is handled by the existing guard
(`tasks.ts`: `!node || amount <= 0` ends the task).

### 6.3 Performance budgets

These are measured headless in Node, as in `npm run sweep`. These are hard
gates for each milestone that claims a population size.

| Citizens | `step()` avg | Worst tick | Save @ 100 d | Browser frame (1×) | Prerequisites |
|---|---|---|---|---|---|
| 12 | ≤ 0.25 ms (now 0.145–0.166) | ≤ 2 ms | ≤ 175 KB (now 155) | ≤ 16.7 ms | M10 |
| 50 | ≤ 0.8 ms | ≤ 4 ms | ≤ 450 KB | ≤ 16.7 ms | resource index; relationship cap (M13) |
| 100 | ≤ 1.5 ms | ≤ 6 ms | ≤ 900 KB | ≤ 16.7 ms (10× may shed resolution) | scaled decision interval; virtual lists |
| 200 | ≤ 3 ms | ≤ 10 ms | ≤ 1.8 MB (compressed) | sim in a Worker | localStorage quota (~5 MB) |

The ecology system must cost ≤ 0.03 ms per tick on average and ≤ 1 ms on the
dawn tick (36 × 24 map).

### 6.4 Determinism, randomness and IDs

**RNG streams** [approved]:

- `state.rng` (AI, unchanged).
- `state.ecology.rng`, seeded `seed + '#ecology'` for new worlds and
  `seed + '#ecology@' + tick` for migrated saves.
- A creation-only `seed + '#flora'` stream for initial plant ages.

The tick-0 terrain and resource placement for every existing seed are
unchanged. Iteration is in ascending tile index. Arithmetic is integer only
(‰ chances compared with `nextInt(rng, 0, 999)`), with no `pow`, `exp` or
trigonometry.

**Shared ID allocator: investigation and decision:**

- **Facts:**
  - `pushEvent` allocates from the same `nextId` as citizens, structures and
    memories.
  - Within one `step`, allocation order is deterministic.
  - IDs affect behaviour **only through relative order** (the tie-breaks
    listed in §6.0). Inserting extra allocations shifts all later IDs by the
    same amount and preserves their relative order.
  - No sim system reads `state.events`.
- **So adding `seasonStarted`/`yearStarted` events in M10a would:**
  - (a) leave behaviour unchanged;
  - (b) still change `serialize()`: every later ID, `nextId`, memory IDs
    inside citizens and event IDs;
  - (c) change *which* events fit in the 200-event window. The feed would
    show different history, and selectors that read events would return
    different results.
  - It would no longer be a calendar-only change in any verifiable sense.
- **Decision for M10a:** **no sim events.**
  - The UI derives boundaries from `tick` with the pure calendar functions.
  - Clock: `Spring 3, Year 1 · 14:42`.
  - Event feed: a **separator row** ("— Summer, Year 1 —") is inserted
    between displayed events whose ticks straddle a season start. It is
    computed from adjacent ticks and never stored.
  - History charts: season bands are computed from sample ticks.
  - M10a touches no file under `src/sim/` except a new `calendar.ts`, which
    is pure functions exported via `sim/index.ts`. `SCHEMA_VERSION` stays 5.
- **Decision for M10b (schema v6):**
  - Events get their own counter, `nextEventId`. The migration sets it to
    the current `nextId`, so all existing IDs stay unique.
  - From then on, a new event kind can never shift citizen, structure or
    memory IDs.
  - **Ecology allocates no IDs.** Plants are identified by tile index.
  - Verified: there is no cross-type ID comparison in the sim. Event IDs are
    used only for feed keys and the selectors' "since" cursor
    (`lastEventId`), which compare event IDs with event IDs only. This is to
    be re-checked by grep in M10b.

**Determinism tests (accurate definitions):**

| Test | Definition |
|---|---|
| **D1 M10a parity (golden)** | Before any M10a code, a script at the current commit records `sha256(serialize(state))` for 5 seeds at ticks 0, 240, 2880, 11520 and 28800 into `__tests__/fixtures/golden-v5.json`, along with the commit hash. M10a must reproduce **every hash byte for byte**. It is retired in M10b, where behaviour changes intentionally. |
| **D2 Same-version replay** | Two `createWorld(seed)` + `stepN(n)` runs give identical `serialize()` (existing test, extended to 60 days with ecology). |
| **D3 Save/resume** | Serialize at a **dawn tick** (and mid-dispersal day 13, a spring flush), deserialize, step both copies by k, compare. |
| **D4 Stream isolation** | Ecology draws only from `ecology.rng`: run a dawn and assert that `state.rng` is unchanged by `updateEcology`. The AI draws never touch `ecology.rng`, with the reverse assertion around `decide`/`act`. |
| **D5 No-rescue (metamorphic)** | Two worlds identical except for stockpile food (0 against 500) and citizen satiety: after the same ecology step, `map.resources`, `ecology` and the ledger's ecology terms are identical. This shows the ecology never reads colony need. |
| **D6 Seed stability** | Hashes of tick-0 terrain plus resource kinds and amounts equal pinned v0.1 values for 5 seeds (recorded with D1). |
| **D7 ID-shift invariance** (verifies the analysis, run once in M10b) | In a sandbox, inject k extra `allocateId` calls at a fixed tick. Afterwards, compare the worlds with IDs renumbered by rank: decisions, positions, tasks and the ledger must be identical. |

### 6.5 Versioned save migration (v5 → v6, M10b)

1. **Nodes**, in ascending tile order, with `h = fnv1a32(seed + ':' + tile)`
   (integer, no RNG state):
   - Set `stage = 'mature'` and keep `amount` and `max`.
   - Set `lifespanDays = LIFE_MIN + h % (LIFE_MAX − LIFE_MIN + 1)`.
   - Set `ageDays = MATURE_AT + (h >>> 8) % (oldAt(lifespan) − MATURE_AT)`.
   - Set `bornTick = tick − ageDays × 240` and `diedTick = null`.
2. `ledger.foodDecayed = woodDecayed = 0`.
3. `ecology = { rng: seedRng(seed + '#ecology@' + tick), counters: zeros }`.
4. `nextEventId = nextId`.
5. History samples are left unchanged; ecology fields stay absent and are
   not fabricated.

**Validation:**

- `stage` must be in the enum, and `dead` is only allowed for wood.
- Integers with `0 ≤ amount ≤ max`.
- `max` must equal the stage cap; for `dead`, it must not exceed the mature
  cap.
- `lifespanDays` must be in [1, 1000].
- `diedTick` must be non-null exactly when the stage is `dead`.
- The counters must be non-negative integers.
- `nextEventId > every event id`.

**Fixtures:** a new `m9-save-v5.json` (a real v0.1 save at about day 20). It
must load, migrate, run 30 days with conservation checked every tick, and
round-trip. The v2–v4 fixtures must still load.

**Policy unchanged:** newer saves are refused, damaged ones marked, and a
world is swapped in only after full validation.

### 6.6 Interaction with existing systems

| System | M10 change | Rule |
|---|---|---|
| Terrain | none | — |
| Resources | lifecycle on the existing array; `map.version++` on germination, stage change, death or rot | 11 |
| Conservation | decay terms; germination adds 0 units | 13 |
| Pathfinding, walk mask, frontier caches | none (plants aren't solid; keys unchanged) | 5, 14, 16 |
| AI | unchanged scoring; seedlings ignored (`amount 0`); deadwood is choppable wood; remembered spots of dead plants stop matching | 6, 17 |
| Construction | `chooseSite` treats a seedling tile as free and clears it (0 units) | 14 |
| Events | none added in M10; separate event counter from v6 | 10 |
| History | optional ecology fields; 600-sample cap unchanged | — |
| Renderer | stage textures (seedling, young, old, deadwood); `sync` already handles appear/vanish; no overlays | 12, 15 |
| UI | calendar-derived clock, separators and chart bands; ecology card and chart | 7, 10 |
| Selectors | `ecologySummary`, `nearestRipeBushSteps` (pure) | 12 |

### 6.7 Known migration and scaling risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Synchronous die-off of initial or migrated plants | Hash- or RNG-staggered ages (hard gate H6) |
| R2 | Forage collapse near camp | Permitted outcome. Natural recovery mechanisms (GDD §3.10); balance targets B7/B8; tunable seed threshold |
| R3 | Forest crowds out shelter sites | Clearing plus seedling-claimable sites (hard gate H4) |
| R4 | Runaway or extinct populations | Crowding, an enforced safety cap (H3), balance bands (B5/B6) |
| R5 | Cross-version confusion | Docs: saves resume under new rules; seeds keep their islands |
| R6 | Save growth | ≈ 16 KB raw; budget gate |
| R7 | Sprite churn | A few changes per day; measured in the soak |
| R8 | O(n²) relationships at 50+ | Per-citizen cap (M13) |
| R9 | Per-decision full scans at 100+ | Per-kind index keyed on `map.version`; bounded BFS |
| R10 | localStorage quota at 200 | Archive, caps, compressed format (SaveFile `fileVersion` bump) |
| R11 | Dawn spikes on large maps | Spread dawn work over 20 ticks by tile modulo (deterministic) |
| R12 | A new event kind silently shifts entity IDs | `nextEventId` from v6; D1 golden test for M10a |
| R13 | M13 housing deadlock | Headroom, overcrowding-as-demand, household assignment (GDD §4.4) |

---

## 7. Detailed M10 specification

**In scope:** calendar foundation; natural appearance, growth, aging and
disappearance of bushes and pioneer trees; habitat; observable regeneration
and recovery; basic ecology dashboard.

**Out of scope:** wildlife, citizen aging or reproduction, gods, settlement
decay, seasonal fruiting or need changes, new speeds, terrain change and tree
species.

M10 ships as **M10a → M10d**, each committed separately. M10e (the
prototype) is optional and separately approved.

### 7.1 Mechanics

**M10a — Calendar (UI-derived, no sim state).** `sim/calendar.ts` holds
pure functions of `tick`:

```
dayIndex = floor(tick / 240)       year = floor(dayIndex / 48) + 1
dayOfYear = dayIndex % 48          seasonIndex = floor(dayOfYear / 12)   (0 spring … 3 winter)
dayOfSeason = dayOfYear % 12 + 1   isSeasonStart(tick) = tick > 0 && tick % 2880 === 0
```

The UI shows:

- the clock: `Spring 3, Year 1 · 14:42`, with the absolute day in the
  tooltip;
- event-feed separators between events whose ticks straddle a season start;
- season bands on the history charts.

The existing late-night rule and `dayStarted` are unchanged.

**M10b — Stage pass (dawn, ascending tiles):**

```
ageDays = floor((tick − bornTick) / 240)
stage = seedling < SEEDLING_DAYS ≤ young < MATURE_AT ≤ mature < oldAt(lifespan) ≤ old < lifespan ≤ death
oldAt(L) = floor(L × OLD_AT‰ / 1000)
```

- **Stage change:** set `max = STAGE_MAX[kind][stage]`. Any excess above the
  new max goes to `<kind>Decayed`.
- **Bush death:**
  - Run the fallen-fruit roll (M10c; in M10b, berries simply decay).
  - Add the remaining berries to `foodDecayed`.
  - Set the tile to `null` and increment `deaths.berries`.
- **Tree death:** if it holds wood, it becomes deadwood (`stage 'dead'`,
  `diedTick = tick`, `max = amount`). Otherwise it is removed. Increment
  `deaths.wood`.
- **Deadwood rot:** when `(tick − diedTick) / 240` is a positive multiple of
  `SNAG_ROT_DAYS`, remove 1 wood to `woodDecayed`. At 0 the tile becomes
  `null`. Chopping deadwood works like chopping a tree, but it never
  regrows.
- **Regrowth (every tick):**
  - full rate: `tick % INTERVAL === 0`;
  - half rate: `tick % (2·INTERVAL) === 0`;
  - seedlings, old trees and deadwood: none;
  - young plants and old bushes: half.
- **Initial ages (new worlds):** assigned after `generateMap` with the
  `#flora` stream, in ascending tiles. Every plant starts **mature with its
  v0.1 amount**, and ages are spread uniformly over the mature window.

**M10c — Seed pass (dawn, after the stage pass; berries, then wood; ascending tiles):**

```
eligible: stage ∈ {mature, old} and amount ≥ SEED_MIN_UNITS[kind]
chance‰ = SEED_CHANCE‰[kind] × SEASON_GERMINATION‰[season] / 1000  (old: ÷ 2, floored)
draw r = nextInt(eco, 0, 999); if r ≥ chance‰: next plant
seedsCast++; dx = nextInt(eco, −R, R); dy = nextInt(eco, −R, R); (0,0) ⇒ discard
tryGerminate(kind, target)
```

`tryGerminate(kind, t)` is shared by seeds and fallen fruit:

- **Reject** if any of these hold:
  - `t` is out of bounds or `resources[t] ≠ null`;
  - suitability is 0;
  - `t` is a structure tile or planned site;
  - `t` is within Manhattan distance `SETTLED_CLEARING` of any structure;
  - crowding exceeds `CROWD_MAX`;
  - the kind's population is at or above the safety cap.
- Otherwise draw `nextInt(eco, 0, 99)`. If it is below the suitability,
  create a seedling `{amount 0, max 0, bornTick: tick, lifespanDays:
  nextInt(eco, LIFE_MIN, LIFE_MAX), diedTick null}`, increment
  `births[kind]` and `map.version`.

Seedlings created this dawn count towards crowding for later attempts.

**Fallen fruit (M10c, bush death):** for each berry still on a dying bush,
up to `FALLEN_FRUIT_MAX_ROLLS`:

- If `nextInt(eco, 0, 999) < FALLEN_FRUIT‰`, call `tryGerminate` at a tile
  picked by `nextInt(eco, −1, 1)` twice; (0,0) means the bush's own, now
  empty, tile.
- Each berry is counted in `foodDecayed` whether or not it sprouts. A
  stripped bush therefore leaves no offspring.

**Suitability (integer):**

- berries: `base`, where sand counts only when 4-adjacent to grass. If 3 or
  more of the 8 neighbours hold trees or deadwood, take `× 40 / 100`.
- wood: `base`; on grass, 40 if 2 or more of the 8 neighbours hold trees,
  else 15.

### 7.2 Tunable parameters (`sim/constants.ts`)

| Constant | Berries | Pioneer tree | Rationale |
|---|---|---|---|
| `SEEDLING_DAYS` | 2 | 6 | Sprouts are visible for about 10–30 s at 10×. |
| `MATURE_AT_DAYS` | 5 | 20 | Bushes recover forage within a season; trees take longer. |
| `OLD_AT‰` | 800 | 750 | Visible old age. |
| `LIFE_MIN`/`LIFE_MAX` (days) | 28 / 44 | 90 / 150 | Pioneer turnover of about 0.9/day each, visible at 10× (GDD §3.3). |
| `STAGE_MAX` y / m / o | 3 / 6 / 4 | 4 / 8 / 8 | Mature equals v0.1, so day-1 balance is unchanged. |
| Regrowth interval | 48 | 160 | Unchanged from v0.1. |
| `SEED_MIN_UNITS` | 3 | 4 | Stripped plants can't spread [approved]. |
| `SEED_CHANCE‰` | 120 | 50 | Equilibrium arithmetic in GDD §3.6. |
| `DISPERSAL_RADIUS` | 3 | 2 | Bushes hop; forests creep. |
| `CROWD_MAX` (8-nbr) | 2 | 5 | Patchy forage, dense forest. |
| `SEASON_GERMINATION‰` | 1500 / 1000 / 1000 / 0 | same | Spring flush, winter rest. |
| `SNAG_ROT_DAYS` | — | 4 | 8-wood deadwood lingers about a month. |
| `FALLEN_FRUIT‰`, `FALLEN_FRUIT_MAX_ROLLS` | 150, 6 | — | A neglected full bush gives on average ~0.9 sprout attempts at death. |
| `SETTLED_CLEARING` | 2 | 2 | Camp, rest ring and doorways stay open. Sites are at 3–6. |
| `SAFETY_CAP‰` of land | 200 | 450 | An enforced bound. Reaching it in sweeps is a tuning failure. |
| `FORAGE_NEAR_CAMP_STEPS` | 10 | — | Pressure metric. |

M10c and M10d tune these values against §7.6 using sweep evidence. Each
change gets a one-line reason next to the constant.

### 7.3 Modules

- `sim/calendar.ts` (M10a)
- `sim/ecology/flora.ts` (stage tables, initial ages, hash)
- `sim/ecology/habitat.ts` (suitability, crowding)
- `sim/systems/ecology.ts` (replaces `resources.ts`)
- `selectors.ecologySummary` and `nearestRipeBushSteps`
- UI: calendar formatting, feed separators, chart bands, ecology card and
  chart
- Render: stage textures

### 7.4 Test plan

| Area | Tests |
|---|---|
| Calendar (M10a) | Boundaries at ticks 0, 239, 240, 2879, 2880, 11519, 11520. `isSeasonStart` is never true at 0. Formatting, including late night across a season boundary. Feed separator placement (UI test). **D1 golden parity.** |
| Stages | Every transition per kind; caps and decay on cap drop; bush death; tree → deadwood; 0-wood tree removal; rot timing; chopped deadwood never regrows. |
| Regrowth | Rates by stage; ledger equals units added. |
| Dispersal | Each rejection rule in isolation; seasonal multiplier (no winter germination); fixed draw counts; same-dawn crowding order; safety cap enforced. |
| Fallen fruit | A stripped bush leaves no sprouts. A full bush can. Berries count as decayed either way. All germination rules apply. |
| Habitat | Table values, sand rule, shade, forest edge. |
| Construction | A seedling tile can be chosen and is cleared. No germination inside the clearing. Dense-forest scenario still houses everyone. |
| AI | Seedlings never targeted; deadwood chopped; a plant vanishing mid-trip or mid-gather ends the task cleanly. |
| **Collapse and recovery (controlled, deterministic)** | (1) An isolated patch of 4 bushes harvested daily by a scripted sandbox loop: none seed, and the patch dies within one lifetime. (2) The same patch with an unharvested bush ring within radius 3: once harvesting stops, the patch zone holds ≥ 2 fruiting bushes again within 20 days. (3) A neglected dying patch re-sprouts via fallen fruit. These test that the **mechanisms** work. |
| Conservation | Extended identity checked every tick over 120 days on several seeds, and over the migration fixture. |
| Determinism | D2–D7 (§6.4). |
| Migration | v5 fixture → v6: staggered ages (H6); `nextEventId`; counters; 30 days with conservation; round-trip; every malformed field rejected; older fixtures load. |
| Architecture | New sim files pass the existing forbidden-import and global checks (the test walks `src/sim` recursively). |
| Performance | Ecology ≤ 0.03 ms/tick average, dawn ≤ 1 ms, `step` ≤ 0.25 ms. |
| UI / render logic | Ecology card from the selector; charts show gaps for absent fields; level keys for every stage; `sync` on appear and vanish. |
| Browser | 14-point check plus: sprouts and deadwood at 10×, ecology card, season clock and separators. 30-minute soak at 10×. |

### 7.5 Sweep additions

- **30 seeds × 120 days** (2.5 years). The 30-day pass is kept as a quick
  option.
- **3 × 400 days**, with save/resume at day 400.
- Per-seed report:
  - plant counts by stage at days 1, 60 and 120;
  - births, deaths and fallen-fruit sprouts;
  - worst single-dawn death share;
  - safety-cap hits;
  - forage-poor episodes (count, durations);
  - O1 trip distance per 10 days, O2 new-plant food share, O3 deadwood wood
    share;
  - deaths with their cause and the forage state when they happened.
- Estimated runtime: under 5 minutes.

### 7.6 Acceptance: hard gates against balance targets

**Hard gates are correctness.** They must hold on **every seed, every tick,
every run**; any failure is a bug that blocks the milestone. **Balance
targets are tuning goals under normal conditions** (default constants, the
standard sweep). Missing one triggers tuning, or an explicit written
justification approved in review. Outcomes that follow the rules, such as
scarcity, local collapse or a rare death, are not bugs.

**Hard gates:**

| # | Gate |
|---|---|
| H1 | Determinism: D1 (M10a) and D2–D4; save/resume exact at days 120 and 400. |
| H2 | Conservation identity every tick, in every sweep run and the migration fixture. |
| H3 | Bounds and invariants every tick: `0 ≤ amount ≤ max ≤ stage cap`; stage consistent with age; `dead` only for wood with `diedTick` set; no plant on water or rock, a structure, a planned site or inside the clearing; plant counts never above the safety cap; all M9 invariants. |
| H4 | Germination never blocks housing: no rejected site because of a seedling (tested), and site selection behaviour is unchanged where no seedlings are present. |
| H5 | Seed stability: D6 tick-0 hashes. |
| H6 | Migration and initial ages: all fixtures load; for the age distribution alone, scheduled deaths on any dawn in the first 60 days are ≤ 10% of either kind. |
| H7 | No rescue: the D5 metamorphic test, and the ecology module reads no citizen, stockpile or structure-demand state (except structure tiles, for the clearing). |
| H8 | Recovery mechanisms work: the controlled collapse-and-recovery tests in §7.4. |
| H9 | Simulation safety: no exceptions; a damaged or out-of-range save is rejected; unchanged sweep invariants; performance budgets in §7.9. |

**Balance targets** (normal conditions; aggregated over the standard sweep):

| # | Target | Review threshold (below it, tune before shipping) |
|---|---|---|
| B1 | 0 deaths on 30/30 seeds × 120 days and in 3/3 × 400 days | ≥ 27/30 seeds with 0 deaths; no village loses more than 2; every death in the report traced to a rule-following cause |
| B2 | Worst satiety ≥ 20 on normal seeds | median-seed worst satiety ≥ 20 |
| B3 | 30/30 fully housed, median day ≤ 3 (M9: day 2) | ≥ 29/30 |
| B4 | Food regrown/day within ±25% of 32.2 | ±35% |
| B5 | Births and deaths of both kinds by day 60 | ≥ 28/30 seeds |
| B6 | Day-120 counts: trees 70–140%, bushes 60–160% of day 1 | ≥ 27/30 seeds in band; island-wide extinction of either kind on 0 seeds |
| B7 | Days 200–400: each kind within ±30% of its mean | ±40% |
| B8 | Forage-poor episodes (`forageNearCamp` = 0) allowed; median episode ≤ 12 days and ≥ 90% recover within 24 days | median ≤ 24 days; any episode > 48 days investigated |
| B9 | The safety cap is never reached | reached on ≤ 1 seed |
| B10 | Observable outcomes: O1 trip distance rises in a forage-poor episode; O2 new-plant share ≥ 30% by day 120; O3 deadwood share ≥ 10% | each visible on ≥ 25/30 seeds |

### 7.7 Player-visible changes

- **Clock:** `Spring 3, Year 1 · 14:42`. Season separators in the feed;
  season bands in the charts.
- **Map:**
  - Sprouts, mostly in spring.
  - Smaller young plants and muted old ones.
  - Grey deadwood that shrinks as it rots and as builders chop it.
  - Forage moving away from heavily used areas, and forest edges creeping.
- **Dashboard ecology card:**
  - bushes, trees, seedlings and deadwood, with 10-day births and deaths;
  - standing food and wood;
  - **forage near camp**;
  - **nearest ripe bush (steps)**.
- **History:** an *Ecology* chart and a *Standing food* line.
- **README:** a "Living land" section and the cross-version note.

### 7.8 Save migration requirements

- Schema v5 → v6 as in §6.5 (M10b). M10a keeps v5.
- The SaveFile `fileVersion` is unchanged. A v6 save in v0.1 is refused with
  the existing message.
- Size: ≤ 125 KB at day 30 and ≤ 175 KB at day 100.
- The autosave migrates on load like any slot. Stored saves are never
  rewritten in the background.

### 7.9 Performance targets (hard gates, H9)

| Metric | Target | M9 |
|---|---|---|
| `step()` avg, 12 citizens | ≤ 0.25 ms | 0.145 ms |
| Dawn tick, worst | ≤ 2 ms | — |
| Ecology average share | ≤ 0.03 ms/tick | — |
| Save @ 30 / 100 days | ≤ 125 / 175 KB | 105 / 155 KB |
| Browser 1× / 10× median frame (headless software GPU) | ≤ 16.7 / ≤ 33.4 ms | 16.7 / 33.3 ms |
| 30-min 10× soak | post-GC heap flat ±1 MB; DOM flat after caps; 0 errors | 9.6–10.4 MB |

### 7.10 Risks and edge cases

- **A plant vanishes under a forager or chopper:** the dawn pass runs before
  `act`, and the existing guard ends the task. No unit is created or lost.
- **Germination under a citizen:** allowed (plants aren't solid).
- **Seedling chosen as a site in the same tick:** construction runs after
  ecology and clears it, deterministically.
- **Fog:** plants grow unseen. The renderer dims under fog, and discovering a
  tile never changes the ecology.
- **Small islands** (21 bushes): bands are relative, and the creation
  minimums still apply.
- **Migrated plants entering old age immediately:** the cap drops and the
  excess decays at the first dawn, recorded in the ledger.
- **Saves loaded near a season boundary:** dates are derived, and separators
  appear from the next boundary. Nothing is back-filled.
- **Event IDs after v6:** separate counter. Verify that no UI code mixes
  event and memory IDs in one keyed list.
- **History compatibility:** absent ecology fields render as gaps.
- **Feed flooding:** no per-plant events. Calendar separators are not
  events.

---

## Final M10 approval checklist

Approve each item, or mark it for change, before M10a starts:

1. [ ] **Calendar:** 12-day seasons and 48-day years; the 240-tick day
   unchanged; citizen age terms and thresholds deferred to the population
   review.
2. [ ] **M10a is UI-derived:** no sim events, state, IDs or schema change;
   gated by the D1 golden byte-parity test against hashes recorded at the
   current commit.
3. [ ] **Separate event-ID counter** (`nextEventId`) introduced with schema
   v6 in M10b. Ecology allocates no IDs.
4. [ ] **Pioneer trees** (90–150 days) with harvestable deadwood. No species
   field in M10; long-lived species deferred with a reserved migration path.
5. [ ] **Stripped plants can't spread**, with the five natural recovery
   mechanisms, including **fallen fruit** (M10c). No rescue mechanics,
   enforced by the D5 and H7 tests.
6. [ ] **Separate ecology RNG stream** plus a creation-only flora stream.
   Tick-0 terrain and resources are unchanged for existing seeds (D6).
7. [ ] **Schema v5 → v6 migration** with hash-staggered ages and a real v0.1
   fixture.
8. [ ] **Acceptance structure:** hard gates H1–H9 block shipping; balance
   targets B1–B10, with review thresholds, guide tuning. Scarcity, local
   collapse and rare rule-following deaths are permitted.
9. [ ] **Observable outcomes O1–O4** measured in the sweep, and the
   forage-near-camp and nearest-ripe-bush metrics on the dashboard.
10. [ ] **Performance gates** (§7.9).
11. [ ] **M10a → M10d sequencing**, each committed separately. M10e (the
    Wonder prototype) is optional and approved separately after M10d.
12. [ ] **M13 housing design** (headroom, overcrowding-as-demand, household
    assignment) accepted as the direction; implementation is not part of
    M10.

---

## Change log

**Revision 2:**

- **IDs:** investigated the shared ID allocator (§6.0, §6.4). M10a now adds
  no sim events, so boundaries are UI-derived. Added `nextEventId` in v6 and
  determinism tests D1–D7.
- **Acceptance:** split into hard gates H1–H9 and balance targets B1–B10
  with review thresholds. Zero deaths and forage near camp are now balance
  targets.
- **Ecology:**
  - Pioneer trees, with `species` reserved.
  - Fallen fruit and a shared `tryGerminate`.
  - Controlled collapse-and-recovery tests.
  - No-rescue metamorphic test.
  - `nearestRipeBushSteps` metric.
  - Sweep metrics for O1–O4.
- **Data models:** households reserved for M13; R12 and R13 added.
