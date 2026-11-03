// Read-only helpers for the UI and renderer. Never mutate state here.
import type { DayPhase } from './constants.ts'
import { stepCost, toPoint } from './grid.ts'
import { dayNumberAt, dayPhaseAt, minuteOfDayAt, tickOfDayAt } from './systems/time.ts'
import type { Citizen, Needs, Point, SimEvent, Structure, WorldState } from './types.ts'

export interface ClockTime {
  hour: number
  minute: number
}

export function getDayNumber(state: WorldState): number {
  return dayNumberAt(state.tick)
}

export function getTickOfDay(state: WorldState): number {
  return tickOfDayAt(state.tick)
}

export function getClockTime(state: WorldState): ClockTime {
  const m = minuteOfDayAt(state.tick)
  return { hour: Math.floor(m / 60), minute: m % 60 }
}

export function getDayPhase(state: WorldState): DayPhase {
  return dayPhaseAt(state.tick)
}

export function isNight(state: WorldState): boolean {
  return getDayPhase(state) === 'night'
}

export function getCitizen(state: WorldState, id: number): Citizen | undefined {
  return state.citizens.find((c) => c.id === id)
}

export function getLivingCitizens(state: WorldState): Citizen[] {
  return state.citizens.filter((c) => c.alive)
}

export function getStructure(state: WorldState, id: number): Structure | undefined {
  return state.structures.find((s) => s.id === id)
}

/** Most recent events first. */
export function getRecentEvents(state: WorldState, limit = 50): SimEvent[] {
  return state.events.slice(-limit).reverse()
}

export interface CivStats {
  day: number
  population: number
  housed: number
  food: number
  wood: number
  avgNeeds: Needs
}

/** Derived civilization snapshot (not stored in state). */
export function getCivStats(state: WorldState): CivStats {
  const living = getLivingCitizens(state)
  const n = living.length
  const avg = (key: keyof Needs) => (n === 0 ? 0 : living.reduce((sum, c) => sum + c.needs[key], 0) / n)
  return {
    day: getDayNumber(state),
    population: n,
    housed: living.filter((c) => c.homeId !== null).length,
    food: state.stockpile.food,
    wood: state.stockpile.wood,
    avgNeeds: { satiety: avg('satiety'), energy: avg('energy'), social: avg('social'), health: avg('health') },
  }
}

/**
 * Fractional tile position for smooth rendering. `alpha` in [0, 1) is how far
 * real time has progressed towards the next tick. While walking, the citizen
 * is drawn between `pos` and the next path tile by elapsed step progress.
 */
export function getVisualPosition(state: WorldState, c: Citizen, alpha = 0): Point {
  if (c.pathIndex >= c.path.length) return { x: c.pos.x, y: c.pos.y }
  const nextTile = c.path[c.pathIndex]!
  const cost = stepCost(state.map, nextTile)
  if (cost === null || cost <= 0) return { x: c.pos.x, y: c.pos.y }
  const t = Math.min(1, Math.max(0, (cost - c.moveTicksLeft + alpha) / cost))
  const next = toPoint(nextTile, state.map.width)
  return { x: c.pos.x + (next.x - c.pos.x) * t, y: c.pos.y + (next.y - c.pos.y) * t }
}
