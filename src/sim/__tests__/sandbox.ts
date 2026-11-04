import { toIndex } from '../grid.ts'
import type { Citizen, Role, WorldState } from '../types.ts'
import { createWorld } from '../world.ts'
import { asciiMap } from './asciiMap.ts'

export interface SandboxCitizen {
  x: number
  y: number
  role?: Role
}

/**
 * A real WorldState whose map is replaced by an ASCII map (fully discovered
 * unless `discovered` is given), with the campfire at `camp` and one
 * citizen per entry. Personalities are neutralised (all traits 0.5) and
 * stockpile/ledger reset, so tests control every input.
 */
export function sandbox(
  rows: string[],
  opts: { camp: [number, number]; citizens: SandboxCitizen[]; food?: number; wood?: number; discovered?: (x: number, y: number) => boolean },
): { state: WorldState; citizens: Citizen[] } {
  const state = createWorld({ seed: 'sandbox', citizenCount: opts.citizens.length })
  const map = asciiMap(rows)
  map.discovered = map.discovered.map((_d, i) =>
    !opts.discovered || opts.discovered(i % map.width, Math.floor(i / map.width)) ? 1 : 0,
  )
  map.lastSeen = map.discovered.map((d) => (d === 1 ? 0 : -1))
  state.map = map
  state.config = { ...state.config, width: map.width, height: map.height }
  state.structures[0]!.tile = toIndex(opts.camp[0], opts.camp[1], map.width)
  state.stockpile = { food: opts.food ?? 0, wood: opts.wood ?? 0 }
  state.ledger = {
    foodGathered: 0,
    woodGathered: 0,
    foodRegrown: 0,
    woodRegrown: 0,
    foodEaten: 0,
    foodLost: 0,
    woodLost: 0,
    foodDecayed: 0,
    woodDecayed: 0,
  }
  state.events = []
  state.citizens.forEach((c, i) => {
    const spec = opts.citizens[i]!
    c.pos = { x: spec.x, y: spec.y }
    c.role = spec.role ?? 'forager'
    c.personality = { sociability: 0.5, diligence: 0.5, curiosity: 0.5, resilience: 0.5 }
    c.needs = { satiety: 80, energy: 90, social: 70, health: 100 }
    c.nextDecisionTick = 0
  })
  return { state, citizens: state.citizens }
}
