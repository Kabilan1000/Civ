// Build: help finish the village's open shelter site. One task does one step:
//   fetch      (site needs wood, hands free) walk to camp, take what the site
//              still needs (after wood already in transit), then carry it on
//   supply     (carrying wood) walk next to the site and hand it over
//   construct  (all wood delivered) walk next to the site and add labour
// Never assigned for an unreachable site, a full worker roster
// (MAX_SITE_WORKERS) or when nothing can be done, so nobody gets stuck.

import { ROLE_WEIGHTS } from '../../constants.ts'
import { siteHasRoom, woodStillNeeded } from '../../structures.ts'
import type { TileIndex } from '../../types.ts'
import { clamp01, distanceFactor } from '../curves.ts'
import type { DecisionContext } from '../context.ts'
import { beginTask } from '../travel.ts'

const BUILD_BASE = 0.55
const NIGHT_FACTOR = 0.5

export type BuildStep = 'fetch' | 'supply' | 'construct'

export function planBuildStep(ctx: DecisionContext): { step: BuildStep; tile: TileIndex; steps: number } | null {
  const { state, citizen: c, site, siteWorkTile } = ctx
  if (!site || !siteWorkTile || !siteHasRoom(state, site, c)) return null
  const carry = c.carrying
  if (site.stage === 'underConstruction') return { step: 'construct', ...siteWorkTile }
  if (site.stage !== 'planned') return null
  if (carry?.kind === 'wood') return { step: 'supply', ...siteWorkTile }
  if (carry) return null // hands full of berries: deliver those first
  if (woodStillNeeded(state, site) <= 0 || state.stockpile.wood <= 0) return null
  if (ctx.campTile === null || ctx.campSteps < 0) return null
  return { step: 'fetch', tile: ctx.campTile, steps: ctx.campSteps }
}

export function scoreBuild(ctx: DecisionContext): number {
  const plan = planBuildStep(ctx)
  if (!plan) return 0
  const c = ctx.citizen
  const role = ROLE_WEIGHTS[c.role].build ?? 1
  const diligence = 0.8 + 0.4 * c.personality.diligence
  const night = ctx.night ? NIGHT_FACTOR : 1
  return clamp01(BUILD_BASE * role * diligence * distanceFactor(plan.steps) * night)
}

export function startBuild(ctx: DecisionContext): boolean {
  const plan = planBuildStep(ctx)
  if (!plan || !ctx.site) return false
  return beginTask(ctx.state, ctx.citizen, 'build', plan.tile, ctx.site.id)
}
