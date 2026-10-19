import { BALL_EMOTION, EMOTION_LEVELS, emotionLevelFor, type EmotionLevel } from '../../config/ballEmotion'
import type { SoftBallEntity } from './SoftBallManager'

/**
 * BALL EMOTION STATE (visual only — never touches physics).
 *
 * Per-ball panic computation with hysteresis and temporal smoothing:
 * - The danger line = wallTopY + BALL_EMOTION.zoneHeight (rides Raise Walls
 *   automatically because wallTopY tracks the live container height).
 * - `measure` = how far the ball has climbed INTO the danger zone, 0..1:
 *   0 at the line, 1 at the rim. Radius-aware: the ball's effective top is
 *   (centerY - radius - clearMargin), so big and small balls panic at the
 *   same VISUAL clearance.
 * - Level thresholds have hysteresis: downgrading a level requires the
 *   measure to drop below (entry − hysteresisBand) where the band is
 *   converted from stage px to measure units via the zone height.
 * - `panic` (0..1) eases toward the raw measure with exponential smoothing
 *   so faces morph gradually; the renderer only consumes this value.
 *
 * No method here reads or writes Matter state. `SoftBallEntity` is used
 * READ-ONLY for centroid/radius/seed.
 */

export interface BallEmotionState {
  /** Eased panic value 0..1 (drives every visual scale/jitter/sweat). */
  panic: number
  /** Discrete level (hysteresis-applied). */
  level: EmotionLevel
  /** Raw measure 0..1 (0 at the rim, 1 = aboveRimPx above the rim). */
  measure: number
  /** Simulated spawn time (ms, system clock) — gates the grace period. */
  spawnedAt: number
}

/** Per-level downgrade guard: the level only drops when the measure has
 * fallen a full hysteresis band below the level's entry threshold. The
 * hysteresis band converts the config's stage-px hysteresis into measure
 * units via the zone height — the non-obvious formula this helper names. */
function entryAt(level: EmotionLevel): number {
  return level === 'worried'
    ? BALL_EMOTION.worriedAt
    : level === 'scared'
      ? BALL_EMOTION.scaredAt
      : level === 'panic'
        ? BALL_EMOTION.panicAt
        : 0
}

export class BallEmotionSystem {
  /** Per-ball state, keyed by logical ball id. */
  private states = new Map<number, BallEmotionState>()

  /** The live container wall-top Y (stage). The scene updates this every
   * frame — Raise Walls moves the danger zone through this field. */
  wallTopY: number | null = null

  /** QA/test hook: freeze time (ms) — defaults to real time. */
  private clock: (() => number) | null = null
  setClock(fn: () => number): void {
    this.clock = fn
  }
  private now(): number {
    return this.clock ? this.clock() : Date.now()
  }
  private lastTick = 0

  constructor() {
    this.lastTick = this.now()
  }

  clear(): void {
    this.states.clear()
  }

  forget(ballId: number): void {
    this.states.delete(ballId)
  }

  /** Panic value for a ball (0..1) — what the renderer consumes. */
  panicOf(ballId: number): number {
    return this.states.get(ballId)?.panic ?? 0
  }

  /** Discrete level for a ball. */
  levelOf(ballId: number): EmotionLevel {
    return this.states.get(ballId)?.level ?? 'normal'
  }

  /** Full state (tests). */
  stateOf(ballId: number): BallEmotionState | undefined {
    return this.states.get(ballId)
  }

  /**
   * Raw danger measure for one ball: 0 = ball's visual top at/below the
   * rim (safe, inside the container), 1 = `aboveRimPx` above the rim.
   * Radius-aware (see module doc). Balls with no live rim measure 0.
   */
  measureFor(ball: SoftBallEntity, wallTopY: number): number {
    const span = BALL_EMOTION.aboveRimPx
    if (span <= 0) return 0
    const r = ball.soft.radius
    // Visual top of the ball (center minus radius minus the extra margin).
    const top = ball.soft.center.position.y - r - BALL_EMOTION.clearMargin
    // Positive = above the rim (escape risk).
    const above = wallTopY - top
    return Math.max(0, Math.min(1, above / span))
  }

  /**
   * Advance every tracked ball one frame. `balls` is the live registry.
   * Per-ball independence is total: each ball's measure, level and eased
   * panic are computed from ITS OWN geometry alone. A ball inside its
   * spawn grace period (`activationDelayMs`) measures 0 — newly dropped
   * balls fall through the rim on the way in and must never panic.
   */
  update(balls: Iterable<SoftBallEntity>): void {
    const wallTopY = this.wallTopY
    const now = this.now()
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000))
    this.lastTick = now
    const live = new Set<number>()
    for (const ball of balls) {
      live.add(ball.id)
      let st = this.states.get(ball.id)
      if (!st) {
        st = { panic: 0, level: 'normal', measure: 0, spawnedAt: now }
        this.states.set(ball.id, st)
      }
      // Grace period: a fresh drop cannot panic until the delay elapses.
      const activated = now - st.spawnedAt >= BALL_EMOTION.activationDelayMs
      const raw = !activated || wallTopY == null ? 0 : this.measureFor(ball, wallTopY)

      // --- hysteresis on the discrete level ---
      // Band: the config's stage-px hysteresis converted to measure units
      // via the above-rim span.
      const band = BALL_EMOTION.hysteresis / Math.max(1, BALL_EMOTION.aboveRimPx)
      let level = st.level
      // Upgrade: instant when the raw measure crosses the entry threshold.
      // Level severity is the ladder INDEX (names are not alphabetical —
      // 'scared' < 'worried' as strings — so comparisons use the ladder).
      const rank = (l: EmotionLevel): number => EMOTION_LEVELS.indexOf(l)
      const up = emotionLevelFor(raw)
      if (rank(up) > rank(level)) level = up
      // Downgrade: only when the measure has fallen a full band below the
      // level's entry threshold.
      while (level !== 'normal' && raw < entryAt(level) - band) {
        level =
          level === 'panic' ? 'scared' : level === 'scared' ? 'worried' : 'normal'
      }
      st.level = level

      // --- eased panic value toward the level-appropriate target ---
      // The target anchors at the level's entry measure but tracks the raw
      // measure continuously so the face morphs smoothly inside a level.
      const target = raw
      const k = 1 - Math.exp(-BALL_EMOTION.transitionSpeed * Math.max(dt, 0.0001))
      st.panic += (target - st.panic) * k
      st.measure = raw
    }
    // Drop state for balls that no longer exist (merge sources, restarts).
    for (const id of [...this.states.keys()]) {
      if (!live.has(id)) this.states.delete(id)
    }
  }
}
