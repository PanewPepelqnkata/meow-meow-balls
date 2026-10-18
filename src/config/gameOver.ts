/**
 * Game-over (overflow) configuration — Phase 2.10.1 (spec §3).
 * Units are design pixels / milliseconds of the logical 720×1280 stage.
 *
 * THE RULE: being above the rim is NOT game over. The game ends when a
 * TOUCHED ball — one that has genuinely been part of gameplay — leaves the
 * container through the OPEN TOP: its centroid moves outside the slanted
 * side-wall lines, drops below the CURRENT wall tops (only there do walls
 * exist to overflow past), and STAYS outside for `overflowGraceMs`.
 *
 * This distinguishes:
 *  - the active ball waiting at the elevated spawn point (untouched → the
 *    scene never reports it; also fully above the wall tops),
 *  - a ball landing on a pile that rises above the rim (still INSIDE the
 *    extrapolated wall lines → never outside),
 *  - a pile temporarily pushed upward during a merge (inside, and any
 *    momentary wall-line crossing is above the wall tops or shorter than
 *    the grace window),
 *  - a ball genuinely spilling over a side wall and falling outside
 *    (outside the lines + below the tops + dwell → game over).
 *
 * A short grace rejects transient collision noise (a splash-out that falls
 * back inside resets its timer) without meaningfully delaying a real
 * overflow — a ball outside the wall line is already more than half out and
 * falling away from the funnel.
 */
export const GAME_OVER = {
  /** How far a touched ball's CENTROID must be beyond the inner wall line
   * (design px) to count as outside the container. >0 so mere contact
   * compression against the wall never counts; small so a genuine roll-over
   * triggers promptly. */
  outsideMargin: 6,
  /** Continuous dwell OUTSIDE the walls (below the current wall tops) before
   * game over (ms). Short enough to feel prompt, long enough that a bounce
   * off the wall top (typically <250ms outside) falls back inside first. */
  overflowGraceMs: 450,
} as const

import { containerBounds } from './container'
import type { Vec2 } from './container'

/**
 * Is a ball's centroid genuinely OUTSIDE the container — past a slanted
 * side-wall line by more than `outsideMargin` AND below the CURRENT wall
 * tops (the walls only exist up there; a ball above them that is outside
 * the extrapolated lines is arcing over the open top and may still fall
 * back in)? Pure geometry over the authoritative container config; shared
 * by the scene's game-over feed and the regression tests.
 */
export function isOutsideContainer(c: Vec2, currentWallHeight: number): boolean {
  const b = containerBounds()
  if (c.y <= b.floorY - currentWallHeight) return false // above the wall tops
  // Below the floor line the wall lines no longer exist — the walls end at
  // their footpoints. A ball that fell past floor level outside the funnel
  // is outside iff it is beyond the footpoint x-range (the extrapolated
  // lines would diverge and wrongly read "inside").
  const yLine = Math.min(c.y, b.floorY)
  const pastRight = c.x - b.innerRightAt(yLine)
  const pastLeft = b.innerLeftAt(yLine) - c.x
  return pastRight > GAME_OVER.outsideMargin || pastLeft > GAME_OVER.outsideMargin
}
