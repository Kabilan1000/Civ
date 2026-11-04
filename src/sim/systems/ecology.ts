// Ecology system (M10b lifecycle + M10c reproduction). Slot 3 of step():
// time → needs → ECOLOGY → life cycle → construction → decide → act → history.
//
// Each dawn (tick-of-day 0), in ascending tile order:
//   1. stage pass — deadwood: chopped-out deadwood is removed; otherwise it
//      rots one unit every DEADWOOD_ROT_DAYS (→ ledger.woodDecayed). Living
//      plants move to the stage their age calls for; a lower stage cap decays
//      the excess. At the end of its lifespan a bush dies (its berries decay,
//      and each may sprout nearby as fallen fruit) and a tree becomes deadwood
//      (or vanishes if it holds no wood).
//   2. seed pass — berries, then wood: every mature or old plant holding at
//      least SEED_MIN_UNITS may cast one seed within DISPERSAL_RADIUS.
// Every tick: stage-aware regrowth with the stateless v0.1 timing.
//
// Germination (seeds and fallen fruit alike) needs a free, suitable,
// uncrowded tile outside the settled clearing and below the safety cap; a new
// plant is a seedling holding nothing, so reproduction never adds resources.
//
// The ecology reads only the map, the structures' tiles, the tick and its own
// state — never citizens, stockpiles or housing (no rescue mechanics, TDS
// H7). It allocates no ids and draws only from state.ecology.rng, in a fixed
// order. EcologyRules exist so tests can switch senescence and reproduction
// off and prove the rest of the simulation still behaves like v0.1.

import {
  BERRY_REGROW_INTERVAL,
  DEADWOOD_ROT_DAYS,
  DISPERSAL_RADIUS,
  FALLEN_FRUIT_MAX_ROLLS,
  FALLEN_FRUIT_PERMILLE,
  PLANT_LIFESPAN_DAYS,
  PLANT_REGROWTH,
  PLANT_REPRODUCTION_ENABLED,
  PLANT_SENESCENCE_ENABLED,
  SEED_CHANCE_PERMILLE,
  SEED_MIN_UNITS,
  TICKS_PER_DAY,
  TREE_REGROW_INTERVAL,
} from '../constants.ts'
import { plantAgeDays, plantNode, stageCap, stageForAge } from '../ecology/flora.ts'
import { clearingMask, crowded, safetyCap, suitability } from '../ecology/habitat.ts'
import { nextInt } from '../rng.ts'
import type { ResourceKind, ResourceNode, TileIndex, WorldState } from '../types.ts'
import { tickOfDayAt } from './time.ts'

export interface EcologyRules {
  /** Plants age into 'old' and die. */
  senescence: boolean
  /** Seeds and fallen fruit germinate. */
  reproduction: boolean
}

export const DEFAULT_ECOLOGY_RULES: Readonly<EcologyRules> = {
  senescence: PLANT_SENESCENCE_ENABLED,
  reproduction: PLANT_REPRODUCTION_ENABLED,
}

const REGROW_INTERVAL: Record<ResourceKind, number> = { berries: BERRY_REGROW_INTERVAL, wood: TREE_REGROW_INTERVAL }

function decay(state: WorldState, kind: ResourceKind, units: number): void {
  if (units <= 0) return
  if (kind === 'berries') state.ledger.foodDecayed += units
  else state.ledger.woodDecayed += units
}

/** Per-dawn germination context: the clearing, kind counts and caps. */
interface Dawn {
  clearing: Uint8Array
  count: Record<ResourceKind, number>
  cap: Record<ResourceKind, number>
}

function dawnContext(state: WorldState): Dawn {
  const count: Record<ResourceKind, number> = { berries: 0, wood: 0 }
  for (const n of state.map.resources) if (n) count[n.kind]++
  return {
    clearing: clearingMask(state),
    count,
    cap: { berries: safetyCap(state.map, 'berries'), wood: safetyCap(state.map, 'wood') },
  }
}

/**
 * Try to start a seedling of `kind` on tile (x, y). Draws one number for the
 * suitability roll and one for the lifespan, only if the tile is acceptable.
 */
function tryGerminate(state: WorldState, dawn: Dawn, kind: ResourceKind, x: number, y: number): boolean {
  const { map } = state
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false
  const tile: TileIndex = y * map.width + x
  if (map.resources[tile] !== null || dawn.clearing[tile] === 1) return false
  if (dawn.count[kind] >= dawn.cap[kind]) return false
  const suit = suitability(map, kind, tile)
  if (suit <= 0 || crowded(map, kind, tile)) return false
  if (nextInt(state.ecology.rng, 0, 99) >= suit) return false
  const span = PLANT_LIFESPAN_DAYS[kind]
  map.resources[tile] = plantNode(kind, {
    stage: 'seedling',
    bornTick: state.tick,
    lifespanDays: nextInt(state.ecology.rng, span.min, span.max),
  })
  dawn.count[kind]++
  state.ecology.counters.births[kind]++
  return true
}

