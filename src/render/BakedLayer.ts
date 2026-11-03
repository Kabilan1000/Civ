import { Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js'

/**
 * A Container drawn off-stage and cached into a texture shown by `sprite`.
 * Drawing the sprite costs one quad per frame regardless of how many shapes
 * the source holds; bake() re-renders it (call only when content or scale
 * changes).
 */
export class BakedLayer {
  readonly source = new Container()
  readonly sprite = new Sprite()
  private texture: Texture | null = null

  bake(renderer: Renderer, width: number, height: number, resolution: number): void {
    const previous = this.texture
    this.texture = renderer.generateTexture({
      target: this.source,
      frame: new Rectangle(0, 0, width, height),
      resolution: Math.max(0.25, resolution),
      antialias: true,
    })
    this.sprite.texture = this.texture
    previous?.destroy(true)
  }

  destroy(): void {
    this.sprite.texture = Texture.EMPTY
    this.texture?.destroy(true)
    this.texture = null
    this.source.destroy({ children: true }) // not on the stage
  }
}
