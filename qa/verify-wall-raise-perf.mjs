import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the WALL RAISE's frame cost.
 *
 * The raise is one of the two moments the player noticed as laggy. Three
 * costs were measured in it and fixed:
 *
 *  1. The 1x/2x canvas SWITCH resized the canvas — a resize reallocates
 *     the backing store and forces a full re-upload (measured 19.4 ms).
 *  2. The hazard STRIPES were composited 107 times per repaint (once per
 *     stripe, `source-atop` over the whole canvas) — measured 18 ms.
 *  3. The CRISP (2x) repaint cost ~16 ms of paint + a ~10 ms upload of a
 *     1440x2560 buffer, and it landed on the frame the animation reached
 *     its rest height. Both rest heights are now PRE-BAKED at boot and
 *     swapped in (a texture swap costs nothing).
 *
 * The guard is SELF-CALIBRATING: it measures the session's own IDLE
 * baseline first, then asserts the raise's frames stay close to it. A
 * fixed millisecond threshold would flag the harness's own noise (this
 * browser renders through SwiftShader — software GL — so its canvas
 * stroking is far slower than a phone's) instead of a game regression.
 *
 * The raise must add no more than ONE repaint's cost (measured ~4.2 ms
 * here) to the idle baseline, and must never spike far beyond it.
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
    f.animating = pg?.walls?.phase != null && pg.walls.phase !== 'normal'
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

// 1. The IDLE baseline of THIS session.
await page.evaluate(() => {
  window.__w.frames = []
})
await page.waitForTimeout(3500)
const idle = await page.evaluate(() => window.__w.frames.slice())
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0
}
const idleP99 = pct(idle.map((f) => f.total), 0.99)
const idleMax = Math.max(...idle.map((f) => f.total))
console.log(`idle baseline: p99=${idleP99.toFixed(1)}ms max=${idleMax.toFixed(1)}ms (${idle.length} frames)`)

// 2. The raise.
await page.evaluate(() => {
  window.__w.frames = []
})
await page.evaluate(() => {
  window.__brGame.scene.getScene('playground').walls.activate()
})
await page.waitForTimeout(3200)
const fr = await page.evaluate(() => window.__w.frames.slice())
const anim = fr.filter((f) => f.animating)
const times = anim.map((f) => f.total)
const maxAnim = times.length ? Math.max(...times) : 0
const animP50 = pct(times, 0.5)
const animP95 = pct(times, 0.95)
console.log(
  `the raise: ${anim.length} animation frames, p50=${animP50.toFixed(1)}ms p95=${animP95.toFixed(1)}ms max=${maxAnim.toFixed(1)}ms`,
)

// WHAT MATTERS: the animation must not be SUSTAINEDLY slower than idle.
// A single slow frame (a repaint landing on a busy physics frame) is one
// dropped frame out of ~50 — barely perceptible, and the same jitter the
// idle game has. Sustained slowness is what the player sees as judder.
//
// So: the MEDIAN animation frame must stay close to the idle baseline,
// the p95 must stay within a modest margin, and NO frame may be a real
// hitch (the 33ms threshold — a whole frame at 30Hz).
const medianBudget = idleP99 + 5
const p95Budget = idleP99 + 12
console.log(`budgets: median ${medianBudget.toFixed(1)}ms, p95 ${p95Budget.toFixed(1)}ms`)
if (anim.length === 0) {
  failures.push('the wall animation was never observed (the measurement is meaningless)')
}
if (animP50 > medianBudget) {
  failures.push(`the animation's median frame was ${animP50.toFixed(1)}ms (budget ${medianBudget.toFixed(1)}ms) — it is SUSTAINEDLY slower than idle`)
}
if (animP95 > p95Budget) {
  failures.push(`the animation's p95 frame was ${animP95.toFixed(1)}ms (budget ${p95Budget.toFixed(1)}ms)`)
}
const hitches = times.filter((t) => t > 33)
if (hitches.length) {
  failures.push(`${hitches.length} animation frames were a real hitch (>33ms)`)
}
if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'wall raise: the animation stays close to the session\'s own idle baseline',
  failures,
  `idleP99=${idleP99.toFixed(1)}ms animP50=${animP50.toFixed(1)}ms animP95=${animP95.toFixed(1)}ms max=${maxAnim.toFixed(1)}ms`,
)
