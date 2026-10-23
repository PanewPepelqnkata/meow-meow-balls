/**
 * THE COLLECTIBLE CARD'S FINISH — the holographic sheen, the paper gloss
 * and the rarity flourish.
 *
 * A collectible card is not just printed paper: it has a FOIL finish — a
 * rainbow sheen that sweeps across the surface — and a soft GLOSS, the
 * broad highlight of light on the paper itself.
 *
 * This module is the finish's GEOMETRY and nothing else: pure maths over
 * plain points, with NO Phaser runtime import, so it can be unit-tested
 * headlessly (the repo's test runner cannot boot Phaser). The overlay
 * feeds the result to Graphics layers.
 *
 * THE STYLE: hand-drawn comic, so nothing here is a hard photoreal
 * gradient. The sheen is a band of many soft, flat colour slices that
 * fade out at their edges, and everything is CLIPPED to the card's own
 * rounded outline — a real foil never spills off the card, and a band
 * that spilled onto the dark background would stop reading as foil.
 *
 * THE BLEND (this matters, and it is why the finish is split in two):
 *
 * - The RAINBOW band is drawn NORMALLY. The card's paper is a warm cream
 *   (0xfff3d6 — almost white), and ADDING a colour to near-white simply
 *   clips back to white: the foil would be invisible. A tinted band over
 *   cream is what actually reads as a rainbow.
 * - The SPECULAR streak is drawn ADDITIVELY, on its own layer. It rides
 *   on the rainbow band's leading edge, and adding white to a saturated
 *   band blows it out to a hot glint — which is exactly how a foil
 *   catches the light.
 */

/** A point in 2D. */
export interface Vec2 {
  x: number
  y: number
}

/** A card's outline, in the drawing's own (panel-relative) coordinates. */
export interface CardRect {
  x: number
  y: number
  w: number
  h: number
  /** The corner radius. */
  r: number
}

/** One flat, soft-edged piece of the finish. */
export interface FinishSlice {
  /** The polygon's points — already clipped to the card. */
  points: Vec2[]
  /** The colour (0xRRGGBB). */
  color: number
  /** The opacity, 0..1. */
  alpha: number
}

/** A twinkling four-point sparkle — the game's own sparkle shape. */
export interface FinishSparkle {
  points: Vec2[]
  color: number
  alpha: number
  /** The sparkle's centre (the white core dot sits here). */
  cx: number
  cy: number
  /** The radius of the white core dot. */
  coreR: number
  /** The sparkle's own twinkle phase, in turns (0..1) — so the sparkles
   * pulse in and out of step with each other. */
  twinkle: number
}

/** The band of moving foil. */
export interface CardSheen {
  /** The rainbow band — drawn normally, over the card's paper. */
  band: FinishSlice[]
  /** The hot specular streak on the band's leading edge — drawn
   * ADDITIVELY, so it blows out to white over the band. */
  specular: FinishSlice[]
}

/** The band's angle: steep, running up to the right (like a tilted card). */
const SHINE_ANGLE = -1.02
/** The gloss's angle: shallower, so the two highlights never sit on top of
 * each other. */
const GLOSS_ANGLE = -0.66
/** How many bold colour stripes the rainbow band is cut into. */
const SHINE_STRIPES = 6
/** The rainbow's hue spread across the band, in turns — nearly a full
 * spectrum, so the band reads as a RAINBOW and not as a yellow wash. */
const HUE_SPREAD = 0.92
/** The band is this wide, as a fraction of the card's width. */
const BAND_WIDTH_FRACTION = 0.44
/** The rainbow starts at this hue (turns). */
const HUE_BASE = 0.02
/** The finish is inset from the card's edge by the ink frame's half-width,
 * so the foil never washes the frame's ink. */
const FRAME_INSET = 4

// ----------------------------------------------------------------------
// COLOUR
// ----------------------------------------------------------------------

/** Mix two 0xRRGGBB colours. `t` = 0 keeps `a`, 1 keeps `b`. */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const r = Math.round(ar + (br - ar) * k)
  const g = Math.round(ag + (bg - ag) * k)
  const bl = Math.round(ab + (bb - ab) * k)
  return (r << 16) | (g << 8) | bl
}

