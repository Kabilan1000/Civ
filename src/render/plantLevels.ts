// Which pre-rendered texture a plant uses (M10c): one per kind × stage ×
// fill level. Pure (no PixiJS) so it can be tested in Node. Depleting,
// regrowing or ageing a plant just swaps its sprite's texture.

import type { PlantStage, ResourceNode } from '../sim/index.ts'

/** Berry spots on a bush (one per berry), tree canopy levels (0 = stump/bare … 4 = full). */
export const BERRY_SPOTS = 6
export const TREE_LEVELS = 4

export interface PlantLevel {
  kind: 'berries' | 'wood'
  stage: PlantStage
  /** Berries: berries shown (0..6). Trees: canopy or wood level (0..4). */
  level: number
}

const TREE_FULL = 8 // a mature tree's wood (TREE_WOOD_MAX)

export function plantLevel(node: ResourceNode): PlantLevel {
  const amount = Math.max(0, node.amount)
  if (node.kind === 'berries') return { kind: 'berries', stage: node.stage, level: node.stage === 'seedling' ? 0 : Math.min(BERRY_SPOTS, amount) }
  if (node.stage === 'seedling') return { kind: 'wood', stage: 'seedling', level: 0 }
  // Young trees hold up to 4 wood, others up to 8: levels count wood against the full-size tree.
  return { kind: 'wood', stage: node.stage, level: Math.min(TREE_LEVELS, Math.ceil((amount / TREE_FULL) * TREE_LEVELS)) }
}

export type LevelKey = string

export function keyOf(l: PlantLevel): LevelKey {
  return `${l.kind === 'berries' ? 'b' : 't'}:${l.stage}:${l.level}`
}

export const levelKey = (node: ResourceNode): LevelKey => keyOf(plantLevel(node))

export function parseKey(key: LevelKey): PlantLevel {
  const [k, stage, level] = key.split(':')
  return { kind: k === 'b' ? 'berries' : 'wood', stage: stage as PlantStage, level: Number(level) }
}

/** Every texture that can be needed (rendered once per display resolution). */
export const ALL_KEYS: readonly LevelKey[] = [
  keyOf({ kind: 'berries', stage: 'seedling', level: 0 }),
  ...(['young', 'mature', 'old'] as const).flatMap((stage) =>
    Array.from({ length: BERRY_SPOTS + 1 }, (_, i) => keyOf({ kind: 'berries', stage, level: i })),
  ),
  keyOf({ kind: 'wood', stage: 'seedling', level: 0 }),
  ...(['young', 'mature', 'old', 'dead'] as const).flatMap((stage) =>
    Array.from({ length: TREE_LEVELS + 1 }, (_, i) => keyOf({ kind: 'wood', stage, level: i })),
  ),
]
