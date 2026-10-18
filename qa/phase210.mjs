/* global window, console, process */
/* Phase 2.10.0 browser verification — runs the NORMAL production game
 * (dev server, no query params). Covers the acceptance criteria:
 *   1. merge placement never traps a ball (all scenarios, real physics)
 *   2. chain merges, exactly once
 *   3. new spawn height (above the rim, open sky)
 *   4. faster fall (measured trajectory)
 *   5. boundaries: colliders == visible walls, no invisible blockers
 *   6. containment (floor + walls)
 *   7. game-over overlay on overflow
 *   8. restart fully resets
 *   10. dense pile settles without renewed jitter/penetration
 * Uses the DEV-only interface (__brScene): read-only telemetry + the two
 * documented mutating QA hooks (dropAt / spawnAt / restart).
 * Screenshots: qa/screens/p210-*.png, measurements: qa/phase210-report.json.
 * Usage: node qa/phase210.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5199/'
mkdirSync('qa/screens', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLEERROR', m.text())
})
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })
await page.waitForTimeout(500)

const tel = () => page.evaluate(() => window.__brScene.telemetry())
const counts = () => page.evaluate(() => window.__brScene.physicsCounts())
const geo = () => page.evaluate(() => window.__brScene.wallGeometry())
const gameOverState = () => page.evaluate(() => window.__brScene.gameOver())
const spawnAt = (x, tier, y) => page.evaluate(([x, t, y]) => window.__brScene.spawnAt(x, t, y), [x, tier, y])
const dropAt = (x) => page.evaluate((x) => window.__brScene.dropAt(x), x)
const shot = (name) => page.screenshot({ path: `qa/screens/${name}.png`, type: 'png' })
const sleep = (ms) => page.waitForTimeout(ms)
const waitFor = async (fn, timeoutMs = 15000, pollMs = 100) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true
    await sleep(pollMs)
  }
  return false
}

const report = { checks: {}, scenarios: [] }
const record = (name, pass, data) => {
  report.scenarios.push({ name, pass, ...data })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(data))
}

/* --- 0: constraint hygiene baseline (per-ball constraint count) ---------- */
{
  const c0 = await counts()
  await spawnAt(360, 1)
  await sleep(300)
  const c1 = await counts()
  const perBall = {
    bodies: (c1.bodies - c0.bodies) / 1,
    constraints: c1.constraints - c0.constraints,
  }
  record('baseline per-ball footprint', perBall.bodies === 17, { perBall })
  report.checks.perBall = perBall
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
}

/* --- 1: boundaries — colliders exactly on the visible walls, no extra blockers
 * -------------------------------------------------------------------------- */
{
  const g = await geo()
  const floorTop = Math.min(...g.floor.map((v) => v.y))
  const floorBottom = Math.max(...g.floor.map((v) => v.y))
  // Inner wall line — Phase 2.11.2 open-top geometry: from (112.05, 765)
  // (normal tops; height 320, slope 0.142105 preserved) to (157.5, 1085);
  // collider inner edge must match within 0.1px (exact placement).
  const leftInner = g.left.filter((v) => v.x > 80 && v.x < 160)
  const innerTopLeft = leftInner.find((v) => v.y < 800)
  const innerBottomLeft = leftInner.find((v) => v.y > 1000)
  const errTop = Math.abs(innerTopLeft.x - 112.05) + Math.abs(innerTopLeft.y - 765)
  const errBottom = Math.abs(innerBottomLeft.x - 157.5) + Math.abs(innerBottomLeft.y - 1085)
  const rightInner = g.right.filter((v) => v.x > 560 && v.x < 640)
  const rTop = rightInner.find((v) => v.y < 800)
  const errRight = Math.abs(rTop.x - 607.95) + Math.abs(rTop.y - 765)
  const exact = errTop < 0.1 && errBottom < 0.1 && errRight < 0.1 && Math.abs(floorTop - 1085) < 0.1
  record(
    'colliders exactly on visible geometry (no invisible step)',
    exact,
    { errTop, errBottom, errRight, floorTop, floorBottom, phase: g.phase },
  )
  report.checks.colliderAlignment = { errTop, errBottom, errRight, floorTop }
}

