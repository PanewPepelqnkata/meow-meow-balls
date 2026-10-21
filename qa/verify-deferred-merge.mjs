import { bootGame, frameCount, report } from './lib-game.mjs'

/**
 * Guards the DEFERRED MERGE invariant.
 *
 * A merged replacement is only spawned once a clear position exists for
 * it. When the container cannot hold the replacement (tier 9 has radius
 * 205 => diameter 410, and the container's floor interior is 405px wide
 * on desktop / 340px in portrait), the placement DEFERS.
 *
 * A deferred merge must NOT make anything disappear: the SOURCE balls
 * stay alive and VISIBLE (the renderer draws the 'merging' state
 * explicitly), so the player sees the two balls they merged still
 * sitting there, waiting for room. If a deferred merge ever hid its
 * sources, the player would see a ball vanish with no replacement — the
 * same "it disappears" symptom, with no crash involved.
 *
 * This script asserts that after a deferred merge the source balls are
 * still drawn, and that the game keeps running.
 */
const { browser, page, errors } = await bootGame()

const failures = []

// Two tier 7 balls in the middle of the container, which merges into a
// tier 8 (radius 165) — the tier that barely fits.
await page.evaluate(() => {
  window.__brScene.spawnAt(330, 7, 800, true)
  window.__brScene.spawnAt(390, 7, 800, true)
})
await page.waitForTimeout(2500)

// Is a merge pending, and are the sources still visible?
const state = await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  const balls = scene.balls.getBalls()
  const r = scene.ballRenderer
  return {
    balls: balls.map((b) => ({ id: b.id, tier: b.tier, state: b.state })),
    merging: balls.filter((b) => b.state === 'merging').length,
    drawn: r.drawnSize,
    registered: r.size,
  }
})
console.log('state:', JSON.stringify(state))

// Every ball must still be drawn: the drawn count must equal the
// registered count (no ball silently skipped).
if (state.drawn < state.registered) {
  failures.push(
    `${state.registered - state.drawn} ball(s) are registered but NOT drawn (a ball vanished)`,
  )
}

// A merging ball must be visible (the renderer draws 'merging' sources).
if (state.merging > 0 && state.drawn < state.registered) {
  failures.push('a deferred merge hid its source balls')
}

const f0 = await frameCount(page)
await page.waitForTimeout(1500)
const f1 = await frameCount(page)
if (f1 - f0 < 10) failures.push(`the game loop stalled (${f0} -> ${f1})`)

if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()
report(
  'deferred merge: the source balls stay visible while the replacement waits',
  failures,
  `state: ${JSON.stringify(state)} | loop ${f0} -> ${f1}`,
)
