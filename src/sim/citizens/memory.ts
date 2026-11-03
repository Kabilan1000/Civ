// Citizen memory: a bounded list of things that really happened.
//
// Recorded only by the systems where the event occurs (a finished chat or
// argument, a food hand-over, a gather, a survey, a completed shelter, a
// witnessed death) — never invented.
//
// Bounds: at most MAX_MEMORIES per citizen. A repeat of the same kind,
// subject and tile within MEMORY_MERGE_TICKS refreshes the existing memory
// (newer tick, stronger valence) instead of adding a duplicate. When full,
// the least salient memory is forgotten: smallest |valence|, then oldest,
// then lowest id. Deterministic and order-independent.

import { MAX_MEMORIES, MEMORY_MERGE_TICKS, MEMORY_RELEVANCE_TICKS } from '../constants.ts'
import { allocateId } from '../ids.ts'
import type { Citizen, Memory, MemoryKind, TileIndex, WorldState } from '../types.ts'

export interface MemoryDetails {
  subjectId?: number
  tile?: TileIndex
}

export function remember(
  state: WorldState,
  c: Citizen,
  kind: MemoryKind,
  valence: number,
  details: MemoryDetails = {},
): Memory {
  const v = Math.max(-1, Math.min(1, valence))
  const existing = c.memories.find(
    (m) =>
      m.kind === kind &&
      m.subjectId === details.subjectId &&
      m.tile === details.tile &&
      state.tick - m.tick <= MEMORY_MERGE_TICKS,
  )
  if (existing) {
    existing.tick = state.tick
    if (Math.abs(v) > Math.abs(existing.valence)) existing.valence = v
    return existing
  }

  const memory: Memory = { id: allocateId(state), tick: state.tick, kind, valence: v }
  if (details.subjectId !== undefined) memory.subjectId = details.subjectId
  if (details.tile !== undefined) memory.tile = details.tile
  c.memories.push(memory)
  if (c.memories.length > MAX_MEMORIES) {
    let weakest = 0
    for (let i = 1; i < c.memories.length; i++) {
      const a = c.memories[i]!
      const b = c.memories[weakest]!
      const sa = Math.abs(a.valence)
      const sb = Math.abs(b.valence)
      if (sa < sb || (sa === sb && (a.tick < b.tick || (a.tick === b.tick && a.id < b.id)))) weakest = i
    }
    c.memories.splice(weakest, 1)
  }
  return memory
}

/** Memories of `kind` still recent enough to influence decisions. */
export function recentMemories(state: WorldState, c: Citizen, kind: MemoryKind, subjectId?: number): Memory[] {
  return c.memories.filter(
    (m) =>
      m.kind === kind &&
      (subjectId === undefined || m.subjectId === subjectId) &&
      state.tick - m.tick <= MEMORY_RELEVANCE_TICKS,
  )
}
