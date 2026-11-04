// Presentation text for simulation data (CLAUDE.md rule 10: the sim stores
// structured data; wording lives here). Every sentence is built only from
// fields that exist in the stored event / memory / decision record.

import {
  SWITCH_MARGIN,
  dayNumberAt,
  minuteOfDayAt,
  type ActionKind,
  type DecisionExplanation,
  type EventCategory,
  type MemoryKind,
  type SimEvent,
} from '../../sim/index.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * "Day 3 · 14:30" for a tick. Days begin at dawn (06:00), so times after
 * midnight still belong to the same day; they are labelled "late night" so
 * that "Day 6 · 00:48 (late night)" reads as later than "Day 6 · 22:42".
 */
export function formatTick(tick: number): string {
  const m = minuteOfDayAt(tick)
  const late = m < 6 * 60 ? ' (late night)' : ''
  return `Day ${dayNumberAt(tick)} · ${pad(Math.floor(m / 60))}:${pad(m % 60)}${late}`
}

export const DAY_BOUNDARY_HINT = 'Days begin at dawn (06:00). Times after midnight still belong to the same day.'

export const ACTION_LABELS: Record<ActionKind, string> = {
  eat: 'Eat',
  forage: 'Forage berries',
  chop: 'Collect wood',
  deliver: 'Deliver to camp',
  share: 'Share food',
  build: 'Build shelter',
  rest: 'Rest',
  socialize: 'Socialize',
  explore: 'Explore',
  wander: 'Wander',
  idle: 'Idle',
}

export const PHASE_LABELS: Record<string, string> = {
  moveTo: 'walking',
  gather: 'gathering',
  deposit: 'depositing',
  eat: 'eating',
  sleep: 'sleeping',
  linger: 'lingering',
  fetch: 'fetching wood',
  supply: 'supplying the site',
  construct: 'constructing',
  talk: 'talking',
  listen: 'listening',
  give: 'handing over food',
  survey: 'surveying',
}

export const MEMORY_LABELS: Record<MemoryKind, string> = {
  foundResource: 'Gathered here',
  resourceDepleted: 'Emptied a source',
  chat: 'Chatted',
  argument: 'Argued',
  receivedFood: 'Received food',
  gaveFood: 'Gave food',
  builtShelter: 'Finished a shelter',
  sawDeath: 'Saw a death',
  discovered: 'Discovered land',
  childBorn: 'Had a child',
  partnered: 'Found a partner',
}

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  social: 'Social',
  family: 'Family',
  construction: 'Building',
  exploration: 'Exploration',
  survival: 'Survival',
  time: 'Time',
}

/** Text with citizen references kept as data, so the UI can make names clickable. */
export type Segment = string | { citizenId: number; name: string }

export function describeEvent(e: SimEvent, nameOf: (id: number) => string): Segment[] {
  const who = (i: number): Segment => {
    const id = e.citizenIds[i]
    return id === undefined ? 'someone' : { citizenId: id, name: nameOf(id) }
  }
  const d = e.data ?? {}
  switch (e.kind) {
    case 'worldCreated':
      return [`The village was founded with ${e.citizenIds.length} citizens (seed “${String(d.seed ?? '')}”).`]
    case 'dayStarted':
      return [`Day ${String(d.day ?? dayNumberAt(e.tick))} begins.`]
    case 'shelterStarted':
      return ['A shelter site was planned.']
    case 'shelterCompleted':
      return ['A shelter was completed.']
    case 'shelterAbandoned':
      return [`An unfinished shelter was abandoned; ${String(d.woodRefunded ?? 0)} wood returned to the stockpile.`]
    case 'movedIn':
      return [who(0), ' moved into a shelter.']
    case 'chat':
      return [who(0), ' and ', who(1), ' chatted.']
    case 'argument':
      return [who(0), ' and ', who(1), ' argued.']
    case 'sharedFood':
      return [who(0), ` shared ${String(d.units ?? '')} berries with `, who(1), '.']
    case 'friendship':
      return [who(0), ' now counts ', who(1), ' as a friend.']
    case 'rivalry':
      return [who(0), ' now resents ', who(1), '.']
    case 'discovered':
      return [who(0), ` explored ${String(d.tiles ?? '')} new tiles.`]
    case 'starving':
      return [who(0), ' is starving.']
    case 'died': {
      const age = d.age === undefined ? '' : ` at ${String(d.age)}`
      if (d.cause === 'oldAge') return [who(0), ` died of old age${age}.`]
      return [who(0), ` died of ${String(d.cause ?? 'unknown causes')}${age}.`]
    }
    case 'born':
      return [who(0), ' was born to ', who(1), ' and ', who(2), '.']
    case 'cameOfAge':
      return [who(0), ` came of age (${String(d.age ?? '')}) and became a ${String(d.role ?? 'worker')}.`]
    case 'partnered':
      return [who(0), ' and ', who(1), ' became partners.']
    case 'roleChanged':
      return [who(0), ` took up exploring: the village had no explorer.`]
  }
}

export function segmentsToText(segments: Segment[]): string {
  return segments.map((s) => (typeof s === 'string' ? s : s.name)).join('')
}

const score = (x: number) => x.toFixed(2)

/** Sentences explaining the latest recorded decision. Only recorded facts are used. */
export function explainText(x: DecisionExplanation, nameOf: (id: number) => string = (id) => `#${id}`): string[] {
  if (x.decidedTick === null) {
    return ['No decision has been recorded yet (or this world was loaded from an older save).']
  }
  const lines: string[] = []
  if (x.chosen) {
    const next = x.runnerUp ? `; next best was ${ACTION_LABELS[x.runnerUp.kind]} (${score(x.runnerUp.score)})` : ''
    lines.push(`At ${formatTick(x.decidedTick)}, ${ACTION_LABELS[x.chosen.kind]} scored highest (${score(x.chosen.score)})${next}.`)
  } else {
    lines.push(`At ${formatTick(x.decidedTick)}, no action scored above zero.`)
  }
  if (x.recruited) {
    const by = x.recruitedBy ? nameOf(x.recruitedBy.id) : 'someone'
    lines.push(`Right now they are listening to ${by}, who started the conversation.`)
  } else if (x.persisted && x.current) {
    lines.push(
      `They are still doing ${ACTION_LABELS[x.current]} (scored ${score(x.currentScore ?? 0)}): a running task is kept unless an alternative scores at least ${score(SWITCH_MARGIN)} higher.`,
    )
  } else if (x.fellBack && x.current) {
    lines.push(`The top action could not be started at that moment, so they took ${ACTION_LABELS[x.current]} instead.`)
  } else if (!x.current) {
    lines.push('They have no task at the moment and will decide again shortly.')
  }
  if (x.impossible.length > 0) {
    lines.push(`Not possible or not wanted then: ${x.impossible.map((k) => ACTION_LABELS[k]).join(', ')}.`)
  }
  return lines
}
