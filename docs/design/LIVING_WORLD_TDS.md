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
| Construction | A seedling tile can be chosen and is cleared. No *germination* inside the clearing, while pre-existing plants there are kept and stay harvestable. Dense-forest scenario still houses everyone. |
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
| H3 | Bounds and invariants every tick: `0 ≤ amount ≤ max ≤ stage cap`; stage consistent with age; `dead` only for wood with `diedTick` set; no plant on water or rock, a structure tile or a planned site; **every germination** lands outside the clearing *at the moment it germinates* (checked on each birth; existing plants inside the clearing are valid, see §7.11); plant counts never above the safety cap; all M9 invariants. |
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

### 7.11 Issues recorded during M10a, for M10b

**Issue 1 — finite lifespans before reproduction.** M10b adds aging and
death; reproduction arrives only in M10c. A build containing M10b alone
would let every plant die with no renewal. On these numbers bushes would be
gone in about 44 days and trees in about 150. Decision for M10b:

- Keep M10b and M10c as **separate development commits** with their own
  tests, as approved.
- **Gate plant death until M10c.** M10b ships stages, caps, aging, deadwood
  sprites, the decay ledger and the v6 schema, with death **disabled by
  default**: plants reach *old* and stay there.
  - The gate is a field of an `EcologyRules` object passed to
    `updateEcology`. Its defaults come from `sim/constants.ts`
    (`PLANT_DEATH_ENABLED = false` in M10b), and tests pass rules with death
    on to cover death, deadwood and rot.
  - It is a code constant, not save state, so it never needs a migration.
- M10c turns the default on in the same commit that adds seeding and fallen
  fruit. The M10c sweep gates (§7.6) are the first run with both.
- **No ecology build is released**, meaning the README, the playable page
  and the default branch's demo, between M10b and M10c. The playable page
  stays on M10a until M10c passes its gates.
- Because M10b changes state (new fields, stage caps), the D1 golden test is
  retired in M10b either way, as planned.

**Issue 2 — existing resources inside the settlement clearing.** Measured
on the v0.1 generator (33 seeds: `sweep-0…29`, `little-worlds`, `m9-check`,
`golden-island`):

| When | Seeds with plants within Manhattan 2 of a structure | Plants (bushes / trees) | Plants on a structure tile |
|---|---|---|---|
| Tick 0 (campfire only) | 28 / 33 | 30 / 33 in total (about 2 per seed) | 0 |
| Day 30 (campfire + shelters) | 33 / 33 | 117 / 170 (about 9 per seed, about 51 units) | 0 |

The plants are there at tick 0 because the generator clears only the camp
tile. By day 30 there are more, because `chooseSite` requires only the
*site* tile to be free, so shelters go up next to existing plants.

Consequences for the specification, corrected above:

- The clearing is a **germination rule only**. It is evaluated when a seed
  or fallen fruit tries to germinate and is never a state invariant. H3 is
  reworded so that each germination is checked at birth.
- **Existing plants inside the clearing are valid.** They age, die, seed
  and are harvested like any other. Validation never rejects them, the
  v5→v6 migration leaves them untouched, and seed stability (D6) is
  unaffected, because the tick-0 map keeps them.
- Their seeds can land outside the clearing and germinate there. Seeds
  landing inside are rejected. Over a plant lifetime the clearing therefore
  empties naturally, with nothing removed by rule. A plant counts towards
  crowding wherever it stands.
- A new shelter's clearing may cover plants that were already there.
  Nothing happens to them: germination simply stops near the new shelter.
- Test (M10b/M10c): a world whose clearing already holds plants migrates,
  validates and keeps them, and no birth ever lands inside any clearing that
  existed at that tick.

### 7.11a M10b as implemented (checkpoint)

- **The senescence gate covers old age *and* death**, not death alone. The
  approved wording, "plants reach old and stay there", would itself have run
  the ecology down. Every bush would be old (cap 4, half fruiting) by about
  day 35, and every tree old (no wood growth) by about day 112. With the
  gate off, plants age but stay mature, which is v0.1 behaviour exactly.
  This is verified by `golden.test.ts`, which matches 25 checkpoints against
  id-independent behaviour hashes from the pre-M10b simulation.
