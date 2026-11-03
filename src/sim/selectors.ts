// Read-only helpers for the UI and renderer. Never mutate state here.
import { FRIENDSHIP_AFFINITY, MAX_EVENTS, RIVALRY_AFFINITY, SHELTER_CAPACITY, type DayPhase } from './constants.ts'
import { stepCost, toPoint } from './grid.ts'
import { ageYears, lifeStage, type LifeStage } from './citizens/life.ts'
import { dayNumberAt, dayPhaseAt, minuteOfDayAt, tickOfDayAt } from './systems/time.ts'
import type {
  ActionKind,
  ActionScore,
  Citizen,
  HistorySample,
  Memory,
  Needs,
  Point,
  SimEvent,
  SimEventKind,
  Structure,
  WorldState,
} from './types.ts'

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
  /** Living citizens. */
  population: number
  dead: number
  food: number
  wood: number
  shelters: { complete: number; underConstruction: number; planned: number }
  /** Slots in completed shelters, and living citizens assigned to them. */
  housing: { capacity: number; occupied: number; homeless: number }
  discoveredTiles: number
  totalTiles: number
  /** Discovered share of the map, 0..100 (one decimal). */
  exploredPercent: number
  /** Mean needs of the living (0 when nobody is alive). */
  avgNeeds: Needs
  /** Unordered pairs of living citizens where BOTH affinities ≥ FRIENDSHIP_AFFINITY. */
  friendships: number
  /** Unordered pairs of living citizens where EITHER affinity ≤ RIVALRY_AFFINITY. */
  rivalries: number
  /** Population V1: living citizens by life stage, couples, and cumulative births and deaths. */
  people: { children: number; adults: number; elders: number; couples: number; births: number; deaths: number; oldAgeDeaths: number }
}

/** Derived civilization snapshot (not stored in state). */
export function getCivStats(state: WorldState): CivStats {
  const living = getLivingCitizens(state)
  const n = living.length
  const avg = (key: keyof Needs) => (n === 0 ? 0 : living.reduce((sum, c) => sum + c.needs[key], 0) / n)
  const shelters = state.structures.filter((s) => s.kind === 'shelter')
  const complete = shelters.filter((s) => s.stage === 'complete')
  const occupied = living.filter((c) => c.homeId !== null).length
  const discoveredTiles = state.map.discovered.reduce<number>((sum, d) => sum + d, 0)
  const totalTiles = state.map.discovered.length

  let friendships = 0
  let rivalries = 0
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = living[i]!
      const b = living[j]!
      const ab = a.relationships[b.id]?.affinity
      const ba = b.relationships[a.id]?.affinity
      if (ab === undefined && ba === undefined) continue
      if ((ab ?? 0) >= FRIENDSHIP_AFFINITY && (ba ?? 0) >= FRIENDSHIP_AFFINITY) friendships++
      if ((ab ?? 0) <= RIVALRY_AFFINITY || (ba ?? 0) <= RIVALRY_AFFINITY) rivalries++
    }
  }

  return {
    day: getDayNumber(state),
    population: n,
    dead: state.population.counters.deaths, // all deaths, including the archived
    food: state.stockpile.food,
    wood: state.stockpile.wood,
    shelters: {
      complete: complete.length,
      underConstruction: shelters.filter((s) => s.stage === 'underConstruction').length,
      planned: shelters.filter((s) => s.stage === 'planned').length,
    },
    housing: { capacity: complete.length * SHELTER_CAPACITY, occupied, homeless: n - occupied },
    discoveredTiles,
    totalTiles,
    exploredPercent: totalTiles === 0 ? 0 : Math.round((discoveredTiles / totalTiles) * 1000) / 10,
    avgNeeds: { satiety: avg('satiety'), energy: avg('energy'), social: avg('social'), health: avg('health') },
    friendships,
    rivalries,
    people: {
      ...countStages(living, state.tick),
      couples: living.filter((c) => c.partnerId !== null && c.partnerId > c.id).length,
      births: state.population.counters.births,
      deaths: state.population.counters.deaths,
      oldAgeDeaths: state.population.counters.oldAgeDeaths,
    },
  }
}

/** Living citizens by life stage. */
export function countStages(living: readonly Citizen[], tick: number): { children: number; adults: number; elders: number } {
  const out = { children: 0, adults: 0, elders: 0 }
  for (const c of living) {
    const stage = lifeStage(c, tick)
    if (stage === 'child') out.children++
    else if (stage === 'adult') out.adults++
    else out.elders++
  }
  return out
}

