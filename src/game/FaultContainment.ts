import Phaser from 'phaser'

/**
 * FAULT CONTAINMENT — keeps ONE bad frame from killing the whole game.
 *
 * The failure this exists for: a tier 8/9 ball's bake removed the
 * texture its own body sprite was bound to. Phaser nulls the frame's
 * source, and the next WebGL render of that sprite threw
 * `TypeError: Cannot read properties of null (reading 'resolution')`
 * inside `TexturerImage.run` — in the RENDER pass, which has no
 * try/catch anywhere in Phaser 4.
 *
 * That throw is fatal because of how Phaser's loop is scheduled
 * (node_modules/phaser/src/dom/RequestAnimationFrame.js):
 *
 *     this.step = function step (time)
 *     {
 *         _this.callback(time);                              // <- throws here
 *         if (_this.isRunning)
 *         {
 *             _this.timeOutID = window.requestAnimationFrame(step);  // <- never reached
 *         }
 *     };
 *
 * The next frame is scheduled AFTER the callback returns, so a throw
 * means no further frame is ever scheduled: the loop is dead
 * permanently. The canvas freezes on its last frame — and since the
 * ENTIRE HUD (score, tier path, ability buttons) is drawn INSIDE the
 * Phaser canvas, not in React, the user sees "the whole UI and
 * everything disappear". A page reload was the only recovery.
 *
 * The fix: wrap the whole game step (update + render) in a try/catch by
 * replacing `game.loop.callback` — a public, assignable property. A
 * throw is then contained: the loop keeps running, the game stays
 * playable, and the error is recorded for diagnosis.
 *
 * The underlying CAUSE is fixed separately (a texture must never be
 * removed while a live sprite is bound to it — see TierBaker,
 * FacePool, BackgroundTheme). This layer is the blast radius: the next
 * unknown throw of any kind must not take the game down again.
 */

/** The error that was contained, if any. Read by the diag overlay. */
let lastContainedError: string | null = null

export function getLastContainedError(): string | null {
  return lastContainedError
}

/** How many frames have been contained (a per-session counter). */
let containedCount = 0

export function getContainedErrorCount(): number {
  return containedCount
}

/**
 * Wrap the game's step callback so a throw in the update OR the render
 * pass cannot stop the requestAnimationFrame chain.
 *
 * TIMING: `game.loop.callback` is only assigned when the game starts
 * (Game.start -> TimeStep.start -> `this.callback = callback`), and
 * `new Phaser.Game()` returns BEFORE the boot completes. Installing the
 * wrapper immediately would wrap Phaser's NOOP callback and leave the
 * game unprotected. So the wrapper is installed from the READY event,
 * which fires after the loop has started, and it is re-checked on every
 * step in case Phaser replaced the callback.
 */
export function installFaultContainment(game: Phaser.Game): void {
  const loop = game.loop as unknown as {
    callback?: (time: number, delta: number) => void
  }
  let wrapped: ((time: number, delta: number) => void) | null = null

  const tryInstall = (): void => {
    const inner = loop.callback
    // Nothing to wrap yet (the loop has not started) or already wrapped.
    if (typeof inner !== 'function') return
    if (wrapped && inner !== wrapped) {
      // Phaser replaced the callback — wrap the new one.
      wrapped = null
    }
    if (wrapped) return
    const original = inner
    const guarded = (time: number, delta: number): void => {
      try {
        original(time, delta)
      } catch (err) {
        onContainedFrame(err)
      }
    }
    wrapped = guarded
    loop.callback = guarded
    // Marker for the QA probes: the containment IS installed.
    ;(window as unknown as Record<string, unknown>).__brContainmentInstalled = true
  }

  // The loop starts before READY, so the callback is set by then.
  game.events.once(Phaser.Core.Events.READY, () => {
    tryInstall()
    // Belt and braces: if Phaser assigns the callback later, the first
    // step re-checks and wraps it.
    game.events.on(Phaser.Core.Events.POST_STEP, tryInstall)
  })
}

/** Handle one contained frame error. */
function onContainedFrame(err: unknown): void {
  containedCount++
  const message = err instanceof Error ? err.message : String(err)
  lastContainedError = message
  // Record it where the diag overlay and the QA probes can see it.
  // UNGATED: in production this is the only trace of a fatal frame.
  ;(window as unknown as Record<string, unknown>).__brUpdateError = message
  ;(window as unknown as Record<string, unknown>).__brContainedErrors = containedCount
  // THROTTLED reporting: a broken object throws EVERY frame, so the first
  // error and the running count are recorded, but the message is not
  // re-logged on every frame.
  if (containedCount === 1) {
    console.error('[Ball Rush] contained a frame error (the game keeps running):', err)
  }
}
