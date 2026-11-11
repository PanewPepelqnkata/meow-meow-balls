import type Phaser from 'phaser'
import { BALL_EMOTION } from '../../config/ballEmotion'
import { tier9Theme, type Tier9Theme } from '../state/runVariant'
import { BodyFillClipper } from './BodyFillClipper'

/**
 * Phaser's Graphics typings demand Vector2[] but the renderer only reads
 * .x/.y at runtime — this cast keeps the module free of a runtime Phaser
 * import (headless-testable) while satisfying the types.
 */
function asPoints(pts: Array<{ x: number; y: number }>): Phaser.Math.Vector2[] {
  return pts as unknown as Phaser.Math.Vector2[]
}

/**
 * Phase 2.11.1 — SINGLE SOURCE OF TRUTH for ball appearance (spec §11, P1, P3).
 *
 * Preview, crane and gameplay renderer ALL draw through this module:
 *
 *   BallAppearance (tier color + per-character look from a seed)
 *     → NextBall   (src/ui/NextBall.ts — preview)
 *     → DropClaw   (src/ui/DropClaw.ts — crane)
 *     → SoftBallRenderer (gameplay, live simulated contour)
 *
 * Only position and uniform render scale differ between contexts. ALL facial
 * geometry derives from the ball's visual radius R through the NORMALIZED
 * face metrics below (Priority 1A) — the same normalized proportions are
 * applied at every scale, so preview/crane/gameplay characters are identical
 * up to a uniform scale (verified by BallAppearance.test.ts).
 */

export const INK = 0x1a1a1a



/**
 * Normalized face layout — the ONE place facial proportions are defined.
 * Every value is a fraction of the ball radius R, measured from the ball's
 * visual center (y+ = down). Phase 2.16.2 SLIME look (reference ref3): the
 * two big oval eyes sit CLOSE together near the ball's midline, pupils gaze
 * off to one side (never dead-center — that reads creepy), and the mouth is
 * a tiny doodle stroke:
 *   - eye full width 0.58–0.68 R, full height 0.66–0.78 R
 *   - eye centers ±0.35 R (inner edges almost touching), eye line 0.18 R
 *     above center
 *   - mouth full width 0.18–0.26 R, center 0.36 R below center
 * Phase 2.11.2 (spec §7): NO cheek blush, NO lower-body shading — the only
 * body decoration is ONE small white highlight near the 10 o'clock position
 * (8–12% R wide, 4–7% R tall) plus an optional tiny secondary dot. The
 * highlight is drawn AFTER (on top of) the eyes as a glint.
 */
const FACE = {
  eyeDx: 0.35,
  eyeY: -0.18,
  eyeRim: 0.09, // sclera ink rim (fraction of R) — chunky doodle ink
  pupilH: 0.7, // pupil height as fraction of sclera height
  mouthY: 0.36,
  mouthStroke: 0.085, // marker stroke (fraction of R) — restrained vs 0.16R outline
  /** Body glint: center offset, full width/height (fractions of R), on the
   * top-left of the head (10–11 o'clock) — drawn over the eyes as a shine. */
  highlightX: -0.52,
  highlightY: -0.64,
  highlightW: 0.115,
  highlightH: 0.068,
  /** Tiny secondary dot, offset from the main highlight (fractions of R). */
  highlightDotDx: 0.055,
  highlightDotDy: 0.045,
  highlightDotR: 0.018,
} as const

/** Deterministic per-character look. Contour fields are stage-scale wobble
 * params; face fields are NORMALIZED traits consumed by faceLayoutFor. */
export interface BallLook {
  /** Contour wobble: lobe counts, amplitudes (px at r≈40), phases. */
  lobes1: number
  lobes2: number
  amp1: number
  amp2: number
  phase1: number
  phase2: number
  /** Eyes: normalized full width/height (fractions of R), subtle
   * asymmetry, pupil gaze (fraction of available slack), pupil width. */
  eyeW: number
  eyeH: number
  eyeAsym: number
  gazeX: number
  gazeY: number
  pupilW: number
  /** Mouth: simple style 0..2 (see faceLayoutFor), width fraction, curve. */
  mouth: number
  mouthW: number
  mouthCurve: number
  mouthTilt: number
}

/** Small deterministic hash → [0,1) stream (mulberry32). */
function mulberry(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0
  return (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The ONE function every context uses to turn a seed into a character. */
export function ballLookFor(_tier: number, seed: number): BallLook {
  const next = mulberry(seed)
  return {
    lobes1: 3 + Math.floor(next() * 2), // 3..4 low-frequency lobes
    lobes2: 5 + Math.floor(next() * 2), // 5..6 gentle secondary lobes
    // SUBTLE rest wobble — the balls must read as BALLS at rest; the slime
    // splatter comes from the impact deform system (localized dents), not
    // from the silhouette.
    amp1: 0.01 + next() * 0.008, // fraction of R
    amp2: 0.004 + next() * 0.004,
    phase1: next() * Math.PI * 2,
    phase2: next() * Math.PI * 2,
    eyeW: 0.58 + next() * 0.1, // full sclera width: 0.58..0.68 R (slime doodle)
    eyeH: 0.66 + next() * 0.12, // full sclera height: 0.66..0.78 R
    eyeAsym: 0.92 + next() * 0.08, // right/left height ratio (subtle)
    gazeX: -(0.25 + next() * 0.7), // pupils gaze LEFT like the reference
    gazeY: (next() - 0.5) * 0.7, // slight vertical variety
    pupilW: 0.6 + next() * 0.12, // pupil width fraction of sclera width (bold)
    mouth: Math.floor(next() * 3), // three simple marker styles only
    mouthW: 0.18 + next() * 0.08, // full mouth width: 0.18..0.26 R (tiny)
    mouthCurve: 0.7 + next() * 0.6,
    mouthTilt: (next() - 0.5) * 0.8, // subtle per-character tilt (style 1)
  }
}

/** Random 32-bit seed for newly spawned balls. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0
}

// ---------------------------------------------------------------------------
// Phase 2.16.2 — living eyes: occasional left/right GLANCES.
// ---------------------------------------------------------------------------

/** Slot length between glances (ms). Glances dart at slot boundaries and
 * ease over ~230 ms; the hold is the rest of the slot. */
const GLANCE_SLOT_MS = 4000

/**
 * Pupil gaze for a ball at `time` — piecewise targets with a quick
 * smoothstep dart, mostly side-to-side (left/right ALTERNATE so every dart
 * is visible), ~20% brief near-center glances, slight vertical variety.
 * Deterministic in (seed, time), with a PER-BALL phase offset so balls
 * never glance in sync.
 */
export function gazeAt(seed: number, time: number): { x: number; y: number } {
  const phase = mulberry(seed ^ 0x2545f491)() * GLANCE_SLOT_MS
  const slot = Math.floor((time + phase) / GLANCE_SLOT_MS)
  const target = (i: number): { x: number; y: number } => {
    const r1 = mulberry((seed ^ 0x9e3779b9) + Math.imul(i + 0x7f4a7c15, 0x85ebca6b))()
    const r2 = mulberry((seed ^ 0x85ebca6b) + Math.imul(i + 0x2545f491, 0x9e3779b9))()
    const side = i % 2 === 0 ? -1 : 1
    const x = r1 < 0.2 ? (r1 - 0.1) * 0.6 : side * (0.3 + r1 * 0.6)
    return { x, y: (r2 - 0.5) * 0.55 }
  }
  const cur = target(slot)
  const t = (time + phase - slot * GLANCE_SLOT_MS) / 230
  if (t >= 1) return cur
  const prev = target(slot - 1)
  const k = t * t * (3 - 2 * t) // smoothstep
  return { x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k }
}

// ---------------------------------------------------------------------------
// Phase 2.16.2 — EASTER EGGS: a quick wink / big smile / tongue-out once
// every 10–30 s per ball.
// ---------------------------------------------------------------------------

export type BallExpression = 'normal' | 'wink' | 'grin' | 'tongue'

/** How long an easter egg shows (ms). */
const EXPR_MS = 850

/**
 * The expression a ball wears at `time`: mostly 'normal', but once every
 * 10–30 s (per-ball randomized cycle length AND phase offset, so balls
 * never egg in sync) it flashes a quick 'wink' (right eye closes), 'grin'
 * (big smile) or 'tongue' (tongue out on the right side of the mouth) for
 * ~0.85 s. Deterministic in (seed, time).
 */
export function expressionAt(seed: number, time: number): BallExpression {
  const cycle = 10000 + mulberry(seed ^ 0x34d8b4b7)() * 20000
  const phase = mulberry(seed ^ 0x68e31da4)() * cycle
  const t = (time + phase) % cycle
  if (t > EXPR_MS) return 'normal'
  const kind = mulberry((seed ^ 0x85ebca6b) + Math.imul(Math.floor((time + phase) / cycle), 0x9e3779b9))()
  return kind < 1 / 3 ? 'wink' : kind < 2 / 3 ? 'grin' : 'tongue'
}

/** Thick cartoon outline width for a ball of radius r. */
export function ballOutlineWidth(r: number): number {
  return Math.max(3, Math.min(7, r * 0.16))
}

/** Outline width for collection thumbnails — thinner at small radii so the
 * art stays readable. Scales linearly with no floor, capped lower than the
 * gameplay outline. */
export function collectionOutlineWidth(r: number): number {
  return Math.max(1, Math.min(2.5, r * 0.07))
}

/** Ink width for collection thumbnails — thinner internal details (eyes,
 * nose, mouth, etc.) so small balls stay readable. */
export function collectionInkWidth(r: number): number {
  return Math.max(0.8, Math.min(1.8, r * 0.035))
}

/**
 * Radially displace a contour by the ball's fixed low-frequency wobble and
 * smooth once. Used by the gameplay renderer (live simulated contour as
 * `pts`) and — with a perfect circle as `pts` — by preview/crane.
 * `capOutward` limits outward displacement (gameplay: 1.5px so the
 * decorative contour stays inside the verified collision envelope).
 */
export function wobbleContour(
  look: BallLook,
  pts: Array<{ x: number; y: number }>,
  cx: number,
  cy: number,
  r: number,
  capOutward = 1.5,
): Array<{ x: number; y: number }> {
  const n = pts.length
  const rawX = new Float64Array(n)
  const rawY = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.hypot(dx, dy) || 1e-6
    const th = Math.atan2(dy, dx)
    const w =
      Math.sin(look.lobes1 * th + look.phase1) * look.amp1 * r +
      Math.sin(look.lobes2 * th + look.phase2) * look.amp2 * r
    const dr = w < 0 ? Math.max(w, -r * 0.03) : Math.min(w, capOutward)
    const nd = d + dr
    rawX[i] = cx + (dx / d) * nd
    rawY[i] = cy + (dy / d) * nd
  }
  // One smoothing pass — kills kinks while keeping the wobble legible.
  const out: Array<{ x: number; y: number }> = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const next = (i + 1) % n
    out[i] = {
      x: (rawX[prev]! + 2 * rawX[i]! + rawX[next]!) / 4,
      y: (rawY[prev]! + 2 * rawY[i]! + rawY[next]!) / 4,
    }
  }
  return out
}

export function restContour(
  look: BallLook,
  radius: number,
  cx: number,
  cy: number,
  steps = 40,
): Array<{ x: number; y: number }> {
  const circle: Array<{ x: number; y: number }> = []
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2
    circle.push({ x: cx + Math.cos(th) * radius, y: cy + Math.sin(th) * radius })
  }
  return wobbleContour(look, circle, cx, cy, radius)
}

// ---------------------------------------------------------------------------
// Normalized face layout (Priority 1A/1D): every facial dimension derives
// from the ball radius R in ONE place; positions are relative to the ball
// center in px. `aspect` (ball h/w from the live contour) applies ONE
// coherent transform: vertical squash `es` + slight horizontal spread, with
// a guaranteed fit inside the ball at any compression.
// ---------------------------------------------------------------------------

export interface EyeLayout {
  /** Sclera center (relative to ball center) + semi-axes (px). */
  x: number
  y: number
  a: number
  b: number
  rim: number
  /** Pupil semi-axes + center (clamped inside the sclera). */
  pa: number
  pb: number
  px: number
  py: number
}

export interface FaceLayout {
  r: number
  /** Vertical squash actually applied (1 = round ball). */
  es: number
  /** Small white body highlight near the 10 o'clock position + tiny dot. */
  highlight: { x: number; y: number; w: number; h: number }
  highlightDot: { x: number; y: number; r: number }
  eyes: [EyeLayout, EyeLayout]
  mouth: {
    x: number
    y: number
    halfW: number
    depth: number
    stroke: number
    style: number
    tilt: number
  }
}

/**
 * Build the concrete face geometry (px, relative to ball center) for a look
 * at radius `r` and live aspect (h/w). Deterministic: the same (seed, r,
 * aspect) always yields the same layout — and preview/crane/gameplay pass
 * the same seed, so their faces are identical up to uniform scale.
 */
export function faceLayoutFor(
  look: BallLook,
  r: number,
  aspect = 1,
  /** Optional live gaze (gazeAt) overriding the look's fixed traits. */
  gaze?: { x: number; y: number },
): FaceLayout {
  // One coherent compression transform (Priority 1D): squash vertically with
  // the live aspect (clamped). es ≤ aspect·0.92 guarantees the face's full
  // vertical extent stays inside the squashed ball. Horizontal extents keep
  // their round proportions — the squashed ball only bulges WIDER, so the
  // face can never overflow horizontally, and eyes never drift apart.
  const es = Math.min(1, Math.max(0.62, aspect) * 0.92)

  const eyeY = r * FACE.eyeY * es // FACE.eyeY < 0 → above center
  const eyeDx = r * FACE.eyeDx
  const rim = Math.max(1.5, r * FACE.eyeRim)

  const mkEye = (side: -1 | 1): EyeLayout => {
    const a = (r * look.eyeW) / 2
    const b = ((r * look.eyeH) / 2) * (side < 0 ? 1 : look.eyeAsym) * es
    const pa = a * look.pupilW
    const pb = b * FACE.pupilH
    // Pupil gaze: fraction of the slack between pupil edge and sclera edge
    // (minus half the rim) — clamped so pupil + rim always stay inside.
    // `gaze` (the live glance timeline) overrides the look's fixed traits.
    const slackX = Math.max(0, a - pa - rim * 0.5)
    const slackY = Math.max(0, b - pb - rim * 0.5)
    const gx = Math.max(-0.95, Math.min(0.95, gaze ? gaze.x : look.gazeX))
    const gy = Math.max(-0.95, Math.min(0.95, gaze ? gaze.y : look.gazeY))
    return {
      x: eyeDx * side,
      y: eyeY,
      a,
      b,
      rim,
      pa,
      pb,
      px: gx * slackX,
      py: gy * slackY,
    }
  }

  const mouthHalfW = (r * look.mouthW) / 2
  // Style depth: 0 shallow smile · 1 asymmetric smile · 2 tiny arc.
  const depthBase = look.mouth === 2 ? 0.22 : look.mouth === 1 ? 0.7 : 0.55
  const mouthDepth = mouthHalfW * depthBase * (0.7 + look.mouthCurve * 0.4) * es

  return {
    r,
    es,
    // ONE small white body highlight near the 10 o'clock position (spec
    // §7: ~8–12% R wide, 4–7% R tall, modest opacity) + a tiny secondary
    // dot close to it. No blush, no lower-body shading.
    highlight: {
      x: r * FACE.highlightX,
      y: r * FACE.highlightY * es,
      w: r * FACE.highlightW,
      h: r * FACE.highlightH * es,
    },
    highlightDot: {
      x: r * (FACE.highlightX + FACE.highlightDotDx),
      y: r * (FACE.highlightY + FACE.highlightDotDy) * es,
      r: r * FACE.highlightDotR,
    },
    eyes: [mkEye(-1), mkEye(1)],
    mouth: {
      x: 0,
      y: r * FACE.mouthY * es,
      halfW: mouthHalfW,
      depth: mouthDepth,
      stroke: Math.max(1.5, Math.min(6.5, r * FACE.mouthStroke)),
      style: look.mouth,
      tilt: look.mouthTilt,
    },
  }
}

/**
 * The shared character face: large doodle eyes (inked rim + ONE bold dark
 * pupil + ONE main highlight + a tiny secondary dot), a SMALL white glint
 * near the 10 o'clock position drawn OVER the eyes (the oversized whites
 * cover that quadrant — the glint reads as a shine either way), and a
 * SIMPLE child-drawn marker mouth (spec §7/§8 — no blush, no shading
 * blobs, no extra rings). All geometry comes from faceLayoutFor — every
 * feature stays inside the ball's fill.
 *
 * `live` carries the per-frame overrides used by the gameplay renderer:
 * `gaze` (glance timeline) moves the pupils; `expr` flashes an easter-egg
 * expression — 'wink' (right eye closes as a doodle lid), 'grin' (a big
 * smile) or 'tongue' (smile with a pink tongue out on the mouth's right);
 * `panic` (0..1, from BallEmotionSystem) morphs the whole face into the
 * scared look — bigger/wider eyes, pupils pinned upward, an open
 * frightened mouth — and returns the face-local jitter offset the caller
 * should apply to the face position (visual trembling; the body never
 * moves). All panic scales come from src/config/ballEmotion.ts.
 */
export function drawBallFace(
  g: Phaser.GameObjects.Graphics,
  look: BallLook,
  c: { x: number; y: number },
  r: number,
  aspect = 1,
  live?: { gaze?: { x: number; y: number }; expr?: BallExpression; panic?: number },
  thumbnail = false,
): { dx: number; dy: number } {
  const panic = Math.max(0, Math.min(1, live?.panic ?? 0))
  const E = BALL_EMOTION
  const em = Math.min(1, panic * E.criticalPanicIntensity) // critical exaggeration
  // Trembling: deterministic jitter (sine pair — smooth and loopable),
  // intensity grows with panic² and bursts harder at critical.
  const t = Date.now() / 1000
  const shakeAmp = E.shakeIntensity * panic * panic * (panic >= 1 ? E.criticalShakeBoost : 1)
  const jitter = {
    dx: Math.sin(t * E.shakeFrequency * 6.283) * shakeAmp,
    dy: Math.cos(t * E.shakeFrequency * 6.283 * 1.17) * shakeAmp * 0.7,
  }
  // Panic morphs the effective radius fractions: eyes bigger+wider,
  // pupils smaller and pinned upward, mouth bigger and open.
  const pLook: BallLook = panic > 0
    ? {
        ...look,
        eyeW: look.eyeW * (1 + (E.eyeScaleMax - 1) * em),
        eyeH: look.eyeH * (1 + (E.eyeScaleMax - 1) * em),
        eyeAsym: 1 - (1 - look.eyeAsym) * (1 - em), // asymmetry fades (wide-eyed symmetric)
        pupilW: look.pupilW * (1 - (1 - E.pupilScaleMax) * em),
      }
    : look
  const L = faceLayoutFor(pLook, r, aspect, live?.gaze)
  // Thumbnail mode: scale down eye rims and mouth stroke for readability.
  if (thumbnail) {
    const scale = collectionInkWidth(r) / Math.max(2, r * 0.05)
    for (const e of L.eyes) e.rim *= scale
    L.mouth.stroke *= scale
  }
  // Pupils pinned upward with panic (gaze.y = -1 is the top of the eye);
  // the glance timeline yields to the upward stare as panic rises.
  if (panic > 0) {
    const up = E.pupilUpwardGaze * em
    for (const e of L.eyes) {
      const slackY = Math.max(0, e.b - e.pb - e.rim * 0.5)
      e.py = e.py * (1 - em) + -up * slackY * em
    }
  }
  const expr = live?.expr ?? 'normal'
  // Panic suppresses easter-egg expressions — fear wins.
  const effExpr: BallExpression = panic > 0.45 ? 'normal' : expr
  const X = (v: number): number => c.x + v + jitter.dx
  const Y = (v: number): number => c.y + v + jitter.dy

  // Eyes: white sclera, thick ink rim, ONE dark pupil, ONE main highlight
  // (+ a tiny secondary dot close to it) — no concentric target rings.
  // 'wink': the RIGHT eye closes into a doodle lid arc instead.
  for (const [i, e] of L.eyes.entries()) {
    if (effExpr === 'wink' && i === 1) {
      g.lineStyle(e.rim * 0.95, INK, 1)
      const lid: Array<{ x: number; y: number }> = []
      for (let s = 0; s <= 12; s++) {
        const u = -1 + (2 * s) / 12
        lid.push({
          x: X(e.x + u * e.a * 0.85),
          y: Y(e.y - e.b * 0.05 + (1 - u * u) * e.b * 0.4),
        })
      }
      g.strokePoints(asPoints(lid), false, false)
      continue
    }
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(X(e.x), Y(e.y), e.a * 2, e.b * 2)
    g.lineStyle(e.rim, INK, 1)
    g.strokeEllipse(X(e.x), Y(e.y), e.a * 2, e.b * 2)
    g.fillStyle(INK, 1)
    g.fillEllipse(X(e.x + e.px), Y(e.y + e.py), e.pa * 2, e.pb * 2)
    // Main highlight near the pupil's upper-left + tiny secondary dot.
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(X(e.x + e.px - e.pa * 0.32), Y(e.y + e.py - e.pb * 0.34), e.pa * 0.6, e.pa * 0.6, 24)
    g.fillEllipse(X(e.x + e.px - e.pa * 0.1), Y(e.y + e.py - e.pb * 0.38), e.pa * 0.24, e.pa * 0.24, 16)
  }

  // Body glint: white oval on the TOP-LEFT of the head (10–11 o'clock),
  // drawn after the eyes (in ball-local space so it deforms with the
  // squash) + a tiny secondary dot — a clearly visible shine.
  g.fillStyle(0xffffff, 0.85)
  g.fillEllipse(X(L.highlight.x), Y(L.highlight.y), L.highlight.w, L.highlight.h)
  g.fillStyle(0xffffff, 0.95)
  g.fillCircle(X(L.highlightDot.x), Y(L.highlightDot.y), L.highlightDot.r)

  // Simple marker mouths (Priority 1C): one clean ink stroke each —
  // 0 shallow smile · 1 slightly asymmetric smile · 2 tiny arc.
  // 'grin' temporarily scales the stroke into a big happy smile.
  const m = L.mouth
  const grin = effExpr === 'grin'
  const halfW = m.halfW * (grin ? 1.5 : 1)
  const depth = m.depth * (grin ? 1.6 : 1)
  g.lineStyle(m.stroke, INK, 1)
  const pts: Array<{ x: number; y: number }> = []
  const steps = 14
  if (panic > 0.05) {
    // FRIGHTENED MOUTH: an open wobbling O (dark ink ellipse with a lighter
    // inner mouth), scaling up with panic — the signature "OH GOD" face.
    const mw = m.halfW * E.mouthScaleMax * (0.6 + 0.4 * em)
    const mh = m.halfW * E.mouthOpenMax * (0.55 + 0.45 * em)
    const my = m.y + r * 0.1 * em
    // Wobble the O's size slightly with the shake phase — gasping.
    const gasp = 1 + Math.sin(t * E.shakeFrequency * 6.283 * 0.5) * 0.08 * panic
    g.fillStyle(INK, 1)
    g.fillEllipse(X(m.x), Y(my), mw * gasp, mh * gasp)
    // Inner mouth (dark red) for depth.
    g.fillStyle(0x8c2f39, 1)
    g.fillEllipse(X(m.x), Y(my + mh * 0.08), mw * gasp * 0.72, mh * gasp * 0.62)
    // Tongue tip peeking from the bottom of the O.
    g.fillStyle(0xff7fa5, 1)
    g.fillEllipse(X(m.x), Y(my + mh * 0.34), mw * gasp * 0.5, mh * gasp * 0.34)
  } else {
    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps
      // depth(t): parabola peaking at t=0; style 1 tilts one end up subtly.
      const tiltLift = m.style === 1 ? 1 + m.tilt * 0.35 * t : 1
      pts.push({
        x: X(m.x + t * halfW),
        y: Y(m.y + (1 - t * t) * depth * tiltLift),
      })
    }
    g.strokePoints(asPoints(pts), false, false)
  }

  // 'tongue': a pink tongue lolls out on the RIGHT side of the smile.
  if (effExpr === 'tongue') {
    const tw = halfW * 0.9
    const th = r * 0.16
    const tx = m.x + halfW * 0.5
    const ty = m.y + depth * 0.35 + th / 2
    g.fillStyle(0xff7fa5, 1)
    g.fillEllipse(X(tx), Y(ty), tw, th)
    g.lineStyle(m.stroke * 0.7, INK, 1)
    g.strokeEllipse(X(tx), Y(ty), tw, th)
  }

  // SWEAT DROPS (visual only): small blue droplets flying off the upper
  // sides of the head, fading in above the sweat threshold and drifting
  // outward — the classic cartoon panic tell.
  if (panic > E.sweatAt) {
    const sweatA = Math.min(1, (panic - E.sweatAt) / Math.max(0.01, 1 - E.sweatAt))
    const dropPhase = t * 2.2
    for (let i = 0; i < E.sweatDrops; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const ph = dropPhase + i * 1.7
      // Each drop arcs outward and upward, then restarts (looping spurt).
      const k = ph - Math.floor(ph) // 0..1 loop
      const dist = r * (0.72 + k * 0.5)
      const dxp = side * dist
      const dyp = -r * (0.55 + Math.sin(k * Math.PI) * 0.45) - i * r * 0.04
      const dropR = r * 0.055 * (0.7 + 0.3 * Math.sin(i * 3.1))
      g.fillStyle(0x9fdcff, 0.95 * sweatA)
      g.fillCircle(X(dxp), Y(dyp), dropR)
      g.fillStyle(0xffffff, 0.85 * sweatA)
      g.fillCircle(X(dxp - dropR * 0.25), Y(dyp - dropR * 0.3), dropR * 0.38)
    }
  }
  return { dx: jitter.dx, dy: jitter.dy }
}