/** A person's name — living, dead or archived — or "#id" if long forgotten. */
export function getPersonName(state: WorldState, id: number): string {
  return getCitizen(state, id)?.name ?? state.archive.find((p) => p.id === id)?.name ?? `#${id}`
}

/** True if the person (living or dead) is still in `citizens`; archived people are not linkable. */
export function isListedCitizen(state: WorldState, id: number): boolean {
  return getCitizen(state, id) !== undefined
}

// ── Citizen inspector ───────────────────────────────────────────────────────

export interface CitizenTaskView {
  kind: ActionKind
  phase: string
  /** Destination tile as a point, if the task has one. */
  destination: Point | null
  /** The other citizen or structure the task is about. */
  targetCitizen: { id: number; name: string } | null
  targetStructure: { id: number; kind: string; stage: string } | null
  startedTick: number
}

export interface CitizenDetail {
  id: number
  name: string
  role: Citizen['role']
  personality: Citizen['personality']
  needs: Needs
  alive: boolean
  diedTick: number | null
  deathCause: Citizen['deathCause']
  pos: Point
  carrying: Citizen['carrying']
  home: { id: number; tile: Point; residents: { id: number; name: string }[] } | null
  task: CitizenTaskView | null
  scores: ActionScore[]
  lastDecisionTick: number | null
  /** Population V1 */
  age: number
  stage: LifeStage
  bornTick: number
  founder: boolean
  parents: { id: number; name: string; listed: boolean }[]
  partner: { id: number; name: string; listed: boolean } | null
  children: { id: number; name: string; listed: boolean; alive: boolean }[]
}

export function getCitizenDetail(state: WorldState, id: number): CitizenDetail | null {
  const c = getCitizen(state, id)
  if (!c) return null
  const name = (cid: number) => getPersonName(state, cid)
  const person = (pid: number) => ({ id: pid, name: getPersonName(state, pid), listed: isListedCitizen(state, pid) })
  const homeStructure = c.homeId === null ? undefined : getStructure(state, c.homeId)
  const t = c.task
  let task: CitizenTaskView | null = null
  if (t) {
    const targetCitizen = t.kind === 'socialize' || t.kind === 'share'
    const structure = t.kind === 'build' && t.targetId !== null ? getStructure(state, t.targetId) : undefined
    task = {
      kind: t.kind,
      phase: t.phase,
      destination: t.targetTile === null ? null : toPoint(t.targetTile, state.map.width),
      targetCitizen: targetCitizen && t.targetId !== null ? { id: t.targetId, name: name(t.targetId) } : null,
      targetStructure: structure ? { id: structure.id, kind: structure.kind, stage: structure.stage } : null,
      startedTick: t.startedTick,
    }
  }
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    personality: { ...c.personality },
    needs: { ...c.needs },
    alive: c.alive,
    diedTick: c.diedTick,
    deathCause: c.deathCause,
    pos: { ...c.pos },
    carrying: c.carrying ? { ...c.carrying } : null,
    home: homeStructure
      ? {
          id: homeStructure.id,
          tile: toPoint(homeStructure.tile, state.map.width),
          residents: homeStructure.residentIds.map((rid) => ({ id: rid, name: name(rid) })),
        }
      : null,
    task,
    scores: c.lastScores.map((s) => ({ ...s })),
    lastDecisionTick: c.lastDecisionTick,
    age: ageYears(c, state.tick),
    stage: lifeStage(c, state.tick),
    bornTick: c.bornTick,
    founder: c.parentIds === null,
    parents: (c.parentIds ?? []).map(person),
    partner: c.partnerId === null ? null : person(c.partnerId),
    children: c.childIds.map((cid) => ({ ...person(cid), alive: getCitizen(state, cid)?.alive ?? false })),
  }
}

/**
 * Facts about the latest recorded decision, derived only from stored data
 * (lastScores, lastDecisionTick, task). The UI turns this into a sentence.
 *   chosen      the top-scoring action at that decision
 *   runnerUp    the second-best action with a non-zero score, if any
 *   current     what the citizen is doing now
 *   persisted   the current task started BEFORE that decision and is not
 *               the top action: intention persistence (SWITCH_MARGIN) kept
 *               it because the best alternative did not beat it by the margin
 *   fellBack    the current task started AT that decision but is not the
 *               top action: the top action could not be started (e.g. its
 *               target became unreachable), so the next one was taken
 *   recruited   the citizen is listening in a conversation someone else
 *               started (not their own decision)
 *   impossible  actions that scored 0 (not possible or not wanted then)
 */
