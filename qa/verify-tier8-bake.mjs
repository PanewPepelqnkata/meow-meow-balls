import { bootGame, frameCount, report } from './lib-game.mjs'

/**
 * Guards the live-render contract for tiers 8 and 9.
 *
 * Tiers 1–7 use shared per-tier baked body sprites. Tiers 8 and 9 are
 * deliberately different: tier 8 must keep its clock-driven colour cycle,
 * while tier 9 draws its collectible body procedurally. Both therefore stay
 * on the live Graphics path, including after they settle.
 *
 * This script asserts that both balls remain registered and drawn, neither
 * enters the sprite-bake path, and the game loop survives their presence.
 */
const { browser, page, errors } = await bootGame()

const failures = []

// Spawn a tier 8 and a tier 9 apart from one another. They are both live
// tiers, so settling must not move either one into the sprite-bake path.
const spawned = []
for (const [tier, x] of [[8, 250], [9, 470]]) {
  const ball = await page.evaluate(
    ({ t, xx }) => window.__brScene.spawnAt(xx, t, 600, true),
    { t: tier, xx: x },
  )
  spawned.push(ball)
  await page.waitForTimeout(2000)
}

const live = await page.evaluate((ids) => {
  const scene = window.__brGame.scene.getScene('playground')
  const qa = window.__brScene
  const balls = scene.balls.getBalls()
  return {
    bakedSize: qa.bakedSize(),
    balls: ids.map(({ id, tier }) => {
      const ball = balls.find((candidate) => candidate.id === id)
      if (!ball) return { id, tier, error: 'ball disappeared' }
      const view = qa.spriteView(id)
      return {
        id,
        tier: ball.tier,
        state: ball.state,
        drawn: qa.isDrawn(id),
        baked: qa.isBaked(id),
        spriteVisible: view?.visible ?? null,
      }
    }),
  }
}, spawned)

for (const b of live.balls) {
  if (b.error) {
    failures.push(`tier ${b.tier}: ${b.error}`)
    continue
  }
  if (!b.drawn) failures.push(`tier ${b.tier}: the live renderer did not draw the ball`)
  if (b.baked) failures.push(`tier ${b.tier}: entered the sprite-bake path`)
  if (b.spriteVisible !== false) {
    failures.push(`tier ${b.tier}: its body sprite is visible; the tier must use the live path`)
  }
}
if (live.bakedSize !== 0) {
  failures.push(`the live tier 8/9 scene rendered ${live.bakedSize} baked sprite(s)`)
}

// The loop must keep running.
const f0 = await frameCount(page)
await page.waitForTimeout(1500)
const f1 = await frameCount(page)
if (f1 - f0 < 10) failures.push(`the game loop stalled (${f0} -> ${f1})`)

if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()
report(
  'tier 8/9 live rendering: both bodies stay live and the loop survives',
  failures,
  `live: ${JSON.stringify(live)}\nloop: ${f0} -> ${f1}`,
)
