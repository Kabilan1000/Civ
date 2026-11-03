# Little Worlds — Living World Expansion
## Game Design Document (preproduction, revision 2)

Status: **design for review — nothing here is implemented.** M10's direction
and four-part structure are conditionally approved. This revision answers
the first review (change log at the end). The companion technical
specification is [`LIVING_WORLD_TDS.md`](LIVING_WORLD_TDS.md). The shipped
v0.1 design is [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

Baseline figures come from the v0.1 code and the M9 sweep (30 seeds × 30
days, 3 × 100 days):

- Islands have about 538 land tiles (312 grass, 167 forest, 59 sand).
- 33 berry bushes (21–43) and 93 trees (76–99) at creation.
- Villages gather 32.6 food/day, eat 24.1 and regrow 32.2; 0 deaths.

**Decision status** used below:
**[approved]** · **[proposed]** (needs approval before M10) ·
**[deferred to review]** (not decided; belongs to a later design review).

---

## 1. Game identity

### 1.1 Player fantasy

> *You are something new on an island at the edge of the mist. Before you
> can touch the world, you have to understand it.*

The player is a young, nameless presence bound to one island (working name
**the Hollow**; all names are placeholders). Twelve settlers wake on its
shore with one ember and no memory of how they came. They live entirely by
themselves.

There are two acts:

1. **The Witness.** You watch a civilization and its land grow from nothing,
   and learn them well enough to care.
2. **The Hand.** Slowly and at a cost, you gain indirect influence in a
   world whose rules you've learned by watching. Your acts become part of
   its history and its people's beliefs.

**Long-term vision:** a hybrid of an *autonomous civilization simulator* and
a *fantasy god-strategy game*. The civilization never needs the player to
survive. Power is narrow, indirect and earned. The most interesting thing on
screen is always what the people and the land do.

**Inspiration:** the premise is inspired by the *Lost World* idea in *The
Nebula's Civilization* (an isolated small world developing under a nascent
power's watch). Only that premise-level inspiration is taken. Setting,
names, characters, cosmology, powers and mechanics are original. A review
step renames anything that resembles the source.

### 1.2 Core gameplay loop

**Witness phase (M10–M14):**
watch → notice a story, pressure or pattern → inspect (why is she walking so
far for berries? why is the grove dying?) → record and anticipate (follow,
bookmark, fast-forward, save) → watch.

The loop works because the simulation produces **legible causes**. The
inspector already explains every citizen decision. From M10 the land has
visible causes too (§3.11).

**Hand phase (after the prototype in §1.6 validates it):**
understand a pressure → spend scarce influence on an indirect nudge → the
world responds through its own rules → citizens remember what happened →
their beliefs change what you can do next.

### 1.3 What makes Little Worlds different

| Typical civilization / god games | Little Worlds |
|---|---|
| The player is the civilization's brain. | The civilization has its own. The player is an outsider with limited reach. |
| Powers from the start. | Powers are earned, after a long phase in which the world evolves alone. |
| Citizens are interchangeable workers. | Individuals with personality, needs, relationships and memories; every decision is explained. |
| History is a log. | History is emergent and personal; memories refer to real events. |
| Random worlds. | Deterministic: seed + inputs reproduce a history exactly. |
| Static land. | Living land: forage moves, groves age, and the village shapes its ecology and is shaped by it. |

### 1.4 The player before and after divine powers

- **Before (Witness):** the player has no influence on the simulation.
  - Time controls.
  - Inspection: citizens now; later tiles, families and buildings.
  - Following, bookmarks, a chronicle, saves and seeds.
  - This phase is where attachment forms. Its test is whether a player can
    tell a story about their world after an hour.
- **After (Hand):** these constraints are fixed now so that later work
  doesn't block them:
  - **Indirect:** powers act through the world's own systems, never on a
    mind.
  - **Scarce:** each costs an earned resource (working name **Wonder**).
  - **Remembered:** witnesses form real memories (rule 17).
  - **Deterministic:** each act is a recorded input at a tick. Inputs are
    the only non-seeded influence on the world.

### 1.5 How emergent histories become meaningful

A history matters when it has **continuity**, **causality** and **stakes**:

- **Continuity:** families (M12–M13); buildings that last, decay and are
  rebuilt (M14); named places. Long-lived trees that outlive people belong
  to a later phase (§3.3). M10's pioneer trees live 2–3 world years.
- **Causality:** overharvest thins forage near camp, routes lengthen, and new
  patches become the village's larder (§3.11). Deadwood draws builders into
  old groves.
- **Stakes:** scarcity, local ecological collapse, later death and ruin.

**No scripted story events and no rescue mechanics.** Every story is a
reading of real state.

### 1.6 Indirect-intervention prototype (cheap test of the god fantasy) [proposed]

Before committing to M11–M14, test whether *indirect* influence is fun and
legible. The prototype uses only systems that already exist after M10.

- **What:** one power, **Scatter Seeds**.
  - The player picks a discovered tile, and the world casts up to 6 berry
    seeds within radius 2.
  - Each seed goes through the normal germination rules (habitat, crowding,
    clearing, safety cap). Nothing is forced.
  - New plants start with 0 berries, so food still arrives only through
    counted regrowth, days later. **No resources are created.**
- **Cost:** 1 charge, regained at the start of each season (a prototype
  stand-in for Wonder).
- **Determinism:** each use is recorded as
  `inputs: {tick, kind:'scatterSeeds', tile}[]` and applied at the start of
  the next tick. Replay = seed + inputs.
- **Memory:** citizens within the witness radius when the sprouts appear
  gain a real `sawWonder` memory.
- **Isolation:** it sits behind a URL flag (`?prototype=wonder`). Saving is
  disabled while the flag is on, so no schema change is needed. Build it as
  a throwaway branch or a flag that is removed afterwards.
- **Questions it must answer** (5 or more playtesters; observe, don't
  coach):
  1. When forage near camp collapses, does the player think of intervening?
  2. Within one in-game season, can they see a causal effect? Citizens
     re-routing to the planted patch is shown by trip-distance and
     new-plant share (§3.11).
  3. Does the delay (days until fruit) feel meaningful or frustrating?
  4. Does scarcity of charges create interesting choices?
- **Keep / kill criteria:**
  - **Keep:** at least 4 of 5 testers notice the effect without
    explanation, and at least 3 of 5 report wanting more powers.
  - **Kill or redesign:** testers can't tell their action mattered.
- **Timing:** after M10d, as optional **M10e**, a timebox of a few days. It
  is not part of the M10 approval.

---

## 2. World calendar

### 2.1 Existing model (unchanged) [approved]

- 1 tick = 6 minutes and 240 ticks = 1 day. Tick 0 = day 1, 06:00. `step`
  increments `tick` first.
- Night runs 23:00–06:00. Needs are tuned per tick against this day.

**The 240-tick day does not change.**

### 2.2 Seasons and years [approved for M10]

| Unit | Length | Ticks | At 1× | At 10× |
|---|---|---|---|---|
| Day | 240 ticks | 240 | 48 s | 4.8 s |
| Season | 12 days | 2,880 | 9.6 min | 58 s |
| Year | 4 seasons = 48 days | 11,520 | 38 min | 3.8 min |

- The seasons are Spring, Summer, Autumn and Winter. Day 1 is Spring 1,
  Year 1.
- Season and year are **pure functions of `tick`**. There is no new stored
  state and no new sim events (§2.7; TDS §6.4).
- They are displayed as `Spring 3, Year 1 · 14:42`.

### 2.3 Citizen aging and reproduction timescales [deferred to review]

Age terminology (the earlier "season-years" idea) and life-stage thresholds
are **not decided**. They belong to the population design review before
M12. Constraints that review must respect:

- Lifespans, stage ages and the generation interval must be consistent with
  plant lifespans (§3.3) and with what can be observed within a session
  (§2.5).
- Any timescale must work with the 240-tick day and the needs balance.
- The review must also decide whether citizen ages are shown in world years
  (48 days) at all, or in another unit.

### 2.4 Time acceleration

- **100× shipped with M10a** (user request; 500 ticks/s, about 7.5% of a
  core at 12 citizens). This replaces the proposed 30× speed. The controller
  runs at most 20 ticks per frame, so 100× needs about 25 fps or more; on
  slower frames it runs as fast as frames allow and drops the backlog rather
  than spiralling.
- **M11 [proposed]:** a **"seasons pass"** mode: the sim runs as many ticks as fit in about
  6 ms per frame, with interpolation off. It can optionally auto-pause on
  chronicle events.
- "Seasons pass" is still needed before generations (M13) can be watched.
  It is not part of M10.

### 2.5 Observing change within sessions

| What | Ticks | At 10× | At 100× (at 25+ fps) | Seasons pass (est.) |
|---|---|---|---|---|
| A season | 2,880 | 58 s | 5.8 s | ~1–5 s |
| A bush's life (~36 days) | 8,640 | 2.9 min | 17 s | ~3–15 s |
| A pioneer tree's life (~120 days) | 28,800 | 9.6 min | 58 s | ~10–48 s |
| One world year | 11,520 | 3.8 min | 23 s | ~4–19 s |

M10's ecology is fully observable at today's 10×. The timescales for
citizen generations wait for the population review (§2.3).

### 2.6 Implications for food, energy, sleep and survival

- **M10:** seasons affect **germination only** (a spring flush, no winter
  germination). Fruit yield, need decay and night length are unchanged.
- **M11 [proposed]:** seasonal fruiting (summer more, winter much less), a
  winter stockpile target in the AI, and slow food spoilage.
- **Night length stays fixed**, deferred indefinitely. Winter can be shown
  by a tint.
- **Balance target:** hardship shows as longer trips, rationing and
  arguments, not die-offs. Deaths under unusual conditions are allowed
  outcomes (§3.10, TDS §7.6).

### 2.7 Save compatibility and deterministic replay [approved]

- Dates are derived from `tick`, so v0.1 (schema v5) saves get correct dates
  without migration.
- **M10a changes no simulation state at all.** Season and year boundaries
  are presented by the UI (clock, event-feed separators, chart bands), not
  stored as events.
  - Adding events would draw from the shared ID counter. That shifts every
    later citizen, structure, memory and event ID and pushes other events
    out of the 200-event window.
  - Behaviour would be unchanged (IDs only break ties and keep their
    relative order), but saves would differ. Details are in TDS §6.4.
- **Within a version**, seed + tick (+ inputs) ⇒ identical `serialize()`.
- **Across versions**, a save **resumes** under the new rules; it doesn't
  replay v0.1's future.
- **Seed stability:** M10 keeps the tick-0 terrain and resource placement
  for every existing seed. New per-plant data comes from separate derived
  RNG streams.

---

## 3. Living ecology

### 3.1 Regrowth versus reproduction [approved]

- **Regrowth (production):** a living plant produces units (berries, wood)
  at a rate and cap set by its life stage. Every unit is counted in the
  ledger.
- **Reproduction (population):** mature plants cast seeds. A seed becomes a
  plant only on a suitable, uncrowded tile. Plants age and die.
- New plants start with **0 units**. Resources enter the world **only**
  through counted regrowth, never by spawning.

### 3.2 Berry bush lifecycle

| Stage | Age | Max berries | Fruiting | Seeds |
|---|---|---|---|---|
| Seedling | 0–2 days | 0 | — | no |
| Young | 2–5 days | 3 | half rate | no |
| Mature | 5 days to 80% of life | 6 (as today) | full (1 per 48 ticks) | if holding ≥ 3 berries at dawn |
| Old | last 20% | 4 | half | half chance |
| Death | at 28–44 days | removed; remaining berries decay (ledger) and may fall as seed (§3.10) | | |

### 3.3 Trees: M10 has pioneer trees only [proposed]

**Inconsistency resolved.** The first draft gave trees 90–150 days (about
2–3 world years) while claiming that trees outlive generations. Both can't
be true. Revised design:

- **M10's trees are pioneer trees:** fast-growing, short-lived woodland, the
  kind that colonises clearings and forest edges. This is all of v0.1's 93
  starting trees.
  - A lifespan of 90–150 days (about 2–3 world years) is deliberate: forest
    turnover is visible at 10× within a session (about 10 minutes per tree
    life).
  - The GDD no longer claims any M10 tree outlives people.
- **Long-lived trees are deferred** (proposed for after M13, alongside the
  population timescales). Examples would be an "elder tree" species with a
  lifespan of many world years, slow growth and shade that suppresses
  pioneers. They become the landmarks that outlive generations, once those
  timescales are decided.
- **M10 stays small:**
  - There is no species field.
  - Future species are added by a later migration that sets
    `species: 'pioneer'` on every existing wood node.
  - M10's per-kind tables become per-species tables then. TDS §6.1 reserves
    the field name.

| Stage (pioneer tree) | Age | Max wood | Growth | Seeds |
|---|---|---|---|---|
| Seedling | 0–6 days | 0 | — | no |
| Young | 6–20 days | 4 | half rate | no |
| Mature | 20 days to 75% of life | 8 (as today) | full (1 per 160 ticks) | if holding ≥ 4 wood at dawn |
| Old | last 25% | 8 | none | yes |
| Dead — **harvestable deadwood** [approved] | after 90–150 days | the wood it holds | rots 1 unit / 4 days (ledger) | no |

Chopping is unchanged: a tree chopped to 0 regrows (coppicing). Felling to
clear land is deferred.

### 3.4 Seed dispersal

- Once per day, at dawn, each seed-bearing plant rolls its seed chance,
  scaled by season.
- A seed lands on a random tile within radius 3 (bushes) or 2 (trees).
- It germinates only if the tile:
  1. is free and in bounds;
  2. is suitable for that kind (suitability above 0);
  3. is outside the settled clearing and not a structure or planned site;
  4. passes the crowding limit;
  5. is under the safety cap;
  6. wins a roll against its suitability.

### 3.5 Habitat suitability (0–100)

| Terrain | Berries | Pioneer trees |
|---|---|---|
| grass | 100 | 15, or 40 at a forest edge (≥ 2 tree neighbours) |
| forest | 30 (shade) | 100 |
| sand | 15 if next to grass | 0 |
| rock, water | 0 | 0 |

Shade: a bush candidate with 3 or more tree neighbours drops to 40% of its
suitability. Moisture and fertility layers are deferred until a mechanic
reads them.

### 3.6 Competition and carrying capacity

- One plant per tile, and plants never displace each other.
- Crowding limits over the 8 neighbours: trees ≤ 5, bushes ≤ 2.
- Carrying capacity emerges from free suitable tiles, crowding and lifespan:
  - Trees: about 93 trees with a mean life of 120 days give about 0.8
    deaths/day. About 70 seed-bearers × 5% = 3.5 seeds/day need about 23%
    success to replace them.
  - Bushes: about 33 bushes with a mean life of 36 days give about 0.9
    deaths/day. About 25 bearers × 12% = 3 seeds/day need about 30%
    success.
- **Safety cap** (a hard bound, not tuning): trees ≤ 45% and bushes ≤ 20% of
  land tiles. Hitting it in the default sweep is a tuning failure.

### 3.7 Spawning, disappearance and the settlement

- Plants appear only by germination and disappear only by natural death
  (bushes vanish; trees become deadwood that rots or is chopped).
- **Settled clearing:** no germination within Manhattan distance 2 of any
  structure, or on a planned site.
- Shelter site selection may claim a seedling tile (it holds 0 units), so
  growth never blocks housing.
- **Existing plants inside the clearing stay.** The clearing only blocks
  *new* germination. v0.1 worlds already have plants there: on 28 of 33
  measured seeds at tick 0, and on every seed by day 30, because shelters are
  built next to plants. They are never removed, invalidated or migrated
  away (TDS §7.11).
- The ecology runs island-wide, including in the fog. Citizens still act
  only on discovered, reachable tiles.

### 3.8 Conservation

The ledger gains `foodDecayed` and `woodDecayed`. The identity is checked
every tick:

```
map + carried + stockpile + eaten + lost + decayed = initial + regrown      (food)
map + carried + stockpile + held by structures + lost + decayed = initial + regrown   (wood)
```

### 3.9 Stripped plants cannot spread [approved]

A bush needs at least 3 berries at dawn to seed, and a tree at least 4 wood.
A bush picked bare every day therefore never reproduces. This is the
pressure that makes the village's foraging shape its land.

### 3.10 Ecological collapse and natural recovery [proposed]

**Principle.** The rules are the same whatever state the colony is in.
**Nothing reads the village's need in order to help it:**

- no spawning tied to hunger, stockpiles or population;
- no minimum-resource guarantees after world creation;
- no refills.

Collapse is allowed when it follows from the rules, and recovery has to come
from the rules as well.

**How local collapse happens.** Foragers take the nearest bush with berries.
Near-camp bushes are stripped daily, never seed, and age out over about one
bush lifetime (≈ 36 days). A **forage-poor zone** forms around camp and
trips get longer.

**Why it is usually local and recoverable.** Demand is about 24 berries/day,
while ≈ 33 mature bushes can regrow up to about 165/day. Only about 5
heavily used bushes are needed to feed the village, so **most bushes go
unharvested on any given day, keep their fruit and keep seeding.**

**Natural recovery mechanisms** (all ordinary rules, applied everywhere):

1. **Rest regrowth.** A stripped bush regains 5 berries a day. One day
   without harvest takes it back to the 3-berry seeding threshold. Pressure
   that moves elsewhere lets plants recover.
2. **Recolonisation from the unharvested ring.** Bushes beyond the
   foraging frontier seed inwards (radius 3; maturity in 5 days). Seedlings
   that land in the forage-poor zone grow and fruit, so the zone keeps
   being restocked even while the plants in it are harvested.
3. **Fallen fruit.** When a bush dies still holding berries, each berry has
   a small chance to germinate on its own or an adjacent tile, under all the
   normal rules. The berry itself still leaves the world as decay, and the
   new plant starts at 0. Neglected patches re-seed themselves; stripped
   ones don't. That is consistent with §3.9.
4. **Gap regeneration.** A dead or rotted tree frees space, which relaxes
   crowding and shade for the seedlings around it.
5. **Behavioural relief** (existing AI): foragers already choose the nearest
   bush *with berries*. As a zone empties, pressure moves outwards to
   bushes that can carry it.

**What is allowed to happen.** Longer trips, a forage-poor camp zone lasting
a season, a thin year after a harsh spring, and in rare seeds hunger or a
death. These are balance outcomes to measure, not correctness failures
(TDS §7.6). An island-wide loss of all bushes under default tuning would
mean the tuning is wrong. It is a balance failure to fix, not something to
patch with a rescue rule.

### 3.11 Observable ecological outcomes (gameplay, not decoration) [proposed]

Each outcome has a measurable signal, so the sweep can show that it happens
and a player can see it.

| # | Outcome | What the player sees | Measured by (sweep; dashboard where noted) |
|---|---|---|---|
| O1 | **Foraging routes change when local bushes disappear** | Foragers head further out, and the inspector shows longer "heading to" trips; the camp zone looks bare. | Mean BFS steps from camp to the bush chosen for foraging, per 10 days. Expected to rise as near-camp bushes die. Dashboard: "Nearest ripe bush: N steps". |
| O2 | **A new berry patch becomes a useful food source** | Sprouts appear, fruit a few days later, and foragers start visiting them; the patch is named in the citizen's memories ("found berries at …"). | Share of berries gathered from bushes that germinated after day 1. Target: rises to ≥ 30% by day 120. |
| O3 | **Forest aging and deadwood change wood gathering** | Grey deadwood appears in old groves; builders chop it, and the treeline shifts. | Share of wood chopped from deadwood (target ≥ 10% by day 120); mean distance of chop targets. |
| O4 | **A forage-poor zone forms and recovers** | Bushes thin near camp during heavy use and return as seedlings from the outer ring mature. | Episodes where `forageNearCamp` = 0, with their durations; time to recovery. |

### 3.12 Ecological balance targets

Balance targets are listed in TDS §7.6, separated from hard correctness
gates.

---

## 4. Population V1 [approved priority — next milestone]

> **Priority change (after M10a).** Population growth moves ahead of the
> living ecology, functional seasons and the other expansions. M10b is kept
> as a committed checkpoint: schema v6, with plant senescence gated off, so
> it behaves exactly like v0.1. Population V1 builds on it as schema **v7**.
> M10c and M10d resume after Population V1. The design that was deferred to
> a population review (§2.3) is decided here; the technical specification is
> TDS §8.

### 4.0 Population V1 in one paragraph

The 12 founders are adults with deterministic ages. Adults who like each
other form partnerships. A partnered household with a home and enough food
in the village has children now and then, always by explicit rules and
never as a rescue. Children are real citizens: they have names, parents,
ages and needs, they eat from the stockpile (counted in the ledger), and
they stay near camp with a small set of safe behaviours. At 14 they come of
age and join the workforce. At 50 they become elders, and from then on a
birthday may be their last; nobody lives past 65. Housing expands ahead of
need and when overcrowded, so births never deadlock. The population is
capped at 60. The dead are compacted into an archive after a year.

### 4.0a Timescales (decided)

Ages are in **world years** (48 days):

| Stage | Age | Notes |
|---|---|---|
| Child | 0–13 | Eats, sleeps, plays and chats near camp; no work. |
| Adult | 14–49 | Full roles. Can partner at 14; fertile 16–42. |
| Elder | 50+ | Works but does not explore. From 50, each birthday rolls an old-age hazard that rises to certainty at 65. |

The founders are 18–36. At 100× (about 2 days per second at full speed):

- the first child comes of age after about 672 days (about 6 minutes);
- the first old-age deaths come after about 7–9 minutes;
- the founding generation is gone within about 20 minutes.

Seeds differ: some villages grow, others stall or decline.

## 4b. Later population systems (design notes; refined by §4.0)

Timescales and terminology are deferred to the population review (§2.3).
The structures and rules below don't depend on those numbers.

### 4.1 Aging and natural death

- Citizens get `bornTick`; age and stage are derived from it.
- Natural death is an age hazard drawn from an integer table, rolled on
  birthdays. There is a new cause, `oldAge`.
- Natural death ships **only together with births** (M13), so worlds never
  just dwindle.

### 4.2 Partners, households, births and children

- **Partners:** two adults with high mutual affinity and familiarity form a
  bond. There is no sex or gender mechanic.
- **Household:** partners and their dependent children form a household.
  Single adults are households of one. A household is the unit that is
  housed (§4.4).
- **Birth gate:**
  - adult partners;
  - the household is housed (see §4.4 for overcrowding);
  - food in the stockpile ≥ a days-per-capita threshold;
  - population below the cap;
  - a minimum interval since the household's last birth;
  - then a small daily chance.
- **Children:** a blended and varied personality; dependent (no work); they
  follow a caregiver on real paths.

### 4.3 Family and genealogy

`parentIds`, `partnerId`, `childIds` and `householdId` are stored. Kinship
(siblings, grandparents, cousins) is derived from them. Relationships
between kin start with bonuses.

### 4.4 Housing for a growing population: resolving the deadlock [proposed]

**The deadlock, verified in v0.1 code:**

- `housingDeficit = living − shelters × 3` (`sim/structures.ts:76`).
- The planner acts only when the deficit is above 0
  (`sim/systems/construction.ts:35`).
- 12 citizens therefore get exactly 4 shelters with no spare beds. If births
  required spare housing, no birth could ever happen, so no deficit, and no
  new home.
- `assignHomes` also packs homeless citizens by id (`construction.ts:88`),
  ignoring family.

**Resolution (four parts; each alone breaks the deadlock, and together they
make it robust):**

1. **Proactive expansion (headroom).** The planner's target becomes
   `capacity ≥ living + headroom`, where
   `headroom = HOUSING_HEADROOM` (for example 3 beds, one shelter) when the
   village is *prosperous*. Prosperous means stockpile food ≥ a days-per-
   capita threshold and nobody homeless. Otherwise headroom is 0.
   Builders build ahead in good times, which gives growth a place to go.
2. **Births are gated on the household being housed, not on a free bed.**
   A birth may make a home **overcrowded** by one child. Overcrowding counts
   as housing demand (the deficit counts overcrowded beds), so a birth
   always creates planner demand. A world can never be stuck with no birth
   and no building.
3. **Household-aware assignment.** Homes are assigned per household:
   - Families take priority over single lodgers.
   - When partners bond, they move into a home with room for both (one
     partner's home if it has space, otherwise an empty shelter). Until
     then they are a **waiting household**, which adds demand.
   - Children live with a parent.
   - When a family grows, a single lodger in the same shelter moves to a
     free bed elsewhere first.
   - Grown children who form their own household move out, creating new
     demand.
4. **Bounded growth.** The planner never targets more than
   `MAX_POPULATION + headroom` beds, and it is limited by wood. Prosperity
   ending turns headroom off. Abandonment and decay (M14) handle surplus
   homes.

**Deadlock-freedom argument:** births need only a housed household.
Overcrowding and waiting households always raise demand. The planner always
builds while demand exceeds capacity and wood is available. So there is no
reachable state in which births are blocked only because no home exists and
none will be built.

**Tests (M13):**
- A fully housed 12-citizen prosperous village builds a headroom shelter.
- A birth in a full home creates demand that leads to a new shelter.
- Partners move in together.
- A lodger moves out for a growing family.
- Sweep: no household waits more than one season. Headroom is never built
  while food is scarce.

### 4.5 Compact historical records

The dead are compacted after one year into a `PersonRecord` (about 80
bytes). A per-year `YearSummary` (about 120 bytes) holds up to 8 notable
events chosen by fixed salience rules. The budget is under 100 KB for 100
years.

### 4.6 Population limits and performance

`MAX_POPULATION` starts at 60 (200 at most). Relationships are capped per
citizen before populations exceed about 30. The dead are archived. See TDS
§6.3 and §6.7.

---

## 5. Settlement evolution (M14; design only)

- **Condition:**
  - Shelters have condition 0–100. It decays by about 1 a day, faster when
    unoccupied, and faster in winter from M11.
  - Below 40, the home rest bonus is halved. Below 15, the shelter leaks and
    stops counting as housing.
- **Repair:** a `repair` action uses 1 wood and 20 labour for +20 condition.
  The wood goes to `ledger.woodUsed` (conserved).
- **Ruins:**
  - At condition 0 a shelter becomes a ruin. It is still solid (rule 14) and
    holds salvage wood.
  - Residents re-home through §4.4.
  - Salvage returns the wood to the stockpile.
  - An untouched ruin is overgrown after 60 days: the tile returns to the
    ecology and the wood decays.
- **Reconstruction:** the planner prefers ruin tiles (cleared land, with
  salvage counting towards the wood).
- **Growth and abandonment:** headroom building (§4.4) grows the village.
  Empty homes decay twice as fast. Camp relocation is deferred.

---

## 8. Production roadmap

**Revised after M10a (priority change):**

| Milestone | Status |
|---|---|
| M10a — Calendar, 100× | done |
| M10b — Plant life cycle | **checkpoint** (schema v6; senescence gated off; sprites and seedling site claim not done) |
| **Population V1** | **next** (schema v7; TDS §8) |
| M10c — Dispersal, habitat, recovery | after Population V1 (re-enables senescence together with reproduction) |
| M10d — Ecology dashboard | after M10c |
| M11+ | re-planned after Population V1 (seasons that matter, settlement wear, Hand phase) |

The original M10–M14 plan follows for reference.

### Original plan (M10–M14)

Every milestone must pass the following before it is committed:

- `npm test`, `npm run build` and lint;
- the sweep's **hard gates**;
- a report against its **balance targets** (TDS §7.6).

Schema changes ship with migrations and fixtures.

| Milestone | Scope | Gate summary |
|---|---|---|
| **M10a — Calendar** | Pure calendar functions; clock, feed season separators and chart season bands, **all UI-derived**. **No sim state, events or IDs change.** | `serialize()` byte-identical to the pre-M10a golden hashes; full suite. |
| **M10b — Plant life cycle** | Stages, aging, death, harvestable deadwood (pioneer trees), stage caps, decay ledger, staggered initial ages, schema v6 (+ a separate event-ID counter), sprites. | Conservation every tick; tick-0 map hashes unchanged; migration fixtures; staggered ages. |
| **M10c — Dispersal, habitat, recovery** | Seeding with thresholds, habitat, crowding, clearing, safety cap, seasonal germination, fallen fruit. | Hard gates plus a controlled collapse-and-recovery scenario; balance report. |
| **M10d — Ecology dashboard** | Ecology card, chart, forage-near-camp and nearest-ripe-bush metrics, sweep extensions (O1–O4). | All hard gates; balance targets met or explained; 30-min soak. |
| *M10e — Wonder prototype (optional)* | Scatter Seeds behind a flag; playtest (§1.6). | Keep/kill decision; no schema change. |
| **M11 — Seasons that matter, faster time** | Seasonal fruiting, winter stockpile behaviour, spoilage, tint, "seasons pass" (100× already shipped in M10a). | Balance: winters survivable under normal conditions; frame budget at 100×. |
| **M12 — Life course (data and view)** | Population review outcome (timescales and terms); `bornTick` and stages; partners; households (data only); archive and chronicle; tile and family inspector. Natural death **off**. | v6→v7 migration; bounded chronicle. |
| **M13 — Generations** | Births, children, natural death, §4.4 housing (headroom, overcrowding demand, household assignment), population cap, relationship cap, performance work. | Deadlock-freedom tests; population bounded; budget at 50 citizens. |
| **M14 — Settlement wear** | Condition, repair, ruins, salvage, reconstruction, abandonment. | Wood conserved; housing recovers; budget at 100 citizens (headless). |

### Deferred (complexity without enough gameplay yet)

- Wildlife and hunting.
- Terrain change (forest spreading as terrain, erosion, rivers).
- Moisture and fertility layers.
- Long-lived tree species (until the population timescales are decided).
- Felling, farming and planting by citizens.
- Seasonal day length.
- Multiple settlements, migration, trade, technology, combat.
- Genetics beyond trait blending; religion as a system before the Hand
  phase.
- Web Worker sim (only when 100+ citizens require it); larger maps.

---

## Change log

**Revision 2 (this review):**

- **Calendar:**
  - Seasons and years approved.
  - Age terminology and thresholds are now *deferred to the population
    review* (§2.3); the illustrative generation table was removed.
  - Season and year boundaries are UI-derived, with no sim events (§2.7).
- **Trees:** the inconsistency is resolved. M10 trees are *pioneer trees*
  (2–3 years). Long-lived species are deferred, with a reserved migration
  path (§3.3). Deadwood approved.
- **Collapse and recovery:** added §3.10. There are no rescue mechanics; five
  natural recovery mechanisms, including fallen fruit; collapse is a
  permitted outcome.
- **Gameplay outcomes:** added §3.11 (O1–O4 with metrics) and the Wonder
  prototype (§1.6, M10e).
- **Housing deadlock:** identified in code and resolved by headroom,
  overcrowding-as-demand and household assignment (§4.4).
- **Roadmap:** gates are split into hard gates and balance targets. M10a
  changes no state. Optional M10e added.