- **D1 byte parity is retired** as planned. Its role passes to behaviour
  parity. D6 seed stability (tick-0 terrain and resources) still holds.
- **H6 staggering is guaranteed, not just likely.** Purely random ages
  clumped: on one seed, 12.5% of bushes would die on the same day. Initial
  and migrated ages now redraw, deterministically and with bounded attempts,
  any draw that would put more than 10% of a kind on one death day.
- **Migration** was tested on a real v0.1 save (`fixtures/m9-save-v5.json`,
  written by the pre-M10b code). Every plant is kept, including those inside
  the clearing. Ages are staggered, ids are unchanged, and the world
  continues with exact behaviour parity for 30 days.
- **Not done** (superseded by the Population V1 priority change): stage
  sprites in the renderer (no non-mature plant can occur while the gate is
  off), and the seedling site claim, which only matters once germination
  exists (M10c).

### 7.11b M10c as implemented

**Migration v7 → v8 (protecting established worlds).** Before M10c, plants
kept ageing while senescence was off. In real Population V1 saves every
plant was already past its lifespan: 119 of 119 at day 900 and 128 of 128
at day 2,160, and 23 of 119 even in a day-26 v6 save. Switching senescence
on would have killed them all at the first dawn. The v8 migration gives
every living mature plant a fresh lifespan and an age in its mature window,
relative to the save's day (hash of seed, `v8:` salt, tile and attempt).
Ages are staggered so that at most 10% of a kind share a death day.
Positions, kinds, amounts, caps and everything outside plants are unchanged.
This was tested on real 30- and 60-citizen v7 villages: none past its life,
the first dawn kills at most 10%, conservation holds every tick for 30 days,
and save/resume is exact. v5 and v6 saves migrate through it.

**Tuning changed from §7.2, with evidence:**

| Constant | Spec | Shipped | Why |
|---|---|---|---|
| `SEED_MIN_UNITS.berries` | 3 | **1** | At 60 citizens every bush was stripped daily, so none held 3 at dawn. The stock aged out and the village starved: 60 → 0 in 80 days. This is risk R2's fallback; a bush picked bare (0) still can't spread. |
| `SEED_CHANCE_PERMILLE.berries` | 120 | **200** | With threshold 1 alone, the 60-citizen village still fell 60 → 10. |
| `CROWD_MAX.berries` | 2 | **1** | With easier seeding, crowding 2 let bushes reach the safety cap on 2 of 7 runs. At 1, density is limited naturally (0 cap hits). |
| `SEASON_GERMINATION‰` | spring flush, no winter | **not implemented** | Functional seasons are out of scope for M10c. |

**Results** (`npm run sweep:ecology`; hard gates asserted every tick). All
gates held: conservation, plant invariants, no germination in clearings,
safety cap never reached, and exact save/resume.

| Run | Population | Needs deaths | Bushes | Trees | Forage trip (steps) | Forage-near-camp zero episodes |
|---|---|---|---|---|---|---|
| 30 new worlds × 120 d | 12 → 19–22 | 0 | ×1.3–3.2 (median 2.1) | ×0.36–0.96 (median 0.65) | — | — |
| 4 new worlds × 400 d | 12 → 24–30 | 0 | 27–42 → 48–65 | 79–91 → 60–80 | 8–9 | 0 |
| pop-12 × 400 d | 12 → 29 | 0 | 37 → 66 | 108 → 74 | 8.7 | 0 |
| pop-30 (v7) × 400 d | 30 → 39 | 0 | 31 → 66 | 88 → 39 | 10.2 | 0 |
| pop-60 (v7) × 400 d | 60 → 60 | 0 | 28 → 30 (range 28–50) | 100 → 91 (54–114) | 13.9 | 12 (longest 31 d), all recovered |

In every case the worst single dawn killed at most 7% of plants. Worst
satiety was 21–28.

**Balance targets missed, for review (not correctness):**

- **Bushes rise above the 60–160% band** in small villages. v0.1 places
  bushes sparsely, and reproduction fills the island up to the crowding
  limit. More food supports larger villages.
- **Trees fall below the 70–140% band.** The initial cohort ages out over
  about 120 days, then trees hold a stable equilibrium at about 60–80% of
  v0.1's dense forests, lower near busy villages (pop-30: 39–48), under
  chopping and the clearings round many shelters. No run showed a continuing
  decline.
