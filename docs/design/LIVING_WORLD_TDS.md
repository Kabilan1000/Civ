# Little Worlds — Living World Expansion
## Technical Design Specification (preproduction draft for review)

Status: **draft for review — nothing here is implemented.** It is the
companion to [`LIVING_WORLD_GDD.md`](LIVING_WORLD_GDD.md), whose §1–5 and §8
cover game design and the roadmap. This document holds §6 (architecture)
and §7 (detailed M10 specification). All rules in [`CLAUDE.md`](../../CLAUDE.md)
still apply. Where this document proposes changing how a rule is applied, it
says so explicitly.

---

## 6. Technical architecture

### 6.0 What exists today (v0.1, schema v5)

These parts of the current code shape the design:

| Area | Current behaviour | Consequence for the expansion |
|---|---|---|
| `map.resources[i]` | `{kind, amount, max}` or `null`. Plants never die. A plant at 0 stays and regrows. | M10 extends `ResourceNode`. AI and renderer already treat `amount ≤ 0` as "nothing to gather". |
| `systems/resources.ts` | Stateless regrowth: `tick % 48` (berries) / `% 160` (wood), +1 for every node below max. | Replaced by `systems/ecology.ts`. Regrowth stays stateless but depends on stage. |
| Map generation | Moisture and elevation exist only during generation. Resources are placed with the map RNG. | Habitat uses terrain alone. Plant ages come from a **separate** derived stream so the tick-0 map is unchanged. |
| `map.version` | Bumped by every gather and regrowth. The renderer re-bakes **only if terrain or fog changed**, otherwise it just syncs sprites (O(tiles)). | Germination, stage changes and deaths are cheap sprite updates. No re-bake. |
| `ResourceSprites` | One sprite per node, with textures by fill level (`b0–b6`, `t0–t4`). | Add stage textures: seedling, young, old and snag. |
| AI context | Scans all tiles per decision for the nearest node with `amount > 0` (BFS distance). | Seedlings are naturally ignored. At 100+ citizens this scan needs an index (§6.7). |
| `chooseSite` | Requires `resources[tile] === null`. | M10 allows seedling tiles (0 units) to be claimed. |
| Ledger + conservation test | Checked every tick. | Add `foodDecayed`/`woodDecayed` (§6.6). |
| Saves | SaveStore over localStorage; v5 ≈ 105 KB at day 30, 155 KB at day 100. | M10 adds about 8 KB (§7.8). Populations (M13) need relationship caps and archiving. |

### 6.1 Proposed TypeScript data models

Only the **M10** shapes are normative for implementation, once approved.
The M12–M14 shapes are reserved designs, listed so that M10 doesn't paint
them into a corner.

