// Task executor: advances each citizen's current task by one tick.
//
// Every task: moveTo (follow the A* path) → arrival phase (ai/phases.ts):
//   gather   every GATHER_TICKS take one unit from the node into `carrying`;
//            ends when full or the node is empty (or vanished)
//   deposit  move the whole load into the stockpile (berries → food)
//   eat      every EAT_TICKS eat one unit: carried berries first, else the
//            stockpile if within CAMP_RADIUS; ends at EAT_STOP_SATIETY or
//            when no food is left
//   sleep    energy refills via the needs system; ends at REST_STOP_ENERGY
//   fetch    (build) at camp: take the wood the site still needs from the
//            stockpile, then walk on to the site to supply it
//   supply   (build) next to the site: hand carried wood over (never more
//            than the site needs; extra stays carried); continue to
//            construct once fully supplied
//   construct (build) next to the site: +1 labour per tick until complete
//   talk / listen / give   social interactions (systems/social.ts)
//   survey   (explore) after SURVEY_TICKS reveal EXPLORE_REVEAL_RADIUS around
//            the citizen; bumps map.version; 'discovered' memory and event
//   linger   wait, then end
// Transfers move whole units and are mirrored in state.ledger, so food and
// wood are conserved. A finished or failed task makes the citizen decide
// again next tick.

import {
  CAMP_RADIUS,
  CARRY_CAPACITY,
  DISCOVERY_EVENT_MIN_TILES,
  EAT_STOP_SATIETY,
  EAT_TICKS,
  EXPLORE_REVEAL_RADIUS,
  FOOD_SATIETY,
  GATHER_TICKS,
  REST_STOP_ENERGY,
} from '../constants.ts'
import { remember } from '../citizens/memory.ts'
import { pushEvent } from '../events.ts'
import { revealAround } from '../map/discovery.ts'
import { observeAround } from '../map/visibility.ts'
import { getCampTile } from '../ai/context.ts'
import { enterArrivalPhase } from '../ai/phases.ts'
import { manhattan, toPoint } from '../grid.ts'
import { findPath } from '../path/astar.ts'
import { walkableFor, woodStillNeeded, workTiles } from '../structures.ts'
import type { Citizen, Structure, WorldState } from '../types.ts'
import { supplySite, workOnSite } from './construction.ts'
import { give, listen, talk } from './social.ts'
import { advanceMovement, clearPath, setPath } from './movement.ts'
import { clampNeed } from './needs.ts'

export function endTask(state: WorldState, c: Citizen): void {
  c.task = null
  clearPath(c)
  c.nextDecisionTick = state.tick + 1
}

export function isAtCamp(state: WorldState, c: Citizen): boolean {
  const camp = getCampTile(state)
  return camp !== null && manhattan(c.pos, toPoint(camp, state.map.width)) <= CAMP_RADIUS
}

function gather(state: WorldState, c: Citizen): void {
  const task = c.task!
  const node = task.targetTile === null ? null : state.map.resources[task.targetTile]
  const here = c.pos.y * state.map.width + c.pos.x
  if (!node || node.amount <= 0 || task.targetTile !== here || (c.carrying && c.carrying.kind !== node.kind)) {
    endTask(state, c)
    return
  }
  if (--task.ticksLeft > 0) return

  node.amount--
  state.map.version++
  if (c.carrying) c.carrying.amount++
  else c.carrying = { kind: node.kind, amount: 1 }
  if (node.kind === 'berries') state.ledger.foodGathered++
  else state.ledger.woodGathered++
  // Memories: a productive spot (refreshed, not duplicated, on every unit) / an emptied one.
  remember(state, c, 'foundResource', 0.15, { tile: task.targetTile })
  if (node.amount <= 0) remember(state, c, 'resourceDepleted', -0.1, { tile: task.targetTile })

  if (c.carrying.amount >= CARRY_CAPACITY[node.kind] || node.amount <= 0) endTask(state, c)
  else task.ticksLeft = GATHER_TICKS[node.kind]
}

function deposit(state: WorldState, c: Citizen): void {
  const load = c.carrying
  if (load && isAtCamp(state, c)) {
    if (load.kind === 'berries') state.stockpile.food += load.amount
    else state.stockpile.wood += load.amount
    c.carrying = null
  }
  endTask(state, c)
}

function eat(state: WorldState, c: Citizen): void {
  const task = c.task!
  if (--task.ticksLeft > 0) return
  const carry = c.carrying
  if (carry && carry.kind === 'berries' && carry.amount > 0) {
    carry.amount--
    if (carry.amount === 0) c.carrying = null
  } else if (state.stockpile.food > 0 && isAtCamp(state, c)) {
    state.stockpile.food--
  } else {
    endTask(state, c)
    return
  }
  state.ledger.foodEaten++
  c.needs.satiety = clampNeed(c.needs.satiety + FOOD_SATIETY)
  if (c.needs.satiety >= EAT_STOP_SATIETY) endTask(state, c)
  else task.ticksLeft = EAT_TICKS
}