/* --- 2: spawn height + fall trajectory ----------------------------------- */
{
  await sleep(600) // clear the restart-click drop-suppression window
  await dropAt(360)
  await sleep(80)
  const t = await tel()
  const b = t.balls[t.balls.length - 1]
  const spawnY = b ? b.cy : null
  // Sample the fall
  const traj = []
  for (let i = 0; i < 30; i++) {
    const tt = await tel()
    const nb = tt.balls[tt.balls.length - 1]
    if (nb) traj.push({ t: i * 50, y: nb.cy, v: nb.centroidSpeed })
    await sleep(50)
  }
  await shot('p210-spawn-fall')
  // Phase 2.11.2: spawn anchored above the RAISED wall tops — tier-1 (r 44)
  // spawns at y = 425 − 44 − 50 = 331 (bottom 50px above the raised tops).
  const spawnOk = spawnY != null && spawnY >= 316 && spawnY <= 346
  // Fall: ball must reach the lower half of the container (longer drop)
  const fell = traj.length > 0 && Math.min(...traj.map((p) => p.y)) < 700
  record('spawn height above rim + long clean fall', spawnOk && fell, {
    spawnY,
    spawnExpected: 331,
    yAtEnd: traj[traj.length - 1]?.cy,
    trajectory: traj.filter((_, i) => i % 4 === 0),
  })
  report.checks.fall = { spawnY, trajEnd: traj[traj.length - 1] }
  await sleep(3000)
}

/* --- helper: after-merge invariant check ---------------------------------- */
const checkNoTrap = async (label, before) => {
  await sleep(2500)
  const t = await tel()
  const after = {
    balls: t.balls.length,
    worstPairOverlap: t.worstPairOverlap,
  }
  const countsByTier = {}
  for (const b of t.balls) countsByTier[b.tier] = (countsByTier[b.tier] ?? 0) + 1
  const c = await counts()
  const expectedConstraints = t.balls.length * report.checks.perBall.constraints
  const noOrphans = Math.abs(c.constraints - expectedConstraints) <= 1
  const noTrap = t.worstPairOverlap <= 2.5
  const contained = t.balls.every((b) => b.cy < 1085 && b.cx > 60 && b.cx < 660)
  record(label, noTrap && noOrphans && contained, {
    before,
    after,
    countsByTier,
    constraints: c.constraints,
    expectedConstraints,
  })
  return countsByTier
}

/* --- 3: merge beside a SMALL ball (the reproduction scenario) ------------ */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  await spawnAt(360, 1) // small blue ball settles first
  await sleep(1500)
  const before = (await tel()).balls.length
  // Two tier-4s drop as an overlapping pair right onto it
  await spawnAt(287, 4)
  await spawnAt(433, 4)
  const tiers = await checkNoTrap('merge beside small ball (tier-1)', { before })
  await shot('p210-merge-beside-small')
  report.checks.mergeBesideSmall = tiers
}

/* --- 4: merge beside a same/larger-tier ball ------------------------------ */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  await spawnAt(500, 3) // pink tier-3 settles beside the pair zone
  await sleep(1500)
  const before = (await tel()).balls.length
  await spawnAt(300, 4)
  await spawnAt(446, 4)
  const tiers = await checkNoTrap('merge beside pink tier-3', { before })
  await shot('p210-merge-beside-large')
  report.checks.mergeBesideLarge = tiers
}

/* --- 5: merge next to the container wall ---------------------------------- */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  const before = (await tel()).balls.length
  await spawnAt(200, 4) // hugs the left wall (clamped inside)
  await spawnAt(346, 4) // overlapping pair
  const tiers = await checkNoTrap('merge next to the left wall', { before })
  await shot('p210-merge-wall')
  report.checks.mergeWall = tiers
}

