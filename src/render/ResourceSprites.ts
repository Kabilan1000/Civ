// Berry bushes and trees as one small sprite per node, sharing a handful of
// pre-rendered textures — one per stage and fill level (render/plantLevels.ts). Depleting or regrowing a
// node just swaps its sprite's texture: no re-baking, and drawing all nodes
// is one batched draw call of tiny quads (cheap fill even on software GPUs).

import { Container, Graphics, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js'
import { toPoint, type TileMap } from '../sim/index.ts'
import { ALL_KEYS, levelKey, parseKey, TREE_LEVELS, type LevelKey } from './plantLevels.ts'
import { COLORS, TILE_SIZE, shade } from './palette.ts'

/** Berry positions on a bush; one shows per berry it holds. */
const BERRY_SPOT_XY: readonly (readonly [number, number])[] = [
  [-2.5, -0.5], [2.5, 0.5], [0, 3], [-1, -3], [3, -2.5], [-3.5, 2.5],
]

/** Sprites on undiscovered tiles are dimmed like the fog over them. */
const FOG_VISIBILITY = 1 - COLORS.fogAlpha

/**
 * Plants by life stage (M10c): sprouts are tiny, young plants small, old ones
 * faded, and deadwood a grey snag that thins as it rots or is chopped.
 */
function drawLevel(g: Graphics, key: LevelKey): void {
  const c = TILE_SIZE / 2
  const { kind, stage, level } = parseKey(key)
  if (stage === 'seedling') {
    // A sprout: a short stem with two leaves (a sapling's are darker).
    const leaf = kind === 'berries' ? COLORS.sprout : COLORS.canopyLight
    g.rect(c - 0.6, c + 1, 1.2, 4).fill(COLORS.trunk)
    g.ellipse(c - 2, c + 1, 2.2, 1.3).fill(leaf)
    g.ellipse(c + 2, c, 2.2, 1.3).fill(leaf)
    return
  }
  if (kind === 'berries') {
    const r = stage === 'young' ? 4.5 : 6.5
    const body = stage === 'old' ? COLORS.bushOld : level > 0 ? COLORS.bush : COLORS.bushBare
    g.circle(c, c + 1, r).fill(body)
    const k = r / 6.5
    for (let i = 0; i < level; i++) {
      const [dx, dy] = BERRY_SPOT_XY[i]!
      g.circle(c + dx * k, c + dy * k, 1.6).fill(stage === 'old' ? COLORS.berryOld : COLORS.berry)
    }
    return
  }
  if (stage === 'dead') {
    // Deadwood: a bare grey snag; thinner and shorter as its wood goes.
    if (level === 0) {
      g.circle(c, c + 3, 3).fill(COLORS.snag)
      return
    }
    const h = 4 + 2 * level
    g.rect(c - 1.5, c + 8 - h, 3, h).fill(COLORS.snag)
    g.moveTo(c, c + 8 - h * 0.6).lineTo(c - 4, c + 8 - h).stroke({ width: 1.4, color: COLORS.snag })
    g.moveTo(c, c + 8 - h * 0.4).lineTo(c + 4, c + 8 - h * 0.85).stroke({ width: 1.4, color: COLORS.snag })
    return
  }
  if (level === 0) {
    g.circle(c, c + 3, 3.2).fill(COLORS.trunk)
    g.circle(c, c + 3, 1.6).fill(shade(COLORS.trunk, 1.35))
    return
  }
  const scale = stage === 'young' ? 0.7 : 1
  const r = (4.5 + (3 * level) / TREE_LEVELS) * scale
  const canopy = stage === 'old' ? COLORS.canopyOld : COLORS.canopy
  const light = stage === 'old' ? COLORS.canopyOldLight : COLORS.canopyLight
  g.rect(c - 1.5 * scale, c + 2, 3 * scale, 7 * scale).fill(COLORS.trunk)
  g.circle(c, c - 1, r).fill(canopy)
  g.circle(c - r * 0.27, c - 1 - r * 0.27, r * 0.47).fill(light)
}

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
