// PixiJS 8 renderer for the world. Reads simulation state, never writes it.
//
// Layers (bottom → top): static map (terrain + resources + fog, baked into a
// single texture), structures, citizens. The static map is redrawn and
// re-baked only when the map object, map.version or the display scale
// changes, so a normal frame draws one textured quad for the whole island.
// Structures rebuild when their summary changes. Citizens never stand in
// fog (they only walk discovered tiles), so fog can sit under them.
// Citizens are one small Container each, repositioned every frame from
// interpolated positions. The Pixi ticker is disabled: the
// SimulationController's single requestAnimationFrame loop calls render().

import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { getVisualPosition, toPoint, type Citizen, type TileMap, type WorldState } from '../sim/index.ts'
import type { FrameRenderer } from '../app/SimulationController.ts'
import { AppLifecycle } from './AppLifecycle.ts'
import { fitWorld } from './layout.ts'
import { COLORS, ROLE_COLORS, TERRAIN_COLORS, TILE_SIZE, shade, tileNoise } from './palette.ts'

interface PixiHandle {
  app: Application
  destroy(): void
}

async function createPixiApp(): Promise<PixiHandle> {
  const app = new Application()
  await app.init({
    width: 1,
    height: 1,
    background: COLORS.background,
    // MSAA doubles frame cost on software-rendered GPUs; the baked map is
    // antialiased at bake time, so only the small citizen shapes forgo it.
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoStart: false, // the SimulationController drives rendering
    sharedTicker: false,
  })
  return {
    app,
    destroy: () => app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true }),
  }
}

export class WorldRenderer implements FrameRenderer {
  private readonly parent: HTMLElement
  private readonly lifecycle = new AppLifecycle(createPixiApp)
  private resizeObserver: ResizeObserver | null = null

  private readonly world = new Container()
  /** Off-stage source for the baked map texture. */
  private readonly staticLayer = new Container()
  private readonly terrain = new Graphics()
  private readonly resources = new Graphics()
  private readonly fog = new Graphics()
  private readonly mapSprite = new Sprite()
  private mapTexture: Texture | null = null
  private bakedScale = 0
  private readonly structures = new Container()
  private readonly citizens = new Container()
  private readonly citizenViews = new Map<number, Container>()
  private readonly fireGlows: Graphics[] = []

  private mapRef: TileMap | null = null
  private mapVersion = -1
  private structuresKey = ''

  constructor(parent: HTMLElement) {
    this.parent = parent
    this.staticLayer.addChild(this.terrain, this.resources, this.fog)
    this.world.addChild(this.mapSprite, this.structures, this.citizens)
  }

