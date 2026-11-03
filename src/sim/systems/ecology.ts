// Ecology system (M10b; replaces systems/resources.ts). Slot 3 of step():
// time → needs → ECOLOGY → construction → decide → act → history.
//
// Each dawn (tick-of-day 0), in ascending tile order:
//   • deadwood: chopped-out deadwood is removed; otherwise it rots one unit
//     every DEADWOOD_ROT_DAYS after death (→ ledger.woodDecayed);
//   • living plants move to the stage their age calls for. A lower stage cap
//     decays the excess; at the end of its lifespan a bush dies (its berries
//     decay) and a tree becomes deadwood (or vanishes if it holds no wood).
// Every tick: stage-aware regrowth with the stateless v0.1 timing — full rate
// on tick % INTERVAL, half rate on tick % (2 × INTERVAL).
//
// Senescence (old age and death) is gated by EcologyRules; its default is
// PLANT_SENESCENCE_ENABLED (off in M10b, TDS §7.11). With it off and only
// mature plants — every world until M10c — this system behaves exactly like
// the v0.1 regrowth it replaces.
//
// The ecology reads only the map, the tick and its own state: never citizens,
// stockpiles or housing demand (no rescue mechanics, TDS H7). It allocates no
// ids and, in M10b, draws no random numbers.

import {
  BERRY_REGROW_INTERVAL,
  DEADWOOD_ROT_DAYS,
  PLANT_REGROWTH,
  PLANT_SENESCENCE_ENABLED,
  TICKS_PER_DAY,
  TREE_REGROW_INTERVAL,
} from '../constants.ts'
import { plantAgeDays, stageCap, stageForAge } from '../ecology/flora.ts'
import type { ResourceKind, ResourceNode, WorldState } from '../types.ts'
import { tickOfDayAt } from './time.ts'

export interface EcologyRules {
  /** Plants age into 'old' and die. */
  senescence: boolean
}

export const DEFAULT_ECOLOGY_RULES: Readonly<EcologyRules> = { senescence: PLANT_SENESCENCE_ENABLED }

const REGROW_INTERVAL: Record<ResourceKind, number> = { berries: BERRY_REGROW_INTERVAL, wood: TREE_REGROW_INTERVAL }

function decay(state: WorldState, kind: ResourceKind, units: number): void {
  if (units <= 0) return
  if (kind === 'berries') state.ledger.foodDecayed += units
  else state.ledger.woodDecayed += units
}

/** Dawn pass: deadwood rot, stage transitions and deaths. Returns true if the map changed. */
function dawnPass(state: WorldState, rules: Readonly<EcologyRules>): boolean {
  const { resources } = state.map
  let changed = false
  for (let i = 0; i < resources.length; i++) {
    const node = resources[i]
    if (!node) continue
    if (node.stage === 'dead') {
      if (node.amount <= 0) {
        resources[i] = null // chopped out
        changed = true
        continue
      }
      const daysDead = Math.floor((state.tick - node.diedTick!) / TICKS_PER_DAY)
      if (daysDead > 0 && daysDead % DEADWOOD_ROT_DAYS === 0) {
        node.amount--
        decay(state, 'wood', 1)
        if (node.amount <= 0) resources[i] = null
        changed = true
      }
      continue
    }
    const target = stageForAge(node.kind, plantAgeDays(node, state.tick), node.lifespanDays, rules.senescence)
    if (target === 'death') {
      die(state, i, node)
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

function die(state: WorldState, tile: number, node: ResourceNode): void {
  state.ecology.counters.deaths[node.kind]++
  if (node.kind === 'wood' && node.amount > 0) {
    // Harvestable deadwood: keeps its wood, never regrows, rots slowly.
    node.stage = 'dead'
    node.diedTick = state.tick
    node.max = node.amount
    return
  }
  decay(state, node.kind, node.amount)
  state.map.resources[tile] = null
}

/** Stage-aware regrowth, v0.1 timing. Returns units grown per kind. */
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
  let changed = tickOfDayAt(state.tick) === 0 && state.tick > 0 && dawnPass(state, rules)
  const food = regrow(state, 'berries')
  const wood = regrow(state, 'wood')
  state.ledger.foodRegrown += food
  state.ledger.woodRegrown += wood
  if (food + wood > 0) changed = true
  if (changed) state.map.version++
}
