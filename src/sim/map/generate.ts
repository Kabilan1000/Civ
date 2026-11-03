// Deterministic island generation.
//
// Pipeline per attempt (attempt k uses its own RNG seeded "<seed>:map:<k>",
// independent of WorldState.rng, so map output never depends on how many
// random numbers citizen creation draws):
//   1. Elevation + moisture value noise; elevation falls off towards the edge.
//   2. Terrain by elevation rank: lowest → water, then sand; highest → rock;
//      the rest is forest (wettest share) or grass. The map border is water.
//   3. Campfire: the grass tile closest to the centre, inside the largest
//      connected land region, with enough reachable spawn tiles around it.
//      If the region is too small or no tile qualifies → next attempt.
//   4. Resources: berries on some grass, trees on most forest.
//   5. Repair: guarantee reachable berries and trees inside the starting
//      discovery radius (plant on grass / convert grass to forest).
// If every attempt fails, a fallback carves a grass clearing around the
// centre of a freshly generated map, which always validates.

import {
  BERRY_CHANCE,
  BERRY_MAX,
  ELEVATION_OCTAVES,
  FOREST_FRACTION_OF_LAND,
  ISLAND_FALLOFF,
  MAPGEN_MAX_ATTEMPTS,
  MIN_REGION_FRACTION,
  MIN_START_BERRY_TILES,
  MIN_START_TREE_TILES,
  MOISTURE_OCTAVES,
  ROCK_FRACTION,
  SAND_FRACTION,
  SPAWN_RADIUS,
  START_DISCOVERY_RADIUS,
  TREE_CHANCE,
  TREE_WOOD_MAX,
  WATER_FRACTION,
} from '../constants.ts'
import { isPassable, manhattan, toIndex, toPoint } from '../grid.ts'
import { labelRegions, reachableMask } from '../path/flood.ts'
import { chance, seedRng, shuffle } from '../rng.ts'
import type { ResourceKind, RngState, Terrain, TileIndex, TileMap } from '../types.ts'
import { withinRadius } from './discovery.ts'
import { valueNoiseField } from './noise.ts'

export interface GenerateMapOptions {
  /** Passable tiles needed around the campfire for spawning. */
  spawnTiles: number
  maxAttempts?: number
}

export interface GeneratedMap {
  map: TileMap
  campTile: TileIndex
  /** Index of the attempt that succeeded, or -1 for the fallback. */
  attempt: number
  /** Resource tiles added by the start-area repair step. */
  repairs: number
}

export function generateMap(
  seed: string,
  width: number,
  height: number,
  { spawnTiles, maxAttempts = MAPGEN_MAX_ATTEMPTS }: GenerateMapOptions,
): GeneratedMap {
  const minRegion = Math.ceil(width * height * MIN_REGION_FRACTION)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = seedRng(`${seed}:map:${attempt}`)
    const map = generateTerrain(rng, width, height)
    const campTile = chooseCampTile(map, spawnTiles, minRegion)
    if (campTile === null) continue
    return finish(map, campTile, rng, attempt)
  }

  const rng = seedRng(`${seed}:map:fallback`)
  const map = generateTerrain(rng, width, height)
  carveClearing(map)
  const campTile = chooseCampTile(map, spawnTiles, 0)
  if (campTile === null) {
    throw new Error(`Cannot generate a ${width}x${height} map with room for ${spawnTiles} citizens`)
  }
  return finish(map, campTile, rng, -1)
}

function finish(map: TileMap, campTile: TileIndex, rng: RngState, attempt: number): GeneratedMap {
  placeResources(map, rng)
  const repairs = ensureStartResources(map, campTile, rng)
  map.resources[campTile] = null
  return { map, campTile, attempt, repairs }
}

// ── Terrain ─────────────────────────────────────────────────────────────────

export function generateTerrain(rng: RngState, width: number, height: number): TileMap {
  const size = width * height
  const elevation = valueNoiseField(rng, width, height, ELEVATION_OCTAVES)
  const moisture = valueNoiseField(rng, width, height, MOISTURE_OCTAVES)

  const halfW = (width - 1) / 2
  const halfH = (height - 1) / 2
  for (let i = 0; i < size; i++) {
    const { x, y } = toPoint(i, width)
    const nx = (x - halfW) / halfW
    const ny = (y - halfH) / halfH
    elevation[i]! -= ISLAND_FALLOFF * (nx * nx + ny * ny)
  }

  // Rank tiles by elevation (ties by index) and assign terrain by share.
  const byElevation = Array.from({ length: size }, (_, i) => i).sort(
    (a, b) => elevation[a]! - elevation[b]! || a - b,
  )
  const terrain = new Array<Terrain>(size)
  const waterEnd = Math.round(size * WATER_FRACTION)
  const sandEnd = waterEnd + Math.round(size * SAND_FRACTION)
  const rockStart = size - Math.round(size * ROCK_FRACTION)
  const land: TileIndex[] = []
  byElevation.forEach((tile, rank) => {
    if (rank < waterEnd) terrain[tile] = 'water'
    else if (rank < sandEnd) terrain[tile] = 'sand'
    else if (rank >= rockStart) terrain[tile] = 'rock'
    else land.push(tile)
  })

  land.sort((a, b) => moisture[b]! - moisture[a]! || a - b)
  const forestCount = Math.round(land.length * FOREST_FRACTION_OF_LAND)
  land.forEach((tile, rank) => {
    terrain[tile] = rank < forestCount ? 'forest' : 'grass'
  })

  const map: TileMap = {
    width,
    height,
    terrain,
    resources: new Array<null>(size).fill(null),
    discovered: new Array<0 | 1>(size).fill(0),
    version: 0,
  }
  for (let i = 0; i < size; i++) if (isBorder(map, i)) terrain[i] = 'water'
  return map
}

