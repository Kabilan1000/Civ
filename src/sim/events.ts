import { MAX_EVENTS } from './constants.ts'
import type { SimEvent, SimEventKind, WorldState } from './types.ts'

/**
 * Append a structured event stamped with the current tick. Once MAX_EVENTS
 * is reached the oldest event is dropped. Text is formatted by the UI.
 * Event ids come from their own counter (schema v6), so adding an event never
 * shifts citizen, structure or memory ids.
 */
export function pushEvent(
  state: WorldState,
  kind: SimEventKind,
  citizenIds: number[] = [],
  data?: Record<string, number | string>,
): SimEvent {
  const event: SimEvent = { id: state.nextEventId++, tick: state.tick, kind, citizenIds: [...citizenIds] }
  if (data) event.data = { ...data }
  state.events.push(event)
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS)
  }
  return event
}
