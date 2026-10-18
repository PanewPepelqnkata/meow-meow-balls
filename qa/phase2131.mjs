#!/usr/bin/env node
/**
 * Phase 2.13.1 — full browser QA suite.
 *
 * Verifies in the REAL running game (not source presence):
 *  §1 space theme has no concentric-circle/target rings (pixel ring scan)
 *  §3 discovery reveal (Phase 2.13.4: one tier-colored band over the
 *     gently dimmed game background — shared checks in lib-discovery.mjs)
 *  §4 progression starts with tiers 1-3 unlocked
 *  §5 weighted spawning (statistical sampling via queueInfo across restarts)
 *  §6 jungle theme cohesion (center clear, full coverage, desktop + mobile)
 *  §7 Raise Walls is one-use (activation consumes it; re-presses during and
 *     after the cycle never re-raise; restart restores)
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { PNG } from 'pngjs'
import { readShot, verifyDiscoveryBand } from './lib-discovery.mjs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const DIR = 'qa/screens/p2131'
fs.mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setViewportSize({ width: 1170, height: 658 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(700)

let failures = 0
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function shot(name) {
  await page.screenshot({ path: `${DIR}/${name}.png` })
}

/** Read a pixel from a screenshot buffer. */
function px(png, x, y) {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
}

// ============================================================================
console.log('\n=== §4 Tier progression starts with 1-3 unlocked ===')
await page.evaluate(() => window.__brScene.restart())
await wait(700)
let unlocked = await page.evaluate(() => window.__brScene.progressionUnlocked())
check('tiers 1-3 unlocked from the very first session', JSON.stringify(unlocked) === '[1,2,3]', JSON.stringify(unlocked))
await shot('01-progression-123')
// Merging into T2/T3 must NOT fire a discovery (they're known)…
const preDiscovery = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
check('no discovery overlay before any T4+ merge', preDiscovery === false)

console.log('\n=== §3 Comic-book discovery reveal (tier 4) ===')
// Real T3 pair merge → first-time T4 → comic reveal.
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
// Wait until the overlay is up, then capture mid-reveal (~600ms in).
let shown = false
for (let i = 0; i < 40 && !shown; i++) {
  await wait(100)
  shown = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
}
check('discovery overlay appears for first-time tier 4', shown)
await wait(500) // mid-hold: comic illustration slammed in, character popped
await shot('02-discovery-reveal')
const dstate = await page.evaluate(() => window.__brScene.visualState())
check('overlay is presenting tier 4', dstate.discoveryTier === 4, `tier=${dstate.discoveryTier}`)

// Pixel analysis of the reveal — Phase 2.13.4 composition (shared checks:
// game background visible under a gentle dim, one tier-colored band across
// the middle, cream disc + centered character, yellow title with black
// outline, comic accents).
verifyDiscoveryBand(check, readShot(`${DIR}/02-discovery-reveal.png`))
// Clean exit: overlay auto-hides and gameplay resumes.
let hidden = false
for (let i = 0; i < 40 && !hidden; i++) {
  await wait(150)
  hidden = !(await page.evaluate(() => window.__brScene.visualState().discoveryVisible))
}
check('overlay exits cleanly and gameplay resumes', hidden)
await wait(400)
// Second T4 (from another pair) must NOT re-trigger a T4 reveal. Note the
// first T4 still sits on the pile, so the new T4 may merge into a T5 — a
// legitimate NEW discovery. The requirement is: no REPEAT of tier 4.
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
await wait(1500)
const reState = await page.evaluate(() => window.__brScene.visualState())
check('repeat tier-4 merges never re-trigger the T4 reveal',
  reState.discoveryVisible === false || reState.discoveryTier !== 4,
  reState.discoveryVisible ? `overlay shows NEW tier ${reState.discoveryTier} (T4+T4→T5 — legitimate)` : 'no overlay')
// Tiers 1-3 never trigger: merge a T1 pair — no overlay (T2 known).
await page.evaluate(() => window.__brScene.restart())
await wait(600)
await page.evaluate(() => window.__brScene.spawnAt(540, 1))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 1))
await wait(1500)
const t2Shown = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
check('tier 1-3 merges never trigger the reveal', t2Shown === false)

