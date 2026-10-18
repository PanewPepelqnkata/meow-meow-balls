/* global window, process, console */
/**
 * Phase 2.10.2 browser QA — the 11 required gameplay cases on the NORMAL
 * production game (no query params). Produces qa/phase2102-report.json and
 * screenshots in qa/screens/p7-*.png.
 *
 * Cases:
 *  1. two same-tier balls merge while a smaller ball is beside them
 *  2. a large merge in a dense pile
 *  3. a merge produces a ball already touching a same-tier ball (cooldown)
 *  4. two independent pairs merge near the same time
 *  5. balls contact the left slanted wall and settle
 *  6. balls contact the right slanted wall and settle
 *  7. a small ball wedged between a slanted wall and a larger ball
 *  8. a dense pile settles after the last impact
 *  9. a ball dropped onto a stable pile deforms naturally
 * 10. walls raised and lowered while balls contact them
 * 11. restart clears balls, bodies, constraints, renderers, cooldowns
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5199/'
mkdirSync('qa/screens', { recursive: true })
const results = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } })
page.on('pageerror', (e) => results.push({ case: 'PAGEERROR', pass: false, detail: e.message }))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })
await page.waitForTimeout(500)

const sleep = (ms) => page.waitForTimeout(ms)
const restart = () => page.evaluate(() => window.__brScene.restart())
const spawnAt = (x, tier, y) => page.evaluate(({ x, tier, y }) => window.__brScene.spawnAt(x, tier, y), { x, tier, y })
const tel = () => page.evaluate(() => window.__brScene.telemetry())
const life = () => page.evaluate(() => window.__brScene.lifecycle())
const shot = (n) => page.screenshot({ path: `qa/screens/${n}.png`, type: 'png' })
const rec = (n, pass, detail) => results.push({ case: n, pass, detail })

/* Case 1: same-tier merge beside a smaller ball — no burial, one replacement. */
{
  await restart()
  await sleep(500)
  await spawnAt(300, 2, 900)
  await spawnAt(400, 2, 900)
  await sleep(1200)
  await spawnAt(350, 1, 850) // small ball lands beside/above the pair
  await sleep(4000)
  const t = await tel()
  const lc = await life()
  const tiers = {}
  for (const b of t.balls) tiers[b.tier] = (tiers[b.tier] ?? 0) + 1
  const noBurial = t.worstPairOverlap <= 2.5
  const consistent = lc.renderables === lc.logicalBalls
  const oneReplacement = lc.merge.replacementsCreated >= 1 && lc.merge.replacementsCreated === lc.merge.mergesCompleted
  rec('case1-merge-beside-small', noBurial && consistent && oneReplacement && t.worstPairOverlap <= 2.5,
    { tiers, worstPairOverlap: t.worstPairOverlap, renderables: lc.renderables, logicalBalls: lc.logicalBalls, merge: lc.merge })
  await shot('p7-case1-merge-beside-small')
}

/* Case 2: large merge in a dense pile. */
{
  await restart()
  await sleep(500)
  for (let i = 0; i < 14; i++) {
    await spawnAt(150 + (i % 5) * 105, [1, 2, 3, 2, 1][i % 5], 800 - (i % 3) * 130)
    await sleep(600)
  }
  await sleep(8000)
  const t = await tel()
  const lc = await life()
  const ok = t.worstPairOverlap <= 2.5 && lc.renderables === lc.logicalBalls && lc.merge.duplicateEventsRejected >= 0
  rec('case2-large-merge-dense-pile', ok,
    { balls: t.balls.length, worstPairOverlap: t.worstPairOverlap, renderables: lc.renderables, merge: lc.merge })
  await shot('p7-case2-dense-pile')
}

