import Phaser from 'phaser'

/**
 * Canvas-texture bake helpers (plain 2D canvas — no RoughJS anywhere in the
 * game anymore). Everything here is BAKED ONCE into an offscreen canvas and
 * registered as a Phaser canvas texture; the same texture is reused until
 * the requested pixel size changes (resize).
 *
 * Determinism: the seed is derived from the texture key, so a given key
 * always paints the identical pattern — a rebuilt texture looks exactly
 * like the one it replaced.
 */

interface BakeSpec {
  w: number
  h: number
  canvas: HTMLCanvasElement
}

/** Texture key → last baked size (module-level: textures live on the game). */
const baked = new Map<string, BakeSpec>()

/** Stable 32-bit seed derived from a texture key. */
function seedFor(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 100000
}

/**
 * Bakes (or reuses) a canvas texture and registers it under `key`. `paint`
 * draws onto the 2D context in texture pixel coordinates. Re-bakes only
 * when the size changes.
 */
export function bakeCanvas(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, seed: number) => void,
  dpr = 1,
): HTMLCanvasElement {
  const prev = baked.get(key)
  if (prev && prev.w === w * dpr && prev.h === h * dpr && scene.textures.exists(key)) return prev.canvas

  const canvas = document.createElement('canvas')
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  // Callers paint in CSS px; the dpr scale bakes at device resolution.
  ctx.scale(dpr, dpr)
  paint(ctx, seedFor(key))

  if (scene.textures.exists(key)) scene.textures.remove(key)
  // One synchronous re-upload right after registration (harmless no-op if
  // the initial upload was already good).
  const tex = scene.textures.addCanvas(key, canvas) as Phaser.Textures.CanvasTexture | null
  tex?.refresh()
  baked.set(key, { w, h, canvas })
  return canvas
}

/** SVG path for a rounded rectangle (ctx.roundRect is missing on older iOS
 * Safari — stroke it through Path2D). */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return [
    `M ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h - rr}`,
    `Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `L ${x + rr} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - rr}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    'Z',
  ].join(' ')
}