console.log('\n=== §5 Weighted spawning (statistical, real queue) ===')
// Each restart draws 2 fresh queue tiers (current + next). Sample 120
// restarts = 240 draws and compare against 40/30/20/10 (tolerance for a
// 240-sample binomial, plus strict rarity ordering).
const counts = { 1: 0, 2: 0, 3: 0, 4: 0, other: 0 }
for (let i = 0; i < 120; i++) {
  await page.evaluate(() => window.__brScene.restart())
  const q = await page.evaluate(() => window.__brScene.queueInfo())
  for (const slot of [q.current.tier, q.next.tier]) {
    if (slot >= 1 && slot <= 4) counts[slot]++
    else counts.other++
  }
}
const total = 240
const f = (t) => counts[t] / total
check('no tier 5-10 ever spawns from the queue', counts.other === 0, JSON.stringify(counts))
check('tier 1 is the most common', f(1) > f(2) && f(1) > f(3) && f(1) > f(4), `${(f(1) * 100).toFixed(1)}%`)
check('distribution ≈ 40/30/20/10 (±11pp)',
  Math.abs(f(1) - 0.4) < 0.11 && Math.abs(f(2) - 0.3) < 0.11 && Math.abs(f(3) - 0.2) < 0.11 && Math.abs(f(4) - 0.1) < 0.08,
  `observed ${(f(1) * 100).toFixed(1)}/${(f(2) * 100).toFixed(1)}/${(f(3) * 100).toFixed(1)}/${(f(4) * 100).toFixed(1)}%`)
check('strict rarity ordering 1 > 2 > 3 > 4', f(1) > f(2) && f(2) > f(3) && f(3) > f(4))
// The preview shows the ACTUAL next queued ball (distinct seeds/tiers).
await page.evaluate(() => window.__brScene.restart())
await wait(500)
const q2 = await page.evaluate(() => window.__brScene.queueInfo())
check('two-slot queue intact (crane current + preview next)',
  q2.current != null && q2.next != null && q2.swapUsed === false && q2.raiseUsed === false,
  JSON.stringify(q2))

console.log('\n=== §7 Raise Walls is a ONE-USE ability ===')
await page.evaluate(() => window.__brScene.restart())
await wait(700)
let info = await page.evaluate(() => window.__brScene.queueInfo())
let uiUsed = await page.evaluate(() => window.__brScene.abilityRaiseUsed())
const baseHeight = (await page.evaluate(() => window.__brScene.wallGeometry())).height
check('fresh run: raise available (game + UI)', info.raiseUsed === false && uiUsed === false)
// Activate via keyboard.
await page.keyboard.press('KeyE')
await wait(250)
let geo = await page.evaluate(() => window.__brScene.wallGeometry())
info = await page.evaluate(() => window.__brScene.queueInfo())
uiUsed = await page.evaluate(() => window.__brScene.abilityRaiseUsed())
check('E activates the walls (raising/raised)', geo.phase === 'raising' || geo.phase === 'raised', `phase=${geo.phase}`)
check('use is consumed IMMEDIATELY (game + UI button)', info.raiseUsed === true && uiUsed === true)
await shot('03-raise-consumed')
// Repeated activation attempts while raised: keyboard + button clicks.
const centers = await page.evaluate(() => window.__brScene.uiPositions())
const raiseBtn = centers.abilities[1]
let maxHeight = geo.height
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('KeyE')
  if (raiseBtn) await page.mouse.click(raiseBtn.x, raiseBtn.y)
  await wait(700)
  const g2 = await page.evaluate(() => window.__brScene.wallGeometry())
  maxHeight = Math.max(maxHeight, g2.height)
}
geo = await page.evaluate(() => window.__brScene.wallGeometry())
check('repeated E/button presses never re-raise or stack', geo.phase === 'raised' && Math.abs(geo.height - maxHeight) < 2,
  `phase=${geo.phase} height=${Math.round(geo.height)} maxHeight=${Math.round(maxHeight)}`)