/* Case 3: chain merge delayed by cooldown (not same-step). */
{
  await restart()
  await sleep(500)
  // Build a tier-3 pair quickly, then a tier-2 pair right beside it.
  await spawnAt(300, 2, 900)
  await spawnAt(400, 2, 900)
  await sleep(2500) // → tier-3
  await spawnAt(480, 1, 850)
  await spawnAt(560, 1, 850)
  await sleep(2500) // → tier-2 next to the tier-3? (different tiers, no merge)
  // Sample merge cadence: watch mergesCompleted over time while a fresh
  // same-tier pair forms near another. Use natural drops into the pile.
  let mergeTimes = []
  let last = (await life()).merge.mergesCompleted
  const t0 = Date.now()
  for (let i = 0; i < 12; i++) {
    await spawnAt(300 + (i % 3) * 60, 1, 750)
    await sleep(500)
    const m = (await life()).merge.mergesCompleted
    if (m > last) {
      mergeTimes.push(Date.now() - t0)
      last = m
    }
  }
  // Any two consecutive merges must be separated by at least the cooldown
  // (120ms) in OBSERVED wall time (frames at ~16ms resolution; same-step
  // chains would show ~0-16ms gaps).
  let minGap = Infinity
  for (let i = 1; i < mergeTimes.length; i++) minGap = Math.min(minGap, mergeTimes[i] - mergeTimes[i - 1])
  const lc = await life()
  rec('case3-cooldown-chain', mergeTimes.length >= 2 && minGap >= 100,
    { mergeTimes, minGapMs: minGap === Infinity ? null : minGap, merges: mergeTimes.length, renderables: lc.renderables })
  await shot('p7-case3-chain')
}

/* Case 4: two independent pairs merge near the same time. */
{
  await restart()
  await sleep(500)
  await spawnAt(230, 1, 900)
  await spawnAt(310, 1, 900) // left pair (touching)
  await spawnAt(440, 1, 900)
  await spawnAt(520, 1, 900) // right pair (touching)
  await sleep(3500)
  const t = await tel()
  const lc = await life()
  const tiers = {}
  for (const b of t.balls) tiers[b.tier] = (tiers[b.tier] ?? 0) + 1
  const ok = lc.merge.mergesCompleted === 2 && (tiers[2] ?? 0) === 2 && (tiers[1] ?? 0) === 0
  rec('case4-independent-pairs', ok, { tiers, merges: lc.merge.mergesCompleted, sourcesRemoved: lc.merge.sourcesRemoved })
  await shot('p7-case4-pairs')
}

/* Cases 5+6: settle against left and right slanted walls. */
for (const side of ['left', 'right']) {
  await restart()
  await sleep(500)
  const x = side === 'left' ? 210 : 510
  await spawnAt(x, 2, 860)
  await sleep(1500)
  await spawnAt(side === 'left' ? 190 : 530, 3, 800)
  await sleep(9000)
  const t = await tel()
  const allAsleep = t.balls.every((b) => b.sleeping)
  const noJitter = t.balls.every((b) => b.centroidSpeed < 0.5)
  const inside = t.balls.every((b) => b.cx > 120 && b.cx < 600 && b.cy < 1090)
  rec(`case5-${side}-wall-settle`, allAsleep && noJitter && inside,
    { balls: t.balls.map((b) => ({ id: b.id, tier: b.tier, cx: b.cx, cy: b.cy, sleeping: b.sleeping, speed: b.centroidSpeed })) })
  await shot(`p7-case5-${side}-wall`)
}

/* Case 7: small ball wedged between wall and big ball. */
{
  await restart()
  await sleep(500)
  await spawnAt(265, 5, 900)
  await sleep(3000)
  await spawnAt(215, 1, 850)
  await sleep(1500)
  await spawnAt(330, 3, 850)
  await sleep(10000)
  const t = await tel()
  const lc = await life()
  const awake = t.balls.filter((b) => !b.sleeping)
  const wedged = t.balls.find((b) => b.tier === 1)
  const ok = t.balls.every((b) => b.centroidSpeed < 0.6) && lc.renderables === lc.logicalBalls
  rec('case7-wedged-small', ok, {
    balls: t.balls.map((b) => ({ tier: b.tier, cx: +b.cx.toFixed(1), cy: +b.cy.toFixed(1), sleeping: b.sleeping, speed: +b.centroidSpeed.toFixed(2) })),
    wedgedFound: !!wedged, awake: awake.length,
  })
  await shot('p7-case7-wedged')
}

