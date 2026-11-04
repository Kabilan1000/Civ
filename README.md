# Little Worlds

An autonomous 2D civilization simulator for the browser. Twelve citizens arrive
on a procedurally generated island with a campfire and nothing else. They
forage berries, chop wood, build shelters, sleep, talk, argue, share food,
explore the fog and remember what happened to them. You don't steer them: you
watch, inspect anyone you like, control time, and save the worlds you want to
keep.

Every world comes from a **seed**: the same seed always grows the same island
and, tick for tick, the same village.

## Technologies

- **TypeScript**, **React 19** and **Vite** for the app
- **PixiJS 8** for the map (WebGL, with a CSP-safe build)
- **Vitest** for tests (the simulation runs headless in Node)
- **localStorage** for saved worlds — no server, no external services, no AI APIs

The simulation (`src/sim/`) is a pure, deterministic TypeScript engine with no
browser, React or PixiJS code; rendering and UI only read it. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and
[`CLAUDE.md`](CLAUDE.md) for the project's rules.

## Local setup

Requires Node.js 20.19+ or 22.12+ (developed on Node 22) and npm 10+.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## Commands

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Start the dev server (http://localhost:5173)                    |
| `npm run build`      | Type-check everything, then build a static site into `dist/`    |
| `npm run preview`    | Serve the production build locally                              |
| `npm test`           | Run the test suite once                                         |
| `npm run test:watch` | Run tests in watch mode                                         |
| `npm run sweep`      | Long-run balance sweep (30 seeds × 30 days + 3 × 100 days, ~6 min) |
| `npm run sweep:population` | Population sweep: 12 seeds × 50 world years (long; shard with `LW_POP_SHARD`/`LW_POP_SHARDS`) |
| `npm run typecheck`  | Type-check only                                                 |
| `npm run lint`       | Lint with oxlint                                                |

`dist/` uses relative paths, so it can be served from any static host or folder.

## How to play

The village runs by itself. Things you can do:

- **Control time** — Play/Pause, and 1×, 3×, 10× or 100× speed. One in-game
  day is 240 ticks; at 1× that is 48 seconds, at 100× about half a second.
- **Inspect a citizen** — click them on the map, or a name anywhere in the
  panels. A gold ring follows them. The inspector has four tabs:
  - *Overview* — needs (satiety, energy, social, health), what they're doing
    and where they're heading, what they carry, their home and housemates,
    their personality.
  - *Decision* — every action's score from their last decision and a plain
    explanation of why they're doing what they're doing.
  - *Bonds* — how they feel about each person they've met, and how that person
    feels back (feelings can be one-sided), plus how well they know each other.
  - *Memories* — what actually happened to them, newest first.
- **Read the village** — the Civilization panel shows population, stockpiles,
  housing, exploration, average needs and friendships/rivalries; the Events
  feed (filterable) shows what happened; History charts show the last 60 days.

What to expect in a typical world: shelters go up on day 1–2 and everyone is
housed by about day 2–3; explorers open up most of the island within a few
days; friendships form over the first weeks; arguments are common, lasting
rivalries rare.

## Living land

The island's plants live too. Berry bushes and trees sprout from seed, grow
up (small at first), fruit and grow wood, turn old (faded on the map) and
die. A bush's last berries may fall and sprout; a dead tree stands as grey
deadwood that builders can still chop until it rots away. Mature plants
spread seeds to free, suitable ground nearby — bushes on grass, trees in and
at the edge of the forest — but never right next to buildings, and a bush
picked bare can't spread. So heavy foraging thins the bushes near camp and
pushes foragers further out, and the land recovers once the pressure moves
on. The **Plants** card counts bushes, trees and sprouts. The land keeps
changing in the fog, whether anyone watches or not.

## Returning fog

The village never forgets the island's shape — paths, homes and known
plants stay usable — but what it *knows* fades. Land nobody has seen for 12
days grows hazy, and after 24 days the fog returns: the map shows it as it
was last seen, while plants keep growing and dying underneath. Villagers
keep the ground around them and the settlement in view; explorers, once
nothing new is left to find, go and resurvey the stalest land. On the map:
clear = in view, a faint veil = seen recently, haze = fading or stale, dark
= never discovered. The **Explored** card shows how much known land is fresh
and how much has gone stale.

## Generations

The village is no longer fixed at twelve. Ages are counted in world years
(48 days):

- **Founders** are adults aged 18–36.
- **Partners:** adults who like and know each other well become partners.
- **Children:** a couple with a home, while the village has food to spare
  (3 per person in the stockpile), may have a child — at most one a year
  each, and never beyond 60 villagers. A full home is no obstacle: the
  child squeezes in, and the builders plan another shelter.
- **Childhood:** children eat (less than adults), sleep at home, play near
  the campfire and chat. They come of age at **14** and take up work.
- **Old age:** from **50**, each birthday may be a citizen's last; nobody
  lives past **65**. Starvation and exhaustion still kill too, but rarely.
- **The archive:** a year after death a citizen is archived; their name lives
  on in their family's records.

At **100×** the first child arrives within about a minute, children grow up in
about 6 minutes, old age begins to take the founders after 7–9 minutes, and
the founding generation is gone in roughly 20 minutes. Villages differ: food
and space set how far each one grows. The dashboard counts children, adults,
elders, couples, births and deaths; the inspector shows each citizen's age and
family; the History panel charts children, elders, births and deaths.

**The calendar.** The clock shows the season, day and year — for example
“Spring 3, Year 1 · 14:42” — with the world's absolute day beside it (and in
its tooltip). A season lasts 12 days and a year has four seasons (48 days):
Spring, Summer, Autumn, Winter. The event feed marks where each season began
and the history charts show season lines. Seasons are only a calendar for
now; they don't change the village yet.