```ts
// ── M10 (schema v6) ─────────────────────────────────────────────────────────
export type PlantStage = 'seedling' | 'young' | 'mature' | 'old' | 'dead'

export interface ResourceNode {
  kind: ResourceKind            // 'berries' | 'wood'  (unchanged)
  amount: number                // whole units, 0..max (unchanged)
  /** Cap for the current stage; stored so AI/renderer stay stage-agnostic. */
  max: number
  stage: PlantStage
  /** May be negative: plants older than the world. Age = tick − bornTick. */
  bornTick: number
  /** Whole days; rolled at germination (or assigned at creation/migration). */
  lifespanDays: number
  /** Tick of death (stage 'dead', trees only); null while alive. */
  diedTick: number | null
}

export interface EcologyCounters {      // cumulative since world creation (or migration)
  births: { berries: number; wood: number }
  deaths: { berries: number; wood: number }
  seedsCast: number
}

export interface EcologyState {
  /** Dedicated sfc32 stream: ecology never perturbs the AI stream (and vice versa). */
  rng: RngState
  counters: EcologyCounters
}

export interface Ledger {
  // ...existing seven fields...
  /** Units that left the world on dying/old plants (bush death, old-age cap drop, snag rot). */
  foodDecayed: number
  woodDecayed: number
}

export interface HistorySample {
  // ...existing fields...
  /** M10+. Absent in samples recorded before the save was migrated (charts show a gap). */
  bushes?: number        // living berry bushes, all stages
  trees?: number         // living trees, all stages (snags excluded)
  seedlings?: number     // both kinds
  snags?: number
  standingFood?: number  // berries currently on bushes
  standingWood?: number  // wood on living trees + snags
  forageNearCamp?: number // berries on discovered bushes ≤ 10 BFS steps from camp
}

export interface WorldState {
  // ...existing...
  ecology: EcologyState
}

// New SimEventKind members: 'seasonStarted' | 'yearStarted'   (data: {season, year})
// No per-plant events (they would flood the 200-event feed).

// ── Reserved: M12–M13 (schema v7+) — design only ────────────────────────────
interface CitizenLifeFields {
  bornTick: number
  parentIds: [number, number] | null
  partnerId: number | null
  childIds: number[]
  lineage: string               // family tag shown in the UI
}
type DeathCause = 'starvation' | 'exhaustion' | 'oldAge'
interface PersonRecord {        // archive of the long dead
  id: number; name: string; role: Role
  bornTick: number; diedTick: number; cause: DeathCause
  parentIds: [number, number] | null; partnerId: number | null
  notableEventIds: number[]     // ≤ 3
}
interface YearSummary {         // chronicle, one per world year
  year: number; popStart: number; popEnd: number
  births: number; deaths: number; built: number; ruined: number
  bushes: number; trees: number
  notable: { tick: number; kind: string; citizenIds: number[] }[] // ≤ 8
}
// WorldState.archive: PersonRecord[]; WorldState.chronicle: YearSummary[] (≤ 200)

// ── Reserved: M14 ───────────────────────────────────────────────────────────
// Structure += { condition: number; builtTick: number; lastRepairTick: number;
//                salvageWood: number }   StructureStage += 'ruin'
// Ledger += { woodUsed: number }          (repairs)
```

**Shape rules respected:** plain JSON, ids not references, integers wherever
possible. `max` and `stage` are stored rather than derived so that
validation, the renderer and the AI need no knowledge of the calendar.

### 6.2 System update order

Current: `time → needs (death) → resources → construction → decide → act → history`.

```
1. time          advanceTime; at day start also seasonStarted / yearStarted   (M10)
2. needs         satiety/energy/social/health; starvation & exhaustion death
3. ecology       (M10, replaces resources)
                   every tick:  stage-aware regrowth (stateless modulo timing)
                   at dawn:     age → stage transitions, deaths, snag rot,
                                seed casting & germination (ecology RNG)
4. lifeCycle     (M12/M13) birthdays: natural-death hazard; daily household birth check
5. construction  planning, staging, abandonment; (M14) decay, ruins
6. decide        utility AI (unchanged pipeline)
7. act           tasks: movement, gathering, social, (M14) repair/salvage
8. history       samples (+ecology fields); (M12) chronicle year roll-up
```

**Why ecology is in slot 3:** it is the same slot as today's regrowth, so the
AI sees the dawn's new seedlings and dead plants in the same tick, and the
conservation check (after `step`) sees a complete ledger.

**Dawn work:** dawn work runs at tick-of-day 0 (06:00), when most citizens
are asleep, so mid-task surprises are rare. A plant dying under a forager is
handled by the existing `gather` guard: `!node || amount <= 0` ends the task.

### 6.3 Performance budgets

These are measured headless in Node with the same method as `npm run sweep`.
"Now" is the M9 result.

| Citizens | `step()` avg | Worst single tick (dawn) | Save size @ 100 days | Frame (1×, browser) | Notes |
|---|---|---|---|---|---|
| 12 | **≤ 0.25 ms** (now 0.145–0.166) | ≤ 2 ms | ≤ 175 KB (now 155) | ≤ 16.7 ms | M10 target |
| 50 | ≤ 0.8 ms | ≤ 4 ms | ≤ 450 KB | ≤ 16.7 ms | needs a resource index + relationship cap (M13) |
| 100 | ≤ 1.5 ms | ≤ 6 ms | ≤ 900 KB | ≤ 16.7 ms at 1×; 10× may shed resolution | adaptive decision interval; virtualised citizen list |
| 200 | ≤ 3 ms | ≤ 10 ms | ≤ 1.8 MB (needs compression) | sim in a Web Worker | localStorage quota (~5 MB) is the hard wall |

