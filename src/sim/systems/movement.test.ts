import { describe, expect, it } from 'vitest'
import { asciiMap } from '../__tests__/asciiMap.ts'
import { isAdjacent4, isPassable, stepCost, toIndex } from '../grid.ts'
import { findPath } from '../path/astar.ts'
import { getVisualPosition } from '../selectors.ts'
import type { Citizen, TileMap, WorldState } from '../types.ts'
import { createWorld, step } from '../world.ts'
import { advanceMovement, setPath } from './movement.ts'

/** A world whose map is replaced by a fully discovered ASCII map and a single citizen. */
function sandbox(rows: string[], x: number, y: number): { state: WorldState; c: Citizen; map: TileMap } {
  const state = createWorld({ seed: 'sandbox', citizenCount: 1 })
  const map = asciiMap(rows)
  map.discovered = map.discovered.map(() => 1)
  state.map = map
  state.config = { ...state.config, width: map.width, height: map.height }
  const c = state.citizens[0]!
  c.pos = { x, y }
  c.nextDecisionTick = Number.MAX_SAFE_INTEGER // keep the AI out of the way
  return { state, c, map }
}

describe('advanceMovement', () => {
  it('enters each tile after exactly its terrain step cost in ticks', () => {
    const { c, map } = sandbox(['.sf.'], 0, 0)
    setPath(map, c, [1, 2, 3]) // sand 3, forest 3, grass 2
    const arrivals: number[] = []
    for (let tick = 1; tick <= 20 && arrivals.length < 3; tick++) {
      const before = c.pos.x
      advanceMovement(map, c)
      if (c.pos.x !== before) arrivals.push(tick)
    }
    expect(arrivals).toEqual([3, 6, 8])
    expect(c.path).toEqual([])
  })

  it('reports arrival and clears the path', () => {
    const { c, map } = sandbox(['..'], 0, 0)
    setPath(map, c, [1])
    expect(advanceMovement(map, c)).toBe('moving')
    expect(advanceMovement(map, c)).toBe('arrived')
    expect(c.pos).toEqual({ x: 1, y: 0 })
    expect(advanceMovement(map, c)).toBe('idle')
  })

  it('refuses blocked or non-adjacent next tiles without moving', () => {
    const { c, map } = sandbox(['...', '...'], 0, 0)
    setPath(map, c, [1, 2])
    map.terrain[1] = 'rock'
    expect(advanceMovement(map, c)).toBe('blocked')
    expect(c.pos).toEqual({ x: 0, y: 0 })
    expect(c.path).toEqual([])

    map.terrain[1] = 'grass'
    setPath(map, c, [5]) // (2,1): not a neighbour of (0,0)
    expect(advanceMovement(map, c)).toBe('blocked')
    expect(c.pos).toEqual({ x: 0, y: 0 })
  })

  it('handles an empty path safely', () => {
    const { c, map } = sandbox(['..'], 0, 0)
    setPath(map, c, [])
    expect(advanceMovement(map, c)).toBe('idle')
    expect(c.pos).toEqual({ x: 0, y: 0 })
  })
})

describe('getVisualPosition', () => {
  it('interpolates between the current and next tile', () => {
    const { state, c, map } = sandbox(['...'], 0, 0)
    expect(getVisualPosition(state, c, 0.5)).toEqual({ x: 0, y: 0 })
    setPath(map, c, [1, 2]) // grass, cost 2
    expect(getVisualPosition(state, c, 0)).toEqual({ x: 0, y: 0 })
    expect(getVisualPosition(state, c, 0.5)).toEqual({ x: 0.25, y: 0 })
    advanceMovement(map, c)
    expect(getVisualPosition(state, c, 0.5)).toEqual({ x: 0.75, y: 0 })
    advanceMovement(map, c) // entered (1,0)
    expect(getVisualPosition(state, c, 0)).toEqual({ x: 1, y: 0 })
  })
})

