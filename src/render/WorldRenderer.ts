// PixiJS 8 renderer for the world. Reads simulation state, never writes it.
//
// Layers (bottom → top):
//   map         terrain + fog Graphics baked into ONE texture (BakedLayer);
//               re-baked only when terrain/`discovered` or the display
//               scale change
//   resources   one small sprite per bush/tree with shared per-depletion-
//               level textures (ResourceSprites); synced when map.version
//               changes — swapping a texture, never re-baking
//   structures  rebuilt when their summary changes
//   citizens    one small Container each, repositioned every frame
// Fill cost per frame ≈ one map-sized quad plus tiny sprites, which keeps
// software-rendered GPUs fast. Resources under fog are dimmed via alpha.
// The Pixi ticker is disabled: the SimulationController's single
// requestAnimationFrame loop calls render().

import { Application, Container, Graphics } from 'pixi.js'
import { getVisualPosition, toPoint, type Citizen, type Terrain, type TileMap, type WorldState } from '../sim/index.ts'
import type { FrameRenderer } from '../app/SimulationController.ts'
import { AppLifecycle } from './AppLifecycle.ts'
import { BakedLayer } from './BakedLayer.ts'
import { ResourceSprites } from './ResourceSprites.ts'
import { fitWorld } from './layout.ts'
import { COLORS, ROLE_COLORS, TERRAIN_COLORS, TILE_SIZE, shade, tileNoise } from './palette.ts'

interface CitizenView {
  root: Container
  body: Graphics
  cargo: Graphics
  cargoKind: 'berries' | 'wood' | null
  asleep: boolean
}

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

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
  private readonly mapLayer = new BakedLayer()
  private readonly terrain = new Graphics()
  private readonly fog = new Graphics()
  private readonly resources = new ResourceSprites()
  private bakedScale = 0
  private readonly structures = new Container()
  private readonly citizens = new Container()
  private readonly citizenViews = new Map<number, CitizenView>()
  private readonly fireGlows: Graphics[] = []

  private mapRef: TileMap | null = null
  private mapVersion = -1
  private terrainCopy: Terrain[] = []
  private discoveredCopy: (0 | 1)[] = []
  private structuresKey = ''

  constructor(parent: HTMLElement) {
    this.parent = parent
    this.mapLayer.source.addChild(this.terrain, this.fog)
    this.world.addChild(this.mapLayer.sprite, this.resources.container, this.structures, this.citizens)
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
    this.mapLayer.destroy()
    this.resources.destroy()
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
    if (fit.scale !== this.bakedScale) {
      this.bakedScale = fit.scale
      this.bakeMap()
      this.resources.buildTextures(app.renderer, this.displayResolution)
      this.resources.sync(this.mapRef)
    }
  }

  private get displayResolution(): number {
    return Math.max(0.25, this.bakedScale * (this.app?.renderer.resolution ?? 1))
  }

  /** Re-render terrain + fog into the cached map texture. */
  private bakeMap(): void {
    const app = this.app
    if (!app || !this.mapRef) return
    this.mapLayer.bake(app.renderer, this.mapRef.width * TILE_SIZE, this.mapRef.height * TILE_SIZE, this.displayResolution)
  }

  render(state: WorldState, alpha: number): void {
    const app = this.app
    if (!app) return

    if (state.map !== this.mapRef) {
      // New world: redraw everything and re-fit (re-bakes all layers).
      this.mapRef = state.map
      this.mapVersion = state.map.version
      this.snapshotMap(state.map)
      this.drawTerrain(state.map)
      this.drawFog(state.map)
      this.resources.clear()
      this.bakedScale = 0
      this.resize() // re-fits, bakes the map and syncs resource sprites
    } else if (state.map.version !== this.mapVersion) {
      this.mapVersion = state.map.version
      const terrainChanged = !sameArray(this.terrainCopy, state.map.terrain)
      const fogChanged = !sameArray(this.discoveredCopy, state.map.discovered)
      if (terrainChanged || fogChanged) {
        this.snapshotMap(state.map)
        if (terrainChanged) this.drawTerrain(state.map)
        if (fogChanged) this.drawFog(state.map)
        this.bakeMap()
      }
      this.resources.sync(state.map)
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

  private snapshotMap(map: TileMap): void {
    this.terrainCopy = [...map.terrain]
    this.discoveredCopy = [...map.discovered]
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

  private createCitizenView(c: Citizen): CitizenView {
    const root = new Container()
    const shadow = new Graphics().ellipse(0, 6, 6, 2.5).fill({ color: COLORS.shadow, alpha: 0.3 })
    const body = new Graphics()
      .circle(0, 0, 6)
      .fill(ROLE_COLORS[c.role])
      .stroke({ width: 1.5, color: COLORS.outline, alpha: 0.9 })
    // Cargo badge: white shape tinted per load (berries red, wood brown).
    const cargo = new Graphics().circle(5, -5, 3).fill(0xffffff).stroke({ width: 1, color: COLORS.shadow, alpha: 0.6 })
    cargo.visible = false
    root.addChild(shadow, body, cargo)
    root.label = `citizen-${c.id}`
    return { root, body, cargo, cargoKind: null, asleep: false }
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
        this.citizens.addChild(view.root)
      }
      const p = getVisualPosition(state, c, alpha)
      view.root.position.set(p.x * TILE_SIZE + TILE_SIZE / 2, p.y * TILE_SIZE + TILE_SIZE / 2)

      const cargoKind = c.carrying?.kind ?? null
      if (cargoKind !== view.cargoKind) {
        view.cargoKind = cargoKind
        view.cargo.visible = cargoKind !== null
        if (cargoKind) view.cargo.tint = cargoKind === 'berries' ? COLORS.berry : COLORS.log
      }
      const asleep = c.task?.phase === 'sleep'
      if (asleep !== view.asleep) {
        view.asleep = asleep
        view.body.alpha = asleep ? 0.5 : 1
      }
    }
    for (const [id, view] of this.citizenViews) {
      if (seen.has(id)) continue
      view.root.destroy({ children: true })
      this.citizenViews.delete(id)
    }
  }
}
