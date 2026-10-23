import type Phaser from 'phaser'
import { BALL_EMOTION } from '../../config/ballEmotion'

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
 * Phase 2.14.0: fantasy (T9) per-run variant palettes — mirrors
 * runVariant.fantasyVariant (kept here so the draw stays dependency-free;
 * the two arrays MUST stay index-aligned).
 */
const FANTASY_VARIANTS: Array<{ body: number; bodyShade: number; horn: number; hornShade: number; star: number; mane: number; maneDeep: number; cheek: number }> = [
  { body: 0xffc0e0, bodyShade: 0xf295c2, horn: 0xffd54f, hornShade: 0xe0a800, star: 0xffffff, mane: 0xff6b9d, maneDeep: 0xd94f7e, cheek: 0xff9ebc }, // 0: classic pink
  { body: 0xc0e8ff, bodyShade: 0x92c4e8, horn: 0xffd54f, hornShade: 0xe0a800, star: 0xffffff, mane: 0x81d4fa, maneDeep: 0x5aabdb, cheek: 0x9ecdf0 }, // 1: sky blue
  { body: 0xd0ffc8, bodyShade: 0xa3d99a, horn: 0xffb300, hornShade: 0xd18f00, star: 0xffffff, mane: 0xa5d6a7, maneDeep: 0x7cb87c, cheek: 0xb2e6ab }, // 2: mint
  { body: 0xe8d0ff, bodyShade: 0xc2a3e0, horn: 0xffca28, hornShade: 0xd8a400, star: 0xffffff, mane: 0xb39ddb, maneDeep: 0x8d7bc0, cheek: 0xd0b2ef }, // 3: lilac
  { body: 0xfff0c0, bodyShade: 0xe8cf92, horn: 0xff7043, hornShade: 0xd85a30, star: 0xffffff, mane: 0xffd54f, maneDeep: 0xdbb13c, cheek: 0xf5dd9a }, // 4: butter
  { body: 0xffd8c0, bodyShade: 0xe8b294, horn: 0x8d6e63, hornShade: 0x6f544b, star: 0xffffff, mane: 0xffab91, maneDeep: 0xdb8a70, cheek: 0xf2c0a8 }, // 5: peach
  { body: 0xc0f0ff, bodyShade: 0x93c8da, horn: 0x26c6da, hornShade: 0x1ea2b3, star: 0xffffff, mane: 0x80deea, maneDeep: 0x5fb8c8, cheek: 0xa0dcef }, // 6: glacier
  { body: 0xffc0c8, bodyShade: 0xe0959f, horn: 0xec407a, hornShade: 0xc53366, star: 0xffffff, mane: 0xf06292, maneDeep: 0xcc4d77, cheek: 0xf29aae }, // 7: candy
]

/**
 * The fantasy palettes, exported for the OFFLINE BAKER (TierBaker) — the
 * baker's copy MUST stay index-aligned with this array (its own copy is
 * validated against this one by a test).
 */
export const FANTASY_PALETTES = FANTASY_VARIANTS

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

/**
 * The at-rest contour used by NextBall and DropClaw: a circle displaced by
 * the same wobble pipeline the gameplay renderer applies to its live
 * contour — same character silhouette at rest.
 */
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

/**
 * Draw the Tier 9 fantasy ball — the reward tier, drawn to COLLECT: a
 * pastel unicorn-slime with a spiral striped horn, a flowing two-tone
 * mane, a tiny ear, star freckles, a belly light and its own face.
 *
 * DRAWING SURFACE: every part is placed relative to the ball's CONTOUR
 * (the wobbled silhouette), not a perfect circle — pass `poly` (the live
 * contour, world space) plus its centroid and the body follows the
 * wobble exactly like every other tier. Without `poly` (static previews:
 * next-ball, claw, title, discovery statics) it falls back to a circle
 * of radius r at (cx, cy).
 *
 * The FACE is part of the design here (a fantasy slime has its own
 * softer look), drawn by this function — callers must NOT draw the
 * standard face on top.
 *
 * Phase 2.14.0: `variant` (0..7, rolled per RUN via runVariant) selects
 * the body/horn/mane palette — variant 0 is the classic pink.
 */