The ecology system alone must cost ≤ 0.03 ms per tick on average, and ≤ 1 ms
on the dawn tick, for a 36×24 map.

### 6.4 Deterministic randomness

- **Streams.** There are two streams in M10: `state.rng` (AI, unchanged) and
  `state.ecology.rng`.
  - **New worlds:** the ecology stream is seeded with
    `seedRng(seed + '#ecology')`.
  - **Migrated saves:** it is seeded with
    `seedRng(seed + '#ecology@' + tick)`, which is deterministic for a given
    save.
  - Later streams (`population`, `structures`) follow the same pattern.
  - Separate streams mean ecology tuning never changes the AI's draw
    sequence, and the reverse. Tests can then isolate each system.
- **Initial plant ages** are drawn from a third, *creation-only* derived
  stream, `seedRng(seed + '#flora')`, after map generation, in ascending tile
  order. The tick-0 terrain and resources for every existing seed are
  therefore **identical** to v0.1. A test pins this with a hash of the v0.1
  map for several seeds.
- **Iteration order** is ascending tile index for every ecology pass. The
  seed-casting order is fixed (tiles ascending, berries pass then wood pass),
  and germination conflicts within one dawn are resolved first come, first
  served in that order.
- **Integer arithmetic only:** suitability and chances are integers in
  [0, 100] or per-mille, compared with `nextInt(rng, 0, 999)`. There is no
  `Math.pow`, `exp` or trigonometry (rule 2). Ages are in whole days.
- **Player inputs (Hand phase, later)** become a serializable
  `inputs: {tick, kind, args}[]` log. Replay = seed + inputs.

### 6.5 Versioned save migration

- **v5 → v6 (M10):**
  1. For each resource node, in ascending tile order, set `stage = 'mature'`,
     keep `amount` and `max`, and set
     `lifespanDays = berries ? 28 + h % 17 : 90 + h % 61` and
     `bornTick = tick − ageDays·240`. The age `ageDays` is drawn from the
     mature window, `matureStart + h % (matureEnd − matureStart)`. Here
     `h = hash32(seed, tileIndex)` (an integer FNV-1a hash; no RNG state
     involved). Ages are therefore **staggered**, so there is no synchronous
     die-off (risk R1).
  2. Set `diedTick = null`.
  3. Add `ledger.foodDecayed = 0` and `woodDecayed = 0`.
  4. Add `ecology` with zeroed counters and the migrated RNG stream (§6.4).
  5. Keep history samples unchanged. Their ecology fields stay absent; the
     past is not fabricated, matching the v4→v5 precedent.
- **Validation** (`validateWorld`):
  - `stage` must be in the enum.
  - `amount` and `max` must be integers with `0 ≤ amount ≤ max ≤ KIND_MAX`.
  - `max` must match the stage's cap: equal for non-dead stages, ≤ for
    snags.
  - `lifespanDays` must be an integer in [1, 1000].
  - `diedTick` must be non-null exactly when `stage === 'dead'`, and `dead`
    is only allowed for wood.
  - The counters must be non-negative integers.
- **Fixtures:** add `m9-save-v5.json`, a real v0.1 save at about day 20. It
  must load, migrate, run 30 days with conservation checked, and round-trip.
  All older fixtures (v2, v3, v4) must still load through v6.
- **Policy (unchanged):** a newer save is refused, a damaged one is marked,
  and a world is swapped in only after full validation.

### 6.6 Interaction with existing systems