/**
 * A colour from a hue (in turns, 0..1), a saturation and a lightness.
 * The game's own little HSL helper — the finish must not pull Phaser
 * into a headless-testable module.
 */
export function hueColor(hue: number, sat: number, light: number): number {
  const h = ((hue % 1) + 1) % 1
  const s = Math.max(0, Math.min(1, sat))
  const l = Math.max(0, Math.min(1, light))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h * 6
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const [r, g, b] = rgb
  const m = l - c / 2
  const to = (v: number): number => Math.max(0, Math.min(255, Math.round((v + m) * 255)))
  return (to(r) << 16) | (to(g) << 8) | to(b)
}

/**
 * Tint a colour with the ball's own colour, WITHOUT destroying its hue.
 *
 * A plain RGB mix towards the tier colour pulls EVERY hue towards it —
 * an orange ball turned a whole rainbow into a yellow wash. Multiplying
 * by a NORMALISED tint (the tier colour scaled so its brightest channel
 * is full) keeps the rainbow's relationships: an orange ball's foil is
 * warm, a violet ball's foil is cool, and both are still rainbows.
 *
 * `strength` is 0 (no tint) to 1 (the full tier colour).
 */
export function tintHuePreserving(color: number, tierColor: number, strength: number): number {
  const k = Math.max(0, Math.min(1, strength))
  const tr = (tierColor >> 16) & 0xff
  const tg = (tierColor >> 8) & 0xff
  const tb = tierColor & 0xff
  const peak = Math.max(tr, tg, tb, 1)
  // The tint, pulled back towards white so it is a SHADE, not a repaint.
  const fr = 1 - k * (1 - tr / peak)
  const fg = 1 - k * (1 - tg / peak)
  const fb = 1 - k * (1 - tb / peak)
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * fr)))
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * fg)))
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * fb)))
  return (r << 16) | (g << 8) | b
}

// ----------------------------------------------------------------------
// GEOMETRY
// ----------------------------------------------------------------------

/** The signed area of a polygon (positive = counter-clockwise). */
function signedArea(poly: Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Which side of the line a→b the point p is on (positive = left). */
function side(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/** Where the segment p→q crosses the line a→b. */
function lineIntersect(a: Vec2, b: Vec2, p: Vec2, q: Vec2): Vec2 {
  const d1 = side(a, b, p)
  const d2 = side(a, b, q)
  const denom = d1 - d2
  const t = denom === 0 ? 0 : d1 / denom
  return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }
}

/**
 * The card's outline as a CONVEX polygon (the rounded corners are
 * approximated with a few straight segments each).
 *
 * The polygon is what the finish is clipped against, so it has to be
 * convex — the clipping below is a Sutherland–Hodgman pass, which needs
 * a convex clip region.
 */
export function roundedRectPolygon(rect: CardRect, segments = 5): Vec2[] {
  const { x, y, w, h } = rect
  const rr = Math.max(0, Math.min(rect.r, Math.min(w, h) / 2))
  const pts: Vec2[] = []
  const push = (px: number, py: number): void => {
    const last = pts[pts.length - 1]
    // No duplicate points: a zero-length edge would break the clipping.
    if (last && Math.abs(last.x - px) < 1e-6 && Math.abs(last.y - py) < 1e-6) return
    pts.push({ x: px, y: py })
  }
  if (rr <= 0) {
    push(x, y)
    push(x + w, y)
    push(x + w, y + h)
    push(x, y + h)
    return pts
  }
  const corners = [
    { cx: x + rr, cy: y + rr, a0: Math.PI, a1: 1.5 * Math.PI },
    { cx: x + w - rr, cy: y + rr, a0: 1.5 * Math.PI, a1: 2 * Math.PI },
    { cx: x + w - rr, cy: y + h - rr, a0: 0, a1: 0.5 * Math.PI },
    { cx: x + rr, cy: y + h - rr, a0: 0.5 * Math.PI, a1: Math.PI },
  ]
  for (const corner of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = corner.a0 + (corner.a1 - corner.a0) * (i / segments)
      push(corner.cx + Math.cos(a) * rr, corner.cy + Math.sin(a) * rr)
    }
  }
  return pts
}

/**
 * Clip a subject polygon against a CONVEX clip polygon
 * (Sutherland–Hodgman). This is what keeps the foil on the card.
 */
