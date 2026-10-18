import { GAME_OVER } from '../../config/gameOver'

/**
 * Phase 2.10.1 game-over detection (pure, headless-testable) — spec §3.
 *
 * GENUINE OVERFLOW trigger: a ball that has already made physical contact
 * (`touched` — a freshly spawned ball waiting at the elevated spawn point is
 * untouched and can NEVER trigger game over) whose centroid is reported
 * OUTSIDE the container's slanted side-wall lines and below the CURRENT wall
 * tops — i.e. it has actually left the container through the open top — and
 * that stays outside for `GAME_OVER.overflowGraceMs` continuously.
 *
 * Dwell timers are per-ball: a ball that briefly pokes across the boundary
 * and falls back inside resets its own timer (no false game over), while a
 * ball genuinely spilling down the outside of a wall triggers promptly.
 * Latching: `observe` returns true exactly once per run.
 *
 * The SCENE decides "outside" (it owns the live wall height during Raise
 * Walls animations and each ball's centroid/envelope); this class owns the
 * dwell/grace/latch policy.
 */
export class GameOverWatch {
  private timers = new Map<number, number>()
  private triggered = false

  /**
   * Observe one frame. `touchedOutside`: ids of TOUCHED balls whose centroid
   * is outside the container and below the current wall tops. Returns true
   * exactly once, on the frame the overflow condition completes.
   */
  observe(touchedOutside: Iterable<number>, deltaMs: number): boolean {
    if (this.triggered) return false
    const outside = new Set(touchedOutside)
    for (const id of [...this.timers.keys()]) {
      if (!outside.has(id)) this.timers.delete(id)
    }
    for (const id of outside) {
      const t = (this.timers.get(id) ?? 0) + deltaMs
      if (t >= GAME_OVER.overflowGraceMs) {
        this.triggered = true
        return true
      }
      this.timers.set(id, t)
    }
    return false
  }

  /** Whether game over has fired (latching). */
  get isGameOver(): boolean {
    return this.triggered
  }

  /** Full reset (restart flow). */
  reset(): void {
    this.timers.clear()
    this.triggered = false
  }
}
