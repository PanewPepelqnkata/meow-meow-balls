import Phaser from 'phaser'

/**
 * ILLUSTRATED background themes (v2 — full scenery pass).
 *
 * Each theme is a layered, cohesive illustrated environment:
 * - light:   warm morning sky, soft sun with haze, flat-bottomed cartoon
 *            clouds, distant hill band, bird silhouettes
 * - space:   deep navy→violet gradient, layered nebula banks, a ringed
 *            planet, a cratered moon, horizon planet-curve, star bands,
 *            occasional shooting star
 * - jungle:  sun shafts through the canopy, layered hills, waterfall with
 *            rocks and foam, scalloped canopy with vines, palm fronds,
 *            ferns, flowers, butterfly ambient
 * - fantasy: twilight gradient, aurora bands, cratered moon with halo,
 *            castle spires silhouette, ruined arch and columns, crystal
 *            clusters, drifting magic motes
 *
 * Rules that hold across all four:
 * - The central play column (middle ~55% width, below the rim) stays clear
 *   of high-contrast detail — scenery lives at the edges, top and bottom.
 * - No oversized circles, no stretched gradients, no random geometric
 *   decoration; every element is a shaped silhouette or soft light.
 * - All art is deterministic (seeded RNG per theme) so crossfade redraws
 *   never flicker; ambient animation (cloud drift, star twinkle, fireflies,
 *   shooting stars, butterflies) lives in a dedicated per-frame layer.
 * - Everything renders in the never-zoomed BackgroundScene camera (screen
 *   space, scrollFactor 0), 1:1 with the viewport at every size.
 */

export type ThemeName = 'light' | 'space' | 'jungle' | 'fantasy'

/**
 * Structural subset of Phaser Graphics that every theme draw uses. Both
 * the real Graphics object and the G2D canvas adapter satisfy it, so the
 * same draw code paints live (desktop debugging) and baked (production).
 */
export interface ThemeDrawTarget {
  clear(): unknown
  fillStyle(color: number, alpha?: number): unknown
  lineStyle(width: number, color: number, alpha?: number): unknown
  fillGradientStyle(tl: number, tr: number, bl: number, br: number, alpha?: number): unknown
  fillRect(x: number, y: number, w: number, h: number): unknown
  fillRoundedRect(x: number, y: number, w: number, h: number, radius: number): unknown
  fillCircle(x: number, y: number, radius: number): unknown
  fillEllipse(x: number, y: number, width: number, height: number): unknown
  strokeEllipse(x: number, y: number, width: number, height: number): unknown
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): unknown
  beginPath(): unknown
  moveTo(x: number, y: number): unknown
  lineTo(x: number, y: number): unknown
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): unknown
  closePath(): unknown
  fillPath(): unknown
  strokePath(): unknown
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown
}

interface ThemeDef {
  name: ThemeName
  bgColor: number
  gridColor: number
  gridAlpha: number
  draw: (g: ThemeDrawTarget, w: number, h: number, rng: () => number) => void
}

/** Deterministic RNG (mulberry32) — stable art across redraws. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* Soft-blob texture (clouds / glows / halos)                          */
/* ------------------------------------------------------------------ */

const CLOUD_TEX_KEY = 'br-softcloud'

function ensureCloudTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CLOUD_TEX_KEY)) return
  const size = 256
  const tex = scene.textures.createCanvas(CLOUD_TEX_KEY, size, size)
  if (!tex) return
  const ctx = tex.getContext()
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.32, 'rgba(255,255,255,0.6)')
  grad.addColorStop(0.62, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  tex.refresh()
}

type CloudObj = Phaser.GameObjects.Image | Phaser.GameObjects.Graphics

/**
 * Bake ONE nebula bank as a canvas texture: a meandering cluster of many
 * overlapping radial-gradient blobs (blue↔purple mixed along the spine).
 * Seam safety: every blob center is clamped well inside the canvas so no
 * gradient is ever cut by the texture bounds (a clipped gradient = a hard
 * straight edge = the "rectangular patch" defect), and the finished
 * composite gets a radial vignette that fades the bank's own borders to
 * fully transparent, so the Image layer can never show a boundary against
 * the sky. Deterministic per seed. Sizes are texture pixels.
 */
function ensureNebulaTexture(scene: Phaser.Scene, key: string, seed: number, w: number, h: number): string {
  if (scene.textures.exists(key)) return key
  const tex = scene.textures.createCanvas(key, w, h)
  if (!tex) return key
  const ctx = tex.getContext()
  const rng = seeded(seed)
  // Palette: blues and purples of the space theme.
  const palette = [0x2c4f9e, 0x4a6bd0, 0x5b3fa8, 0x9a5fc0, 0x3d6bb0, 0x6b3fa8]
  const paintBlob = (cx: number, cy: number, cr: number, col: number, coreA: number, midA: number) => {
    const r = (col >> 16) & 0xff
    const gg = (col >> 8) & 0xff
    const b = col & 0xff
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr)
    grad.addColorStop(0, `rgba(${r},${gg},${b},${coreA})`)
    grad.addColorStop(0.45, `rgba(${r},${gg},${b},${midA})`)
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    ctx.fillStyle = grad
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1.6, 0.7) // wispy horizontal stretch
    ctx.translate(-cx, -cy)
    ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2)
    ctx.restore()
  }
  const spineY = h * 0.5
  const blobs = 26
  for (let i = 0; i < blobs; i++) {
    const t = i / (blobs - 1)
    const cr = h * (0.16 + Math.sin(t * Math.PI) * 0.3) * (0.7 + rng() * 0.6)
    // Clamp: blob + its stretch must stay inside the canvas.
    const cx = Math.min(w - cr * 1.8, Math.max(cr * 1.8, w * (0.06 + 0.88 * t) + (rng() - 0.5) * w * 0.05))
    const cy = Math.min(h - cr * 0.9, Math.max(cr * 0.9, spineY + Math.sin(t * Math.PI * 1.7 + seed * 0.001) * h * 0.22 + (rng() - 0.5) * h * 0.2))
    paintBlob(cx, cy, cr, palette[Math.floor(rng() * palette.length)]!, 0.3, 0.14)
  }
  // Bright kernel glows deep inside the bank.
  for (let i = 0; i < 5; i++) {
    const t = 0.15 + rng() * 0.7
    const cr = h * 0.08 * (0.6 + rng())
    const cx = Math.min(w - cr * 2, Math.max(cr * 2, w * (0.06 + 0.88 * t)))
    const cy = Math.min(h - cr * 1.2, Math.max(cr * 1.2, spineY + Math.sin(t * Math.PI * 1.7 + seed * 0.001) * h * 0.18))
    const col = palette[Math.floor(rng() * palette.length)]!
    const r = (col >> 16) & 0xff
    const gg = (col >> 8) & 0xff
    const b = col & 0xff
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr)
    grad.addColorStop(0, `rgba(${Math.min(255, r + 40)},${Math.min(255, gg + 40)},${Math.min(255, b + 40)},0.26)`)
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2)
  }
  // Border vignette: fade the bank's own rectangle boundary to fully
  // transparent (radial falloff from the center) — the Image then has no
  // visible boundary against the sky at any scale.
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.62)
  vg.addColorStop(0, 'rgba(0,0,0,1)')
  vg.addColorStop(0.72, 'rgba(0,0,0,0.6)')
  vg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  tex.refresh()
  return key
}

function addCloud(
  scene: Phaser.Scene,
  out: CloudObj[],
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  tint: number,
  alpha: number,
): void {
  ensureCloudTexture(scene)
  const img = scene.add
    .image(cx, cy, CLOUD_TEX_KEY)
    .setDepth(-98)
    .setTint(tint)
    .setData('baseAlpha', alpha)
  img.setScale(rw / 256, rh / 256)
  img.setData('drift', 2 + img.scaleX * 6)
  out.push(img)
}

/* ------------------------------------------------------------------ */
/* Shared shape helpers                                                */
/* ------------------------------------------------------------------ */

/** Smooth rolling hill silhouette (layered sines — never jagged). */
function rollingHill(
  g: ThemeDrawTarget,
  w: number,
  h: number,
  baseY: number,
  amp: number,
  phase: number,
  color: number,
): void {
  g.fillStyle(color, 1)
  g.beginPath()
  g.moveTo(0, h)
  for (let x = 0; x <= w; x += 8) {
    const t = (x / w) * Math.PI * 2
    const y = baseY + Math.sin(t * 1.4 + phase) * amp + Math.sin(t * 2.7 + phase * 2) * amp * 0.35
    g.lineTo(x, y)
  }
  g.lineTo(w, h)
  g.closePath()
  g.fillPath()
}

/** Rounded tree-line silhouette along a baseline. */
function treeLine(
  g: ThemeDrawTarget,
  w: number,
  baseY: number,
  color: number,
  rng: () => number,
  scale = 1,
): void {
  g.fillStyle(color, 1)
  let x = -10
  while (x < w + 10) {
    const r = (14 + rng() * 22) * scale
    g.fillCircle(x, baseY - r * 0.5, r)
    x += r * 1.15
  }
  g.fillRect(0, baseY - 8 * scale, w, 10 * scale + (baseY < 0 ? 0 : 0))
}

/** Scalloped leaf canopy band across the top. */
function canopyBand(
  g: ThemeDrawTarget,
  w: number,
  bandY: number,
  bumpR: number,
  color: number,
  rng: () => number,
): void {
  g.fillStyle(color, 1)
  let x = -bumpR * 0.5
  while (x < w + bumpR) {
    const r = bumpR * (0.75 + rng() * 0.5)
    g.fillCircle(x, bandY + Math.sin(x * 0.02) * bumpR * 0.3, r)
    x += r * 0.95
  }
  g.fillRect(0, 0, w, Math.max(2, bandY))
}