export function clipPolygon(subject: Vec2[], clip: Vec2[]): Vec2[] {
  if (subject.length < 3 || clip.length < 3) return []
  const c = signedArea(clip) < 0 ? clip.slice().reverse() : clip
  let output = subject.slice()
  for (let i = 0; i < c.length; i++) {
    if (output.length === 0) return []
    const a = c[i]!
    const b = c[(i + 1) % c.length]!
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!
      const q = input[(j + 1) % input.length]!
      const pIn = side(a, b, p) >= 0
      const qIn = side(a, b, q) >= 0
      if (pIn) output.push(p)
      if (pIn !== qIn) output.push(lineIntersect(a, b, p, q))
    }
  }
  return output
}

/**
 * A "leaf" — a lens shape between two points, bulging in the middle.
 * This is the game's comic-book shape for a highlight: soft, drawn, and
 * tapered at both ends (a hard rectangle would read as a UI panel).
 */
export function leafPolygon(p0: Vec2, p1: Vec2, bulge: number, steps = 18): Vec2[] {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const pts: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const off = Math.sin(Math.PI * t) * bulge
    pts.push({ x: p0.x + dx * t + px * off, y: p0.y + dy * t + py * off })
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps
    const off = -Math.sin(Math.PI * t) * bulge
    pts.push({ x: p0.x + dx * t + px * off, y: p0.y + dy * t + py * off })
  }
  return pts
}

/** The band's soft profile: 1 at the middle, 0 at the edges. */
function bandProfile(u: number): number {
  const k = Math.max(0, 1 - u * u)
  return k * k * (0.35 + 0.65 * k)
}

/** The finish's clip region — the card, inset past the ink frame. */
function clipRect(rect: CardRect): CardRect {
  const inset = Math.min(FRAME_INSET, Math.min(rect.w, rect.h) / 4)
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    w: Math.max(1, rect.w - inset * 2),
    h: Math.max(1, rect.h - inset * 2),
    r: Math.max(0, rect.r - inset),
  }
}

/** The band's axis frame: the long axis `d` and its normal `n`. */
function axisFrame(angle: number): { d: Vec2; n: Vec2 } {
  return {
    d: { x: Math.cos(angle), y: Math.sin(angle) },
    n: { x: -Math.sin(angle), y: Math.cos(angle) },
  }
}

/** How far the band must reach along its axis to cover the card. */
function reachFor(poly: Vec2[], centre: Vec2, d: Vec2): number {
  let reach = 0
  for (const p of poly) {
    const along = Math.abs((p.x - centre.x) * d.x + (p.y - centre.y) * d.y)
    if (along > reach) reach = along
  }
  return reach + 2
}

/** How far the band must travel along its normal to clear the card. */
function travelFor(poly: Vec2[], centre: Vec2, n: Vec2): number {
  let travel = 0
  for (const p of poly) {
    const across = Math.abs((p.x - centre.x) * n.x + (p.y - centre.y) * n.y)
    if (across > travel) travel = across
  }
  return travel
}

/**
 * A band of flat colour slices, clipped to the card.
 *
 * `offset` is the band's centre along the normal (in px); `halfWidth` is
 * the band's half-width; `hueFrom`/`hueTo` are the band's hue at its two
 * edges; `alpha` is the band's peak opacity.
 */
function bandSlices(o: {
  clip: Vec2[]
  centre: Vec2
  d: Vec2
  n: Vec2
  offset: number
  halfWidth: number
  reach: number
  slices: number
  hueFrom: number
  hueTo: number
  sat: number
  light: number
  tierColor: number
  tierMix: number
  alpha: number
  profile?: (u: number) => number
}): FinishSlice[] {
  const out: FinishSlice[] = []
  const count = Math.max(1, Math.round(o.slices))
  const profile = o.profile ?? bandProfile
  for (let i = 0; i < count; i++) {
    const u0 = -1 + (2 * i) / count
    const u1 = -1 + (2 * (i + 1)) / count
    const um = (u0 + u1) / 2
    const o0 = o.offset + u0 * o.halfWidth
    const o1 = o.offset + u1 * o.halfWidth
    const quad: Vec2[] = [
      { x: o.centre.x + o.n.x * o0 - o.d.x * o.reach, y: o.centre.y + o.n.y * o0 - o.d.y * o.reach },
      { x: o.centre.x + o.n.x * o0 + o.d.x * o.reach, y: o.centre.y + o.n.y * o0 + o.d.y * o.reach },
      { x: o.centre.x + o.n.x * o1 + o.d.x * o.reach, y: o.centre.y + o.n.y * o1 + o.d.y * o.reach },
      { x: o.centre.x + o.n.x * o1 - o.d.x * o.reach, y: o.centre.y + o.n.y * o1 - o.d.y * o.reach },
    ]
    const points = clipPolygon(quad, o.clip)
    if (points.length < 3) continue
    const hue = o.hueFrom + (o.hueTo - o.hueFrom) * ((um + 1) / 2)
    const rainbow = hueColor(hue, o.sat, o.light)
    const color = tintHuePreserving(rainbow, o.tierColor, o.tierMix)
    const alpha = o.alpha * profile(um)
    if (alpha <= 0.002) continue
    out.push({ points, color, alpha })
  }
  return out
}