/** Stage pass: deadwood rot, stage transitions, deaths (and fallen fruit). Returns true if the map changed. */
function stagePass(state: WorldState, rules: Readonly<EcologyRules>, dawn: Dawn): boolean {
  const { resources, width } = state.map
  let changed = false
  for (let i = 0; i < resources.length; i++) {
    const node = resources[i]
    if (!node) continue
    if (node.stage === 'dead') {
      if (node.amount <= 0) {
        resources[i] = null // chopped out
        dawn.count.wood--
        changed = true
        continue
      }
      const daysDead = Math.floor((state.tick - node.diedTick!) / TICKS_PER_DAY)
      if (daysDead > 0 && daysDead % DEADWOOD_ROT_DAYS === 0) {
        node.amount--
        decay(state, 'wood', 1)
        if (node.amount <= 0) {
          resources[i] = null
          dawn.count.wood--
        }
        changed = true
      }
      continue
    }
    const target = stageForAge(node.kind, plantAgeDays(node, state.tick), node.lifespanDays, rules.senescence)
    if (target === 'death') {
      die(state, rules, dawn, i, node, i % width, Math.floor(i / width))
      changed = true
    } else if (target !== node.stage) {
      node.stage = target
      node.max = stageCap(node.kind, target)
      if (node.amount > node.max) {
        decay(state, node.kind, node.amount - node.max)
        node.amount = node.max
      }
      changed = true
    }
  }
  return changed
}

function die(state: WorldState, rules: Readonly<EcologyRules>, dawn: Dawn, tile: TileIndex, node: ResourceNode, x: number, y: number): void {
  state.ecology.counters.deaths[node.kind]++
  if (node.kind === 'wood' && node.amount > 0) {
    // Harvestable deadwood: keeps its wood, never regrows, rots slowly.
    node.stage = 'dead'
    node.diedTick = state.tick
    node.max = node.amount
    return
  }
  const berries = node.kind === 'berries' ? node.amount : 0
  decay(state, node.kind, node.amount)
  state.map.resources[tile] = null
  dawn.count[node.kind]--
  if (!rules.reproduction) return
  // Fallen fruit: berries still on the bush may sprout (a stripped bush leaves nothing).
  for (let k = 0; k < Math.min(berries, FALLEN_FRUIT_MAX_ROLLS); k++) {
    if (nextInt(state.ecology.rng, 0, 999) >= FALLEN_FRUIT_PERMILLE) continue
    const dx = nextInt(state.ecology.rng, -1, 1)
    const dy = nextInt(state.ecology.rng, -1, 1)
    if (tryGerminate(state, dawn, 'berries', x + dx, y + dy)) state.ecology.counters.fallenFruitSprouts++
  }
}

/** Seed pass: berries, then wood, each in ascending tile order. */
function seedPass(state: WorldState, dawn: Dawn): boolean {
  const { resources, width } = state.map
  let changed = false
  for (const kind of ['berries', 'wood'] as const) {
    const r = DISPERSAL_RADIUS[kind]
    for (let i = 0; i < resources.length; i++) {
      const node = resources[i]
      if (!node || node.kind !== kind || (node.stage !== 'mature' && node.stage !== 'old')) continue
      if (node.amount < SEED_MIN_UNITS[kind]) continue // stripped plants can't spread
      const chance = node.stage === 'old' ? Math.floor(SEED_CHANCE_PERMILLE[kind] / 2) : SEED_CHANCE_PERMILLE[kind]
      if (nextInt(state.ecology.rng, 0, 999) >= chance) continue
      state.ecology.counters.seedsCast++
      const dx = nextInt(state.ecology.rng, -r, r)
      const dy = nextInt(state.ecology.rng, -r, r)
      if (dx === 0 && dy === 0) continue
      if (tryGerminate(state, dawn, kind, (i % width) + dx, Math.floor(i / width) + dy)) changed = true
    }
  }
  return changed
}

/** Stage-aware regrowth, v0.1 timing. Returns units grown. */
function regrow(state: WorldState, kind: ResourceKind): number {
  const interval = REGROW_INTERVAL[kind]
  if (state.tick % interval !== 0) return 0
  const half = state.tick % (2 * interval) === 0
  let grown = 0
  for (const node of state.map.resources) {
    if (!node || node.kind !== kind || node.amount >= node.max) continue
    const rate = PLANT_REGROWTH[kind][node.stage]
    if (rate === 'full' || (rate === 'half' && half)) {
      node.amount++
      grown++
    }
  }
  return grown
}

export function updateEcology(state: WorldState, rules: Readonly<EcologyRules> = DEFAULT_ECOLOGY_RULES): void {
  let changed = false
  if (state.tick > 0 && tickOfDayAt(state.tick) === 0) {
    const dawn = dawnContext(state)
    changed = stagePass(state, rules, dawn)
    if (rules.reproduction && seedPass(state, dawn)) changed = true
  }
  const food = regrow(state, 'berries')
  const wood = regrow(state, 'wood')
  state.ledger.foodRegrown += food
  state.ledger.woodRegrown += wood
  if (food + wood > 0) changed = true
  if (changed) state.map.version++
}