| System | M10 change | Rule touched |
|---|---|---|
| Resources/terrain | Terrain is unchanged. Plants appear, age and die on the existing `resources` array. | 11: bump `map.version` on any germination, stage change, death or rot. |
| Conservation | `foodDecayed`/`woodDecayed`. Germination adds 0 units. Stage cap drops send the excess to decay. Snag rot is −1 unit to decay. | 13: identity extended, still checked every tick. |
| Pathfinding | None. Plants are not solid. | 5, 14 |
| Walk-mask / frontier caches | Unaffected: they key on structures and on `discovered` respectively. Germination does not change `discovered`. | 16 |
| AI | Unchanged scoring. `amount > 0` already excludes seedlings and bare plants. Snags count as wood (they have `amount > 0`). Remembered-spot memories of a dead bush simply stop matching. | 6, 17 (no fabricated memories of plant deaths) |
| Construction | `chooseSite` treats a seedling tile as free and removes the seedling (0 units) when the site is planned. Germination never targets the settled clearing or planned sites. | 14 |
| Events | `seasonStarted` and `yearStarted` only, formatted in the UI. | 10 |
| History | Optional ecology fields in samples (§6.1). The 600-sample cap is unchanged. | — |
| Renderer | `ResourceSprites` gains textures `bs` (bush seedling), `ts` (tree seedling), `ty0..ty2` (young), `to1..to4` (old: muted canopy) and `td0..td4` (snag). The level key is derived from `stage`. `sync` already handles nodes appearing and vanishing. A seasonal tint is a container tint on the terrain layer (M11). | 15 (no overlays), 12 |
| UI | Clock shows the season and year. Dashboard ecology card and an Ecology chart. All text is formatted in the UI. | 7, 10 |
| Selectors | `ecologySummary(state)` (counts by kind and stage, standing units, forage near camp). It is pure and covered by tests. | 12 |

### 6.7 Known migration and scaling risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Synchronous die-off** of migrated or initial plants that all share a birth date | Hash- or RNG-staggered ages over the mature window. Test: in the first 60 days no single dawn kills more than 10% of either kind. |
| R2 | **Forage death spiral:** near-camp bushes are picked bare, can't seed and die, so foragers walk further and food falls | Bands in the sweep acceptance; `forageNearCamp` tracked; seeding threshold is tunable (`BUSH_SEED_MIN_FRUIT`); far bushes keep reseeding. Fallback if needed: seeds can also come from bushes holding ≥ 1 berry. |
| R3 | **Forest crowds out shelter sites** | Settled clearing, seedling-claimable sites, trees on grass at only 15/40 suitability. The sweep requires housing by median day ≤ 3. |
| R4 | **Runaway or extinct populations** | Crowding plus a safety cap, and seed thresholds. 400-day runs check that counts stay within the bands; the sweep fails if the cap is ever hit. |
| R5 | **Cross-version divergence confusion** | Docs and README state that saves resume under new rules, while seeds keep the same island. |
| R6 | **Save growth** (4 new fields × ~130 nodes) | About 8 KB; budget ≤ 175 KB at 100 days. Field names stay short only if needed (not planned). |
| R7 | **Sprite churn** costs frame time | Germination and deaths happen a few times a day; `sync` is O(tiles) only on a version change. Measured in the soak. |
| R8 | **O(n²) relationships at 50–200 citizens** (M13) | Cap at 32 records per citizen, evicting by lowest familiarity. Archive the dead. Decide at M13. |
| R9 | **Per-decision full-map scans** (BFS + resource scan) at 100+ citizens | A per-kind node index cached on `map.version`; a bounded BFS radius; staggered decision intervals that scale with population. |
| R10 | **localStorage quota** at 200 citizens | Archive, relationship caps, optional compressed save format (a SaveFile `fileVersion` bump), and a quota error surfaced by SaveStore (already a result object). |
| R11 | **Dawn spikes** at larger maps | Ecology dawn work is O(plants); if needed, spread it across the first 20 ticks by tile index modulo (still deterministic). |

---

## 7. Detailed M10 specification

**Scope (only):** calendar foundation; natural appearance of bushes and
trees; growth and aging; natural disappearance; habitat constraints;
observable regeneration; a basic ecology dashboard.

**Not in M10:** wildlife, citizen aging or reproduction, gods or player
influence, settlement decay, seasonal fruiting or need changes, new speeds
and terrain change.

M10 ships as four sub-milestones (GDD §8): **M10a → M10d**, each committed
separately with its own tests.

### 7.1 Exact mechanics

**Calendar (M10a)** — new `sim/calendar.ts`, pure functions of `tick`:

