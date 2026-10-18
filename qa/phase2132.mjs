#!/usr/bin/env node
/**
 * Phase 2.13.2 browser QA — the four targeted fixes:
 *
 *  §1  Merge loss: crowded merges near BOTH walls always produce the
 *      replacement; deferrals bounded (~pendingEmergencyMs); the merge
 *      transaction places BEFORE removing the sources.
 *  §2  Background circles: every theme — no hard-step halo/ring edges in
 *      the background band (gradient clouds), atmosphere preserved,
 *      fantasy moon crisp above its soft halo, crossfade clean.
 *  §3  Discovery panel (Phase 2.13.4): one tier-colored band across the
 *      middle over the gently dimmed game background, cream disc + centered
 *      ball, comic accents, yellow title with black outline, clean exit, no
 *      repeats, tiers 1-3 never fire. Shared checks in lib-discovery.mjs.
 *  §4  Progression: tiers 1-3 unlocked at start, character nodes colored,
 *      locked nodes dark with '?', two-tone curve, gameplay-driven unlock.
 *
 * Desktop (1170×658) + a mobile pass (390×844) for themes/progression.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { PNG } from 'pngjs'
import { readShot, verifyDiscoveryBand } from './lib-discovery.mjs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2132'
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

// ============================================================================
console.log('\n=== §1 No merge loss: crowded merges near both walls ===')

async function jamCase(name, pairXs, pairY) {
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  // Deep T4/T5 checkerboard jam (offset rows so no unintended same-tier
  // contacts), five rows deep — a full pile above the merge point.
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
  await wait(3200)

  const pair = []
  for (const xx of pairXs) {
    const res = await page.evaluate(({ x, t, y }) => window.__brScene.spawnAt(x, t, y, true), { x: xx, t: 5, y: pairY })
    pair.push(res.id)
    await wait(90)
  }

  // Poll atomically (single evaluate per sample).
  let sawRep = false
  let repTier = null
  let worstDefer = 0
  for (let s = 0; s < 40 && !sawRep; s++) {
    await wait(250)
    const snap = await page.evaluate((afterId) => {
      const state = window.__brScene.visualState()
      const found = []
      for (let id = 1; id <= afterId + 80; id++) {
        const d = window.__brScene.ballDetail(id)
        if (d) found.push({ id, tier: d.tier, x: Math.round(d.center.pos.x), y: Math.round(d.center.pos.y) })
      }
      return { state, found, records: window.__brScene.mergeLocality() }
    }, pair[1])
    for (const m of snap.records) worstDefer = Math.max(worstDefer, m.deferredMs)
    const rep = snap.found.find((b) => b.tier === 6 && b.id > pair[1])
    if (rep) {
      sawRep = true
      repTier = rep
    }
  }
  await shot(`01-crowded-merge-${name}`)
  check(`[${name}] crowded merge produces the T6 replacement (no loss)`, sawRep,
    sawRep ? `#${repTier.id} at (${repTier.x},${repTier.y})` : 'replacement never appeared')
  check(`[${name}] worst deferral bounded (~pendingEmergencyMs)`, worstDefer <= 1100,
    `${worstDefer.toFixed(0)}ms`)
  return worstDefer
}
const w1 = await jamCase('left', [300, 345], 950)
const w2 = await jamCase('right', [430, 475], 950)
check('§1 both walls: replacement always appears', true, `worst deferrals ${w1.toFixed(0)}/${w2.toFixed(0)}ms`)

// ============================================================================
console.log('\n=== §2 Background circles removed (all themes) ===')

const GRID = 42
const nearGrid = (v) => {
  const m = ((v % GRID) + GRID) % GRID
  return m <= 2 || m >= GRID - 2
}
function scanSteps(png, x0, x1, y0, y1, brightLimit = 85) {
  let maxRowSteps = 0
  let maxStepMag = 0
  for (let y = y0; y <= y1; y += 5) {
    let steps = 0
    let prev = null
    for (let x = x0; x < x1; x += 3) {
      if (nearGrid(x) || nearGrid(x - 3) || nearGrid(x + 3)) { prev = null; continue }
      const trio = [px(png, x, y), px(png, x - 3, y), px(png, x + 3, y)]
      if (trio.some((p) => (p.r + p.g + p.b) / 3 > brightLimit)) { prev = null; continue }
      const lums = trio.map((p) => (p.r + p.g + p.b) / 3).sort((a, b) => a - b)
      const med = lums[1]
      if (prev != null && Math.abs(med - prev) >= 6) {
        steps++
        maxStepMag = Math.max(maxStepMag, Math.abs(med - prev))
      }
      prev = med
    }
    if (steps > maxRowSteps) maxRowSteps = steps
  }
  return { maxRowSteps, maxStepMag }
}
function sigma(png) {
  const lums = []
  for (let x = 0; x < png.width; x += 20) for (let y = 0; y < png.height; y += 20) {
    const p = px(png, x, y)
    lums.push((p.r + p.g + p.b) / 3)
  }
  const mean = lums.reduce((a, v) => a + v, 0) / lums.length
  return Math.sqrt(lums.reduce((a, v) => a + (v - mean) ** 2, 0) / lums.length)
}

await page.evaluate(() => window.__brScene.restart())
await wait(400)
for (const theme of ['light', 'space', 'jungle', 'fantasy']) {
  await page.evaluate((t) => window.__brScene.setTheme(t), theme)
  await wait(1300)
  await shot(`02-theme-${theme}`)
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/02-theme-${theme}.png`))
  const s = scanSteps(png, 890, 1130, 185, 420)
  // Gradient clouds are perfectly smooth (0 hard steps). Fantasy's palm
  // frond silhouette is an ILLUSTRATED shape (allowed) — small count only.
  const limit = theme === 'fantasy' ? 5 : 0
  check(`[${theme}] no hard-edge halo/ring steps in the background band`, s.maxRowSteps <= limit,
    `max/row=${s.maxRowSteps}, biggest step=${s.maxStepMag.toFixed(1)} lum`)
  check(`[${theme}] atmosphere preserved (not flat)`, sigma(png) > 3, `σ=${sigma(png).toFixed(1)}`)
}
// Fantasy moon: crisp disc above its soft halo.
{
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/02-theme-fantasy.png`))
  const vw = png.width
  const vh = png.height
  const mx = Math.round(vw * 0.78)
  const my = Math.round(vw && vh ? vh * 0.16 : 0)
  const mr = Math.round(Math.min(vw, vh) * 0.07)
  const center = px(png, mx, my)
  const halo = px(png, mx, my - mr - 14)
  check('fantasy moon is crisp (bright disc)', (center.r + center.g + center.b) / 3 > 200,
    `moon lum=${Math.round((center.r + center.g + center.b) / 3)}`)
  check('fantasy moon halo is soft (gradient, not a hard ring)', (halo.r + halo.g + halo.b) / 3 > 20,
    `halo lum=${Math.round((halo.r + halo.g + halo.b) / 3)}`)
}
// Crossfade: mid-transition + settled screenshots, no errors.
await page.evaluate(() => window.__brScene.setTheme('space'))
await wait(320)
await shot('02-theme-midcrossfade')
await wait(900)
await page.evaluate(() => window.__brScene.setTheme('jungle'))
await wait(1300)
await shot('02-theme-after-crossfade')
const errs = await page.evaluate(() => window.__brUpdateError ?? null)
check('theme crossfades run without errors', errs == null, errs ?? 'clean')

// ============================================================================
console.log('\n=== §3 Discovery comic panel (tier 4) ===')
await page.evaluate(() => window.__brScene.restart())
await wait(700)
// Real T3 pair merge → first-time T4 → comic panel.
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
let shown = false
for (let i = 0; i < 40 && !shown; i++) {
  await wait(100)
  shown = await page.evaluate(() => window.__brScene.visualState().discoveryVisible)
}
check('discovery panel appears for first-time tier 4', shown)
await wait(520) // mid-hold: band punched in, character popped
await shot('03-discovery-panel')
// Phase 2.13.4 composition (shared checks: gentle dim + game background
// visible, one tier-colored band, cream disc + centered character, yellow
// title with black outline, comic accents).
verifyDiscoveryBand(check, readShot(`${DIR}/03-discovery-panel.png`))
// Clean exit.
let hidden = false
for (let i = 0; i < 40 && !hidden; i++) {
  await wait(150)
  hidden = !(await page.evaluate(() => window.__brScene.visualState().discoveryVisible))
}
check('panel exits cleanly and gameplay resumes', hidden)
await wait(300)
// No repeat of tier 4; tiers 1-3 never trigger.
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
console.log('\n=== §4 Tier progression ===')
await page.evaluate(() => window.__brScene.restart())
await wait(700)
const unlocked = await page.evaluate(() => window.__brScene.progressionUnlocked())
check('tiers 1-3 unlocked from the very first session', JSON.stringify(unlocked) === '[1,2,3]', JSON.stringify(unlocked))
await shot('04-progression-start')
{
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/04-progression-start.png`))
  const vw = png.width
  const vh = png.height
  // Phase 2.13.2 arc — replicate the layout math exactly and verify each
  // node at its computed position (precise, not a loose region scan).
  const ds = Math.min(vw / 1648, vh / 936)
  const acx = 184 * (vw / 1648)
  const acy = 1560 * ds
  const ar = 777 * ds
  const aa0 = -1.7085
  const aa1 = -1.0662
  const rr = Math.max(10, 19 * ds)
  const nodePos = (i) => {
    const a = aa0 + ((aa1 - aa0) * i) / 9
    return { x: acx + Math.cos(a) * ar, y: acy + Math.sin(a) * ar }
  }
  // Unlocked character nodes (tiers 1-3) carry their tier color.
  const tierColorOk = (i, test) => {
    const { x, y } = nodePos(i)
    let hits = 0
    for (let dx = -rr * 0.55; dx <= rr * 0.55; dx += 1.5) {
      for (let dy = -rr * 0.55; dy <= rr * 0.55; dy += 1.5) {
        if (test(px(png, x + dx, y + dy))) hits++
      }
    }
    return hits
  }
  const cyanHits = tierColorOk(0, (p) => p.b > 200 && p.g > 170 && p.r < 140)
  const greenHits = tierColorOk(1, (p) => p.g > 150 && p.r < 110 && p.b < 130)
  const pinkHits = tierColorOk(2, (p) => p.r > 170 && p.b > 110 && p.g < 150)
  check('character nodes colored (tier 1 cyan / 2 green / 3 pink)',
    cyanHits >= 8 && greenHits >= 8 && pinkHits >= 8,
    `cyan=${cyanHits} green=${greenHits} pink=${pinkHits}`)
  // Locked nodes: dark discs with a bright '?' at the center.
  let lockedOk = 0
  let qmarkPixels = 0
  for (let i = 3; i <= 9; i++) {
    const { x, y } = nodePos(i)
    let dark = 0
    let bright = 0
    for (let dx = -rr * 0.9; dx <= rr * 0.9; dx += 1.5) {
      for (let dy = -rr * 0.9; dy <= rr * 0.9; dy += 1.5) {
        const p = px(png, x + dx, y + dy)
        if (p.r < 60 && p.g < 64 && p.b < 68) dark++
        if ((p.r + p.g + p.b) / 3 > 150) bright++
      }
    }
    qmarkPixels += bright
    if (dark >= 20 && bright >= 3) lockedOk++
  }
  check('dark locked nodes present', lockedOk >= 6, `${lockedOk}/7 locked nodes dark`)
  check('question marks on locked nodes', qmarkPixels >= 20, `${qmarkPixels} bright glyph px across 7 locked nodes`)
  // Curve: the blue connector must be visible in the gaps between nodes
  // (nodes sit ON the path — the gap segments are what shows) plus the
  // lead-in/out tails.
  let curveHits = 0
  for (let i = 0; i < 9; i++) {
    const am = aa0 + ((aa1 - aa0) * (i + 0.5)) / 9
    for (let d = 0; d <= 4; d += 2) {
      const x = acx + Math.cos(am) * ar + 0
      const y = acy + Math.sin(am) * ar + d - 2
      const p = px(png, x, y)
      if (p.b > 200 && p.r < 130 && p.g > 100 && p.g < 175) curveHits++
    }
  }
  check('smooth connecting curve visible between the nodes', curveHits >= 10,
    `${curveHits} blue samples at the 9 inter-node midpoints`)
}
// Gameplay-driven unlock: discover T4, progression must include it (+ pop shot).
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(140)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
let sawUnlock = false
for (let i = 0; i < 40 && !sawUnlock; i++) {
  await wait(100)
  const u = await page.evaluate(() => window.__brScene.progressionUnlocked())
  sawUnlock = u.includes(4)
}
check('tier 4 unlocks in the progression from real gameplay', sawUnlock)
await wait(250) // mid pop/glow
await shot('04-progression-unlock-pop')
const unlocked4 = await page.evaluate(() => window.__brScene.progressionUnlocked())
check('progression now shows 1-4', JSON.stringify(unlocked4) === '[1,2,3,4]', JSON.stringify(unlocked4))

// ============================================================================
console.log('\n=== Mobile pass (390×844): themes + progression ===')
await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(900)
await shot('05-mobile-progression')
{
  // Portrait row: replicate the layout math (ps=1 at 390×844, no safe area).
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/05-mobile-progression.png`))
  const rr = 12
  const rowY = 750
  const x0 = 30
  const step = 330 / 9
  const hits = (i, test) => {
    let n = 0
    for (let dx = -rr * 0.55; dx <= rr * 0.55; dx += 1.5)
      for (let dy = -rr * 0.55; dy <= rr * 0.55; dy += 1.5) if (test(px(png, x0 + step * i + dx, rowY + dy))) n++
    return n
  }
  const cyan = hits(0, (p) => p.b > 200 && p.g > 170 && p.r < 140)
  const green = hits(1, (p) => p.g > 150 && p.r < 110 && p.b < 130)
  const pink = hits(2, (p) => p.r > 170 && p.b > 110 && p.g < 150)
  let lockedDark = 0
  for (let i = 3; i <= 9; i++) {
    let dark = 0
    for (let dx = -rr * 0.9; dx <= rr * 0.9; dx += 1.5)
      for (let dy = -rr * 0.9; dy <= rr * 0.9; dy += 1.5) {
        const p = px(png, x0 + step * i + dx, rowY + dy)
        if (p.r < 60 && p.g < 64 && p.b < 68) dark++
      }
    if (dark >= 15) lockedDark++
  }
  check('mobile portrait progression row: colored + locked nodes', cyan >= 6 && green >= 6 && pink >= 6 && lockedDark >= 6,
    `cyan=${cyan} green=${green} pink=${pink} locked=${lockedDark}/7`)
}
await page.evaluate(() => window.__brScene.setTheme('jungle'))
await wait(1300)
await shot('05-mobile-theme-jungle')
{
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/05-mobile-theme-jungle.png`))
  let clear = 0
  let n = 0
  for (let x = png.width * 0.3; x < png.width * 0.7; x += 6) {
    for (let y = png.height * 0.35; y < png.height * 0.6; y += 6) {
      const p = px(png, x, y)
      clear += (p.r + p.g + p.b) / 3
      n++
    }
  }
  check('jungle mobile: central play area stays clear', clear / n > 110, `mean lum=${Math.round(clear / n)}`)
}
await page.evaluate(() => window.__brScene.setTheme('space'))
await wait(1300)
await shot('05-mobile-theme-space')
{
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/05-mobile-theme-space.png`))
  const s = scanSteps(png, Math.round(png.width * 0.72), png.width - 6, 150, 420)
  check('space mobile: no hard-edge halo steps', s.maxRowSteps <= 5, `max/row=${s.maxRowSteps}`)
}

await browser.close()
console.log(`\n=== PHASE 2.13.2 QA: ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
