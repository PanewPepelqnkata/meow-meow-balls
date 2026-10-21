import { bootGame, report } from './lib-game.mjs'

/**
 * Guards that the fear ladder is engaged by the LIVE emotion system in
 * REAL PLAY — no QA hooks, no synthetic positions: the pile is filled by
 * dropping balls, and the guard watches every ball's emotion level as the
 * pile rises. The 'scared'/'panic' phases require a ball whose visual top
 * is past the rim, so the guard keeps DROPPING until the pile reaches the
 * rim (the natural "the container is about to overflow" state).
 */
const failures = []
const { browser, page, errors } = await bootGame()

const seen = new Set()
let maxPanic = 0
let bestAbove = -9999
const SPOTS = [235, 280, 325, 370, 415, 460, 255, 300, 345, 390, 435, 270, 315, 360, 405, 450]

const sample = async () => {
  const s = await page.evaluate(() => {
    const pg = window.__brGame.scene.getScene('playground')
    const emo = pg.ballRenderer.emotion
    const levels = {}
    let p = 0
    let above = -9999
    for (const b of pg.balls.getBalls()) {
      const l = emo.levelOf(b.id)
      levels[l] = (levels[l] ?? 0) + 1
      p = Math.max(p, emo.panicOf(b.id))
      const a = emo.wallTopY - (b.soft.center.position.y - b.soft.radius - 6)
      if (a > above) above = a
    }
    return { levels, p, above, balls: pg.balls.getBalls().length, gameOver: !!pg.gameOver }
  })
  for (const l of Object.keys(s.levels)) seen.add(l)
  maxPanic = Math.max(maxPanic, s.p)
  bestAbove = Math.max(bestAbove, s.above)
  return s
}

// Keep dropping until the pile reaches the rim (or the run ends). The
// drops are spread across the container so the pile actually stacks up
// against the rim.
for (let round = 0; round < 50; round++) {
  const s = await sample()
  if (s.gameOver) break
  await page.evaluate((x) => window.__brScene.dropAt(x), SPOTS[round % SPOTS.length])
  await page.waitForTimeout(200)
}
// A fresh drop may not fear for its first 1500ms (the spawn grace — a
// ball falling through the rim on the way IN is not escaping). Wait the
// grace out, then sample the settled pile.
await page.waitForTimeout(2500)
for (let i = 0; i < 25; i++) {
  await sample()
  await page.waitForTimeout(200)
}

console.log('levels seen:', [...seen].join(', '))
console.log('max panic:', maxPanic.toFixed(3))
console.log('best above-rim (px):', Math.round(bestAbove))

if (!seen.has('worried')) failures.push('no ball reached "worried" in real play')
if (!seen.has('scared') && !seen.has('panic')) {
  failures.push('no ball reached "scared"/"panic" in real play')
}
if (maxPanic < 0.3) failures.push(`the fear value never rose (max ${maxPanic.toFixed(3)})`)
if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report('real play: the pile climbs the fear ladder as it rises', failures, `levels=${[...seen].join(',')}`)