check('still marked USED while raised', (await page.evaluate(() => window.__brScene.queueInfo())).raiseUsed === true)
// Wait for the full cycle back to 'normal' (900 raise + 25s hold + 900 lower).
console.log('  …waiting out the 25s raised hold…')
let back = false
for (let i = 0; i < 130; i++) {
  await wait(300)
  const g3 = await page.evaluate(() => window.__brScene.wallGeometry())
  if (g3.phase === 'normal') { back = true; break }
}
check('walls return to normal after the cycle', back)
info = await page.evaluate(() => window.__brScene.queueInfo())
uiUsed = await page.evaluate(() => window.__brScene.abilityRaiseUsed())
check('ability stays USED after the walls lower (game + UI)', info.raiseUsed === true && uiUsed === true)
// Post-cycle re-activation attempts all fail.
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('KeyE')
  if (raiseBtn) await page.mouse.click(raiseBtn.x, raiseBtn.y)
  await wait(400)
}
geo = await page.evaluate(() => window.__brScene.wallGeometry())
check('NO re-activation after the cycle (walls stay down)',
  geo.phase === 'normal' && Math.abs(geo.height - baseHeight) < 4,
  `phase=${geo.phase} height=${Math.round(geo.height)} base=${Math.round(baseHeight)}`)
// Restart restores the one charge.
await page.evaluate(() => window.__brScene.restart())
await wait(700)
info = await page.evaluate(() => window.__brScene.queueInfo())
uiUsed = await page.evaluate(() => window.__brScene.abilityRaiseUsed())
check('genuinely new run restores the charge (game + UI)', info.raiseUsed === false && uiUsed === false)
await page.keyboard.press('KeyE')
await wait(250)
geo = await page.evaluate(() => window.__brScene.wallGeometry())
check('restored charge works once again', geo.phase === 'raising' || geo.phase === 'raised', `phase=${geo.phase}`)
await page.evaluate(() => window.__brScene.restart())
await wait(500)

console.log('\n=== §1+§6 Themes: space rings removed, jungle refined ===')
// Space: scan for concentric rings — sample luminance along radial lines
// from each nebula center; a ring pattern shows strong periodic peaks, a
// soft cloud decays monotonically. Simpler robust proxy: no pixel row/col
// far from stars should oscillate with ring contrast > threshold.
await page.evaluate(() => window.__brScene.setTheme('space'))
await wait(1200)
await shot('04-theme-space')
const space = PNG.sync.read(fs.readFileSync(`${DIR}/04-theme-space.png`))
// Pixel analysis: a VISIBLE ring edge (the old concentric-circle targets)
// is a hard luminance step a viewer can actually see. The old glow() stacked
// 7 hard circle edges per nebula side; the new softGlow haze ramps ~1-3 lum
// per sample. The 42px background grid (alpha 0.22 → +6 lum lines) is
// excluded by lattice position; stars are excluded by brightness and a
// horizontal 3-sample median.
const GRID = 42
const nearGrid = (v) => {
  const m = ((v % GRID) + GRID) % GRID
  return m <= 2 || m >= GRID - 2
}
let maxRowSteps = 0
let worstRow = 0
let maxStepMag = 0
for (let y = 130; y <= 445; y += 5) {
  let steps = 0
  let prev = null
  for (let x = 890; x < 1130; x += 3) {
    if (nearGrid(x) || nearGrid(x - 3) || nearGrid(x + 3)) { prev = null; continue }
    const trio = [px(space, x, y), px(space, x - 3, y), px(space, x + 3, y)]
    if (trio.some((p) => (p.r + p.g + p.b) / 3 > 85)) { prev = null; continue }
    const lums = trio.map((p) => (p.r + p.g + p.b) / 3).sort((a, b) => a - b)
    const med = lums[1]
    if (prev != null && Math.abs(med - prev) >= 6) {
      steps++
      maxStepMag = Math.max(maxStepMag, Math.abs(med - prev))
    }
    prev = med
  }
  if (steps > maxRowSteps) { maxRowSteps = steps; worstRow = y }
}
// The new soft haze itself has 2-3 hard ellipse-layer boundaries per blob
// (a visible cloud edge is fine — that IS a nebula). The old 7-ring glow
// produced 14 regularly-spaced edges per crossing. Allow ≤ 5 per row.
check('space theme: no concentric-ring edge stacks in the background',
  maxRowSteps <= 5, `max steps in a row=${maxRowSteps} (y=${worstRow}), largest single step=${maxStepMag.toFixed(1)} lum (old 7-ring glow ≈ 14/row)`)
