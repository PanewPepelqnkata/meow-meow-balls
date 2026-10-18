#!/usr/bin/env node
/**
 * Phase 2.14.0 browser QA.
 *
 *  §1  MERGE DELAY (the reported defect): crowded merges visibly waited the
 *      full 900ms emergency deadline before the replacement appeared. Fixed
 *      by the no-swallow immediate-commit policy: a fresh merge commits on
 *      the frame it fires whenever the least-penetrating local candidate
 *      keeps both centers outside each other's envelopes. This suite
 *      reproduces the exact user scenario — repeated merges at the crowded
 *      top of a nearly full container — plus a deep interior merge, and
 *      asserts through the transaction log:
 *        - the dropped pairs' transactions complete within a few frames
 *          and NEVER reach the emergency deadline;
 *        - no emergency commits anywhere in the below-rim pile;
 *        - immediate overlap commits obey the no-swallow bound;
 *        - every transaction completes with exactly one replacement, no
 *          unaccounted loss, renderer visibility intact, no teleports.
 *
 *  §2/§3 (start screen + persistence) are appended below once implemented.
 *
 * Evidence: qa/screens/p2140/*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2140'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Tier rest radii (design px) for the no-swallow bound: an overlap commit
// must never exceed the replacement's own radius (+2px float kindness).
const TIER_RADIUS = { 4: 76, 5: 90, 6: 106, 7: 130, 8: 165, 9: 205 }

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
console.log('\n=== §1 Merge immediacy — repeated merges at the crowded TOP of a nearly full container ===')

// Same scenario family as phase 2.13.4 QA: nearly full container (4 offset
// rows of T4/T5 up to just below the rim), then a touching T5 pair dropped
// onto the crowded top. Restart between rounds keeps the pile below the rim
// (game-over would intentionally freeze physics).
const rounds = [
  { name: 'top-left', a: [265, 790], b: [315, 785] },
  { name: 'top-right', a: [460, 790], b: [505, 785] },
  { name: 'top-center', a: [330, 775], b: [375, 770] },
]

const fillPile = async () => {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
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

let worstUnaccounted = 0
let pendingWindowSamples = 0
let pendingVisibleSamples = 0
let maxPendingMs = 0
let maxPairPendingMs = 0
let maxOverlap = { px: 0, tx: 0 }
let emergencyCount = 0
let gameOverFired = false
const violations = []
const txLog = []

for (const round of rounds) {
  await fillPile()
  const pair = []
  for (const [x, y] of [round.a, round.b]) {
    const res = await page.evaluate(({ x: xx, y: yy }) => window.__brScene.spawnAt(xx, 5, yy, true), { x, y })
    pair.push(res.id)
    await wait(90)
  }
  // Watch this round resolve with a TIGHT cadence (the whole point: the
  // replacement must appear within a few frames, not 900ms).
  let roundDone = false
  let prevBalls = 0
  let prevCompleted = 0
  let first = true
  for (let s = 0; s < 60 && !roundDone; s++) {
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
    if (first) {
      prevBalls = snap.balls
      prevCompleted = snap.completed
      first = false
    }
    const newCompleted = snap.completed - prevCompleted
    const drop = prevBalls - snap.balls
    const unaccounted = drop - newCompleted
    if (unaccounted > worstUnaccounted) worstUnaccounted = unaccounted
    if (unaccounted > 0) violations.push(`${round.name} s${s}: drop ${drop} vs ${newCompleted} merges`)
    prevBalls = snap.balls
    prevCompleted = snap.completed
    if (snap.drawn !== snap.balls) violations.push(`${round.name} s${s}: drawn ${snap.drawn} != registry ${snap.balls}`)
    for (const t of snap.txs) {
      if (t.outcome === 'pending') {
        pendingWindowSamples++
        if (t.aState !== 'gone' && t.bState !== 'gone' && t.aDrawn && t.bDrawn) pendingVisibleSamples++
        else violations.push(`tx#${t.tx} pending but sources ${t.aState}/${t.bState} drawn=${t.aDrawn}/${t.bDrawn}`)
        txLog.push(`tx#${t.tx} T${t.tier}+T${t.tier} sources #${t.aId}(merging,drawn=${t.aDrawn}) #${t.bId}(merging,drawn=${t.bDrawn}) … pending ${Math.round(t.pendingMs)}ms`)
      }
      if (t.outcome === 'completed') {
        const isPairTx = pair.includes(t.aId) || pair.includes(t.bId)
        if (isPairTx) maxPairPendingMs = Math.max(maxPairPendingMs, t.pendingMs)
        if (t.pendingMs > maxPendingMs) maxPendingMs = t.pendingMs
        if (t.emergency) emergencyCount++
        if (t.overlapPx > maxOverlap.px) maxOverlap = { px: t.overlapPx, tx: t.tx }
      }
    }
    if (snap.pairGone || snap.over) roundDone = true
    await wait(80)
  }
  // Bounded drain: the round must fully resolve (the aged guarantee is the
  // final backstop — but with the fix it should never be needed here).
  let roundOver = false
  for (let i = 0; i < 24 && !roundOver; i++) {
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
  const roundEmergency = roundTx.filter((t) => t.outcome === 'completed' && t.emergency)
  check(`[${round.name}] the dropped pair merged away (transaction completed)`,
    roundDone || (roundPending.length === 0 && roundDropped.length === 0),
    roundDone ? 'both sources consumed' : `timeout — ${roundPending.length} pending`)
  check(`[${round.name}] every transaction resolved cleanly (one replacement each)`,
    roundPending.length === 0 && roundDropped.length === 0 && roundBad.length === 0,
    `${roundTx.filter((t) => t.outcome === 'completed').length} completed, ${roundPending.length} pending, ${roundDropped.length} dropped${gameOverFired ? ' (game-over froze the scene)' : ''}`)
  check(`[${round.name}] no emergency commits (aged backstop untouched)`,
    roundEmergency.length === 0,
    roundEmergency.length === 0 ? 'all resolutions immediate/retry' : `${roundEmergency.length} aged commits`)
  await shot(`01-crowded-top-${round.name}`)
  await wait(500)
}

// Final transaction summary + the immediacy contract.
const final = await page.evaluate(() => ({
  txs: window.__brScene.mergeTransactions(),
  state: window.__brScene.visualState(),
  loc: window.__brScene.mergeLocality(),
}))
const completed = final.txs.filter((t) => t.outcome === 'completed')
console.log(`  [transaction log] ${final.txs.length} transactions, ${completed.length} completed`)
for (const t of completed.slice(-8)) {
  txLog.push(`tx#${t.tx} T${t.tier}+T${t.tier} → #${t.replacementId} (T${t.tier + 1}), pending=${Math.round(t.pendingMs)}ms, overlap=${Math.round(t.overlapPx)}px, emergency=${t.emergency}`)
}
for (const line of txLog.slice(-12)) console.log(`    ${line}`)

check('THE CONTRACT: the dropped pairs never waited (≤ 250ms, sim time)',
  maxPairPendingMs <= 250,
  `worst pair pending ${Math.round(maxPairPendingMs)}ms`)
check('no transaction reached the emergency deadline (≤ 250ms worst overall)',
  maxPendingMs <= 250 && emergencyCount === 0,
  `worst pending ${Math.round(maxPendingMs)}ms, ${emergencyCount} emergency commits`)
check('immediate overlap commits obey the no-swallow bound',
  maxOverlap.px <= (TIER_RADIUS[6] ?? 0) + 2 || maxOverlap.px <= 108,
  `worst overlap ${Math.round(maxOverlap.px)}px (tx#${maxOverlap.tx}) vs tier envelope ≤ ~108px`)
check('no unaccounted ball loss across all three rounds', worstUnaccounted <= 0,
  violations.length ? violations.slice(0, 3).join('; ') : 'every count drop matches a completed merge')
check('renderer drawn count always matched the registry', !violations.some((v) => v.includes('drawn')))
check('pending sources stayed visible (if any pending window sampled)',
  pendingWindowSamples === 0 || pendingVisibleSamples === pendingWindowSamples,
  pendingWindowSamples > 0 ? `${pendingVisibleSamples}/${pendingWindowSamples} samples visible` : 'no pending windows — all immediate')
const worstLoc = final.loc.reduce((m, r2) => Math.max(m, Math.hypot(r2.x - r2.cx, r2.y - r2.cy)), 0)
check('no replacement teleported (locality ≤ 320px)', worstLoc <= 320, `worst ${Math.round(worstLoc)}px`)

// ============================================================================
console.log('\n=== §1b Deep interior merge — resolves bounded, no loss, sources visible ===')

await fillPile()
// A pair wedged DEEP inside the pile (below the top row). Whatever policy
// path it takes (immediate or brief retry), it must resolve with one
// replacement and no unaccounted loss.
const deepPair = []
for (const [x, y] of [[255, 950], [300, 950]]) {
  const res = await page.evaluate(({ x: xx, y: yy }) => window.__brScene.spawnAt(xx, 5, yy, true), { x, y })
  deepPair.push(res.id)
  await wait(90)
}
let deepResolved = false
let deepPendingVisible = 0
let deepPendingTotal = 0
for (let s = 0; s < 80 && !deepResolved; s++) {
  const snap = await page.evaluate((pairIds) => {
    const txs = window.__brScene.mergeTransactions()
    let pendingVis = 0
    let pendingTot = 0
    for (const t of txs) {
      if (t.outcome === 'pending') {
        pendingTot++
        const a = window.__brScene.isDrawn(t.aId)
        const b = window.__brScene.isDrawn(t.bId)
        if (a && b) pendingVis++
      }
    }
    return {
      over: window.__brScene.gameOver().over,
      pending: pendingTot,
      pendingVis,
      pairGone: pairIds.every((id) => window.__brScene.ballDetail(id) == null),
      worstPending: Math.max(0, ...txs.filter((t) => t.outcome === 'completed').map((t) => t.pendingMs)),
      anyDropped: txs.some((t) => t.outcome === 'dropped'),
    }
  }, deepPair)
  deepPendingTotal += snap.pending
  deepPendingVisible += snap.pendingVis
  if (snap.over || snap.pairGone) deepResolved = true
  await wait(100)
}
const deepTx = await page.evaluate(() => window.__brScene.mergeTransactions())
const deepDone = deepTx.filter((t) => t.outcome === 'completed')
const deepWorst = Math.max(0, ...deepDone.map((t) => t.pendingMs))
check('deep interior merge resolved (pair consumed or game-over)', deepResolved,
  deepResolved ? 'pair gone' : 'still present')
check('deep merge resolved bounded (≤ ~1.2s worst case)', deepWorst <= 1250,
  `worst pending ${Math.round(deepWorst)}ms`)
check('deep merge: nothing dropped, every completion has a replacement',
  !deepTx.some((t) => t.outcome === 'dropped') && deepDone.every((t) => t.replacementId != null),
  `${deepDone.length} completed`)
check('deep merge: pending sources (if any) stayed drawn',
  deepPendingTotal === 0 || deepPendingVisible === deepPendingTotal,
  deepPendingTotal > 0 ? `${deepPendingVisible}/${deepPendingTotal} samples visible` : 'immediate')
await shot('02-deep-interior')

await browser.close()
console.log(`\n=== PHASE 2.14.0 QA (§1): ${pass} passed, ${fail} failed ===`)
if (fail > 0) process.exit(1)
