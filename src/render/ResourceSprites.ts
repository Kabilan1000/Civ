// Berry bushes and trees as one small sprite per node, sharing a handful of
// pre-rendered textures — one per depletion level. Depleting or regrowing a
// node just swaps its sprite's texture: no re-baking, and drawing all nodes
// is one batched draw call of tiny quads (cheap fill even on software GPUs).

import { Container, Graphics, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js'
import { toPoint, type ResourceNode, type TileMap } from '../sim/index.ts'
import { COLORS, TILE_SIZE, shade } from './palette.ts'

/** Berry positions on a bush; one shows per sixth of its stock. */
const BERRY_SPOTS: readonly (readonly [number, number])[] = [
  [-2.5, -0.5], [2.5, 0.5], [0, 3], [-1, -3], [3, -2.5], [-3.5, 2.5],
]
const BERRY_LEVELS = BERRY_SPOTS.length // 0 = bare bush, 6 = full
const TREE_LEVELS = 4 // 0 = stump, 4 = full canopy

/** Sprites on undiscovered tiles are dimmed like the fog over them. */
const FOG_VISIBILITY = 1 - COLORS.fogAlpha

type LevelKey = `b${number}` | `t${number}`

export function levelKey(node: ResourceNode): LevelKey {
  const fullness = node.max > 0 ? Math.max(0, node.amount) / node.max : 0
  return node.kind === 'berries' ? `b${Math.ceil(fullness * BERRY_LEVELS)}` : `t${Math.ceil(fullness * TREE_LEVELS)}`
}

function drawLevel(g: Graphics, key: LevelKey): void {
  const c = TILE_SIZE / 2
  const level = Number(key.slice(1))
  if (key[0] === 'b') {
    g.circle(c, c + 1, 6.5).fill(level > 0 ? COLORS.bush : COLORS.bushBare)
    for (let k = 0; k < level; k++) {
      const [dx, dy] = BERRY_SPOTS[k]!
      g.circle(c + dx, c + dy, 1.6).fill(COLORS.berry)
    }
  } else if (level === 0) {
    g.circle(c, c + 3, 3.2).fill(COLORS.trunk)
    g.circle(c, c + 3, 1.6).fill(shade(COLORS.trunk, 1.35))
  } else {
    const r = 4.5 + (3 * level) / TREE_LEVELS
    g.rect(c - 1.5, c + 2, 3, 7).fill(COLORS.trunk)
    g.circle(c, c - 1, r).fill(COLORS.canopy)
    g.circle(c - r * 0.27, c - 1 - r * 0.27, r * 0.47).fill(COLORS.canopyLight)
  }
}

const ALL_KEYS: LevelKey[] = [
  ...Array.from({ length: BERRY_LEVELS + 1 }, (_, i) => `b${i}` as LevelKey),
  ...Array.from({ length: TREE_LEVELS + 1 }, (_, i) => `t${i}` as LevelKey),
]

interface NodeSprite {
  sprite: Sprite
  key: LevelKey
}

export class ResourceSprites {
  readonly container = new Container()
  private readonly textures = new Map<LevelKey, Texture>()
  private readonly sprites = new Map<number, NodeSprite>()

  /** (Re)render the shared level textures at a display resolution. */
  buildTextures(renderer: Renderer, resolution: number): void {
    const old = [...this.textures.values()]
    for (const key of ALL_KEYS) {
      const g = new Graphics()
      drawLevel(g, key)
      this.textures.set(
        key,
        renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, TILE_SIZE, TILE_SIZE), resolution, antialias: true }),
      )
      g.destroy()
    }
    for (const { sprite, key } of this.sprites.values()) sprite.texture = this.textures.get(key)!
    for (const t of old) t.destroy(true)
  }

  /** Match sprites to the map: create, retexture, dim under fog, remove. */
  sync(map: TileMap): void {
    if (this.textures.size === 0) return
    map.resources.forEach((node, i) => {
      let entry = this.sprites.get(i)
      if (!node) {
        if (entry) {
          entry.sprite.destroy()
          this.sprites.delete(i)
        }
        return
      }
      const key = levelKey(node)
      if (!entry) {
        const { x, y } = toPoint(i, map.width)
        const sprite = new Sprite(this.textures.get(key)!)
        sprite.position.set(x * TILE_SIZE, y * TILE_SIZE)
        this.container.addChild(sprite)
        entry = { sprite, key }
        this.sprites.set(i, entry)
      } else if (entry.key !== key) {
        entry.key = key
        entry.sprite.texture = this.textures.get(key)!
      }
      entry.sprite.alpha = map.discovered[i] === 1 ? 1 : FOG_VISIBILITY
    })
  }

  /** Drop all sprites (e.g. when a different world is loaded). */
  clear(): void {
    for (const { sprite } of this.sprites.values()) sprite.destroy()
    this.sprites.clear()
  }

  destroy(): void {
    this.clear()
    for (const t of this.textures.values()) t.destroy(true)
    this.textures.clear()
  }
}