  /** Resolves true when ready, false if destroyed before initialisation finished. */
  async init(): Promise<boolean> {
    const handle = await this.lifecycle.start()
    if (!handle) return false
    const { app } = handle
    app.canvas.classList.add('map-canvas')
    this.parent.appendChild(app.canvas)
    app.stage.addChild(this.world)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.parent)
    this.resize()
    return true
  }

  get isDestroyed(): boolean {
    return this.lifecycle.isDisposed
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.citizenViews.clear()
    this.fireGlows.length = 0
    this.mapSprite.texture = Texture.EMPTY
    this.mapTexture?.destroy(true)
    this.mapTexture = null
    this.staticLayer.destroy({ children: true }) // not on the stage
    this.lifecycle.dispose() // destroys the stage tree and the Pixi app
  }

  private get app(): Application | null {
    return this.lifecycle.current?.app ?? null
  }

  private resize(): void {
    const app = this.app
    if (!app || !this.mapRef) {
      app?.renderer.resize(Math.max(1, this.parent.clientWidth), Math.max(1, this.parent.clientHeight))
      return
    }
    const w = Math.max(1, this.parent.clientWidth)
    const h = Math.max(1, this.parent.clientHeight)
    app.renderer.resize(w, h)
    const fit = fitWorld(w, h, this.mapRef.width * TILE_SIZE, this.mapRef.height * TILE_SIZE)
    this.world.scale.set(fit.scale)
    this.world.position.set(fit.x, fit.y)
    if (fit.scale !== this.bakedScale) this.bakeMap()
  }

  /** Render terrain + resources + fog into one texture at the current display resolution. */
  private bakeMap(): void {
    const app = this.app
    if (!app || !this.mapRef) return
    const w = this.mapRef.width * TILE_SIZE
    const h = this.mapRef.height * TILE_SIZE
    this.bakedScale = this.world.scale.x
    const previous = this.mapTexture
    this.mapTexture = app.renderer.generateTexture({
      target: this.staticLayer,
      frame: new Rectangle(0, 0, w, h),
      resolution: Math.max(0.25, this.bakedScale * app.renderer.resolution),
      antialias: true,
    })
    this.mapSprite.texture = this.mapTexture
    previous?.destroy(true)
  }

  render(state: WorldState, alpha: number): void {
    const app = this.app
    if (!app) return

    if (state.map !== this.mapRef || state.map.version !== this.mapVersion) {
      this.mapRef = state.map
      this.mapVersion = state.map.version
      this.drawTerrain(state.map)
      this.drawResources(state.map)
      this.drawFog(state.map)
      this.bakedScale = 0 // force a re-bake
      this.resize() // re-fits to the (possibly new) map size, then bakes
    }

    const key = state.structures.map((s) => `${s.id}:${s.kind}:${s.tile}:${s.complete}`).join('|')
    if (key !== this.structuresKey) {
      this.structuresKey = key
      this.drawStructures(state)
    }

    this.updateCitizens(state, alpha)
    this.animateFire()
    app.render()
  }

  // ── Static layers ─────────────────────────────────────────────────────────

  private drawTerrain(map: TileMap): void {
    const g = this.terrain.clear()
    for (let i = 0; i < map.terrain.length; i++) {
      const { x, y } = toPoint(i, map.width)
      const terrain = map.terrain[i]!
      const variation = terrain === 'water' ? 0.04 : 0.07
      g.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill(
        shade(TERRAIN_COLORS[terrain], 1 + tileNoise(i) * variation),
      )
    }
  }

  private drawResources(map: TileMap): void {
    const g = this.resources.clear()
    const half = TILE_SIZE / 2
    map.resources.forEach((r, i) => {
      if (!r || r.amount <= 0) return
      const { x, y } = toPoint(i, map.width)
      const cx = x * TILE_SIZE + half
      const cy = y * TILE_SIZE + half
      if (r.kind === 'wood') {
        g.rect(cx - 1.5, cy + 2, 3, 7).fill(COLORS.trunk)
        g.circle(cx, cy - 1, 7.5).fill(COLORS.canopy)
        g.circle(cx - 2, cy - 3, 3.5).fill(COLORS.canopyLight)
      } else {
        g.circle(cx, cy + 1, 6.5).fill(COLORS.bush)
        for (const [dx, dy] of [[-2.5, -0.5], [2.5, 0.5], [0, 3]] as const) {
          g.circle(cx + dx, cy + dy, 1.7).fill(COLORS.berry)
        }
      }
    })
  }

  private drawFog(map: TileMap): void {
    const g = this.fog.clear()
    map.discovered.forEach((d, i) => {
      if (d === 1) return
      const { x, y } = toPoint(i, map.width)
      g.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill({ color: COLORS.fog, alpha: COLORS.fogAlpha })
    })
  }

  private drawStructures(state: WorldState): void {
    for (const child of this.structures.removeChildren()) child.destroy({ children: true })
    this.fireGlows.length = 0
    for (const s of state.structures) {
      const { x, y } = toPoint(s.tile, state.map.width)
      const view = new Container()
      view.position.set(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2)
      if (s.kind === 'campfire') {
        const glow = new Graphics().circle(0, 0, TILE_SIZE * 1.6).fill({ color: COLORS.glow, alpha: 0.14 })
        const logs = new Graphics()
          .rect(-8, 2, 16, 4).fill(COLORS.log)
          .rect(-2, -4, 4, 12).fill(shade(COLORS.log, 0.85))
        const flame = new Graphics()
          .circle(0, -1, 5.5).fill(COLORS.flame)
          .circle(0, 0, 2.8).fill(COLORS.flameCore)
        view.addChild(glow, logs, flame)
        this.fireGlows.push(glow)
      }
      this.structures.addChild(view)
    }
  }

  private animateFire(): void {
    if (this.fireGlows.length === 0) return
    const t = performance.now() / 1000 // visual only; never fed into the simulation
    const s = 1 + 0.06 * Math.sin(t * 7) + 0.03 * Math.sin(t * 13)
    for (const glow of this.fireGlows) glow.scale.set(s)
  }

  // ── Citizens ──────────────────────────────────────────────────────────────

  private createCitizenView(c: Citizen): Container {
    const view = new Container()
    const shadow = new Graphics().ellipse(0, 6, 6, 2.5).fill({ color: COLORS.shadow, alpha: 0.3 })
    const body = new Graphics()
      .circle(0, 0, 6)
      .fill(ROLE_COLORS[c.role])
      .stroke({ width: 1.5, color: COLORS.outline, alpha: 0.9 })
    view.addChild(shadow, body)
    view.label = `citizen-${c.id}`
    return view
  }

  private updateCitizens(state: WorldState, alpha: number): void {
    const seen = new Set<number>()
    for (const c of state.citizens) {
      if (!c.alive) continue
      seen.add(c.id)
      let view = this.citizenViews.get(c.id)
      if (!view) {
        view = this.createCitizenView(c)
        this.citizenViews.set(c.id, view)
        this.citizens.addChild(view)
      }
      const p = getVisualPosition(state, c, alpha)
      view.position.set(p.x * TILE_SIZE + TILE_SIZE / 2, p.y * TILE_SIZE + TILE_SIZE / 2)
    }
    for (const [id, view] of this.citizenViews) {
      if (seen.has(id)) continue
      view.destroy({ children: true })
      this.citizenViews.delete(id)
    }
  }
}
