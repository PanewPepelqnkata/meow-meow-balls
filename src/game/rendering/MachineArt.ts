import type Phaser from 'phaser'

/**
 * ============================================================================
 * MACHINE ART — the gumball vending machine as PURE DATA + pure functions.
 * ============================================================================
 *
 * Single source for the self-drawing START INTRO machine (StartIntroScene's
 * machine phase). The menu's baked machine (TitleScene.buildMachine) stays
 * untouched; the geometry here is derived EXACTLY from its unit-space design
 * (100 × 130 units, origin top-left of the machine box) so the intro machine
 * reads as the SAME machine the menu just showed:
 *
 *   - circles       → 72-segment polylines (closed)
 *   - quadratic arcs→ 16-segment polylines (control point sampled)
 *   - rounded rects → 24-segment polylines (6 per corner arc + edges)
 *   - ellipse arcs (sheens) → sampled polylines (open)
 *   - stars/sparkles→ point polylines (closed)
 *
 * Everything is pure and headless-testable: no Phaser import at runtime
 * (type-only), no scene, no timing — `strokeProgressive` takes a Graphics
 * object only through its minimal `strokePoints` surface, mirroring
 * BallAppearance's Phaser-typings-only pattern.
 */

/** One sampled polyline in UNIT space (machine box 100 × 130). */
export interface UnitPath {
  /** Ordered points; open paths stroke start→end, closed paths repeat
   * their first point at the end so a closed shape draws as one loop. */
  pts: Array<{ x: number; y: number }>
  /** `true` = closed loop (first point re-appended at the end). */
  closed: boolean
  /** Fraction-of-total-length weight (all 1 by default; the helper sums
   * every path's length — weight is just a scale knob for odd shapes). */
  weight?: number
}

/** Sample a canvas quadratic curve as a polyline (t 0→1, `n` segments). */
function quad(
  p0: { x: number; y: number },
  c: { x: number; y: number },
  p1: { x: number; y: number },
  n = 16,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    pts.push({
      x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
    })
  }
  return pts
}

/** Sample a full circle as a closed polyline (`n` segments). */
function circlePts(
  cx: number,
  cy: number,
  r: number,
  n = 72,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

/** Sample an ellipse ARC (open polyline) — the glass sheens. */
function arcPts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  n = 20,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
  }
  return pts
}

/** Rounded-rect polyline (titleCase `rrPath` shape, arcs sampled at 6
 * segments per corner). `r` may be a number (all corners) or [tl,tr,br,bl]. */
function rrPts(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
  closed = true,
): Array<{ x: number; y: number }> {
  const radii = typeof r === 'number' ? [r, r, r, r] : [...r]
  const [tl, tr, br, bl] = radii as [number, number, number, number]
  const pts: Array<{ x: number; y: number }> = [{ x: x + tl, y }]
  // top edge → top-right corner
  pts.push({ x: x + w - tr, y })
  for (let i = 1; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 0.5
    pts.push({ x: x + w - tr + Math.cos(a) * tr, y: y + tr + Math.sin(a) * tr })
  }
  // right edge → bottom-right corner
  pts.push({ x: x + w, y: y + h - br })
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 0.5
    pts.push({ x: x + w - br + Math.cos(a) * br, y: y + h - br + Math.sin(a) * br })
  }
  // bottom edge → bottom-left corner
  pts.push({ x: x + bl, y: y + h })
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI * 0.5
    pts.push({ x: x + bl + Math.cos(a) * bl, y: y + h - bl + Math.sin(a) * bl })
  }
  // left edge → top-left corner
  pts.push({ x, y: y + tl })
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI + (i / 6) * Math.PI * 0.5
    pts.push({ x: x + tl + Math.cos(a) * tl, y: y + tl + Math.sin(a) * tl })
  }
  if (closed) pts.push({ ...pts[0]! })
  return pts
}

/** Five-point star polyline (TitleScene.starPath shape: outer r, inner 0.45r). */
function starPts(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? r : r * 0.45
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad })
  }
  pts.push({ ...pts[0]! })
  return pts
}

/** Four-point sparkle (TitleScene sparkle(): 8 vertices, outer s, inner 0.28s). */
function sparklePts(cx: number, cy: number, s: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4
    const rad = i % 2 === 0 ? s : s * 0.28
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad })
  }
  pts.push({ ...pts[0]! })
  return pts
}

// ---------------------------------------------------------------------------
// THE PATHS — exact unit-space coordinates from the menu machine.
// ---------------------------------------------------------------------------

/** Machine body / glass / trim outlines, in DRAW-ON ORDER (the order the
 * intro strokes them; the fill layer indexes the same groups). */
