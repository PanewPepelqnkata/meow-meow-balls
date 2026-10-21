import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the GAME-OVER PANIC: when the run ends, every surviving ball must
 * show the full panic face (the "doomed" realization) — and the face must
 * NOT vanish.
 */
const failures = []
const { browser, page, errors } = await bootGame()

// Fill the container so a real game over happens.
for (let i = 0; i < 22; i++) {
  await page.evaluate((x) => window.__brScene.dropAt(x), 250 + ((i * 41) % 220))
  await page.waitForTimeout(320)
}
// Force the game over and sample DURING the panic window (the shatter
// chain removes the balls a few hundred ms later).
await page.evaluate(() => {
  const pg = window.__brGame.scene.getScene('playground')
  pg.triggerGameOver()
})
await page.waitForTimeout(220)

const s = await page.evaluate(() => {
  const pg = window.__brGame.scene.getScene('playground')
  const r = pg.ballRenderer
  const balls = pg.balls.getBalls()
  const override = pg.gameOverSequence ? pg.gameOverSequence.panicOverride : 0
  let anyFeared = 0
  let anyVisible = 0
  let fearedMouth = 0
  const perBall = []
  for (const b of balls) {
    // The EFFECTIVE fear the renderer uses (the override wins).
    const fear = override || r.emotion.panicOf(b.id)
    const view = r.faces ? r.faces.view(b.id) : null
    if (!view) continue
    const visible = view.scleraL.visible && view.pupilL.visible
    if (visible) anyVisible++
    if (fear > 0) anyFeared++
    // Under fear the neutral mouth sprite is REPLACED by the frightened O.
    if (fear > 0.05 && !view.mouth.visible) fearedMouth++
    perBall.push({ fear: +fear.toFixed(2), visible, mouth: view.mouth.visible })
  }
  return {
    balls: balls.length,
    anyFeared,
    anyVisible,
    fearedMouth,
    perBall,
    panicOverride: override,
    running: pg.gameOverSequence ? pg.gameOverSequence.running : false,
  }
})

console.log('game over state:', JSON.stringify(s))
if (s.balls === 0) failures.push('no balls survived to check the panic')
if (s.anyFeared === 0) failures.push('no ball showed the feared face at game over')
if (s.anyVisible === 0) failures.push('every face VANISHED at game over')
if (s.fearedMouth === 0) failures.push('no ball got the frightened mouth at game over')
if (s.panicOverride !== 1 && !s.running) {
  failures.push(`the game-over panic override was not active (${s.panicOverride})`)
}
if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report('game over: every survivor shows the panic face', failures, JSON.stringify(s))