/** Hanging vine with small leaves. */
function vine(
  g: ThemeDrawTarget,
  x: number,
  topY: number,
  len: number,
  color: number,
  leaf: number,
  rng: () => number,
): void {
  g.lineStyle(3, color, 1)
  g.beginPath()
  g.moveTo(x, topY)
  const segs = 4
  for (let i = 1; i <= segs; i++) {
    const yy = topY + (len * i) / segs
    g.lineTo(x + Math.sin(i * 1.7 + x) * 6, yy)
  }
  g.strokePath()
  for (let i = 1; i <= segs; i++) {
    const yy = topY + (len * i) / segs
    const xx = x + Math.sin(i * 1.7 + x) * 6
    g.fillStyle(leaf, 1)
    g.fillCircle(xx + (i % 2 ? 5 : -5), yy, 4 + rng() * 2)
  }
}

/** Palm frond: curved spine with leaflets. */
function palmFrond(
  g: ThemeDrawTarget,
  x: number,
  y: number,
  len: number,
  angle: number,
  color: number,
  ink: number,
): void {
  const tipX = x + Math.cos(angle) * len
  const tipY = y + Math.sin(angle) * len
  g.lineStyle(5, ink, 1)
  g.beginPath()
  g.moveTo(x, y)
  // Quadratic spine sampled into line segments (Graphics has no curve API).
  const cpx = x + Math.cos(angle) * len * 0.5
  const cpy = y + Math.sin(angle) * len * 0.5 - len * 0.08
  for (let i = 1; i <= 10; i++) {
    const t = i / 10
    const qx = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * cpx + t * t * tipX
    const qy = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cpy + t * t * tipY
    g.lineTo(qx, qy)
  }
  g.strokePath()
  const leaflets = 9
  for (let i = 1; i < leaflets; i++) {
    const t = i / leaflets
    const bx = x + (tipX - x) * t
    const by = y + (tipY - y) * t - Math.sin(t * Math.PI) * len * 0.07
    const lLen = len * 0.16 * (1 - Math.abs(t - 0.55))
    for (const dir of [-0.9, 0.9]) {
      const la = angle + dir - 0.35
      g.lineStyle(4, color, 1)
      g.beginPath()
      g.moveTo(bx, by)
      g.lineTo(bx + Math.cos(la) * lLen, by + Math.sin(la) * lLen)
      g.strokePath()
    }
  }
}

/** Scalloped leafy mound (bush silhouette). */
function leafyMound(
  g: ThemeDrawTarget,
  x: number,
  y: number,
  mw: number,
  mh: number,
  color: number,
): void {
  g.fillStyle(color, 1)
  const bumps = Math.max(4, Math.round(mw / 26))
  const step = mw / bumps
  for (let i = 0; i < bumps; i++) {
    const bx = x - mw / 2 + step * (i + 0.5)
    const br = step * (0.62 + ((i * 37) % 10) / 40)
    g.fillCircle(bx, y - mh * 0.35, br)
  }
  g.fillRect(x - mw / 2 + step * 0.2, y - mh * 0.35, mw - step * 0.4, mh * 0.35 + 2)
}

/** Bird silhouette (two shallow quadratic arcs, sampled). */
function bird(g: ThemeDrawTarget, x: number, y: number, s: number, color: number, alpha: number): void {
  g.lineStyle(2, color, alpha)
  g.beginPath()
  g.moveTo(x - s, y)
  for (let i = 1; i <= 6; i++) {
    const t = i / 6
    const qx = (1 - t) * (1 - t) * (x - s) + 2 * (1 - t) * t * (x - s * 0.45) + t * t * x
    const qy = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * (y - s * 0.75) + t * t * y
    g.lineTo(qx, qy)
  }
  for (let i = 1; i <= 6; i++) {
    const t = i / 6
    const qx = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * (x + s * 0.45) + t * t * (x + s)
    const qy = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * (y - s * 0.75) + t * t * y
    g.lineTo(qx, qy)
  }
  g.strokePath()
}

/** Cratered moon/planet disc with shading and craters. */
function crateredBody(
  g: ThemeDrawTarget,
  x: number,
  y: number,
  r: number,
  base: number,
  shade: number,
  craters: Array<{ dx: number; dy: number; cr: number }>,
): void {
  g.fillStyle(base, 1)
  g.fillCircle(x, y, r)
  // Terminator shading (right-bottom crescent).
  g.fillStyle(shade, 0.55)
  g.beginPath()
  g.arc(x, y, r, -Math.PI * 0.15, Math.PI * 0.65)
  g.arc(x, y, r * 0.55, Math.PI * 0.65, -Math.PI * 0.15, true)
  g.closePath()
  g.fillPath()
  for (const c of craters) {
    g.fillStyle(shade, 0.5)
    g.fillCircle(x + c.dx * r, y + c.dy * r, c.cr * r)
    g.fillStyle(base, 0.6)
    g.fillCircle(x + c.dx * r - c.cr * r * 0.15, y + c.dy * r - c.cr * r * 0.15, c.cr * r * 0.72)
  }
}

/** Diagonal sun/light shafts (very low alpha, wide). */
function lightShafts(
  g: ThemeDrawTarget,
  w: number,
  h: number,
  originX: number,
  originY: number,
  color: number,
  alpha: number,
): void {
  const beams = [
    { a: 0.55, wd: w * 0.05 },
    { a: 0.95, wd: w * 0.075 },
    { a: 1.32, wd: w * 0.045 },
  ]
  for (const b of beams) {
    const len = h * 1.4
    g.fillStyle(color, alpha)
    g.beginPath()
    g.moveTo(originX, originY)
    g.lineTo(originX + Math.sin(b.a) * len - b.wd / 2, originY + Math.cos(b.a) * len)
    g.lineTo(originX + Math.sin(b.a) * len + b.wd / 2, originY + Math.cos(b.a) * len)
    g.closePath()
    g.fillPath()
  }
}

/* ------------------------------------------------------------------ */
/* Theme definitions                                                   */
/* ------------------------------------------------------------------ */