export const MACHINE_UNIT_PATHS: Record<string, UnitPath> = {
  /** Ground shadow ellipse (outline only; the soft fill comes separately). */
  shadow: { pts: arcPts(50, 126, 30, 5, 0, Math.PI * 2, 36).slice(0, -1) as UnitPath['pts'], closed: true },
  /** Dispenser base body + its darker bottom band share this rounded outline. */
  base: {
    pts: [
      { x: 35, y: 68 },
      { x: 65, y: 68 },
      { x: 76, y: 114 },
      ...quad({ x: 76, y: 114 }, { x: 78, y: 122 }, { x: 70, y: 122 }).slice(1),
      { x: 30, y: 122 },
      ...quad({ x: 30, y: 122 }, { x: 22, y: 122 }, { x: 24, y: 114 }).slice(1),
      { x: 35, y: 68 },
    ],
    closed: false,
  },
  /** Bottom band top edge (cheek to cheek across the base). */
  band: {
    pts: [{ x: 26, y: 108 }, { x: 74, y: 108 }],
    closed: false,
  },
  /** Red collar between globe and base. */
  collar: {
    pts: [{ x: 39, y: 60 }, { x: 61, y: 60 }, { x: 65, y: 70 }, { x: 35, y: 70 }, { x: 39, y: 60 }],
    closed: false,
  },
  /** Glass rim — the thick circle (menu radius 30.25). */
  glass: { pts: circlePts(50, 33, 30.25), closed: false },
  /** Chute: sides + rounded bottom (matches the menu's stroked chute path). */
  chute: {
    pts: [
      { x: 38, y: 101 },
      { x: 38, y: 110 },
      ...quad({ x: 38, y: 110 }, { x: 38, y: 116 }, { x: 44, y: 116 }).slice(1),
      { x: 56, y: 116 },
      ...quad({ x: 56, y: 116 }, { x: 62, y: 116 }, { x: 62, y: 110 }).slice(1),
      { x: 62, y: 101 },
    ],
    closed: false,
  },
  /** Chute flap (cream door) + its handle bar. */
  flap: { pts: rrPts(40, 106, 20, 8, 2), closed: false },
  flapHandle: { pts: [{ x: 46, y: 110 }, { x: 54, y: 110 }], closed: false },
  /** Coin slot. */
  coinSlot: { pts: rrPts(62.5, 78, 4.5, 14, 2.2), closed: false },
  /** Knob: outer + inner ring. */
  knob: { pts: circlePts(37, 85, 5, 48), closed: false },
  knobInner: { pts: circlePts(37, 85, 2.2, 32), closed: false },
  /** Feet (two rounded stubs under the base). */
  footL: { pts: rrPts(23, 122, 11, 5, 2), closed: false },
  footR: { pts: rrPts(66, 122, 11, 5, 2), closed: false },
  /** Glass sheens — three arcs on the globe center. */
  sheen1: {
    pts: arcPts(50, 33, 25, 25, Math.PI * 1.02, Math.PI * 1.32),
    closed: false,
  },
  sheen2: {
    pts: arcPts(50, 33, 21.5, 21.5, Math.PI * 1.08, Math.PI * 1.22),
    closed: false,
  },
  sheen3: {
    pts: arcPts(50, 33, 26, 26, Math.PI * 0.28, Math.PI * 0.4),
    closed: false,
  },
  /** Cream pinstripe where collar meets base. */
  pinstripe: { pts: [{ x: 33.8, y: 73 }, { x: 66.2, y: 73 }], closed: false },
  /** Star sticker on the base's left cheek. */
  sticker: { pts: starPts(31.5, 96, 2.8), closed: true },
  /** Glass sparkles: two four-point stars. */
  sparkle1: { pts: sparklePts(66, 17, 3.2), closed: true },
  sparkle2: { pts: sparklePts(31, 13, 2), closed: true },
}

/** Draw-on order for the progressive stroke: big silhouettes first, details
 * and glints last. Bulbs are NOT polylines — they flash in with color at
 * the very end (see MACHINE_BULBS). */
export const MACHINE_DRAW_ORDER: readonly string[] = [
  'shadow',
  'base',
  'band',
  'collar',
  'glass',
  'chute',
  'flap',
  'flapHandle',
  'coinSlot',
  'knob',
  'knobInner',
  'footL',
  'footR',
  'pinstripe',
  'sheen1',
  'sheen2',
  'sheen3',
  'sticker',
  'sparkle1',
  'sparkle2',
]