function isBorder(map: TileMap, tile: TileIndex): boolean {
  const { x, y } = toPoint(tile, map.width)
  return x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1
}

/** Fallback repair: turn impassable tiles within a circle around the centre into grass (border stays water). */
function carveClearing(map: TileMap): void {
  const center = toIndex(Math.floor(map.width / 2), Math.floor(map.height / 2), map.width)
  const radius = Math.max(SPAWN_RADIUS + 1, Math.floor(Math.min(map.width, map.height) / 2) - 1)
  for (let i = 0; i < map.terrain.length; i++) {
    if (isBorder(map, i) || isPassable(map, i)) continue
    if (withinRadius(map, center, i, radius)) map.terrain[i] = 'grass'
  }
}

// ── Campfire ────────────────────────────────────────────────────────────────

/** Passable tiles within SPAWN_RADIUS (Manhattan) of `camp`, excluding it, reachable from it. */
export function spawnCandidates(map: TileMap, camp: TileIndex, reachable: Uint8Array): TileIndex[] {
  const c = toPoint(camp, map.width)
  const result: TileIndex[] = []
  for (let i = 0; i < map.terrain.length; i++) {
    if (i !== camp && reachable[i] === 1 && manhattan(toPoint(i, map.width), c) <= SPAWN_RADIUS) result.push(i)
  }
  return result
}

function chooseCampTile(map: TileMap, spawnTiles: number, minRegion: number): TileIndex | null {
  const { labels, sizes } = labelRegions(map)
  let largest = 0
  for (let l = 1; l < sizes.length; l++) if (sizes[l]! > sizes[largest]!) largest = l
  if (largest === 0 || sizes[largest]! < minRegion) return null

  const center = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) }
  const candidates: TileIndex[] = []
  for (let i = 0; i < map.terrain.length; i++) {
    if (labels[i] === largest && map.terrain[i] === 'grass') candidates.push(i)
  }
  candidates.sort((a, b) => manhattan(toPoint(a, map.width), center) - manhattan(toPoint(b, map.width), center) || a - b)

  const reachable = reachableMask(map, candidates[0] ?? 0)
  for (const tile of candidates) {
    if (spawnCandidates(map, tile, reachable).length >= spawnTiles) return tile
  }
  return null
}

// ── Resources ───────────────────────────────────────────────────────────────

function node(kind: ResourceKind) {
  const max = kind === 'berries' ? BERRY_MAX : TREE_WOOD_MAX
  return { kind, amount: max, max }
}

/** Berries on some grass, trees on most forest; one RNG draw per grass/forest tile in index order. */
export function placeResources(map: TileMap, rng: RngState): void {
  for (let i = 0; i < map.terrain.length; i++) {
    const t = map.terrain[i]
    if (t === 'grass' && chance(rng, BERRY_CHANCE)) map.resources[i] = node('berries')
    else if (t === 'forest' && chance(rng, TREE_CHANCE)) map.resources[i] = node('wood')
  }
}

export interface StartArea {
  reachableTiles: number
  /** Reachable tiles with each resource inside the starting discovery radius. */
  berryTiles: TileIndex[]
  treeTiles: TileIndex[]
}

export function analyzeStartArea(map: TileMap, campTile: TileIndex): StartArea {
  const reachable = reachableMask(map, campTile)
  const berryTiles: TileIndex[] = []
  const treeTiles: TileIndex[] = []
  let reachableTiles = 0
  for (let i = 0; i < map.terrain.length; i++) {
    if (reachable[i] !== 1) continue
    reachableTiles++
    if (i === campTile || !withinRadius(map, campTile, i, START_DISCOVERY_RADIUS)) continue
    const kind = map.resources[i]?.kind
    if (kind === 'berries') berryTiles.push(i)
    else if (kind === 'wood') treeTiles.push(i)
  }
  return { reachableTiles, berryTiles, treeTiles }
}

/** Plant missing start resources on reachable tiles near camp. Returns how many were added. */
function ensureStartResources(map: TileMap, campTile: TileIndex, rng: RngState): number {
  const reachable = reachableMask(map, campTile)
  const { berryTiles, treeTiles } = analyzeStartArea(map, campTile)
  const free = (terrain: Terrain) =>
    shuffle(
      rng,
      map.terrain
        .map((_terrain, i) => i)
        .filter(
          (i) =>
            i !== campTile &&
            reachable[i] === 1 &&
            map.terrain[i] === terrain &&
            map.resources[i] === null &&
            withinRadius(map, campTile, i, START_DISCOVERY_RADIUS),
        ),
    )

  let repairs = 0
  for (const tile of free('grass').slice(0, Math.max(0, MIN_START_BERRY_TILES - berryTiles.length))) {
    map.resources[tile] = node('berries')
    repairs++
  }
  let missingTrees = Math.max(0, MIN_START_TREE_TILES - treeTiles.length)
  for (const tile of [...free('forest'), ...free('grass')]) {
    if (missingTrees === 0) break
    map.terrain[tile] = 'forest'
    map.resources[tile] = node('wood')
    missingTrees--
    repairs++
  }
  return repairs
}
