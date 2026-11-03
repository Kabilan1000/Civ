import type { WorldState } from './types.ts'

/** Hand out the next unique entity id (shared by citizens, structures and memories; events have their own counter). */
export function allocateId(state: Pick<WorldState, 'nextId'>): number {
  return state.nextId++
}