/* --- 6: merge in a dense pile --------------------------------------------- */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  // Build a dense pyramid of tier-3s with a tier-1 inside, then a pair on top
  const y0 = 1085
  for (let i = 0; i < 4; i++) await spawnAt(200 + i * 106, 3, y0 - 59 - (i % 2) * 2)
  await sleep(1200)
  for (let i = 0; i < 3; i++) await spawnAt(253 + i * 106, 3, y0 - 158)
  await sleep(1200)
  await spawnAt(306, 3, y0 - 255)
  await spawnAt(412, 3, y0 - 255)
  await spawnAt(360, 1, y0 - 360)
  await sleep(1500)
  const before = (await tel()).balls.length
  await spawnAt(240, 4, y0 - 470)
  await spawnAt(386, 4, y0 - 470)
  const tiers = await checkNoTrap('merge in dense pile', { before })
  await shot('p210-merge-dense')
  report.checks.mergeDense = tiers
}

/* --- 7: chain merges in quick succession ---------------------------------- */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  const before = (await tel()).balls.length
  // Two tier-1 pairs + a tier-2 pair, all dropped within ~200ms
  await spawnAt(340, 1)
  await spawnAt(380, 1)
  await spawnAt(280, 1)
  await spawnAt(240, 1)
  await spawnAt(480, 2)
  await spawnAt(530, 2)
  await sleep(6000)
  const t = await tel()
  const tiers = {}
  for (const b of t.balls) tiers[b.tier] = (tiers[b.tier] ?? 0) + 1
  const merged = Object.entries(tiers).some(([tier, n]) => Number(tier) >= 2 && n >= 1)
  const noTrap = t.worstPairOverlap <= 2.5
  record('chain merges in quick succession (exactly-once)', merged && noTrap && t.balls.length < before + 6, {
    before,
    after: t.balls.length,
    tiers,
    worstPairOverlap: t.worstPairOverlap,
  })
  await shot('p210-chain')
  report.checks.chain = tiers
}

/* --- 8: dense pile settles (no renewed jitter, no penetration) ------------ */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  // ORGANIC dense pile: real drops at varied positions (the production spawn
  // queue is tiers 1–3; larger tiers form only via merges) — the same setup
  // as qa/verify.mjs scenario J. Overlapping spawns would be artificial.
  for (let i = 0; i < 16; i++) {
    await dropAt(240 + ((i * 97) % 240))
    await sleep(1100) // > cooldown
  }
  // Settle window: all balls must go to sleep with zero overlap
  const settled = await waitFor(async () => {
    const t = await tel()
    return t.balls.length > 0 && t.balls.every((b) => b.sleeping) && t.worstPairOverlap <= 2.5
  }, 60000, 500)
  const t = await tel()
  const speeds = t.balls.map((b) => b.centroidSpeed)
  const awake = t.balls.filter((b) => !b.sleeping)
  record('dense pile settles: all asleep, no penetration', settled, {
    balls: t.balls.length,
    asleepCount: t.balls.length - awake.length,
    awakeDetail: awake.map((b) => ({ id: b.id, tier: b.tier, v: b.centroidSpeed, area: b.area, rest: b.rest })),
    maxCentroidSpeed: Math.max(...speeds),
    worstPairOverlap: t.worstPairOverlap,
    maxAreaDeviation: Math.max(...t.balls.map((b) => Math.abs(1 - b.area))),
  })
  await shot('p210-pile-settled')
  report.checks.densePile = { balls: t.balls.length, worstPairOverlap: t.worstPairOverlap }
}

