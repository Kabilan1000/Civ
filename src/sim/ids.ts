import type { WorldState } from './types.ts'

/** Hand out the next unique id (shared by citizens, structures and events). */
export function allocateId(state: Pick<WorldState, 'nextId'>): number {
  return state.nextId++
}