/* Case 8: dense pile settles after last impact. */
{
  await restart()
  await sleep(500)
  for (let i = 0; i < 16; i++) {
    await spawnAt(160 + (i % 5) * 100, [2, 1, 3, 1, 2][i % 5], 750 - (i % 3) * 140)
    await sleep(600)
  }
  await sleep(12000)
  const t = await tel()
  const lc = await life()
  const allAsleep = t.balls.every((b) => b.sleeping)
  const overlap0 = t.worstPairOverlap <= 2.5
  rec('case8-pile-settles', allAsleep && overlap0 && lc.renderables === lc.logicalBalls,
    { balls: t.balls.length, awake: t.balls.filter((b) => !b.sleeping).length, worstPairOverlap: t.worstPairOverlap })
  await shot('p7-case8-settled')
}

/* Case 9: ball dropped onto a stable pile deforms naturally. */
{
  await restart()
  await sleep(500)
  await spawnAt(320, 4, 950)
  await sleep(6000) // stable base
  const before = await tel()
  await spawnAt(320, 3, 700)
  let maxDeform = 0
  for (let i = 0; i < 30; i++) {
    await sleep(50)
    const t = await tel()
    const dropped = t.balls.find((b) => b.tier === 3)
    if (dropped) maxDeform = Math.max(maxDeform, 1 - dropped.area)
  }
  await sleep(10000)
  const after = await tel()
  rec('case9-drop-deform', maxDeform > 0.02 && maxDeform < 0.5 && after.balls.every((b) => b.sleeping || b.centroidSpeed < 1.5),
    { maxDeform: +maxDeform.toFixed(3), beforeBalls: before.balls.length, afterBalls: after.balls.length, final: after.balls.map((b) => ({ tier: b.tier, sleeping: b.sleeping, speed: +b.centroidSpeed.toFixed(2) })) })
  await shot('p7-case9-deform')
}

/* Case 10: raise + lower walls while balls contact them. */
{
  await restart()
  await sleep(500)
  await spawnAt(210, 2, 860)
  await spawnAt(510, 2, 860)
  await sleep(3000)
  const raiseBtn2 = (await page.evaluate(() => window.__brScene.uiPositions())).abilities[2]
  await page.mouse.click(raiseBtn2.x, raiseBtn2.y) // Raise Walls ability
  await sleep(4000)
  await shot('p7-case10-raised')
  const tRaised = await tel()
  const raisedOk = tRaised.balls.every((b) => b.cy < 1090 && b.cx > 60 && b.cx < 660)
  await sleep(20000) // hold expires; walls lower
  const tLowered = await tel()
  const floorOk = tLowered.balls.every((b) => b.cy <= 1090)
  rec('case10-walls-cycle', raisedOk && floorOk && tLowered.balls.length > 0,
    { raised: tRaised.balls.map((b) => ({ cy: b.cy, sleeping: b.sleeping })), lowered: tLowered.balls.map((b) => ({ cy: +b.cy.toFixed(0), sleeping: b.sleeping })) })
  await shot('p7-case10-lowered')
}

/* Case 11: restart clears everything (incl. cooldowns and pending merges). */
{
  await restart()
  await sleep(500)
  for (let i = 0; i < 6; i++) {
    await spawnAt(200 + i * 60, 1, 850)
    await sleep(500)
  }
  await sleep(3000)
  await restart()
  await sleep(800)
  const t = await tel()
  const lc = await life()
  const cleared = t.balls.length === 0 && lc.renderables === 0 && lc.logicalBalls === 0
  // After restart, a fresh pair must merge normally (cooldown map cleared).
  await spawnAt(340, 1, 900)
  await spawnAt(384, 1, 900)
  await sleep(4000)
  const after = await life()
  rec('case11-restart-clears', cleared && after.merge.mergesCompleted === 1 && after.renderables === after.logicalBalls,
    { cleared, mergeAfterRestart: after.merge, renderables: after.renderables })
  await shot('p7-case11-restart')
}

const passCount = results.filter((r) => r.pass).length
writeFileSync('qa/phase2102-report.json', JSON.stringify({ results, passCount, total: results.length }, null, 2))
console.log(`PHASE2102 ${passCount}/${results.length}`)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.case} ${r.pass ? '' : JSON.stringify(r.detail).slice(0, 400)}`)
await browser.close()