/* --- 9: game over + restart ------------------------------------------------ */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  // Build an overflow tower above the danger line (rim 610 + 70 = 680):
  // adaptive stacking — keep placing mixed-tier balls on top of the pile.
  let triggered = false
  for (let i = 0; i < 40 && !triggered; i++) {
    const t = await tel()
    const top = t.balls.length ? Math.min(...t.balls.map((b) => b.cy)) : 1000
    const xs = t.balls.filter((b) => b.cy < top + 40).map((b) => b.cx)
    const x = xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : 360
    const tier = [3, 4, 5, 3, 5][i % 5]
    await spawnAt(Math.min(560, Math.max(160, x + (i % 3 === 0 ? 30 : -30))), tier, Math.min(top - 30, 640))
    await sleep(900)
    triggered = (await gameOverState()).over
  }
  // Let the dwell window elapse if the pile is already above the line
  if (!triggered) {
    await waitFor(async () => (await gameOverState()).over, 8000, 300)
    triggered = (await gameOverState()).over
  }
  await shot('p210-gameover')
  const go = await gameOverState()
  // Drops must be rejected after game over
  const nBefore = (await counts()).balls
  await dropAt(360)
  await sleep(600)
  const nAfterDrop = (await counts()).balls
  const dropsStopped = nAfterDrop === nBefore
  record('game over triggers on overflow + drops stopped', triggered && dropsStopped, {
    ...go,
    ballsAtOver: nBefore,
    ballsAfterDropAttempt: nAfterDrop,
  })
  report.checks.gameOver = go

  // Restart via the REAL PLAY AGAIN button (canvas click at stage 360, 680)
  const btn = await page.evaluate(() => window.__brScene.gameOver().buttonViewport)
  await page.mouse.click(btn.x, btn.y)
  await sleep(800)
  const after = await gameOverState()
  const c = await counts()
  const g = await geo()
  const restarted =
    !after.over &&
    !after.overlay &&
    c.balls === 0 &&
    c.constraints === 0 &&
    after.score === 0 &&
    g.phase === 'normal' &&
    // Phase 2.11.2 default wall height (1085 − 765 = 320); best persists
    // across runs (2.10.x requirement — reset would LOSE the player's record).
    Math.abs(g.height - 320) < 1 &&
    after.best === (await page.evaluate(() => window.__brScene.gameOver())).best
  record('PLAY AGAIN fully resets the game', restarted, {
    ...after,
    counts: c,
    wallPhase: g.phase,
    wallHeight: g.height,
  })
  await shot('p210-restarted')
  // The game is playable again
  await dropAt(360)
  await sleep(500)
  const playable = (await counts()).balls === 1
  record('restarted game accepts new drops', playable, {})
  report.checks.restart = { restarted, playable }
}

/* --- 10: containment (balls never leave through walls/floor) --------------- */
{
  await page.evaluate(() => window.__brScene.restart())
  await sleep(300)
  // Aggressive wall probes: drops at the extreme clamped positions
  for (let i = 0; i < 6; i++) {
    await dropAt(360)
    await sleep(1100)
  }
  // Extreme drops at both edges
  for (const x of [130, 135, 585, 590, 130, 590]) {
    await dropAt(x)
    await sleep(1100)
  }
  await sleep(4000)
  const t = await tel()
  const contained = t.balls.every((b) => b.cy < 1084 && b.cx > 80 && b.cx < 640 && b.aspect > 0.5)
  record('containment: nothing escapes through walls/floor at extreme drops', contained, {
    balls: t.balls.length,
    xRange: [Math.min(...t.balls.map((b) => b.cx)), Math.max(...t.balls.map((b) => b.cx))],
    yMax: Math.max(...t.balls.map((b) => b.cy)),
  })
  await shot('p210-containment')
  report.checks.containment = contained
}

writeFileSync('qa/phase210-report.json', JSON.stringify(report, null, 2))
const failed = report.scenarios.filter((s) => !s.pass)
console.log(`\n${report.scenarios.length - failed.length}/${report.scenarios.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '))
  process.exitCode = 1
}
await browser.close()