```
dayIndex     = floor(tick / 240)                  (existing)
year         = floor(dayIndex / 48) + 1
dayOfYear    = dayIndex % 48                       0..47
seasonIndex  = floor(dayOfYear / 12)               0 spring, 1 summer, 2 autumn, 3 winter
dayOfSeason  = dayOfYear % 12 + 1                  1..12
```

`advanceTime` pushes `seasonStarted {season, year}` on a day start where
`dayOfSeason === 1`, and additionally `yearStarted {year}` when
`dayOfYear === 0`. Tick 0 emits neither (`worldCreated` covers it). The UI
formats the date as `Spring 3, Year 1 · 14:42`.

**Stages (M10b)** run at dawn, for each node in ascending tile order:

```
ageDays = floor((tick − bornTick) / 240)
stage   = seedling  if ageDays < SEEDLING_DAYS[kind]
          young     if ageDays < MATURE_AT_DAYS[kind]
          mature    if ageDays < floor(lifespanDays × OLD_AT_PERMILLE[kind] / 1000)
          old       if ageDays < lifespanDays
          → death   otherwise
```

- **On a stage change:** set `max = STAGE_MAX[kind][stage]`. If `amount` is
  above the new max, the excess goes to `ledger.<kind>Decayed`.
- **Death:**
  - Bush: its remaining berries are added to `foodDecayed`, the tile becomes
    `null` and `deaths.berries` is incremented.
  - Tree: it becomes a snag (`stage 'dead'`, `diedTick = tick`,
    `max = amount`) and `deaths.wood` is incremented. A tree at 0 wood that
    dies is removed immediately.
- **Snag rot:** every `SNAG_ROT_DAYS` days after `diedTick`, remove 1 wood to
  `woodDecayed`. At 0 the tile becomes `null`.

**Regrowth (every tick)** keeps the stateless modulo timing:

```
full rate: tick % INTERVAL[kind] === 0
half rate: tick % (2 × INTERVAL[kind]) === 0
rate by stage: seedling none · young half · mature full · old half (berries) / none (trees) · dead none
```

Each eligible node below `max` gains +1, recorded in `foodRegrown`/`woodRegrown`
exactly as today.

**Seed casting (M10c)** runs at dawn after the stage pass, as a berries pass
then a wood pass, in ascending tile order:

```
eligible if stage ∈ {mature, old} and amount ≥ SEED_MIN_UNITS[kind]
chance‰  = SEED_CHANCE‰[kind] × SEASON_GERMINATION‰[season] / 1000   (old: × 1/2)
if nextInt(eco, 0, 999) < chance‰:
    seedsCast++
    dx, dy = nextInt(eco, −R, R), nextInt(eco, −R, R)   (R = DISPERSAL_RADIUS[kind]); skip (0,0)
    t = target tile; reject if out of bounds
    reject unless: resources[t] === null
                   suitability(kind, t) > 0
                   not a structure tile / planned site
                   Manhattan distance to every structure > SETTLED_CLEARING
                   crowding(kind, t) ≤ CROWD_MAX[kind]
                   population(kind) < SAFETY_CAP‰[kind] × landTiles / 1000
    germinate if nextInt(eco, 0, 99) < suitability(kind, t):
        resources[t] = {kind, amount: 0, max: 0, stage: 'seedling', bornTick: tick,
                        lifespanDays: nextInt(eco, LIFE_MIN[kind], LIFE_MAX[kind]), diedTick: null}
        births[kind]++; map.version++
```

The number of RNG draws per cast is fixed (chance, dx, dy; then suitability
and lifespan only if the tile is valid). Snags count towards tree crowding.
Seedlings created this dawn count towards crowding for later casts in the
same dawn.

**Suitability** (integer, 0–100; uses the terrain table in GDD §3.5):

- berries: `base(terrain)`, with sand counting only when it is 4-adjacent to
  grass. If 3 or more of the 8 neighbours hold trees (including snags), take
  `× 40 / 100` (floored).
- wood: `base(terrain)`; on grass, 40 if 2 or more of the 8 neighbours hold
  trees, else 15.

**Initial ages (M10b, new worlds)** are assigned after `generateMap`, in
ascending tile order, using the `#flora` stream:

- `lifespanDays = nextInt(LIFE_MIN, LIFE_MAX)`
- `ageDays = nextInt(MATURE_AT, floor(lifespan × OLD_AT / 1000) − 1)`
- `bornTick = −ageDays × 240`

