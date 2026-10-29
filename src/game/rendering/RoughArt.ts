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

/** Each Phaser game owns its canvas cache, including teardown of backing stores. */
const baked = new WeakMap<Phaser.Game, Map<string, BakeSpec>>()

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
/** iOS canvas-pool guard: WebKit enforces a process-wide 2D canvas
 * memory cap (~384MB on modern devices, less on older); overflow draws
 * SILENTLY TRANSPARENT. Cap offscreen bake resolution at dpr 2 (full
 * quality on dpr-1/2 screens; dpr-3 phones get 1.5x-size bakes —
 * visually near-identical for soft background art) and shrink every
 * replaced canvas to 1x1 so Safari releases its backing store instead
 * of hoarding it (WebKit keeps removed-canvas memory alive otherwise). */
const BAKE_DPR_CAP = 2
function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 1
  c.height = 1
}

function bakesFor(game: Phaser.Game): Map<string, BakeSpec> {
  const existing = baked.get(game)
  if (existing) return existing
  const cache = new Map<string, BakeSpec>()
  baked.set(game, cache)
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    for (const spec of cache.values()) releaseCanvas(spec.canvas)
    cache.clear()
    baked.delete(game)
  })
  return cache
}

export function bakeCanvas(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, seed: number) => void,
  dpr = 1,
): HTMLCanvasElement {
  const capped = Math.min(dpr, BAKE_DPR_CAP)
  const cache = bakesFor(scene.sys.game)
  const prev = cache.get(key)
  if (prev && prev.w === w * capped && prev.h === h * capped && scene.textures.exists(key)) return prev.canvas

  const canvas = document.createElement('canvas')
  canvas.width = w * capped
  canvas.height = h * capped
  const ctx = canvas.getContext('2d')!
  // Callers paint in CSS px; the (capped) dpr scale bakes at device res.
  ctx.scale(capped, capped)
  paint(ctx, seedFor(key))

  const oldCanvas = scene.textures.exists(key)
    ? (scene.textures.get(key).getSourceImage() as HTMLCanvasElement | null)
    : null
  if (scene.textures.exists(key)) scene.textures.remove(key)
  // One synchronous re-upload right after registration (harmless no-op if
  // the initial upload was already good).
  const tex = scene.textures.addCanvas(key, canvas) as Phaser.Textures.CanvasTexture | null
  tex?.refresh()
  // Safari hoards removed-canvas backing stores — shrink the old one.
  if (oldCanvas && oldCanvas !== canvas) releaseCanvas(oldCanvas)
  if (prev && prev.canvas !== canvas) releaseCanvas(prev.canvas)
  cache.set(key, { w: w * capped, h: h * capped, canvas })
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
