/**
 * Phase 2.14.0 — session-level state shared between the scenes.
 *
 * `menuActive` gates ALL gameplay input (pointer drops + keyboard
 * abilities) while the start screen is up. It flips to false exactly once —
 * when the player presses START (or immediately at boot in dev fastboot).
 * Restarts NEVER re-show the menu (Play Again goes straight to a new run).
 *
 * `fastbootRequested` is the DEV-ONLY `?fastboot=1` escape hatch for the QA
 * suites: the start screen never mounts, gameplay input is live from the
 * first frame, and the suites behave exactly as they did before the menu
 * existed. Production builds never pass the flag.
 */

export function fastbootRequested(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fastboot') === '1'
  )
}

export const session = {
  /** True while the start screen is up; gameplay input is gated. */
  menuActive: !fastbootRequested(),
}
