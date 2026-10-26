import type Phaser from 'phaser'
import { BALL_EMOTION } from '../../config/ballEmotion'
import { tier9Theme } from '../state/runVariant'

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
  const out = pts.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.hypot(dx, dy) || 1e-6
    const th = Math.atan2(dy, dx)
    const w =
      Math.sin(look.lobes1 * th + look.phase1) * look.amp1 * r +
      Math.sin(look.lobes2 * th + look.phase2) * look.amp2 * r
    // Rest = a ball: deep INWARD reshaping is the impact deform system's job
    // (deform.ts). Inward capped at ~3% of radius, outward at capOutward
    // (gameplay: 1.5px so the decorative contour stays inside the verified
    // collision envelope).
    const dr = w < 0 ? Math.max(w, -r * 0.03) : Math.min(w, capOutward)
    const nd = d + dr
    return { x: cx + (dx / d) * nd, y: cy + (dy / d) * nd }
  })
  // One smoothing pass — kills kinks while keeping the wobble legible.
  return out.map((p, i) => {
    const a = out[(i - 1 + out.length) % out.length]!
    const b = out[(i + 1) % out.length]!
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }
  })
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
): void {
  const pal = SHARK_PALETTES[variant % SHARK_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = Math.max(2, r * 0.05)
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
  g.lineStyle(ballOutlineWidth(r), INK, 1)
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
): void {
  const pal = PIG_PALETTES[variant % PIG_PALETTES.length]!
  const look = ballLookFor(9, seed)
  const ink = Math.max(2, r * 0.05)
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
  const earOut = ballOutlineWidth(r)
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
  g.lineStyle(Math.max(2.5, r * 0.07), INK, 1)
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
  g.lineStyle(ballOutlineWidth(r), INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
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
): void {
  void seed
  const pal = CRAB_PALETTES[variant % CRAB_PALETTES.length]!
  const ink = Math.max(2.5, r * 0.055)
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
    // ELEMENT 1 — THE HAND (arm): ONE fat filled tapered shape from the
    // shell's upper side out to the claw base. Ink-outlined.
    const rootX = cx + side * r * 0.6
    const rootY = cy - r * 0.28
    const clawBaseX = rootX + side * r * 0.48 - wave * r * 0.06 * side
    const clawBaseY = rootY - r * 0.35 - wave * r * 0.1 * (1 - panic * 0.5) + droop * 0.3 + tremble
    const armBaseW = r * 0.14
    const armClawW = r * 0.1
    g.fillStyle(pal.claw, 1)
    g.beginPath()
    g.moveTo(rootX - side * armBaseW * 0.5, rootY - armBaseW)
    quadFrom(g, rootX - side * armBaseW * 0.5, rootY - armBaseW, rootX + side * r * 0.08, rootY - r * 0.52, clawBaseX - side * armClawW * 0.5, clawBaseY - armClawW)
    g.lineTo(clawBaseX + side * armClawW * 0.5, clawBaseY + armClawW)
    g.lineTo(rootX + side * armBaseW * 0.7, rootY + armBaseW * 0.5)
    g.closePath()
    g.fillPath()
    g.lineStyle(ink * 0.85, INK, 1)
    g.strokePath()

    // ELEMENT 2 — THE CLAW: ONE fat crescent shape (the pincer), drawn as
    // a single closed path — the outer edge curves from the claw base
    // out to the tip, and the inner edge curves back with a notch (the
    // pincer opening). Ink-outlined, with a white tip accent.
    const clawLen = r * 0.42
    const clawW = r * 0.14
    const tipX = clawBaseX + side * clawLen * 0.72
    const tipY = clawBaseY - clawLen * 0.52 - wave * r * 0.04
    g.fillStyle(pal.claw, 1)
    g.beginPath()
    // Outer edge: from the claw base's bottom, curving out to the tip.
    g.moveTo(clawBaseX - side * clawW * 0.5, clawBaseY + clawW * 0.4)
    quadFrom(g, clawBaseX - side * clawW * 0.5, clawBaseY + clawW * 0.4, clawBaseX + side * clawLen * 0.4, clawBaseY + clawLen * 0.18, tipX, tipY)
    // Inner edge: back from the tip with a notch (the pincer opening).
    quadFrom(g, tipX, tipY, clawBaseX + side * clawLen * 0.28, clawBaseY - clawLen * 0.12, clawBaseX + side * clawW * 0.3, clawBaseY - clawW * 0.3)
    g.closePath()
    g.fillPath()
    g.lineStyle(ink * 0.85, INK, 1)
    g.strokePath()
    // White tip accent.
    g.fillStyle(pal.belly, 0.95)
    g.fillCircle(tipX - side * r * 0.02, tipY - r * 0.01, r * 0.05)
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
      g.lineStyle(Math.max(2, r * 0.05), pal.claw, 1)
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

  // ---- THE MOUTH — a small frown (the crab's permanently grumpy
  // mouthparts), centred under the eyes. ----
  const mwY = cy + r * 0.24
  g.lineStyle(ink * 0.9, INK, 0.9)
  g.beginPath()
  g.moveTo(cx - r * 0.14, mwY + r * 0.03)
  quadFrom(g, cx - r * 0.14, mwY + r * 0.03, cx, mwY - r * 0.04, cx + r * 0.14, mwY + r * 0.03)
  g.strokePath()

  // Fear sweat: one drop at the side of the shell.
  if (panic > 0.45) {
    const sweat = Math.min(1, (panic - 0.45) / 0.55)
    g.fillStyle(0x9fdcff, 0.95 * sweat)
    g.fillCircle(cx - r * 0.6, cy - r * 0.5, r * 0.055 * (0.7 + 0.3 * sweat))
  }

  // ---- THE INK OUTLINE — the contour itself, over everything. ----
  g.lineStyle(ballOutlineWidth(r), INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }
  // ---- THE STALK EYES — two eyes on stalks rising from the shell top,
  // between the claws. Drawn AFTER the ink outline so they sit ON TOP of
  // it. Big white eyeballs with ink rims and gaze pupils. Fear widens.
  for (const side of [-1, 1]) {
    const stalkX = cx + side * r * 0.22
    const stalkBaseY = cy - r * 0.78
    const stalkTopY = stalkBaseY - r * 0.26
    // Stalk: thick, tapering.
    g.lineStyle(Math.max(3, r * 0.085), pal.shell, 1)
    g.beginPath()
    g.moveTo(stalkX, stalkBaseY)
    g.lineTo(stalkX, stalkTopY)
    g.strokePath()
    g.lineStyle(Math.max(1.5, r * 0.04), INK, 1)
    g.strokePath()
    // Eyeball: white + ink rim, pupil with gaze, highlight.
    const eyeR = r * (0.16 - 0.02 * panic)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(stalkX, stalkTopY, eyeR)
    g.fillStyle(INK, 1)
    const gx = (gaze?.x ?? 0) * eyeR * 0.3
    const gy = (gaze?.y ?? 0) * eyeR * 0.3
    g.fillCircle(stalkX + gx, stalkTopY + gy, eyeR * 0.5)
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(stalkX - eyeR * 0.28, stalkTopY - eyeR * 0.3, eyeR * 0.2)
    g.lineStyle(Math.max(1.2, r * 0.035), INK, 1)
    g.strokeCircle(stalkX, stalkTopY, eyeR)
  }


}
/**
 * The ONE tier-9 entry point for every consumer (renderer, previews,
 * banner, overlay, claw, progression, baker): routes to the theme the
 * run rolled — `tier9Theme()` (shark or pig, seed-derived, URL-overridable)
 * — and lets `variant` pick the palette WITHIN that theme.
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
): void {
  if (tier9Theme() === 'pig') {
    drawPigBall(g, cx, cy, r, variant, poly, panic, gaze, seed)
  } else {
    drawSharkBall(g, cx, cy, r, variant, poly, panic, gaze, seed)
  }
}

/**
 * The ONE collectible entry point for every consumer: routes by TIER
 * (9 → shark/pig by the run theme, 10 → crab) and lets `variant` pick
 * the palette WITHIN the theme. Call this — never the theme functions
 * directly.
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
): void {
  if (tier === 10) {
    drawCrabBall(g, cx, cy, r, variant, poly, panic, gaze, seed)
    return
  }
  drawTier9Ball(g, cx, cy, r, variant, poly, panic, gaze, seed)
}