All initial plants start **mature with v0.1 amounts**, so day-1 balance is
unchanged.

**Seedling site claim:** when `chooseSite` evaluates a tile holding a
seedling, the tile counts as free. Planning the site sets the tile to
`null`; no units are involved.

### 7.2 Tunable parameters (all in `sim/constants.ts`) and rationale

| Constant | Berries | Wood | Rationale |
|---|---|---|---|
| `SEEDLING_DAYS` | 2 | 6 | Sprouts are visible for a few days at 10× (about 10–30 s). |
| `MATURE_AT_DAYS` | 5 | 20 | Bushes are pioneers (forage recovers within a season); trees take more than a season. |
| `OLD_AT_PERMILLE` | 800 | 750 | Visible old age before death; old trees are long-lived landmarks. |
| `LIFE_MIN`/`LIFE_MAX` (days) | 28 / 44 | 90 / 150 | Bush mean 36 days (3 seasons); tree mean 120 days (2.5 years). Turnover of about 0.9/day each is visible but slow. |
| `STAGE_MAX` young / mature / old | 3 / 6 / 4 | 4 / 8 / 8 | Mature equals v0.1 (`BERRY_MAX`, `TREE_WOOD_MAX`), so near-term balance is unchanged. |
| Regrowth interval | 48 (unchanged) | 160 (unchanged) | Keeps M9's food balance: 32.2 regrown/day. |
| `SEED_MIN_UNITS` | 3 | 4 | Stripped plants can't seed (the overharvest loop, GDD §3.9). |
| `SEED_CHANCE‰` | 120 | 50 | See the equilibrium arithmetic in GDD §3.6. |
| `DISPERSAL_RADIUS` | 3 | 2 | Bushes hop; forests creep. |
| `CROWD_MAX` (8-neighbourhood) | 2 | 5 | Patchy forage, dense but not solid forest. |
| `SEASON_GERMINATION‰` sp/su/au/wi | 1500 / 1000 / 1000 / 0 | same | Spring flush, winter rest. Average 875‰ per year. |
| `SNAG_ROT_DAYS` | — | 4 | A dead tree with 8 wood lingers about a month: visible and harvestable. |
| `SETTLED_CLEARING` | 2 | 2 | Keeps camp, rest ring and doorways open. Shelter sites are at 3–6. |
| `SAFETY_CAP‰` of land | 200 | 450 | A backstop that must never be hit in sweeps. |
| `FORAGE_NEAR_CAMP_STEPS` | 10 | — | Dashboard pressure metric. |

These are starting values. M10c tunes them against the §7.6 criteria using
sweep evidence, and records any change with a one-line reason next to the
constant, as M9 did.

### 7.3 Data structures

As in §6.1, the M10 block. New modules:

- `sim/calendar.ts`
- `sim/systems/ecology.ts` (replaces `resources.ts`)
- `sim/ecology/habitat.ts` (suitability and crowding, pure)
- `sim/ecology/flora.ts` (stage tables, initial ages, hashing)
- `selectors.ecologySummary`
- UI: `Dashboard` ecology card, an `HistoryCharts` "Ecology" chart, and
  `format/text.ts` date formatting
- Render: stage textures in `ResourceSprites`

### 7.4 Test plan