/**
 * THE RAINBOW BAND — a run of overlapping colour slices.
 *
 * The band's slices OVERLAP their neighbours. Adjacent, non-overlapping
 * slices would leave hairline gaps of bare paper between the colours —
 * and a band of thin, hard-edged stripes reads as a barcode, not as
 * foil. Overlapping, semi-transparent slices blend into each other, so
 * the band reads as one continuous sheet of shifting light.
 *
 * The band's ENVELOPE (bright in the middle, fading at both edges) is
 * what keeps it soft and hand-inked rather than a hard rectangle.
 */
function rainbowBand(o: {
  clip: Vec2[]
  centre: Vec2
  d: Vec2
  n: Vec2
  offset: number
  halfWidth: number
  reach: number
  slices: number
  hueFrom: number
  hueTo: number
  sat: number
  light: number
  tierColor: number
  tierMix: number
  alpha: number
}): FinishSlice[] {
  const out: FinishSlice[] = []
  const count = Math.max(2, Math.round(o.slices))
  // The slices overlap by 60% of their own width, so no seam of bare
  // paper can show between two colours.
  const slot = (2 * o.halfWidth) / count
  const sliceW = slot * 1.6
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const hue = o.hueFrom + (o.hueTo - o.hueFrom) * t
    const rainbow = hueColor(hue, o.sat, o.light)
    const color = tintHuePreserving(rainbow, o.tierColor, o.tierMix)
    // The slice's centre along the band's normal, and its own width in
    // the band's normalised coordinate (-1 .. 1).
    const uc = -1 + (2 * (i + 0.5)) / count
    const halfU = sliceW / (2 * o.halfWidth)
    const a0 = o.offset + (uc - halfU) * o.halfWidth
    const a1 = o.offset + (uc + halfU) * o.halfWidth
    // The envelope: bright in the middle of the band, gone at its edges.
    const edgeFade = Math.max(0, 1 - Math.abs(uc))
    const alpha = o.alpha * edgeFade * edgeFade
    if (alpha <= 0.002) continue
    const quad: Vec2[] = [
      { x: o.centre.x + o.n.x * a0 - o.d.x * o.reach, y: o.centre.y + o.n.y * a0 - o.d.y * o.reach },
      { x: o.centre.x + o.n.x * a0 + o.d.x * o.reach, y: o.centre.y + o.n.y * a0 + o.d.y * o.reach },
      { x: o.centre.x + o.n.x * a1 + o.d.x * o.reach, y: o.centre.y + o.n.y * a1 + o.d.y * o.reach },
      { x: o.centre.x + o.n.x * a1 - o.d.x * o.reach, y: o.centre.y + o.n.y * a1 - o.d.y * o.reach },
    ]
    const points = clipPolygon(quad, o.clip)
    if (points.length < 3) continue
    out.push({ points, color, alpha })
  }
  return out
}

// ----------------------------------------------------------------------
// THE FINISH
// ----------------------------------------------------------------------

/**
 * The card's GLOSS — the broad, soft highlight of light on the paper.
 *
 * It is STATIC (a card's gloss is a property of the paper, not of the
 * moment) and it is drawn as TWO tapered leaves: a broad warm-white
 * wash, and a soft shadow line just outside its edge. That pairing is
 * how a comic artist draws the shine on a panel — the light needs a
 * shadow beside it or it does not read on a pale card.
 */