Days begin at dawn (06:00), so a time after midnight such as
“Day 6 · 00:48 (late night)” still belongs to day 6 and comes after
“Day 6 · 22:42” — and the season and year turn over at dawn too.

## Saving and loading

Click **Save** or **Load** to open the saved-worlds dialog:

- Three manual slots plus one **Autosave** slot. Each shows the seed, in-game
  day and time, population and when it was saved.
- Saving over a used slot, deleting a slot, and loading over unsaved progress
  all ask for confirmation. A dot on the Save button means there is unsaved
  progress.
- **Autosave** writes only the Autosave slot, after every 5 minutes of
  *running* time, if the world has changed. Closing the tab may skip the last
  autosave.
- A loaded world starts **paused** — press Play to continue. It continues
  exactly as it would have.
- Damaged slots are marked and can't be loaded; saves from newer versions are
  refused with a clear message; saves from older versions are upgraded
  automatically. If anything goes wrong, the running world is left untouched.

Saves live in your browser's local storage for this site only; private windows
or blocked site data disable saving. A world is about 50–160 KB.

## World seeds

Type any text into the seed field (or press 🎲 for a random one) and press
**Restart** (or Enter). The same seed always creates the same island and the
same starting village; different seeds give different islands. Restarting
asks first if there is unsaved progress, and never touches saved slots.

## Keyboard shortcuts

| Key          | Action                                   |
| ------------ | ---------------------------------------- |
| `Space`      | Play / pause                             |
| `1` `2` `3` `4` | Speed 1× / 3× / 10× / 100×            |
| `Esc`        | Close the topmost dialog, or deselect    |

Shortcuts don't fire while you type in a text field or hold Ctrl/⌘/Alt, and
Space activates a focused button instead of pausing.

## Testing

```bash
npm test
```

```bash
npm run sweep
```

`npm test` runs the full suite (simulation, persistence, controller, render
logic, UI formatting) in Node in about half a minute. It covers determinism and
save/resume, map generation, pathfinding, needs, the AI, construction, social
behaviour, memory, exploration, resource conservation (checked every tick),
history, save slots and migrations from every earlier save format.

`npm run sweep` is the long-run check: 30 seeds for 30 in-game days and three
100-day runs, verifying invariants on every tick and printing survival,
housing, food/wood, exploration, social and performance figures.

## Known limitations

- The 36 × 24 map is fixed and the village holds at most 60 people; there
  are no trade, player commands, genetics or illness.
- Saves are per-browser (localStorage); there is no cloud sync or file
  export.
- The event feed keeps only the last 200 events; history keeps the last 60
  days.
- On weak or software-only graphics the map lowers its drawing resolution
  automatically (down to 0.75×) to stay smooth, which makes it slightly
  softer.
- Rivalries are uncommon: citizens avoid people they've argued with.
- The interface is dark-only.
