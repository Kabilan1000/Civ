// Relationships (directional records, see types.ts Relationship).
//
// Records are created lazily on the first real interaction, keyed by the
// other citizen's id (one record per other citizen — object keys make
// duplicates impossible). Values are clamped: familiarity 0..100, affinity
// −100..100. Familiarity changes are always applied to both sides equally.

import { FRIENDSHIP_AFFINITY, RIVALRY_AFFINITY } from '../constants.ts'
import { pushEvent } from '../events.ts'
import type { Citizen, Relationship, WorldState } from '../types.ts'

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export function getRelationship(c: Citizen, otherId: number): Relationship | undefined {
  return c.relationships[String(otherId)]
}

export function affinityOf(c: Citizen, otherId: number): number {
  return getRelationship(c, otherId)?.affinity ?? 0
}

export function familiarityOf(c: Citizen, otherId: number): number {
  return getRelationship(c, otherId)?.familiarity ?? 0
}

function ensure(c: Citizen, otherId: number): Relationship {
  if (otherId === c.id) throw new Error('A citizen cannot have a relationship with themselves')
  const key = String(otherId)
  return (c.relationships[key] ??= { affinity: 0, familiarity: 0, lastTick: 0 })
}

/**
 * Record one completed interaction between a and b. `familiarity` applies to
 * both; `affinityA` is a's change towards b, `affinityB` b's towards a.
 * Emits 'friendship' / 'rivalry' events when a's or b's affinity crosses a
 * milestone.
 */
export function interact(
  state: WorldState,
  a: Citizen,
  b: Citizen,
  familiarity: number,
  affinityA: number,
  affinityB: number,
): void {
  const ra = ensure(a, b.id)
  const rb = ensure(b, a.id)
  ra.familiarity = clamp(ra.familiarity + familiarity, 0, 100)
  rb.familiarity = clamp(rb.familiarity + familiarity, 0, 100)
  ra.lastTick = state.tick
  rb.lastTick = state.tick
  for (const [self, other, rel, delta] of [[a, b, ra, affinityA], [b, a, rb, affinityB]] as const) {
    const before = rel.affinity
    rel.affinity = clamp(before + delta, -100, 100)
    if (before < FRIENDSHIP_AFFINITY && rel.affinity >= FRIENDSHIP_AFFINITY) {
      pushEvent(state, 'friendship', [self.id, other.id])
    } else if (before > RIVALRY_AFFINITY && rel.affinity <= RIVALRY_AFFINITY) {
      pushEvent(state, 'rivalry', [self.id, other.id])
    }
  }
}
