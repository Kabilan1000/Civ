// Life cycle (Population V1, docs/design/LIVING_WORLD_TDS.md §8). Runs at
// dawn only, after ecology and before construction:
//
//   1. birthdays — coming of age at ADULT_AGE; from ELDER_AGE an old-age roll
//      (certain at MAX_AGE) → killCitizen(…, 'oldAge')
//   2. partnerships — adults with mutual affinity and familiarity, not kin
//   3. births — per couple, only when every explicit condition holds
//   4. homes — household-aware assignment (construction.assignHomes)
//   5. archive — the dead, one world year after death, are compacted
//
// Everything iterates in ascending id; all randomness comes from
// state.population.rng. Nothing here reads hardship in order to add people:
// births follow the same rules whatever the colony's state (no rescue births).

import {
  ADULT_AGE,
  ARCHIVE_AFTER_DAYS,
  ARCHIVE_MAX,
  BIRTH_CHANCE_PERMILLE,
  BIRTH_FOOD_PER_CAPITA,
  BIRTH_SPACING_DAYS,
  CHILD_TRAIT_VARIATION,
  DECISION_INTERVAL,
  ELDER_AGE,
  FERTILE_AGE,
  INITIAL_NEEDS,
  MAX_OVERCROWD,
  MAX_POPULATION,
  PARTNER_AFFINITY,
  PARTNER_FAMILIARITY,
  SHELTER_CAPACITY,
  TICKS_PER_DAY,
  TRAIT_PRECISION,
} from '../constants.ts'
import { createCitizen } from '../citizens/create.ts'
import { ageYears, areKin, isBirthday, oldAgeHazardPermille } from '../citizens/life.ts'
import { remember } from '../citizens/memory.ts'
import { chooseReplacementExplorer, provisionalRole, roleAtAdulthood } from '../citizens/workforce.ts'
import { CITIZEN_NAMES, NEWBORN_NAMES } from '../citizens/names.ts'
import { pushEvent } from '../events.ts'
import { allocateId } from '../ids.ts'
import { nextInt } from '../rng.ts'
import type { Citizen, Personality, WorldState } from '../types.ts'
import { assignHomes } from './construction.ts'
import { killCitizen } from './death.ts'
import { tickOfDayAt } from './time.ts'

export function updateLifeCycle(state: WorldState): void {
  if (state.tick === 0 || tickOfDayAt(state.tick) !== 0) return
  birthdays(state)
  staffExplorers(state)
  formPartnerships(state)
  births(state)
  assignHomes(state)
  archiveTheDead(state)
}

// ── 1. Birthdays ─────────────────────────────────────────────────────────────

function birthdays(state: WorldState): void {
  for (const c of [...state.citizens]) {
    if (!c.alive || !isBirthday(c, state.tick)) continue
    const age = ageYears(c, state.tick)
    if (age === ADULT_AGE) {
      state.population.counters.comingOfAge++
      c.role = roleAtAdulthood(state, c) // from the adult workforce they join
      pushEvent(state, 'cameOfAge', [c.id], { age, role: c.role })
      c.nextDecisionTick = state.tick // decide now with the full action set
    } else if (age === ELDER_AGE) {
      c.nextDecisionTick = state.tick // elders stop exploring
    }
    const hazard = oldAgeHazardPermille(age)
    if (hazard > 0 && nextInt(state.population.rng, 0, 999) < hazard) {
      state.population.counters.oldAgeDeaths++
      killCitizen(state, c, 'oldAge')
    }
  }
}

// ── 1b. Explorer staffing ────────────────────────────────────────────────────

/** A village with no adult explorer gets one from its workforce (see citizens/workforce.ts). */
function staffExplorers(state: WorldState): void {
  const c = chooseReplacementExplorer(state)
  if (!c) return
  const from = c.role
  c.role = 'explorer'
  c.nextDecisionTick = state.tick
  pushEvent(state, 'roleChanged', [c.id], { from, role: 'explorer' })
}

// ── 2. Partnerships ──────────────────────────────────────────────────────────

function formPartnerships(state: WorldState): void {
  const single = state.citizens.filter((c) => c.alive && c.partnerId === null && ageYears(c, state.tick) >= ADULT_AGE)
  const pairs: { a: Citizen; b: Citizen; affinity: number }[] = []
  for (let i = 0; i < single.length; i++) {
    for (let j = i + 1; j < single.length; j++) {
      const a = single[i]!
      const b = single[j]!
      const ab = a.relationships[b.id]
      const ba = b.relationships[a.id]
      if (!ab || !ba || areKin(a, b)) continue
      if (ab.affinity < PARTNER_AFFINITY || ba.affinity < PARTNER_AFFINITY) continue
      if (ab.familiarity < PARTNER_FAMILIARITY || ba.familiarity < PARTNER_FAMILIARITY) continue
      pairs.push({ a, b, affinity: ab.affinity + ba.affinity })
    }
  }
  // Strongest mutual bonds first; ties by ids (a.id < b.id within a pair).
  pairs.sort((x, y) => y.affinity - x.affinity || x.a.id - y.a.id || x.b.id - y.b.id)
  for (const { a, b } of pairs) {
    if (a.partnerId !== null || b.partnerId !== null) continue
    a.partnerId = b.id
    b.partnerId = a.id
    state.population.counters.partnerships++
    pushEvent(state, 'partnered', [a.id, b.id])
    remember(state, a, 'partnered', 0.7, { subjectId: b.id })
    remember(state, b, 'partnered', 0.7, { subjectId: a.id })
  }
}

// ── 3. Births ────────────────────────────────────────────────────────────────

