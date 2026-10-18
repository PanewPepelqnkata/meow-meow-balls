/**
 * GAME OVER SEQUENCE — panic → shatter chain → panel.
 *
 * All timings, counts, scales and strengths for the end-of-run spectacle.
 * Tuning here never touches scene/system code.
 *
 * HARD PERFORMANCE RULE: the shatter effects draw from ONE pooled shard
 * system (a fixed-size array reused across every pop, rendered as simple
 * rounded polygons on a single Graphics object). No Matter bodies, no
 * textures, no allocation during the chain — a completely full container
 * pops identically to a short one.
 */

export const GAME_OVER_SEQUENCE = {
  /** Panic phase: how long all balls look scared before the first pop. */
  panicMs: 420,

  /** Pop chain: total window over which the pops are staggered (ms).
   * Each ball pops at a deterministic pseudo-random point inside it. */
  staggerMs: 620,

  /** Delay between one ball's pop and the panel's entrance (ms). */
  panelDelayMs: 520,

  /** Crack-inflate animation per ball (ms): swell → burst → shatter. */
  popSquashMs: 110,

  /** Pooled shard budget (fixed; reused across all pops). */
  particlePoolSize: 140,

  /** Shards per ball (scaled slightly by ball size; clamped to the pool). */
  piecesPerBall: 12,

  /** Shard size range (stage px, half-extent) at scale 1. */
  pieceSizeMin: 4,
  pieceSizeMax: 9,

  /** Shard launch speed range (stage px/s). */
  pieceSpeedMin: 150,
  pieceSpeedMax: 460,

  /** Shard gravity (stage px/s²) — cartoon-ish fall. */
  pieceGravity: 820,

  /** Upward bias at launch (stage px/s) so the burst blooms. */
  pieceUpBias: 90,

  /** Shard spin range (rad/s, ±). */
  pieceSpin: 14,

  /** Fraction of shards that are white highlight chips. */
  shineFraction: 0.16,

  /** Shard life (ms) — fade eases over the last 60% of it. */
  pieceLifeMs: 640,

  /**
   * Shatter size scaling: bigger balls produce more/larger pieces.
   * scale = burstScaleMin + min(1, radius/90) · burstScaleRange.
   */
  burstScaleMin: 0.8,
  burstScaleRange: 0.9,

  /**
   * Screen shake: only balls with radius ≥ popShakeMinRadius shake, at
   * strength (shakeStrength · (0.5 + bigness · 0.5)) / 2600 for
   * shakeDurationMs.
   */
  shakeStrength: 7,
  shakeDurationMs: 340,
  popShakeMinRadius: 52,

  /** Panel entrance: spring scale + duration. */
  panelScaleFrom: 0.55,
  panelSpringMs: 460,

  /** Score count-up duration (ms) and start delay after panel lands. */
  scoreCountMs: 620,
  scoreCountDelayMs: 160,

  /** NEW BEST banner celebration (ms). */
  newBestMs: 900,

  /** Confetti burst for a new best (simple pooled-ish dots, panel top). */
  newBestConfetti: 26,

  /** Panel button metrics (compact game-UI controls, panel-local). */
  buttons: {
    /** Button height (panel-local px at scale 1). */
    height: 58,
    /** Button width (panel-local px at scale 1). */
    width: 220,
    /** Vertical gap between the two buttons. */
    gap: 22,
    /** Icon size (px at scale 1) — small, sits beside the label. */
    iconSize: 30,
    /** Corner radius. */
    radius: 16,
  },
} as const
