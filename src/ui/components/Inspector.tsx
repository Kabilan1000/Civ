import { useState } from 'react'
import type { SimulationController, SimulationSnapshot } from '../../app/SimulationController.ts'
import {
  explainDecision,
  getPersonName,
  getCitizenDetail,
  getMemories,
  getRelationships,
  type CitizenDetail,
  type WorldState,
} from '../../sim/index.ts'
import { formatCalendarTick } from '../format/calendar.ts'
import { ACTION_LABELS, MEMORY_LABELS, PHASE_LABELS, explainText, formatTick } from '../format/text.ts'
import { CitizenLink } from './CitizenLink.tsx'
import { Meter } from './Meter.tsx'

type Tab = 'overview' | 'decision' | 'relationships' | 'memories'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'decision', label: 'Decision' },
  { id: 'relationships', label: 'Bonds' },
  { id: 'memories', label: 'Memories' },
]

const ROLE_LABEL = { forager: 'Forager', builder: 'Builder', explorer: 'Explorer' } as const
const STAGE_LABEL = { child: 'Child', adult: 'Adult', elder: 'Elder' } as const
const CAUSE_LABEL = { starvation: 'starvation', exhaustion: 'exhaustion', oldAge: 'old age' } as const

/** A family member: a link while they are still listed (living or recently dead), plain text once archived. */
function Person({ p, onSelect }: { p: { id: number; name: string; listed: boolean }; onSelect: (id: number) => void }) {
  return p.listed ? <CitizenLink id={p.id} name={p.name} onSelect={onSelect} /> : <span className="muted">{p.name}</span>
}

function joinPeople(list: { id: number; name: string; listed: boolean; alive?: boolean }[], onSelect: (id: number) => void) {
  return list.map((p, i) => (
    <span key={p.id}>
      <Person p={p} onSelect={onSelect} />
      {p.alive === false && <span className="muted small"> †</span>}
      {i < list.length - 1 ? ', ' : ''}
    </span>
  ))
}

interface Props {
  controller: SimulationController
  snapshot: SimulationSnapshot
  selectedId: number | null
  onSelect: (id: number | null) => void
}