/** The five marquee bulbs across the collar — unit center, radius, color. */
export const MACHINE_BULBS: ReadonlyArray<{ x: number; y: number; r: number; color: number }> = [
  { x: 41, y: 65, r: 1.7, color: 0xffd93b },
  { x: 45.5, y: 65, r: 1.7, color: 0x4fc3f7 },
  { x: 50, y: 65, r: 1.7, color: 0xff8a3d },
  { x: 54.5, y: 65, r: 1.7, color: 0xa98bd8 },
  { x: 59, y: 65, r: 1.7, color: 0x43d64f },
]

/** FILL spec per part group (unit-space shapes + colors), consumed by
 * `drawMachineFills`. `pinstripe`/`sheens`/`sparkles` are strokes only in
 * the menu too — they carry no fill here. */
export interface MachineFillSpec {
  /** Layer paint order (back → front), matching TitleScene's back bake. */
  key: string
  alpha: number
  draw: (ctx: { fillCircle: (x: number, y: number, r: number) => void; fillEllipse: (x: number, y: number, w: number, h: number) => void; fillPoints: (pts: Array<{ x: number; y: number }>, close?: boolean) => void; fillPath: (pts: Array<{ x: number; y: number }>, closePath?: boolean) => void }) => void
}

/** Minimal Phaser-Graphics-shaped interface `strokeProgressive` needs —
 * lets tests exercise the helper with a stub. */
export interface ProgressiveStroker {
  lineStyle(width: number, color: number, alpha?: number): unknown
  strokePoints(
    points: Array<{ x: number; y: number }>,
    closeShape?: boolean,
    closePath?: boolean,
  ): unknown
}

/** Cumulative length of one path (unit space). */
export function pathLength(p: UnitPath): number {
  let len = 0
  for (let i = 1; i < p.pts.length; i++) {
    len += Math.hypot(p.pts[i]!.x - p.pts[i - 1]!.x, p.pts[i]!.y - p.pts[i - 1]!.y)
  }
  return len * (p.weight ?? 1)
}

/** Total draw-on length across the given path keys (unit space). */
export function totalDrawLength(keys: readonly string[], paths: Record<string, UnitPath>): number {
  return keys.reduce((sum, k) => sum + pathLength(paths[k] ?? { pts: [], closed: false }), 0)
}

/**
 * Stroke `paths` progressively: `drawnLen` unit-space length is laid out
 * over `keys` in order; each path is stroked only up to its share.
 * The canvas stroke is drawn in UNIT space and the caller scales the
 * Graphics by `u` (one `setScale(u)`), so line widths are specified in
 * unit space too (`width` in units) — the scale applies to stroke width.
 */
export function strokeProgressive(
  g: ProgressiveStroker,
  paths: Record<string, UnitPath>,
  keys: readonly string[],
  drawnLen: number,
  color: number,
  width: number,
  alpha = 1,
): void {
  let budget = drawnLen
  for (const k of keys) {
    const p = paths[k]
    if (!p) continue
    const total = pathLength(p)
    const w = (p.weight ?? 1) * width
    if (budget <= 0) break
    const shown = Math.min(total, budget)
    budget -= shown
    // Walk segments accumulating length; stroke the reached prefix.
    const pts: Array<{ x: number; y: number }> = [p.pts[0]!]
    let acc = 0
    for (let i = 1; i < p.pts.length; i++) {
      acc += Math.hypot(p.pts[i]!.x - p.pts[i - 1]!.x, p.pts[i]!.y - p.pts[i - 1]!.y) * (p.weight ?? 1)
      if (acc >= shown) {
        // Lerp the final point to land exactly on `shown`.
        const over = acc - shown
        const seg = Math.hypot(p.pts[i]!.x - p.pts[i - 1]!.x, p.pts[i]!.y - p.pts[i - 1]!.y)
        const f = seg > 0 ? Math.max(0, 1 - over / (seg * (p.weight ?? 1))) : 1
        pts.push({
          x: p.pts[i - 1]!.x + (p.pts[i]!.x - p.pts[i - 1]!.x) * f,
          y: p.pts[i - 1]!.y + (p.pts[i]!.y - p.pts[i - 1]!.y) * f,
        })
        break
      }
      pts.push(p.pts[i]!)
    }
    g.lineStyle(w, color, alpha)
    g.strokePoints(pts, false, false)
  }
}

/**
 * Fill layer painter: draws the machine's fills at unit space with the
 * given per-group alphas (0 = skip). One `alphaMap` entry covers a whole
 * part group; groups fill in as their outline completes.
 *
 * Phaser's Graphics typings demand Vector2[] but the renderer only reads
 * .x/.y at runtime — cast via `asPoints` (BallAppearance's pattern).
 */