- **Large villages see recoverable local scarcity** near camp. This is
  intended (GDD §3.10).

Performance: `step` takes 0.19–0.29 ms with 12–40 citizens and 0.52 ms at 60
(Population V1: 0.50).

### 7.12 Note: 100× speed (added in M10a)

At 100× (500 ticks/s) the M10 budget of 0.25 ms per tick costs about 12.5%
of the main thread at 12 citizens. A dawn tick (≤ 2 ms) runs twice a second.
The §6.3 budgets for larger populations (1.5 ms at 100 citizens) would
exceed a frame at 100×, so the controller's per-frame cap (20 ticks) slows
it down instead. This is acceptable, but it should be measured when
populations grow (M13).

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

## 8. Population V1 specification (schema v7)

**Scope:**

- ages and life stages;
- deterministic founder ages;
- partnerships;
- births;
- children as real citizens;
- coming of age;
- old-age death;
- household-aware housing with expansion that cannot deadlock;
- a population cap (60);
- life events;
- an archive of the dead;
- population dashboard and charts.

**Out of scope:** genetics beyond trait blending, pregnancy, education,
religion, wildlife, disease, politics, multiple villages and ecology
changes. Plant senescence stays off.

### 8.1 Data model (v6 → v7)

```ts
Citizen += {
  bornTick: number                       // may be negative (founders); age = floor((tick − bornTick) / TICKS_PER_YEAR)
  parentIds: [number, number] | null     // null for founders
  partnerId: number | null               // mutual; cleared when either dies
  childIds: number[]                     // ascending
  lastChildTick: number | null           // birth spacing per parent
}
DeathCause += 'oldAge'
SimEventKind += 'born' | 'cameOfAge' | 'partnered'      // 'died' carries cause 'oldAge'
MemoryKind += 'childBorn' | 'partnered'
PersonRecord { id, name, role, bornTick, diedTick, cause, parentIds, partnerId, childIds }
WorldState += {
  archive: PersonRecord[]                // the long dead (≤ ARCHIVE_MAX, oldest dropped)
  population: { rng: RngState; counters: { births, oldAgeDeaths, partnerships, comingOfAge, archived } }
}
HistorySample += { children?, adults?, elders?, births?, deaths? }   // optional: absent before v7
```

**Migration v6 → v7:**

- Every citizen gets an adult `bornTick`, derived from a hash of seed and
  id (ages 18–36, birthday spread over the year), with no RNG state.
- `parentIds` is null, `partnerId` null, `childIds` [] and `lastChildTick`
  null for every citizen.
- `archive` starts as [], and `population.rng` is seeded with
  `seed#population@tick`. The counters start at 0.
- History samples are kept unchanged.

### 8.2 Streams and order

- **`population.rng` (own stream):** used for birth rolls, child names,
  roles and personality variation, and old-age rolls.
- **Founder ages** come from the creation-only `seed#founders` stream, so the
  creation draws on `state.rng` are unchanged. The founders' names, roles,
  positions and personalities are identical to v0.1.
- **System order:**
  `time → needs (death) → ecology → lifeCycle (dawn only) → construction → decide → act → history`.
- The dawn `lifeCycle` pass runs in this order:
  1. birthdays: coming of age, then the old-age roll;
  2. partnerships;
  3. births;
  4. household assignment;
  5. archiving.

  Everything is iterated in ascending id.

### 8.3 Rules (constants in `sim/constants.ts`)

- **Ages:**
  - Stage thresholds: `ADULT_AGE` = 14, `ELDER_AGE` = 50.
  - `MAX_AGE` = 65.
  - Old-age hazard on each birthday from 50: `floor(1000·k²/256)‰`, where
    k = age − 49. That is 3‰ at 50, 140‰ at 55, 472‰ at 60 and certain at 65.
- **Partnership (daily):**
  - Both adults, alive, unpartnered and not kin (parent, child or sibling).
  - Mutual affinity ≥ 30 and familiarity ≥ 30, where `PARTNER_AFFINITY` is
    30. Friendship is 50, so this is deliberately reachable.
  - Pairs are formed greedily by combined affinity (ties by ids). There is no
    roll: partnering is a consequence of the relationship.