| Layer | Tests (Vitest, co-located unless cross-cutting) |
|---|---|
| Calendar | Year, season and day boundaries at ticks 0, 239, 240, 2879, 2880, 11519, 11520. Events are emitted once per boundary and never at tick 0. Formatting includes late night across a season boundary. |
| Stages | Each threshold transition per kind. `max` follows the stage. Excess on a cap drop goes to decay. Bush death removes it and decays its fruit. Tree death makes a snag. Snag rot timing; snag removal at 0. A 0-wood tree dying is removed directly. |
| Regrowth | Half and full rates by stage. Seedlings and old trees never regrow. The ledger counts equal the units added. |
| Dispersal | Each rejection rule in isolation (bounds, occupied, suitability 0, structure, planned site, clearing, crowding, cap). Seasonal multiplier (no winter germination). Fixed RNG draw count. Same-dawn crowding order. |
| Habitat | Table values; sand-next-to-grass; shade on bushes; forest-edge trees on grass. |
| Construction | A seedling tile can be chosen and is cleared. Germination never lands within the clearing. Housing is still completed in a controlled scenario with dense forest around camp. |
| AI | Seedlings are never targeted. Snags are chopped. A forager whose bush dies mid-trip re-decides with no error. |
| Conservation | Extended identity checked **every tick** over 100 days on several seeds, including dawn ticks with deaths and rot. |
| Determinism | Same seed ⇒ identical `serialize()` after 60 days. Save at a dawn tick, resume, compare. The ecology stream doesn't perturb the AI stream: with germination disabled via a test sandbox constant, the AI RNG trace matches. |
| Seed stability | The tick-0 terrain and resource kinds/amounts hash equal to the v0.1 values for 5 pinned seeds. |
| Migration | `m9-save-v5.json` → v6: staggered ages (no dawn kills more than 10%); counters 0; continues 30 days with conservation; round-trips. Older fixtures load. Validation rejects each malformed new field. |
| Architecture | `calendar.ts` and `ecology/` contain no forbidden imports or globals (the existing test covers new files automatically). |
| Performance | Ecology ≤ 0.03 ms/tick average; dawn tick ≤ 1 ms; `step` ≤ 0.25 ms with 12 citizens (soft, as now). |
| UI/format | Date strings; ecology card numbers from the selector; history chart handles missing ecology fields (a gap, not zero). |
| Render (logic) | Level keys for every stage and fill level; `sync` adds and removes sprites on germination and death. |
| Browser | Extend the 14-point check: sprouts appear and old trees become snags at 10×; the ecology card updates; the season shows in the clock. 30-minute soak at 10× with heap and DOM flat. |

### 7.5 Sweep additions (`npm run sweep`)

- **30 seeds × 120 days** (2.5 years). This replaces the 30-day pass, which
  stays as a quick option.
- **3 × 400 days** (8.3 years) for equilibrium, with save/resume checked at
  day 400.
- New per-seed figures: plant counts by kind and stage at day 1, 60 and 120;
  births and deaths; worst single-dawn death share; peak-to-trough
  oscillation; `forageNearCamp` minimum; the safety cap hit flag; and food
  regrown per day.
- Estimated runtime: about 30×120×240×0.2 ms ≈ 175 s plus 3×400×240×0.2 ms
  ≈ 58 s, so under 5 minutes, close to today's 346 s.

### 7.6 Multi-seed acceptance criteria (M10 ships only if all hold)

Survival and village (no regression from v0.1):

1. 0 deaths across 30 seeds × 120 days and 3 × 400 days.
2. Worst satiety ≥ 20 (M9: 26.4) and worst energy ≥ 20.
3. 30/30 seeds fully housed, median day ≤ 3; 0 abandoned sites.
4. Food regrown per village per day averaged over days 1–120 within ±25% of
   32.2.

Ecology works and is observable:

5. Every seed has births > 0 **and** deaths > 0 of **both** kinds by day 60.
6. Day-120 counts within bands of their day-1 counts: trees 70–140% and bushes
   60–160%, on **every** seed.
7. In 400-day runs, over days 200–400, each kind stays within ±30% of its
   mean (bounded oscillation), with no extinction.
8. No single dawn kills more than 10% of either kind (no synchronous
   die-off).
9. The safety cap is never hit.
10. `forageNearCamp` never stays at 0 for more than 3 consecutive days on any
    seed (no camp starvation zone).

Integrity:

11. Conservation every tick; invariants as in M9; determinism and save/resume
    are exact at day 120 and day 400.

Performance:

12. Performance as in §7.9.

### 7.7 Player-visible changes

- **Clock:** `Spring 3, Year 1 · 14:42`. The tooltip shows the absolute day
  and explains the season. Season and year events appear in the feed under
  the Time filter.
- **Map:**
  - Tiny sprouts appear around mature plants, mostly in spring.
  - Young plants are smaller.
  - Old trees have a muted canopy.
  - Dead trees stand as grey snags that shrink as they rot and as builders
    chop them.
  - Bushes drift away from heavily foraged areas over seasons, and forest
    edges creep onto grass.
