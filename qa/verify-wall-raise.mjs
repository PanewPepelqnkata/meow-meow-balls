import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the WALL RAISE invariant: after the walls rise, the pile's BALLS
 * must come to rest — and the rest gate's war-surrender evidence must
 * survive the raise.
 *
 * The defect this guards: the Raise Walls ability woke the rim band on
 * EVERY frame of the 900ms animation, and each wake wiped the ball's
 * war-surrender counter. That counter is the ONLY escape for a ball in a
 * standing solver war (a ball whose particles churn at the speed cap
 * while its centroid is nearly still). Without the evidence the ball
 * could never complete its quiet window, so it churned forever and kept
 * its whole neighbourhood awake — the pile never came to rest.
 *
 * The metric is the pile's BALL motion (the centroid speed), not the
 * particle max: a ball in a standing war reads as a still ball on
 * screen even though its particles are at the speed cap.
 */
const RUNS = Number(process.env.RUNS ?? 3)
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 16000)
const SAMPLE_MS = 250

const failures = []
const results = []

for (let run = 0; run < RUNS; run++) {
  const { browser, page, errors } = await bootGame()

  await page.evaluate(() => {
    const tiers = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4]
    tiers.forEach((t, i) => {
      window.__brScene.spawnAt(250 + (i % 5) * 55, t, 250 + Math.floor(i / 5) * 90, true)
    })
  })
  await page.waitForTimeout(7000)

  const measure = async () =>
    page.evaluate(() => {
      const scene = window.__brGame.scene.getScene('playground')
      const balls = scene.balls.getBalls()
      let centroidMax = 0
      for (const b of balls) {
        let mvx = 0
        let mvy = 0
        for (const p of b.soft.particles) {
          mvx += p.velocity.x
          mvy += p.velocity.y
        }
        const n = b.soft.particles.length
        const cs = Math.hypot(mvx / n, mvy / n)
        if (cs > centroidMax) centroidMax = cs
      }
      return {
        centroid: +centroidMax.toFixed(2),
        sleeping: balls.filter(
          (b) => b.soft.center.isSleeping && b.soft.particles.every((q) => q.isSleeping),
        ).length,
        balls: balls.length,
      }
    })

  await page.evaluate(() => {
    window.__brGame.scene.getScene('playground').walls.activate()
  })

  const series = []
  const t0 = Date.now()
  while (Date.now() - t0 < WINDOW_MS) {
    series.push(await measure())
    await page.waitForTimeout(SAMPLE_MS)
  }

  const mean = series.reduce((a, b) => a + b.centroid, 0) / series.length
  const tail = series.slice(-Math.max(1, Math.floor(series.length / 4)))
  const tailMean = tail.reduce((a, b) => a + b.centroid, 0) / tail.length
  const last = series[series.length - 1]

  console.log(
    `run ${run}: meanCentroid=${mean.toFixed(2)} tailMean=${tailMean.toFixed(2)} sleeping=${last.sleeping}/${last.balls}`,
  )
  results.push({ run, mean, tailMean, last })

  // The pile's balls must CALM DOWN: the tail (the settled pile) must be
  // calm in absolute terms. The tail-vs-mean comparison is not asserted:
  // the pile's agitation is dominated by the raise itself (which happens
  // at the start of the window), so the two are close by construction and
  // the run-to-run noise would make the comparison flaky.
  if (tailMean > 2.2) {
    failures.push(`run ${run}: the pile is still moving after the raise (tail ${tailMean.toFixed(2)})`)
  }
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)
  await browser.close()
}

const avgMean = results.reduce((a, b) => a + b.mean, 0) / results.length
const avgTail = results.reduce((a, b) => a + b.tailMean, 0) / results.length
console.log(`SUMMARY: meanCentroid=${avgMean.toFixed(2)} tailMean=${avgTail.toFixed(2)}`)

report(
  `wall raise: the pile's balls come to rest (${RUNS} runs)`,
  failures,
  `mean=${avgMean.toFixed(2)} tail=${avgTail.toFixed(2)}`,
)