- **Birth (daily, per couple):**
  - both partners are alive and aged 16–42;
  - at least one partner has a home whose residents are fewer than
    `SHELTER_CAPACITY + MAX_OVERCROWD` (3 + 2);
  - stockpile food ≥ `BIRTH_FOOD_PER_CAPITA` (3) × living;
  - living < `MAX_POPULATION` (60);
  - neither partner had a child in the last `BIRTH_SPACING_DAYS` (48);
  - then a `BIRTH_CHANCE` roll of 40‰.

  **No spare bed is needed.** A birth may overcrowd a home, and that creates
  housing demand.
- **Child:**
  - Spawns on a housed parent's tile and lives in that parent's home.
  - Name: an unused name from the pool, drawn from `population.rng`.
  - Personality: the parents' average ± up to 0.1 per trait.
  - Role: decided at birth by village demand (the least represented adult
    role; explorers capped at 2) and used from adulthood.
  - Needs as adults, but satiety decays at `CHILD_SATIETY_FACTOR` (0.6).
  - Actions are limited to eat, rest, socialize and wander. Wander is
    centred on the campfire with radius 4. Other actions score 0, and their
    jitter is still drawn, so the RNG draw count stays fixed. Food a child
    eats is counted in `ledger.foodEaten` like anyone else's.
- **Coming of age (birthday 14):** a `cameOfAge` event, then an immediate
  re-decision with the full action set. Elders don't explore.
- **Natural death:**
  - Applies `killCitizen(…, 'oldAge')`, which records witnesses, drops any
    goods carried (to the ledger) and re-assigns homes.
  - The partner becomes free to partner again.
- **Housing:**
  - `housingDeficit = living + apartCouples + headroom − capacity`.
  - `headroom = HOUSING_HEADROOM` (3) while the village is **prosperous**:
    stockpile food ≥ 5 × living and living < `MAX_POPULATION`.
  - Assignment runs at dawn and on deaths and completions, in this order:
    1. remove the dead;
    2. reunite couples: one partner moves to the other's home if it has a
       free bed, else both move to a shelter with 2 free beds;
    3. children follow a housed parent (overcrowding allowed up to the
       limit);
    4. lodgers (adults with no child or partner in their home) move out of
       overcrowded homes into free beds;
    5. the homeless fill free beds, in id order.
- **Archive:** one world year after death, a citizen moves to `archive`.
  Other citizens' relationship records about them are dropped. The archive
  holds at most `ARCHIVE_MAX` (400) people, oldest dropped first.
- **Bounded growth:**
  - The population is capped at 60, and site capacity around camp limits
    housing.
  - Births stop when food per capita, homes or ages don't allow them.
  - Old age always ends a life by 65.
  - Nothing reads colony distress in order to *add* people: no rescue
    births.

### 8.3a As implemented: refinements

- **Headroom needs a couple.** Building ahead while nobody could yet have
  children cost builders energy in week 1 (the needs balance test dropped
  to a minimum of 19.9 against its floor of 20). Headroom now requires
  prosperity *and* at least one couple.
- **Outer site ring.** The M5 site ring (3–6 tiles, walk ≤ 12) holds only
  about 10 shelters, which capped housing at about 30 beds: a day-1,050
  village had a deficit of 18 and no site. Site choice now falls back to an
  outer ring (≤ 10, walk ≤ 20) once the inner ring is full. A 23×23 test
  fits 20+ shelters with every route kept open.
- **Rules switch.** `SimRules.population` (default on) lets the behaviour
  parity tests run with the population rules off, still matching the
  pre-M10b simulation exactly.
- **Archive and memories.** A memory may name an archived person, so its
  subject is validated as an id rather than as a listed citizen.
  Relationships about archived people are dropped.

### 8.3b Results (Population V1 as shipped)

**Population sweep: 12 seeds × 50 world years** (`npm run sweep:population`),
with hard gates checked every tick. Every gate held on every seed:

- conservation;
- bounds;
- no teleporting;
- age, needs and child-task limits;
- mutual partners;
- residents ≤ 5;
- archive ≤ 400;
- exact save/resume at year 50.