function taskSite(state: WorldState, c: Citizen): Structure | undefined {
  const id = c.task?.targetId
  return id === null || id === undefined ? undefined : state.structures.find((s) => s.id === id && s.kind === 'shelter')
}

function besideSite(state: WorldState, c: Citizen, site: Structure): boolean {
  return manhattan(c.pos, toPoint(site.tile, state.map.width)) === 1
}

function fetchWood(state: WorldState, c: Citizen): void {
  const site = taskSite(state, c)
  if (!site || site.stage !== 'planned' || !isAtCamp(state, c) || (c.carrying && c.carrying.kind !== 'wood')) {
    endTask(state, c)
    return
  }
  const carried = c.carrying?.amount ?? 0
  const take = Math.min(CARRY_CAPACITY.wood - carried, woodStillNeeded(state, site), state.stockpile.wood)
  if (take > 0) {
    state.stockpile.wood -= take
    c.carrying = { kind: 'wood', amount: carried + take }
  }
  if (!c.carrying) {
    endTask(state, c)
    return
  }
  // Carry it on (same task): nearest reachable work tile by path length, then tile index.
  const here = c.pos.y * state.map.width + c.pos.x
  const walk = walkableFor(state, c)
  let best: { tile: number; path: number[] } | null = null
  for (const tile of workTiles(state, site)) {
    const path = findPath(state.map, here, tile, { canEnter: walk })
    if (path && (!best || path.length < best.path.length || (path.length === best.path.length && tile < best.tile))) {
      best = { tile, path }
    }
  }
  if (!best) {
    endTask(state, c) // keeps the wood; a later decision can deliver it
    return
  }
  const task = c.task!
  task.targetTile = best.tile
  task.phase = 'moveTo'
  setPath(state.map, c, best.path)
  if (best.path.length === 0) enterArrivalPhase(state, c)
}

function supply(state: WorldState, c: Citizen): void {
  const site = taskSite(state, c)
  const carry = c.carrying
  if (!site || !carry || carry.kind !== 'wood' || !besideSite(state, c, site)) {
    endTask(state, c)
    return
  }
  carry.amount -= supplySite(state, site, carry.amount)
  if (carry.amount <= 0) c.carrying = null
  if (site.stage === 'underConstruction') c.task!.phase = 'construct'
  else endTask(state, c)
}

function construct(state: WorldState, c: Citizen): void {
  const site = taskSite(state, c)
  if (!site || site.stage !== 'underConstruction' || !besideSite(state, c, site)) {
    endTask(state, c)
    return
  }
  // Everyone building it right now (including c) remembers finishing it.
  const crew = state.citizens.filter((o) => o.alive && o.task?.kind === 'build' && o.task.targetId === site.id)
  if (workOnSite(state, site)) {
    for (const o of crew) remember(state, o, 'builtShelter', 0.5, { tile: site.tile })
    endTask(state, c)
  }
}

function survey(state: WorldState, c: Citizen): void {
  const task = c.task!
  if (--task.ticksLeft > 0) return
  const here = c.pos.y * state.map.width + c.pos.x
  const revealed = revealAround(state.map, here, EXPLORE_REVEAL_RADIUS)
  observeAround(state.map, here, EXPLORE_REVEAL_RADIUS, state.tick) // a survey refreshes what it sees (schema v9)
  if (revealed > 0) {
    remember(state, c, 'discovered', Math.min(0.7, 0.2 + revealed / 40), { tile: here })
    if (revealed >= DISCOVERY_EVENT_MIN_TILES) pushEvent(state, 'discovered', [c.id], { tiles: revealed, tile: here })
  }
  endTask(state, c)
}

export function advanceTasks(state: WorldState): void {
  for (const c of state.citizens) {
    const task = c.task
    if (!c.alive || task === null) continue

    switch (task.phase) {
      case 'moveTo': {
        const result = advanceMovement(state.map, c, walkableFor(state, c))
        if (result === 'arrived') enterArrivalPhase(state, c)
        else if (result !== 'moving') endTask(state, c)
        break
      }
      case 'gather':
        gather(state, c)
        break
      case 'deposit':
        deposit(state, c)
        break
      case 'eat':
        eat(state, c)
        break
      case 'sleep':
        if (c.needs.energy >= REST_STOP_ENERGY) endTask(state, c)
        break
      case 'fetch':
        fetchWood(state, c)
        break
      case 'supply':
        supply(state, c)
        break
      case 'construct':
        construct(state, c)
        break
      case 'talk':
        talk(state, c, endTask)
        break
      case 'listen':
        listen(state, c, endTask)
        break
      case 'give':
        give(state, c, endTask)
        break
      case 'survey':
        survey(state, c)
        break
      case 'linger':
        if (--task.ticksLeft <= 0) endTask(state, c)
        break
      default:
        endTask(state, c) // unknown phase: fail safe
    }
  }
}
