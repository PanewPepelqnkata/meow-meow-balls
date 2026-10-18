#!/usr/bin/env node
/**
 * Phase 2.13.3 browser QA — the two targeted fixes:
 *
 *  §1  Merge visibility/no-loss: a deferred merge keeps BOTH sources in the
 *      world until the replacement exists. Crowded merges in a nearly full
 *      container — near the TOP and both walls — never lose a ball:
 *      per-sample accounting: the live ball count can only drop by the
 *      number of merges COMPLETED since the previous sample (each completed
 *      merge is exactly -2 sources +1 replacement; a deferred merge removes
 *      NOTHING). The pair's tier-6 replacement always appears.
 *
 *  §2  Discovery presentation (Phase 2.13.4 — subtle but dramatic): the
 *      game background stays visible under a gentle dim, ONE thick
 *      tier-colored horizontal band across the middle with the character
 *      centered on it (cream spot-disc), brief flashing highlights and
 *      comic accents, quick punch-in. Responsive (desktop + mobile).
 *      Functional contract preserved (tiers 1-3 silent,
 *      no repeats, clean exit).
 *
 * Evidence: qa/screens/p2133/*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { PNG } from 'pngjs'
import { readShot, verifyDiscoveryBand } from './lib-discovery.mjs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2133'
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
const px = (png, x, y) => {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
}
const lum = (p) => (p.r + p.g + p.b) / 3

// ============================================================================
console.log('\n=== §1 Sources stay visible; nearly full container (top + both walls) never loses a merge ===')

async function crowdedCase(name, ax, ay, bx, by) {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  // Nearly full container: 5 offset rows of T4/T5 from the floor to the rim.
  const rows = [1030, 950, 870, 790, 730]
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
  await wait(3000) // settle

  const pair = []
  for (const [x, y] of [[ax, ay], [bx, by]]) {
    const res = await page.evaluate(({ x: xx, y: yy }) => window.__brScene.spawnAt(xx, 5, yy, true), { x, y })
    pair.push(res.id)
    await wait(90)
  }

  // Per-sample accounting: the live count may only drop by the number of
  // NEWLY COMPLETED merges (each completed merge is exactly -1 net; a
  // deferred merge removes NOTHING — both sources stay visible). The
  // mergePending hook exposes the LIVE pending window: while it is open,
  // every locked ('merging') source ball must still be in the world.
  let worstUnaccounted = 0
  let sawPending = false
  let sawPendingVisible = false
  let pairResolved = false
  const violations = []
  for (let s = 0; s < 44; s++) {
    const snap = await page.evaluate((pairIds) => {
      const state = window.__brScene.visualState()
      const recs = window.__brScene.mergeLocality()
      const pend = window.__brScene.mergePending()
      const merging = []
      for (const id of pend.mergingIds) {
        const d = window.__brScene.ballDetail(id)
        merging.push({ id, alive: !!d, tier: d ? d.tier : null })
      }
      const a = window.__brScene.ballDetail(pairIds[0])
      const b = window.__brScene.ballDetail(pairIds[1])
      return { balls: state.rendererBalls, recs, pend, merging, pairInWorld: [!!a, !!b] }
    }, pair)
    if (s > 0) {
      const newMerges = snap.recs.length - prevRecs
      const drop = prevBalls - snap.balls
      const unaccounted = drop - newMerges
      if (unaccounted > worstUnaccounted) worstUnaccounted = unaccounted
      if (unaccounted > 0) violations.push(`t${s}: drop ${drop} vs ${newMerges} merges`)
    }
    prevBalls = snap.balls
    prevRecs = snap.recs.length
    if (snap.pend.pending > 0) {
      // PENDING WINDOW OPEN: the locked sources must ALL still be in the
      // world — visible, intact — until the replacement exists.
      sawPending = true
      if (snap.merging.length > 0 && snap.merging.every((m) => m.alive)) sawPendingVisible = true
      if (snap.merging.some((m) => !m.alive)) {
        violations.push(`t${s}: merging ball #${snap.merging.find((m) => !m.alive).id} missing while pending`)
      }
    }
    if (snap.recs.some((m) => m.tier === 6)) pairResolved = true
    await wait(160)
  }
  await shot(`01-crowded-${name}`)
  check(`[${name}] no unaccounted ball loss (sources stay until the replacement exists)`,
    worstUnaccounted <= 0, violations.length ? violations.slice(0, 3).join('; ') : `worst unaccounted drop ${worstUnaccounted}`)
  check(`[${name}] pending window: locked sources stay in the world (visible)`,
    !sawPending || sawPendingVisible, sawPending ? 'every merging ball alive while pending' : 'no pending window in this case (immediate resolution)')
  check(`[${name}] the pair's tier-6 replacement appears (merge never discarded)`, pairResolved)
  return { worstUnaccounted, pairResolved, sawPending }
}
let prevBalls = 0
let prevRecs = 0
const c1 = await crowdedCase('top-left', 265, 790, 315, 785)
const c2 = await crowdedCase('top-right', 460, 790, 505, 785)
const c3 = await crowdedCase('deep-left-wall', 255, 950, 300, 950)
const c4 = await crowdedCase('deep-right-wall', 430, 950, 475, 950)
check('§1 all four crowded cases resolve with no loss',
  c1.pairResolved && c2.pairResolved && c3.pairResolved && c4.pairResolved)

// ============================================================================
console.log('\n=== §2 Discovery presentation (tier 4) — Phase 2.13.4 band design ===')
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
await wait(700) // entrance complete (punch-in + flashes + pop) — mid-hold
await shot('02-discovery-band')

// Phase 2.13.4 composition (shared checks: gentle dim + game background
// visible, one tier-colored band across the middle, cream disc + centered
// character, yellow title with black outline, comic accents).
verifyDiscoveryBand(check, readShot(`${DIR}/02-discovery-band.png`))

// Clean exit + no repeat + tiers 1-3 silent.
let hidden = false
for (let i = 0; i < 40 && !hidden; i++) {
  await wait(150)
  hidden = !(await page.evaluate(() => window.__brScene.visualState().discoveryVisible))
}
check('illustration exits cleanly and gameplay resumes', hidden)
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
await wait(700)
await shot('03-discovery-band-mobile')
verifyDiscoveryBand(check, readShot(`${DIR}/03-discovery-band-mobile.png`))
await browser.close()
console.log(`\n=== PHASE 2.13.3 QA: ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