export function buildCardGloss(rect: CardRect, tierColor: number): FinishSlice[] {
  const clip = roundedRectPolygon(clipRect(rect))
  const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  const { d, n } = axisFrame(GLOSS_ANGLE)
  const reach = reachFor(clip, centre, d) * 1.1
  const out: FinishSlice[] = []
  const leaves = [
    {
      offset: rect.w * 0.04,
      bulge: rect.w * 0.19,
      color: mixColor(0xfffdf4, tierColor, 0.1),
      alpha: 0.3,
    },
    {
      // The shadow line, just outside the wash's lower edge.
      offset: rect.w * 0.24,
      bulge: rect.w * 0.015,
      color: 0x9a8763,
      alpha: 0.16,
    },
  ]
  for (const leaf of leaves) {
    const p0 = {
      x: centre.x - d.x * reach + n.x * leaf.offset,
      y: centre.y - d.y * reach + n.y * leaf.offset,
    }
    const p1 = {
      x: centre.x + d.x * reach + n.x * leaf.offset,
      y: centre.y + d.y * reach + n.y * leaf.offset,
    }
    const points = clipPolygon(leafPolygon(p0, p1, leaf.bulge), clip)
    if (points.length < 3) continue
    out.push({ points, color: leaf.color, alpha: leaf.alpha })
  }
  return out
}

/**
 * THE RAINBOW BAND — the moving holographic sheen.
 *
 * `phase` runs 0..1 and moves the band ACROSS the card. At phase 0 and 1
 * the band is completely off the card, so the sweep loops seamlessly.
 *
 * The band is TINTED by the tier's colour: the rainbow is the base, the
 * ball's own colour is mixed in, so each card's foil matches its ball.
 */
export function buildCardSheen(
  rect: CardRect,
  phase: number,
  tierColor: number,
  rarityIndex: number,
): CardSheen {
  const clip = roundedRectPolygon(clipRect(rect))
  const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  const { d, n } = axisFrame(SHINE_ANGLE)
  const reach = reachFor(clip, centre, d)
  const travel = travelFor(clip, centre, n)
  const halfWidth = (BAND_WIDTH_FRACTION * rect.w) / 2
  // The band sweeps from one side of the card to the other, and starts
  // and ends completely clear of it.
  const margin = halfWidth * 1.35
  const p = ((phase % 1) + 1) % 1
  const offset = -travel - margin + p * 2 * (travel + margin)
  // A rarer card's foil is stronger.
  const rarityBoost = 1 + Math.max(0, Math.min(4, rarityIndex)) * 0.09
  // The rainbow band itself — a few bold, feathered colour stripes.
  const band = rainbowBand({
    clip,
    centre,
    d,
    n,
    offset,
    halfWidth,
    reach,
    slices: SHINE_STRIPES,
    hueFrom: HUE_BASE,
    hueTo: HUE_BASE + HUE_SPREAD,
    sat: 0.72,
    light: 0.58,
    tierColor,
    tierMix: 0.26,
    alpha: 0.55 * rarityBoost,
  })
  // The hot specular streak on the band's LEADING edge (the side the
  // band is travelling towards). It is drawn ADDITIVELY over the band.
  const specular = bandSlices({
    clip,
    centre,
    d,
    n,
    offset: offset + halfWidth * 0.62,
    halfWidth: halfWidth * 0.13,
    reach,
    slices: 2,
    hueFrom: HUE_BASE + 0.1,
    hueTo: HUE_BASE + 0.18,
    sat: 0.16,
    light: 0.99,
    tierColor,
    tierMix: 0.15,
    alpha: 0.85 * rarityBoost,
    profile: (u) => Math.max(0, 1 - u * u),
  })
  return { band, specular }
}

/**
 * THE RARITY EDGE — the foil ribbon along the card's margins.
 *
 * Only the top rungs (EPIC and LEGENDARY) earn it, and it is STATIC: the
 * ribbon does not move, so it is drawn once when the card is built and
 * costs nothing per frame. Its hue is the rainbow's, so it reads as the
 * same foil as the moving band.
 */
