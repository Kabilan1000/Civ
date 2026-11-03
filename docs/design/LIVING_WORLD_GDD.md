# Little Worlds — Living World Expansion
## Game Design Document (preproduction draft for review)

Status: **draft for review — nothing here is implemented.** The companion
technical specification is [`LIVING_WORLD_TDS.md`](LIVING_WORLD_TDS.md); it
holds data models, system order, budgets and the detailed M10 specification.
The shipped v0.1 design remains [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

Baseline numbers quoted here come from the v0.1 code and the M9 sweep
(30 seeds × 30 days, 3 × 100 days): about 538 land tiles per island (312 grass,
167 forest, 59 sand), 33 berry bushes (21–43) and 93 trees (76–99) at
creation; villages gather 32.6 food/day and eat 24.1; 0 deaths.

---

## 1. Game identity

### 1.1 Player fantasy

> *You are something new on an island at the edge of the mist. Before you
> can touch the world, you have to understand it.*

The player is a **young, nameless presence** bound to one island, called the
**Hollow** in this draft (all names are placeholders for review). The mist
that surrounds the Hollow is the edge of the world. Twelve settlers wake on
its shore with a single ember and no memory of how they came. They live
entirely by themselves.

The fantasy has two acts:

1. **The Witness.** You watch a civilization grow up from nothing. You learn
   its people, its land and its history well enough to care about them.
2. **The Hand.** Slowly, and at a cost, you gain the ability to intervene.
   You do it in a world whose rules you have learned by watching. Your
   interventions become part of the people's history and beliefs, so you have
   to live with the consequences.

**Long-term vision.** Little Worlds becomes a hybrid of an *autonomous
civilization simulator* and a *fantasy god-strategy game*. The civilization
never needs the player to survive. The player's power is narrow, indirect and
earned, and the most interesting thing on screen is always what the people do.

**On inspiration.** The premise is inspired by the *Lost World* idea in
*The Nebula's Civilization*: an isolated small world that develops while a
nascent power watches over it. We take only that premise-level inspiration.
Setting, names, characters, cosmology, powers and mechanics are original. As
a review step, any term or mechanic that resembles the source will be renamed
or redesigned.

### 1.2 Core gameplay loop

**Witness phase (now through M14):**

```
watch ─► notice (a story, a pressure, a pattern)
  ▲              │
  │              ▼
  │      inspect (why is she doing that? who are his parents?
  │               why are the berries gone near camp?)
  │              │
  │              ▼
  └──── record & anticipate (follow, bookmark, chronicle, fast-forward
                             to see how it turns out; save the world)
```

The loop works because the simulation produces **legible causes**. Every
behaviour can be explained by the inspector: needs, scores, memories,
relationships and, from M10, the state of the land. The reward is
understanding, plus the stories that come out of it.

**Hand phase (post-M14):**

```
understand a pressure ─► spend scarce influence on an indirect nudge
     ▲                                  │
     │                                  ▼
     └──── the world responds through its own rules; citizens remember
           what happened and form beliefs about it (which change what
           you can do next)
```

### 1.3 What makes Little Worlds different

| Typical civilization / god games | Little Worlds |
|---|---|
| The player is the civilization's brain. | The civilization has its own brain. The player is an outsider with limited reach. |
| Powers are available from the start. | Powers are **earned** and come after a long phase in which the world evolves on its own. |
| Citizens are interchangeable workers. | Citizens are individuals: personality, needs, relationships, memories and (later) family lines. The inspector explains every decision. |
| History is a log. | History is **emergent and personal**. It comes from real events, and citizens' memories refer to them. |
| Worlds are effectively random. | Worlds are **deterministic**: a seed and a tick reproduce a history exactly, so histories can be replayed, compared and shared. |
| The land is a static backdrop. | The land is **alive** (from M10): forests spread and age, forage moves, and the village shapes the ecology around it. |

### 1.4 The player before and after divine powers

**Before (Witness, M10–M14).** The player has no ability to change the
simulation. Their tools only affect how they observe:

- Time control: play, pause, 1×/3×/10×, and later a fast "seasons pass" speed
  (§2.4).
- Inspection: citizens today, plus later tiles, families and buildings.
- Following, bookmarks and a **chronicle** of notable events per year (§4.5).
- Save, load, restart and seeds.

This phase is not a tutorial to rush through. It is the point at which the
player becomes attached to the world. Its success test is whether a player
can tell a story about their world after an hour without being prompted.

**After (Hand, post-M14).** The design constraints for later powers are set
now so that M10–M14 don't block them:

- **Indirect.** Powers act through the world's existing systems, never on a
  citizen's mind. Examples: blessing a grove's growth (ecology), calling rain
  (seasons), a sign in the sky (memories and belief).
- **Scarce.** Powers spend an earned resource (working name **Wonder**). It
  is accumulated from what citizens actually experience and believe, not from
  a timer.
- **Remembered.** Every intervention is a real event that witnesses
  remember, so it becomes part of the history (rule 17).
- **Deterministic and serializable.** A power is an input recorded at a
  tick. Replaying a seed plus the recorded inputs reproduces the world.
  Player inputs are the **only** non-seeded influence on the simulation (§6
  of the TDS).

### 1.5 How emergent histories become meaningful

A history matters when it has **continuity** (the same people and places
recur), **causality** (you can see why things happened) and **stakes**
(things can be lost). The expansion adds each in turn:

- **Continuity:** families and genealogy (M12–M13), named places, buildings
  that last, decay and are rebuilt (M14), and old trees that outlive people
  (M10).
- **Causality:** ecological pressure, such as overharvested berry bushes near
  camp that stop spreading, pushes foraging further out. That visibly changes
  routes, conversations and where houses are built. The inspector and
  dashboard show these causes.
- **Stakes:** natural death, ruins and abandoned homes. A grandmother's house
  falls into ruin after she dies, and her grandson rebuilds on the site.

Principle: **no scripted story events.** Every story is a reading of real
simulation state. The chronicle is a curated *view* of that state, not a
generator.

---

## 2. World calendar

### 2.1 Existing model (unchanged)

- 1 tick = 6 in-game minutes; **240 ticks = 1 day**. Tick 0 = day 1, 06:00.
  `step` increments `tick` first, and day N starts at tick `(N−1)·240`.
- Phases are fixed: dawn 06:00, day 08:00, dusk 20:00, night 23:00–06:00.
- Needs are tuned per tick against this day. For example, satiety falls 48 per
  day (about 2 food per citizen) and a 70-tick night refills energy at home.

**Decision: the day model does not change.** Every need, path cost and
balance number is tuned per tick. Seasons and years are built *on top of*
days, so no existing save needs a tick conversion.

### 2.2 Proposed seasons and years

| Unit | Length | Ticks | At 1× | At 10× |
|---|---|---|---|---|
| Day | 240 ticks | 240 | 48 s | 4.8 s |
| Season | 12 days | 2,880 | 9.6 min | 58 s |
| Year | 4 seasons = 48 days | 11,520 | 38 min | 3.8 min |

- The seasons are Spring, Summer, Autumn and Winter. Day 1 is **Spring 1, Year
  1**. Everything is derived from `tick` (no new stored state), so v0.1
  saves get a calendar date for free.
- **Why 12-day seasons:** a season has to be long enough for a food pressure
  to build and be answered (at least 10 days of winter at about 24 food a day
  is roughly 240 food, which matters against current stocks of about 200–400).
  It also has to be short enough that a year passes in a few minutes at 10×.
- Display: `Spring 3, Year 1 · 14:42`, with the absolute day number kept in
  the tooltip and history axes. "Late night" stays as it is.

### 2.3 Aging and reproductive timescales (design only; M12–M13)

Ages are counted in **world years** (48 days). The numbers are chosen so that
generations are visible in a session (§2.5), not to be realistic:

| Life stage | Age (years) | Days | Notes |
|---|---|---|---|
| Child | 0–5 | 0–240 | No work. Follows a caregiver, eats from the stockpile and plays (social). |
| Youth | 6–9 | 288–432 | Light gathering at reduced rates. Learns a role from parents and the village. |
| Adult | 10–39 | 480–1,872 | Full roles. Eligible to partner and raise children from age 12. |
| Elder | 40+ | 1,920+ | Slower walking and work, and more social. The natural-death hazard rises. |
| Lifespan | ~45–60 | ~2,160–2,880 | Natural death is a per-year hazard, not a fixed date (TDS §4). |

- **Generation interval** is about 18 years (864 days), the typical age at
  which a first child is born.
- These stages are words for the player, mapped to numbers that suit the
  existing needs balance. A 10-year-old adult reads strangely, so we display
  **"season-years"** consistently and never mix in human-calendar language.
  Choosing that label is a review item.

### 2.4 Time acceleration

Current speeds are 1×, 3× and 10× (5/15/50 ticks per second). The proposed
additions are deferred to M11, not M10:

| Speed | Ticks/s | Day | Year | Sim CPU at 12 citizens* | Rendering |
|---|---|---|---|---|---|
| 30× | 150 | 1.6 s | 77 s | ~2% | normal |
| **Seasons pass** | budgeted (~6 ms/frame) | ~0.1–0.2 s | ~6–10 s | capped by budget | interpolation off, sprites only |

\* Measured 0.145 ms/tick (M9 sweep). At 100 citizens the target is 1.5 ms
per tick (TDS §6.3), so 30× costs about 22% of a core. **Seasons pass** is
capped by time rather than ticks, so it degrades gracefully: it just runs
fewer ticks per frame.

"Seasons pass" pauses automatically on notable chronicle events if the
player opts in, such as a death, a birth or a ruin. This is how a player
watches generations without missing the story.

### 2.5 Observing generations in a session

| Goal | Ticks | At 10× | At 30× | Seasons pass (est. 3,000 ticks/s at 12, 600/s at 100) |
|---|---|---|---|---|
| One year | 11,520 | 3.8 min | 1.3 min | ~4–19 s |
| A tree's life (≈120 days) | 28,800 | 9.6 min | 3.2 min | ~10–48 s |
| One generation (~18 yrs) | 207,360 | 69 min | 23 min | ~1.2–6 min |
| A full life (~52 yrs) | ~600,000 | 3.3 h | 67 min | ~3.3–17 min |

So **forest turnover is visible at 10×** (M10's goal), and **generations
need M11's acceleration**. That is why acceleration comes before births in
the roadmap.

### 2.6 Implications for food, energy, sleep and survival

- **M10:** seasons change **plant germination only** (spring flush, no
  winter germination). Fruit yield, need decay and night length are
  unchanged, so v0.1 survival balance is preserved. Ecological change works
  on a scale of days, not hours, so citizens are never surprised by it.
- **M11 (seasons that matter):**
  - Berry fruiting becomes seasonal: summer 125%, spring and autumn 100%,
    winter 25%.
  - Citizens get a stockpile target that rises before winter, using a
    utility *demand* term. This is the first real anticipatory behaviour.
  - Stored food spoils slowly (recorded in the ledger as `foodSpoiled`), so
    hoarding is limited.
  - Acceptance: 0 starvation deaths across sweeps, including two winters.
- **Night length stays fixed.** Seasonal day length would retune energy and
  sleep for little gameplay gain. It is deferred indefinitely, and winter can
  be shown with a visual tint (rule 15).
- **Survival guardrail:** no seasonal mechanic may be enabled unless the
  multi-seed sweep shows 0 starvation deaths. Hardship should show up as
  longer trips, rationing and arguments, not as die-offs.

### 2.7 Save compatibility and deterministic replay

- The calendar is a pure function of `tick`, so v0.1 (schema v5) saves load
  with a correct date and no calendar migration.
- **Replay guarantee (within a version):** seed + tick (+ recorded player
  inputs, later) ⇒ an identical `serialize()`.
- **Across versions:** a loaded save **resumes** deterministically under the
  new rules. It does not reproduce what v0.1 would have done. Mechanics
  change, so this is stated explicitly to users: "the same seed grows the
  same island; the village's story depends on the version."
- **Seed stability:** M10 must not change the **tick-0 map** for existing
  seeds. New per-plant data is drawn from a separate derived RNG stream (TDS
  §6.4).

---

## 3. Living ecology

### 3.1 Concepts: regrowth versus reproduction

Today a plant is an immortal node that **regrows** units (berries, wood) on a
fixed schedule. The expansion separates these:

- **Regrowth (production):** an existing plant produces units. Its rate and
  cap depend on its **life stage**.
- **Reproduction (population):** mature plants **cast seeds**. A seed
  becomes a new plant only on a suitable, uncrowded tile. Plants **age** and
  **die**.

The forest and the forage therefore become *populations* with births,
deaths, an age structure and a carrying capacity. Village behaviour feeds
back into them: **a plant that is stripped bare cannot seed**. This is the
central meaningful loop (§3.9).

### 3.2 Berry bush lifecycle

| Stage | Age | Max berries | Fruiting rate | Seeds? |
|---|---|---|---|---|
| Seedling | 0–2 days | 0 | — | no |
| Young | 2–5 days | 3 | half | no |
| Mature | 5 days to 80% of lifespan | 6 (as today) | full (1 per 48 ticks) | yes, if holding ≥ 3 berries at dawn |
| Old | last 20% of lifespan | 4 | half | yes (half chance) |
| — | death at lifespan (28–44 days) | removed; any berries left on it decay (ledger) | | |

Bushes are short-lived, fast-spreading pioneers, so forage *moves* over a
season.

### 3.3 Tree lifecycle

| Stage | Age | Max wood | Growth rate | Seeds? |
|---|---|---|---|---|
| Seedling | 0–6 days | 0 | — | no |
| Young | 6–20 days | 4 | half | no |
| Mature | 20 days to 75% of lifespan | 8 (as today) | full (1 per 160 ticks) | yes, if holding ≥ 4 wood at dawn |
| Old | last 25% | 8 | none (no new wood) | yes |
| Dead (snag) | after lifespan (90–150 days) | the wood it holds | none; rots 1 unit every 4 days (ledger) | no |

Dead trees remain as **harvestable deadwood**. That gives builders a reason
to clear old groves and makes forest death visible without a sudden gap.
Felling stays as it is: a tree chopped to 0 regrows (coppicing). Clearing a
tile by felling is deferred (§8).

### 3.4 Seed dispersal

- Once per day at dawn, each seed-bearing plant rolls a seed chance. The
  chance is lower for bushes and lower again for trees, and is scaled by
  season.
- A seed lands on a uniformly random tile within the dispersal radius (bushes
  3, trees 2). Trees therefore creep outwards as fronts, while bushes hop.
- It **germinates** only if the landing tile:
  1. is in bounds, has non-zero **habitat suitability** for that kind, and
     has no plant;
  2. is not a structure tile or planned site, and is outside the **settled
     clearing** (§3.7);
  3. passes the **crowding** test (§3.6);
  4. passes a suitability roll (a suitability of 60 gives a 60% chance).
- A new plant starts as a seedling with **0 units**, so births never create
  resources from nothing in a single step. Every unit still enters the world
  through counted regrowth.

### 3.5 Habitat suitability (0–100)

The base value comes from terrain; neighbourhood modifiers are computed only
for candidate tiles.

| Terrain | Berries | Trees |
|---|---|---|
| grass | 100 | 15, or 40 with ≥ 2 trees among its 8 neighbours (forest edge) |
| forest | 30 (shade) | 100 |
| sand | 15 if next to grass, else 0 | 0 |
| rock, water | 0 | 0 |

- **Shade:** a bush candidate with 3 or more tree neighbours drops to 40% of
  its suitability.
- **Moisture is not stored** in the map (it exists only during generation).
  Rather than adding a stored field, M10 uses terrain alone. Forest already
  marks the wettest land. A stored moisture or fertility layer is deferred
  until a mechanic needs it, such as soil exhaustion or blessings.

### 3.6 Competition for space and carrying capacity

- **One plant per tile** (as today). A plant never displaces another.
- **Local crowding:** a tree may germinate only if it has 5 or fewer trees
  among its 8 neighbours. A bush may germinate only if it has 2 or fewer
  bushes among its 8 neighbours (bushes stay patchy).
- **Carrying capacity emerges** from free suitable tiles, crowding and
  lifespan. With *N* plants of lifespan *L* days, deaths run at about *N/L*
  per day. Births fall as free suitable space fills.
  - Trees: about 93 trees with a mean life of 120 days give about 0.8
    deaths/day. With roughly 70 seed-bearers at a 5% daily seed chance, 3.5
    seeds/day need only about 23% success to replace them.
  - Bushes: about 33 bushes with a mean life of 36 days give about 0.9
    deaths/day. With roughly 25 bearers at 12%, 3 seeds/day need about 30%
    success.
- **Safety cap (backstop, not balance):** natural germination stops if trees
  exceed 45% of land tiles or bushes exceed 20%. The sweep requires that
  this cap is **never hit**. If it is, the tuning is wrong.

### 3.7 Spawning, disappearance and the settlement

- **Appearance:** only by germination (§3.4).
- **Disappearance:** a plant dies at the end of its lifespan. Bushes vanish
  and trees become snags that rot away. Units lost this way are **decay** in
  the ledger.
- **Settled clearing:** no germination within Manhattan distance 2 of any
  structure (campfire or shelter), and never on a planned site. This keeps
  the camp, rest spots and doorways open.
- **Site safety:** shelter site selection may claim a tile holding a
  **seedling** (0 units, so nothing is lost). This means spreading growth can
  never block housing. Shelter sites are 3–6 tiles from camp and the clearing
  covers 2.
- **Fog:** the ecology runs island-wide, including on undiscovered tiles. The
  world evolves whether or not anyone is watching. Citizens still act only on
  discovered, reachable tiles (rule 13).

### 3.8 Conservation and ecological balance

The ledger gains `foodDecayed` and `woodDecayed`. The conservation identity
becomes:

```
food on map + carried + stockpile.food + foodEaten + foodLost + foodDecayed
  = initial food + foodRegrown
wood on map + carried + stockpile.wood + held by structures + woodLost + woodDecayed
  = initial wood + woodRegrown
```

It is still checked on **every tick** in the conservation test and the sweep.

**Balance targets (multi-seed):** plant counts stay within a band around
their starting values (TDS §7.6). Neither kind goes extinct or runs away.
Food regrown per day stays within ±25% of v0.1's 32.2, and the village sees
zero starvation.

### 3.9 Why this ecology is gameplay, not decoration

- **Overharvest feedback:** bushes near camp are picked bare, so they don't
  seed. As they age out, near-camp forage thins and foragers walk further.
  The dashboard metric *"forage within 10 steps of camp"* makes this visible.
  It prepares for later decisions such as where to settle, abandonment (M14)
  and blessings (Hand phase).
- **Builder ecology:** deadwood in old groves is free wood, so builders work
  forest edges and the treeline shifts.
- **Long-lived landmarks:** a tree can outlive a citizen (later, several),
  which gives places a history.

---

## 4. Future population systems (design only; M12–M13)

These are **not part of M10**. The data shapes are fixed now so that M10's
schema and systems don't need to be redone later.

### 4.1 Aging and natural death

- A citizen gets `bornTick`; age and life stage are derived from it (§2.3).
- **Natural death:** once per world year, on each citizen's birthday tick,
  roll a hazard from an integer table by age: 0 below 40 years, then rising
  to 100% at 70. No `Math.exp` is used.
- The death cause gains `'oldAge'`. A death is a real event, and witnesses
  remember it (existing `sawDeath`).
- **v0.1 migration:** the existing 12 citizens get deterministic adult ages
  (16–30 years), derived from the seed and id, with no RNG draw from the main
  stream.

### 4.2 Births and children

- **Partners:** two adults with mutual affinity ≥ 60 and familiarity ≥ 50
  may form a household bond. This is symmetric and stored on both. There is
  no sex or gender mechanic: any pair can partner. Children are arrival
  events gated by household conditions, not biology. This keeps the system
  inclusive and simple.
- **Birth gate (all required):** both partners are adults; the household has
  a home with spare capacity; the stockpile is at least 2 days of food per
  living citizen; the population is below the cap; and the household has had
  no birth in the last year. A daily household check rolls a small chance.
- **Children:** inherit a personality that blends the parents' traits plus a
  seeded variation, rounded to `TRAIT_PRECISION`. They take a family name or
  lineage tag, and a role is assigned at Youth from village demand.
  - Children have needs, eat from the stockpile and do not work.
  - They follow a caregiver at walking distance. This uses the existing path
    and step rules, so there is no teleporting.

### 4.3 Family relationships and genealogy

- Each citizen gets `parentIds: [number, number] | null`, `partnerId` and
  `childIds`.
- Kinship is **derived** (parent, sibling, grandparent and cousin are
  computed from parent links) and never stored as relationships.
- Relationships between kin start with familiarity and affinity bonuses, so
  family feelings start from a real link.

### 4.4 Housing and food pressure

- Housing demand counts households. The existing planner (§3.9 of
  ARCHITECTURE) gains "plan when free capacity < 1 household".
- When food per capita falls below a threshold, births stop. When it falls
  further, the share action becomes more likely. Starvation stays a failure
  state, and the guardrail in §2.6 applies.

### 4.5 Compact historical records

- **Archive of the dead:** a dead citizen's full record (memories,
  relationships, scores) is compacted after 1 year into a
  `PersonRecord` of about 80 bytes. It keeps id, name, born and died ticks,
  cause, parents, partner, role and up to 3 "notable" event ids. The living
  `citizens` array stops growing without bound.
- **Chronicle:** per world year, a fixed-size `YearSummary` of about 120
  bytes (population start/end, births, deaths, buildings built or ruined,
  plant counts) plus up to 8 notable events, chosen by fixed salience rules.
- Size budget: 100 years × (summary + 8 events), plus 500 archived people,
  is under 100 KB.

### 4.6 Population limits and performance

- A hard cap of `MAX_POPULATION` (default 60 at first, raised as performance
  work lands; 200 at most). A soft limit comes from housing and food.
- Scaling risks are covered in TDS §6.3 and §6.7: per-decision BFS, the
  O(n²) relationship table and save size. Relationships must be capped per
  citizen before populations exceed about 30.

---

## 5. Settlement evolution (design only; M14)

### 5.1 Building condition

- A structure gains `condition` (0–100), `builtTick` and `lastRepairTick`.
- Decay per day: shelters lose 1, plus 1 if unoccupied, plus 1 in winter (from
  M11). A shelter therefore lasts about 50–100 days without maintenance.
- At condition below 40, the home rest bonus falls by half. Below 15, the
  shelter **leaks**: it no longer counts as housing.

### 5.2 Maintenance and repair

- A new `repair` action, available to builders (and anyone at a low weight),
  scores on the condition of their own home first.
- Each repair consumes 1 wood from the stockpile for 20 condition and 20
  labour ticks. The wood goes into `ledger.woodUsed` (conserved).

### 5.3 Demolition and ruins

- At condition 0 a shelter becomes a **ruin**. It is still solid (rule 14)
  and holds a share of its wood as salvage.
- Residents become homeless and re-home through the existing planner.
- **Salvage/demolish** action: removes a ruin and returns its salvage wood to
  the stockpile (conserved). A ruin left alone is overgrown after 60 days:
  its tile is released to the ecology and its wood decays.

### 5.4 Reconstruction

- The planner prefers **ruin tiles** as sites, since the land is cleared and
  salvage counts towards the wood. "Rebuilt the old house" is recorded as an
  event with history.

### 5.5 Growth and abandonment

- **Growth:** new shelters as households form (M13). Sites spread outwards,
  following the existing walk-distance ranking.
- **Abandonment:** a shelter with no residents decays at double the rate and
  eventually becomes a ruin. If the whole village moves its camp (deferred;
  see §8), the old camp becomes a ruin field.
- Ruins are a strong source of visual history: the map carries the scars of
  the past.

---

## 8. Production roadmap (M10–M14)

Each milestone is small, independently testable and shippable. It must pass
`npm test`, `npm run build`, lint and a **sweep with explicit acceptance
criteria**. Every schema change has a migration and fixtures from all
previous versions.

| Milestone | Scope | Key acceptance |
|---|---|---|
| **M10a — Calendar** | Season and year derived from tick; `seasonStarted` and `yearStarted` events; clock and tooltip display; season in history samples. **No behaviour change.** | Determinism; v5 saves load with correct dates; the M9 sweep is unchanged to the byte (apart from the added events). |
| **M10b — Plant life cycle** | Stages, aging, death, deadwood rot; stage-dependent max and regrowth; `foodDecayed`/`woodDecayed`; staggered initial ages; schema v6 and migration; new sprites. | Conservation every tick; no synchronous die-off; the tick-0 map is identical for existing seeds. |
| **M10c — Dispersal and habitat** | Seed casting, habitat, crowding, settled clearing, safety cap, seasonal germination. | Population bands hold over 30 seeds × 120 days and 3 × 400 days; housing is unaffected; the cap is never hit. |
| **M10d — Ecology dashboard** | Ecology card, ecology chart, "forage near camp" metric, 120-day sweep added to `npm run sweep`. | Multi-seed criteria (TDS §7.6); browser soak of 30 min at 10× without leaks. |
| **M11 — Seasons that matter, and faster time** | Seasonal fruiting, winter stockpile target, food spoilage, seasonal tint, 30× and "seasons pass" with auto-pause. | 0 starvation across two winters on 30 seeds; frame budget held at 30×. |
| **M12 — Life course** | `bornTick`, ages and stages for the existing 12; elders; tile inspector; partners and household bond; archive and chronicle data structures. Natural death stays **off**. | v6→v7 migration; the chronicle is bounded; the inspector shows family. |
| **M13 — Generations** | Births, children, caregiving, natural death, population cap (60), relationship cap per citizen, per-decision performance work. | 30 seeds × 3 years: population stays within 8–60, no extinction, no runaway; performance budget at 50 citizens. |
| **M14 — Settlement wear** | Condition, decay, repair, ruins, salvage, reconstruction, abandonment. | Wood conserved; housing recovers after decay; performance at 100 citizens (headless). |

**Why this order:** each milestone builds on a stable lower layer. The
calendar comes before seasons, seasons before births (generations need fast
time and winter pressure), and population before decay (abandonment needs a
changing population). **Natural death ships together with births** in M13,
never before them, so worlds never simply dwindle.

### Deferred (complexity without enough gameplay yet)

- **Wildlife and hunting.** They need movement AI for non-citizens, predation
  balance and new conservation flows. Revisit after M14.
- **Terrain change** (grass becoming forest, erosion, rivers). It needs map
  re-baking and pathfinding cache invalidation for a mostly cosmetic payoff.
  Trees on grass already show forest creep.
- **Stored moisture and soil fertility layers.** Wait for a mechanic that
  reads them (blessings, farming).
- **Felling to clear tiles** and **farming/planting** by citizens. These
  belong with a deliberate land-use design, not M10.
- **Seasonal day length.** It forces a retune of energy and sleep with little
  payoff.
- **Multiple settlements, migration, trade, technology, combat.** They change
  the game's identity and come after the Hand phase design.
- **Genetics beyond trait blending; religion as a system** before the Hand
  phase exists.
- **Web Worker simulation.** Only once 100+ citizens make the main thread a
  bottleneck. The engine is already pure, so this is a mechanical move.
- **Larger maps.** These come after the 100-citizen performance work.