const fertile = (c: Citizen, tick: number) => {
  const age = ageYears(c, tick)
  return age >= FERTILE_AGE.min && age <= FERTILE_AGE.max
}
const rested = (c: Citizen, tick: number) => c.lastChildTick === null || tick - c.lastChildTick >= BIRTH_SPACING_DAYS * TICKS_PER_DAY

/**
 * The home a couple's child would live in: the housed partner's home (the
 * emptier one if both are housed, then the lower shelter id) with room below
 * SHELTER_CAPACITY + MAX_OVERCROWD. No spare bed is required: a birth may
 * overcrowd a home, which raises housing demand (structures.housingDeficit).
 */
function birthHome(state: WorldState, a: Citizen, b: Citizen): { parent: Citizen; homeId: number } | null {
  const options = [a, b]
    .filter((p) => p.homeId !== null)
    .map((p) => ({ parent: p, home: state.structures.find((s) => s.id === p.homeId)! }))
    .filter((o) => o.home.residentIds.length < SHELTER_CAPACITY + MAX_OVERCROWD)
    .sort((x, y) => x.home.residentIds.length - y.home.residentIds.length || x.home.id - y.home.id)
  return options[0] ? { parent: options[0].parent, homeId: options[0].home.id } : null
}

function births(state: WorldState): void {
  const tick = state.tick
  for (const a of [...state.citizens]) {
    const b = a.partnerId === null ? undefined : state.citizens.find((c) => c.id === a.partnerId)
    if (!a.alive || !b || !b.alive || b.id < a.id) continue // each couple once, from its lower id
    const living = state.citizens.filter((c) => c.alive).length
    if (living >= MAX_POPULATION) return
    if (!fertile(a, tick) || !fertile(b, tick) || !rested(a, tick) || !rested(b, tick)) continue
    if (state.stockpile.food < BIRTH_FOOD_PER_CAPITA * living) continue
    const home = birthHome(state, a, b)
    if (!home) continue
    if (nextInt(state.population.rng, 0, 999) >= BIRTH_CHANCE_PERMILLE) continue
    bear(state, home.parent, home.parent === a ? b : a, home.homeId)
  }
}

function newbornName(state: WorldState): string {
  const used = new Set(state.citizens.filter((c) => c.alive).map((c) => c.name))
  const free = NEWBORN_NAMES.filter((n) => !used.has(n))
  if (free.length > 0) return free[nextInt(state.population.rng, 0, free.length - 1)]!
  const base = NEWBORN_NAMES[nextInt(state.population.rng, 0, NEWBORN_NAMES.length - 1)]!
  for (let k = 2; ; k++) {
    const name = `${base} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][k - 2] ?? k}`
    if (!used.has(name) && !CITIZEN_NAMES.includes(name)) return name
  }
}

function inheritedTrait(state: WorldState, x: number, y: number): number {
  const steps = Math.round(CHILD_TRAIT_VARIATION * TRAIT_PRECISION)
  const v = (x + y) / 2 + nextInt(state.population.rng, -steps, steps) / TRAIT_PRECISION
  return Math.round(Math.min(1, Math.max(0, v)) * TRAIT_PRECISION) / TRAIT_PRECISION
}

function bear(state: WorldState, housedParent: Citizen, other: Citizen, homeId: number): void {
  const name = newbornName(state)
  const role = provisionalRole(state) // provisional: chosen for real at coming of age
  const p = housedParent.personality
  const q = other.personality
  const personality: Personality = {
    sociability: inheritedTrait(state, p.sociability, q.sociability),
    diligence: inheritedTrait(state, p.diligence, q.diligence),
    curiosity: inheritedTrait(state, p.curiosity, q.curiosity),
    resilience: inheritedTrait(state, p.resilience, q.resilience),
  }
  const id = allocateId(state)
  const child = createCitizen(id, name, role, personality, housedParent.pos, id % DECISION_INTERVAL)
  child.needs = { ...INITIAL_NEEDS }
  child.bornTick = state.tick
  child.parentIds = [Math.min(housedParent.id, other.id), Math.max(housedParent.id, other.id)]
  child.nextDecisionTick = state.tick
  child.homeId = homeId
  state.structures.find((s) => s.id === homeId)!.residentIds.push(id)
  state.structures.find((s) => s.id === homeId)!.residentIds.sort((x, y) => x - y)
  state.citizens.push(child) // ids ascend, so the list stays sorted
  for (const parent of [housedParent, other]) {
    parent.childIds.push(id)
    parent.lastChildTick = state.tick
    remember(state, parent, 'childBorn', 0.8, { subjectId: id })
  }
  state.population.counters.births++
  pushEvent(state, 'born', [id, ...child.parentIds], { name })
}

// ── 5. Archive ───────────────────────────────────────────────────────────────

function archiveTheDead(state: WorldState): void {
  const cutoff = state.tick - ARCHIVE_AFTER_DAYS * TICKS_PER_DAY
  const leaving = state.citizens.filter((c) => !c.alive && c.diedTick !== null && c.diedTick <= cutoff)
  if (leaving.length === 0) return
  const gone = new Set(leaving.map((c) => c.id))
  for (const c of leaving) {
    state.archive.push({
      id: c.id,
      name: c.name,
      role: c.role,
      bornTick: c.bornTick,
      diedTick: c.diedTick!,
      cause: c.deathCause!,
      parentIds: c.parentIds,
      partnerId: c.partnerId,
      childIds: [...c.childIds],
    })
  }
  state.population.counters.archived += leaving.length
  if (state.archive.length > ARCHIVE_MAX) state.archive.splice(0, state.archive.length - ARCHIVE_MAX)
  state.citizens = state.citizens.filter((c) => !gone.has(c.id))
  // Relationship records about the archived are dropped; memories (bounded) keep their ids.
  for (const c of state.citizens) for (const id of gone) delete c.relationships[id]
}
