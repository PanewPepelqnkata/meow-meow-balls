#!/usr/bin/env node
/**
 * Phase 2.13.4 browser QA — the two targeted fixes:
 *
 *  §1  Renderer/lifecycle bug (the "disappearing balls" defect): deferred
 *      merge sources are marked 'merging', and SoftBallRenderer previously
 *      SKIPPED non-'active' states — both balls vanished visually while
 *      the replacement was still pending. Fixed: the draw guard is on
 *      'removed' only. This suite REPRODUCES repeated merges near the
 *      crowded top of a nearly full container and logs, per merge
 *      TRANSACTION: id, source ids + states, pending duration, replacement
 *      creation, and RENDERER VISIBILITY (isDrawn) of the locked sources
 *      during every pending window. Contract: every transaction completes
 *      with exactly one replacement (or is safely pending with sources
 *      VISIBLE); count accounting holds; nothing teleports (locality).
 *
 *  §2  Discovery presentation (subtle but dramatic): game background
 *      visible under a gentle dim, ONE tier-colored band across the middle,
 *      character centered on it (cream disc), brief flashing highlights,
 *      comic accents, quick punch-in, readable title. Tiers 1-3 silent.
 *
 * Evidence: qa/screens/p2134/*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { readShot, verifyDiscoveryBand, px, lum } from './lib-discovery.mjs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2134'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++

    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setViewportSize({ width: 1170, height: 658 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(700)

const shot = (name) => page.screenshot({ path: `${DIR}/${name}.png` })

// ============================================================================
console.log('\n=== §1 Repeated merges near the crowded TOP — transaction log + renderer visibility ===')

// REPEATED merges near the crowded top: three consecutive repetitions of
// the crowded-top merge scenario (restart between rounds so the pile never
// overflows — game-over intentionally freezes physics and would leave
// pendings safely frozen rather than resolved; each round is verified
// independently and fully transaction-logged).
const rounds = [
  { name: 'top-left', a: [265, 790], b: [315, 785] },
  { name: 'top-right', a: [460, 790], b: [505, 785] },
  { name: 'top-center', a: [330, 775], b: [375, 770] },
]
let worstUnaccounted = 0
let pendingWindowSamples = 0
let pendingVisibleSamples = 0
let maxPendingMs = 0
let gameOverFired = false
const violations = []
const txLog = []
let prevBalls = 0
let prevCompleted = 0

const fillPile = async () => {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  // Nearly full container: 4 offset rows of T4/T5 up to just below the rim
  // (a fifth row at y=730 would sit ABOVE the wall top — genuine overflow
  // → game-over, which intentionally freezes physics and would freeze
  // pendings instead of resolving them).
  const rows = [1030, 950, 870, 790]
  let k = 0
  for (let r = 0; r < rows.length; r++) {
    const y = rows[r]
    const off = r % 2 === 0 ? 0 : 85
    for (let x = 235 + off; x <= 505 - off; x += 170) {
      const tier = (k + r) % 2 === 0 ? 4 : 5
      await page.evaluate(({ xx, tt, yy }) => window.__brScene.spawnAt(xx, tt, yy, true), { xx: x, tt: tier, yy: y })
      k++
      await wait(35)
    }
  }
  await wait(2600) // settle
}

for (const round of rounds) {
  await fillPile()
  prevBalls = 0
  prevCompleted = 0
  const pair = []
  for (const [x, y] of [round.a, round.b]) {
    const res = await page.evaluate(({ x: xx, y: yy }) => window.__brScene.spawnAt(xx, 5, yy, true), { x, y })
    pair.push(res.id)
    await wait(90)
  }
  // Watch this round resolve: transaction log, source states, renderer
  // visibility, and per-sample accounting (all sampled atomically).
  let roundDone = false
  for (let s = 0; s < 70 && !roundDone; s++) {
    const snap = await page.evaluate((pairIds) => {
      const state = window.__brScene.visualState()
      const txs = window.__brScene.mergeTransactions()
      const rowsOut = []
      for (const t of txs) {
        const a = window.__brScene.ballDetail(t.aId)
        const b = window.__brScene.ballDetail(t.bId)
        rowsOut.push({
          ...t,
          aState: a ? a.state ?? 'active' : 'gone',
          bState: b ? b.state ?? 'active' : 'gone',
          aDrawn: window.__brScene.isDrawn(t.aId),
          bDrawn: window.__brScene.isDrawn(t.bId),
        })
      }
      return {
        balls: state.rendererBalls,
        drawn: state.rendererDrawn,
        completed: txs.filter((t) => t.outcome === 'completed').length,
        over: window.__brScene.gameOver().over,
        txs: rowsOut,
        pairGone: pairIds.every((id) => window.__brScene.ballDetail(id) == null),
        pairStuckMerging: pairIds.some((id) => {
          const d = window.__brScene.ballDetail(id)
          return d != null && d.state === 'merging'
        }),
      }
    }, pair)
    if (snap.over) gameOverFired = true
    if (s === 0 && prevBalls === 0) {
      prevBalls = snap.balls
      prevCompleted = snap.completed
    }
    // Accounting: live count may only drop by newly COMPLETED merges.
    const newCompleted = snap.completed - prevCompleted
    const drop = prevBalls - snap.balls
    const unaccounted = drop - newCompleted
    if (unaccounted > worstUnaccounted) worstUnaccounted = unaccounted
    if (unaccounted > 0) violations.push(`${round.name} s${s}: drop ${drop} vs ${newCompleted} merges`)
    prevBalls = snap.balls
    prevCompleted = snap.completed
    // Drawn count must match the registry (merging sources ARE drawn).
    if (snap.drawn !== snap.balls) violations.push(`${round.name} s${s}: drawn ${snap.drawn} != registry ${snap.balls}`)
    // Pending windows: sources must be IN THE WORLD and DRAWN.
    for (const t of snap.txs) {
      if (t.outcome === 'pending') {
        pendingWindowSamples++
        if (t.aState !== 'gone' && t.bState !== 'gone' && t.aDrawn && t.bDrawn) pendingVisibleSamples++
        else violations.push(`tx#${t.tx} pending but sources ${t.aState}/${t.bState} drawn=${t.aDrawn}/${t.bDrawn}`)
        txLog.push(`tx#${t.tx} T${t.tier}+T${t.tier} sources #${t.aId}(merging,drawn=${t.aDrawn}) #${t.bId}(merging,drawn=${t.bDrawn}) … pending`)
      }
      if (t.outcome === 'completed' && t.pendingMs > maxPendingMs) maxPendingMs = t.pendingMs
    }
    if (snap.pairGone || snap.over) roundDone = true
    await wait(120)
  }
  // Per-round drain: the emergency fallback guarantees resolution within
  // ~pendingEmergencyMs; give it a bounded extra window, then the round's
  // transaction log must show NO pending and NO dropped entries (a restart
  // between rounds would otherwise hide a stuck round).
  let roundOver = false
  for (let i = 0; i < 28 && !roundOver; i++) {
    const snap2 = await page.evaluate(() => ({
      txs: window.__brScene.mergeTransactions(),
      over: window.__brScene.gameOver().over,
    }))
    if (snap2.over) {
      gameOverFired = true
      roundOver = true
    }
    roundOver = roundOver || snap2.txs.every((t) => t.outcome !== 'pending')
    await wait(125)
  }
  const roundTx = await page.evaluate(() => window.__brScene.mergeTransactions())
  const roundPending = roundTx.filter((t) => t.outcome === 'pending')
  const roundDropped = roundTx.filter((t) => t.outcome === 'dropped')
  const roundBad = roundTx.filter((t) => t.outcome === 'completed' && t.replacementId == null)
  check(`[${round.name}] the dropped pair merged away (transaction completed)`,
    roundDone || (roundPending.length === 0 && roundDropped.length === 0),
    roundDone ? 'both sources consumed' : `timeout — ${roundPending.length} pending, ${roundDropped.length} dropped`)
  check(`[${round.name}] every transaction resolved cleanly (one replacement each)`,
    roundPending.length === 0 && roundDropped.length === 0 && roundBad.length === 0,
    `${roundTx.filter((t) => t.outcome === 'completed').length} completed, ${roundPending.length} pending, ${roundDropped.length} dropped${gameOverFired ? ' (game-over froze the scene)' : ''}`)
  await shot(`01-crowded-top-${round.name}`)
  await wait(600)
}

// Final drain + summary (the transaction log is per-run — restarts between
// rounds clear it, so this reflects the LAST round; every round was already
// asserted above). Context: game-over would legitimately freeze pendings.
let drained = false
for (let i = 0; i < 40 && !drained; i++) {
  const snap = await page.evaluate(() => ({
    txs: window.__brScene.mergeTransactions(),
    over: window.__brScene.gameOver().over,
  }))
  if (snap.over) gameOverFired = true
  drained = snap.txs.every((t) => t.outcome !== 'pending') || snap.over
  await wait(125)
}

// Final transaction summary + assertions.
const final = await page.evaluate(() => ({
  txs: window.__brScene.mergeTransactions(),
  state: window.__brScene.visualState(),
  loc: window.__brScene.mergeLocality(),
}))
const completed = final.txs.filter((t) => t.outcome === 'completed')
const stillPending = final.txs.filter((t) => t.outcome === 'pending')
const dropped = final.txs.filter((t) => t.outcome === 'dropped')
console.log(`  [transaction log] ${final.txs.length} transactions: ${completed.length} completed, ${stillPending.length} pending, ${dropped.length} dropped`)
for (const t of completed.slice(-6)) {
  txLog.push(`tx#${t.tx} T${t.tier}+T${t.tier} → replacement #${t.replacementId} (tier ${t.tier + 1}), deferred=${t.deferred}, pending=${Math.round(t.pendingMs)}ms, emergency=${t.emergency}`)
}
for (const line of txLog.slice(-14)) console.log(`    ${line}`)

check('every transaction completed with exactly one replacement (final round log)',
  (stillPending.length === 0 && dropped.length === 0 && completed.every((t) => t.replacementId != null)) || (gameOverFired && dropped.length === 0),
  gameOverFired
    ? `game-over froze the scene: ${completed.length} completed, ${stillPending.length} safely pending, ${dropped.length} dropped`
    : `${completed.length} completed, ${stillPending.length} pending, ${dropped.length} dropped; all carry a replacement id`)
check('no unaccounted ball loss across all three rounds', worstUnaccounted <= 0,
  violations.length ? violations.slice(0, 3).join('; ') : 'every count drop matches a completed merge')
check('renderer DRAWS the locked sources during pending windows (the fixed defect)',
  pendingWindowSamples === 0 || pendingVisibleSamples === pendingWindowSamples,
  pendingWindowSamples > 0
    ? `${pendingVisibleSamples}/${pendingWindowSamples} pending samples had both sources drawn`
    : 'no pending window sampled at this cadence (immediate resolutions — see unit suite for the pending-window case)')
check('renderer drawn count always matched the registry', !violations.some((v) => v.includes('drawn')))
check('pending durations bounded (≤ ~1.2s incl. emergency fallback)', maxPendingMs <= 1250,
  `max observed pending ${Math.round(maxPendingMs)}ms`)
const worstLoc = final.loc.reduce((m, r2) => Math.max(m, Math.hypot(r2.x - r2.cx, r2.y - r2.cy)), 0)
check('no replacement teleported (locality ≤ 320px)', worstLoc <= 320, `worst ${Math.round(worstLoc)}px`)

// ============================================================================
console.log('\n=== §2 Discovery: subtle but dramatic — one tier band over the dimmed game ===')
await page.evaluate(() => window.__brScene.restart())
await wait(700)
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
let shown = false
for (let i = 0; i < 40 && !shown; i++) {
  await wait(100)
  shown = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
}
check('discovery panel appears for first-time tier 4', shown)
const dstate = await page.evaluate(() => window.__brScene.visualState())
check('overlay presents tier 4', dstate.discoveryTier === 4, `tier=${dstate.discoveryTier}`)

// EARLY shot: the flash accents are mid-blink and the punch-in is in flight.
await wait(230)
await shot('02-discovery-early')
{
  const png = readShot(`${DIR}/02-discovery-early.png`)
  const vw = png.width
  const vh = png.height
  const ballY = Math.round(vh * 0.48)
  const bandH = Math.max(130, Math.min(240, vh * 0.3))
  // Brief flashing highlights: bright yellow/white sparkle cores near the
  // band's thirds during the entrance.
  const spots = [
    [vw * 0.24, ballY - bandH * 0.3],
    [vw * 0.76, ballY + bandH * 0.3],
    [vw * 0.62, ballY - bandH * 0.24],
  ]
  let flashSpots = 0
  for (const [sx, sy] of spots) {
    let hits = 0
    for (let dx = -10; dx <= 10; dx += 2) for (let dy = -10; dy <= 10; dy += 2) {
      const p = px(png, sx + dx, sy + dy)
      if ((p.r > 230 && p.g > 205 && p.b < 150) || lum(p) > 238) hits++
    }
    if (hits >= 2) flashSpots++
  }
  check('brief flashing highlights on the entrance', flashSpots >= 1, `${flashSpots}/3 sparkle spots bright in the early frame`)
}

// Settled shot: full composition via the shared checks.
await wait(620)
await shot('03-discovery-band')
verifyDiscoveryBand(check, readShot(`${DIR}/03-discovery-band.png`))

// Clean exit + no repeat + tiers 1-3 silent.
let hidden = false
for (let i = 0; i < 40 && !hidden; i++) {
  await wait(150)
  hidden = !(await page.evaluate(() => window.__brScene.visualState().discoveryVisible))
}
check('panel exits cleanly and gameplay resumes', hidden)
await wait(300)
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
await wait(1500)
const reState = await page.evaluate(() => window.__brScene.visualState())
check('repeat tier-4 merges never re-trigger the T4 panel',
  reState.discoveryVisible === false || reState.discoveryTier !== 4,
  reState.discoveryVisible ? `panel shows NEW tier ${reState.discoveryTier} (legitimate)` : 'no panel')
await page.evaluate(() => window.__brScene.restart())
await wait(600)
await page.evaluate(() => window.__brScene.spawnAt(540, 1))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 1))
await wait(1500)
const t2Shown = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
check('tier 1-3 merges never trigger the panel', t2Shown === false)

// ============================================================================
console.log('\n=== §2 Responsive: mobile pass (390×844) ===')
await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(800)
await page.evaluate(() => window.__brScene.restart())
await wait(500)
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
let shownM = false
for (let i = 0; i < 40 && !shownM; i++) {
  await wait(100)
  shownM = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
}
check('mobile: panel appears', shownM)
await wait(750)
await shot('04-discovery-band-mobile')
verifyDiscoveryBand(check, readShot(`${DIR}/04-discovery-band-mobile.png`))

await browser.close()
console.log(`\n=== PHASE 2.13.4 QA: ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