// ---------------------------------------------------------------------------
// Phase 2.12.0 — Special tier appearances (Tier 8 rainbow, Tier 9 fantasy)
// ---------------------------------------------------------------------------

export interface SharkPalette {
  /** Belly (light underside). */
  belly: number
  /** Back (the classic shark grey — two tones for the countershading). */
  back: number
  /** Back highlight (a lighter grey along the top). */
  backLight: number
  /** Fin inner (the gill/fin membrane tint). */
  fin: number
  /** Gum/gill red for the mouth interior. */
  gum: number
  /** Cheek grey (slightly blue-grey, for the cheek patches). */
  cheek: number
  /** The reward halo's colour (behind the whole ball). */
  glow: number
}

/**
 * The shark palettes, exported for the OFFLINE BAKER (TierBaker) — the
 * baker's copy MUST stay index-aligned with this array.
 */
export const SHARK_PALETTES: readonly SharkPalette[] = [
  { belly: 0xf2f6fa, back: 0x64809c, backLight: 0x7f9cb8, fin: 0x93aebf, gum: 0xd95a63, cheek: 0xa9c3d4, glow: 0xa9c3d4 }, // 0: reef grey
  { belly: 0xf0f5fa, back: 0x4f719c, backLight: 0x6d8fb4, fin: 0x8baccb, gum: 0xd4525f, cheek: 0x94b6d4, glow: 0x94b6d4 }, // 1: deep blue
  { belly: 0xf0f3e4, back: 0x647a5e, backLight: 0x83987a, fin: 0x9fb098, gum: 0xd65f52, cheek: 0xa8b89c, glow: 0xa8b89c }, // 2: green tide
  { belly: 0xf7efe2, back: 0x8a7566, backLight: 0xa98f76, fin: 0xc0a68c, gum: 0xe06854, cheek: 0xc0ac96, glow: 0xc0ac96 }, // 3: sand
  { belly: 0xe9e9f4, back: 0x5e5e82, backLight: 0x7b7b9f, fin: 0x9a9ab8, gum: 0xc25262, cheek: 0xa1a1ba, glow: 0xa1a1ba }, // 4: dusk
  { belly: 0xe4f0f2, back: 0x538080, backLight: 0x71a1a1, fin: 0x8fb5b5, gum: 0xd05560, cheek: 0x96bcb8, glow: 0x96bcb8 }, // 5: lagoon
]

/**
 * Draw the Tier 9 SHARK ball — the reward tier, drawn to COLLECT: a
 * round-body shark-slime with a big open mouth (triangle teeth top and
 * bottom), a shark eye, a dorsal fin, side + tail fins, gill slits and a
 * countershaded belly.
 *
 * DRAWING SURFACE: the body is the ball's CONTOUR (the wobbled
 * silhouette) — pass `poly` (live contour, world space) plus its
 * centroid; without `poly` (static previews) it falls back to a circle
 * of radius r at (cx, cy).
 *
 * FEAR: pass `panic` (0..1, from BallEmotionSystem) and `gaze` — the
 * shark shows its OWN fear ladder: the mouth clamps shut and trembles,
 * the eye shrinks wide-open with a sweat drop, the fins flatten. The
 * easter-egg gaze keeps working through `gaze`.
 *
 * The FACE is part of the design here — callers must NOT draw the
 * standard face on top.
 *
 * This is ONE of the two tier-9 themes (the run rolls shark | pig via
 * tier9Theme()); consumers call drawTier9Ball, which routes here or to
 * drawPigBall.
 */

/**
 * Stroke/fill-agnostic quadratic bezier for Phaser Graphics: Graphics has
 * no native quadratic curve, so the curve is approximated with an
 * 8-segment polyline (visually smooth at ball sizes).
 */
/**
 * Quadratic bezier from (x0,y0) with control (cpx,cpy) to (x,y), appended
 * to the current path as a polyline. Call after g.moveTo / a previous
 * segment.
 */
function quadFrom(g: Phaser.GameObjects.Graphics, x0: number, y0: number, cpx: number, cpy: number, x: number, y: number): void {
  const segs = 8
  for (let i = 1; i <= segs; i++) {
    const t = i / segs
    const mt = 1 - t
    const px = mt * mt * x0 + 2 * mt * t * cpx + t * t * x
    const py = mt * mt * y0 + 2 * mt * t * cpy + t * t * y
    g.lineTo(px, py)
  }
}


export function drawSharkBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  thumbnail = false,
): void {
  const pal = SHARK_PALETTES[variant % SHARK_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(2, r * 0.05)
  // The easter-egg expression (wink) rides the same timeline as the
  // other balls — suppressed while panicking (fear wins).
  const now = Date.now() / 1000
  const exprShark = panic > 0.45 ? 'normal' : expressionAt(seed, now * 1000)
  // The mouth clamps shut as panic rises: openness 1 → 0.
  const open = 1 - Math.max(0, Math.min(1, panic * 1.15))
  const jx = Math.sin(now * 43) * r * 0.02 * panic * panic
  const jy = Math.cos(now * 37) * r * 0.015 * panic * panic
  cx += jx
  cy += jy

  // ---- THE GLOW — a soft radial stack behind the whole shark: 4
  // concentric discs of the palette's warm-gold `glow`, widest first,
  // each smaller AND brighter — a cheap radial gradient with the
  // brightness peaking at the body. A gentle ~9s breath scales the
  // stack (±3%) and sways the inner alpha (±0.02), so the aura is
  // alive, not a static decal. Drawn FIRST so everything sits on top.
  const glowWobble = Math.sin(now * 0.7)
  const glowR = 1.72 + glowWobble * 0.03
  const glowLayers: ReadonlyArray<{ rr: number; alpha: number }> = [
    { rr: glowR, alpha: 0.1 }, // outermost fade
    { rr: 1.5, alpha: 0.16 },
    { rr: 1.3, alpha: 0.24 },
    { rr: 1.12, alpha: 0.3 }, // brightest: hugs the body
  ]
  for (const layer of glowLayers) {
    g.fillStyle(pal.glow, layer.alpha + glowWobble * 0.02)
    g.fillCircle(cx, cy, r * layer.rr)
  }

  // ---- DORSAL FIN — the shark's signature silhouette: one clean
  // back-swept sweep rising to ~0.9r above the contour top, tucked
  // behind the body. Flattens with fear. ----
  const finH = r * (0.9 - 0.3 * panic)
  const topY = cy - r * 0.92
  g.fillStyle(pal.back, 1)
  g.beginPath()
  // Leading edge: a long taut ramp up to the tip (swept back like a
  // real dorsal).
  g.moveTo(cx - r * 0.32, topY + r * 0.22)
  quadFrom(g, cx - r * 0.32, topY + r * 0.22, cx - r * 0.1, topY - finH * 0.6, cx + r * 0.5, topY - finH)
  // Trailing edge: a steep, slightly concave drop to the base.
  quadFrom(g, cx + r * 0.5, topY - finH, cx + r * 0.38, topY - finH * 0.3, cx + r * 0.58, topY + r * 0.22)
  g.closePath()
  g.fillPath()
  g.lineStyle(ink * 0.8, INK, 1)
  g.strokePath()
  // Fin inner tint: a lighter sweep low inside the fin (depth).
  g.fillStyle(pal.fin, 0.7)
  g.beginPath()
  g.moveTo(cx - r * 0.16, topY + r * 0.14)
  quadFrom(g, cx - r * 0.16, topY + r * 0.14, cx - r * 0.04, topY - finH * 0.34, cx + r * 0.28, topY - finH * 0.62)
  g.lineTo(cx + r * 0.32, topY + r * 0.14)
  g.closePath()
  g.fillPath()

  // ---- TAIL FIN — a swept-back two-lobe tail (heterocercal, like the
  // real thing): the upper lobe sweeps up-left to a point ~0.4r past
  // the body edge, the lower lobe is shorter. Anchored at the LEFT of
  // the ball (the shark's rear, away from the face); its root tucks
  // under the body fill. Flattens with fear (tailS shrinks toward 0). --
  const tailX = cx - r * 0.66
  const tailY = cy - r * 0.01
  // tailS is a UNITLESS 0..1 scale on the outer points (not pixels).
  const tailS = 1.0 - 0.35 * panic
  g.fillStyle(pal.back, 1)
  g.beginPath()
  g.moveTo(tailX, tailY - r * 0.18)
  // Upper lobe: leading edge sweeps out to the tail tip...
  quadFrom(g, tailX, tailY - r * 0.18, tailX - r * 0.36 * tailS, tailY - r * 0.36 * tailS, tailX - r * 0.72 * tailS, tailY - r * 0.33 * tailS)
  // ...then the trailing edge notches back in (the fork).
  quadFrom(g, tailX - r * 0.72 * tailS, tailY - r * 0.33 * tailS, tailX - r * 0.4 * tailS, tailY - r * 0.16 * tailS, tailX - r * 0.36 * tailS, tailY - r * 0.02)
  // Lower lobe: shorter, angled down-left.
  quadFrom(g, tailX - r * 0.36 * tailS, tailY - r * 0.02, tailX - r * 0.48 * tailS, tailY + r * 0.12 * tailS, tailX - r * 0.44 * tailS, tailY + r * 0.3 * tailS)
  // And home along the underside of the root.
  quadFrom(g, tailX - r * 0.44 * tailS, tailY + r * 0.3 * tailS, tailX - r * 0.18 * tailS, tailY + r * 0.18, tailX, tailY + r * 0.16)
  g.closePath()
  g.fillPath()
  g.lineStyle(ink * 0.8, INK, 1)
  g.strokePath()

  // ---- THE BODY — the contour, countershaded: grey back, light belly
  // split by a clean WAVY boundary (the classic shark line). ----
  if (poly && poly.length >= 3) {
    g.fillStyle(pal.back, 1)
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillStyle(pal.back, 1)
    g.fillCircle(cx, cy, r)
  }
  // The belly: the classic shark countershading line — a gentle WAVY
  // boundary across the body, everything below it light. The belly
  // path is left rim → 4 quadratic wave humps to the right rim →
  // around the bottom rim back to the left rim. Geometrically exact to
  // the circle fallback; under the wobbled contour the ink outline
  // (drawn last over everything) covers the ≤1.5px wobble overhang.
  const bellyY = cy + r * 0.28
  const waveSegs = 4
  const waveAmp = r * 0.05
  g.fillStyle(pal.belly, 1)
  g.beginPath()
  g.moveTo(cx - r, bellyY)
  for (let i = 0; i < waveSegs; i++) {
    const x0 = cx - r + (i / waveSegs) * 2 * r
    const x1 = cx - r + ((i + 1) / waveSegs) * 2 * r
    const dir = i % 2 === 0 ? -1 : 1
    quadFrom(g, x0, bellyY, (x0 + x1) / 2, bellyY + waveAmp * dir, x1, bellyY)
  }
  g.arc(cx, cy, r, 0, Math.PI, false)
  g.closePath()
  g.fillPath()
  // Back highlight: a subtle lighter-grey sheen across the upper back,
  // drawn as a wide shallow arc BAND bounded below by the wave line —
  // built as its own path (outer sweep + inner sweep) so it can never
  // bleed across the countershading boundary.
  g.fillStyle(pal.backLight, 0.85)
  g.beginPath()
  // Outer sweep: along the top rim from left to right.
  g.arc(cx, cy, r * 0.86, Math.PI * 1.12, Math.PI * 1.88, false)
  // Inner sweep: back along a shallower arc above the wave line.
  for (let s = 8; s >= 0; s--) {
    const t = s / 8
    const th = Math.PI * (1.12 + (1.88 - 1.12) * t)
    const hx = cx + Math.cos(th) * r * 0.62
    const hy = cy + Math.sin(th) * r * 0.62
    const boundY = Math.max(bellyY - waveAmp, hy)
    g.lineTo(hx, boundY)
  }
  g.closePath()
  g.fillPath()

  // ---- GILL SLITS — three short ink arcs on the cheek, slightly
  // arced with the body. ----
  g.lineStyle(ink * 0.65, INK, 0.85)
  for (let i = 0; i < 3; i++) {
    const gx = cx - r * 0.52 + i * r * 0.13
    const gy = cy + r * 0.05
    g.beginPath()
    g.arc(gx, gy - r * 0.14, r * 0.18, Math.PI * 0.28, Math.PI * 0.72, false)
    g.strokePath()
  }

  // ---- THE MOUTH — a clean open smile: one smooth gum wedge (top arc
  // smiles down into the jaw arc, both tapering to points at the
  // corners) with four white teeth hanging from the top curve. Clamps
  // shut with fear. ----
  const mouthW = r * 0.72
  const mouthY = cy + r * 0.34
  const topDip = r * 0.08
  const jawDrop = r * 0.3 * open
  // y on the mouth arcs at param t (0..1 across the mouth).
  const arcY = (t: number, dy0: number, dip: number): number => {
    return mouthY + dy0 + dip * (1 - (2 * t - 1) * (2 * t - 1))
  }
  if (open > 0.05) {
    // The wedge: top arc left→right, jaw arc right→left.
    g.beginPath()
    const halfW = mouthW / 2
    g.moveTo(cx - halfW, arcY(0, -topDip * 0.3, topDip))
    for (let s = 1; s <= 8; s++) {
      const t = s / 8
      g.lineTo(cx - halfW + mouthW * t, arcY(t, -topDip * 0.3, topDip))
    }
    for (let s = 8; s >= 0; s--) {
      const t = s / 8
      g.lineTo(cx - halfW + mouthW * t, arcY(t, topDip * 0.4, jawDrop))
    }
    g.closePath()
    g.fillStyle(pal.gum, 1)
    g.fillPath()
    g.lineStyle(ink * 1.0, INK, 1)
    g.strokePath()
    // Four white teeth hanging from the top curve — even sizes, evenly
    // spaced, tucked just under the lip.
    g.fillStyle(0xffffff, 1)
    for (let i = 0; i < 4; i++) {
      const t = 0.18 + (i / 3) * 0.64
      const tx = cx - halfW + mouthW * t
      const ty = arcY(t, -topDip * 0.3, topDip) + ink * 0.25
      const th = r * 0.12 * open
      const tw = (mouthW / 4) * 0.32
      g.beginPath()
      g.moveTo(tx - tw, ty)
      g.lineTo(tx + tw, ty)
      g.lineTo(tx, ty + th)
      g.closePath()
      g.fillPath()
    }
  } else {
    // Mouth clamped (fear): a tense short line, still a grin shape.
    g.lineStyle(ink * 1.0, INK, 1)
    g.beginPath()
    g.moveTo(cx - mouthW * 0.3, mouthY)
    quadFrom(g, cx - mouthW * 0.3, mouthY, cx, mouthY + r * 0.05, cx + mouthW * 0.3, mouthY)
    g.strokePath()
  }

  // ---- THE EYES — the game's standard eye pair (white sclera, chunky
  // ink rim, one dark oval pupil, main + secondary glints, wink easter
  // egg) with the SHARK TWIST: a temporary clear nictitating membrane —
  // the translucent third eyelid sharks use — slides over each eye. It
  // is also the fear tell: as panic climbs, the membranes sweep half
  // across the eyes (a shark about to bite), and the standard panic
  // morph (wide eyes, pupils pinned up) plays underneath.
  const L = faceLayoutFor(look, r, 1, gaze)
  const eyeDx = r * 0.35
  const eyeY = cy - r * 0.22
  // Panic morph on the pupils (mirrors drawBallFace's): pinned upward,
  // shrinking, as fear climbs.
  const em = Math.min(1, panic * 1.0)
  const up = 0.45 * em
  for (const [i, e] of L.eyes.entries()) {
    const ex = cx + e.x * 1.0
    const ey = eyeY + e.y
    // The standard eye, verbatim proportions from faceLayoutFor.
    if (exprShark === 'wink' && i === 1) {
      g.lineStyle(e.rim * 0.95, INK, 1)
      const lid: Array<{ x: number; y: number }> = []
      for (let s = 0; s <= 12; s++) {
        const u = -1 + (2 * s) / 12
        lid.push({ x: ex + u * e.a * 0.85, y: ey - e.b * 0.05 + (1 - u * u) * e.b * 0.4 })
      }
      g.strokePoints(lid as unknown as Phaser.Math.Vector2[], false, false)
      continue
    }
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(ex, ey, e.a * 2, e.b * 2)
    g.lineStyle(e.rim, INK, 1)
    g.strokeEllipse(ex, ey, e.a * 2, e.b * 2)
    // Pupil: pinned up + shrunk with panic (the standard morph).
    const pb = e.pb * (1 - 0.35 * em)
    const py = e.py * (1 - em) - up * (e.b - pb - e.rim * 0.5) * em
    g.fillStyle(INK, 1)
    g.fillEllipse(ex + e.px, ey + py, e.pa * 2, pb * 2)
    // Main highlight + tiny secondary dot (the standard pair).
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(ex + e.px - e.pa * 0.32, ey + py - pb * 0.34, e.pa * 0.6, e.pa * 0.6, 24)
    g.fillEllipse(ex + e.px - e.pa * 0.1, ey + py - pb * 0.38, e.pa * 0.24, e.pa * 0.24, 16)
    // THE TWIST: the nictitating membrane — a translucent grey-blue
    // shark eyelid sliding over the eye from the front. At rest it sits
    // as a thin crescent at the eye's leading edge (the shark read);
    // with panic it sweeps to ~60% coverage (fear blink).
    const sweep = 0.22 + 0.5 * em
    g.fillStyle(0x9db8c9, 0.4 + 0.25 * em)
    // Centred so the membrane's outer edge lands exactly ON the sclera's
    // leading edge (the audit fix — the old offset spilled a·s/2 past the
    // eye, reading as a random circle beside it).
    g.fillEllipse(ex - e.a * (1 - sweep), ey, e.a * sweep * 2, e.b * sweep * 2)
  }
  // Fear sweat: one drop at the temple as panic climbs.
  if (panic > 0.45) {
    const sweat = Math.min(1, (panic - 0.45) / 0.55)
    g.fillStyle(0x9fdcff, 0.95 * sweat)
    g.fillCircle(cx + r * 0.56, eyeY - r * 0.3, r * 0.055 * (0.7 + 0.3 * sweat))
  }
  // Cheek patches: subtle grey-blue, tucked under the eyes INSIDE the
  // contour (they used to poke past the rim — 'random circles').
  g.fillStyle(pal.cheek, 0.5 * (1 - panic))
  g.fillEllipse(cx - eyeDx - r * 0.22, eyeY + r * 0.34, r * 0.44, r * 0.24)
  g.fillEllipse(cx + eyeDx + r * 0.22, eyeY + r * 0.34, r * 0.44, r * 0.24)

  // ---- THE INK OUTLINE — the contour itself, over everything. ----
  g.lineStyle(thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r), INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }



}

export interface PigPalette {
  /** Back / body (the deeper pink). */
  back: number
  /** Belly (the light pink underside). */
  belly: number
  /** Snout disc (a deeper rosy pink than the body). */
  snout: number
  /** Inner-ear tint. */
  ear: number
  /** Cheek blush. */
  cheek: number
  /** The reward halo's colour (behind the whole ball). */
  glow: number
}

/**
 * The pig palettes, exported alongside SHARK_PALETTES (journal/QA parity).
 * Variant picks one; the per-run THEME roll picks shark vs pig first.
 */
export const PIG_PALETTES: readonly PigPalette[] = [
  { back: 0xf2a2b0, belly: 0xfde3e8, snout: 0xe88ca0, ear: 0xf7bfc9, cheek: 0xef8fa2, glow: 0xffc9d6 }, // 0: barnyard pink
  { back: 0xf6c6a5, belly: 0xfdeedd, snout: 0xeaa98c, ear: 0xfbd7bd, cheek: 0xf0a084, glow: 0xffdcc3 }, // 1: cream
  { back: 0xe98aa6, belly: 0xfbd8e2, snout: 0xd7718f, ear: 0xf2adc0, cheek: 0xe2799a, glow: 0xffc2d1 }, // 2: rose
  { back: 0xf7b1a0, belly: 0xfde6dc, snout: 0xeb9483, ear: 0xfcccbf, cheek: 0xf19383, glow: 0xffd3c4 }, // 3: peach
  { back: 0xd9a3c9, belly: 0xf4dff0, snout: 0xc788b6, ear: 0xe9bede, cheek: 0xd192bd, glow: 0xf2c8e8 }, // 4: lilac
  { back: 0xf2c14e, belly: 0xfbecc2, snout: 0xe0a83c, ear: 0xf8d77e, cheek: 0xeda93f, glow: 0xffe6a1 }, // 5: golden
]

/**
 * Draw the Tier 9 PIG ball — the second tier-9 theme: a round pink
 * pig-slime with countershading (deeper pink back, light belly), two
 * folded ears, a curly spiral tail sweeping off the LEFT side (~0.37r
 * past the body edge), a snout with nostrils, rosy cheeks and a soft
 * warm-pink glow.
 *
 * SAME CONTRACT as drawSharkBall: the body is the ball's CONTOUR (pass
 * `poly`; without it a circle of radius r at (cx, cy)); the FACE is part
 * of the design (callers must NOT draw the standard face on top).
 *
 * FEAR: `panic` widens the eyes, twitches the snout (a small independent
 * jitter against the face), droops the ears and tail, and adds a sweat
 * drop. The eyes are the STANDARD pair (panic morph + wink easter egg)
 * — no nictitating membranes; the pig twist is a natural closed-lid
 * BLINK: quick lid arcs on both eyes every few seconds.
 */
