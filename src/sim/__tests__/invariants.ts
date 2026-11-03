// Shared world invariants for tests and the sweep.
import { PLANT_STAGE_MAX, TERRAIN_RULES } from '../constants.ts'
import { plantAgeDays, stageForAge } from '../ecology/flora.ts'
import { tickOfDayAt } from '../systems/time.ts'
import type { WorldState } from '../types.ts'

/**
 * Conservation (CLAUDE.md rule 13, types.ts Ledger). Each total must stay
 * constant from tick to tick:
 *   food: on map + carried + stockpile + eaten + lost + decayed − regrown
 *   wood: on map + carried + stockpile + held by structures + lost + decayed − regrown
 */
export function conservationTotals(s: WorldState): { food: number; wood: number } {
  let food = s.stockpile.food + s.ledger.foodEaten + s.ledger.foodLost + s.ledger.foodDecayed - s.ledger.foodRegrown
  let wood = s.stockpile.wood + s.ledger.woodLost + s.ledger.woodDecayed - s.ledger.woodRegrown
  for (const r of s.map.resources) {
    if (r?.kind === 'berries') food += r.amount
    else if (r) wood += r.amount
  }
  for (const c of s.citizens) {
    if (c.carrying?.kind === 'berries') food += c.carrying.amount
    else if (c.carrying) wood += c.carrying.amount
  }
  for (const st of s.structures) wood += st.woodDelivered
  return { food, wood }
}

/**
 * Plant invariants (TDS H3). `senescence` is the rule the world runs under:
 * right after a dawn tick every living plant must be in the stage its age
 * calls for. Returns violations (empty = all good).
 */
export function plantViolations(s: WorldState, senescence: boolean): string[] {
  const out: string[] = []
  const structureTiles = new Set(s.structures.map((st) => st.tile))
  const dawn = s.tick > 0 && tickOfDayAt(s.tick) === 0
  s.map.resources.forEach((n, i) => {
    if (!n) return
    const at = `tile ${i} (${n.kind} ${n.stage})`
    if (!Number.isInteger(n.amount) || n.amount < 0 || n.amount > n.max) out.push(`${at}: amount ${n.amount} outside 0..${n.max}`)
    if (!TERRAIN_RULES[s.map.terrain[i]!].passable) out.push(`${at}: on ${s.map.terrain[i]}`)
    if (structureTiles.has(i)) out.push(`${at}: on a structure tile`)
    if (n.stage === 'dead') {
      if (n.kind !== 'wood') out.push(`${at}: dead bush`)
      if (n.diedTick === null) out.push(`${at}: dead without diedTick`)
      if (n.max > PLANT_STAGE_MAX.wood.mature) out.push(`${at}: deadwood max ${n.max}`)
      return
    }
    if (n.diedTick !== null) out.push(`${at}: living with diedTick`)
    if (n.max !== PLANT_STAGE_MAX[n.kind][n.stage]) out.push(`${at}: max ${n.max} ≠ stage cap`)
    if (!senescence && n.stage === 'old') out.push(`${at}: old while senescence is off`)
    if (dawn) {
      const expected = stageForAge(n.kind, plantAgeDays(n, s.tick), n.lifespanDays, senescence)
      if (expected !== n.stage) out.push(`${at}: stage ${n.stage}, age calls for ${expected}`)
    }
  })
  return out
}