export function buildRarityEdge(
  rect: CardRect,
  tierColor: number,
  rarityIndex: number,
): FinishSlice[] {
  const edge: FinishSlice[] = []
  const tier = Math.max(0, Math.min(4, Math.round(rarityIndex)))
  if (tier < 3) return edge

  const clip = roundedRectPolygon(clipRect(rect))
  const inset = Math.min(FRAME_INSET + 3, Math.min(rect.w, rect.h) / 6)
  const ribbonW = Math.max(2.5, rect.w * 0.013)
  const segments = 14
  // The two side margins, and the strip along the bottom.
  const runs: { x0: number; y0: number; x1: number; y1: number }[] = [
    { x0: rect.x + inset, y0: rect.y + rect.h * 0.22, x1: rect.x + inset, y1: rect.y + rect.h * 0.8 },
    { x0: rect.x + rect.w - inset, y0: rect.y + rect.h * 0.22, x1: rect.x + rect.w - inset, y1: rect.y + rect.h * 0.8 },
    { x0: rect.x + inset, y0: rect.y + rect.h - inset, x1: rect.x + rect.w - inset, y1: rect.y + rect.h - inset },
  ]
  for (const run of runs) {
    const runLen = Math.hypot(run.x1 - run.x0, run.y1 - run.y0)
    if (runLen < 1) continue
    const dx = (run.x1 - run.x0) / runLen
    const dy = (run.y1 - run.y0) / runLen
    // The ribbon's width runs across the run.
    const px = -dy
    const py = dx
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments
      const t1 = (i + 1) / segments
      const ax = run.x0 + dx * runLen * t0
      const ay = run.y0 + dy * runLen * t0
      const bx = run.x0 + dx * runLen * t1
      const by = run.y0 + dy * runLen * t1
      const quad: Vec2[] = [
        { x: ax + px * ribbonW, y: ay + py * ribbonW },
        { x: bx + px * ribbonW, y: by + py * ribbonW },
        { x: bx - px * ribbonW, y: by - py * ribbonW },
        { x: ax - px * ribbonW, y: ay - py * ribbonW },
      ]
      const points = clipPolygon(quad, clip)
      if (points.length < 3) continue
      const color = tintHuePreserving(hueColor(t0 * 0.85, 0.8, 0.58), tierColor, 0.4)
      edge.push({ points, color, alpha: 0.62 })
    }
  }
  return edge
}

/**
 * THE RARITY GLINT — the twinkling sparkles on a rare card.
 *
 * The sparkles TWINKLE: each one has its own phase, so they pulse in and
 * out of step with each other. The overlay drives the twinkle with the
 * same clock as the sheen, so the whole finish moves as one.
 */
export function buildRarityGlint(
  rect: CardRect,
  tierColor: number,
  rarityIndex: number,
): FinishSparkle[] {
  const sparkles: FinishSparkle[] = []
  const tier = Math.max(0, Math.min(4, Math.round(rarityIndex)))
  // The sparkles — one more for every rung of rarity.
  const anchors: { fx: number; fy: number }[] = [
    { fx: 0.895, fy: 0.12 },
    { fx: 0.79, fy: 0.585 },
    { fx: 0.885, fy: 0.665 },
    { fx: 0.775, fy: 0.745 },
    { fx: 0.9, fy: 0.82 },
    { fx: 0.815, fy: 0.9 },
  ]
  const count = Math.min(anchors.length, 2 + tier)
  for (let i = 0; i < count; i++) {
    const a = anchors[i]!
    const s = Math.max(7, rect.w * (0.024 + tier * 0.004))
    const cx = rect.x + rect.w * a.fx
    const cy = rect.y + rect.h * a.fy
    const points: Vec2[] = [
      { x: cx, y: cy - s },
      { x: cx + s * 0.32, y: cy - s * 0.32 },
      { x: cx + s, y: cy },
      { x: cx + s * 0.32, y: cy + s * 0.32 },
      { x: cx, y: cy + s },
      { x: cx - s * 0.32, y: cy + s * 0.32 },
      { x: cx - s, y: cy },
      { x: cx - s * 0.32, y: cy - s * 0.32 },
    ]
    sparkles.push({
      points,
      color: mixColor(0xffffff, tierColor, 0.3),
      alpha: 0.95,
      cx,
      cy,
      coreR: s * 0.2,
      twinkle: (i * 0.37) % 1,
    })
  }
  return sparkles
}