export function drawPigBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  thumbnail = false,
): void {
  const pal = PIG_PALETTES[variant % PIG_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(2, r * 0.05)
  const now = Date.now() / 1000
  // The easter-egg expression (wink) rides the same timeline as the
  // other balls — suppressed while panicking (fear wins).
  const exprPig = panic > 0.45 ? 'normal' : expressionAt(seed, now * 1000)
  const jx = Math.sin(now * 43) * r * 0.02 * panic * panic
  const jy = Math.cos(now * 37) * r * 0.015 * panic * panic
  cx += jx
  cy += jy

  // ---- THE GLOW — the same soft radial stack as the shark, tinted to
  // the palette's warm pink: 4 concentric discs, widest first, each
  // smaller AND brighter, with a gentle ~9s breath. Drawn FIRST. ----
  const glowWobble = Math.sin(now * 0.7)
  const glowLayers: ReadonlyArray<{ rr: number; alpha: number }> = [
    { rr: 1.72 + glowWobble * 0.03, alpha: 0.1 },
    { rr: 1.5, alpha: 0.16 },
    { rr: 1.3, alpha: 0.24 },
    { rr: 1.12, alpha: 0.3 },
  ]
  for (const layer of glowLayers) {
    g.fillStyle(pal.glow, layer.alpha + glowWobble * 0.02)
    g.fillCircle(cx, cy, r * layer.rr)
  }

  // ---- EARS — two folded triangles on top, tucked behind the body.
  // The bases anchor to the CONTOUR's top region so they track the
  // wobble (fixed-position ears glitched as the body wobbled over them),
  // and they use the SAME ink width as the ball's outline. ----
  const earS = 1 - 0.45 * panic
  // The contour's top vertex — the anchor both ears hang from.
  let earBaseY = cy - r
  if (poly && poly.length >= 8) {
    let top = poly[0]!
    for (const p of poly) if (p.y < top.y) top = p
    earBaseY = top.y
  }
  const earOut = thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r)
  for (const s of [-1, 1]) {
    const ecx = cx + s * r * 0.42
    const ecy = earBaseY + r * 0.3
    const tipX = ecx + s * r * 0.22
    const tipY = ecy - r * 0.58 * earS
    g.fillStyle(pal.back, 1)
    g.beginPath()
    // Outer edge: a clean ramp up to the folded tip...
    g.moveTo(ecx - r * 0.26, ecy + r * 0.2)
    quadFrom(g, ecx - r * 0.26, ecy + r * 0.2, ecx - r * 0.3, tipY + r * 0.12, tipX, tipY)
    // ...inner edge back down to the base (the base sits deep inside the
    // body, so the body fill hides the seam, never the outline).
    quadFrom(g, tipX, tipY, tipX + s * r * 0.16, tipY + r * 0.16, ecx + r * 0.3, ecy + r * 0.2)
    g.closePath()
    g.fillPath()
    // Inner-ear tint: a smaller fold inside the outer shape.
    const iTipX = ecx + (tipX - ecx) * 0.5
    const iTipY = ecy + (tipY - ecy) * 0.55
    g.fillStyle(pal.ear, 0.9)
    g.beginPath()
    g.moveTo(ecx - r * 0.13, ecy + r * 0.05)
    quadFrom(g, ecx - r * 0.13, ecy + r * 0.05, ecx - r * 0.14, iTipY + r * 0.06, iTipX, iTipY)
    quadFrom(g, iTipX, iTipY, iTipX + s * r * 0.1, iTipY + r * 0.1, ecx + r * 0.16, ecy + r * 0.02)
    g.closePath()
    g.fillPath()
    // The ear's ink outline — SAME width as the ball's, drawn AFTER the
    // fills so the stroke sits on top of the ear's own colour (the old
    // version stroked between fill and body fill, and the body fill
    // chopped the stroke into glitchy fragments).
    g.lineStyle(earOut, INK, 1)
    g.beginPath()
    g.moveTo(ecx - r * 0.26, ecy + r * 0.2)
    quadFrom(g, ecx - r * 0.26, ecy + r * 0.2, ecx - r * 0.3, tipY + r * 0.12, tipX, tipY)
    quadFrom(g, tipX, tipY, tipX + s * r * 0.16, tipY + r * 0.16, ecx + r * 0.3, ecy + r * 0.2)
    g.closePath()
    g.strokePath()
  }


  // ---- THE BODY — the contour, countershaded: deeper pink back, light
  // belly split by a gentle WAVY boundary (the shark's proven belly
  // geometry, recoloured). ----
  if (poly && poly.length >= 3) {
    g.fillStyle(pal.back, 1)
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillStyle(pal.back, 1)
    g.fillCircle(cx, cy, r)
  }
  const bellyY = cy + r * 0.26
  const waveSegs = 4
  const waveAmp = r * 0.04
  g.fillStyle(pal.belly, 1)
  g.beginPath()
  g.moveTo(cx - r, bellyY)
  for (let i = 0; i < waveSegs; i++) {
    const x0 = cx - r + (i / waveSegs) * 2 * r
    const x1 = cx - r + ((i + 1) / waveSegs) * 2 * r
    const dir = i % 2 === 0 ? -1 : 1
    quadFrom(g, x0, bellyY, (x0 + x1) / 2, bellyY + waveAmp * dir, x1, bellyY)
  }
  g.arc(cx, cy, r, 0, Math.PI, false)
  g.closePath()
  g.fillPath()
  // Back sheen: a subtle lighter band across the upper back (the pig's
  // counterpart of the shark's backLight sweep), bounded below by the
  // wave line so it can never bleed across the countershading.
  g.fillStyle(pal.belly, 0.45)
  g.beginPath()
  g.arc(cx, cy, r * 0.86, Math.PI * 1.12, Math.PI * 1.88, false)
  for (let s = 8; s >= 0; s--) {
    const t = s / 8
    const th = Math.PI * (1.12 + (1.88 - 1.12) * t)
    const hx = cx + Math.cos(th) * r * 0.62
    const hy = cy + Math.sin(th) * r * 0.62
    g.lineTo(hx, Math.max(bellyY - waveAmp, hy))
  }
  g.closePath()
  g.fillPath()

  // ---- CURLY TAIL — the pig's signature from the kid's movies: a
  // side-view HELIX. The tail exits the body at the LEFT and extends
  // leftward while oscillating up/down — 2.5 clean loops of a sine
  // wave, each loop clearly separated (a corkscrew seen exactly from
  // the side). ONE smooth ink line, 48 points, thin. Loosens with
  // fear (loops open and droop). ----
  const tailY0 = cy - r * 0.08
  const tailS = 1 - 0.35 * panic
  const tailN = 52
  const turns = 2.0
  // Total leftward extent: ~0.55r past the body edge.
  const extent = r * 0.6 * tailS
  // Loop amplitude: the half-height of the corkscrew's loops.
  const amp = r * 0.34 * tailS
  const tailPts: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= tailN; i++) {
    const t = i / tailN
    // The phase advances 2.5 full turns across the extent; a phase
    // offset of π/2 starts the tail curling UP (the pig-tail read).
    const px = cx - r - extent * t
    const py = tailY0 + Math.sin(t * turns * Math.PI * 2 + Math.PI / 2) * amp - t * r * 0.1 * tailS
    tailPts.push({ x: px, y: py })
  }
  g.lineStyle(thumbnail ? collectionInkWidth(r) : Math.max(2.5, r * 0.07), INK, 1)
  g.strokePoints(tailPts as unknown as Phaser.Math.Vector2[], false, false)

  // ---- ROSY CHEEKS REMOVED (user: cheek circles don't look good). ----

  // ---- THE FACE — one integrated pig face: two eyes with soft pink
  // upper-lid arcs high on the face, the snout seated BETWEEN and below
  // them, and a small open smile with a tiny tongue under the snout.
  // One coordinated pass — the face reads as a whole. ----
  const eyeY = cy - r * 0.3
  const eyeDx = r * 0.42

  // THE SNOUT — seated between the eyes, low.
  const snoutX = cx + Math.sin(now * 53) * r * 0.022 * panic * panic
  const snoutY = cy + r * 0.1 + Math.cos(now * 47) * r * 0.012 * panic * panic
  const snoutW = r * 0.56
  const snoutH = r * 0.4
  g.fillStyle(pal.snout, 1)
  g.fillEllipse(snoutX, snoutY, snoutW, snoutH)
  g.lineStyle(ink * 0.95, INK, 1)
  g.strokeEllipse(snoutX, snoutY, snoutW, snoutH)
  // Nostrils.
  g.fillStyle(INK, 0.9)
  g.fillEllipse(snoutX - snoutW * 0.17, snoutY + snoutH * 0.05, r * 0.075, r * 0.14)
  g.fillEllipse(snoutX + snoutW * 0.17, snoutY + snoutH * 0.05, r * 0.075, r * 0.14)
  // Snout highlight.
  g.fillStyle(0xffffff, 0.22)
  g.fillEllipse(snoutX - snoutW * 0.15, snoutY - snoutH * 0.22, snoutW * 0.48, snoutH * 0.34)

  // THE EYES — the standard pair, seated above the snout with a soft
  // pink upper-lid arc over each (the hooded pig look). Panic widens
  // them; the blink/wink close them.
  const L = faceLayoutFor(look, r, 1, gaze)
  const em = Math.min(1, panic)
  const up = 0.45 * em
  const blinkMs = (now * 1000 + seed * 1013) % 4700
  const blinking = panic <= 0.45 && blinkMs < 130
  for (const [i, e] of L.eyes.entries()) {
    const exF = cx + eyeDx * (i === 0 ? -1 : 1)
    const ey = eyeY + e.y * 0.6
    const closed = blinking || (exprPig === 'wink' && i === 1)
    if (closed) {
      // Closed lid: one downward ink arc across the eye.
      g.lineStyle(e.rim * 0.95, INK, 1)
      const lid: Array<{ x: number; y: number }> = []
      for (let s = 0; s <= 12; s++) {
        const u = -1 + (2 * s) / 12
        lid.push({ x: exF + u * e.a * 0.85, y: ey - e.b * 0.05 + (1 - u * u) * e.b * 0.4 })
      }
      g.strokePoints(lid as unknown as Phaser.Math.Vector2[], false, false)
      continue
    }
    // Sclera + rim, widened with panic.
    const wa = e.a * (1 + 0.12 * em)
    const wb = e.b * (1 + 0.2 * em)
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(exF, ey, wa * 2, wb * 2)
    g.lineStyle(e.rim, INK, 1)
    g.strokeEllipse(exF, ey, wa * 2, wb * 2)
    // Pupil: pinned up + shrunk with panic (the standard morph).
    const pb = e.pb * (1 - 0.35 * em)
    const py = e.py * (1 - em) - up * (e.b - pb - e.rim * 0.5) * em
    g.fillStyle(INK, 1)
    g.fillEllipse(exF + e.px, ey + py, e.pa * 2, pb * 2)
    // Main highlight + tiny secondary dot (the standard pair).
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(exF + e.px - e.pa * 0.32, ey + py - pb * 0.34, e.pa * 0.6, e.pa * 0.6, 24)
    g.fillEllipse(exF + e.px - e.pa * 0.1, ey + py - pb * 0.38, e.pa * 0.24, e.pa * 0.24, 16)
    // The soft upper-lid arc: a pink stroke hugging the eye's top —
    // the hooded pig expression that ties the face together.
    g.lineStyle(e.rim * 0.7, pal.ear, 0.9)
    g.beginPath()
    g.arc(exF, ey, wb * 1.05, Math.PI * 1.15, Math.PI * 1.85, false)
    g.strokePath()
  }

  // THE MOUTH — a small open smile under the snout, with a tiny tongue
  // when happy. Flattens toward a tense line as panic climbs.
  const mTop = snoutY + snoutH * 0.62
  const dip = r * (0.1 - 0.07 * panic)
  g.lineStyle(ink * 1.0, INK, 1)
  g.beginPath()
  g.moveTo(cx - r * 0.2, mTop)
  quadFrom(g, cx - r * 0.2, mTop, cx, mTop + dip, cx + r * 0.2, mTop)
  g.strokePath()
  if (panic < 0.3) {
    // Tiny tongue: a small pink half-ellipse under the smile's centre.
    g.fillStyle(0xff9eb5, 0.95)
    g.fillEllipse(cx, mTop + dip * 0.72, r * 0.16, r * 0.1)
  }

  // ---- THE INK OUTLINE — the contour itself, over everything. ----
  g.lineStyle(thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r), INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }
}

export interface RoboPalette {
  /** Body (lavender/purple-blue TV casing). */
  body: number
  /** Body highlight (lighter, upper-left casing band). */
  bodyLight: number
  /** Body shading (deeper slate-purple, lower casing + bezel recess). */
  bodyDark: number
  /** Screen (bright cyan TV face). */
  screen: number
  /** Screen shading (darker blue, lower/right inner border). */
  screenDark: number
  /** Antenna stem (light icy blue-white). */
  antenna: number
  /** Antenna tip (golden yellow). */
  antennaTip: number
  /** Upper side button (bright red). */
  buttonRed: number
  /** Lower side button (golden yellow). */
  buttonYellow: number
  /** The reward halo's colour (behind the whole ball). */
  glow: number
}

/** The robo palettes, exported alongside SHARK/PIG/DRUNKO (journal/QA parity).
 *  Variant picks one; the per-run THEME roll picks the family first. */
export const ROBO_PALETTES: readonly RoboPalette[] = [
  { body: 0x6f76b8, bodyLight: 0x9aa2de, bodyDark: 0x50568e, screen: 0x55d4fa, screenDark: 0x36b2e3, antenna: 0xcfd8f8, antennaTip: 0xffc01d, buttonRed: 0xf0483e, buttonYellow: 0xffc01d, glow: 0xb8c0f8 }, // 0: periwinkle
  { body: 0x5f66a8, bodyLight: 0x8a92ce, bodyDark: 0x40467e, screen: 0x4dc4ea, screenDark: 0x2ea2d3, antenna: 0xbfc8e8, antennaTip: 0xf0b00d, buttonRed: 0xe0382e, buttonYellow: 0xf0b00d, glow: 0xa8b0e8 }, // 1: deeper purple
  { body: 0x7f86c8, bodyLight: 0xaab2ee, bodyDark: 0x60669e, screen: 0x65e4ff, screenDark: 0x46c2f3, antenna: 0xdfe8ff, antennaTip: 0xffd02d, buttonRed: 0xff584e, buttonYellow: 0xffd02d, glow: 0xc8d0ff }, // 2: lighter lavender
]

// Draw calls record their numeric paths synchronously; all Robo balls can
// share this retained scratch without masking the shared Graphics layer.
const roboBodyClipper = new BodyFillClipper()

/**
 * Draw the Tier 9 ROBO ball — a cute retro-futuristic spherical robot with
 * a television screen for a face. Lavender/purple-blue body, cyan screen
 * with rounded corners, two big expressive eyes, small smile, two antennae
 * with yellow tips, and two side buttons (red + yellow) on the right.
 *
 * SAME CONTRACT as drawSharkBall/drawPigBall: the body is the ball's
 * CONTOUR (pass `poly`; without it a circle of radius r at (cx, cy)); the
 * FACE is part of the design (callers must NOT draw the standard face on
 * top).
 *
 * FEAR: `panic` widens the eyes, pins pupils upward, and flattens the
 * smile. The eyes are the STANDARD pair (panic morph + wink easter egg).
 * Character-specific easter eggs: occasional screen flicker, curious
 * widened eyes, and a subtle antenna tip bounce.
 */
// ---------------------------------------------------------------------------
// Robo antenna spring state — zero-allocation per-seed spring physics.
// ---------------------------------------------------------------------------

/** Per-antenna spring state (lateral sway + vertical bend). */
interface RoboAntennaSpring {
  /** Lateral tip deflection (r units). */
  sway: number
  swayVel: number
  /** Vertical/radial bend from landing impact (r units, positive = down/out). */
  bend: number
  bendVel: number
}

/** Per-ball robo antenna state; preview draws never create or advance it. */
interface RoboAntennaState {
  prevCx: number
  prevCy: number
  prevVx: number
  prevVy: number
  prevPanic: number
  prevAspectY: number
  prevTimeMs: number
  initialized: boolean
  left: RoboAntennaSpring
  right: RoboAntennaSpring
}

const roboAntennaStates = new Map<number, RoboAntennaState>()

function getRoboAntennaState(ballId: number): RoboAntennaState {
  let s = roboAntennaStates.get(ballId)
  if (!s) {
    s = {
      prevCx: 0, prevCy: 0, prevVx: 0, prevVy: 0,
      prevPanic: 0, prevAspectY: 1, prevTimeMs: 0, initialized: false,
      left: { sway: 0, swayVel: 0, bend: 0, bendVel: 0 },
      right: { sway: 0, swayVel: 0, bend: 0, bendVel: 0 },
    }
    roboAntennaStates.set(ballId, s)
  }
  return s
}

/** Remove state when a gameplay ball leaves the renderer. */
export function dropRoboAntennaState(ballId: number): void {
  roboAntennaStates.delete(ballId)
}

/** Clear all gameplay antenna states (renderer clear/restart). */
export function clearRoboAntennaStates(): void {
  roboAntennaStates.clear()
}

function isReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export function notifyRoboImpact(ballId: number, nx: number, ny: number, strength: number): void {
  if (isReducedMotion()) return
  const s = getRoboAntennaState(ballId)
  const vertical = Math.max(0, -ny) * strength
  const horizontal = -nx * strength
  const kick = 0.35 + strength * 0.65
  s.left.bendVel += vertical * kick * 2.2
  s.right.bendVel += vertical * kick * 2.0
  s.left.swayVel += horizontal * kick * 1.8
  s.right.swayVel += horizontal * kick * 1.6
}


/**
 * Advance the robo antenna springs one frame.
 * Tracks (cx, cy, poly, panic) to derive velocity, acceleration, landing,
 * direction changes, and fear — then drives underdamped Hooke springs.
 * Returns the current sway/bend for both antennae (in r units).
 */
interface RoboAntennaOutput {
  swayL: number
  bendL: number
  swayR: number
  bendR: number
}

const ROBO_REST_ANTENNA: RoboAntennaOutput = { swayL: 0, bendL: 0, swayR: 0, bendR: 0 }
const roboAntennaOutput: RoboAntennaOutput = { swayL: 0, bendL: 0, swayR: 0, bendR: 0 }