export interface DecisionExplanation {
  decidedTick: number | null
  chosen: ActionScore | null
  runnerUp: ActionScore | null
  current: ActionKind | null
  currentScore: number | null
  persisted: boolean
  fellBack: boolean
  recruited: boolean
  /** Who started the conversation, when recruited. */
  recruitedBy: { id: number; name: string } | null
  impossible: ActionKind[]
}

export function explainDecision(state: WorldState, id: number): DecisionExplanation | null {
  const c = getCitizen(state, id)
  if (!c) return null
  const scores = c.lastScores
  const chosen = scores[0] && scores[0].score > 0 ? scores[0] : null
  const runnerUp = scores.slice(1).find((s) => s.score > 0) ?? null
  const current = c.task?.kind ?? null
  const currentScore = current === null ? null : (scores.find((s) => s.kind === current)?.score ?? null)
  const t = c.task
  const recruited = t?.phase === 'listen'
  const differs = chosen !== null && t !== null && !recruited && t.kind !== chosen.kind && c.lastDecisionTick !== null
  const speaker = recruited && t!.targetId !== null ? getCitizen(state, t!.targetId) : undefined
  return {
    decidedTick: c.lastDecisionTick,
    chosen,
    runnerUp,
    current,
    currentScore,
    persisted: differs && t!.startedTick < c.lastDecisionTick!,
    fellBack: differs && t!.startedTick >= c.lastDecisionTick!,
    recruited,
    recruitedBy: speaker ? { id: speaker.id, name: speaker.name } : null,
    impossible: scores.filter((s) => s.score <= 0).map((s) => s.kind),
  }
}

export interface RelationshipView {
  otherId: number
  name: string
  alive: boolean
  /** How the inspected citizen feels about them (their own record). */
  affinity: number
  /** How they feel about the inspected citizen (their record), if any. */
  theirAffinity: number | null
  familiarity: number
  lastTick: number
}

/** The citizen's relationships, sorted (desc) by affinity or familiarity, ties by id. */
export function getRelationships(state: WorldState, id: number, sortBy: 'affinity' | 'familiarity' = 'affinity'): RelationshipView[] {
  const c = getCitizen(state, id)
  if (!c) return []
  const views: RelationshipView[] = []
  for (const [key, rel] of Object.entries(c.relationships)) {
    const other = getCitizen(state, Number(key))
    if (!other) continue
    views.push({
      otherId: other.id,
      name: other.name,
      alive: other.alive,
      affinity: rel.affinity,
      theirAffinity: other.relationships[c.id]?.affinity ?? null,
      familiarity: rel.familiarity,
      lastTick: rel.lastTick,
    })
  }
  return views.sort((a, b) => b[sortBy] - a[sortBy] || a.otherId - b.otherId)
}

export interface MemoryView extends Memory {
  subjectName: string | null
  place: Point | null
}

/** Memories newest first (tick desc, then id desc). */
export function getMemories(state: WorldState, id: number): MemoryView[] {
  const c = getCitizen(state, id)
  if (!c) return []
  return [...c.memories]
    .sort((a, b) => b.tick - a.tick || b.id - a.id)
    .map((m) => ({
      ...m,
      subjectName: m.subjectId === undefined ? null : getPersonName(state, m.subjectId),
      place: m.tile === undefined ? null : toPoint(m.tile, state.map.width),
    }))
}

// ── Events ──────────────────────────────────────────────────────────────────

export type EventCategory = 'social' | 'family' | 'construction' | 'exploration' | 'survival' | 'time'

export const EVENT_CATEGORIES: Readonly<Record<SimEventKind, EventCategory>> = {
  worldCreated: 'time',
  dayStarted: 'time',
  shelterStarted: 'construction',
  shelterCompleted: 'construction',
  shelterAbandoned: 'construction',
  movedIn: 'construction',
  chat: 'social',
  argument: 'social',
  sharedFood: 'social',
  friendship: 'social',
  rivalry: 'social',
  discovered: 'exploration',
  starving: 'survival',
  died: 'survival',
  born: 'family',
  cameOfAge: 'family',
  partnered: 'family',
}

/**
 * Stored events, newest first, optionally filtered by category. These are
 * exactly the world's ring buffer (the last MAX_EVENTS), not a full archive.
 */
export function getEvents(state: WorldState, categories?: readonly EventCategory[], limit = MAX_EVENTS): SimEvent[] {
  const wanted = categories && categories.length > 0 ? new Set(categories) : null
  const out: SimEvent[] = []
  for (let i = state.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = state.events[i]!
    if (!wanted || wanted.has(EVENT_CATEGORIES[e.kind])) out.push(e)
  }
  return out
}

export function getHistory(state: WorldState): readonly HistorySample[] {
  return state.history
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