export function Inspector({ controller, snapshot, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const state = controller.state
  void snapshot.tick // re-read the world whenever a new snapshot is published
  const detail = selectedId === null ? null : getCitizenDetail(state, selectedId)

  if (!detail) {
    return (
      <section className="panel inspector" aria-label="Citizen inspector">
        <h2>Citizen</h2>
        <p className="empty">Click a citizen on the map, or pick one here.</p>
        <div className="roster">
          {state.citizens.map((c) => (
            <button key={c.id} type="button" className={`roster-chip role-${c.role}${c.alive ? '' : ' dead'}`} onClick={() => onSelect(c.id)} title={`${c.name} — ${ROLE_LABEL[c.role]}${c.alive ? '' : ' (deceased)'}`}>
              <span className="dot" aria-hidden />
              {c.name}
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="panel inspector" aria-label={`Inspecting ${detail.name}`}>
      <div className="inspector-head">
        <span className={`role-dot role-${detail.role}`} aria-hidden />
        <div>
          <h2 className="citizen-name">{detail.name}</h2>
          <div className="muted">
            {detail.stage === 'child' ? `Child, ${detail.age}` : `${ROLE_LABEL[detail.role]} · ${STAGE_LABEL[detail.stage]}, ${detail.age}`} ·{' '}
            {detail.alive ? (
              'alive'
            ) : (
              <span className="deceased">deceased — {CAUSE_LABEL[detail.deathCause ?? 'starvation']} ({formatTick(detail.diedTick ?? 0)})</span>
            )}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={() => onSelect(null)} aria-label="Close inspector" title="Deselect">
          ×
        </button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-body" role="tabpanel">
        {tab === 'overview' && <Overview detail={detail} onSelect={onSelect} />}
        {tab === 'decision' && <Decision state={state} detail={detail} />}
        {tab === 'relationships' && <Bonds state={state} id={detail.id} onSelect={onSelect} />}
        {tab === 'memories' && <Memories state={state} id={detail.id} onSelect={onSelect} />}
      </div>
    </section>
  )
}

function Overview({ detail: d, onSelect }: { detail: CitizenDetail; onSelect: (id: number) => void }) {
  const t = d.task
  return (
    <>
      <div className="meters">
        <Meter label="Satiety" value={d.needs.satiety} hint="100 = full; hunger is the inverse" />
        <Meter label="Energy" value={d.needs.energy} />
        <Meter label="Social" value={d.needs.social} />
        <Meter label="Health" value={d.needs.health} />
      </div>
      <dl className="facts">
        <dt>Doing</dt>
        <dd>
          {!d.alive ? '—' : t ? (
            <>
              {t.resurvey ? 'Resurvey stale land' : ACTION_LABELS[t.kind]} <span className="muted">({PHASE_LABELS[t.phase] ?? t.phase})</span>
              {t.targetCitizen && (
                <>
                  {' '}with <CitizenLink id={t.targetCitizen.id} name={t.targetCitizen.name} onSelect={onSelect} />
                </>
              )}
            </>
          ) : (
            <span className="muted">deciding</span>
          )}
        </dd>
        <dt>Heading to</dt>
        <dd className="num">{t?.destination ? `(${t.destination.x}, ${t.destination.y})` : '—'}</dd>
        <dt>Position</dt>
        <dd className="num">({d.pos.x}, {d.pos.y})</dd>
        <dt>Carrying</dt>
        <dd>{d.carrying ? `${d.carrying.amount} ${d.carrying.kind}` : 'nothing'}</dd>
        <dt>Home</dt>
        <dd>
          {d.home ? (
            <>
              shelter at <span className="num">({d.home.tile.x}, {d.home.tile.y})</span>
              <div className="muted small">
                with{' '}
                {d.home.residents.filter((r) => r.id !== d.id).map((r, i, all) => (
                  <span key={r.id}>
                    <CitizenLink id={r.id} name={r.name} onSelect={onSelect} />
                    {i < all.length - 1 ? ', ' : ''}
                  </span>
                ))}
                {d.home.residents.length <= 1 && 'nobody else'}
              </div>
            </>
          ) : (
            <span className="muted">none yet</span>
          )}
        </dd>
      </dl>
      <h3>Family</h3>
      <dl className="facts">
        <dt>Age</dt>
        <dd>
          {d.age} <span className="muted small">({STAGE_LABEL[d.stage].toLowerCase()}{d.stage === 'child' ? `; likely to work as a ${ROLE_LABEL[d.role].toLowerCase()} from ${d.adultAge}` : ''})</span>
        </dd>
        <dt>Born</dt>
        <dd>{d.founder ? <span className="muted">a founder of the village</span> : <span title={formatCalendarTick(d.bornTick)}>{formatTick(d.bornTick)}</span>}</dd>
        <dt>Parents</dt>
        <dd>{d.parents.length ? joinPeople(d.parents, onSelect) : <span className="muted">—</span>}</dd>
        <dt>Partner</dt>
        <dd>{d.partner ? <Person p={d.partner} onSelect={onSelect} /> : <span className="muted">none</span>}</dd>
        <dt>Children</dt>
        <dd>{d.children.length ? joinPeople(d.children, onSelect) : <span className="muted">none</span>}</dd>
      </dl>
      <h3>Personality</h3>
      <div className="traits">
        {(Object.entries(d.personality) as [keyof typeof d.personality, number][]).map(([k, v]) => (
          <div key={k} className="trait" title={`${k}: ${v.toFixed(2)} (0–1)`}>
            <span className="trait-name">{k}</span>
            <div className="trait-track"><div className="trait-fill" style={{ width: `${v * 100}%` }} /></div>
            <span className="num small">{v.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function Decision({ state, detail }: { state: WorldState; detail: CitizenDetail }) {
  const why = explainDecision(state, detail.id)!
  const nameOf = (id: number) => getPersonName(state, id)
  const max = Math.max(0.0001, ...detail.scores.map((s) => s.score))
  return (
    <>
      <div className="explain">
        {explainText(why, nameOf).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <h3>
        Action scores <span className="muted small">{detail.lastDecisionTick !== null ? `at ${formatTick(detail.lastDecisionTick)}` : ''}</span>
      </h3>
      {detail.scores.length === 0 ? (
        <p className="empty">No scores recorded yet.</p>
      ) : (
        <ol className="scores">
          {detail.scores.map((s) => (
            <li key={s.kind} className={s.kind === detail.task?.kind ? 'current' : ''} title={`${ACTION_LABELS[s.kind]}: ${s.score.toFixed(3)}`}>
              <span className="score-name">{ACTION_LABELS[s.kind]}</span>
              <div className="score-track"><div className="score-fill" style={{ width: `${(s.score / max) * 100}%` }} /></div>
              <span className="num">{s.score.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">Scores are recorded at each decision (every 10 ticks while busy, and when a task ends). The highlighted row is the current task.</p>
    </>
  )
}

function affinityClass(a: number) {
  return a >= 50 ? 'pos-strong' : a > 0 ? 'pos' : a <= -40 ? 'neg-strong' : a < 0 ? 'neg' : ''
}

function Bonds({ state, id, onSelect }: { state: WorldState; id: number; onSelect: (id: number) => void }) {
  const [sortBy, setSortBy] = useState<'affinity' | 'familiarity'>('affinity')
  const rels = getRelationships(state, id, sortBy)
  const me = state.citizens.find((c) => c.id === id)!.name
  if (rels.length === 0) return <p className="empty">{me} hasn't completed an interaction with anyone yet.</p>
  return (
    <>
      <div className="segmented small-seg" role="group" aria-label="Sort by">
        {(['affinity', 'familiarity'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>
            {k === 'affinity' ? 'By affinity' : 'By familiarity'}
          </button>
        ))}
      </div>
      <table className="rel-table">
        <thead>
          <tr>
            <th scope="col">Citizen</th>
            <th scope="col" title={`How ${me} feels about them (−100…100)`}>{me} → them</th>
            <th scope="col" title={`How they feel about ${me} (−100…100)`}>them → {me}</th>
            <th scope="col" title="How well they know each other (0…100)">Familiar</th>
          </tr>
        </thead>
        <tbody>
          {rels.map((r) => (
            <tr key={r.otherId}>
              <td>
                <CitizenLink id={r.otherId} name={r.name} onSelect={onSelect} dead={!r.alive} />
                {!r.alive && <span className="muted small"> †</span>}
              </td>
              <td className={`num ${affinityClass(r.affinity)}`}>{r.affinity.toFixed(0)}</td>
              <td className={`num ${r.theirAffinity === null ? 'muted' : affinityClass(r.theirAffinity)}`}>
                {r.theirAffinity === null ? '—' : r.theirAffinity.toFixed(0)}
              </td>
              <td className="num">{r.familiarity.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Affinity is directional: each citizen keeps their own view. Familiarity is shared.</p>
    </>
  )
}

function Memories({ state, id, onSelect }: { state: WorldState; id: number; onSelect: (id: number) => void }) {
  const memories = getMemories(state, id)
  if (memories.length === 0) return <p className="empty">No memories yet.</p>
  return (
    <>
      <ul className="memories">
        {memories.map((m) => (
          <li key={m.id}>
            <span className={`valence ${m.valence > 0.05 ? 'pos' : m.valence < -0.05 ? 'neg' : ''}`} title={`Valence ${m.valence.toFixed(2)}`} aria-hidden />
            <div>
              <div>
                <strong>{MEMORY_LABELS[m.kind]}</strong>
                {m.subjectName && m.subjectId !== undefined && (
                  <>
                    {' — '}
                    <CitizenLink id={m.subjectId} name={m.subjectName} onSelect={onSelect} />
                  </>
                )}
                {m.place && <span className="muted num"> ({m.place.x}, {m.place.y})</span>}
              </div>
              <div className="muted small num">
                {formatTick(m.tick)} · tick {m.tick}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">Up to 24 memories are kept; repeats refresh the older entry, and the weakest are forgotten first.</p>
    </>
  )
}