function stepRoboAntennaSpring(
  ballId: number | undefined,
  seed: number,
  cx: number,
  cy: number,
  r: number,
  poly: Array<{ x: number; y: number }> | undefined,
  panic: number,
  nowMs: number,
): RoboAntennaOutput {
  if (ballId === undefined) return ROBO_REST_ANTENNA
  const s = getRoboAntennaState(ballId)
  let aspectY = 1
  if (poly && poly.length >= 3) {
    let minY = poly[0]!.y, maxY = poly[0]!.y
    for (const p of poly) {
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    aspectY = (maxY - minY) / (2 * r)
  }
  if (!s.initialized) {
    s.prevCx = cx
    s.prevCy = cy
    s.prevPanic = panic
    s.prevAspectY = aspectY
    s.prevTimeMs = nowMs
    s.initialized = true
    roboAntennaOutput.swayL = s.left.sway
    roboAntennaOutput.bendL = s.left.bend
    roboAntennaOutput.swayR = s.right.sway
    roboAntennaOutput.bendR = s.right.bend
    return roboAntennaOutput
  }
  const dt = Math.min(0.05, Math.max(0.001, (nowMs - s.prevTimeMs) / 1000))
  s.prevTimeMs = nowMs
  // --- Track velocity & acceleration ---
  const vx = (cx - s.prevCx) / (dt * r)
  const vy = (cy - s.prevCy) / (dt * r)
  const dvx = vx - s.prevVx
  const dvy = vy - s.prevVy
  s.prevCx = cx
  s.prevCy = cy
  s.prevVx = vx
  s.prevVy = vy

  const dAspect = aspectY - s.prevAspectY
  s.prevAspectY = aspectY


  // --- Track fear ---
  const dPanic = panic - s.prevPanic
  s.prevPanic = panic

  if (isReducedMotion()) {
    // Hold rest pose; no excitation.
    s.left.sway = 0; s.left.swayVel = 0; s.left.bend = 0; s.left.bendVel = 0
    s.right.sway = 0; s.right.swayVel = 0; s.right.bend = 0; s.right.bendVel = 0
    roboAntennaOutput.swayL = 0
    roboAntennaOutput.bendL = 0
    roboAntennaOutput.swayR = 0
    roboAntennaOutput.bendR = 0
    return roboAntennaOutput

  }
  // --- Spring parameters (underdamped, slightly different per antenna) ---
  const kL = 11.5 * 11.5, cL = 2 * 0.28 * 11.5
  const kR = 13.2 * 13.2, cR = 2 * 0.28 * 13.2

  // --- Idle wandering target (gentle multi-frequency sway) ---
  const t = nowMs / 1000
  const idleL = Math.sin(t * 1.7 + seed * 0.7) * 0.022 + Math.sin(t * 2.9 + 1.3) * 0.014
  const idleR = Math.sin(t * 1.9 + seed * 0.7 + 0.9) * 0.020 + Math.sin(t * 3.1 + 2.1) * 0.012

  // --- Landing impulse: strong upward deceleration + vertical squash ---
  const landingImpulse = Math.max(0, -dvy) * 0.55 + Math.max(0, -dAspect) * 3.2
  if (landingImpulse > 0.02) {
    s.left.bendVel += landingImpulse * 1.9
    s.right.bendVel += landingImpulse * 1.7
  }

  // --- Collision impulse: any sudden velocity change ---
  const collisionImpulse = Math.hypot(dvx, dvy) * 0.35
  if (collisionImpulse > 0.03) {
    s.left.swayVel += -dvx * 0.9
    s.right.swayVel += -dvx * 0.8
    s.left.bendVel += Math.max(0, -dvy) * 0.9
    s.right.bendVel += Math.max(0, -dvy) * 0.8
  }

  // --- Direction change: inertial lag opposite to horizontal acceleration ---
  const dirLag = -dvx * 0.28
  s.left.swayVel += dirLag
  s.right.swayVel += dirLag * 0.9

  // --- Fear: startled perk-up on panic rise, slight straighten while high ---
  if (dPanic > 0.02) {
    s.left.bendVel -= dPanic * 1.4
    s.right.bendVel -= dPanic * 1.2
  }
  const fearStraighten = panic > 0.1 ? panic * 0.06 : 0

  // --- Integrate springs (semi-implicit Euler) ---
  // Left sway
  const targetL = idleL + fearStraighten * 0.3
  const accelSL = -kL * (s.left.sway - targetL) - cL * s.left.swayVel
  s.left.swayVel += accelSL * dt
  s.left.sway += s.left.swayVel * dt
  // Left bend
  const accelBL = -kL * s.left.bend - cL * s.left.bendVel
  s.left.bendVel += accelBL * dt
  s.left.bend += s.left.bendVel * dt
  // Right sway
  const targetR = idleR + fearStraighten * 0.25
  const accelSR = -kR * (s.right.sway - targetR) - cR * s.right.swayVel
  s.right.swayVel += accelSR * dt
  s.right.sway += s.right.swayVel * dt
  // Right bend
  const accelBR = -kR * s.right.bend - cR * s.right.bendVel
  s.right.bendVel += accelBR * dt
  s.right.bend += s.right.bendVel * dt

  // --- Clamp to avoid jitter/exaggeration ---
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  s.left.sway = clamp(s.left.sway, -0.22, 0.22)
  s.right.sway = clamp(s.right.sway, -0.22, 0.22)
  s.left.bend = clamp(s.left.bend, -0.16, 0.16)
  s.right.bend = clamp(s.right.bend, -0.16, 0.16)

  roboAntennaOutput.swayL = s.left.sway
  roboAntennaOutput.bendL = s.left.bend
  roboAntennaOutput.swayR = s.right.sway
  roboAntennaOutput.bendR = s.right.bend
  return roboAntennaOutput
}

/**
 * Draw the Tier 9 ROBO ball — a cute retro-futuristic spherical robot with
 * a television screen for a face. Lavender/purple-blue body, cyan screen
 * with rounded corners, two big expressive eyes, small smile, two antennae
 * with yellow tips, and two side buttons (red + yellow) on the right.
 *
 * SAME CONTRACT as drawSharkBall/drawPigBall: the body is the ball's
 * CONTOUR (pass `poly`; without it a circle of radius r at (cx, cy)); the
 * FACE is part of the design (callers must NOT draw the standard face on
 * top).
 *
 * FEAR: `panic` widens the eyes, pins pupils upward, and flattens the
 * smile. The eyes are the STANDARD pair (panic morph + wink easter egg).
 * Character-specific easter eggs: occasional screen flicker, curious
 * widened eyes, and springy antenna physics (idle sway, landing bend,
 * collision wobble, direction-change lag, fear straighten).
 */
export function drawRoboBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  ballId?: number,
  thumbnail = false,
): void {
  const pal = ROBO_PALETTES[variant % ROBO_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(2, r * 0.05)
  const out = thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r)
  const now = Date.now() / 1000
  const nowMs = Date.now()
  // The easter-egg expression (wink) rides the same timeline as the
  // other balls — suppressed while panicking (fear wins).
  const exprRobo = panic > 0.45 ? 'normal' : expressionAt(seed, now * 1000)
  const jx = Math.sin(now * 43) * r * 0.02 * panic * panic
  const jy = Math.cos(now * 37) * r * 0.015 * panic * panic
  cx += jx
  cy += jy

  // ---- Live contour extents (for squash/stretch tracking) ----
  let topY = cy - r
  let scaleX = 1
  let scaleY = 1
  if (poly && poly.length >= 3) {
    let minX = poly[0]!.x, maxX = poly[0]!.x, minY = poly[0]!.y, maxY = poly[0]!.y
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    scaleX = Math.max(0.78, Math.min(1.22, (maxX - minX) / (2 * r)))
    scaleY = Math.max(0.75, Math.min(1.22, (maxY - minY) / (2 * r)))
    // Top of the contour near x ≈ cx (for the dome mount anchor).
    let topNear = minY
    for (const p of poly) {
      if (Math.abs(p.x - cx) < r * 0.45 && p.y < topNear) topNear = p.y
    }
    topY = topNear
  }

  // ---- Antenna spring physics ----
  const ant = stepRoboAntennaSpring(ballId, seed, cx, cy, r, poly, panic, nowMs)

  // ---- THE GLOW — a faint atmospheric halo, drawn FIRST. Kept well
  // OUTSIDE the body silhouette language: wide, very low alpha, so it
  // reads as air/light — never as a second, larger purple body. (The
  // previous stack reached 1.72r at cumulative alpha ~0.8 and looked
  // like body fill spilling past the contour, especially the bottom
  // semicircle.)
  const glowWobble = Math.sin(now * 0.7)
  const glowLayers: ReadonlyArray<{ rr: number; alpha: number }> = [
    { rr: 1.42 + glowWobble * 0.02, alpha: 0.06 },
    { rr: 1.26, alpha: 0.08 },
  ]
  for (const layer of glowLayers) {
    g.fillStyle(pal.glow, layer.alpha + glowWobble * 0.01)
    g.fillCircle(cx, cy, r * layer.rr)
  }

  // ---- THE BODY — the contour, periwinkle TV casing with shading. ----
  if (poly && poly.length >= 3) {
    g.fillStyle(pal.body, 1)
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillStyle(pal.body, 1)
    g.fillCircle(cx, cy, r)
  }
  roboBodyClipper.setBody(poly, cx, cy, r)
  // Lower casing shadow crescent (deeper slate-purple).
  g.fillStyle(pal.bodyDark, 0.85)
  roboBodyClipper.beginPath()
  roboBodyClipper.arc(cx, cy, r * 0.95, Math.PI * 0.10, Math.PI * 0.90, false)
  roboBodyClipper.arc(cx, cy + r * 0.56, r * 0.72, Math.PI * 0.90, Math.PI * 0.10, true)
  roboBodyClipper.fill(g)
  // Upper-left casing highlight band.
  g.fillStyle(pal.bodyLight, 0.85)
  roboBodyClipper.beginPath()
  roboBodyClipper.arc(cx, cy, r * 0.94, Math.PI * 0.92, Math.PI * 1.48, false)
  roboBodyClipper.arc(cx, cy, r * 0.78, Math.PI * 1.48, Math.PI * 0.92, true)
  roboBodyClipper.fill(g)
  // Crisp bright inner-rim specular streak.
  g.fillStyle(0xd0d7fa, 0.85)
  roboBodyClipper.beginPath()
  roboBodyClipper.arc(cx, cy, r * 0.92, Math.PI * 1.04, Math.PI * 1.34, false)
  roboBodyClipper.arc(cx, cy, r * 0.85, Math.PI * 1.34, Math.PI * 1.04, true)
  roboBodyClipper.fill(g)

  // ---- THE SCREEN — recessed television face. ----
  const scrW = r * 1.18 * scaleX
  const scrH = r * 1.02 * scaleY
  const scrCx = cx - r * 0.13 * scaleX
  const scrCy = cy + r * 0.04 * scaleY
  const scrX = scrCx - scrW / 2
  const scrY = scrCy - scrH / 2
  const scrR = r * 0.24 * Math.min(scaleX, scaleY)
  // Outer casing recess bevel: light lip bottom-right, dark lip top-left.
  const pad = r * 0.055
  g.fillStyle(pal.bodyLight, 0.55)
  roboBodyClipper.roundedRect(scrX - pad + r * 0.02, scrY - pad + r * 0.02, scrW + pad * 2, scrH + pad * 2, scrR + pad * 0.5)
  roboBodyClipper.fill(g)
  g.fillStyle(pal.bodyDark, 0.75)
  roboBodyClipper.roundedRect(scrX - pad - r * 0.02, scrY - pad - r * 0.02, scrW + pad * 2, scrH + pad * 2, scrR + pad * 0.5)
  roboBodyClipper.fill(g)
  // Screen base fill (darker cyan for bottom/right shading).
  g.fillStyle(pal.screenDark, 1)
  g.fillRoundedRect(scrX, scrY, scrW, scrH, scrR)
  // Bright screen fill inset (creates smooth darker crescent along bottom/right).
  g.fillStyle(pal.screen, 1)
  g.fillRoundedRect(scrX + r * 0.01, scrY + r * 0.01, scrW * 0.92, scrH * 0.87, scrR * 0.88)
  // Top-left cyan glow.
  g.fillStyle(0x7be3ff, 0.45)
  g.fillRoundedRect(scrX + scrW * 0.04, scrY + scrH * 0.04, scrW * 0.38, scrH * 0.28, scrR * 0.5)
  // White reflection bean in the upper-left corner.
  g.fillStyle(0xffffff, 0.95)
  g.beginPath()
  g.moveTo(scrX + scrW * 0.08, scrY + scrH * 0.12)
  quadFrom(g, scrX + scrW * 0.08, scrY + scrH * 0.12, scrX + scrW * 0.16, scrY + scrH * 0.04, scrX + scrW * 0.28, scrY + scrH * 0.06)
  quadFrom(g, scrX + scrW * 0.28, scrY + scrH * 0.06, scrX + scrW * 0.24, scrY + scrH * 0.14, scrX + scrW * 0.12, scrY + scrH * 0.18)
  quadFrom(g, scrX + scrW * 0.12, scrY + scrH * 0.18, scrX + scrW * 0.06, scrY + scrH * 0.16, scrX + scrW * 0.08, scrY + scrH * 0.12)
  g.closePath()
  g.fillPath()
  // Thick dark bezel outline.
  const bezelW = thumbnail ? collectionInkWidth(r) * 1.1 : Math.max(2, ink * 1.15)
  g.lineStyle(bezelW, INK, 1)
  g.strokeRoundedRect(scrX, scrY, scrW, scrH, scrR)

  // ---- SCREEN FLICKER — occasional brief alpha flicker (easter egg). ----
  const flickerSeed = Math.sin(now * 13 + seed * 7) * Math.cos(now * 7 + seed * 3)
  if (flickerSeed > 0.985 && panic < 0.3) {
    g.fillStyle(0xffffff, 0.1)
    g.fillRoundedRect(scrX, scrY, scrW, scrH, scrR)
  }

  // ---- SIDE BUTTONS — two physical controls on the right casing. ----
  const btnX = cx + r * 0.71 * scaleX
  const btnR = r * 0.115 * Math.min(scaleX, scaleY)
  const btnOut = thumbnail ? collectionInkWidth(r) * 0.9 : Math.max(2, ink * 0.8)
  const btn1Y = cy - r * 0.07 * scaleY
  const btn2Y = cy + r * 0.23 * scaleY
  // Socket shadows behind buttons.
  g.fillStyle(pal.bodyDark, 0.5)
  roboBodyClipper.circle(btnX, btn1Y + r * 0.01, btnR + r * 0.015)
  roboBodyClipper.fill(g)
  g.fillStyle(pal.bodyDark, 0.5)
  roboBodyClipper.circle(btnX, btn2Y + r * 0.01, btnR + r * 0.015)
  roboBodyClipper.fill(g)
  // Upper: red.
  g.fillStyle(pal.buttonRed, 1)
  g.fillCircle(btnX, btn1Y, btnR)
  g.fillStyle(0xff7a70, 0.7)
  g.fillCircle(btnX - btnR * 0.25, btn1Y - btnR * 0.25, btnR * 0.45)
  g.lineStyle(btnOut, INK, 1)
  g.strokeCircle(btnX, btn1Y, btnR)
  // Lower: golden yellow.
  g.fillStyle(pal.buttonYellow, 1)
  g.fillCircle(btnX, btn2Y, btnR)
  g.fillStyle(0xffe066, 0.7)
  g.fillCircle(btnX - btnR * 0.25, btn2Y - btnR * 0.25, btnR * 0.45)
  g.lineStyle(btnOut, INK, 1)
  g.strokeCircle(btnX, btn2Y, btnR)

  // ---- THE EYES — the shared collection construction (white sclera +
  // ink rim + ONE dark pupil + highlights), sized for the screen. The
  // geometry comes from faceLayoutFor like every other ball; Robo only
  // recenters the pair inside the cyan screen. Sclera is enlarged and the
  // pupil shrunk relative to the old blobby pair so the white stays
  // clearly visible — the same readable ratio the standard face uses.
  const L = faceLayoutFor(look, r, 1, gaze)
  // Thumbnail mode: scale down eye rims for readability.
  if (thumbnail) {
    const scale = collectionInkWidth(r) / Math.max(2, r * 0.05)
    for (const e of L.eyes) e.rim *= scale
  }
  const em = Math.min(1, panic)
  const up = 0.45 * em
  const faceCx = scrX + scrW * 0.52
  const eyeY = scrY + scrH * 0.46
  const eyeDx = r * 0.245 * scaleX
  const baseWa = r * 0.235 * scaleX
  const baseWb = r * 0.26 * scaleY
  const curious = Math.sin(now * 0.31 + seed * 11) > 0.92 && panic < 0.2 ? 1.06 : 1
  for (const [i, e] of L.eyes.entries()) {
    const ex = faceCx + eyeDx * (i === 0 ? -1 : 1)
    const ey = eyeY + e.y * 0.3
    const closed = exprRobo === 'wink' && i === 1
    if (closed) {
      g.lineStyle(e.rim * 0.95, INK, 1)
      const lid: Array<{ x: number; y: number }> = []
      for (let s = 0; s <= 12; s++) {
        const u = -1 + (2 * s) / 12
        lid.push({ x: ex + u * baseWa * 0.85, y: ey - baseWb * 0.05 + (1 - u * u) * baseWb * 0.4 })
      }
      g.strokePoints(lid as unknown as Phaser.Math.Vector2[], false, false)
      continue
    }
    const wa = baseWa * (1 + 0.12 * em) * curious
    const wb = baseWb * (1 + 0.2 * em) * curious
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(ex, ey, wa * 2, wb * 2)
    g.lineStyle(e.rim, INK, 1)
    g.strokeEllipse(ex, ey, wa * 2, wb * 2)
    // Pupil: smaller than the layout default so the white sclera reads.
    const pa = wa * 0.52
    const pb = wb * 0.52 * (1 - 0.35 * em)
    const px = e.px * (wa / Math.max(0.001, e.a))
    const py = e.py * (wb / Math.max(0.001, e.b)) * (1 - em) - up * (wb - pb - e.rim * 0.5) * em
    g.fillStyle(INK, 1)
    g.fillEllipse(ex + px, ey + py, pa * 2, pb * 2)
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(ex + px - pa * 0.32, ey + py - pb * 0.34, pa * 0.6, pa * 0.6, 24)
    g.fillEllipse(ex + px - pa * 0.1, ey + py - pb * 0.38, pa * 0.24, pa * 0.24, 16)
  }

  // ---- THE MOUTH — small curved smile inside the screen. ----
  const mouthY = scrY + scrH * 0.79
  const mouthW = r * 0.085 * scaleX
  const dip = r * (0.065 - 0.04 * panic) * scaleY
  g.lineStyle(ink * 0.68, INK, 1)
  g.beginPath()
  g.moveTo(faceCx - mouthW, mouthY)
  quadFrom(g, faceCx - mouthW, mouthY, faceCx, mouthY + dip, faceCx + mouthW, mouthY)
  g.strokePath()

  // ---- THE INK OUTLINE — the contour itself, over everything. ----
  g.lineStyle(out, INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }

  // ---- ANTENNAE — a MATCHING pair of curved stems with round yellow
  // tips, drawn AFTER the body outline so the dome mount covers their
  // bases cleanly. Both stems share identical construction, thickness,
  // taper and outline weight; they emerge from the same level on the dome
  // and sit at a symmetric slight outward angle at rest. Only the spring
  // deflection differs per side (idle sway / landing bend), so the pair
  // always reads as one design.
  const domeCx = cx - r * 0.01
  const domeBaseY = topY + r * 0.11
  const domeW = r * 0.46
  const domeH = r * 0.24
  const tipR = r * 0.145
  const stemOut = thumbnail ? collectionInkWidth(r) * 0.9 : Math.max(2, ink * 0.85)

  for (const s of [-1, 1]) {
    const sway = s < 0 ? ant.swayL : ant.swayR
    const bend = s < 0 ? ant.bendL : ant.bendR
    // Shared anchor level on the dome, symmetric outward spacing.
    const baseX = domeCx + s * r * 0.11
    const baseY = domeBaseY - domeH * 0.55
    // Symmetric rest pose: identical outward tilt + height on both sides.
    const restDx = s * r * 0.26
    const restDy = -r * 0.39
    // Apply spring deflection.
    const tipX = baseX + restDx + sway * r
    const tipY = baseY + restDy + bend * r
    // Control point: bows gently outward, bends with spring. Same curve
    // shape both sides (mirrored), so the stems flex smoothly rather than
    // rotate as rigid sticks.
    const ctrlX = baseX + restDx * 0.55 + sway * r * 0.45
    const ctrlY = baseY + restDy * 0.55 + bend * r * 0.35
    // Stem: a stroked curve — constant thickness by definition, so both
    // antennae read identically thin regardless of bend direction. (The
    // previous filled ribbon offset only horizontally, which made the
    // curving stem render thicker than the straight one.) The ink outline
    // is stroked WIDER first, then the coloured core on top — a clean
    // dark-edged stem matching the collection's outline language.
    const stemW = thumbnail ? collectionInkWidth(r) * 1.2 : Math.max(2.2, r * 0.075)
    g.lineStyle(stemW + stemOut * 1.6, INK, 1)
    g.beginPath()
    g.moveTo(baseX, baseY)
    quadFrom(g, baseX, baseY, ctrlX, ctrlY, tipX, tipY)
    g.strokePath()
    g.lineStyle(stemW, pal.antenna, 1)
    g.beginPath()
    g.moveTo(baseX, baseY)
    quadFrom(g, baseX, baseY, ctrlX, ctrlY, tipX, tipY)
    g.strokePath()
    // Yellow tip: round ball at stem end (same diameter + outline both).
    g.fillStyle(pal.antennaTip, 1)
    g.fillCircle(tipX, tipY, tipR)
    g.fillStyle(0xffe268, 0.7)
    g.fillCircle(tipX - tipR * 0.25, tipY - tipR * 0.25, tipR * 0.5)
    g.lineStyle(stemOut, INK, 1)
    g.strokeCircle(tipX, tipY, tipR)
  }

  // ---- DOME MOUNT — purple cap on top of the TV casing, drawn LAST so
  // it covers the stem bases and the top body outline cleanly. ----
  g.fillStyle(pal.body, 1)
  g.beginPath()
  g.moveTo(domeCx - domeW / 2, domeBaseY)
  quadFrom(g, domeCx - domeW / 2, domeBaseY, domeCx - domeW * 0.28, domeBaseY - domeH * 0.92, domeCx, domeBaseY - domeH)
  quadFrom(g, domeCx, domeBaseY - domeH, domeCx + domeW * 0.28, domeBaseY - domeH * 0.92, domeCx + domeW / 2, domeBaseY)
  g.closePath()
  g.fillPath()
  // Dome highlight.
  g.fillStyle(pal.bodyLight, 0.6)
  g.beginPath()
  g.moveTo(domeCx - domeW * 0.32, domeBaseY - domeH * 0.12)
  quadFrom(g, domeCx - domeW * 0.32, domeBaseY - domeH * 0.12, domeCx - domeW * 0.18, domeBaseY - domeH * 0.78, domeCx, domeBaseY - domeH * 0.88)
  quadFrom(g, domeCx, domeBaseY - domeH * 0.88, domeCx + domeW * 0.18, domeBaseY - domeH * 0.78, domeCx + domeW * 0.32, domeBaseY - domeH * 0.12)
  g.closePath()
  g.fillPath()
  // Dome base shadow.
  g.fillStyle(pal.bodyDark, 0.5)
  g.fillRoundedRect(domeCx - domeW * 0.38, domeBaseY - r * 0.02, domeW * 0.76, r * 0.04, r * 0.02)
  // Dome outline.
  g.lineStyle(thumbnail ? collectionInkWidth(r) * 1.05 : Math.max(2, ink * 1.05), INK, 1)
  g.beginPath()
  g.moveTo(domeCx - domeW / 2, domeBaseY)
  quadFrom(g, domeCx - domeW / 2, domeBaseY, domeCx - domeW * 0.28, domeBaseY - domeH * 0.92, domeCx, domeBaseY - domeH)
  quadFrom(g, domeCx, domeBaseY - domeH, domeCx + domeW * 0.28, domeBaseY - domeH * 0.92, domeCx + domeW / 2, domeBaseY)
  g.closePath()
  g.strokePath()
}

export interface DrunkoPalette {
  /** Skin (the main body colour — warm orange/peach). */
  skin: number
  /** Skin highlight (lighter, upper face). */
  skinLight: number
  /** Beard (messy light grey-brown). */
  beard: number
  /** Beard shadow (deeper tone at the beard's lower edge). */
  beardDark: number
  /** Cap (brown). */
  cap: number
  /** Cap brim (darker brown). */
  capBrim: number
  /** Pink lower eyelids (the intoxicated read). */
  lid: number
  /** Bottle glass (green). */
  bottle: number
  /** Bottle label (cream). */
  label: number
  /** The reward halo's colour (behind the whole ball). */
  glow: number
}

/** The drunko palettes, exported alongside SHARK/PIG (journal/QA parity).
 *  Variant picks one; the per-run THEME roll picks the family first. */
export const DRUNKO_PALETTES: readonly DrunkoPalette[] = [
  { skin: 0xf6b76b, skinLight: 0xffd9a0, beard: 0xd9d2c4, beardDark: 0xb3a48e, cap: 0x8a5632, capBrim: 0x6b3f22, lid: 0xf08a94, bottle: 0x3e7d2c, label: 0xf3e3b8, glow: 0xffd9a8 }, // 0: tavern peach
  { skin: 0xefa45c, skinLight: 0xffcf92, beard: 0xcfc4b2, beardDark: 0xa89a86, cap: 0x7a4a2a, capBrim: 0x5e3620, lid: 0xec7f8c, bottle: 0x357026, label: 0xf2e2b0, glow: 0xffcf9a }, // 1: amber
  { skin: 0xf8c184, skinLight: 0xffe0b2, beard: 0xe2dccf, beardDark: 0xbcae97, cap: 0x96603a, capBrim: 0x74482a, lid: 0xf3969e, bottle: 0x468a33, label: 0xf6e9c4, glow: 0xffe2b8 }, // 2: pale ale
  { skin: 0xee9e52, skinLight: 0xffca8a, beard: 0xd2c6ae, beardDark: 0xa29478, cap: 0x6e4226, capBrim: 0x55301b, lid: 0xe87884, bottle: 0x2f6623, label: 0xeeddab, glow: 0xffc890 }, // 3: rum barrel
  { skin: 0xf4b877, skinLight: 0xffd6a6, beard: 0xded8ce, beardDark: 0xb0a692, cap: 0x8f5c3e, capBrim: 0x6d452c, lid: 0xef8a96, bottle: 0x3a7f30, label: 0xf4e6bc, glow: 0xffd6ae }, // 4: cider
]

/**
 * Draw the Tier 9 DRUNK'O ball — the third tier-9 theme: a warm
 * orange/peach drunkard with a tilted brown stitched cap, a messy grey
 * beard with side tufts, sleepy half-closed eyes with pink lower lids,
 * a drooling mouth and a green bottle held beside the body.
 *
 * SAME CONTRACT as drawSharkBall: the body is the ball's CONTOUR (pass
 * `poly`; without it a circle of radius r at (cx, cy)); the FACE is part
 * of the design (callers must NOT draw the standard face on top).
 *
 * EASTER EGGS ride the shared `expressionAt` timeline: 'wink' closes the
 * right eye, 'grin' swaps the drool frown for a visible smile, 'tongue'
 * sticks the tongue out. The blink is the natural closed-lid kind. FEAR
 * (`panic`) snaps the eyes WIDE open (the drunkard sobers up), drops the
 * bottle low, hides the drool and adds a sweat drop.
 */
