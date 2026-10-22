import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the WALL RAISE's frame cost.
 *
 * The raise is one of the two moments the player noticed as laggy. Three
 * costs were measured in it:
 *
 *  1. The 1x/2x canvas SWITCH resized the canvas — a resize reallocates
 *     the backing store and forces a full re-upload (measured 19.4 ms).
 *  2. The hazard STRIPES were composited 107 times per repaint (once per
 *     stripe, `source-atop` over the whole canvas) — measured 18 ms.
 *  3. The CRISP (2x) repaint cost ~16 ms of paint + a ~10 ms upload of a
 *     1440x2560 buffer, and it landed on the frame the animation reached
 *     its rest height.
 *
 * The guard asserts the ANIMATION frames are cheap: while the walls move,
 * every frame must stay under the 60Hz budget (16.6 ms) — the raise is a
 * moving picture, so a slow frame there is a visible stutter.
 */
const failures = []
const { browser, page, errors } = await bootGame()

await page.evaluate(() => {
  const g = window.__brGame
  const P = (window.__w = { frames: [], cur: null, animating: false })
  const now = () => performance.now()
  const origCb = g.loop.callback
  g.loop.callback = (time, delta) => {
    const f = { total: 0, animating: false }
    P.cur = f
    const t = now()
    origCb(time, delta)
    f.total = now() - t
    P.cur = null
    // Is the wall animation running RIGHT NOW?
    const pg = g.scene.getScene('playground')
    f.animating = pg?.walls?.animationDurationMs != null && pg.walls.height != null && pg.walls.phase !== 'normal'
    P.frames.push(f)
  }
})

// A pile.
const SPOTS = [270, 330, 390, 300, 360, 420, 285, 345, 405, 315, 375, 435]
for (let i = 0; i < 12; i++) {
  await page.evaluate((x) => window.__brScene.dropAt(x), SPOTS[i % SPOTS.length])
  await page.waitForTimeout(250)
}
await page.waitForTimeout(5000)

await page.evaluate(() => {
  window.__w.frames = []
})
await page.evaluate(() => {
  window.__brGame.scene.getScene('playground').walls.activate()
})
await page.waitForTimeout(3000)

const fr = await page.evaluate(() => window.__w.frames.slice())
const anim = fr.filter((f) => f.animating)
const maxAnim = anim.length ? Math.max(...anim.map((f) => f.total)) : 0
const over16 = anim.filter((f) => f.total > 16.6)
const over33 = fr.filter((f) => f.total > 33)
console.log(`frames=${fr.length} animating=${anim.length} maxAnimFrame=${maxAnim.toFixed(1)}ms`)
console.log(`animation frames over 16.6ms: ${over16.length}   all frames over 33ms: ${over33.length}`)

if (anim.length === 0) {
  failures.push('the wall animation was never observed (the measurement is meaningless)')
}
if (maxAnim > 16.6) {
  failures.push(`an animation frame took ${maxAnim.toFixed(1)}ms (over the 16.6ms budget)`)
}
if (over33.length) {
  failures.push(`${over33.length} frames took over 33ms during the raise`)
}
if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'wall raise: the animation frames stay inside the frame budget',
  failures,
  `maxAnimFrame=${maxAnim.toFixed(1)}ms animFrames=${anim.length}`,
)