export function drawMachineFills(
  g: Phaser.GameObjects.Graphics,
  u: number,
  alphaMap?: Record<string, number>,
): void {
  const asPoints = (pts: Array<{ x: number; y: number }>): Phaser.Math.Vector2[] =>
    pts as unknown as Phaser.Math.Vector2[]
  const a = (k: string): number => alphaMap?.[k] ?? 0
  const X = (v: number): number => v * u
  // Layer order back → front (same as the menu's back bake).
  // Ground shadow (soft ellipse).
  if (a('shadow') > 0) {
    g.fillStyle(0x000000, 0.35 * a('shadow'))
    g.fillEllipse(X(50), X(126), X(60), X(10))
  }
  // Glass interior + pile shading.
  if (a('glass') > 0) {
    g.fillStyle(0xffffff, 0.07 * a('glass'))
    g.fillCircle(X(50), X(33), X(30))
    g.fillStyle(0x000000, 0.1 * a('glass'))
    g.fillEllipse(X(50), X(52), X(46), X(20))
  }
  // Collar.
  if (a('collar') > 0) {
    g.fillStyle(0xe23b3b, a('collar'))
    g.fillPoints(
      asPoints([{ x: 39, y: 60 }, { x: 61, y: 60 }, { x: 65, y: 70 }, { x: 35, y: 70 }].map((p) => ({
        x: X(p.x),
        y: X(p.y),
      }))),
      true,
    )
  }
  // Base body.
  if (a('base') > 0) {
    g.fillStyle(0xe23b3b, a('base'))
    g.fillPoints(
      asPoints(
        [
          { x: 35, y: 68 },
          { x: 65, y: 68 },
          { x: 76, y: 114 },
          ...quad({ x: 76, y: 114 }, { x: 78, y: 122 }, { x: 70, y: 122 }).slice(1),
          { x: 30, y: 122 },
          ...quad({ x: 30, y: 122 }, { x: 22, y: 122 }, { x: 24, y: 114 }).slice(1),
        ].map((p) => ({ x: X(p.x), y: X(p.y) })),
      ),
      true,
    )
    // Darker bottom band.
    g.fillStyle(0xb32626, a('base'))
    g.fillPoints(
      asPoints(
        [
          { x: 74, y: 108 },
          { x: 76, y: 114 },
          ...quad({ x: 76, y: 114 }, { x: 78, y: 122 }, { x: 70, y: 122 }).slice(1),
          { x: 30, y: 122 },
          ...quad({ x: 30, y: 122 }, { x: 22, y: 122 }, { x: 24, y: 114 }).slice(1),
          { x: 26, y: 108 },
        ].map((p) => ({ x: X(p.x), y: X(p.y) })),
      ),
      true,
    )
  }
  // Chute (dark) + flap (cream).
  if (a('chute') > 0) {
    g.fillStyle(0x191919, a('chute'))
    g.fillPoints(asPoints(rrPts(38, 101, 24, 15, [1, 1, 5, 5]).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
    g.fillStyle(0xf2eee2, a('chute'))
    g.fillPoints(asPoints(rrPts(40, 106, 20, 8, 2).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
  }
  // Coin slot.
  if (a('coinSlot') > 0) {
    g.fillStyle(0x191919, a('coinSlot'))
    g.fillPoints(asPoints(rrPts(63.5, 78, 4.5, 14, 2.2).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
  }
  // Knob.
  if (a('knob') > 0) {
    g.fillStyle(0xe23b3b, a('knob'))
    g.fillCircle(X(37), X(85), X(5))
  }
  // Feet.
  if (a('feet') > 0) {
    g.fillStyle(0xb32626, a('feet'))
    g.fillPoints(asPoints(rrPts(23, 122, 11, 5, 2).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
    g.fillPoints(asPoints(rrPts(66, 122, 11, 5, 2).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
  }
  // Sticker.
  if (a('sticker') > 0) {
    g.fillStyle(0xffe08a, a('sticker'))
    g.fillPoints(asPoints(starPts(31.5, 96, 2.8).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
  }
  // Sparkles (white glints on the glass).
  if (a('sparkle') > 0) {
    g.fillStyle(0xffffff, 0.5 * a('sparkle'))
    g.fillPoints(asPoints(sparklePts(66, 17, 3.2).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
    g.fillStyle(0xffffff, 0.42 * a('sparkle'))
    g.fillPoints(asPoints(sparklePts(31, 13, 2).map((p) => ({ x: X(p.x), y: X(p.y) }))), true)
  }
  // Marquee bulbs — flash in with their candy colors at the very end.
  if (a('bulbs') > 0) {
    MACHINE_BULBS.forEach((b) => {
      g.fillStyle(b.color, a('bulbs'))
      g.fillCircle(X(b.x), X(b.y), X(b.r))
    })
  }
}
