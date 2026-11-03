// Behaviour fingerprint: an id-independent projection of a world, used to
// prove that schema changes which renumber ids (M10b's separate event-id
// counter) or add fields leave simulated behaviour unchanged.
//
// It reads only fields that exist in every schema since v5, and replaces
// structure ids (which shift when events stop sharing the id counter) by the
// structure's position in `state.structures`. Citizen ids are allocated
// before any event, so they are stable and kept.
//
// The baseline in fixtures/behaviour-v5.json was recorded by
// scripts/capture-behaviour.ts from the simulation BEFORE M10b.
import { createHash } from 'node:crypto'

type Loose = any

export function behaviourProjection(state: Loose): unknown {
  const structIndex = new Map<number, number>(state.structures.map((s: Loose, i: number) => [s.id, i]))
  const sid = (id: number | null | undefined) => (id === null || id === undefined ? null : structIndex.has(id) ? `s${structIndex.get(id)}` : id)
  return {
    tick: state.tick,
    rng: state.rng,
    stockpile: state.stockpile,
    ledger: {
      foodGathered: state.ledger.foodGathered,
      woodGathered: state.ledger.woodGathered,
      foodRegrown: state.ledger.foodRegrown,
      woodRegrown: state.ledger.woodRegrown,
      foodEaten: state.ledger.foodEaten,
      foodLost: state.ledger.foodLost,
      woodLost: state.ledger.woodLost,
    },
    map: {
      version: state.map.version,
      discovered: state.map.discovered.join(''),
      resources: state.map.resources.map((r: Loose) => (r ? [r.kind, r.amount, r.max] : 0)),
    },
    structures: state.structures.map((s: Loose) => [s.kind, s.tile, s.stage, s.buildProgress, s.buildCost, s.woodDelivered, s.woodRequired, s.lastWorkTick, s.residentIds]),
    citizens: state.citizens.map((c: Loose) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      needs: c.needs,
      pos: c.pos,
      path: c.path,
      pathIndex: c.pathIndex,
      moveTicksLeft: c.moveTicksLeft,
      task: c.task && { ...c.task, targetId: c.task.kind === 'build' || c.task.kind === 'deliver' ? sid(c.task.targetId) : c.task.targetId },
      nextDecisionTick: c.nextDecisionTick,
      carrying: c.carrying,
      home: sid(c.homeId),
      relationships: c.relationships,
      memories: c.memories.map((m: Loose) => [m.tick, m.kind, m.subjectId ?? null, m.tile ?? null, m.valence]),
      lastScores: c.lastScores,
      lastDecisionTick: c.lastDecisionTick,
      lastSocialTick: c.lastSocialTick,
      alive: c.alive,
      diedTick: c.diedTick,
      deathCause: c.deathCause,
    })),
    // v5 sample fields only, in their v5 order (later schemas add optional fields).
    history: state.history.map((h: Loose) => ({
      tick: h.tick, population: h.population, food: h.food, wood: h.wood, housed: h.housed, capacity: h.capacity,
      discovered: h.discovered, satiety: h.satiety, energy: h.energy, health: h.health, social: h.social,
    })),
    events: state.events.map((e: Loose) => {
      const data = e.data ? { ...e.data } : undefined
      if (data && typeof data.structureId === 'number') data.structureId = sid(data.structureId)
      return [e.tick, e.kind, e.citizenIds, data ?? null]
    }),
  }
}

export function behaviourHash(state: Loose): string {
  return createHash('sha256').update(JSON.stringify(behaviourProjection(state))).digest('hex')
}