| Milestone | Day range | At nominal 100× (500 ticks/s) |
|---|---|---|
| first partnership | 6–12 | ≈ 3–6 s |
| first birth | 9–25 | ≈ 4–12 s |
| first coming of age | 681–697 | ≈ 5.4–5.6 min |
| first old-age death | 789–1,154 | ≈ 6.3–9.2 min |
| founding generation gone | 1,672–1,977 | ≈ 13.4–15.8 min |

In the production build, headless with software rendering, 100× measured
419 ticks/s with 12–14 villagers and 362 with 41: frames hold at about
20 fps and hit the 20-ticks-per-frame cap. Real-time figures are therefore
about 20–40% longer; for example, the first birth became visible after
13.6 s.

**Trajectories:**

- A food-limited plateau of 23–32 villagers for about 15 years. Children
  eat but don't gather, so stockpile food settles near the birth threshold.
- When the first children come of age, the workforce grows and births
  resume. By year 20 the seeds differ widely (31–50), and by year 25 they
  are at 41–60.
- **Every seed reaches the 60-citizen cap by about year 35–40 and stays
  there.** By year 50 each seed has had 60 births and 12 deaths (all
  founders, of old age), and up to 3 generations.

**100-year runs (4 seeds):**

- 120 births and 72 deaths each, all of old age, with 0 needs deaths.
- 5 generations.
- Dips as cohorts age out, for example 60 → 53 → 60 around years 80–95.
- Saves at most 483 KB, the archive at 71–72, and at most 53 relationship
  records per citizen: all flat between year 50 and year 100. Memory and
  saves are bounded.

**Balance finding (for review, not tuned in V1):** under the default
balance, food and housing limit growth only in the first 15–20 years.
After that, the **population cap is the binding constraint**, so
long-run populations are nearly the same on every seed, and decline
happens only as mild dips when cohorts age out. More varied long-run
outcomes need a scarcity source that scales with population. Seasonal
food (M11) and the living ecology (M10c, re-enabling senescence) are the
planned ones. Lowering food per bush or raising child food needs would
also work, but would change v0.1 balance.

**Other figures:**

- Standard sweep with population on (30 × 30 days, 3 × 100 days): 0
  deaths, worst satiety 26.4, all housed by a median of day 2. 100-day
  villages reach 18–20, and save/resume is exact.
- Performance: `step` takes 0.10, 0.24 and 0.50 ms at 12, 30 and 60
  citizens (budgets 0.3, 0.8 and 1.6).

### 8.4 Deadlock freedom

- Births need only a housed parent with an overcrowd margin, not a spare
  bed.
- Every birth raises `living`, so it raises `housingDeficit`.
- Partners living apart raise the deficit until they share a home.
- The planner builds whenever the deficit is above 0, there is a site and
  wood allows.

There is therefore no state in which births are blocked only because no home
exists and none will be planned. Births can still stop for other reasons:
food, ages, the cap, or no available sites.

### 8.5 Validation and acceptance

**Hard gates:**

- determinism and save/resume across births, birthdays and deaths;
- conservation every tick, including food eaten by children;
- valid v1–v7 migrations;
- seed stability (tick-0 map);
- bounds: population ≤ 60, ages ≤ 65, residents ≤ 5 per shelter, archive
  ≤ 400, bounded save size;
- the controlled scenarios in §8.6;
- performance at 12, 30 and 60 citizens (`step` ≤ 0.3, 0.8 and 1.6 ms).

**Balance targets** (multi-seed report; growth and decline are both
allowed):

- the first birth by year 2 on most seeds;
- founders replaced (any founder-descended living citizen) on most seeds by
  year 50;
- no seed extinct before year 20 under normal conditions;
- a spread of population trajectories;
- no starvation deaths under normal conditions.

### 8.6 Controlled scenarios (tests)

- A birth happens when all conditions hold and is blocked by each condition
  alone.
- A child eats (ledger), grows up at 14, takes a role and works.
- An elder dies of old age by 65.
- A couple reunites in one home.
- A birth into a full home creates housing demand, and a new shelter
  follows.
- A lodger moves out.
- Old age widows a partner, who can partner again.
- Archiving prunes relationships and keeps saves bounded.
- No citizen is left without a decision after a stage change.

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