// Space is still atmospheric (non-flat): decent luminance variance.
const lums = []
for (let x = 0; x < space.width; x += 20) for (let y = 0; y < space.height; y += 20) {
  const p = px(space, x, y)
  lums.push((p.r + p.g + p.b) / 3)
}
const mean = lums.reduce((s, v) => s + v, 0) / lums.length
const sd = Math.sqrt(lums.reduce((s, v) => s + (v - mean) ** 2, 0) / lums.length)
check('space theme still has atmospheric variance', sd > 3, `σ=${sd.toFixed(1)}`)

// Jungle: cohesion + clear center, desktop and mobile.
await page.evaluate(() => window.__brScene.setTheme('jungle'))
await wait(1200)
await shot('05-theme-jungle')
const jungle = PNG.sync.read(fs.readFileSync(`${DIR}/05-theme-jungle.png`))
// Top canopy present: dark green scalloped band along the top edge.
let canopyHits = 0
for (let x = jungle.width * 0.2; x < jungle.width * 0.8; x += 10) {
  const p = px(jungle, x, 10)
  if (p.g > p.r && p.g > p.b && p.g < 150) canopyHits++
}
check('jungle: scalloped canopy covers the top edge', canopyHits >= 40,
  `${canopyHits}/60 dark-green samples at y=10`)
// Central gameplay area clear: high contrast between container and bg —
// the container's inner region should be much lighter than the canopy.
let centerLum = 0
let n = 0
for (let x = jungle.width * 0.35; x < jungle.width * 0.65; x += 12) {
  for (let y = jungle.height * 0.4; y < jungle.height * 0.75; y += 12) {
    const p = px(jungle, x, y)
    centerLum += (p.r + p.g + p.b) / 3
    n++
  }
}
centerLum /= n
check('jungle: central play area stays light/clear', centerLum > 120, `mean center luminance=${Math.round(centerLum)}`)
// Hills visible mid-frame: green coverage in the mid band (behind container).
let hillHits = 0
for (let x = jungle.width * 0.05; x < jungle.width * 0.95; x += 14) {
  const p = px(jungle, x, jungle.height * 0.6)
  if (p.g > p.r * 1.05 && p.g > p.b * 1.05) hillHits++
}
check('jungle: rolling hills/forest behind the container', hillHits >= 30, `${hillHits} green samples at mid-height`)
// Full coverage: no magenta/black holes (sampled everywhere is a real color).
let holes = 0
for (let x = 4; x < jungle.width; x += 24) for (let y = 4; y < jungle.height; y += 24) {
  const p = px(jungle, x, y)
  if (p.r > 230 && p.b > 230 && p.g < 60) holes++ // magenta = unrendered
}
check('jungle: full coverage (no unrendered regions)', holes === 0, `${holes} holes`)

// Mobile viewport: jungle must not obscure container/score/controls.
await page.setViewportSize({ width: 390, height: 844 })
await wait(900)
await page.evaluate(() => window.__brScene.setTheme('jungle'))
await wait(1100)
await shot('06-theme-jungle-mobile')
const jm = PNG.sync.read(fs.readFileSync(`${DIR}/06-theme-jungle-mobile.png`))
let mCenter = 0
n = 0
for (let x = jm.width * 0.3; x < jm.width * 0.7; x += 8) {
  for (let y = jm.height * 0.45; y < jm.height * 0.8; y += 8) {
    const p = px(jm, x, y)
    mCenter += (p.r + p.g + p.b) / 3
    n++
  }
}
mCenter /= n
check('jungle mobile: central area stays clear', mCenter > 110, `mean center luminance=${Math.round(mCenter)}`)
let mCanopy = 0
for (let x = jm.width * 0.2; x < jm.width * 0.8; x += 8) {
  const p = px(jm, x, 10)
  if (p.g > p.r && p.g > p.b && p.g < 150) mCanopy++
}
check('jungle mobile: canopy scales to the narrow viewport', mCanopy >= 25, `${mCanopy}/38 samples`)
await page.setViewportSize({ width: 1170, height: 658 })
await wait(900)

console.log(`\n${failures === 0 ? '✓ PHASE 2.13.1 QA SUITE: ALL CHECKS PASSED' : `✗ ${failures} FAILURES`}`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
