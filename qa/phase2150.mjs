#!/usr/bin/env node
/**
 * Phase 2.15.0 browser QA.
 *
 *  §1  MERGE SAFETY ZONES NEAR THE OPEN TOP (the reported defect): merges
 *      at/near the open rim teleported their replacements DOWN into the
 *      container interior (up to ~175px for a tier-6) or deferred waiting
 *      for a "safe" below-rim spot. Root cause: the placement clamp floored
 *      every candidate at `top + rNew` — treating above-rim positions as
 *      containment failures — while the physics clamp correctly treats the
 *      open sky above the rim as legal. Fixed by making the placement clamp
 *      agree: floor + slanted wall LINES only, open top.
 *
 *      This suite reproduces the exact user scenario — repeated merges near
 *      the LEFT RIM, CENTER, RIGHT RIM, and in a CROWDED PILE TOUCHING THE
 *      TOP (pile pokes out of the open rim) — and records, per merge:
 *      source positions, replacement position, pending duration, outcome.
 *      Assertions:
 *        - the replacement stays LOCAL (no teleport into the container:
 *          above-rim merges stay above the rim);
 *        - no emergency commits (the aged backstop is never needed);
 *        - pending windows (if any) keep both sources visible;
 *        - every transaction completes with exactly one replacement, with
 *          per-frame accounting (no merge loss);
 *        - game-over never fires from these in-funnel merges.
 *
 * Evidence: qa/screens/p2150/*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2150'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Stage units: container wall-top y (the open rim) at normal height.
const RIM = 765
// Tier rest radii (design px): T4 76, T5 90, T6 106 (+2 contact skin).
const T5_ENV = 92
const T6_ENV = 108

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
const spawn = (x, tier, y) =>
  page.evaluate(({ xx, tt, yy }) => window.__brScene.spawnAt(xx, tt, yy, false), { xx: x, tt: tier, yy: y })
const txs = () => page.evaluate(() => window.__brScene.mergeTransactions())
const locality = () => page.evaluate(() => window.__brScene.mergeLocality())

// ============================================================================
console.log('\n=== §1 Merges near the OPEN TOP — left rim, center, right rim, crowded top ===')

// Each scenario: a stable, CASCADE-FREE pyramid filling the container and
// poking out of the open rim (alternating T2/T3 rows; same-tier balls are
// never within contact range of each other — T2 rows pitch 115 vs. the 108
// contact threshold, T3 rows pitch 135+ vs. 128, same-tier rows 180px
// apart — so the pile never self-merges and nothing rolls off the sides),
// then repeated T5 pairs dropped touching at the named location. The pair
// merges above/near the rim → a T6 replacement (envelope 108; the old clamp
// would have dragged it to y ≥ 873.5, ~110px+ below the rim).
const BASE_ROWS = [
  [1030, 2, [190, 305, 420, 535]],
  [940, 3, [175, 315, 455]],
  [850, 2, [150, 265, 380, 495]],
  [760, 3, [145, 280, 415, 550]],
]
const CROWD_ROWS = [
  [670, 2, [170, 285, 400, 515]],
  [580, 3, [215, 350, 485]],
]

const scenarios = [
  { name: 'left-rim', extraRows: [], pairs: [[215, 640], [215, 560]] },
  { name: 'center', extraRows: [], pairs: [[315, 640], [335, 560]] },
  { name: 'right-rim', extraRows: [], pairs: [[395, 640], [415, 560]] },
  { name: 'crowded-top', extraRows: CROWD_ROWS, pairs: [[305, 470], [355, 430]] },
]

const fillPile = async (extraRows) => {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  for (const [y, tier, xs] of [...BASE_ROWS, ...extraRows]) {
    for (const x of xs) {
      await spawn(x, tier, y)
      await wait(35)
    }
  }
  await wait(2200) // gentle settle (small overlaps only, no cascades by construction)
}

let worstUnaccounted = 0
let emergencyCount = 0
let maxPendingMs = 0
let pendingVisibleSamples = 0
let pendingInvisibleViolations = 0
let gameOverFired = false
const violations = []
const mergeReport = []
let localityMisses = 0
let teleportations = 0
let localityWorst = 0

for (const sc of scenarios) {
  await fillPile(sc.extraRows)
  const topRowY = sc.extraRows.length ? sc.extraRows[sc.extraRows.length - 1][0] : BASE_ROWS[BASE_ROWS.length - 1][0]
  console.log(`  [${sc.name}] pile built — top row y=${topRowY} (rim ${RIM})`)

  for (let d = 0; d < sc.pairs.length; d++) {
    const [ax, ay] = sc.pairs[d]
    const [bx, by] = [ax + 90, ay - 5] // touching T5 pair (env 92 each)
    const idA = await spawn(ax, 5, ay)
    const idB = await spawn(bx, 5, by)
    const pairIds = [idA.id, idB.id]

    // Watch the merge resolve with a tight cadence (the whole point: local
    // and immediate, never the 900ms emergency nor a teleport).
    let lastA = null
    let lastB = null
    let done = false
    let prevBalls = 0
    let prevCompleted = 0
    let first = true
    for (let s = 0; s < 70 && !done; s++) {
      const snap = await page.evaluate((ids) => {
        const state = window.__brScene.visualState()
        const list = window.__brScene.mergeTransactions()
        const rowsOut = []
        for (const t of list) {
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
          completed: list.filter((t) => t.outcome === 'completed').length,
          over: window.__brScene.gameOver().over,
          txs: rowsOut,
          pairGone: ids.every((id) => window.__brScene.ballDetail(id) == null),
          pos: ids.map((id) => {
            const dd = window.__brScene.ballDetail(id)
            return dd ? { x: Math.round(dd.center.pos.x), y: Math.round(dd.center.pos.y) } : null
          }),
        }
      }, pairIds)
      if (snap.over) gameOverFired = true
      if (snap.pos[0]) lastA = snap.pos[0]
      if (snap.pos[1]) lastB = snap.pos[1]
      if (first) {
        prevBalls = snap.balls
        prevCompleted = snap.completed
        first = false
      }
      const newCompleted = snap.completed - prevCompleted
      const drop = prevBalls - snap.balls
      const unaccounted = drop - newCompleted
      if (unaccounted > worstUnaccounted) worstUnaccounted = unaccounted
      if (unaccounted > 0) violations.push(`${sc.name} drop${d} s${s}: drop ${drop} vs ${newCompleted} merges`)
      if (snap.drawn !== snap.balls) violations.push(`${sc.name} drop${d} s${s}: drawn ${snap.drawn} != registry ${snap.balls}`)
      prevBalls = snap.balls
      prevCompleted = snap.completed
      for (const t of snap.txs) {
        if (t.outcome === 'pending') {
          if (t.aState !== 'gone' && t.bState !== 'gone' && t.aDrawn && t.bDrawn) pendingVisibleSamples++
          else {
            pendingInvisibleViolations++
            violations.push(`tx#${t.tx} pending but sources ${t.aState}/${t.bState} drawn=${t.aDrawn}/${t.bDrawn}`)
          }
        }
        if (t.outcome === 'completed') {
          if (t.emergency) emergencyCount++
          if (t.pendingMs > maxPendingMs) maxPendingMs = t.pendingMs
        }
      }
      if (snap.pairGone || snap.over) done = true
      await wait(80)
    }
    // A game-over freeze would swallow any further drop in this scenario —
    // report it and move on (the next scenario restarts the scene).
    if (gameOverFired) break

    // The pair's own transaction + locality record.
    const allTx = await txs()
    const pairTx = allTx.find((t) => pairIds.includes(t.aId) || pairIds.includes(t.bId))
    const loc = await locality()
    let pairLoc = null
    if (pairTx) {
      const mx = lastA && lastB ? (lastA.x + lastB.x) / 2 : ax + 45
      const my = lastA && lastB ? (lastA.y + lastB.y) / 2 : ay - 2.5
      let best = null
      let bestD = 1e9
      for (const l of loc) {
        if (l.tier !== 6) continue
        const dd = Math.hypot(l.cx - mx, l.cy - my)
        if (dd < bestD) {
          bestD = dd
          best = l
        }
      }
      pairLoc = bestD < 120 ? best : null
      if (!pairLoc) localityMisses++
      const mSrc = pairLoc ? { x: pairLoc.cx, y: pairLoc.cy } : { x: mx, y: my }
      const dist = pairLoc ? Math.hypot(pairLoc.x - mSrc.x, pairLoc.y - mSrc.y) : -1
      if (dist > localityWorst) localityWorst = dist
      // The §1 headline assertion: an above-rim merge must NOT be dragged
      // down into the container (the old clamp teleported these to
      // y ≥ RIM + 108.5 = 873.5).
      const aboveRimMerge = mSrc.y < RIM - 10
      const dragged = pairLoc ? pairLoc.y > RIM + 40 : false
      if (dragged && aboveRimMerge) teleportations++
      mergeReport.push(
        `${sc.name} drop${d + 1}: sources #${pairTx.aId}${lastA ? `(${lastA.x},${lastA.y})` : ''} #${pairTx.bId}${lastB ? `(${lastB.x},${lastB.y})` : ''} ` +
          `midpoint(${Math.round(mSrc.x)},${Math.round(mSrc.y)}) → T6 replacement${pairLoc ? `(${Math.round(pairLoc.x)},${Math.round(pairLoc.y)})` : ' (locality record not matched)'} ` +
          `d=${dist >= 0 ? Math.round(dist) : '?'}px pending=${Math.round(pairTx.pendingMs)}ms emergency=${pairTx.emergency} outcome=${pairTx.outcome}` +
          `${pairTx.overlapPx ? ` overlap=${Math.round(pairTx.overlapPx)}px` : ''}`,
      )
      check(
        `[${sc.name} drop${d + 1}] the pair merged — exactly one replacement`,
        pairTx.outcome === 'completed' && pairTx.replacementId != null,
        `pending ${Math.round(pairTx.pendingMs)}ms, replacement #${pairTx.replacementId}`,
      )
      check(
        `[${sc.name} drop${d + 1}] committed locally (no teleport into the container)`,
        pairLoc != null && dist <= 160 && !(aboveRimMerge && dragged),
        pairLoc
          ? `replacement ${Math.round(dist)}px from midpoint${aboveRimMerge ? `, y=${Math.round(pairLoc.y)} (rim ${RIM})` : ''}`
          : 'locality record not matched',
      )
      check(
        `[${sc.name} drop${d + 1}] no emergency delay (aged backstop untouched)`,
        !pairTx.emergency && pairTx.pendingMs <= 250,
        `pending ${Math.round(pairTx.pendingMs)}ms${pairTx.emergency ? ' EMERGENCY' : ''}`,
      )
    } else {
      check(`[${sc.name} drop${d + 1}] the pair produced a transaction`, false, 'no tx found for the pair ids')
    }
    // Budget for the per-run discovery modal on the first T6 (freezes
    // physics ~4s; sim-time pending durations are unaffected).
    await wait(4600)
    await shot(`01-${sc.name}-drop${d + 1}`)
  }
  await wait(400)
}

console.log('\n  --- per-merge record (source positions → replacement position, pending, outcome) ---')
for (const line of mergeReport) console.log(`    ${line}`)

const finalTx = await txs()
const dropped = finalTx.filter((t) => t.outcome === 'dropped')
const badCompleted = finalTx.filter((t) => t.outcome === 'completed' && t.replacementId == null)

check('NO merge loss: every transaction completed with exactly one replacement',
  dropped.length === 0 && badCompleted.length === 0,
  `${finalTx.filter((t) => t.outcome === 'completed').length} completed, ${dropped.length} dropped, worst unaccounted/frame ${worstUnaccounted}`)
check('no emergency commits anywhere in the rim scenarios',
  emergencyCount === 0, emergencyCount === 0 ? 'all resolutions immediate/retry' : `${emergencyCount} aged commits`)
check('worst pending duration stays far below the 900ms emergency deadline',
  maxPendingMs <= 250, `worst ${Math.round(maxPendingMs)}ms`)
check('pending sources stayed visible (both drawn while awaiting the replacement)',
  pendingInvisibleViolations === 0,
  `${pendingVisibleSamples} pending samples, ${pendingInvisibleViolations} invisible`)
check('no teleportation: every above-rim merge stayed above the rim',
  teleportations === 0 && localityMisses === 0,
  `worst locality ${Math.round(localityWorst)}px, ${localityMisses} unmatched locality records`)
check('game-over never fired (every merge stayed inside the funnel)', !gameOverFired,
  gameOverFired ? 'game-over froze a round' : 'clean')
check('per-frame accounting clean', violations.length === 0,
  violations.length ? violations.slice(0, 5).join(' | ') : 'no unaccounted drops, registry == drawn')

await shot('02-final-state')
await browser.close()

console.log(`\n=== §1 RESULT: ${pass} passed, ${fail} failed ===`)
if (fail > 0) {
  console.log('VIOLATIONS:\n' + violations.join('\n'))
  process.exit(1)
}