const THEMES: Record<ThemeName, ThemeDef> = {
  light: {
    name: 'light',
    bgColor: 0xf3f1eb,
    gridColor: 0xd7dce0,
    gridAlpha: 0.55,
    draw: (g, w, h, rng) => {
      // Morning sky: cream base warming to pale blue at the top.
      g.fillGradientStyle(0xfdf6e8, 0xf3f1eb, 0xdceaf2, 0xdceaf2, 1)
      g.fillRect(0, 0, w, h)

      // Simple warm sun: one soft halo disc + a crisp warm core (no
      // concentric rings).
      const sx = w * 0.82
      const sy = h * 0.12
      g.fillStyle(0xffe9a8, 0.4)
      g.fillCircle(sx, sy, Math.min(w, h) * 0.1)
      g.fillStyle(0xffd766, 0.9)
      g.fillCircle(sx, sy, Math.min(w, h) * 0.048)

      // Gentle distant hills grounding the horizon (two soft layers).
      rollingHill(g, w, h, h * 0.86, h * 0.02, 1.2, 0xdce8d8)
      rollingHill(g, w, h, h * 0.92, h * 0.018, 2.6, 0xc9dfc6)

      // Soft cartoon clouds with natural silhouettes: each cloud is a row
      // of overlapping rounded bumps whose radii taper toward the tips,
      // sitting on a slightly rounded base — an organic puffy outline, not
      // a chain of equal circles.
      const cloud = (cx: number, cy: number, cw: number, ch: number, alpha: number) => {
        g.fillStyle(0xffffff, alpha)
        const bumps = 6
        const radii: number[] = []
        for (let i = 0; i < bumps; i++) {
          // Tapered profile: small → big → small (natural cloud hump).
          const t = i / (bumps - 1)
          radii.push(ch * (0.42 + Math.sin(t * Math.PI) * 0.55 + (rng() - 0.5) * 0.12))
        }
        // Base slab with rounded ends.
        g.fillRoundedRect(cx - cw / 2, cy - ch * 0.28, cw, ch * 0.5, ch * 0.25)
        // Bumps along the top, overlapping so no circle edge reads alone.
        for (let i = 0; i < bumps; i++) {
          const bx = cx - cw / 2 + (cw / (bumps - 1)) * i
          g.fillCircle(bx, cy - ch * 0.22, radii[i]!)
        }
        // One offset lower bump on the flank for asymmetry.
        g.fillCircle(cx - cw * 0.31, cy + ch * 0.02, ch * 0.3)
      }
      cloud(w * 0.16, h * 0.15, w * 0.23, Math.min(w, h) * 0.055, 0.96)
      cloud(w * 0.56, h * 0.09, w * 0.15, Math.min(w, h) * 0.04, 0.88)
      cloud(w * 0.4, h * 0.27, w * 0.11, Math.min(w, h) * 0.03, 0.8)

      // Subtle birds: small, sparse, soft blue-gray.
      bird(g, w * 0.31, h * 0.21, 8, 0x8fa8b8, 0.65)
      bird(g, w * 0.355, h * 0.185, 6, 0x8fa8b8, 0.55)
      bird(g, w * 0.65, h * 0.31, 7, 0x9db4c2, 0.5)
    },
  },

  space: {
    name: 'space',
    bgColor: 0x0a1628,
    gridColor: 0x46597a,
    gridAlpha: 0.2,
    // The nebulas live in buildCloudGroup as soft-gradient IMAGE layers
    // (canvas-baked multi-blob composites — zero hard edges). The static
    // draw keeps only pin-sharp elements: stars, planets, moon, horizon.
    draw: (g, w, h, rng) => {
      // Deep navy → violet base: painted by the dedicated gradImage
      // (canvas-baked texture rebuilt on resize — Graphics
      // fillGradientStyle renders flat through the Flat render node on
      // some DPR configs). This draw paints only the pin-sharp elements:
      // stars, planets, moon, horizon.

      // PORTRAIT ART SCALE (Phase 2.22): the static art was sized for the
      // desktop reference (min dim ~936). On a phone (min dim 390) the
      // planet/moon shrank to ~40% and vanished into the dark. Scale them
      // by min(vw,vh)/560 clamped 1..1.8 so they stay prominent on
      // narrow-tall viewports.
      // Inverse scale: the planet/moon were sized for the desktop
      // reference (min dim 936). On a 390px phone the same absolute px
      // reads 2.4× smaller — scale UP to keep the same visual prominence.
      const artScale = Math.min(3, 936 / Math.min(w, h))

      // Small ringed planet upper-left: body, terminator shading, thin
      // ring — restrained, atmospheric (drawn small so it reads as a far
      // world, not a foreground object).
      const px = w * 0.2
      const py = h * 0.15
      const pr = Math.min(w, h) * 0.032 * artScale
      g.fillStyle(0xe8b06a, 1)
      g.fillCircle(px, py, pr)
      g.fillStyle(0xc78748, 0.6)
      g.beginPath()
      g.arc(px, py, pr, -Math.PI * 0.2, Math.PI * 0.7)
      g.arc(px, py, pr * 0.55, Math.PI * 0.7, -Math.PI * 0.2, true)
      g.closePath()
      g.fillPath()
      // Ring: back half then front half (thin, warm sand).
      g.lineStyle(pr * 0.12, 0xd8c9a8, 0.6)
      g.beginPath()
      g.arc(px, py, pr * 1.6, Math.PI * 1.06, Math.PI * 1.94)
      g.strokePath()
      g.lineStyle(pr * 0.12, 0xf0e3c4, 0.7)
      g.beginPath()
      g.arc(px, py, pr * 1.6, Math.PI * 1.94, Math.PI * 1.06)
      g.strokePath()

      // One distant cratered moon, lower-right (small, quiet).
      crateredBody(g, w * 0.84, h * 0.31, Math.min(w, h) * 0.026 * artScale, 0xcdd6e8, 0x93a2c2, [
        { dx: -0.3, dy: -0.2, cr: 0.16 },
        { dx: 0.25, dy: 0.15, cr: 0.12 },
        { dx: 0.05, dy: -0.4, cr: 0.09 },
        { dx: -0.1, dy: 0.35, cr: 0.1 },
      ])

      // Horizon planet-curve at the bottom (huge dark disc, only its top
      // arc visible) with a thin atmosphere limb — depth under the
      // container, no rectangular edge anywhere near it.
      g.fillStyle(0x070d1c, 1)
      g.fillEllipse(w * 0.5, h * 1.24, w * 1.7, h * 0.62)
      g.lineStyle(2, 0x4a6fa8, 0.45)
      g.strokeEllipse(w * 0.5, h * 1.24, w * 1.7, h * 0.62)

      // Star field: three depth bands (small many → large few), a few
      // bright ones with subtle cross glints.
      const bands = [
        { n: 80, r: [0.5, 1.0], a: [0.22, 0.5] },
        { n: 30, r: [0.9, 1.6], a: [0.35, 0.75] },
        { n: 10, r: [1.6 * artScale, 2.3 * artScale], a: [0.55, 0.9] },
      ]
      for (const b of bands) {
        for (let i = 0; i < b.n; i++) {
          const sx2 = rng() * w
          const sy2 = rng() * h * 0.94
          const r = b.r[0]! + rng() * (b.r[1]! - b.r[0]!)
          const a = b.a[0]! + rng() * (b.a[1]! - b.a[0]!)
          // Soft glow under the larger stars: two stacked low-alpha discs
          // (a single disc shows its rim against the dark sky).
          if (r > 1.5) {
            g.fillStyle(0xbfd8ff, a * 0.07)
            g.fillCircle(sx2, sy2, r * 3.4)
            g.fillStyle(0xd8e8ff, a * 0.11)
            g.fillCircle(sx2, sy2, r * 2.1)
          }
          g.fillStyle(0xffffff, a)
          g.fillCircle(sx2, sy2, r)
          if (r > 2.0) {
            g.lineStyle(1.2, 0xffffff, a * 0.6)
            g.lineBetween(sx2 - r * 2.3, sy2, sx2 + r * 2.3, sy2)
            g.lineBetween(sx2, sy2 - r * 2.3, sx2, sy2 + r * 2.3)
          }
        }
      }
    },
  },

  jungle: {
    name: 'jungle',
    bgColor: 0x9fd8b4,
    gridColor: 0x3f6f52,
    gridAlpha: 0.14,
    draw: (g, w, h, rng) => {
      // Sky: warm daylight fading into canopy-shaded forest haze.
      g.fillGradientStyle(0xd8f0d2, 0xbfe8c8, 0x8cc8a2, 0x6db48e, 1)
      g.fillRect(0, 0, w, h)

      // Sun shafts falling from the top-left through the canopy.
      lightShafts(g, w, h, w * 0.24, -h * 0.05, 0xfff8d8, 0.16)

      // Distant hills.
      rollingHill(g, w, h, h * 0.6, h * 0.05, 0.9, 0x8fc2a0)
      rollingHill(g, w, h, h * 0.72, h * 0.06, 3.1, 0x5f9e79)

      // Waterfall: ribbon + bright core + rocks + pool + foam arcs.
      const wx = w * 0.76
      const wy = h * 0.63
      const fh = h * 0.17
      g.fillStyle(0xe4f6ec, 0.9)
      g.beginPath()
      g.moveTo(wx - w * 0.013, wy)
      g.lineTo(wx + w * 0.013, wy)
      g.lineTo(wx + w * 0.021, wy + fh)
      g.lineTo(wx - w * 0.021, wy + fh)
      g.closePath()
      g.fillPath()
      g.fillStyle(0xffffff, 0.6)
      g.fillRect(wx - w * 0.004, wy, w * 0.008, fh)
      // Pool + foam.
      g.fillStyle(0xbfe9d2, 0.9)
      g.fillEllipse(wx, wy + fh, w * 0.09, h * 0.024)
      g.fillStyle(0xffffff, 0.75)
      for (let i = 0; i < 4; i++) {
        g.fillEllipse(wx + (i - 1.5) * w * 0.014, wy + fh + h * 0.006, w * 0.02, h * 0.005)
      }
      // Rocks flanking the fall.
      g.fillStyle(0x5d8f74, 1)
      g.fillCircle(wx - w * 0.032, wy + fh * 0.8, Math.min(w, h) * 0.014)
      g.fillCircle(wx + w * 0.03, wy + fh * 0.9, Math.min(w, h) * 0.011)
      g.fillStyle(0x4a7a62, 1)
      g.fillCircle(wx - w * 0.026, wy + fh * 0.95, Math.min(w, h) * 0.009)

      // Forest depth line.
      treeLine(g, w, h * 0.9, 0x3a7350, rng)

      // Canopy: two scalloped bands + vines.
      const ink = 0x1c3d28
      canopyBand(g, w, h * 0.085, Math.min(w, h) * 0.06, 0x2f6b44, rng)
      canopyBand(g, w, h * 0.05, Math.min(w, h) * 0.042, 0x47925c, rng)
      for (let i = 0; i < 5; i++) {
        vine(g, w * (0.14 + i * 0.18 + rng() * 0.04), h * 0.075, h * (0.06 + rng() * 0.06), 0x3d8556, ink, rng)
      }

      // Framing palm fronds.
      const frondLen = Math.min(w, h) * 0.3
      const dark = 0x2f6b44
      const mid = 0x4d9b62
      palmFrond(g, -w * 0.02, h * 0.05, frondLen, 0.55, dark, ink)
      palmFrond(g, -w * 0.02, h * 0.015, frondLen * 0.78, 0.9, mid, ink)
      palmFrond(g, w * 1.02, h * 0.07, frondLen, Math.PI - 0.55, dark, ink)
      palmFrond(g, w * 1.02, h * 0.03, frondLen * 0.82, Math.PI - 0.9, mid, ink)
      palmFrond(g, -w * 0.02, h * 0.93, frondLen * 0.8, -0.5, dark, ink)
      palmFrond(g, w * 1.02, h * 0.95, frondLen * 0.8, Math.PI + 0.5, dark, ink)

      // Ferns + leafy mounds at the bottom corners.
      leafyMound(g, w * 0.06, h * 1.0, Math.min(w, h) * 0.28, Math.min(w, h) * 0.12, 0x35754a)
      leafyMound(g, w * 0.94, h * 1.0, Math.min(w, h) * 0.28, Math.min(w, h) * 0.12, 0x35754a)
      leafyMound(g, w * 0.12, h * 1.02, Math.min(w, h) * 0.18, Math.min(w, h) * 0.08, 0x2c6440)

      // Flowers: small bright accents on the mounds (away from the play
      // column).
      const bloom = (bx: number, by: number, c: number) => {
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2
          g.fillStyle(c, 1)
          g.fillCircle(bx + Math.cos(a) * 4.4, by + Math.sin(a) * 4.4, 2.6)
        }
        g.fillStyle(0xffe08a, 1)
        g.fillCircle(bx, by, 2)
      }
      bloom(w * 0.08, h * 0.965, 0xff6f61)
      bloom(w * 0.135, h * 0.985, 0xffa726)
      bloom(w * 0.9, h * 0.965, 0xff6f61)
      bloom(w * 0.955, h * 0.985, 0xba68c8)
      bloom(w * 0.045, h * 0.93, 0xffa726)
      bloom(w * 0.935, h * 0.925, 0xff8a65)
    },
  },

  fantasy: {
    name: 'fantasy',
    bgColor: 0x2a1f4d,
    gridColor: 0x6f5b94,
    gridAlpha: 0.16,
    draw: (g, w, h, rng) => {
      // Twilight: indigo → violet with a warm horizon kiss.
      g.fillGradientStyle(0x191340, 0x1d1740, 0x452a68, 0x5a3a78, 1)
      g.fillRect(0, 0, w, h)

      // Stars (small, two depth sizes).
      for (let i = 0; i < 80; i++) {
        const sx = rng() * w
        const sy = rng() * h * 0.6
        g.fillStyle(0xffffff, 0.22 + rng() * 0.5)
        g.fillCircle(sx, sy, 0.6 + rng() * 1.1)
      }

      // Moon: crisp cratered disc with ONE tight soft halo (no giant rings).
      const mx = w * 0.8
      const my = h * 0.14
      const mr = Math.min(w, h) * 0.05
      g.fillStyle(0xcfd8ff, 0.18)
      g.fillCircle(mx, my, mr * 1.5)
      crateredBody(g, mx, my, mr, 0xe8ecff, 0xaab4dd, [
        { dx: -0.32, dy: -0.1, cr: 0.15 },
        { dx: 0.2, dy: 0.28, cr: 0.11 },
        { dx: 0.05, dy: -0.42, cr: 0.08 },
        { dx: -0.15, dy: 0.4, cr: 0.09 },
      ])

      // Organic mountain silhouettes: three depth layers of smooth ridges
      // (layered sines, no straight rectangles).
      const ridge = (baseY: number, amp: number, freq: number, phase: number, color: number) => {
        g.fillStyle(color, 1)
        g.beginPath()
        g.moveTo(0, h)
        for (let x = 0; x <= w; x += 6) {
          const t = (x / w) * Math.PI * 2
          const peak =
            baseY -
            Math.abs(Math.sin(t * freq + phase)) * amp -
            Math.sin(t * freq * 2.6 + phase * 1.7) * amp * 0.22
          g.lineTo(x, peak)
        }
        g.lineTo(w, h)
        g.closePath()
        g.fillPath()
      }
      ridge(h * 0.72, h * 0.16, 1.15, 0.4, 0x3a2a63) // far, hazy
      ridge(h * 0.8, h * 0.13, 1.5, 2.2, 0x2c204e) // mid
      ridge(h * 0.9, h * 0.1, 1.25, 4.1, 0x201640) // near

      // Castle silhouette perched on a far mountain peak, with glowing
      // windows and pennant spires.
      const castleColor = 0x241a45
      const cxp = w * 0.22
      const cyp = h * 0.6
      const keep = (sx: number, sy: number, sw: number, sh: number, roofH: number) => {
        g.fillStyle(castleColor, 1)
        g.fillRect(sx - sw / 2, sy - sh, sw, sh)
        // Conical roof.
        g.fillTriangle(sx - sw * 0.66, sy - sh, sx + sw * 0.66, sy - sh, sx, sy - sh - roofH)
        // Lit windows (tiny warm slits).
        g.fillStyle(0xffd98a, 0.9)
        g.fillRect(sx - sw * 0.14, sy - sh * 0.7, sw * 0.28, sw * 0.4)
        g.fillRect(sx - sw * 0.14, sy - sh * 0.38, sw * 0.28, sw * 0.3)
      }
      // Ridge the castle sits on: small mound under the keep.
      g.fillStyle(castleColor, 1)
      g.beginPath()
      g.moveTo(cxp - w * 0.09, h * 0.75)
      // Quadratic mound sampled into segments (no curve API on Graphics).
      const mcx = cxp
      const mcy = cyp + h * 0.015
      for (let i = 1; i <= 10; i++) {
        const t = i / 10
        const qx = (1 - t) * (1 - t) * (cxp - w * 0.09) + 2 * (1 - t) * t * mcx + t * t * (cxp + w * 0.09)
        const qy = (1 - t) * (1 - t) * h * 0.75 + 2 * (1 - t) * t * mcy + t * t * h * 0.75
        g.lineTo(qx, qy)
      }
      g.closePath()
      g.fillPath()
      keep(cxp, cyp, w * 0.028, h * 0.1, h * 0.035)
      keep(cxp - w * 0.036, cyp + h * 0.012, w * 0.02, h * 0.07, h * 0.026)
      keep(cxp + w * 0.036, cyp + h * 0.012, w * 0.02, h * 0.075, h * 0.028)
      // Wall between towers.
      g.fillStyle(castleColor, 1)
      g.fillRect(cxp - w * 0.048, cyp - h * 0.012, w * 0.096, h * 0.03)

      // Ruined arch mid-layer (stone arcs + broken stumps).
      const mid = 0x2c204e
      const ax = w * 0.72
      const ay = h * 0.82
      g.lineStyle(w * 0.015, mid, 1)
      g.beginPath()
      g.arc(ax, ay, Math.min(w, h) * 0.11, Math.PI * 1.04, Math.PI * 1.83)
      g.strokePath()
      g.fillStyle(mid, 1)
      g.fillRect(ax - Math.min(w, h) * 0.117, ay - h * 0.016, w * 0.016, h * 0.075)
      g.fillRect(ax + Math.min(w, h) * 0.1, ay - Math.min(w, h) * 0.105, w * 0.016, h * 0.068)

      // Crystal clusters glowing at the bottom corners (organic spires with
      // soft ground-glow, facets catching light).
      const crystal = (bx: number, by: number, s: number, c: number) => {
        g.fillStyle(c, 0.16)
        g.fillEllipse(bx, by, s * 4.4, s * 1.1)
        for (const [dx, hh, ww, lean] of [
          [-0.55, 0.9, 0.4, -0.12],
          [0.08, 1.3, 0.5, 0.06],
          [0.62, 0.75, 0.34, 0.2],
        ] as Array<[number, number, number, number]>) {
          const tipX = bx + dx * s + lean * s
          g.fillStyle(c, 1)
          g.fillTriangle(bx + dx * s - ww * s, by, bx + dx * s + ww * s, by, tipX, by - hh * s)
          g.fillStyle(0xffffff, 0.4)
          g.fillTriangle(
            bx + dx * s - ww * s * 0.35,
            by,
            bx + dx * s + ww * s * 0.05,
            by,
            tipX - ww * s * 0.2,
            by - hh * s * 0.66,
          )
        }
      }
      crystal(w * 0.1, h * 0.99, Math.min(w, h) * 0.05, 0x7ee8ff)
      crystal(w * 0.9, h * 0.99, Math.min(w, h) * 0.046, 0xc78bff)
      crystal(w * 0.165, h * 0.995, Math.min(w, h) * 0.028, 0x7ee8ff)

      // Gentle purple/cyan mist: layered soft fog wisps hugging the valleys
      // (tapered ellipse clusters, not a band).
      const mist = (cx2: number, cy2: number, cw2: number, ch2: number, col: number, alpha: number) => {
        for (let i = 0; i < 5; i++) {
          const t = i / 4
          const lx = cx2 - cw2 / 2 + cw2 * t
          const ly = cy2 + Math.sin(t * Math.PI * 1.3 + cx2 * 0.01) * ch2 * 0.3
          const lr = ch2 * (0.4 + Math.sin(t * Math.PI) * 0.6)
          g.fillStyle(col, alpha)
          g.fillEllipse(lx, ly, lr * 2.8, lr * 1.1)
        }
      }
      mist(w * 0.3, h * 0.88, w * 0.4, h * 0.035, 0x9b7bff, 0.1)
      mist(w * 0.72, h * 0.93, w * 0.34, h * 0.03, 0x7ee8ff, 0.08)
      mist(w * 0.5, h * 0.97, w * 0.55, h * 0.032, 0x8f7bd0, 0.12)
    },
  },
}