/** Run a world tick by tick, checking movement invariants every tick. */
function observe(seed: string, ticks: number) {
  const state = createWorld({ seed })
  const prev = state.citizens.map((c) => ({ ...c.pos }))
  const lastMoveTick = state.citizens.map(() => -1)
  let moves = 0
  let timedSteps = 0
  const destinations: number[] = []

  for (let t = 0; t < ticks; t++) {
    const tasksBefore = state.citizens.map((c) => c.task)
    step(state)
    state.citizens.forEach((c, i) => {
      const tile = toIndex(c.pos.x, c.pos.y, state.map.width)
      expect(isPassable(state.map, tile)).toBe(true)
      expect(state.map.discovered[tile]).toBe(1)

      // New wander task: destination must be discovered and reachable.
      if (c.task && c.task !== tasksBefore[i] && c.task.targetTile !== null) {
        const dest = c.task.targetTile
        destinations.push(dest)
        expect(state.map.discovered[dest]).toBe(1)
        expect(isPassable(state.map, dest)).toBe(true)
        expect(findPath(state.map, tile, dest)).not.toBeNull()
      }

      const p = prev[i]!
      if (p.x !== c.pos.x || p.y !== c.pos.y) {
        expect(isAdjacent4(p, c.pos)).toBe(true) // no teleport, no diagonal
        // Consecutive steps along one path are spaced by the entered tile's cost.
        if (lastMoveTick[i]! >= 0 && c.task?.startedTick !== undefined && c.task.startedTick < lastMoveTick[i]!) {
          expect(state.tick - lastMoveTick[i]!).toBe(stepCost(state.map, tile))
          timedSteps++
        }
        lastMoveTick[i] = state.tick
        moves++
        prev[i] = { ...c.pos }
      }
    })
  }
  return { state, moves, timedSteps, destinations }
}

describe('wandering', () => {
  it('moves citizens only to adjacent, passable, discovered tiles at terrain speed', () => {
    for (const seed of ['wander-a', 'wander-b', 'wander-c']) {
      const { moves, timedSteps, destinations } = observe(seed, 1500)
      expect(moves).toBeGreaterThan(500) // citizens really do walk
      expect(timedSteps).toBeGreaterThan(200) // the step-cost timing check really runs
      expect(destinations.length).toBeGreaterThan(50)
    }
  })

  it('stays inside the discovered area across many seeds', () => {
    for (let i = 0; i < 10; i++) {
      const state = createWorld({ seed: `fog-${i}` })
      for (let t = 0; t < 600; t++) {
        step(state)
        for (const c of state.citizens) {
          expect(state.map.discovered[toIndex(c.pos.x, c.pos.y, state.map.width)]).toBe(1)
          for (const tile of c.path) expect(state.map.discovered[tile]).toBe(1)
        }
      }
    }
  })

  it('never recomputes a path mid-walk (path only changes when a task starts)', () => {
    const state = createWorld({ seed: 'no-repath' })
    for (let t = 0; t < 1000; t++) {
      const before = state.citizens.map((c) => ({ path: c.path, task: c.task }))
      step(state)
      state.citizens.forEach((c, i) => {
        if (c.path.length > 0 && c.path !== before[i]!.path) expect(c.task).not.toBe(before[i]!.task)
      })
    }
  })

  it('ends the task safely when the path becomes blocked', () => {
    const state = createWorld({ seed: 'blocked' })
    let c: Citizen | undefined
    for (let t = 0; t < 50 && !c; t++) {
      step(state)
      c = state.citizens.find((x) => x.path.length - x.pathIndex >= 2)
    }
    expect(c).toBeDefined()
    const pos = { ...c!.pos }
    state.map.terrain[c!.path[c!.pathIndex]!] = 'rock'
    step(state)
    expect(c!.pos).toEqual(pos)
    expect(c!.task).toBeNull()
    expect(c!.path).toEqual([])
  })
})
