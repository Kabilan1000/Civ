import { useMemo, useState } from 'react'
import type { SimulationController, SimulationSnapshot } from '../../app/SimulationController.ts'
import { EVENT_CATEGORIES, MAX_EVENTS, getEvents, type EventCategory } from '../../sim/index.ts'
import { CATEGORY_LABELS, describeEvent, formatTick } from '../format/text.ts'
import { CitizenLink } from './CitizenLink.tsx'

const ORDER: EventCategory[] = ['social', 'construction', 'exploration', 'survival', 'time']

interface Props {
  controller: SimulationController
  snapshot: SimulationSnapshot
  onSelect: (id: number) => void
}

export function EventFeed({ controller, snapshot, onSelect }: Props) {
  const [active, setActive] = useState<EventCategory[]>([])
  const state = controller.state
  // Events up to the snapshot's newest one (consistent with the rest of the UI);
  // recomputed only when a new event is stored or the filter changes.
  const lastEventId = snapshot.lastEventId
  const events = useMemo(() => getEvents(state, active).filter((e) => e.id <= lastEventId), [state, active, lastEventId])
  const nameOf = (id: number) => state.citizens.find((c) => c.id === id)?.name ?? `#${id}`
  const toggle = (c: EventCategory) => setActive((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c]))

  return (
    <section className="panel feed" aria-label="Event feed">
      <div className="panel-title-row">
        <h2>Events</h2>
        <div className="chips" role="group" aria-label="Filter by category">
          <button type="button" className="chip" aria-pressed={active.length === 0} onClick={() => setActive([])}>
            All
          </button>
          {ORDER.map((c) => (
            <button key={c} type="button" className={`chip cat-${c}`} aria-pressed={active.includes(c)} onClick={() => toggle(c)}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      {events.length === 0 ? (
        <p className="empty">{active.length ? 'No stored events in these categories yet.' : 'Nothing has happened yet.'}</p>
      ) : (
        <ol className="events" aria-live="off">
          {events.map((e) => {
            const cat = EVENT_CATEGORIES[e.kind]
            return (
              <li key={e.id}>
                <span className={`cat-dot cat-${cat}`} title={CATEGORY_LABELS[cat]} aria-hidden />
                <span className="event-time num">{formatTick(e.tick)}</span>
                <span className="event-text">
                  {describeEvent(e, nameOf).map((seg, i) =>
                    typeof seg === 'string' ? (
                      <span key={i}>{seg}</span>
                    ) : (
                      <CitizenLink key={i} id={seg.citizenId} name={seg.name} onSelect={onSelect} dead={!state.citizens.find((c) => c.id === seg.citizenId)?.alive} />
                    ),
                  )}
                </span>
                <span className="event-cat muted small">{CATEGORY_LABELS[cat]}</span>
              </li>
            )
          })}
        </ol>
      )}
      <p className="muted small feed-note">
        Showing {events.length} of the {state.events.length} most recent stored events — the world keeps only the last {MAX_EVENTS}.
        Plain chats are remembered by citizens but not logged here.
      </p>
    </section>
  )
}