- **Dashboard ecology card:** bushes, trees, seedlings and snags, each with
  births and deaths over the last 10 days; standing food and wood; and
  "Forage near camp".
- **History:** a new *Ecology* chart (bushes and trees) and a *Standing food*
  line.
- **README:** a "Living land" section and the replay note in GDD §2.7.
- **Unchanged:** controls, speeds, saving, citizen behaviour and inspector.

### 7.8 Save migration requirements

- Schema **v5 → v6** as in §6.5, with `SCHEMA_VERSION = 6`.
- The SaveFile `fileVersion` is unchanged: the envelope shape doesn't change.
- A v6 save in a v0.1 build is refused with the existing "newer version"
  message, which is already tested.
- Size: about 30 bytes × 4 fields × 130 nodes, roughly 16 KB raw. Target:
  ≤ 125 KB at day 30 and ≤ 175 KB at day 100.
- The autosave slot migrates on load like any slot. There is no background
  rewrite of stored saves.

### 7.9 Performance targets (M10)

| Metric | Target | M9 baseline |
|---|---|---|
| `step()` average, 12 citizens (sweep) | ≤ 0.25 ms | 0.145 ms |
| Dawn tick worst case | ≤ 2 ms | — |
| Ecology share of tick time | ≤ 0.03 ms average | — |
| Save @ 30 / 100 days | ≤ 125 / ≤ 175 KB | 105 / 155 KB |
| Browser 1× frame (headless, software GPU) | ≤ 16.7 ms median | 16.7 ms |
| Browser 10× frame | median ≤ 33.4 ms | 33.3 ms |
| 30-minute 10× soak | heap after GC flat (±1 MB), DOM flat after the caps fill, 0 errors | 9.6–10.4 MB, flat |

### 7.10 Risks and edge cases

- **Plant dies while targeted:** a forager walking to a bush that dies at
  dawn arrives to `null`, and the existing guard ends the task. A builder's
  reserved tile is the same. Test it.
- **Plant dies while being harvested:** dawn runs in slot 3, before `act`.
  The gather guard sees `null` or `amount 0` and ends the task, with no unit
  created or lost. Conservation holds.
- **Germination under a citizen:** allowed, since plants are not solid. The
  citizen simply stands on a sprout.
- **Germination on the campfire tile, a shelter, a site or a work tile:**
  prevented by the clearing rule. Work tiles are inside the clearing because
  they are adjacent to structures.
- **Seedling on a tile chosen as a site in the same tick:** construction
  (slot 5) runs after ecology (slot 3). `chooseSite` clears the seedling, so
  this is deterministic.
- **Undiscovered growth:** a forest grows in the fog. When it is revealed,
  sprites appear at full brightness. The renderer already dims under fog.
  Discovering a tile never changes ecology.
- **Very small islands or odd seeds** (21 bushes, the minimum): bands are
  relative, and `MIN_START_BERRY_TILES` still applies at creation. The
  sweep's worst seed decides tuning.
- **Old saves near a season boundary:** dates are derived, so the first
  `seasonStarted` after load fires at the next boundary. No back-filled
  events.
- **Migrated plants:** with ages over the mature window, a few may enter old
  age immediately. Their max (bush 4) can drop below `amount`; the excess is
  decayed at the first dawn and recorded in the ledger.
- **Ledger overflow:** integers stay far below 2^53 over any realistic run.
- **History compatibility:** samples without ecology fields render as gaps.
  The chart's `null` handling is tested.
- **Feed flooding:** no per-plant events. Only 1 season event every 12 days.

---

### Review checklist (decisions needed before M10 starts)

1. Season length 12 days and year 48 days (§2.2 of the GDD), and the
   "season-years" age wording.
2. Trees become harvestable snags on death, rather than vanishing.
3. Stripped plants can't seed (the overharvest loop), with the R2 fallback.
4. Separate ecology RNG stream and the seed-stability guarantee for tick-0
   maps.
5. The M10a–d split and acceptance criteria §7.6 (especially bands 6–7).
6. Natural death ships only together with births (M13).