export function drawDrunkoBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  bodyAngle = 0,
  thumbnail = false,
): void {
  const pal = DRUNKO_PALETTES[variant % DRUNKO_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(2, r * 0.05)
  const out = thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r)
  const now = Date.now() / 1000
  // Fear takes precedence over the shared easter-egg expression timeline.
  const expr = panic > 0.45 ? 'normal' : expressionAt(seed, now * 1000)
  const jx = Math.sin(now * 41) * r * 0.02 * panic * panic
  const jy = Math.cos(now * 37) * r * 0.015 * panic * panic
  cx += jx
  cy += jy

  // The face stays upright; accessory anchors follow the body's rotation.
  const cosA = Math.cos(bodyAngle)
  const sinA = Math.sin(bodyAngle)
  const rot = (dx: number, dy: number): { x: number; y: number } => ({
    x: cx + dx * cosA - dy * sinA,
    y: cy + dx * sinA + dy * cosA,
  })

  // ---- THE GLOW — the same soft radial stack as the shark/pig, tinted
  // warm amber: 4 concentric discs, widest first, ~9s breath. FIRST. ----
  const glowWobble = Math.sin(now * 0.7)
  const glowLayers: ReadonlyArray<{ rr: number; alpha: number }> = [
    { rr: 1.72 + glowWobble * 0.03, alpha: 0.1 },
    { rr: 1.5, alpha: 0.16 },
    { rr: 1.3, alpha: 0.24 },
    { rr: 1.12, alpha: 0.3 },
  ]
  for (const layer of glowLayers) {
    g.fillStyle(pal.glow, layer.alpha + glowWobble * 0.02)
    g.fillCircle(cx, cy, r * layer.rr)
  }

  // ---- THE BODY — skin fill and the lighter upper-face band. ----
  if (poly && poly.length >= 3) {
    g.fillStyle(pal.skin, 1)
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillStyle(pal.skin, 1)
    g.fillCircle(cx, cy, r)
  }
  g.fillStyle(pal.skinLight, 0.55)
  g.beginPath()
  g.arc(cx, cy, r * 0.88, Math.PI * 1.12, Math.PI * 1.88, false)
  for (let s = 8; s >= 0; s--) {
    const t = s / 8
    const th = Math.PI * (1.12 + (1.88 - 1.12) * t)
    g.lineTo(cx + Math.cos(th) * r * 0.6, cy + Math.sin(th) * r * 0.6)
  }
  g.closePath()
  g.fillPath()

  // ---- THE BEARD — irregular fluffy mass grown from beneath the cheeks.
  // The upper edge is a soft asymmetric curve, not a straight band; the
  // lower edge carries rounded tufts so it reads as hair, not a mask. ----
  const beardTopL = cy + r * 0.1
  const beardTopR = cy + r * 0.06
  const traceBeardTop = (): void => {
    g.moveTo(cx - r * 0.82, beardTopL)
    quadFrom(g, cx - r * 0.82, beardTopL,
      cx - r * 0.62, cy + r * 0.02, cx - r * 0.42, cy + r * 0.12)
    quadFrom(g, cx - r * 0.42, cy + r * 0.12,
      cx - r * 0.28, cy + r * 0.18, cx - r * 0.14, cy + r * 0.16)
    quadFrom(g, cx - r * 0.14, cy + r * 0.16,
      cx - r * 0.04, cy + r * 0.15, cx + r * 0.06, cy + r * 0.18)
    quadFrom(g, cx + r * 0.06, cy + r * 0.18,
      cx + r * 0.22, cy + r * 0.22, cx + r * 0.38, cy + r * 0.14)
    quadFrom(g, cx + r * 0.38, cy + r * 0.14,
      cx + r * 0.6, cy + r * 0.04, cx + r * 0.8, beardTopR)
  }
  // Rounded tufts along the lower edge; no sharp spikes.
  const traceBeardBottom = (): void => {
    quadFrom(g, cx + r * 0.72, cy + r * 0.42,
      cx + r * 0.7, cy + r * 0.52, cx + r * 0.58, cy + r * 0.6)
    quadFrom(g, cx + r * 0.58, cy + r * 0.6,
      cx + r * 0.5, cy + r * 0.7, cx + r * 0.38, cy + r * 0.68)
    quadFrom(g, cx + r * 0.38, cy + r * 0.68,
      cx + r * 0.3, cy + r * 0.82, cx + r * 0.16, cy + r * 0.8)
    quadFrom(g, cx + r * 0.16, cy + r * 0.8,
      cx + r * 0.08, cy + r * 0.9, cx - r * 0.04, cy + r * 0.86)
    quadFrom(g, cx - r * 0.04, cy + r * 0.86,
      cx - r * 0.16, cy + r * 0.92, cx - r * 0.26, cy + r * 0.8)
    quadFrom(g, cx - r * 0.26, cy + r * 0.8,
      cx - r * 0.36, cy + r * 0.84, cx - r * 0.44, cy + r * 0.72)
    quadFrom(g, cx - r * 0.44, cy + r * 0.72,
      cx - r * 0.56, cy + r * 0.68, cx - r * 0.62, cy + r * 0.56)
    quadFrom(g, cx - r * 0.62, cy + r * 0.56,
      cx - r * 0.72, cy + r * 0.5, cx - r * 0.72, cy + r * 0.4)
  }
  g.fillStyle(pal.beard, 1)
  g.beginPath()
  traceBeardTop()
  // Soft cheek tufts that hug the face instead of a hard side edge.
  quadFrom(g, cx + r * 0.8, beardTopR,
    cx + r * 0.94, cy + r * 0.08, cx + r * 0.9, cy + r * 0.2)
  quadFrom(g, cx + r * 0.9, cy + r * 0.2,
    cx + r * 0.94, cy + r * 0.3, cx + r * 0.8, cy + r * 0.32)
  quadFrom(g, cx + r * 0.8, cy + r * 0.32,
    cx + r * 0.74, cy + r * 0.34, cx + r * 0.72, cy + r * 0.42)
  traceBeardBottom()
  quadFrom(g, cx - r * 0.72, cy + r * 0.4,
    cx - r * 0.74, cy + r * 0.32, cx - r * 0.82, cy + r * 0.3)
  quadFrom(g, cx - r * 0.82, cy + r * 0.3,
    cx - r * 0.95, cy + r * 0.26, cx - r * 0.92, cy + r * 0.14)
  quadFrom(g, cx - r * 0.92, cy + r * 0.14,
    cx - r * 0.95, cy + r * 0.06, cx - r * 0.82, beardTopL)
  g.closePath()
  g.fillPath()

  // Darker underside follows the same tufted lower edge.
  g.fillStyle(pal.beardDark, 0.75)
  g.beginPath()
  g.moveTo(cx + r * 0.72, cy + r * 0.42)
  traceBeardBottom()
  quadFrom(g, cx - r * 0.72, cy + r * 0.4,
    cx - r * 0.6, cy + r * 0.44, cx - r * 0.4, cy + r * 0.56)
  quadFrom(g, cx - r * 0.4, cy + r * 0.56,
    cx - r * 0.2, cy + r * 0.66, cx, cy + r * 0.64)
  quadFrom(g, cx, cy + r * 0.64,
    cx + r * 0.24, cy + r * 0.66, cx + r * 0.46, cy + r * 0.54)
  quadFrom(g, cx + r * 0.46, cy + r * 0.54,
    cx + r * 0.64, cy + r * 0.44, cx + r * 0.72, cy + r * 0.42)
  g.closePath()
  g.fillPath()

  // Leave a soft skin opening around the mouth, tongue and enlarged drool.
  g.fillStyle(pal.skin, 1)
  g.fillEllipse(cx, cy + r * 0.44, r * 0.58, r * 0.5)
  g.lineStyle(ink * 0.6, INK, 1)
  g.beginPath()
  traceBeardTop()
  g.strokePath()
  // A few curved hair strokes suggest messy facial hair; no dot noise.
  g.lineStyle(Math.max(1.2, ink * 0.55), pal.beardDark, 0.85)
  {
    const strokes: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
      [-0.52, 0.34, -0.44, 0.46, -0.34, 0.5],
      [-0.2, 0.56, -0.14, 0.68, -0.04, 0.7],
      [0.18, 0.6, 0.26, 0.7, 0.36, 0.66],
      [0.48, 0.36, 0.56, 0.46, 0.5, 0.56],
    ]
    for (const [x0, y0, cxs, cys, x1, y1] of strokes) {
      g.beginPath()
      g.moveTo(cx + x0 * r, cy + y0 * r)
      quadFrom(g, cx + x0 * r, cy + y0 * r, cx + cxs * r, cy + cys * r, cx + x1 * r, cy + y1 * r)
      g.strokePath()
    }
  }

  // ---- THE FACE — half-closed eyes, pink lower lids and messy brows. ----
  const L = faceLayoutFor(look, r, 1, gaze)
  const em = Math.min(1, panic)
  const blinkMs = (now * 1000 + seed * 1013) % 4700
  const blinking = panic <= 0.45 && blinkMs < 130
  const eyeY = cy - r * 0.22
  const eyeDx = r * 0.4
  for (const [i, e] of L.eyes.entries()) {
    const exF = cx + eyeDx * (i === 0 ? -1 : 1)
    const ey = eyeY + e.y * 0.5
    const closed = blinking || (expr === 'wink' && i === 1)
    if (closed) {
      g.lineStyle(e.rim * 0.95, INK, 1)
      g.beginPath()
      for (let s = 0; s <= 12; s++) {
        const u = -1 + (2 * s) / 12
        const x = exF + u * e.a * 0.85
        const y = ey - e.b * 0.05 + (1 - u * u) * e.b * 0.4
        if (s === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.strokePath()
      continue
    }
    // Fear opens the eyes and washes out the sleepy pink lower lids.
    const wa = e.a * (1 + 0.1 * em)
    const wb = e.b * (1 + 0.25 * em)
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(exF, ey, wa * 2, wb * 2)
    g.fillStyle(pal.lid, 0.85 * (1 - em * 0.6))
    g.beginPath()
    g.arc(exF, ey, wb * 0.92, 0, Math.PI, false)
    g.closePath()
    g.fillPath()
    // Pupils ride low when calm, then shrink and pin upward with panic.
    const pb = e.pb * (1 - 0.3 * em)
    const py = e.py * (1 - em) - 0.4 * (e.b - pb - e.rim * 0.5) * em + e.b * 0.16 * (1 - em)
    g.fillStyle(INK, 1)
    g.fillEllipse(exF + e.px, ey + py, e.pa * 2, pb * 2)
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(exF + e.px - e.pa * 0.32, ey + py - pb * 0.34, e.pa * 0.6, e.pa * 0.6, 24)
    const lidDrop = wb * (0.95 - 0.75 * em)
    g.fillStyle(pal.skin, 1)
    g.fillRect(exF - wa * 1.06, ey - wb * 1.1, wa * 2.12, lidDrop)
    g.lineStyle(e.rim * 0.9, INK, 1)
    g.beginPath()
    g.moveTo(exF - wa * 0.98, ey - wb * 1.1 + lidDrop)
    quadFrom(g, exF - wa * 0.98, ey - wb * 1.1 + lidDrop, exF, ey - wb * 1.1 + lidDrop + wb * 0.16, exF + wa * 0.98, ey - wb * 1.1 + lidDrop)
    g.strokePath()
    g.lineStyle(e.rim, INK, 1)
    g.beginPath()
    g.arc(exF, ey, wa, Math.PI * 0.08, Math.PI * 0.92, false)
    g.strokePath()
  }

  // Messy eyebrows lift with fear.
  g.lineStyle(Math.max(1.5, ink * 0.8), INK, 0.9)
  for (const s of [-1, 1]) {
    const bx0 = cx + s * eyeDx - r * 0.16
    const by0 = eyeY - r * (0.52 + 0.14 * em)
    g.beginPath()
    g.moveTo(bx0, by0 + s * r * 0.03)
    quadFrom(g, bx0, by0 + s * r * 0.03, bx0 + r * 0.14, by0 - r * 0.06, bx0 + r * 0.3, by0 + r * 0.02)
    g.strokePath()
    g.beginPath()
    g.moveTo(bx0 + r * 0.06, by0 + r * 0.05)
    g.lineTo(bx0 + r * 0.2, by0 + r * 0.08)
    g.strokePath()
  }

  // The drooling frown becomes a grin or tongue-out smile on the timeline.
  const mouthY = cy + r * 0.42
  const mouthW = r * 0.3
  const smiling = expr === 'grin' || expr === 'tongue'
  const dip = smiling ? r * 0.12 : r * (0.05 - 0.04 * panic)
  g.lineStyle(ink, INK, 1)
  g.beginPath()
  g.moveTo(cx - mouthW / 2, mouthY)
  quadFrom(g, cx - mouthW / 2, mouthY, cx, mouthY + (smiling ? dip : -dip), cx + mouthW / 2, mouthY)
  g.strokePath()
  if (expr === 'tongue' && panic < 0.3) {
    g.fillStyle(0xff9eb5, 0.95)
    g.fillEllipse(cx + mouthW * 0.2, mouthY + dip * 0.9, r * 0.15, r * 0.1)
  }
  // Drool retains its wobble, with a 20% larger drop. Fear hides it.
  if (panic < 0.45) {
    const stretch = 1 + Math.sin(now * 2.2 + seed) * 0.18
    const dx = cx + mouthW * 0.32
    const dy = mouthY + r * 0.06
    g.fillStyle(0x9fdcff, 0.9)
    g.beginPath()
    g.moveTo(dx - r * 0.054, dy)
    quadFrom(g, dx - r * 0.054, dy, dx - r * 0.072, dy + r * 0.12 * stretch, dx, dy + r * 0.192 * stretch)
    quadFrom(g, dx, dy + r * 0.192 * stretch, dx + r * 0.072, dy + r * 0.12 * stretch, dx + r * 0.054, dy)
    g.closePath()
    g.fillPath()
    g.fillStyle(0xffffff, 0.7)
    g.fillCircle(dx - r * 0.018, dy + r * 0.072 * stretch, r * 0.0192)
  }
  if (panic > 0.45) {
    const sweat = Math.min(1, (panic - 0.45) / 0.55)
    const sweatPos = rot(-r * 0.62, -r * 0.42)
    g.fillStyle(0x9fdcff, 0.95 * sweat)
    g.fillCircle(sweatPos.x, sweatPos.y, r * 0.055 * (0.7 + 0.3 * sweat))
  }

  // ---- THE BODY OUTLINE — exactly once, before either accessory. ----
  g.lineStyle(out, INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }

  // ---- THE BOTTLE — larger and in front of the body. Fear drops it. ----
  const bottleTilt = 0.22 + panic * 0.3 + bodyAngle
  const bottlePos = rot(r * 1.15, r * 0.3 + panic * r * 0.22)
  const bx = bottlePos.x
  const by = bottlePos.y
  const bw = r * 0.42
  const bh = r * 1.15
  const cosT = Math.cos(bottleTilt)
  const sinT = Math.sin(bottleTilt)
  // u runs up the bottle axis; v runs across its width.
  // Local bottle coordinates use u=up and v=across. Rotate the same
  // right-handed basis as the body anchor so the bottle follows bodyAngle
  // instead of counter-rotating against it.
  const bp = (u: number, v: number): { x: number; y: number } => ({
    x: bx + v * cosT + u * sinT,
    y: by - u * cosT + v * sinT,
  })
  const neckW = bw * 0.45
  const shoulder = bh * 0.62
  g.fillStyle(pal.bottle, 1)
  g.beginPath()
  {
    const p0 = bp(0, -bw / 2)
    const p1 = bp(shoulder, -bw / 2)
    const p2 = bp(bh * 0.78, -neckW / 2)
    const p3 = bp(bh, -neckW / 2)
    const p4 = bp(bh, neckW / 2)
    const p5 = bp(bh * 0.78, neckW / 2)
    const p6 = bp(shoulder, bw / 2)
    const p7 = bp(0, bw / 2)
    g.moveTo(p0.x, p0.y)
    g.lineTo(p1.x, p1.y)
    g.lineTo(p2.x, p2.y)
    g.lineTo(p3.x, p3.y)
    g.lineTo(p4.x, p4.y)
    g.lineTo(p5.x, p5.y)
    g.lineTo(p6.x, p6.y)
    g.lineTo(p7.x, p7.y)
  }
  g.closePath()
  g.fillPath()
  g.lineStyle(ink * 0.9, INK, 1)
  g.strokePath()

  // Cream label and the original little sprig.
  {
    const l0 = bp(bh * 0.15, -bw / 2)
    const l1 = bp(bh * 0.48, -bw / 2)
    const l2 = bp(bh * 0.48, bw / 2)
    const l3 = bp(bh * 0.15, bw / 2)
    g.fillStyle(pal.label, 1)
    g.beginPath()
    g.moveTo(l0.x, l0.y)
    g.lineTo(l1.x, l1.y)
    g.lineTo(l2.x, l2.y)
    g.lineTo(l3.x, l3.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(ink * 0.55, INK, 0.9)
    g.strokePath()
    const s0 = bp(bh * 0.24, 0)
    const s1 = bp(bh * 0.4, 0)
    g.lineStyle(Math.max(1.2, ink * 0.5), pal.capBrim, 0.95)
    g.beginPath()
    g.moveTo(s0.x, s0.y)
    g.lineTo(s1.x, s1.y)
    g.strokePath()
    for (const [fu, fv] of [[0.3, -0.09], [0.3, 0.09], [0.36, -0.08], [0.36, 0.08]] as const) {
      const a = bp(bh * fu, 0)
      const b = bp(bh * (fu + 0.04), bw * fv)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.strokePath()
    }
  }
  {
    const h0 = bp(bh * 0.66, -neckW * 0.18)
    const h1 = bp(bh * 0.95, -neckW * 0.18)
    g.lineStyle(Math.max(1.5, r * 0.045), 0xffffff, 0.5)
    g.beginPath()
    g.moveTo(h0.x, h0.y)
    g.lineTo(h1.x, h1.y)
    g.strokePath()
  }
  // The hand wraps the bottle with a small thumb bump instead of a ball.
  const handPos = rot(r * 0.92, r * 0.48)
  g.fillStyle(pal.skin, 1)
  g.beginPath()
  g.moveTo(handPos.x - r * 0.12, handPos.y - r * 0.05)
  quadFrom(g, handPos.x - r * 0.12, handPos.y - r * 0.05,
    handPos.x - r * 0.16, handPos.y - r * 0.14, handPos.x - r * 0.04, handPos.y - r * 0.15)
  quadFrom(g, handPos.x - r * 0.04, handPos.y - r * 0.15,
    handPos.x + r * 0.1, handPos.y - r * 0.16, handPos.x + r * 0.13, handPos.y - r * 0.06)
  quadFrom(g, handPos.x + r * 0.13, handPos.y - r * 0.06,
    handPos.x + r * 0.17, handPos.y + r * 0.06, handPos.x + r * 0.08, handPos.y + r * 0.13)
  quadFrom(g, handPos.x + r * 0.08, handPos.y + r * 0.13,
    handPos.x - r * 0.04, handPos.y + r * 0.18, handPos.x - r * 0.13, handPos.y + r * 0.1)
  quadFrom(g, handPos.x - r * 0.13, handPos.y + r * 0.1,
    handPos.x - r * 0.18, handPos.y + r * 0.02, handPos.x - r * 0.12, handPos.y - r * 0.05)
  g.closePath()
  g.fillPath()
  g.lineStyle(ink * 0.7, INK, 1)
  g.strokePath()
  // Thumb crease over the bottle edge.
  g.lineStyle(Math.max(1.2, ink * 0.5), INK, 0.8)
  g.beginPath()
  g.moveTo(handPos.x - r * 0.02, handPos.y - r * 0.1)
  quadFrom(g, handPos.x - r * 0.02, handPos.y - r * 0.1,
    handPos.x + r * 0.05, handPos.y - r * 0.04, handPos.x + r * 0.04, handPos.y + r * 0.05)
  g.strokePath()

  // ---- THE CAP — a proper baseball cap: tall rounded crown, front panel
  // seam, and a thick curved visor projecting forward over the forehead.
  // Rebuilt from scratch to match the original reference. ----
  const capTilt = -0.12 + bodyAngle
  const capW = r * 1.42
  const capH = r * 0.72
  const capBase = -r * 0.3
  // Keep the cap attached to the LIVE contour so squash/rotation stay glued.
  // The cap sits directly on the head — no gap, no floating.
  let capAnchorY = -r * 0.58
  if (poly && poly.length >= 3) {
    let topLocalY = Infinity
    for (const point of poly) {
      const dx = point.x - cx
      const dy = point.y - cy
      const localY = -dx * sinA + dy * cosA
      if (localY < topLocalY) topLocalY = localY
    }
    if (Number.isFinite(topLocalY)) capAnchorY = topLocalY - capBase
  }
  const capPos = rot(r * 0.02, capAnchorY)
  const capCx = capPos.x
  const capCy = capPos.y
  const cosC = Math.cos(capTilt)
  const sinC = Math.sin(capTilt)
  const cp = (u: number, v: number): { x: number; y: number } => ({
    x: capCx + u * cosC - v * sinC,
    y: capCy + u * sinC + v * cosC,
  })
  // Crown: tall, rounded, slightly asymmetric dome.
  g.fillStyle(pal.cap, 1)
  g.beginPath()
  {
    const p0 = cp(-capW * 0.48, capBase)
    g.moveTo(p0.x, p0.y)
    const a1 = cp(-capW * 0.52, capBase - capH * 0.5)
    const a2 = cp(-capW * 0.38, capBase - capH * 0.88)
    quadFrom(g, p0.x, p0.y, a1.x, a1.y, a2.x, a2.y)
    const b1 = cp(-capW * 0.1, capBase - capH * 1.06)
    const b2 = cp(capW * 0.18, capBase - capH * 0.98)
    quadFrom(g, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)
    const c1 = cp(capW * 0.44, capBase - capH * 0.72)
    const c2 = cp(capW * 0.48, capBase)
    quadFrom(g, b2.x, b2.y, c1.x, c1.y, c2.x, c2.y)
    // Lower edge curves down to follow the forehead.
    const d1 = cp(capW * 0.1, capBase + capH * 0.14)
    quadFrom(g, c2.x, c2.y, d1.x, d1.y, p0.x, p0.y)
  }
  g.closePath()
  g.fillPath()
  // Contact shadow beneath the cap so it reads as resting on the head.
  g.fillStyle(0x000000, 0.12)
  g.beginPath()
  {
    const s0 = cp(-capW * 0.44, capBase + capH * 0.06)
    g.moveTo(s0.x, s0.y)
    const s1 = cp(0, capBase + capH * 0.18)
    const s2 = cp(capW * 0.44, capBase + capH * 0.04)
    quadFrom(g, s0.x, s0.y, s1.x, s1.y, s2.x, s2.y)
    const s3 = cp(0, capBase + capH * 0.22)
    quadFrom(g, s2.x, s2.y, s3.x, s3.y, s0.x, s0.y)
  }
  g.closePath()
  g.fillPath()
  g.lineStyle(out * 0.85, INK, 1)
  g.strokePath()

  // Subtle lighter highlight on the upper-left crown.
  g.fillStyle(0xffffff, 0.14)
  {
    const h = cp(-capW * 0.18, capBase - capH * 0.62)
    g.fillEllipse(h.x, h.y, capW * 0.38, capH * 0.36)
  }

  // Front panel seam: a gentle curved line down the crown's center-left.
  g.lineStyle(Math.max(1.2, ink * 0.6), pal.capBrim, 0.7)
  g.beginPath()
  {
    const s0 = cp(-capW * 0.08, capBase - capH * 0.95)
    g.moveTo(s0.x, s0.y)
    const s1 = cp(-capW * 0.14, capBase - capH * 0.5)
    const s2 = cp(-capW * 0.1, capBase - capH * 0.08)
    quadFrom(g, s0.x, s0.y, s1.x, s1.y, s2.x, s2.y)
  }
  g.strokePath()

  // Visor: gently curved, moderate projection, darker underside.
  const visorW = capW * 0.58
  const visorH = capH * 0.24
  g.fillStyle(pal.capBrim, 1)
  g.beginPath()
  {
    const v0 = cp(capW * 0.06, capBase + capH * 0.04)
    g.moveTo(v0.x, v0.y)
    const v1 = cp(capW * 0.06 + visorW * 0.5, capBase - visorH * 0.2)
    const v2 = cp(capW * 0.06 + visorW, capBase + visorH * 0.3)
    quadFrom(g, v0.x, v0.y, v1.x, v1.y, v2.x, v2.y)
    const v3 = cp(capW * 0.06 + visorW * 0.45, capBase + visorH * 0.5)
    quadFrom(g, v2.x, v2.y, v3.x, v3.y, v0.x, v0.y)
  }
  g.closePath()
  g.fillPath()
  g.lineStyle(out * 0.7, INK, 1)
  g.strokePath()

  // Cross stitching on the crown.
  g.lineStyle(Math.max(1.5, ink * 0.7), pal.capBrim, 0.95)
  {
    const c0 = cp(-capW * 0.12, capBase - capH * 0.55)
    const c1 = cp(capW * 0.04, capBase - capH * 0.48)
    const c2 = cp(-capW * 0.06, capBase - capH * 0.68)
    const c3 = cp(capW * 0.0, capBase - capH * 0.4)
    g.beginPath()
    g.moveTo(c0.x, c0.y)
    g.lineTo(c1.x, c1.y)
    g.strokePath()
    g.beginPath()
    g.moveTo(c2.x, c2.y)
    g.lineTo(c3.x, c3.y)
    g.strokePath()
  }
}
export interface PiratePalette {
  /** Golden-yellow body fill. */
  body: number
  /** Lighter upper-left body highlight. */
  bodyLight: number
  /** Deeper golden-orange lower body shadow. */
  bodyDark: number
  /** Red bandana cloth. */
  bandana: number
  /** Bandana shadow / fold tone. */
  bandanaDark: number
  /**Bandana highlight. */
  bandanaLight: number
  /** Dark charcoal pirate hat body. */
  hat: number
  /** Darker hat fold/shadow. */
  hatDark: number
  /** Gold hat trim & buckle. */
  gold: number
  /** Lighter gold specular highlight. */
  goldLight: number
  /** Deeper amber-gold shadow. */
  goldDark: number
  /** Brown leather belt. */
  belt: number
  /** Darker belt shadow & holes. */
  beltDark: number
  /** Parrot red body. */
  parrotRed: number
  /** Parrot darker red shading. */
  parrotRedDark: number
  /** Parrot wing yellow band. */
  parrotYellow: number
  /** Parrot wing blue tips. */
  parrotBlue: number
  /** Atmosphere halo colour. */
  glow: number
}

export const PIRATE_PALETTES: readonly PiratePalette[] = [
  {
    body: 0xffcc18, bodyLight: 0xffe45c, bodyDark: 0xe59a0c,
    bandana: 0xe62e25, bandanaDark: 0xa81812, bandanaLight: 0xff5a4f,
    hat: 0x2a242b, hatDark: 0x19151a,
    gold: 0xf7b518, goldLight: 0xffe066, goldDark: 0xc27808,
    belt: 0x6e351c, beltDark: 0x421c0c,
    parrotRed: 0xf03228, parrotRedDark: 0xb81d15, parrotYellow: 0xffd21f, parrotBlue: 0x1c8cff,
    glow: 0xffe066,
  }, // 0: classic doubloon gold
  {
    body: 0xf5be16, bodyLight: 0xffdc52, bodyDark: 0xd98c0a,
    bandana: 0xd62420, bandanaDark: 0x991410, bandanaLight: 0xf24d46,
    hat: 0x262228, hatDark: 0x161318,
    gold: 0xefa812, goldLight: 0xffd858, goldDark: 0xb86e06,
    belt: 0x632f18, beltDark: 0x3b180a,
    parrotRed: 0xe62b22, parrotRedDark: 0xad1912, parrotYellow: 0xffca18, parrotBlue: 0x1880f0,
    glow: 0xffd658,
  }, // 1: sunlit treasure
  {
    body: 0xffd426, bodyLight: 0xffea70, bodyDark: 0xe8a212,
    bandana: 0xf0382e, bandanaDark: 0xb31e17, bandanaLight: 0xff685e,
    hat: 0x302932, hatDark: 0x1d181f,
    gold: 0xffbf24, goldLight: 0xffe678, goldDark: 0xc9800c,
    belt: 0x783a20, beltDark: 0x4a200e,
    parrotRed: 0xf83a30, parrotRedDark: 0xc2221a, parrotYellow: 0xffda2b, parrotBlue: 0x2696ff,
    glow: 0xffe678,
  }, // 2:corsair sovereign
]

const pirateBodyClipper = new BodyFillClipper()

interface PirateSpringState {
  prevCx: number
  prevCy: number
  prevVx: number
  prevVy: number
  prevPanic: number
  prevAspectY: number
  prevTimeMs: number
  initialized: boolean
  hatTilt: number
  hatTiltVel: number
  hatBob: number
  hatBobVel: number
  tailSway: number
  tailSwayVel: number
  parrotBob: number
  parrotBobVel: number
  parrotWing: number
  parrotWingVel: number
}

interface PirateSpringOutput {
  hatTilt: number
  hatBob: number
  tailSway: number
  parrotBob: number
  parrotWing: number
}
const pirateAccessoryPoses = new Map<number, {
  cx: number
  cy: number
  r: number
  pal: PiratePalette
  scaleX: number
  scaleY: number
  bodyAngle: number
  hatTilt: number
  parrotBob: number
  parrotWing: number
  panic: number
  out: number
}>()
export function takePirateAccessoryPose(ballId: number): {
  cx: number
  cy: number
  r: number
  pal: PiratePalette
  scaleX: number
  scaleY: number
  bodyAngle: number
  hatTilt: number
  parrotBob: number
  parrotWing: number
  panic: number
  out: number
} | undefined {
  const pose = pirateAccessoryPoses.get(ballId)
  pirateAccessoryPoses.delete(ballId)
  return pose
}

const PIRATE_REST_SPRING: PirateSpringOutput = {
  hatTilt: 0,
  hatBob: 0,
  tailSway: 0,
  parrotBob: 0,
  parrotWing: 0,
}
const pirateSpringOutput: PirateSpringOutput = { ...PIRATE_REST_SPRING }
const pirateStates = new Map<number, PirateSpringState>()

function getPirateState(ballId: number): PirateSpringState {
  let s = pirateStates.get(ballId)
  if (!s) {
    s = {
      prevCx: 0, prevCy: 0, prevVx: 0, prevVy: 0,
      prevPanic: 0, prevAspectY: 1, prevTimeMs: 0, initialized: false,
      hatTilt: 0, hatTiltVel: 0,
      hatBob: 0, hatBobVel: 0,
      tailSway: 0, tailSwayVel: 0,
      parrotBob: 0, parrotBobVel: 0,
      parrotWing: 0, parrotWingVel: 0,
    }
    pirateStates.set(ballId, s)
  }
  return s
}

export function dropPirateState(ballId: number): void {
  pirateStates.delete(ballId)
}

export function clearPirateStates(): void {
  pirateStates.clear()
  pirateAccessoryPoses.clear()
}
export function dropEarthGlow(ballId: number): void {
  earthGlowImages.get(ballId)?.destroy()
  earthGlowImages.delete(ballId)
}
export function clearEarthGlows(): void {
  for (const image of earthGlowImages.values()) image.destroy()
  earthGlowImages.clear()
}

export function notifyPirateImpact(ballId: number, nx: number, ny: number, strength: number): void {
  if (isReducedMotion()) return
  const s = getPirateState(ballId)
  const vertical = Math.max(0, -ny) * strength
  const horizontal = -nx * strength
  const kick = 0.35 + strength * 0.65
  s.hatBobVel += vertical * kick * 1.6
  s.hatTiltVel += horizontal * kick * 1.5
  s.tailSwayVel += (horizontal * 1.4 + vertical * 0.8) * kick
  s.parrotBobVel -= vertical * kick * 2.1
  s.parrotWingVel += (vertical * 1.8 + Math.abs(horizontal) * 1.1) * kick
}

function stepPirateSpring(
  ballId: number | undefined,
  seed: number,
  cx: number,
  cy: number,
  r: number,
  poly: Array<{ x: number; y: number }> | undefined,
  panic: number,
  nowMs: number,
): PirateSpringOutput {
  if (ballId === undefined) return PIRATE_REST_SPRING
  const s = getPirateState(ballId)
  let aspectY = 1
  if (poly && poly.length >= 3) {
    let minY = poly[0]!.y, maxY = poly[0]!.y
    for (const p of poly) {
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    aspectY = (maxY - minY) / (2 * r)
  }
  if (!s.initialized) {
    s.prevCx = cx
    s.prevCy = cy
    s.prevPanic = panic
    s.prevAspectY = aspectY
    s.prevTimeMs = nowMs
    s.initialized = true
    return PIRATE_REST_SPRING
  }
  const dt = Math.min(0.05, Math.max(0.001, (nowMs - s.prevTimeMs) / 1000))
  s.prevTimeMs = nowMs
  const vx = (cx - s.prevCx) / (dt * r)
  const vy = (cy - s.prevCy) / (dt * r)
  const dvx = vx - s.prevVx
  const dvy = vy - s.prevVy
  s.prevCx = cx
  s.prevCy = cy
  s.prevVx = vx
  s.prevVy = vy
  const dAspect = aspectY - s.prevAspectY
  s.prevAspectY = aspectY
  const dPanic = panic - s.prevPanic
  s.prevPanic = panic

  if (isReducedMotion()) {
    s.hatTilt = 0; s.hatTiltVel = 0
    s.hatBob = 0; s.hatBobVel = 0
    s.tailSway = 0; s.tailSwayVel = 0
    s.parrotBob = 0; s.parrotBobVel = 0
    s.parrotWing = 0; s.parrotWingVel = 0
    return PIRATE_REST_SPRING
  }

  const t = nowMs / 1000
  const idleTail = Math.sin(t * 2.1 + seed * 0.7) * 0.035 + Math.sin(t * 3.4 + 1.1) * 0.018
  const idleParrot = Math.sin(t * 2.6 + seed * 0.9) * 0.024
  const hopPulse = Math.max(0, Math.sin(t * 1.4 + seed * 1.3) - 0.92) / 0.08
  const idleWing = hopPulse * 0.18 + (panic > 0.25 ? Math.sin(t * 14 + seed) * 0.14 * panic : 0)

  const landing = Math.max(0, -dvy) * 0.5 + Math.max(0, -dAspect) * 2.8
  if (landing > 0.02) {
    s.hatBobVel += landing * 1.3
    s.tailSwayVel += landing * 1.4
    s.parrotBobVel -= landing * 1.8
    s.parrotWingVel += landing * 1.6
  }

  const collision = Math.hypot(dvx, dvy) * 0.32
  if (collision > 0.03) {
    s.hatTiltVel += -dvx * 0.75
    s.tailSwayVel += -dvx * 0.95
    s.parrotBobVel += - Math.abs(dvy) * 0.7
  }

  if (dPanic > 0.02) {
    s.parrotBobVel -= dPanic * 1.5
    s.parrotWingVel += dPanic * 1.8
  }

  const step1 = (
    pos: number,
    vel: number,
    target: number,
    freq: number,
    damp: number,
    lo: number,
    hi: number,
  ): [number, number] => {
    const k = freq * freq
    const c = 2 * damp * freq
    const acc = -k * (pos - target) - c * vel
    const nv = vel + acc * dt
    const np = Math.max(lo, Math.min(hi, pos + nv * dt))
    return [np, nv]
  }

  ;[s.hatTilt, s.hatTiltVel] = step1(s.hatTilt, s.hatTiltVel, -dvx * 0.02, 11.5, 0.32, -0.14, 0.14)
  ;[s.hatBob, s.hatBobVel] = step1(s.hatBob, s.hatBobVel, 0, 12.5, 0.34, -0.10, 0.12)
  ;[s.tailSway, s.tailSwayVel] = step1(s.tailSway, s.tailSwayVel, idleTail, 10.5, 0.28, -0.22, 0.22)
  ;[s.parrotBob, s.parrotBobVel] = step1(s.parrotBob, s.parrotBobVel, idleParrot - hopPulse * 0.045, 13.0, 0.28, -0.16, 0.14)
  ;[s.parrotWing, s.parrotWingVel] = step1(s.parrotWing, s.parrotWingVel, idleWing, 14.0, 0.26, -0.12, 0.32)

  pirateSpringOutput.hatTilt = s.hatTilt
  pirateSpringOutput.hatBob = s.hatBob
  pirateSpringOutput.tailSway = s.tailSway
  pirateSpringOutput.parrotBob = s.parrotBob
  pirateSpringOutput.parrotWing = s.parrotWing
  return pirateSpringOutput
}

/**
 * Draw the Tier 9 PIRATE ball — a cheerful golden-yellow swashbuckler ball
 * wearing a red knotted bandana, a dark pirate bicorne hat with gold trim
 * and white skull-and-crossbones emblem, one big glossy left eye and a dark
 * leather eyepatch over the right eye, a stitched left cheek scar, a happy
 * open mouth, a brown leather belt with a gold buckle, and a cute
 * red-yellow-blue parrot perched on the upper right shoulder/brim.
 */
export function drawPirateBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  bodyAngle = 0,
  ballId?: number,
  thumbnail = false,
): void {
  const pal = PIRATE_PALETTES[variant % PIRATE_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(2, r * 0.052)
  const out = thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r)
  const nowMs = Date.now()
  const now = nowMs / 1000
  const expr = panic > 0.45 ? 'normal' : expressionAt(seed, nowMs)
  const cosA = Math.cos(bodyAngle)
  const sinA = Math.sin(bodyAngle)

  // Measure local-frame squash/stretch from the live contour so internal
  // features and anchored props follow the jelly deformation naturally.
  let scaleX = 1
  let scaleY = 1
  let topLocalY = -r
  if (poly && poly.length >= 3) {
    let minLX = Infinity, maxLX = -Infinity
    let minLY = Infinity, maxLY = -Infinity
    let topNear = Infinity
    for (const p of poly) {
      const dx = p.x - cx
      const dy = p.y - cy
      const lx = dx * cosA + dy * sinA
      const ly = -dx * sinA + dy * cosA
      if (lx < minLX) minLX = lx
      if (lx > maxLX) maxLX = lx
      if (ly < minLY) minLY = ly
      if (ly > maxLY) maxLY = ly
      if (Math.abs(lx) < r * 0.48 && ly < topNear) topNear = ly
    }
    scaleX = Math.max(0.76, Math.min(1.26, (maxLX - minLX) / (2 * r)))
    scaleY = Math.max(0.76, Math.min(1.26, (maxLY - minLY) / (2 * r)))
    if (Number.isFinite(topNear)) topLocalY = topNear
  }

  // Transform a body-local point (scaled by squash/stretch) into world coords.
  const bp = (lx: number, ly: number): { x: number; y: number } => {
    const sx = lx * scaleX
    const sy = ly * scaleY
    return {
      x: cx + sx * cosA - sy * sinA,
      y: cy + sx * sinA + sy * cosA,
    }
  }
  // Transform a rigid prop-local point (anchored on the contour) into world coords.
  const rp = (ax: number, ay: number, ux: number, uy: number, rot = 0): { x: number; y: number } => {
    const a = bodyAngle + rot
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    return {
      x: ax + ux * ca - uy * sa,
      y: ay + ux * sa + uy * ca,
    }
  }

  const sp = stepPirateSpring(ballId, seed, cx, cy, r, poly, panic, nowMs)

  // ---- 1. ATMOSPHERIC GLOW ----
  const glowWobble = Math.sin(now * 0.75)
  g.fillStyle(pal.glow, 0.06 + glowWobble * 0.01)
  g.fillCircle(cx, cy, r * (1.40 + glowWobble * 0.02))
  g.fillStyle(pal.glow, 0.08 + glowWobble * 0.01)
  g.fillCircle(cx, cy, r * 1.24)

  // ---- 1B. REAR EYEPATCH STRAP WRAP (peeking behind the head contour) ----
  // Drawn BEFORE the main body fill so the body naturally occludes the interior
  // while the brown strap visibly wraps around the left forehead and right temple.
  {
    const strapOut = thumbnail ? collectionInkWidth(r) * 0.95 : Math.max(1.8, out * 0.72)
    // Upper-left wrap tab emerging behind the head above the left eye / under bandana.
    const l0 = bp(-r * 0.62, -r * 0.66)
    const l1 = bp(-r * 0.48, -r * 0.88)
    const l2 = bp(-r * 0.30, -r * 0.82)
    const l3 = bp(-r * 0.42, -r * 0.56)
    g.fillStyle(pal.beltDark, 1)
    g.beginPath()
    g.moveTo(l0.x, l0.y)
    quadFrom(g, l0.x, l0.y, l1.x, l1.y, l2.x, l2.y)
    g.lineTo(l3.x, l3.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(strapOut, INK, 1)
    g.strokePath()

    // Right temple wrap tab curving around the back of the ball.
    const r0 = bp(r * 0.88, -r * 0.06)
    const r1 = bp(r * 1.07, -r * 0.01)
    const r2 = bp(r * 1.06, r * 0.14)
    const r3 = bp(r * 0.86, r * 0.12)
    g.fillStyle(pal.beltDark, 1)
    g.beginPath()
    g.moveTo(r0.x, r0.y)
    quadFrom(g, r0.x, r0.y, r1.x, r1.y, r2.x, r2.y)
    quadFrom(g, r2.x, r2.y, bp(r * 0.98, r * 0.15).x, bp(r * 0.98, r * 0.15).y, r3.x, r3.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(strapOut, INK, 1)
    g.strokePath()
  }
  // ---- 2. GOLDEN BODY FILL & CLIPPED SHADING ----
  g.fillStyle(pal.body, 1)
  if (poly && poly.length >= 3) {
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillCircle(cx, cy, r)
  }
  pirateBodyClipper.setBody(poly, cx, cy, r)
  // Warm lower shadow crescent.
  g.fillStyle(pal.bodyDark, 0.82)
  pirateBodyClipper.beginPath()
  pirateBodyClipper.arc(cx, cy, r * 0.98, Math.PI * 0.08, Math.PI * 0.92, false)
  pirateBodyClipper.arc(cx, cy + r * 0.54, r * 0.76, Math.PI * 0.92, Math.PI * 0.08, true)
  pirateBodyClipper.fill(g)
  // Upper-left bright highlight arc.
  g.fillStyle(pal.bodyLight, 0.72)
  pirateBodyClipper.beginPath()
  pirateBodyClipper.arc(cx, cy, r * 0.93, Math.PI * 0.96, Math.PI * 1.56, false)
  pirateBodyClipper.arc(cx, cy, r * 0.72, Math.PI * 1.56, Math.PI * 0.96, true)
  pirateBodyClipper.fill(g)

  // ---- 3. LEATHER BELT & GOLD BUCKLE (clipped to lower body) ----
  {
    const clipQuad = (x0: number, y0: number, cx1: number, cy1: number, x1: number, y1: number, steps = 10): void => {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        pirateBodyClipper.lineTo(u * u * x0 + 2 * u * t * cx1 + t * t * x1, u * u * y0 + 2 * u * t * cy1 + t * t * y1)
      }
    }
    const bL = bp(-r * 1.05, r * 0.60)
    const bM = bp(-r * 0.04, r * 0.66)
    const bR = bp(r * 1.04, r * 0.34)
    const bRb = bp(r * 1.04, r * 0.58)
    const bMb = bp(r * 0.0, r * 0.90)
    const bLb = bp(-r * 1.05, r * 0.83)

    // Belt main leather strap.
    g.fillStyle(pal.belt, 1)
    pirateBodyClipper.beginPath()
    pirateBodyClipper.lineTo(bL.x, bL.y)
    clipQuad(bL.x, bL.y, bM.x, bM.y, bR.x, bR.y)
    pirateBodyClipper.lineTo(bRb.x, bRb.y)
    clipQuad(bRb.x, bRb.y, bMb.x, bMb.y, bLb.x, bLb.y)
    pirateBodyClipper.fill(g)

    // Darker bottom bevel on belt.
    const bMs = bp(0, r * 0.80)
    const bLs = bp(-r * 1.05, r * 0.74)
    const bRs = bp(r * 1.04, r * 0.48)
    g.fillStyle(pal.beltDark, 0.65)
    pirateBodyClipper.beginPath()
    pirateBodyClipper.lineTo(bLs.x, bLs.y)
    clipQuad(bLs.x, bLs.y, bMs.x, bMs.y, bRs.x, bRs.y)
    pirateBodyClipper.lineTo(bRb.x, bRb.y)
    clipQuad(bRb.x, bRb.y, bMb.x, bMb.y, bLb.x, bLb.y)
    pirateBodyClipper.fill(g)

    // Belt top & bottom ink borders (clipped to body).
    g.fillStyle(INK, 1)
    const rimHalf = Math.max(1.2, ink * 0.42)
    for (const [p0, p1, p2] of [
      [bL, bM, bR],
      [bLb, bMb, bRb],
    ] as const) {
      pirateBodyClipper.beginPath()
      pirateBodyClipper.lineTo(p0.x, p0.y - rimHalf)
      clipQuad(p0.x, p0.y - rimHalf, p1.x, p1.y - rimHalf, p2.x, p2.y - rimHalf)
      pirateBodyClipper.lineTo(p2.x, p2.y + rimHalf)
      clipQuad(p2.x, p2.y + rimHalf, p1.x, p1.y + rimHalf, p0.x, p0.y + rimHalf)
      pirateBodyClipper.fill(g)
    }
    // Belt punch holes on the right side.
    if (!thumbnail) {
      g.fillStyle(INK, 0.9)
      for (const [hx, hy] of [
        [0.18, 0.68],
        [0.40, 0.62],
      ] as const) {
        const hp = bp(r * hx, r * hy)
        g.fillCircle(hp.x, hp.y, Math.max(1.5, r * 0.036))
      }
    }
  }

  // ---- 4. STITCHED CHEEK SCAR (left cheek below eye) ----
  {
    const s0 = bp(-r * 0.67, r * 0.16)
    const s1 = bp(-r * 0.56, r * 0.30)
    const s2 = bp(-r * 0.43, r * 0.41)
    g.lineStyle(Math.max(1.4, ink * 0.62), 0x6e2214, 0.95)
    g.beginPath()
    g.moveTo(s0.x, s0.y)
    quadFrom(g, s0.x, s0.y, s1.x, s1.y, s2.x, s2.y)
    g.strokePath()
    // Two cross-stitches across the scar.
    for (const [ax, ay, bx, by] of [
      [-0.65, 0.27, -0.55, 0.18],
      [-0.56, 0.37, -0.46, 0.28],
    ] as const) {
      const pA = bp(r * ax, r * ay)
      const pB = bp(r * bx, r * by)
      g.beginPath()
      g.moveTo(pA.x, pA.y)
      g.lineTo(pB.x, pB.y)
      g.strokePath()
    }
  }

  // ---- 5. THE FACE: BIG GLOSSY LEFT EYE, EYEPATCH RIGHT EYE, HAPPY MOUTH ----
  const L = faceLayoutFor(look, r, 1, gaze)
  const em = Math.min(1, panic)
  const blinkMs = (nowMs + seed * 1013) % 4600
  const blinking = panic <= 0.45 && blinkMs < 130

  // Eyepatch continuous brown leather strap wrapping across the entire forehead
  // from the upper-left head contour through the right eye to the right temple contour.
  {
    const clipStrapQuad = (
      x0: number,
      y0: number,
      cx1: number,
      cy1: number,
      x1: number,
      y1: number,
      steps = 12,
    ): void => {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        pirateBodyClipper.lineTo(
          u * u * x0 + 2 * u * t * cx1 + t * t * x1,
          u * u * y0 + 2 * u * t * cy1 + t * t * y1,
        )
      }
    }
    // Top and bottom curves of the front strap span beyond [-r, +r] so
    // pirateBodyClipper trims them cleanly flush against the live body contour.
    const sTop0 = bp(-r * 0.64, -r * 0.86)
    const sTop1 = bp(r * 0.14, -r * 0.30)
    const sTop2 = bp(r * 1.08, -r * 0.01)
    const sBot2 = bp(r * 1.06, r * 0.14)
    const sBot1 = bp(r * 0.06, -r * 0.16)
    const sBot0 = bp(-r * 0.74, -r * 0.74)

    // Main brown leather strap fill.
    g.fillStyle(pal.belt, 1)
    pirateBodyClipper.beginPath()
    pirateBodyClipper.lineTo(sTop0.x, sTop0.y)
    clipStrapQuad(sTop0.x, sTop0.y, sTop1.x, sTop1.y, sTop2.x, sTop2.y)
    pirateBodyClipper.lineTo(sBot2.x, sBot2.y)
    clipStrapQuad(sBot2.x, sBot2.y, sBot1.x, sBot1.y, sBot0.x, sBot0.y)
    pirateBodyClipper.fill(g)

    // Lower bevel shading along the strap.
    const sMid0 = bp(-r * 0.70, -r * 0.79)
    const sMid1 = bp(r * 0.09, -r * 0.22)
    const sMid2 = bp(r * 1.07, r * 0.08)
    g.fillStyle(pal.beltDark, 0.65)
    pirateBodyClipper.beginPath()
    pirateBodyClipper.lineTo(sMid0.x, sMid0.y)
    clipStrapQuad(sMid0.x, sMid0.y, sMid1.x, sMid1.y, sMid2.x, sMid2.y)
    pirateBodyClipper.lineTo(sBot2.x, sBot2.y)
    clipStrapQuad(sBot2.x, sBot2.y, sBot1.x, sBot1.y, sBot0.x, sBot0.y)
    pirateBodyClipper.fill(g)

    // Top and bottom dark ink borders along the strap (clipped to body).
    const strapRim = Math.max(1.1, ink * 0.38)
    g.fillStyle(INK, 1)
    for (const [p0, p1, p2] of [
      [sTop0, sTop1, sTop2],
      [sBot0, sBot1, sBot2],
    ] as const) {
      pirateBodyClipper.beginPath()
      pirateBodyClipper.lineTo(p0.x, p0.y - strapRim)
      clipStrapQuad(p0.x, p0.y - strapRim, p1.x, p1.y - strapRim, p2.x, p2.y - strapRim)
      pirateBodyClipper.lineTo(p2.x, p2.y + strapRim)
      clipStrapQuad(p2.x, p2.y + strapRim, p1.x, p1.y + strapRim, p0.x, p0.y + strapRim)
      pirateBodyClipper.fill(g)
    }
  }

  // Left eye (index 0): large expressive eye with dark pupil + dual white highlights.
  {
    const e0 = L.eyes[0]!
    const ex = -r * 0.25
    const ey = -r * 0.02
    const ec = bp(ex, ey)
    const wa = r * 0.30 * scaleX * (1 + 0.10 * em)
    const wb = r * 0.34 * scaleY * (1 + 0.16 * em)
    const rimW = thumbnail ? collectionInkWidth(r) * 1.05 : Math.max(2.2, ink * 0.92)
    const closed = blinking || expr === 'wink'
    if (closed) {
      g.lineStyle(rimW, INK, 1)
      g.beginPath()
      for (let s = 0; s <= 12; s++) {
        const u = -1 + (2 * s) / 12
        const lp = bp(ex + u * r * 0.26, ey - r * 0.02 + (1 - u * u) * r * 0.12)
        if (s === 0) g.moveTo(lp.x, lp.y)
        else g.lineTo(lp.x, lp.y)
      }
      g.strokePath()
    } else {
      g.fillStyle(0xffffff, 1)
      g.fillEllipse(ec.x, ec.y, wa * 2, wb * 2)
      g.lineStyle(rimW, INK, 1)
      g.strokeEllipse(ec.x, ec.y, wa * 2, wb * 2)
      const pa = wa * 0.68
      const pb = wb * 0.70 * (1 - 0.32 * em)
      const gx = (e0.px / Math.max(0.001, e0.a)) * (wa - pa) * 0.65
      const gy = (e0.py / Math.max(0.001, e0.b)) * (wb - pb) * 0.55 * (1 - em) - wb * 0.22 * em
      const pcx = ec.x + gx + wa * 0.05
      const pcy = ec.y + gy
      g.fillStyle(INK, 1)
      g.fillEllipse(pcx, pcy, pa * 2, pb * 2)
      // Glossy top-right highlight + small lower-left dot (matching reference).
      g.fillStyle(0xffffff, 1)
      g.fillCircle(pcx + pa * 0.26, pcy - pb * 0.28, pa * 0.34)
      g.fillCircle(pcx - pa * 0.24, pcy + pb * 0.32, pa * 0.16)
    }
  }

  // Right eye (index 1): white sclera crescent peeking from beneath the dark leather eyepatch.
  {
    const ex = r * 0.37
    const ey = -r * 0.02
    const ec = bp(ex, ey)
    const wa = r * 0.27 * scaleX
    const wb = r * 0.31 * scaleY
    const rimW = thumbnail ? collectionInkWidth(r) : Math.max(2, ink * 0.88)
    // Underlying eye sclera & lower pupil rim peeking at bottom-left of patch.
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(ec.x, ec.y, wa * 2, wb * 2)
    g.fillStyle(INK, 1)
    g.fillEllipse(ec.x - wa * 0.05, ec.y + wb * 0.04, wa * 1.25, wb * 1.25)
    g.lineStyle(rimW, INK, 1)
    g.strokeEllipse(ec.x, ec.y, wa * 2, wb * 2)

    // Dark tilted rounded eyepatch pad over the right eye.
    const p0 = bp(ex - r * 0.24, ey - r * 0.24)
    const p1 = bp(ex + r * 0.06, ey - r * 0.30)
    const p2 = bp(ex + r * 0.31, ey - r * 0.12)
    const p3 = bp(ex + r * 0.36, ey + r * 0.12)
    const p4 = bp(ex + r * 0.18, ey + r * 0.28)
    const p5 = bp(ex - r * 0.08, ey + r * 0.27)
    const p6 = bp(ex - r * 0.27, ey + r * 0.10)
    const p7 = bp(ex - r * 0.28, ey - r * 0.12)
    g.fillStyle(pal.hat, 1)
    g.beginPath()
    g.moveTo(p0.x, p0.y)
    quadFrom(g, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)
    quadFrom(g, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y)
    quadFrom(g, p4.x, p4.y, p5.x, p5.y, p6.x, p6.y)
    quadFrom(g, p6.x, p6.y, p7.x, p7.y, p0.x, p0.y)
    g.closePath()
    g.fillPath()
    // Subtle lighter highlight along top-left edge of eyepatch.
    g.fillStyle(0x473d4a, 0.55)
    const h0 = bp(ex - r * 0.18, ey - r * 0.17)
    const h1 = bp(ex + r * 0.05, ey - r * 0.21)
    const h2 = bp(ex + r * 0.20, ey - r * 0.08)
    const h3 = bp(ex - r * 0.04, ey - r * 0.04)
    g.beginPath()
    g.moveTo(h0.x, h0.y)
    quadFrom(g, h0.x, h0.y, h1.x, h1.y, h2.x, h2.y)
    quadFrom(g, h2.x, h2.y, h3.x, h3.y, h0.x, h0.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(rimW * 1.05, INK, 1)
    g.beginPath()
    g.moveTo(p0.x, p0.y)
    quadFrom(g, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)
    quadFrom(g, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y)
    quadFrom(g, p4.x, p4.y, p5.x, p5.y, p6.x, p6.y)
    quadFrom(g, p6.x, p6.y, p7.x, p7.y, p0.x, p0.y)
    g.closePath()
    g.strokePath()
  }

  // Cheerful open D-mouth with red-pink tongue (morphs to tense O when panicking).
  {
    const mx = 0.04 * r
    const my = 0.31 * r
    const mw = r * (expr === 'grin' ? 0.18 : 0.15)
    const mh = r * (0.19 - 0.06 * em)
    const mL = bp(mx - mw, my)
    const mT = bp(mx, my + r * 0.02)
    const mR = bp(mx + mw, my - r * 0.01)
    const mB = bp(mx + r * 0.01, my + mh)
    g.fillStyle(0x521210, 1)
    g.beginPath()
    g.moveTo(mL.x, mL.y)
    quadFrom(g, mL.x, mL.y, mT.x, mT.y, mR.x, mR.y)
    quadFrom(g, mR.x, mR.y, bp(mx + mw * 0.95, my + mh * 0.92).x, bp(mx + mw * 0.95, my + mh * 0.92).y, mB.x, mB.y)
    quadFrom(g, mB.x, mB.y, bp(mx - mw * 0.92, my + mh * 0.92).x, bp(mx - mw * 0.92, my + mh * 0.92).y, mL.x, mL.y)
    g.closePath()
    g.fillPath()
    // Tongue fill inside lower mouth.
    if (em < 0.65) {
      const tL = bp(mx - mw * 0.72, my + mh * 0.36)
      const tM = bp(mx, my + mh * 0.18)
      const tR = bp(mx + mw * 0.74, my + mh * 0.34)
      g.fillStyle(0xf24b4b, 1)
      g.beginPath()
      g.moveTo(tL.x, tL.y)
      quadFrom(g, tL.x, tL.y, tM.x, tM.y, tR.x, tR.y)
      quadFrom(g, tR.x, tR.y, mB.x, mB.y, tL.x, tL.y)
      g.closePath()
      g.fillPath()
    }
    g.lineStyle(Math.max(1.6, ink * 0.82), INK, 1)
    g.beginPath()
    g.moveTo(mL.x, mL.y)
    quadFrom(g, mL.x, mL.y, mT.x, mT.y, mR.x, mR.y)
    quadFrom(g, mR.x, mR.y, bp(mx + mw * 0.95, my + mh * 0.92).x, bp(mx + mw * 0.95, my + mh * 0.92).y, mB.x, mB.y)
    quadFrom(g, mB.x, mB.y, bp(mx - mw * 0.92, my + mh * 0.92).x, bp(mx - mw * 0.92, my + mh * 0.92).y, mL.x, mL.y)
    g.closePath()
    g.strokePath()
  }

  // Fear sweat drop on left cheek when panic rises.
  if (panic > 0.45) {
    const sweat = Math.min(1, (panic - 0.45) / 0.55)
    const spPos = bp(-r * 0.68, -r * 0.04)
    g.fillStyle(0x9fdcff, 0.95 * sweat)
    g.fillCircle(spPos.x, spPos.y, r * 0.055 * (0.7 + 0.3 * sweat))
  }

  // ---- 6. THE BODY INK OUTLINE (drawn once before overhanging props) ----
  g.lineStyle(out, INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }

  // ---- 7. GOLD BELT BUCKLE (sits slightly proud over the belt on lower-left) ----
  {
    const bkC = bp(-r * 0.14, r * 0.74)
    const bkTilt = -0.10
    const bw = r * 0.38
    const bh = r * 0.36
    const bOut = thumbnail ? collectionInkWidth(r) : Math.max(1.8, ink * 0.82)
    const b0 = rp(bkC.x, bkC.y, -bw / 2, -bh / 2, bkTilt)
    const b1 = rp(bkC.x, bkC.y, bw / 2, -bh / 2, bkTilt)
    const b2 = rp(bkC.x, bkC.y, bw / 2, bh / 2, bkTilt)
    const b3 = rp(bkC.x, bkC.y, -bw / 2, bh / 2, bkTilt)
    g.fillStyle(pal.gold, 1)
    g.beginPath()
    g.moveTo(b0.x, b0.y)
    g.lineTo(b1.x, b1.y)
    g.lineTo(b2.x, b2.y)
    g.lineTo(b3.x, b3.y)
    g.closePath()
    g.fillPath()
    // Top-left gold highlight.
    const bh0 = rp(bkC.x, bkC.y, -bw * 0.42, -bh * 0.42, bkTilt)
    const bh1 = rp(bkC.x, bkC.y, bw * 0.36, -bh * 0.42, bkTilt)
    const bh2 = rp(bkC.x, bkC.y, bw * 0.25, -bh * 0.24, bkTilt)
    const bh3 = rp(bkC.x, bkC.y, -bw * 0.42, -bh * 0.24, bkTilt)
    g.fillStyle(pal.goldLight, 0.85)
    g.beginPath()
    g.moveTo(bh0.x, bh0.y)
    g.lineTo(bh1.x, bh1.y)
    g.lineTo(bh2.x, bh2.y)
    g.lineTo(bh3.x, bh3.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(bOut, INK, 1)
    g.beginPath()
    g.moveTo(b0.x, b0.y)
    g.lineTo(b1.x, b1.y)
    g.lineTo(b2.x, b2.y)
    g.lineTo(b3.x, b3.y)
    g.closePath()
    g.strokePath()

    // Inner leather window inside buckle.
    const iw = bw * 0.46
    const ih = bh * 0.44
    const i0 = rp(bkC.x, bkC.y, -iw / 2, -ih / 2, bkTilt)
    const i1 = rp(bkC.x, bkC.y, iw / 2, -ih / 2, bkTilt)
    const i2 = rp(bkC.x, bkC.y, iw / 2, ih / 2, bkTilt)
    const i3 = rp(bkC.x, bkC.y, -iw / 2, ih / 2, bkTilt)
    g.fillStyle(pal.beltDark, 1)
    g.beginPath()
    g.moveTo(i0.x, i0.y)
    g.lineTo(i1.x, i1.y)
    g.lineTo(i2.x, i2.y)
    g.lineTo(i3.x, i3.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(bOut * 0.78, INK, 1)
    g.strokePath()

    // Gold buckle prong bar.
    const pr0 = rp(bkC.x, bkC.y, 0, 0, bkTilt)
    const pr1 = rp(bkC.x, bkC.y, bw * 0.46, 0, bkTilt)
    g.lineStyle(bOut * 1.25, INK, 1)
    g.beginPath()
    g.moveTo(pr0.x, pr0.y)
    g.lineTo(pr1.x, pr1.y)
    g.strokePath()
    g.lineStyle(bOut * 0.65, pal.goldLight, 1)
    g.beginPath()
    g.moveTo(pr0.x, pr0.y)
    g.lineTo(pr1.x, pr1.y)
    g.strokePath()
  }

  // ---- 8. HEADGEAR ANCHOR (glued to top contour + spring bob/tilt) ----
  const headAnchor = bp(0, topLocalY + r * (0.48 + sp.hatBob))
  const headRot = sp.hatTilt
  const hp = (ux: number, uy: number): { x: number; y: number } => rp(headAnchor.x, headAnchor.y, ux, uy, headRot)

  // ---- 8A. RED BANDANA (headband + left knot + two fluttering tails) ----
  {
    const bdOut = thumbnail ? collectionInkWidth(r) : Math.max(2.2, out * 0.82)
    // Two left bandana tails (drawn behind the knot).
    const sw = sp.tailSway * r
    // Upper tail sticking out to the left.
    const t1a = hp(-r * 0.78, -r * 0.24)
    const t1b = hp(-r * 1.18, -r * 0.22 + sw * 0.45)
    const t1c = hp(-r * 1.44, -r * 0.02 + sw * 0.9)
    const t1d = hp(-r * 1.12, r * 0.05 + sw * 0.5)
    g.fillStyle(pal.bandana, 1)
    g.beginPath()
    g.moveTo(t1a.x, t1a.y)
    quadFrom(g, t1a.x, t1a.y, t1b.x, t1b.y, t1c.x, t1c.y)
    quadFrom(g, t1c.x, t1c.y, t1d.x, t1d.y, hp(-r * 0.80, -r * 0.06).x, hp(-r * 0.80, -r * 0.06).y)
    g.closePath()
    g.fillPath()
    g.lineStyle(bdOut, INK, 1)
    g.strokePath()

    // Lower tail hanging down-left.
    const t2a = hp(-r * 0.76, -r * 0.10)
    const t2b = hp(-r * 1.16, r * 0.06 + sw * 0.5)
    const t2c = hp(-r * 1.28, r * 0.38 + sw * 1.0)
    const t2d = hp(-r * 0.92, r * 0.24 + sw * 0.5)
    const t2e = hp(-r * 0.72, r * 0.08)
    g.fillStyle(pal.bandana, 1)
    g.beginPath()
    g.moveTo(t2a.x, t2a.y)
    quadFrom(g, t2a.x, t2a.y, t2b.x, t2b.y, t2c.x, t2c.y)
    quadFrom(g, t2c.x, t2c.y, t2d.x, t2d.y, t2e.x, t2e.y)
    g.closePath()
    g.fillPath()
    // Fold line inside lower tail.
    g.lineStyle(Math.max(1.2, ink * 0.55), pal.bandanaDark, 0.85)
    g.beginPath()
    g.moveTo(hp(-r * 0.84, -r * 0.02).x, hp(-r * 0.84, -r * 0.02).y)
    quadFrom(g, hp(-r * 0.84, -r * 0.02).x, hp(-r * 0.84, -r * 0.02).y, hp(-r * 1.04, r * 0.12 + sw * 0.5).x, hp(-r * 1.04, r * 0.12 + sw * 0.5).y, hp(-r * 1.14, r * 0.26 + sw * 0.8).x, hp(-r * 1.14, r * 0.26 + sw * 0.8).y)
    g.strokePath()
    g.lineStyle(bdOut, INK, 1)
    g.beginPath()
    g.moveTo(t2a.x, t2a.y)
    quadFrom(g, t2a.x, t2a.y, t2b.x, t2b.y, t2c.x, t2c.y)
    quadFrom(g, t2c.x, t2c.y, t2d.x, t2d.y, t2e.x, t2e.y)
    g.closePath()
    g.strokePath()

    // Main red bandana headband wrapping across forehead.
    const b0 = hp(-r * 0.84, -r * 0.12)
    const b1 = hp(-r * 0.08, -r * 0.64)
    const b2 = hp(r * 0.84, -r * 0.26)
    const b3 = hp(r * 0.88, -r * 0.06)
    const b4 = hp(-r * 0.04, -r * 0.42)
    const b5 = hp(-r * 0.76, r * 0.04)
    g.fillStyle(pal.bandana, 1)
    g.beginPath()
    g.moveTo(b0.x, b0.y)
    quadFrom(g, b0.x, b0.y, b1.x, b1.y, b2.x, b2.y)
    g.lineTo(b3.x, b3.y)
    quadFrom(g, b3.x, b3.y, b4.x, b4.y, b5.x, b5.y)
    g.closePath()
    g.fillPath()
    // Cloth fold crease across bandana.
    g.lineStyle(Math.max(1.3, ink * 0.6), pal.bandanaDark, 0.85)
    g.beginPath()
    const f0 = hp(-r * 0.66, -r * 0.08)
    const f1 = hp(-r * 0.04, -r * 0.50)
    const f2 = hp(r * 0.66, -r * 0.18)
    g.moveTo(f0.x, f0.y)
    quadFrom(g, f0.x, f0.y, f1.x, f1.y, f2.x, f2.y)
    g.strokePath()
    g.lineStyle(bdOut, INK, 1)
    g.beginPath()
    g.moveTo(b0.x, b0.y)
    quadFrom(g, b0.x, b0.y, b1.x, b1.y, b2.x, b2.y)
    g.lineTo(b3.x, b3.y)
    quadFrom(g, b3.x, b3.y, b4.x, b4.y, b5.x, b5.y)
    g.closePath()
    g.strokePath()

    // Plump rounded bandana knot on the left temple.
    const kC = hp(-r * 0.82, -r * 0.11)
    const kR = r * 0.165
    g.fillStyle(pal.bandana, 1)
    g.fillCircle(kC.x, kC.y, kR)
    g.fillStyle(pal.bandanaLight, 0.65)
    g.fillCircle(kC.x - kR * 0.24, kC.y - kR * 0.24, kR * 0.45)
    g.lineStyle(bdOut, INK, 1)
    g.strokeCircle(kC.x, kC.y, kR)
  }

  // ---- 8B. PIRATE BICORNE HAT (gold trim, back crown, charcoal brim, skull emblem) ----
  {
    const hatOut = thumbnail ? collectionInkWidth(r) * 1.1 : Math.max(2.6, out * 0.94)
    // Back crown dome peeking behind the left-top slope of the bicorne.
    const dm0 = hp(-r * 0.72, -r * 0.66)
    const dm1 = hp(-r * 0.52, -r * 1.18)
    const dm2 = hp(-r * 0.14, -r * 1.12)
    g.fillStyle(pal.hatDark, 1)
    g.beginPath()
    g.moveTo(dm0.x, dm0.y)
    quadFrom(g, dm0.x, dm0.y, dm1.x, dm1.y, dm2.x, dm2.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(hatOut * 0.9, INK, 1)
    g.strokePath()
    // Gold piping on back crown.
    g.lineStyle(Math.max(2, r * 0.065), pal.gold, 1)
    g.beginPath()
    g.moveTo(hp(-r * 0.68, -r * 0.68).x, hp(-r * 0.68, -r * 0.68).y)
    quadFrom(g, hp(-r * 0.68, -r * 0.68).x, hp(-r * 0.68, -r * 0.68).y, hp(-r * 0.50, -r * 1.12).x, hp(-r * 0.50, -r * 1.12).y, hp(-r * 0.20, -r * 1.08).x, hp(-r * 0.20, -r * 1.08).y)
    g.strokePath()

    // Outer gold-trimmed bicorne silhouette.
    const traceHatOuter = (): void => {
      const pL = hp(-r * 1.16, -r * 0.20)
      const cL1 = hp(-r * 1.30, -r * 0.56)
      const pSubL = hp(-r * 0.76, -r * 0.74)
      const cPeakL = hp(-r * 0.42, -r * 1.32)
      const pPeak = hp(-r * 0.02, -r * 1.30)
      const cPeakR = hp(r * 0.42, -r * 1.28)
      const pDipR = hp(r * 0.74, -r * 0.72)
      const cR1 = hp(r * 1.14, -r * 0.52)
      const pR = hp(r * 1.02, -r * 0.08)
      const cBotR = hp(r * 0.48, -r * 0.40)
      const pBotM = hp(-r * 0.06, -r * 0.54)
      const cBotL = hp(-r * 0.64, -r * 0.42)
      g.moveTo(pL.x, pL.y)
      quadFrom(g, pL.x, pL.y, cL1.x, cL1.y, pSubL.x, pSubL.y)
      quadFrom(g, pSubL.x, pSubL.y, cPeakL.x, cPeakL.y, pPeak.x, pPeak.y)
      quadFrom(g, pPeak.x, pPeak.y, cPeakR.x, cPeakR.y, pDipR.x, pDipR.y)
      quadFrom(g, pDipR.x, pDipR.y, cR1.x, cR1.y, pR.x, pR.y)
      quadFrom(g, pR.x, pR.y, cBotR.x, cBotR.y, pBotM.x, pBotM.y)
      quadFrom(g, pBotM.x, pBotM.y, cBotL.x, cBotL.y, pL.x, pL.y)
      g.closePath()
    }
    g.fillStyle(pal.gold, 1)
    g.beginPath()
    traceHatOuter()
    g.fillPath()

    // Gold trim top-left specular highlight.
    g.fillStyle(pal.goldLight, 0.85)
    g.beginPath()
    const gh0 = hp(-r * 0.72, -r * 0.70)
    const gh1 = hp(-r * 0.40, -r * 1.25)
    const gh2 = hp(-r * 0.02, -r * 1.24)
    const gh3 = hp(-r * 0.36, -r * 1.12)
    g.moveTo(gh0.x, gh0.y)
    quadFrom(g, gh0.x, gh0.y, gh1.x, gh1.y, gh2.x, gh2.y)
    quadFrom(g, gh2.x, gh2.y, gh3.x, gh3.y, gh0.x, gh0.y)
    g.closePath()
    g.fillPath()

    g.lineStyle(hatOut, INK, 1)
    g.beginPath()
    traceHatOuter()
    g.strokePath()

    // Inner dark charcoal bicorne front panel.
    const traceHatInner = (): void => {
      const iL = hp(-r * 1.00, -r * 0.25)
      const icL1 = hp(-r * 1.12, -r * 0.50)
      const iSubL = hp(-r * 0.68, -r * 0.64)
      const icPeakL = hp(-r * 0.36, -r * 1.14)
      const iPeak = hp(-r * 0.02, -r * 1.13)
      const icPeakR = hp(r * 0.34, -r * 1.11)
      const iDipR = hp(r * 0.66, -r * 0.63)
      const icR1 = hp(r * 0.98, -r * 0.46)
      const iR = hp(r * 0.88, -r * 0.16)
      const icBotR = hp(r * 0.44, -r * 0.42)
      const iBotM = hp(-r * 0.06, -r * 0.54)
      const icBotL = hp(-r * 0.60, -r * 0.42)
      g.moveTo(iL.x, iL.y)
      quadFrom(g, iL.x, iL.y, icL1.x, icL1.y, iSubL.x, iSubL.y)
      quadFrom(g, iSubL.x, iSubL.y, icPeakL.x, icPeakL.y, iPeak.x, iPeak.y)
      quadFrom(g, iPeak.x, iPeak.y, icPeakR.x, icPeakR.y, iDipR.x, iDipR.y)
      quadFrom(g, iDipR.x, iDipR.y, icR1.x, icR1.y, iR.x, iR.y)
      quadFrom(g, iR.x, iR.y, icBotR.x, icBotR.y, iBotM.x, iBotM.y)
      quadFrom(g, iBotM.x, iBotM.y, icBotL.x, icBotL.y, iL.x, iL.y)
      g.closePath()
    }
    g.fillStyle(pal.hat, 1)
    g.beginPath()
    traceHatInner()
    g.fillPath()
    g.lineStyle(hatOut * 0.86, INK, 1)
    g.beginPath()
    traceHatInner()
    g.strokePath()

    // Crisp white skull-and-crossbones emblem on the hat front.
    const skX = -r * 0.04
    const skY = -r * 0.82
    const boneW = thumbnail ? Math.max(1.2, r * 0.055) : Math.max(2, r * 0.065)
    g.lineStyle(boneW, 0xf7f2eb, 1)
    for (const sx of [-1, 1]) {
      const bA = hp(skX - sx * r * 0.24, skY - r * 0.14)
      const bB = hp(skX + sx * r * 0.24, skY + r * 0.14)
      g.beginPath()
      g.moveTo(bA.x, bA.y)
      g.lineTo(bB.x, bB.y)
      g.strokePath()
      if (!thumbnail) {
        g.fillStyle(0xf7f2eb, 1)
        const kR = r * 0.042
        g.fillCircle(bA.x - sx * r * 0.015, bA.y - r * 0.02, kR)
        g.fillCircle(bA.x - sx * r * 0.03, bA.y + r * 0.02, kR)
        g.fillCircle(bB.x + sx * r * 0.015, bB.y + r * 0.02, kR)
        g.fillCircle(bB.x + sx * r * 0.03, bB.y - r * 0.02, kR)
      }
    }
    // Skull cranium + jaw.
    const skC = hp(skX, skY - r * 0.02)
    const skJaw = hp(skX, skY + r * 0.09)
    g.fillStyle(0xf7f2eb, 1)
    g.fillEllipse(skC.x, skC.y, r * 0.28, r * 0.23)
    g.fillRoundedRect(skJaw.x - r * 0.085, skJaw.y - r * 0.04, r * 0.17, r * 0.10, r * 0.03)
    // Skull eye sockets + nasal triangle + teeth notches.
    g.fillStyle(pal.hatDark, 1)
    const eL = hp(skX - r * 0.055, skY - r * 0.02)
    const eR = hp(skX + r * 0.055, skY - r * 0.02)
    g.fillCircle(eL.x, eL.y, Math.max(1.1, r * 0.036))
    g.fillCircle(eR.x, eR.y, Math.max(1.1, r * 0.036))
    if (!thumbnail) {
      const nC = hp(skX, skY + r * 0.035)
      g.fillCircle(nC.x, nC.y, Math.max(0.9, r * 0.022))
      g.lineStyle(Math.max(1, ink * 0.4), pal.hatDark, 0.9)
      for (const tx of [-0.035, 0, 0.035]) {
        const t0 = hp(skX + r * tx, skY + r * 0.08)
        const t1 = hp(skX + r * tx, skY + r * 0.13)
        g.beginPath()
        g.moveTo(t0.x, t0.y)
        g.lineTo(t1.x, t1.y)
        g.strokePath()
      }
    }
  }

  if (thumbnail || ballId === undefined) drawPirateAccessory(g, cx, cy, r, pal, bp, rp, sp, panic, out, thumbnail)
  else pirateAccessoryPoses.set(ballId, { cx, cy, r, pal, scaleX, scaleY, bodyAngle, hatTilt: sp.hatTilt, parrotBob: sp.parrotBob, parrotWing: sp.parrotWing, panic, out })
}

export function drawPirateAccessory(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  pal: PiratePalette,
  bp: (lx: number, ly: number) => { x: number; y: number },
  rp: (ax: number, ay: number, ux: number, uy: number, rot?: number) => { x: number; y: number },
  sp: PirateSpringOutput,
  panic: number,
  out: number,
  thumbnail: boolean,
): void {
  void cx
  void cy
  // Slightly finer line weight than the main ball so small details stay readable.
    const prOut = thumbnail ? Math.max(1.1, collectionInkWidth(r) * 0.66) : Math.max(1.35, out * 0.50)
    const prDetail = thumbnail ? Math.max(0.85, prOut * 0.68) : Math.max(1.0, prOut * 0.64)
    const prAnchor = bp(r * 0.80, -r * (0.44 - sp.parrotBob))
    const prRot = sp.hatTilt * 0.7
    const pp = (ux: number, uy: number): { x: number; y: number } => rp(prAnchor.x, prAnchor.y, ux, uy, prRot)

    // Red & blue tail feathers hanging down below the perch.
    const tf0 = pp(-r * 0.02, r * 0.16)
    const tf1 = pp(-r * 0.01, r * 0.58)
    const tf2 = pp(r * 0.09, r * 0.42)
    const tf3 = pp(r * 0.16, r * 0.60)
    const tf4 = pp(r * 0.22, r * 0.16)
    g.fillStyle(pal.parrotBlue, 1)
    g.beginPath()
    g.moveTo(tf1.x, tf1.y)
    g.lineTo(tf2.x, tf2.y)
    g.lineTo(tf3.x, tf3.y)
    quadFrom(g, tf3.x, tf3.y, pp(r * 0.22, r * 0.42).x, pp(r * 0.22, r * 0.42).y, tf4.x, tf4.y)
    g.closePath()
    g.fillPath()
    g.fillStyle(pal.parrotRedDark, 1)
    g.beginPath()
    g.moveTo(tf0.x, tf0.y)
    quadFrom(g, tf0.x, tf0.y, pp(-r * 0.04, r * 0.42).x, pp(-r * 0.04, r * 0.42).y, tf1.x, tf1.y)
    g.lineTo(tf2.x, tf2.y)
    quadFrom(g, tf2.x, tf2.y, pp(r * 0.15, r * 0.34).x, pp(r * 0.15, r * 0.34).y, tf4.x, tf4.y)
    g.closePath()
    g.fillPath()
    // Delicate feather split line on tail.
    g.lineStyle(prDetail * 0.85, INK, 0.85)
    g.beginPath()
    g.moveTo(pp(r * 0.08, r * 0.20).x, pp(r * 0.08, r * 0.20).y)
    g.lineTo(tf2.x, tf2.y)
    g.strokePath()
    g.lineStyle(prOut * 0.9, INK, 1)
    g.beginPath()
    g.moveTo(tf0.x, tf0.y)
    quadFrom(g, tf0.x, tf0.y, pp(-r * 0.04, r * 0.42).x, pp(-r * 0.04, r * 0.42).y, tf1.x, tf1.y)
    g.lineTo(tf2.x, tf2.y)
    g.lineTo(tf3.x, tf3.y)
    quadFrom(g, tf3.x, tf3.y, pp(r * 0.22, r * 0.42).x, pp(r * 0.22, r * 0.42).y, tf4.x, tf4.y)
    g.closePath()
    g.strokePath()

    // Parrot plump red body + head crest.
    const pb0 = pp(-r * 0.19, r * 0.02)
    const pb1 = pp(-r * 0.23, -r * 0.30)
    const pb2 = pp(-r * 0.16, -r * 0.59)
    const pb3 = pp(r * 0.06, -r * 0.67)
    const pb4 = pp(r * 0.28, -r * 0.51)
    const pb5 = pp(r * 0.39, -r * 0.45) // crest tuft
    const pb6 = pp(r * 0.26, -r * 0.34)
    const pb7 = pp(r * 0.33, r * 0.04)
    const pb8 = pp(r * 0.08, r * 0.24)
    g.fillStyle(pal.parrotRed, 1)
    g.beginPath()
    g.moveTo(pb0.x, pb0.y)
    quadFrom(g, pb0.x, pb0.y, pb1.x, pb1.y, pb2.x, pb2.y)
    quadFrom(g, pb2.x, pb2.y, pb3.x, pb3.y, pb4.x, pb4.y)
    g.lineTo(pb5.x, pb5.y)
    g.lineTo(pb6.x, pb6.y)
    quadFrom(g, pb6.x, pb6.y, pb7.x, pb7.y, pb8.x, pb8.y)
    quadFrom(g, pb8.x, pb8.y, pp(-r * 0.12, r * 0.20).x, pp(-r * 0.12, r * 0.20).y, pb0.x, pb0.y)
    g.closePath()
    g.fillPath()
    // Warm crown highlight on parrot head.
    const phC = pp(r * 0.02, -r * 0.55)
    g.fillStyle(0xff766b, 0.55)
    g.fillEllipse(phC.x, phC.y, r * 0.20, r * 0.10)
    // Delicate chest feather scallops.
    if (!thumbnail) {
      g.lineStyle(Math.max(0.85, prDetail * 0.72), pal.parrotRedDark, 0.82)
      for (const [cx0, cy0] of [
        [-0.08, -0.11],
        [0.01, -0.06],
        [-0.04, 0.02],
      ] as const) {
        const sc0 = pp(r * (cx0 - 0.045), r * cy0)
        const sc1 = pp(r * cx0, r * (cy0 + 0.055))
        const sc2 = pp(r * (cx0 + 0.045), r * cy0)
        g.beginPath()
        g.moveTo(sc0.x, sc0.y)
        quadFrom(g, sc0.x, sc0.y, sc1.x, sc1.y, sc2.x, sc2.y)
        g.strokePath()
      }
    }
    g.lineStyle(prOut, INK, 1)
    g.beginPath()
    g.moveTo(pb0.x, pb0.y)
    quadFrom(g, pb0.x, pb0.y, pb1.x, pb1.y, pb2.x, pb2.y)
    quadFrom(g, pb2.x, pb2.y, pb3.x, pb3.y, pb4.x, pb4.y)
    g.lineTo(pb5.x, pb5.y)
    g.lineTo(pb6.x, pb6.y)
    quadFrom(g, pb6.x, pb6.y, pb7.x, pb7.y, pb8.x, pb8.y)
    quadFrom(g, pb8.x, pb8.y, pp(-r * 0.12, r * 0.20).x, pp(-r * 0.12, r * 0.20).y, pb0.x, pb0.y)
    g.closePath()
    g.strokePath()

    // Crisp white eye patch + expressive eye on the parrot.
    const peC = pp(r * 0.05, -r * 0.42)
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(peC.x, peC.y, r * 0.22, r * 0.25)
    g.lineStyle(prDetail, INK, 1)
    g.strokeEllipse(peC.x, peC.y, r * 0.22, r * 0.25)
    if (panic > 0.5) {
      g.fillStyle(INK, 1)
      g.fillCircle(peC.x, peC.y, Math.max(1.2, r * 0.045))
    } else {
      const ea0 = pp(-r * 0.005, -r * 0.40)
      const ea1 = pp(r * 0.05, -r * 0.48)
      const ea2 = pp(r * 0.105, -r * 0.39)
      g.lineStyle(Math.max(1.15, prDetail * 1.05), INK, 1)
      g.beginPath()
      g.moveTo(ea0.x, ea0.y)
      quadFrom(g, ea0.x, ea0.y, ea1.x, ea1.y, ea2.x, ea2.y)
      g.strokePath()
    }

    // Hooked golden-yellow beak (lower mandible + upper hooked maxilla with highlight).
    const lb0 = pp(-r * 0.18, -r * 0.30)
    const lb1 = pp(-r * 0.11, -r * 0.19)
    const lb2 = pp(-r * 0.03, -r * 0.28)
    g.fillStyle(pal.goldDark, 1)
    g.beginPath()
    g.moveTo(lb0.x, lb0.y)
    quadFrom(g, lb0.x, lb0.y, lb1.x, lb1.y, lb2.x, lb2.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(prDetail, INK, 1)
    g.strokePath()

    const bk0 = pp(-r * 0.04, -r * 0.51)
    const bk1 = pp(-r * 0.31, -r * 0.49)
    const bk2 = pp(-r * 0.28, -r * 0.24)
    const bk3 = pp(-r * 0.03, -r * 0.32)
    g.fillStyle(pal.parrotYellow, 1)
    g.beginPath()
    g.moveTo(bk0.x, bk0.y)
    quadFrom(g, bk0.x, bk0.y, bk1.x, bk1.y, bk2.x, bk2.y)
    quadFrom(g, bk2.x, bk2.y, bk3.x, bk3.y, bk0.x, bk0.y)
    g.closePath()
    g.fillPath()
    // Bright culmen highlight on upper beak.
    const bkh0 = pp(-r * 0.07, -r * 0.47)
    const bkh1 = pp(-r * 0.23, -r * 0.44)
    const bkh2 = pp(-r * 0.22, -r * 0.33)
    g.fillStyle(pal.goldLight, 0.85)
    g.beginPath()
    g.moveTo(bkh0.x, bkh0.y)
    quadFrom(g, bkh0.x, bkh0.y, bkh1.x, bkh1.y, bkh2.x, bkh2.y)
    g.closePath()
    g.fillPath()
    g.lineStyle(prOut * 0.92, INK, 1)
    g.beginPath()
    g.moveTo(bk0.x, bk0.y)
    quadFrom(g, bk0.x, bk0.y, bk1.x, bk1.y, bk2.x, bk2.y)
    quadFrom(g, bk2.x, bk2.y, bk3.x, bk3.y, bk0.x, bk0.y)
    g.closePath()
    g.strokePath()

    // Layered tri-color wing (red shoulder, yellow middle coverts, blue primaries)
    // with delicate feather separation lines so all 3 bands pop clearly.
    const wPivot = pp(r * 0.13, -r * 0.23)
    const wFlap = -sp.parrotWing * 0.85
    const wp = (ux: number, uy: number): { x: number; y: number } => rp(wPivot.x, wPivot.y, ux, uy, prRot + wFlap)
    const w0 = wp(-r * 0.09, -r * 0.01)
    const w1 = wp(r * 0.18, -r * 0.05)
    const w2 = wp(r * 0.31, r * 0.22)
    const w3 = wp(r * 0.28, r * 0.46)
    const w4 = wp(r * 0.07, r * 0.41)
    const w5 = wp(-r * 0.09, r * 0.19)
    // Base wing fill (blue primary feathers at bottom).
    g.fillStyle(pal.parrotBlue, 1)
    g.beginPath()
    g.moveTo(w0.x, w0.y)
    quadFrom(g, w0.x, w0.y, w1.x, w1.y, w2.x, w2.y)
    quadFrom(g, w2.x, w2.y, w3.x, w3.y, w4.x, w4.y)
    quadFrom(g, w4.x, w4.y, w5.x, w5.y, w0.x, w0.y)
    g.closePath()
    g.fillPath()
    // Yellow mid band on wing.
    const wy2 = wp(r * 0.27, r * 0.18)
    const wy3 = wp(r * 0.18, r * 0.29)
    const wy4 = wp(-r * 0.04, r * 0.23)
    g.fillStyle(pal.parrotYellow, 1)
    g.beginPath()
    g.moveTo(w0.x, w0.y)
    quadFrom(g, w0.x, w0.y, w1.x, w1.y, wy2.x, wy2.y)
    quadFrom(g, wy2.x, wy2.y, wy3.x, wy3.y, wy4.x, wy4.y)
    quadFrom(g, wy4.x, wy4.y, w5.x, w5.y, w0.x, w0.y)
    g.closePath()
    g.fillPath()
    // Red upper shoulder cap on wing.
    const wr2 = wp(r * 0.21, r * 0.09)
    const wr3 = wp(r * 0.09, r * 0.15)
    const wr4 = wp(-r * 0.07, r * 0.11)
    g.fillStyle(pal.parrotRed, 1)
    g.beginPath()
    g.moveTo(w0.x, w0.y)
    quadFrom(g, w0.x, w0.y, w1.x, w1.y, wr2.x, wr2.y)
    quadFrom(g, wr2.x, wr2.y, wr3.x, wr3.y, wr4.x, wr4.y)
    g.closePath()
    g.fillPath()
    // Delicate feather separation lines between red/yellow and yellow/blue tiers
    // plus subtle primary feather notches.
    g.lineStyle(Math.max(0.85, prDetail * 0.78), INK, 0.88)
    g.beginPath()
    g.moveTo(wr4.x, wr4.y)
    quadFrom(g, wr4.x, wr4.y, wr3.x, wr3.y, wr2.x, wr2.y)
    g.strokePath()
    g.beginPath()
    g.moveTo(wy4.x, wy4.y)
    quadFrom(g, wy4.x, wy4.y, wy3.x, wy3.y, wy2.x, wy2.y)
    g.strokePath()
    if (!thumbnail) {
      const fn0 = wp(r * 0.11, r * 0.27)
      const fn1 = wp(r * 0.16, r * 0.40)
      const fn2 = wp(r * 0.19, r * 0.24)
      const fn3 = wp(r * 0.24, r * 0.38)
      g.beginPath()
      g.moveTo(fn0.x, fn0.y)
      g.lineTo(fn1.x, fn1.y)
      g.moveTo(fn2.x, fn2.y)
      g.lineTo(fn3.x, fn3.y)
      g.strokePath()
    }
    // Outer wing contour with reduced, clean outline.
    g.lineStyle(prOut, INK, 1)
    g.beginPath()
    g.moveTo(w0.x, w0.y)
    quadFrom(g, w0.x, w0.y, w1.x, w1.y, w2.x, w2.y)
    quadFrom(g, w2.x, w2.y, w3.x, w3.y, w4.x, w4.y)
    quadFrom(g, w4.x, w4.y, w5.x, w5.y, w0.x, w0.y)
    g.closePath()
    g.strokePath()

    // Distinct golden parrot claws gripping the hat brim (two pairs of toes with thin outlines).
    for (const [cxOff, cyOff] of [
      [-0.09, 0.13],
      [-0.02, 0.14],
      [0.06, 0.13],
    ] as const) {
      const toe = pp(r * cxOff, r * cyOff)
      g.fillStyle(pal.parrotYellow, 1)
      g.fillEllipse(toe.x, toe.y, r * 0.082, r * 0.125)
      g.lineStyle(prDetail, INK, 1)
      g.strokeEllipse(toe.x, toe.y, r * 0.082, r * 0.125)
    }
}

export interface CrabPalette {
  /** Shell (the main carapace colour). */
  shell: number
  /** Shell highlight (lighter, top of the carapace). */
  shellLight: number
  /** Claws (slightly brighter than the shell). */
  claw: number
  /** Claw highlight. */
  clawLight: number
  /** Belly (light underside). */
  belly: number
  /** The aura colour. */
  glow: number
}

/** The crab palettes, exported for the OFFLINE BAKER (index-aligned with
 *  any future bake copy). */
export const CRAB_PALETTES: readonly CrabPalette[] = [
  { shell: 0xe8604c, shellLight: 0xf07a64, claw: 0xf2836e, clawLight: 0xf9a08c, belly: 0xf6ded2, glow: 0xffb59e }, // 0: coral red
  { shell: 0xd97836, shellLight: 0xe88f52, claw: 0xefa066, clawLight: 0xf7b984, belly: 0xf6e8d2, glow: 0xffcf9e }, // 1: sunset orange
  { shell: 0xc9558a, shellLight: 0xd970a0, claw: 0xe083ae, clawLight: 0xea9ec0, belly: 0xf6d8e6, glow: 0xffa8d0 }, // 2: rose crab
  { shell: 0x5f9e6e, shellLight: 0x77b486, claw: 0x86c294, clawLight: 0x9cd2a8, belly: 0xdcecdc, glow: 0xa8e8b8 }, // 3: moss
  { shell: 0x5a7d9e, shellLight: 0x7295b8, claw: 0x82a5c4, clawLight: 0x9abdd6, belly: 0xd8e4f0, glow: 0x9ec8ee }, // 4: tide blue
]

/**
 * Draw the Tier 10 CRAB ball — the second collectible: a round crab-slime
 * with two big cheilipeds (claw arms) that wave UP and DOWN, four walking
 * legs per side, stalk eyes, gill dots, and a countershaded shell.
 *
 * ANIMATION: the claw arms oscillate up/down with the CLOCK (now ms) —
 * each arm on its own phase, faster when panicking. The legs also scuttle
 * slightly. Fear flattens the claws and speeds the scuttle.
 *
 * FEAR: panic (0..1) — claws drop and wave faster, eyes shrink wide,
 * sweat drop, tremble.
 * GAZE: easter-egg pupil movement.
 *
 * The FACE (stalk eyes) is part of the design — callers must NOT draw
 * the standard face on top.
 */
export function drawCrabBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 10,
  thumbnail = false,
): void {
  void seed
  const pal = CRAB_PALETTES[variant % CRAB_PALETTES.length]!
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(2.5, r * 0.055)
  const now = Date.now()

  // ---- THE GLOW — a clean radial stack, warm crab-orange. ----
  const glowWobble = Math.sin(now * 0.0007)
  const glowLayers: ReadonlyArray<{ rr: number; alpha: number }> = [
    { rr: 1.62 + glowWobble * 0.03, alpha: 0.12 },
    { rr: 1.4, alpha: 0.18 },
    { rr: 1.2, alpha: 0.26 },
    { rr: 1.05, alpha: 0.32 },
  ]
  for (const layer of glowLayers) {
    g.fillStyle(pal.glow, layer.alpha + glowWobble * 0.02)
    g.fillCircle(cx, cy, r * layer.rr)
  }

  // ---- THE CLAWS — the crab's identity: two BIG pincers raised UP and
  // OUTWARD at the upper sides. Each claw = a fat arm (two filled
  // segments) + a big pincer body + two open jaws. They wave up/down on
  // offset clock phases; faster and higher with panic, dropping flat
  // with fear. Drawn BEFORE the body so the arms emerge from behind it.
  const clawWave = Math.sin(now * 0.004)
  const clawWaveR = Math.sin(now * 0.004 + Math.PI * 0.8)
  for (const side of [-1, 1]) {
    const wave = side < 0 ? clawWave : clawWaveR
    const droop = panic * r * 0.25 // fear drops the claws
    const tremble = Math.sin(now * 0.05) * r * 0.02 * panic
    // The arm root (on the shell's upper side) and the claw position.
    const rootX = cx + side * r * 0.55
    const rootY = cy - r * 0.34
    const clawX = rootX + side * r * 0.52
    const clawY = rootY - r * 0.34 - wave * r * 0.1 * (1 - panic * 0.5) + droop * 0.35 + tremble
    // Claw points up-and-out; the mouth gap sits between the two tips.
    const tilt = -0.5 // radians above horizontal, pointing outward
    const dirX = Math.cos(tilt) * side
    const dirY = -Math.sin(tilt)
    // Perp = the claw's width direction.
    const perpX = -dirY
    const perpY = dirX

    // ELEMENT 1 — THE ARM: one curved limb from the shell to the claw.
    // A single stroked path (round cap) + a fill quad underneath.
    const armW = r * 0.11
    g.fillStyle(pal.claw, 1)
    g.beginPath()
    g.moveTo(rootX - perpX * armW, rootY - perpY * armW)
    quadFrom(g, rootX - perpX * armW, rootY - perpY * armW, cx + side * r * 0.98, clawY - r * 0.32, clawX - perpX * armW * 0.9, clawY - perpY * armW * 0.9)
    g.lineTo(clawX + perpX * armW * 0.9, clawY + perpY * armW * 0.9)
    quadFrom(g, clawX + perpX * armW * 0.9, clawY + perpY * armW * 0.9, cx + side * r * 0.98, rootY + r * 0.14, rootX + perpX * armW, rootY + perpY * armW)
    g.closePath()
    g.fillPath()
    g.lineStyle(ink * 0.8, INK, 1)
    g.strokePath()

    // ELEMENT 2 — THE CLAW: one fat pac-man style shape — a filled
    // circle with a wedge cut out (the open mouth), rotated to point
    // up-and-out. ONE fillCircle-ish path + ONE stroke. The gap between
    // the wedge edges IS the pincer opening; snip animates it, fear
    // clamps it shut.
    const clawR = r * 0.33
    const gap = (0.55 + 0.35 * Math.abs(Math.sin(now * 0.005 + side))) * (1 - panic * 0.55)
    // The mouth aims up-and-OUT on both sides (mirrored per side).
    const aim = -Math.PI / 2 + side * 0.67
    g.fillStyle(pal.claw, 1)
    g.beginPath()
    // Start at centre, arc from (aim + gap/2) around to (aim - gap/2),
    // close back through the centre — a pie with a wedge missing.
    g.moveTo(clawX, clawY)
    g.arc(clawX, clawY, clawR, aim + gap / 2, aim - gap / 2 + Math.PI * 2, false)
    g.closePath()
    g.fillPath()
    g.lineStyle(ink * 0.85, INK, 1)
    g.strokePath()
    // White tip accents at the two wedge corners.
    g.fillStyle(pal.belly, 0.95)
    const tipR = clawR * 0.17
    for (const a of [aim - gap / 2, aim + gap / 2]) {
      g.fillCircle(clawX + Math.cos(a) * clawR * 0.92, clawY + Math.sin(a) * clawR * 0.92, tipR)
    }
  }
  // ---- THE WALKING LEGS — three thin pointed legs per side, angled
  // downward-out from the lower shell, tips bobbing with the clock. ----
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const t = i / 2
      const baseX = cx + side * r * (0.6 + t * 0.22)
      const baseY = cy + r * (0.22 + t * 0.2)
      const phase = now * 0.005 + i * 2.1 + (side > 0 ? Math.PI : 0)
      const tipX = baseX + side * r * (0.3 - t * 0.08)
      const tipY = baseY + r * 0.3 + Math.sin(phase) * r * 0.04 * (1 + panic)
      g.lineStyle(thumbnail ? collectionInkWidth(r) : Math.max(2, r * 0.05), pal.claw, 1)
      g.beginPath()
      g.moveTo(baseX, baseY)
      g.lineTo(baseX + side * r * 0.14, baseY + r * 0.06)
      g.lineTo(tipX, tipY)
      g.strokePath()
      g.lineStyle(Math.max(1.2, r * 0.03), INK, 0.8)
      g.strokePath()
    }
  }

  // ---- THE BODY — the shell: the contour, countershaded. ----
  if (poly && poly.length >= 3) {
    g.fillStyle(pal.shell, 1)
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillStyle(pal.shell, 1)
    g.fillCircle(cx, cy, r)
  }
  // Shell light: a lighter band across the top of the carapace.
  g.fillStyle(pal.shellLight, 0.85)
  g.beginPath()
  g.fillEllipse(cx - r * 0.05, cy - r * 0.5, r * 1.3, r * 0.55)
  g.fillPath()
  // Belly: the light underside, low.
  g.fillStyle(pal.belly, 0.9)
  g.beginPath()
  g.fillEllipse(cx, cy + r * 0.48, r * 1.4, r * 0.55)
  g.fillPath()

  // ---- SHELL SPOTS — three lighter dots on the carapace. ----
  g.fillStyle(pal.shellLight, 0.6)
  for (const [sx, sy] of [[-0.4, -0.15], [0.12, -0.28], [0.42, -0.08]] as const) {
    g.fillCircle(cx + sx * r, cy + sy * r, Math.max(2, r * 0.05))
  }

  // ---- THE MOUTH — a small wavy line under the eyes. ----
  g.lineStyle(ink * 0.9, INK, 0.9)
  g.beginPath()
  const mwY = cy + r * 0.24
  g.moveTo(cx - r * 0.16, mwY)
  g.lineTo(cx - r * 0.05, mwY + r * 0.035)
  g.lineTo(cx + r * 0.06, mwY - r * 0.02)
  g.lineTo(cx + r * 0.16, mwY + r * 0.02)
  g.strokePath()

  // Fear sweat: one drop at the side of the shell.
  if (panic > 0.45) {
    const sweat = Math.min(1, (panic - 0.45) / 0.55)
    g.fillStyle(0x9fdcff, 0.95 * sweat)
    g.fillCircle(cx - r * 0.6, cy - r * 0.5, r * 0.055 * (0.7 + 0.3 * sweat))
  }

  // ---- THE INK OUTLINE — the contour itself, over everything. ----
  g.lineStyle(thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r), INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }

  // ---- THE STALK EYES — drawn LAST so they sit ON TOP of the ink
  // outline (the outline used to cover the stalks). Bigger eyeballs.
  for (const side of [-1, 1]) {
    const stalkX = cx + side * r * 0.22
    const stalkBaseY = cy - r * 0.78
    const stalkTopY = stalkBaseY - r * 0.26
    // Stalk: thick, tapering.
    g.lineStyle(thumbnail ? collectionInkWidth(r) : Math.max(3, r * 0.085), pal.shell, 1)
    g.beginPath()
    g.moveTo(stalkX, stalkBaseY)
    g.lineTo(stalkX, stalkTopY)
    g.strokePath()
    g.lineStyle(thumbnail ? collectionInkWidth(r) : Math.max(1.5, r * 0.04), INK, 1)
    g.strokePath()
    // Eyeball: white + ink rim, pupil with gaze, highlight.
    const eyeR = r * (0.19 - 0.02 * panic)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(stalkX, stalkTopY, eyeR)
    g.fillStyle(INK, 1)
    const gx = (gaze?.x ?? 0) * eyeR * 0.3
    const gy = (gaze?.y ?? 0) * eyeR * 0.3
    g.fillCircle(stalkX + gx, stalkTopY + gy, eyeR * 0.5)
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(stalkX - eyeR * 0.28, stalkTopY - eyeR * 0.3, eyeR * 0.2)
    g.lineStyle(thumbnail ? collectionInkWidth(r) : Math.max(1.2, r * 0.035), INK, 1)
    g.strokeCircle(stalkX, stalkTopY, eyeR)
  }
}


/**
 * The ONE tier-9 entry point for every consumer (renderer, previews,
 * banner, overlay, claw, progression, baker): routes to the theme the
 * run rolled — `tier9Theme()` (shark, pig or drunko; seed-derived,
 * URL-overridable) — and lets `variant` pick the palette WITHIN that theme.
 */
export function drawTier9Ball(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  theme: Tier9Theme = tier9Theme(),
  bodyAngle = 0,
  ballId?: number,
  thumbnail = false,
): void {
  if (theme === 'pig') {
    drawPigBall(g, cx, cy, r, variant, poly, panic, gaze, seed, thumbnail)
  } else if (theme === 'drunko') {
    drawDrunkoBall(g, cx, cy, r, variant, poly, panic, gaze, seed, bodyAngle, thumbnail)
  } else if (theme === 'robo') {
    drawRoboBall(g, cx, cy, r, variant, poly, panic, gaze, seed, ballId, thumbnail)
  } else if (theme === 'pirate') {
    drawPirateBall(g, cx, cy, r, variant, poly, panic, gaze, seed, bodyAngle, ballId, thumbnail)
  } else {
    drawSharkBall(g, cx, cy, r, variant, poly, panic, gaze, seed, thumbnail)
  }
}

/**
 * The ONE collectible entry point for every consumer: routes by TIER
 * (9 → shark/pig/drunko by the run theme, 10 → crab) and lets `variant`
 * pick the palette WITHIN the theme. Call this — never the theme
 * functions directly.
 */
export function drawCollectibleBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  tier: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 9,
  theme?: string,
  bodyAngle = 0,
  ballId?: number,
  thumbnail = false,
): void {
  if (tier === 11 && (theme === undefined || theme === 'earth')) {
    drawEarthBall(g, cx, cy, r, variant, poly, panic, gaze, seed, bodyAngle, ballId, thumbnail)
    if (thumbnail || ballId === undefined) drawEarthAccessory(g, cx, cy, r, variant, poly, panic, seed, bodyAngle, thumbnail)
    return
  }
  if (tier === 10) {
    drawCrabBall(g, cx, cy, r, variant, poly, panic, gaze, seed, thumbnail)
    return
  }
  drawTier9Ball(g, cx, cy, r, variant, poly, panic, gaze, seed,
    theme === 'shark' || theme === 'pig' || theme === 'drunko' || theme === 'robo' || theme === 'pirate' ? theme : tier9Theme(),
    bodyAngle, ballId, thumbnail)
}

export interface EarthPalette {
  ocean: number
  oceanLight: number
  oceanDark: number
  land: number
  landLight: number
  cloud: number
  ice: number
  moon: number
  moonDark: number
  glow: number
}

export const EARTH_PALETTES: readonly EarthPalette[] = [
  {
    ocean: 0x2b7fe0, oceanLight: 0x7ad4ff, oceanDark: 0x1456b0,
    land: 0x5cb83a, landLight: 0x8ed45e,
    cloud: 0xfffefe, ice: 0xf4fbff,
    moon: 0xf6f1e4, moonDark: 0xc8c0ae, glow: 0x4ec8ff,
  },
]

/** One slow revolution. Long enough that the moon reads as drifting, not spinning. */
const EARTH_ORBIT_MS = 28000

const EARTH_GLOW_KEY = 'br-earth-glow'
const earthGlowImages = new Map<number, Phaser.GameObjects.Image>()

/** Continents as [x, y, width, height] in fractions of r. Big, filling the ball. */
const EARTH_LANDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-0.42, -0.16, 0.7, 0.55],
  [-0.34, 0.18, 0.32, 0.3],
  [0.06, -0.42, 0.3, 0.22],
  [0.34, -0.08, 0.62, 0.5],
  [0.32, 0.22, 0.36, 0.24],
]



