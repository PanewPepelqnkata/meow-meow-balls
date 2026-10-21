import { bootGame, frameCount, report } from './lib-game.mjs'

/**
 * Guards the tier 8/9 bake invariant.
 *
 * A tier 8/9 ball that falls asleep bakes a frozen texture of its
 * procedural body. Two bugs lived there:
 *
 *  - the bake REMOVED the texture the ball's own body sprite was bound
 *    to, which nulls the frame's source and makes the next WebGL render
 *    throw inside Phaser's unguarded render pass — and because Phaser's
 *    requestAnimationFrame re-arms the next frame AFTER the callback
 *    returns, that throw permanently stops the game loop (the whole
 *    canvas UI vanishes with it);
 *  - the texture was sized from the WORLD-space contour while the body
 *    was DRAWN in local space, so the body was rasterized outside the
 *    canvas and clipped away (an empty texture) and the sprite was
 *    placed ~350px away from the ball.
 *
 * This script asserts: no page error, the loop keeps advancing, and the
 * baked sprite sits ON the ball.
 */
const { browser, page, errors } = await bootGame()

const failures = []

// Spawn a tier 8 and a tier 9 and force their bakes.
for (const tier of [8, 9]) {
  await page.evaluate((t) => window.__brScene.spawnAt(360, t, 600, true), tier)
  await page.waitForTimeout(2000)
}

const baked = await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  const r = scene.ballRenderer
  const out = []
  for (const ball of scene.balls.getBalls()) {
    if (ball.tier !== 8 && ball.tier !== 9) continue
    const look = r.lookFor(ball)
    const built = r.liveContour(ball, look, ball.soft.radius)
    r.bakeSpecial(ball, built.poly, 0xff9800)
    const tex = r.specialTextures.get(ball.id)
    if (!tex) {
      out.push({ tier: ball.tier, error: 'no special texture' })
      continue
    }
    r.drawSpecialQuads(ball.id, tex, built.cx, built.cy, 1)
    const view = r.spriteViews.get(ball.id)
    out.push({
      tier: ball.tier,
      ballCx: built.cx,
      ballCy: built.cy,
      spriteX: view.fill.x,
      spriteY: view.fill.y,
      visible: view.fill.visible,
      texSize: tex.size,
    })
  }
  return out
})

for (const b of baked) {
  if (b.error) {
    failures.push(`tier ${b.tier}: ${b.error}`)
    continue
  }
  const dx = b.spriteX - b.ballCx
  const dy = b.spriteY - b.ballCy
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    failures.push(
      `tier ${b.tier}: the baked sprite is ${dx.toFixed(1)},${dy.toFixed(1)}px from the ball (must be 0,0)`,
    )
  }
  if (!b.visible) failures.push(`tier ${b.tier}: the baked sprite is not visible`)
}

// The loop must keep running.
const f0 = await frameCount(page)
await page.waitForTimeout(1500)
const f1 = await frameCount(page)
if (f1 - f0 < 10) failures.push(`the game loop stalled (${f0} -> ${f1})`)

if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()
report(
  'tier 8/9 bake: the baked body sits on the ball and the loop survives',
  failures,
  `baked: ${JSON.stringify(baked)}\nloop: ${f0} -> ${f1}`,
)