export function drawFantasyBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  variant = 0,
  poly?: Array<{ x: number; y: number }>,
): void {
  const pal = FANTASY_VARIANTS[variant % FANTASY_VARIANTS.length]!

  // ---- Geometry from the contour ---------------------------------------
  // The contour's top point anchors the horn+ear; the mane rides the two
  // upper sides. With no poly (circle fallback) these are the plain
  // circle anchors.
  let topX = cx
  let topY = cy - r
  if (poly && poly.length >= 8) {
    let top = poly[0]!
    for (const p of poly) if (p.y < top.y) top = p
    topX = top.x
    topY = top.y
  }
  const ink = Math.max(2, r * 0.05)

  // ---- THE HORN — a spiral cone with stripe bands -----------------------
  // Two curved sides from a broad base at the head's top to a rounded
  // tip, with darker stripe bands across it and a warm tip glow. The
  // horn leans back slightly (unicorn posture) and is drawn FIRST so the
  // mane overlaps its base.
  const hornLean = r * 0.1
  const hornH = r * 0.62
  const baseHalf = r * 0.2
  const tipX = topX + hornLean
  const tipY = topY - hornH
  g.fillStyle(pal.horn, 1)
  g.beginPath()
  // Left edge (slightly concave — a tapered unicorn horn).
  g.moveTo(topX - baseHalf, topY + r * 0.05)
  g.lineTo(tipX - baseHalf * 0.28, tipY + r * 0.1)
  // Rounded tip.
  g.arc(tipX, tipY + r * 0.1, baseHalf * 0.28, Math.PI, 0, false)
  // Right edge back down.
  g.lineTo(topX + baseHalf, topY + r * 0.05)
  g.closePath()
  g.fillPath()
  // Stripe bands across the horn (the spiral suggestion): three tapered
  // wedges in the deep shade, wider at the base.
  const stripe = r * 0.075
  for (let i = 0; i < 3; i++) {
    const t = 0.24 + i * 0.24 // fraction up the horn
    const by = topY + (tipY + r * 0.1 - topY) * t
    const halfNow = baseHalf * (1 - t * 0.72)
    g.fillStyle(pal.hornShade, 0.9)
    g.fillRect(topX - hornLean * t - halfNow, by - stripe / 2 - (stripe * i) / 3, halfNow * 2, stripe)
  }
  // The horn's ink outline.
  g.lineStyle(ink * 0.8, INK, 1)
  g.beginPath()
  g.moveTo(topX - baseHalf, topY + r * 0.05)
  g.lineTo(tipX - baseHalf * 0.28, tipY + r * 0.1)
  g.arc(tipX, tipY + r * 0.1, baseHalf * 0.28, Math.PI, 0, false)
  g.lineTo(topX + baseHalf, topY + r * 0.05)
  g.closePath()
  g.strokePath()

  // ---- THE EAR — a small leaf behind the horn's base (the far side). ----
  g.fillStyle(pal.bodyShade, 1)
  g.beginPath()
  g.fillEllipse(topX - baseHalf * 1.7, topY + r * 0.08, r * 0.22, r * 0.38)
  g.lineStyle(ink * 0.6, INK, 1)
  g.strokeEllipse(topX - baseHalf * 1.7, topY + r * 0.08, r * 0.22, r * 0.38)

  // ---- THE BODY — pastel fill clipped to the contour, with shading. ----
  g.fillStyle(pal.body, 1)
  if (poly && poly.length >= 3) {
    g.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
  } else {
    g.fillCircle(cx, cy, r)
  }
  // Lower-body shade: a darker crescent hugging the bottom of the
  // contour (volume — the old flat pastel read paper-thin).
  g.fillStyle(pal.bodyShade, 0.55)
  g.beginPath()
  g.fillEllipse(cx, cy + r * 0.52, r * 1.56, r * 0.84)
  // (The crescent may spill past the contour without clipping — the ink
  // outline covers the rim below.)
  // Belly light: a warm white core low-centre (the glow of a reward).
  g.fillStyle(0xfff8f0, 0.5)
  g.fillEllipse(cx, cy + r * 0.28, r * 0.7, r * 0.4)

  // ---- THE MANE — two flowing combs: a back layer in the deep mane
  // shade and a front layer in the main mane colour, made of overlapping
  // rounded locks that follow the head's sides down past the midline.
  const locks: Array<{ x: number; y: number; w: number; h: number; rot: number }> = []
  for (let i = 0; i < 3; i++) {
    const t = i / 2 // 0 at the top … 1 lower down the side
    const drop = r * (0.12 + t * 0.42)
    const out = r * (0.72 - t * 0.18)
    locks.push({ x: cx - out, y: cy - r * 0.42 + drop, w: r * 0.3, h: r * (0.4 - t * 0.08), rot: -0.35 + t * 0.2 })
    locks.push({ x: cx + out, y: cy - r * 0.42 + drop, w: r * 0.3, h: r * (0.4 - t * 0.08), rot: 0.35 - t * 0.2 })
  }
  // Back layer (deep shade, slightly larger).
  for (const l of locks) {
    g.fillStyle(pal.maneDeep, 1)
    g.beginPath()
    g.fillEllipse(l.x, l.y + r * 0.03, l.w * 2.24, l.h * 2.24)
  }
  // Front layer (main mane colour).
  for (const l of locks) {
    g.fillStyle(pal.mane, 1)
    g.beginPath()
    g.fillEllipse(l.x, l.y, l.w * 2, l.h * 2)
  }

  // ---- Star freckles — a constellation over the cheeks and forehead. ----
  if (r > 24) {
    const stars: Array<[number, number, number]> = [
      [-0.52, -0.38, 0.085],
      [0.54, -0.3, 0.065],
      [0.18, -0.52, 0.055],
      [-0.2, 0.42, 0.06],
    ]
    for (const [sx, sy, sr] of stars) {
      const x = cx + sx * r
      const y = cy + sy * r
      const s = r * sr
      g.fillStyle(0xffd54f, 0.95)
      g.beginPath()
      g.moveTo(x, y - s)
      g.lineTo(x + s * 0.32, y - s * 0.32)
      g.lineTo(x + s, y)
      g.lineTo(x + s * 0.32, y + s * 0.32)
      g.lineTo(x, y + s)
      g.lineTo(x - s * 0.32, y + s * 0.32)
      g.lineTo(x - s, y)
      g.lineTo(x - s * 0.32, y - s * 0.32)
      g.closePath()
      g.fillPath()
      g.fillStyle(0xfff3c0, 0.9)
      g.fillCircle(x, y - s * 0.15, s * 0.22)
    }
  }

  // ---- THE FACE — the fantasy slime's own: big glossy eyes with star
  // pupils, a tiny 'w' cat mouth, rosy cheeks. Softer than the standard
  // face: this is the reward character.
  const eyeY = cy - r * 0.12
  const eyeDx = r * 0.34
  const eyeR = r * 0.24
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDx
    // Sclera.
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(ex, eyeY, eyeR * 1.5, eyeR * 1.9)
    // Iris: the mane colour — ties the face to the body.
    g.fillStyle(pal.mane, 1)
    g.fillCircle(ex + side * eyeR * 0.12, eyeY + eyeR * 0.08, eyeR * 0.78)
    // Pupil.
    g.fillStyle(INK, 1)
    g.fillCircle(ex + side * eyeR * 0.18, eyeY + eyeR * 0.14, eyeR * 0.4)
    // Gloss double-glint.
    g.fillStyle(0xffffff, 0.95)
    g.fillCircle(ex - eyeR * 0.28, eyeY - eyeR * 0.4, eyeR * 0.3)
    g.fillStyle(0xffffff, 0.7)
    g.fillCircle(ex + eyeR * 0.3, eyeY + eyeR * 0.34, eyeR * 0.14)
  }
  // The 'w' cat mouth: two small arcs side by side under the eyes.
  const mouthY = cy + r * 0.3
  const mouthW = r * 0.13
  g.lineStyle(ink * 0.8, INK, 1)
  for (const side of [-1, 1]) {
    g.beginPath()
    g.arc(cx + side * mouthW, mouthY - mouthW * 0.35, mouthW, 0.2618, 2.8798, false)
    g.strokePath()
  }
  // Rosy cheeks.
  g.fillStyle(pal.cheek, 0.7)
  g.fillEllipse(cx - eyeDx - r * 0.24, eyeY + eyeR * 1.15, r * 0.26, r * 0.15)
  g.fillEllipse(cx + eyeDx + r * 0.24, eyeY + eyeR * 1.15, r * 0.26, r * 0.15)

  // ---- THE INK OUTLINE — the contour itself, over everything. ----
  g.lineStyle(ballOutlineWidth(r), INK, 1)
  if (poly && poly.length >= 3) {
    g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
  } else {
    g.strokeCircle(cx, cy, r)
  }
}