function earthOrbit(now: number, seed: number): { angle: number; front: boolean } {
  const phase = ((seed % 997) / 997) * Math.PI * 2
  const angle = (now / EARTH_ORBIT_MS) * Math.PI * 2 + phase
  // Front half of the orbit (sin > 0) draws after the body.
  return { angle, front: Math.sin(angle) >= 0 }
}

function paintEarthMoon(
  g: Phaser.GameObjects.Graphics,
  anchor: { x: number; y: number },
  moonR: number,
  pal: EarthPalette,
  ink: number,
  seed: number,
  now: number,
  panic: number,
  thumbnail: boolean,
): void {
  g.fillStyle(pal.moonDark, 0.28)
  g.fillCircle(anchor.x + moonR * 0.18, anchor.y + moonR * 0.22, moonR * 0.92)
  g.fillStyle(pal.moon, 1)
  g.fillCircle(anchor.x, anchor.y, moonR)
  g.fillStyle(pal.moonDark, 0.85)
  g.fillCircle(anchor.x - moonR * 0.32, anchor.y - moonR * 0.18, moonR * 0.26)
  g.fillCircle(anchor.x + moonR * 0.28, anchor.y + moonR * 0.16, moonR * 0.16)
  g.fillCircle(anchor.x + moonR * 0.05, anchor.y - moonR * 0.38, moonR * 0.1)
  g.fillStyle(0xfffdf6, 0.7)
  g.fillCircle(anchor.x - moonR * 0.22, anchor.y - moonR * 0.36, moonR * 0.16)
  g.lineStyle(ink, INK, 1)
  g.strokeCircle(anchor.x, anchor.y, moonR)
  const look = ballLookFor(2, seed ^ 0x51a7)
  drawBallFace(g, {
    ...look,
    eyeW: 0.5,
    eyeH: 0.56,
    mouthW: 0.22,
  }, anchor, moonR, 1, {
    panic, expr: expressionAt(seed ^ 0x51a7, now),
  }, thumbnail)
}

