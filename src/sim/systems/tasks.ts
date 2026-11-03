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
//   linger   wait, then end
// Transfers move whole units and are mirrored in state.ledger, so food and
// wood are conserved. A finished or failed task makes the citizen decide
// again next tick.

import { CAMP_RADIUS, CARRY_CAPACITY, EAT_STOP_SATIETY, EAT_TICKS, FOOD_SATIETY, GATHER_TICKS, REST_STOP_ENERGY } from '../constants.ts'
import { getCampTile } from '../ai/context.ts'
import { enterArrivalPhase } from '../ai/phases.ts'
import { manhattan, toPoint } from '../grid.ts'
import type { Citizen, WorldState } from '../types.ts'
import { advanceMovement, clearPath } from './movement.ts'
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

export function advanceTasks(state: WorldState): void {
  for (const c of state.citizens) {
    const task = c.task
    if (!c.alive || task === null) continue

    switch (task.phase) {
      case 'moveTo': {
        const result = advanceMovement(state.map, c)
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
      case 'linger':
        if (--task.ticksLeft <= 0) endTask(state, c)
        break
      default:
        endTask(state, c) // unknown phase: fail safe
    }
  }
}