/* ------------------------------------------------------------------ */
/* Canvas-2D Graphics adapter (device-res art bake)                    */
/* ------------------------------------------------------------------ */

/**
 * Implements the Phaser Graphics subset the theme draw functions use,
 * backed by a CanvasRenderingContext2D. All coordinates arrive in CSS px;
 * the context is pre-scaled by dpr so one pass paints the device-res bake.
 *
 * Why: Phaser 4.2 Graphics command buffers silently fail to render on
 * high-DPR phone viewports (observed on bgLayer/grid/stars with big
 * buffers). The gradient, grid and stars already moved to canvas textures;
 * the static theme art is the last Graphics consumer — it bakes through
 * this adapter onto 'br-art-<theme>' canvas textures instead.
 */
class G2D {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private wCss: number,
    private hCss: number,
  ) {}
  private fillA = 1
  private strokeC = '#000'
  private strokeA = 1

  private css(c: number): string {
    return '#' + c.toString(16).padStart(6, '0')
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
    this.ctx.scale(this.ctx.canvas.width / this.wCss, this.ctx.canvas.height / this.hCss)
  }

  fillStyle(color: number, alpha = 1): void {
    this.fillA = alpha
    this.ctx.fillStyle = this.css(color)
  }

  lineStyle(width: number, color: number, alpha = 1): void {
    this.strokeC = this.css(color)
    this.strokeA = alpha
    this.ctx.lineWidth = width
    this.ctx.strokeStyle = this.strokeC
  }

  /** Vertical gradient approximation of Phaser's quad gradient. */
  fillGradientStyle(tl: number, tr: number, bl: number, br: number, alpha = 1): void {
    const mix = (a: number, b: number): number => {
      const ar = (a >> 16) & 0xff
      const ag = (a >> 8) & 0xff
      const ab = a & 0xff
      const brv = (b >> 16) & 0xff
      const bg = (b >> 8) & 0xff
      const bb = b & 0xff
      return ((Math.round((ar + brv) / 2) << 16) | (Math.round((ag + bg) / 2) << 8) | Math.round((ab + bb) / 2)) >>> 0
    }
    const g = this.ctx.createLinearGradient(0, 0, 0, this.hCss)
    g.addColorStop(0, this.css(mix(tl, tr)))
    g.addColorStop(1, this.css(mix(bl, br)))
    this.fillA = alpha
    this.ctx.fillStyle = g
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.ctx.globalAlpha = this.fillA
    this.ctx.fillRect(x, y, w, h)
    this.ctx.globalAlpha = 1
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r: number): void {
    this.ctx.globalAlpha = this.fillA
    this.ctx.beginPath()
    this.ctx.roundRect(x, y, w, h, r)
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }

  fillCircle(x: number, y: number, r: number): void {
    this.ctx.globalAlpha = this.fillA
    this.ctx.beginPath()
    this.ctx.arc(x, y, Math.max(0.05, r), 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }

  fillEllipse(x: number, y: number, width: number, height: number): void {
    this.ctx.globalAlpha = this.fillA
    this.ctx.beginPath()
    this.ctx.ellipse(x, y, Math.max(0.05, width / 2), Math.max(0.05, height / 2), 0, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }

  strokeEllipse(x: number, y: number, width: number, height: number): void {
    this.ctx.globalAlpha = this.strokeA
    this.ctx.beginPath()
    this.ctx.ellipse(x, y, Math.max(0.05, width / 2), Math.max(0.05, height / 2), 0, 0, Math.PI * 2)
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }

  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    this.ctx.globalAlpha = this.fillA
    this.ctx.beginPath()
    this.ctx.moveTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.lineTo(x3, y3)
    this.ctx.closePath()
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }

  beginPath(): void {
    this.ctx.beginPath()
  }

  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y)
  }

  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void {
    this.ctx.arc(x, y, Math.max(0.05, radius), startAngle, endAngle, anticlockwise)
  }

  closePath(): void {
    this.ctx.closePath()
  }

  fillPath(): void {
    this.ctx.globalAlpha = this.fillA
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }

  strokePath(): void {
    this.ctx.globalAlpha = this.strokeA
    this.ctx.lineJoin = 'round'
    this.ctx.lineCap = 'round'
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }

  lineBetween(x1: number, y1: number, x2: number, y2: number): void {
    this.ctx.globalAlpha = this.strokeA
    this.ctx.beginPath()
    this.ctx.moveTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

/**
 * Manages illustrated background themes with smooth crossfades and a
 * per-theme ambient animation layer (fireflies, shooting stars,
 * butterflies, drifting motes).
 */
export class BackgroundTheme {
  private scene: Phaser.Scene
  private currentTheme: ThemeName = 'light'
  private ambientLayer!: Phaser.GameObjects.Graphics
  private transitionTween?: Phaser.Tweens.Tween
  private transitionProgress = 0
  private fromTheme: ThemeName | null = null
  private toTheme: ThemeName | null = null
  private stars: Array<{ x: number; y: number; size: number; twinkle: number; glint: boolean }> = []
  private starAlpha = 0
  /** Per-theme soft cloud layers (irregular gradient blobs). */
  private cloudGroups: Partial<Record<ThemeName, CloudObj[]>> = {}
  /**
   * SPACE BASE GRADIENT — device-resolution canvas texture on a
   * screen-space Image. Depth map (Phase 2.23, back → front):
   *   -100 gradImage  (space base gradient)
   *    -99 artImages  (baked theme static art — one Image per theme)
   *    -97 nebula Images (cloudGroups — above space art)
   *    -95 starImage  (twinkling stars)
   *    -89 ambientLayer
   *    -88 gridImage  (baked grid)
   * While space is active the art bake paints only the pin-sharp space
   * elements (the gradImage owns the base fill); non-space art bakes
   * include their own base fill and the gradImage hides.
   */
  private gradImage: Phaser.GameObjects.Image | null = null
  private gridImage: Phaser.GameObjects.Image | null = null
  /** Space star field baked at device resolution (see drawStars). */
  private starImage: Phaser.GameObjects.Image | null = null
  /** Ambient particles (theme-flavored, deterministic layout). */
  private ambient: Array<{ x: number; y: number; s: number; ph: number; kind: string }> = []
  /** Shooting star state (space theme): null = idle. */
  private shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null
  private nextShootAt = 2500
  constructor(scene: Phaser.Scene, initialTheme: ThemeName = 'light') {
    this.scene = scene
    this.currentTheme = initialTheme
    // Background renders in screen space (never-zoomed camera).
    this.ambientLayer = scene.add.graphics().setDepth(-89)
    // PERF: no bakes here. At construction scale.width/height are still the
    // 720x1280 STAGE config and displayScale is 1, so with dpr 3 every bake
    // would create a 2160x3840 texture (~33 MB x4) that the imminent boot
    // resize (READY -> applyDprResize) throws away and re-bakes at the real
    // viewport — a burst of 8 GPU texture alloc/free cycles of 8-12 MP each,
    // exactly the regime where iOS WebGL uploads fail. The boot RESIZE storm
    // reaches handleResize with the real viewport; the pending-net in
    // update() paints synchronously before the first visible frame.
    this.initStars(initialTheme)
    this.initAmbient(initialTheme)
    this.buildCloudGroup(initialTheme)
    this.applyCloudAlphas()

    scene.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this)
    })
  }

  /** The settled theme name (mid-transition reports the target). */
  get themeName(): ThemeName {
    return this.toTheme ?? this.currentTheme
  }

  private handleResize(): void {
    // Phase 2.21 — RESIZE GUARD: Safari fires RESIZE continuously during
    // address-bar collapse and momentum scroll (dynamic viewport). A full
    // rebuild per event — gradient canvas resize + repaint + GPU re-upload
    // of a ~1170×2532 texture, full Graphics repaint, grid canvas repaint,
    // star/ambient re-init, nebula Image destroy/recreate — both stutters
    // the frame loop AND can leave the background half-painted. Two layers
    // of defense:
    //  1. skip entirely when the effective CSS size + DPR are unchanged,
    //  2. debounce the heavy bake: the event storm collapses into ONE
    //     rebuild 120ms after the last event. The old (last-known-good)
    //     frame stays on screen until then — no flashing, no half states.
    const z = this.scene.game.scale.displayScale.x || 1
    const cssW = Math.round(this.scene.scale.width / z)
    const cssH = Math.round(this.scene.scale.height / z)
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // iOS canvas-pool cap
    if (cssW === this.lastResizeW && cssH === this.lastResizeH && dpr === this.lastResizeDpr) {
      return
    }
    // Correctness net: remember the TARGET dims — update() repaints
    // synchronously if the debounced rebuild hasn't run yet (covers
    // paused-tab timers and any missed event).
    this.pendingW = cssW
    this.pendingH = cssH
    this.pendingDpr = dpr
    // Immediate cheap part: the gradient texture is already sized for
    // SOME viewport; display-size scaling keeps it covering the screen
    // until the debounced rebuild runs.
    this.lastResizeW = cssW
    this.lastResizeH = cssH
    this.lastResizeDpr = dpr
    // PERF: the timer no longer bakes. Previously BOTH this debounced
    // callback AND update()'s pending-net ran the full rebuild — the boot
    // sequence baked every full-screen texture TWICE (double the GPU
    // alloc/upload churn). Now the timer just lets the event storm settle;
    // update()'s pending-net performs the single rebuild on the next frame.
    if (this.resizeTimer) this.scene.time.removeEvent(this.resizeTimer)
    this.resizeTimer = this.scene.time.delayedCall(120, () => {
      this.resizeTimer = undefined
    })
  }

  /** Last resize dimensions seen (CSS px + dpr) — dedupe key. */
  private lastResizeW = 0
  private lastResizeH = 0
  private lastResizeDpr = 0
  private resizeTimer: Phaser.Time.TimerEvent | undefined
  /** Target dims awaiting the debounced rebuild (correctness net). */
  private pendingW = 0
  private pendingH = 0
  private pendingDpr = 0

  /**
   * Space base gradient as a device-resolution canvas texture on a
   * screen-space Image (depth -98: above bgLayer -100, below stars -95).
   * Rebuilt when the viewport size or DPR changes; visible only while
   * space is the active/target theme. Graphics fillGradientStyle renders
   * flat through the Flat render node on some DPR configs — the 2D-canvas
   * gradient is reliable and stays sharp at high DPR.
   */
  private updateGradImage(): void {
    const z = this.scene.game.scale.displayScale.x || 1
    // PERF: cap at dpr 2 — must MATCH the composite bake resolution or
    // the composite's 1:1 grad drawImage crops the gradient (top-left
    // 62% only → darker sky). All screen-filling bakes share the cap.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.ceil((this.scene.scale.width / z) * dpr)
    const h = Math.ceil((this.scene.scale.height / z) * dpr)
    const spaceActive = (this.toTheme ?? this.currentTheme) === 'space'
    if (!spaceActive) {
      this.gradImage?.setVisible(false)
      return
    }
    // FRESH-TEXTURE REBUILD: never resize a canvas texture in place.
    // Resizing src.width + refresh() re-uploads into the SAME GL texture
    // object — flaky on iOS (WebGL may keep stale content/size: the
    // "correct for a second, broken after restart" report, and a stale
    // space bake leaking through as a top-left quad on other themes).
    // Removing the texture forces a brand-new GL texture every rebuild.
    const dimsMatch =
      this.scene.textures.exists('br-space-grad') &&
      (this.scene.textures.get('br-space-grad').getSourceImage() as HTMLCanvasElement).width === w &&
      (this.scene.textures.get('br-space-grad').getSourceImage() as HTMLCanvasElement).height === h
    if (this.scene.textures.exists('br-space-grad') && !dimsMatch) {
      this.scene.textures.remove('br-space-grad')
      this.gradImage?.destroy()
      this.gradImage = null
    }
    if (!this.gradImage) {
      if (!this.scene.textures.exists('br-space-grad')) {
        this.scene.textures.createCanvas('br-space-grad', w, h)
      }
      this.gradImage = this.scene.add
        .image(0, 0, 'br-space-grad')
        .setOrigin(0, 0)
        .setDepth(-100)
    }
    const tex = this.scene.textures.get('br-space-grad') as Phaser.Textures.CanvasTexture
    const src = tex.getSourceImage() as HTMLCanvasElement
    const ctx = src.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#0a1628')
    grad.addColorStop(0.5, '#0e1a33')
    grad.addColorStop(1, '#2a1a4e')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    tex.refresh()
    // Device-px texture, LOGICAL display size — CSS px derived from the
    // SAME z used for the bake (keeps bake and display in lockstep even
    // mid-resize when displayScale changes under us).
    this.gradImage.setDisplaySize(Math.ceil(this.scene.scale.width / z), Math.ceil(this.scene.scale.height / z))
    this.gradImage.setVisible(true)
  }

  /** Change to a new theme with a smooth crossfade. */
  setTheme(theme: ThemeName, duration = 800): void {
    if (theme === this.currentTheme && !this.transitionTween) return
    if (theme === this.toTheme) return

    this.fromTheme = this.currentTheme
    this.toTheme = theme
    this.transitionProgress = 0
    this.initStars(theme)
    this.initAmbient(theme)
    this.buildCloudGroup(this.fromTheme)
    this.buildCloudGroup(theme)
    // Rebuild the space base gradient when the target theme changes: a
    // session that booted non-space has gradImage === null (the early
    // return in updateGradImage), and the space art bake intentionally
    // paints no base fill — without this the crossfade lands on the raw
    // canvas clear color instead of the navy→violet gradient.
    this.updateGradImage()
    // Bake BOTH partner arts once; the tween then only blends alphas
    // (via applyCloudAlphas on the progress tick) — no per-frame rebakes.
    this.drawBackground()
    // Star/grid layers follow the same once-per-change rule: initStars only
    // resets the data; with the 20 Hz re-bake gone, space-bound transitions
    // must bake the star texture here (pruneArtTextures may have dropped it).
    if ((theme === 'space' || this.fromTheme === 'space') && (!this.starImage || !this.scene.textures.exists('br-stars'))) {
      this.starAlpha = theme === 'space' ? 1 : 0
      this.drawStars()
    }
    if ((theme === 'space' || this.fromTheme === 'space') && (!this.gridImage || !this.scene.textures.exists('br-grid'))) {
      this.drawGrid()
    }

    this.transitionTween?.stop()
    this.gradImage?.setVisible(false)
    this.transitionTween = this.scene.tweens.add({
      targets: this,
      transitionProgress: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.applyCloudAlphas()
        // PERF: no drawGrid() per tick. The grid bake depends only on
        // viewport dims + spaceActive — both constant during a crossfade —
        // yet the old call repainted the full 1170x2532 canvas + tex.refresh()
        // (11.8 MB upload) EVERY tick, ~700 MB over one 800 ms fade, to
        // interpolate a line color the eye cannot track at gridAlpha 0.2.
        // Bake at the endpoints only; blend the Image alpha in between.
        if (this.gridImage && this.fromTheme && this.toTheme) {
          const from = THEMES[this.fromTheme].gridAlpha
          const to = THEMES[this.toTheme].gridAlpha
          const portraitBoost = window.innerWidth < window.innerHeight ? 2.6 : 1
          this.gridImage.setAlpha(Math.min(1, (from + (to - from) * this.transitionProgress) * portraitBoost))
        }
      },
      onComplete: () => {
        this.currentTheme = theme
        this.fromTheme = null
        this.toTheme = null
        this.transitionProgress = 0
        this.transitionTween = undefined
        this.drawBackground()
        this.drawGrid()
        this.pruneArtTextures()
      },
    })
  }

  /**
   * PERF: drop device-res art textures (11.8 MB GPU + 11.8 MB CPU canvas
   * each on an iPhone) of themes that are no longer visible. bakeThemeArt
   * recreates them on demand via drawBackground()'s wanted list — a one-off
   * bake at the next theme switch instead of permanent residency (up to
   * 47 MB for all four themes). Also drops the space grid/star layers when
   * space is fully gone; drawGrid/drawStars recreate them cheaply.
   */
  private pruneArtTextures(): void {
    for (const name of Object.keys(this.artImages) as ThemeName[]) {
      if (name === this.currentTheme) continue
      this.artImages[name]?.destroy()
      delete this.artImages[name]
      if (this.scene.textures.exists('br-art-' + name)) this.scene.textures.remove('br-art-' + name)
    }
    if (this.currentTheme !== 'space') {
      if (this.starImage) {
        this.starImage.destroy()
        this.starImage = null
        if (this.scene.textures.exists('br-stars')) this.scene.textures.remove('br-stars')
      }
      if (this.gridImage) {
        this.gridImage.destroy()
        this.gridImage = null
        if (this.scene.textures.exists('br-grid')) this.scene.textures.remove('br-grid')
      }
    }
  }

  /** Stable star field for the space theme (deterministic layout). */
  private initStars(theme: ThemeName): void {
    // CSS-px field (camera view = scale.width / displayScale).
    const z = this.scene.game.scale.displayScale.x || 1
    const width = this.scene.scale.width / z
    const height = this.scene.scale.height / z
    const rng = seeded(20260215)
    this.stars = []
    if (theme === 'space') {
      for (let i = 0; i < 90; i++) {
        const s = rng()
        this.stars.push({
          x: rng() * width,
          y: rng() * height,
          size: 1 + rng() * 2,
          twinkle: rng() * Math.PI * 2,
          glint: s > 0.94,
        })
      }
    }
  }

  /** Ambient particle field per theme (deterministic positions). */
  private initAmbient(theme: ThemeName): void {
    // CSS-px field (see initStars).
    const z = this.scene.game.scale.displayScale.x || 1
    const width = this.scene.scale.width / z
    const height = this.scene.scale.height / z
    const rng = seeded(theme === 'light' ? 20260251 : theme === 'space' ? 20260252 : theme === 'jungle' ? 20260253 : 20260254)
    this.ambient = []
    this.shoot = null
    this.nextShootAt = 1800 + rng() * 2200
    if (theme === 'light') {
      // Drifting pollen motes in the sun shafts.
      for (let i = 0; i < 10; i++) {
        this.ambient.push({
          x: width * (0.05 + rng() * 0.9),
          y: height * (0.1 + rng() * 0.75),
          s: 1 + rng() * 1.6,
          ph: rng() * Math.PI * 2,
          kind: 'mote',
        })
      }
    } else if (theme === 'space') {
      // Ambient is the shooting star (drawn procedurally); no particles.
    } else if (theme === 'jungle') {
      // Butterflies: two wing-flapping dots wandering near the edges.
      for (let i = 0; i < 3; i++) {
        this.ambient.push({
          x: width * (i === 1 ? 0.5 + rng() * 0.4 : rng() * 0.35),
          y: height * (0.18 + rng() * 0.6),
          s: 3.4 + rng() * 2,
          ph: rng() * Math.PI * 2,
          kind: 'butterfly',
        })
      }
    } else {
      // Fantasy: drifting magic motes (gold + violet).
      for (let i = 0; i < 12; i++) {
        this.ambient.push({
          x: width * (0.04 + rng() * 0.92),
          y: height * (0.12 + rng() * 0.8),
          s: 1.2 + rng() * 2,
          ph: rng() * Math.PI * 2,
          kind: 'magic',
        })
      }
    }
  }

  /** Build a theme's soft cloud layer (positions deterministic per theme). */
  private buildCloudGroup(theme: ThemeName): void {
    this.destroyCloudGroup(theme)
    // CSS-px placement (see initStars).
    const z = this.scene.game.scale.displayScale.x || 1
    const w = this.scene.scale.width / z
    const h = this.scene.scale.height / z
    const m = Math.min(w, h)
    const group: CloudObj[] = []

    if (theme === 'light') {
      // All clouds are baked into draw() — no extra layer.
    } else if (theme === 'space') {
      // Nebula banks: canvas-baked soft-gradient composites — every blob
      // clamped inside the texture and the whole bank vignetted to
      // transparent at its borders, so no layer can show a rectangular
      // boundary at any viewport size. Low alphas keep them atmospheric.
      const banks = [
        { x: 0.24, y: 0.22, tw: 0.6, seed: 20260261, alpha: 0.55 },
        { x: 0.68, y: 0.46, tw: 0.7, seed: 20260262, alpha: 0.5 },
        { x: 0.44, y: 0.7, tw: 0.54, seed: 20260263, alpha: 0.45 },
      ]
      for (const b of banks) {
        const texW = 900
        const texH = 520
        const key = ensureNebulaTexture(this.scene, 'br-nebula-' + b.seed, b.seed, texW, texH)
        const img = this.scene.add
          .image(w * b.x, h * b.y, key)
          .setDepth(-97)
          .setData('baseAlpha', b.alpha)
        img.setScale((w * b.tw) / texW, (w * b.tw * 0.62) / texH)
        img.setData('drift', 1.6 + (b.seed % 3) * 0.7)
        group.push(img)
      }
      // Horizon atmosphere glow above the planet curve.
      addCloud(this.scene, group, w * 0.5, h * 0.94, m * 0.34, m * 0.09, 0x3d5fb0, 0.2)
    } else if (theme === 'jungle') {
      // Waterfall mist puffs at the pool.
      addCloud(this.scene, group, w * 0.76, h * 0.82, m * 0.05, m * 0.02, 0xffffff, 0.42)
      addCloud(this.scene, group, w * 0.76, h * 0.795, m * 0.035, m * 0.016, 0xffffff, 0.3)
      // Humid haze in the sky.
      addCloud(this.scene, group, w * 0.28, h * 0.22, m * 0.14, m * 0.05, 0xdff2e4, 0.16)
    } else {
      // Fantasy: valley mist glows only (moon is baked in draw(); no big
      // halo layers).
      addCloud(this.scene, group, w * 0.3, h * 0.88, m * 0.22, m * 0.055, 0x9b7bff, 0.12)
      addCloud(this.scene, group, w * 0.72, h * 0.93, m * 0.19, m * 0.05, 0x7ee8ff, 0.09)
    }

    this.cloudGroups[theme] = group
  }

  private destroyCloudGroup(theme: ThemeName): void {
    const group = this.cloudGroups[theme]
    if (!group) return
    for (const obj of group) obj.destroy()
    delete this.cloudGroups[theme]
  }

  /** Rebuild every LIVE cloud layer for the current viewport size.
   * Phase 2.21: skips entirely when the CSS viewport is unchanged —
   * resize storms (Safari dynamic viewport) previously destroyed and
   * recreated every nebula Image per event (texture re-uploads + GC). */
  private rebuildClouds(): void {
    const z = this.scene.game.scale.displayScale.x || 1
    const w = Math.round(this.scene.scale.width / z)
    const h = Math.round(this.scene.scale.height / z)
    if (w === this.lastCloudsW && h === this.lastCloudsH) {
      this.applyCloudAlphas()
      return
    }
    this.lastCloudsW = w
    this.lastCloudsH = h
    const live: ThemeName[] = [this.currentTheme]
    if (this.fromTheme) live.push(this.fromTheme)
    if (this.toTheme) live.push(this.toTheme)
    for (const t of live) this.buildCloudGroup(t)
    this.applyCloudAlphas()
  }

  /** Last rebuild dimensions (CSS px) — cloud rebuild dedupe key. */
  private lastCloudsW = 0
  private lastCloudsH = 0

  /** Drive cloud layer alphas alongside the Graphics crossfade. */
  private applyCloudAlphas(): void {
    // Baked static art: active/target themes visible, others hidden.
    // During a crossfade both partners blend by transitionProgress; the
    // to-art sits ABOVE the from-art so the fade reads as a curtain
    // (same layering as the old bgLayer repaint path).
    for (const [name, img] of Object.entries(this.artImages)) {
      if (!img) continue
      const themeName = name as ThemeName
      let a: number
      if (this.toTheme) {
        if (themeName === this.toTheme) a = this.transitionProgress
        else if (themeName === this.fromTheme) a = 1
        else a = 0
      } else {
        a = themeName === this.currentTheme ? 1 : 0
      }
      img.setAlpha(a)
      img.setVisible(a > 0.005)
    }
    // GradImage alpha tracks the space weight of the active transition.
    if (this.gradImage) {
      let ga: number
      if (this.toTheme) {
        const fromSpace = this.fromTheme === 'space'
        const toSpace = this.toTheme === 'space'
        ga = fromSpace && toSpace ? 1 : fromSpace ? 1 - this.transitionProgress : toSpace ? this.transitionProgress : 0
      } else {
        ga = this.currentTheme === 'space' ? 1 : 0
      }
      this.gradImage.setAlpha(ga)
      this.gradImage.setVisible(ga > 0.005)
    }
    for (const [name, group] of Object.entries(this.cloudGroups)) {
      if (!group) continue
      const themeName = name as ThemeName
      let a: number
      if (this.toTheme) {
        if (themeName === this.toTheme) a = this.transitionProgress
        else if (themeName === this.fromTheme) a = 1 - this.transitionProgress
        else a = 0
      } else {
        a = themeName === this.currentTheme ? 1 : 0
      }
      for (const obj of group) {
        const go = obj as CloudObj & { setAlpha(v: number): unknown; setVisible(v: boolean): unknown }
        go.setAlpha((obj.getData('baseAlpha') as number) * a)
        go.setVisible(a > 0.005)
      }
    }
  }

  /**
   * Phase 2.23 — theme static art as device-res canvas bakes. Each theme's
   * full static draw (base fill + scenery) paints ONCE through the G2D
   * adapter onto a 'br-art-<theme>' texture shown on an Image at depth
   * -99. Crossfades become alpha blends of two baked Images — zero
   * Graphics command buffers anywhere in the background, so the silent
   * high-DPR phone render failure cannot recur, and transitions cost 4
   * alpha writes per frame instead of full Graphics rebuilds.
   */
  private bakeThemeArt(theme: ThemeName): void {
    const z = this.scene.game.scale.displayScale.x || 1
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // iOS canvas-pool cap
    const w = Math.ceil((this.scene.scale.width / z) * dpr)
    const h = Math.ceil((this.scene.scale.height / z) * dpr)
    const key = 'br-art-' + theme
    // FRESH-TEXTURE REBUILD (see updateGradImage): dims change ⇒ remove
    // the old texture + Image, recreate — never resize in place.
    const existing = this.scene.textures.exists(key)
      ? (this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement)
      : null
    if (existing && (existing.width !== w || existing.height !== h)) {
      this.scene.textures.remove(key)
      this.artImages[theme]?.destroy()
      delete this.artImages[theme]
    }
    if (!this.scene.textures.exists(key)) {
      this.scene.textures.createCanvas(key, w, h)
    }
    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture
    const src = tex.getSourceImage() as HTMLCanvasElement
    const ctx = src.getContext('2d')!
    const g = new G2D(ctx, w / dpr, h / dpr)
    g.clear()
    const def = THEMES[theme]
    const wCss = w / dpr
    const hCss = h / dpr
    def.draw(g, wCss, hCss, seeded(20260213))
    tex.refresh()
    if (!this.artImages[theme]) {
      this.artImages[theme] = this.scene.add
        .image(0, 0, key)
        .setOrigin(0, 0)
        .setDepth(-99)
    }
    this.artImages[theme]!.setDisplaySize(Math.ceil(w / dpr), Math.ceil(h / dpr))
  }

  /** Baked static art per theme (depth -99, screen-space). */
  private artImages: Partial<Record<ThemeName, Phaser.GameObjects.Image>> = {}

  private drawBackground(): void {
    // Bake every theme the current state shows, then drive visibility
    // through applyCloudAlphas (which also handles the art Images).
    const wanted: ThemeName[] = [this.currentTheme]
    if (this.fromTheme) wanted.push(this.fromTheme)
    if (this.toTheme) wanted.push(this.toTheme)
    for (const t of wanted) this.bakeThemeArt(t)
    this.applyCloudAlphas()
  }

  private drawGrid(): void {
    // Phase 2.21: the grid is baked into a device-resolution canvas
    // texture on an Image at depth -88 — ABOVE the nebula banks (-99)
    // which were occluding the Graphics-layer lines. Rebuilt on resize.
    const z = this.scene.game.scale.displayScale.x || 1
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // iOS canvas-pool cap
    const w = Math.ceil((this.scene.scale.width / z) * dpr)
    const h = Math.ceil((this.scene.scale.height / z) * dpr)

    const portraitBoost = window.innerWidth < window.innerHeight ? 2.6 : 1
    let color: number
    let alpha: number
    if (this.fromTheme && this.toTheme && this.transitionProgress > 0) {
      const from = THEMES[this.fromTheme]
      const to = THEMES[this.toTheme]
      const t2 = this.transitionProgress
      const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(from.gridColor),
        Phaser.Display.Color.IntegerToColor(to.gridColor),
        100,
        t2 * 100,
      )
      color = mixed.color
      alpha = Math.min(1, (from.gridAlpha + (to.gridAlpha - from.gridAlpha) * t2) * portraitBoost)
    } else {
      const def = THEMES[this.currentTheme]
      color = def.gridColor
      alpha = Math.min(1, def.gridAlpha * portraitBoost)
    }

    const key = 'br-grid'
    // FRESH-TEXTURE REBUILD (see updateGradImage): dims change ⇒ remove
    // the old texture + Image, recreate — never resize in place.
    const existingGrid = this.scene.textures.exists(key)
      ? (this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement)
      : null
    if (existingGrid && (existingGrid.width !== w || existingGrid.height !== h)) {
      this.scene.textures.remove(key)
      this.gridImage?.destroy()
      this.gridImage = null
    }
    if (!this.scene.textures.exists(key)) {
      this.scene.textures.createCanvas(key, w, h)
    }
    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture
    const src = tex.getSourceImage() as HTMLCanvasElement
    const ctx = src.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // PERF: the star texture is time-INDEPENDENT (fixed seed; the per-star
    // twinkle phases in this.stars are never read). It is baked once per
    // resize/theme change; update() drives visibility with starImage alpha.
    if (alpha > 0.01) {
      ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0')
      ctx.globalAlpha = alpha
      ctx.lineWidth = Math.max(1, Math.round(dpr))
      const cell = 42 * dpr
      ctx.beginPath()
      for (let x = 0; x <= w; x += cell) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
      }
      for (let y = 0; y <= h; y += cell) {
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    tex.refresh()

    if (!this.gridImage) {
      this.gridImage = this.scene.add
        .image(0, 0, key)
        .setOrigin(0, 0)
        .setDepth(-88)
    }
    // Device-px texture, LOGICAL display size (CSS px from the same z).
    this.gridImage.setDisplaySize(Math.ceil(this.scene.scale.width / z), Math.ceil(this.scene.scale.height / z))
    const spaceActive = (this.toTheme ?? this.currentTheme) === 'space'
    // The composite carries the grid — the standalone gridImage stays
    // hidden (it exists for the legacy non-composite path).
    this.gridImage.setVisible(false)
    void spaceActive
  }

  private drawStars(): void {
    // Phase 2.21: stars baked into a device-resolution canvas texture on
    // an Image (depth -95) — the old per-frame Graphics clear+repaint of
    // 120 circles silently failed to render on high-DPR phone viewports.
    // Baked once per resize/theme change; twinkle is a whole-layer alpha
    // pulse driven by update() (visually equivalent at these amplitudes).
    const z = this.scene.game.scale.displayScale.x || 1
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // iOS canvas-pool cap
    const w = Math.ceil((this.scene.scale.width / z) * dpr)
    const h = Math.ceil((this.scene.scale.height / z) * dpr)
    const alpha = Math.min(1, this.starAlpha)

    const key = 'br-stars'
    // FRESH-TEXTURE REBUILD (see updateGradImage): dims change ⇒ remove
    // the old texture + Image, recreate — never resize in place.
    const existingStars = this.scene.textures.exists(key)
      ? (this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement)
      : null
    if (existingStars && (existingStars.width !== w || existingStars.height !== h)) {
      this.scene.textures.remove(key)
      this.starImage?.destroy()
      this.starImage = null
    }
    if (!this.scene.textures.exists(key)) {
      this.scene.textures.createCanvas(key, w, h)
    }
    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture
    const src = tex.getSourceImage() as HTMLCanvasElement
    const ctx = src.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // PERF: the star texture is time-INDEPENDENT (fixed seed; the per-star
    // twinkle phases in this.stars are never read). It is baked once per
    // resize/theme change; update() drives visibility with starImage alpha.
    if (alpha > 0.01) {
      const bands = [
        { n: 80, r: [0.5, 1.0], a: [0.22, 0.5] },
        { n: 30, r: [0.9, 1.6], a: [0.35, 0.75] },
        { n: 10, r: [1.6 * this.artScale, 2.3 * this.artScale], a: [0.55, 0.9] },
      ]
      const rng = seeded(20260215)
      for (const b of bands) {
        for (let i = 0; i < b.n; i++) {
          const sx = rng() * w
          const sy = rng() * h * 0.94
          const r = (b.r[0]! + rng() * (b.r[1]! - b.r[0]!)) * dpr
          const a = b.a[0]! + rng() * (b.a[1]! - b.a[0]!)
          if (r > 1.5 * dpr * 0.8) {
            ctx.fillStyle = `rgba(191,216,255,${a * 0.07})`
            ctx.beginPath()
            ctx.arc(sx, sy, r * 3.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = `rgba(216,232,255,${a * 0.11})`
            ctx.beginPath()
            ctx.arc(sx, sy, r * 2.1, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = `rgba(255,255,255,${a})`
          ctx.beginPath()
          ctx.arc(sx, sy, r, 0, Math.PI * 2)
          ctx.fill()
          if (r > 2.0 * dpr * 0.8) {
            ctx.strokeStyle = `rgba(255,255,255,${a * 0.6})`
            ctx.lineWidth = 1.2 * dpr * 0.8
            ctx.beginPath()
            ctx.moveTo(sx - r * 2.3, sy)
            ctx.lineTo(sx + r * 2.3, sy)
            ctx.moveTo(sx, sy - r * 2.3)
            ctx.lineTo(sx, sy + r * 2.3)
            ctx.stroke()
          }
        }
      }
    }
    tex.refresh()

    if (!this.starImage) {
      this.starImage = this.scene.add
        .image(0, 0, key)
        .setOrigin(0, 0)
        .setDepth(-95)
    }
    // Device-px texture, LOGICAL display size. Visibility/alpha are owned
    // by update()'s starAlpha pulse.
    this.starImage.setDisplaySize(Math.ceil(w / dpr), Math.ceil(h / dpr))
    this.starImage.setVisible(alpha > 0.01)
    this.starImage.setAlpha(alpha)
  }

  /** Current portrait art scale (star sizing) — same inverse as the
   * space.draw planet/moon scale: bigger relative art on phones. */
  private get artScale(): number {
    const z = this.scene.game.scale.displayScale.x || 1
    return Math.min(3, 936 / Math.min(this.scene.scale.width / z, this.scene.scale.height / z))
  }

  private drawAmbient(delta: number): void {
    const theme = this.toTheme ?? this.currentTheme
    // PERF: in space the ambient layer holds only the occasional shooting
    // star (~1 s every 4-8 s). The old path cleared and re-tessellated the
    // (empty) Graphics buffer every frame regardless — skip entirely while
    // idle; the last streak frame stays on screen until the layer is
    // explicitly hidden here (it fades via s.life anyway).
    if (theme === 'space') {
      this.nextShootAt -= delta
      if (this.shoot) {
        this.shoot.life -= delta / 900
        if (this.shoot.life <= 0) this.shoot = null
      }
      if (!this.shoot && this.nextShootAt > 0) {
        if (this.ambientLayer.visible) {
          this.ambientLayer.clear()
          this.ambientLayer.setVisible(false)
        }
        return
      }
      const g = this.ambientLayer
      g.setVisible(true)
      g.clear()
      // CSS-px bounds (see initStars).
      const z = this.scene.game.scale.displayScale.x || 1
      const w = this.scene.scale.width / z
      const h = this.scene.scale.height / z

      if (!this.shoot && this.nextShootAt <= 0) {
        const sx = w * (0.25 + Math.random() * 0.6)
        this.shoot = { x: sx, y: h * (0.04 + Math.random() * 0.2), vx: -(w * 0.42), vy: h * 0.22, life: 1 }
        this.nextShootAt = 3800 + Math.random() * 4200
      }
      if (this.shoot) {
        const s = this.shoot
        s.x += s.vx * (delta / 1000)
        s.y += s.vy * (delta / 1000)
        const tailX = s.x - s.vx * 0.22
        const tailY = s.y - s.vy * 0.22
        g.lineStyle(2.2, 0xffffff, 0.85 * s.life)
        g.beginPath()
        g.moveTo(tailX, tailY)
        g.lineTo(s.x, s.y)
        g.strokePath()
        g.lineStyle(4.5, 0xbfd8ff, 0.25 * s.life)
        g.beginPath()
        g.moveTo(tailX, tailY)
        g.lineTo(s.x, s.y)
        g.strokePath()
        g.fillStyle(0xffffff, s.life)
        g.fillCircle(s.x, s.y, 2.2)
      }
      return
    }

    const g = this.ambientLayer
    g.clear()
    // CSS-px bounds (see initStars).
    const z = this.scene.game.scale.displayScale.x || 1
    const w = this.scene.scale.width / z
    const h = this.scene.scale.height / z
    const now = this.scene.time.now

    for (const p of this.ambient) {
      const t = now * 0.001 + p.ph
      if (p.kind === 'mote') {
        // Light pollen drifting up-right, slow sine bob.
        const dx = ((t * 6 + p.x) % (w + 40)) - 20
        const dy = p.y + Math.sin(t * 0.9 + p.x) * 10
        g.fillStyle(0xfff2c8, 0.5 + 0.3 * Math.sin(t * 2.1))
        g.fillCircle(dx, dy, p.s)
      } else if (p.kind === 'butterfly') {
        // Flapping wings: two arcs whose spread oscillates.
        const flap = Math.sin(t * 9) * 0.6 + 0.7
        const bx = p.x + Math.sin(t * 0.5) * w * 0.02
        const by = p.y + Math.cos(t * 0.37) * h * 0.012
        const col = p.s > 4.4 ? 0xff8a65 : 0xba68c8
        g.fillStyle(col, 0.9)
        g.fillEllipse(bx - p.s * 0.7 * flap, by, p.s * 1.15, p.s * 0.55)
        g.fillEllipse(bx + p.s * 0.7 * flap, by, p.s * 1.15, p.s * 0.55)
        g.fillStyle(0x3a2b1e, 0.9)
        g.fillEllipse(bx, by, p.s * 0.3, p.s * 0.85)
      } else {
        // Magic motes: gold/violet glow bobbing upward slowly.
        const dy = p.y - ((t * 9) % (h * 0.9))
        const dx = p.x + Math.sin(t * 0.7 + p.y) * 14
        const gold = (Math.floor(p.x) % 2) === 0
        const col = gold ? 0xffd98a : 0xc78bff
        const a = 0.35 + 0.35 * Math.sin(t * 2.2 + p.x)
        g.fillStyle(col, a * 0.35)
        g.fillCircle(dx, dy, p.s * 2.4)
        g.fillStyle(col, a)
        g.fillCircle(dx, dy, p.s)
      }
    }
  }

  /** Per-frame star pulse + cloud drift + ambient layer. */
  update(delta: number): void {
    // Correctness net: if a resize left unbaked dims (debounce pending or
    // timer frozen by a hidden tab), rebuild NOW — the background must
    // never stay stale relative to the viewport.
    if (this.pendingW !== 0 || this.pendingH !== 0 || this.pendingDpr !== 0) {
      this.updateGradImage()
      this.drawBackground()
      this.drawGrid()
      this.initStars(this.currentTheme)
      this.initAmbient(this.currentTheme)
      this.rebuildClouds()
      this.drawStars()
      this.pendingW = 0
      this.pendingH = 0
      this.pendingDpr = 0
    }
    const fromSpace = this.currentTheme === 'space'
    const toSpace = this.toTheme === 'space'
    if (this.toTheme) {
      this.starAlpha = fromSpace && toSpace ? 1 : fromSpace ? 1 - this.transitionProgress : toSpace ? this.transitionProgress : 0
    } else {
      this.starAlpha = fromSpace ? 1 : 0
    }
    // Star twinkle: whole-layer alpha pulse on the baked texture — the old
    // 20 Hz drawStars() re-baked IDENTICAL pixels (fixed seed, no
    // time-dependent input) = clearRect + 120 arcs + tex.refresh() on the
    // full 1170x2532 canvas => ~11.8 MB texImage2D 20x/s (~236 MB/s) for
    // zero visual change. A setAlpha is a free uniform write.
    if (this.starImage) {
      this.starImage.setAlpha(Math.min(1, this.starAlpha))
      this.starImage.setVisible(this.starAlpha > 0.01)
    }
    this.drawAmbient(delta)
    // Slow parallax drift on the cloud blobs (Images only).
    const z = this.scene.game.scale.displayScale.x || 1
    const w = this.scene.scale.width / z
    for (const group of Object.values(this.cloudGroups)) {
      if (!group) continue
      for (const obj of group) {
        const img = obj as Phaser.GameObjects.Image
        if (img.type !== 'Image') continue
        const drift = img.getData('drift') as number | undefined
        if (!drift) continue
        img.x += drift * (delta / 1000)
        if (img.x - img.displayWidth / 2 > w) img.x = -img.displayWidth / 2
      }
    }
  }

  destroy(): void {
    this.resizeTimer?.remove()
    this.resizeTimer = undefined
    this.transitionTween?.stop()
    for (const img of Object.values(this.artImages)) img?.destroy()
    this.artImages = {}
    this.starImage?.destroy()
    this.ambientLayer?.destroy()
    for (const name of Object.keys(this.cloudGroups) as ThemeName[]) this.destroyCloudGroup(name)
  }
}