/** Tier 11 Earth: cartoon planet, shared Ball Rush face, slow orbiting moon. */
export function drawEarthBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
  panic = 0,
  gaze?: { x: number; y: number },
  seed = 11,
  _bodyAngle = 0,
  _ballId?: number,
  thumbnail = false,
): void {
  const pal = EARTH_PALETTES[variant % EARTH_PALETTES.length]!
  const now = Date.now()
  const out = thumbnail ? collectionOutlineWidth(r) : ballOutlineWidth(r)
  const ink = thumbnail ? collectionInkWidth(r) : Math.max(1.6, r * 0.04)
  const scene = g.scene

  if (scene && !thumbnail) {
    if (!scene.textures.exists(EARTH_GLOW_KEY)) {
      const size = 256
      const canvas = scene.textures.createCanvas(EARTH_GLOW_KEY, size, size)
      const ctx = canvas?.getContext()
      if (ctx && canvas) {
        const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2)
        grad.addColorStop(0, 'rgba(126,224,255,0.5)')
        grad.addColorStop(0.35, 'rgba(78,200,255,0.24)')
        grad.addColorStop(0.7, 'rgba(78,200,255,0.08)')
        grad.addColorStop(1, 'rgba(78,200,255,0)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, size, size)
        canvas.refresh()
      }
    }
    if (_ballId !== undefined && scene.textures.exists(EARTH_GLOW_KEY)) {
      let image = earthGlowImages.get(_ballId)
      if (!image || image.scene !== scene) {
        image = scene.add.image(cx, cy, EARTH_GLOW_KEY)
        earthGlowImages.set(_ballId, image)
      }
      image.setPosition(cx, cy).setDisplaySize(r * 3.3, r * 3.3).setBlendMode(1).setDepth(9).setVisible(true)
    }
  }

  const orbit = earthOrbit(now, seed)
  const moonAnchor = { x: cx + Math.cos(orbit.angle) * r * 1.42, y: cy + Math.sin(orbit.angle) * r * 0.38 - panic * r * 0.03 }
  if (!orbit.front) paintEarthMoon(g, moonAnchor, r * 0.22, pal, ink * 0.85, seed, now, panic, thumbnail)

  g.fillStyle(pal.ocean, 1)
  if (poly && poly.length >= 3) g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  else g.fillCircle(cx, cy, r)

  // Solid ellipses. The ink outline covers anything past the rim, so the
  // fills are never sliced into strips, and nothing here rescales per frame.
  g.fillStyle(pal.land, 1)
  for (const [lx, ly, w, h] of EARTH_LANDS) g.fillEllipse(cx + lx * r, cy + ly * r, w * r, h * r)
  g.fillStyle(pal.landLight, 0.7)
  g.fillEllipse(cx - r * 0.46, cy - r * 0.22, r * 0.3, r * 0.22)
  g.fillEllipse(cx + r * 0.3, cy - r * 0.12, r * 0.26, r * 0.2)

  g.fillStyle(pal.ice, 0.96)
  g.fillEllipse(cx, cy - r * 0.82, r * 0.7, r * 0.34)
  g.fillStyle(pal.ice, 0.9)
  g.fillEllipse(cx, cy + r * 0.78, r * 0.55, r * 0.24)

  if (poly && poly.length >= 3) {
    g.lineStyle(out, INK, 1)
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.lineStyle(out, INK, 1)
    g.strokeCircle(cx, cy, r)
  }

  drawBallFace(g, ballLookFor(11, seed), { x: cx, y: cy }, r, 1, {
    gaze, panic, expr: expressionAt(seed, now),
  }, thumbnail)
}

/** The moon is decorative and is drawn after every ball body when it is in front. */
export function drawEarthAccessory(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  _poly?: Array<{ x: number; y: number }>,
  panic = 0,
  seed = 11,
  _bodyAngle = 0,
  thumbnail = false,
): void {
  const now = Date.now()
  if (!earthOrbit(now, seed).front) return
  const pal = EARTH_PALETTES[variant % EARTH_PALETTES.length]!
  const orbit = earthOrbit(now, seed)
  const anchor = { x: cx + Math.cos(orbit.angle) * r * 1.42, y: cy + Math.sin(orbit.angle) * r * 0.38 - panic * r * 0.03 }
  const ink = thumbnail ? collectionInkWidth(r) * 0.7 : Math.max(1.4, r * 0.035)
  paintEarthMoon(g, anchor, r * 0.22, pal, ink, seed, now, panic, thumbnail)
}

