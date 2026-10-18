/**
 * BALL EMOTION — the danger/panic system (visual only).
 *
 * A ball panics only when it is pushed ABOVE the container's rim — the
 * point where it can genuinely fall out. The higher above the rim, the
 * stronger the emotion: normal → worried → scared → panic (critical).
 * Balls inside the container (below the rim) always stay normal — being
 * tall in the pile is safe; only escape risk is scary.
 *
 * New drops get a grace period (`activationDelayMs`) after spawn during
 * which the emotion system ignores them entirely (falling through the rim
 * on the way IN is normal and must never look like panic).
 *
 * Every knob lives here so tuning never touches scene/system code.
 *
 * HARD RULE: this system is PRESENTATION ONLY — it never reads or writes
 * physics state (velocity, forces, collisions). The renderer consumes the
 * computed emotion; the physics engine never sees it.
 *
 * GEOMETRY: the reference line is the LIVE wall-top Y (stage px) from the
 * current container height — Raise Walls moves it automatically. Each
 * ball's measure accounts for its own radius: the ball starts climbing the
 * ladder when its VISUAL TOP (centerY − radius − clearMargin) rises above
 * the rim, so big and small balls read as "above the container" at the
 * same visual moment.
 */

export const BALL_EMOTION = {
  /**
   * Grace period after spawn (ms): a freshly dropped ball cannot panic.
   * Falling through the rim on the way in is normal — only balls that are
   * STILL above the rim after this delay are in real danger.
   */
  activationDelayMs: 1500,

  /**
   * How far above the rim the panic ladder reaches, in stage px. At
   * `aboveRimPx` above the wall tops the measure is 1 (full panic);
   * thresholds below are fractions of this span.
   */
  aboveRimPx: 160,

  /**
   * Extra clearance added to the ball's radius when measuring (stage px):
   * the ball's effective top is centerY − radius − clearMargin, so its
   * VISUAL top crossing the rim is what starts the ladder.
   */
  clearMargin: 6,

  /**
   * Hysteresis (stage px): a ball must FALL this far back below a level's
   * entry line before the level downgrades — prevents flickering between
   * levels when a ball oscillates on the boundary.
   */
  hysteresis: 26,

  /**
   * Panic measure → level thresholds. `measure` runs 0 (ball's visual top
   * at the rim) → 1 (`aboveRimPx` above the rim): worried ≥ worriedAt,
   * scared ≥ scaredAt, panic ≥ panicAt. Values are fractions of the span,
   * so they compose with aboveRimPx.
   */
  worriedAt: 0.18,
  scaredAt: 0.48,
  panicAt: 0.8,

  /**
   * Easing speed of the VISUAL panic value (0..1) toward the computed
   * target, per second (exponential smoothing): higher = snappier.
   */
  transitionSpeed: 9,

  /**
   * Face scaling at FULL panic (multipliers on the neutral face; values
   * lerp 1 → max with the eased panic value).
   */
  eyeScaleMax: 1.62,
  eyeWideMax: 1.5, // additional horizontal stretch (wide-eyed)
  pupilScaleMax: 0.62, // pupils shrink when scared (dilated in fear feel)
  pupilUpwardGaze: 0.92, // pupils pinned toward the top of the eyes (0..0.95)
  mouthScaleMax: 2.6, // frightened mouth size multiplier
  mouthOpenMax: 3.2, // frightened mouth depth (open O shape) multiplier

  /**
   * Trembling (visual-only position jitter of the FACE, never the body):
   * intensity in px at full panic, frequency in Hz. Grows with panic².
   */
  shakeIntensity: 2.6,
  shakeFrequency: 26,

  /**
   * Extra shake burst multiplier at CRITICAL (panic level) — the ball
   * visibly freaks out.
   */
  criticalShakeBoost: 2.1,

  /**
   * Sweat drops: count of drops rendered around the head at full panic
   * (sweat starts appearing above sweatAt panic and lerps in).
   */
  sweatDrops: 4,
  sweatAt: 0.55, // panic value where sweat starts fading in

  /**
   * CRITICAL (panic level) extras: intensity of the whole critical layer —
   * wider eye white, faster micro-shake, mouth fully agape.
   */
  criticalPanicIntensity: 1.35,
} as const

/** Emotion level ladder (ordered by severity). */
export type EmotionLevel = 'normal' | 'worried' | 'scared' | 'panic'

/** The four levels in ascending order. */
export const EMOTION_LEVELS: readonly EmotionLevel[] = ['normal', 'worried', 'scared', 'panic'] as const

/** Emotion level for a panic measure (0..1) — thresholds from config. */
export function emotionLevelFor(measure: number): EmotionLevel {
  if (measure >= BALL_EMOTION.panicAt) return 'panic'
  if (measure >= BALL_EMOTION.scaredAt) return 'scared'
  if (measure >= BALL_EMOTION.worriedAt) return 'worried'
  return 'normal'
}
