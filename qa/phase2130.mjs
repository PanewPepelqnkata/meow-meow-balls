#!/usr/bin/env node
/**
 * Phase 2.13.0 — Real-gameplay QA suite (spec §16).
 *
 * Exercises the PRODUCTION event pipeline in the running browser game and
 * verifies state + pixels with pngjs (in-page WebGL reads are unavailable —
 * preserveDrawingBuffer is off). Required captures land in qa/screens/p2130/.
 *
 * Covers: initial composition, current/next queue regression (§4/§12),
 * drop, merge reward, real chain combos, tier 4/8/9 anime discoveries
 * (multi-moment), illustrated themes + mid-fade transition coverage,
 * tier-only progression unlock state, restart-mid-presentation cleanup,
 * portrait and wide layouts.
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { mkdirSync } from 'fs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2130'
mkdirSync(DIR, { recursive: true })

let failures = 0
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(page, name) {
  return page.screenshot({ path: `${DIR}/${name}.png` })
}
function px(png, nx, ny) {
  const x = Math.min(png.width - 1, Math.max(0, Math.round(nx * png.width)))
  const y = Math.min(png.height - 1, Math.max(0, Math.round(ny * png.height)))
  const i = (png.width * y + x) << 2
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
}
function near(c, want, tol) {
  return Math.abs(c.r - want[0]) <= tol && Math.abs(c.g - want[1]) <= tol && Math.abs(c.b - want[2]) <= tol
}
/** Does a small region around a normalized point contain the target color? */
function regionHas(png, nx, ny, rgb, tol = 46, spread = 0.02) {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (near(px(png, nx + dx * spread, ny + dy * spread), rgb, tol)) return true
    }
  }
  return false
}

const TIER_RGB = {
  1: [79, 195, 247], 2: [95, 212, 55], 3: [249, 110, 192], 4: [244, 67, 54],
  5: [255, 152, 0], 6: [255, 235, 51], 7: [255, 140, 46],
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1170, height: 658 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await wait(800)

  console.log('Phase 2.13.0 — Real gameplay QA (screenshots + state)\n')

  console.log('=== 1. Initial desktop composition (1170×658 reference) ===')
  await shot(page, '01-initial-desktop')
  check('desktop composition captured', true)

  console.log('\n=== 2. Queue regression: crane=CURRENT, preview=NEXT (§4/§12) ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  // Deterministic queue: current=tier2 (green), next=tier4 (red), distinct seeds.
  await page.evaluate(() => window.__brScene.setQueue({ tier: 2, seed: 12345 }, { tier: 4, seed: 67890 }))
  await wait(400)
  let q = await page.evaluate(() => window.__brScene.queueInfo())
  let claw = await page.evaluate(() => window.__brScene.clawInfo())
  check('queue state: current=2/A next=4/B', q.current.tier === 2 && q.current.seed === 12345 && q.next.tier === 4 && q.next.seed === 67890,
    `current=${JSON.stringify(q.current)} next=${JSON.stringify(q.next)}`)
  check('crane displays CURRENT ball (tier 2)', claw.tier === 2 && claw.seed === 12345 && claw.visible,
    `claw=${JSON.stringify(claw)}`)
  const sQueue = await shot(page, '02-queue-crane-green-preview-red')
  const ui = await page.evaluate(() => window.__brScene.uiPositions())
  // Next Ball preview box: scan for tier-4 red around its center.
  const nbx = ui.nextBall.x / 1170, nby = ui.nextBall.y / 658
  const previewRed = regionHas(PNG.sync.read(sQueue), nbx, nby, TIER_RGB[4], 60, 0.035)
  check('Next Ball preview shows tier 4 (red pixels in preview box)', previewRed,
    `preview center=(${ui.nextBall.x},${ui.nextBall.y})`)
  check('preview ball size sane', ui.nextBall.diameter > 8, `d=${ui.nextBall.diameter}`)

  // Drop the current ball (tier 2) via the real drop path.
  await page.evaluate(() => window.__brScene.dropAt(540))
  await wait(350)
  q = await page.evaluate(() => window.__brScene.queueInfo())
  claw = await page.evaluate(() => window.__brScene.clawInfo())
  check('after drop: crane promotes next (tier 4, SAME seed 67890)',
    q.current.tier === 4 && q.current.seed === 67890 && claw.tier === 4 && claw.seed === 67890,
    `current=${JSON.stringify(q.current)} claw=${JSON.stringify(claw)}`)
  check('after drop: fresh next generated', q.next.seed !== 67890, `next=${JSON.stringify(q.next)}`)
  await shot(page, '03-drop-current-tier2')

  // Swap via the REAL ability button: rerolls CURRENT only; next untouched.
  const nextBefore = q.next
  const abilities = await page.evaluate(() => window.__brScene.uiPositions().abilities)
  await page.mouse.click(abilities[0].x, abilities[0].y)
  await wait(300)
  q = await page.evaluate(() => window.__brScene.queueInfo())
  claw = await page.evaluate(() => window.__brScene.clawInfo())
  check('swap: next slot untouched', q.next.seed === nextBefore.seed && q.next.tier === nextBefore.tier,
    `next=${JSON.stringify(q.next)}`)
  check('swap: current rerolled (different seed, claw follows)', q.current.seed !== 67890 && claw.seed === q.current.seed,
    `current=${JSON.stringify(q.current)} claw=${JSON.stringify(claw)}`)
  check('swap: marked used', q.swapUsed === true)

  console.log('\n=== 3. Ordinary merge with reward popup ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 1))
  await wait(140)
  await page.evaluate(() => window.__brScene.spawnAt(548, 1))
  // Poll: merge timing varies with viewport scale.
  let merged = false
  let vis = { popupTexts: [] }
  for (let i = 0; i < 20 && !merged; i++) {
    await wait(150)
    vis = await page.evaluate(() => window.__brScene.visualState())
    merged = vis.popupTexts.some((t) => t.startsWith('+'))
  }
  check('merge popup shows +points and Good! grade', merged && vis.popupTexts.includes('Good!'),
    `labels: [${vis.popupTexts.join(', ')}]`)
  await shot(page, '04-merge-reward')

  console.log('\n=== 4. Real chain combo (escalating grade from chainDepth) ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  // Genuine chain: settled T2 on the floor, T1 pair JUST above it (explicit
  // y) → the T1 merge's replacement contacts the T2 inside the 400ms window.
  await page.evaluate(() => window.__brScene.spawnAt(540, 2))
  await wait(1400)
  await page.evaluate(() => { window.__brScene.spawnAt(540, 1, 940, true); window.__brScene.spawnAt(548, 1, 940, true) })
  await wait(1000)
  vis = await page.evaluate(() => window.__brScene.visualState())
  check('chain shows combo + grade', vis.popupTexts.some((t) => t.toLowerCase().includes('combo')),
    `labels: [${vis.popupTexts.join(', ')}]`)
  await shot(page, '05-chain-combo')

  console.log('\n=== 5. Tier 4 discovery: multi-moment anime sequence (§7) ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 3))
  await wait(140)
  await page.evaluate(() => window.__brScene.spawnAt(548, 3))
  // Poll for the overlay (merge timing varies with viewport scale).
  let d0 = null
  for (let i = 0; i < 20; i++) {
    await wait(200)
    d0 = await page.evaluate(() => window.__brScene.visualState())
    if (d0.discoveryVisible) break
  }
  check('discovery overlay active (tier 4)', d0.discoveryVisible && d0.discoveryTier === 4,
    `visible=${d0?.discoveryVisible} tier=${d0?.discoveryTier}`)
  await shot(page, '06-discovery-t4-burst')
  await wait(500)
  await shot(page, '07-discovery-t4-reveal')
  await wait(1900)
  const d2 = await page.evaluate(() => window.__brScene.visualState())
  check('discovery completed and cleared', !d2.discoveryVisible)
  await shot(page, '08-discovery-t4-returned')

  console.log('\n=== 6. Tier 8 rainbow discovery ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  // Simultaneous pair (proven to merge in <400ms — a staggered second T7
  // wedges in the slanted funnel and falls very slowly).
  await page.evaluate(() => { window.__brScene.spawnAt(450, 7); window.__brScene.spawnAt(580, 7) })
  let d8 = null
  for (let i = 0; i < 24; i++) {
    await wait(200)
    d8 = await page.evaluate(() => window.__brScene.visualState())
    if (d8.discoveryVisible) break
  }
  check('tier 8 discovery overlay active', d8.discoveryVisible && d8.discoveryTier === 8,
    `visible=${d8?.discoveryVisible} tier=${d8?.discoveryTier}`)
  await shot(page, '09-discovery-t8-burst')
  await wait(500)
  await shot(page, '10-discovery-t8-reveal')
  await wait(1900)

  console.log('\n=== 7. Tier 9 fantasy discovery ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => { window.__brScene.spawnAt(470, 8); window.__brScene.spawnAt(600, 8) })
  let d9 = null
  for (let i = 0; i < 24; i++) {
    await wait(200)
    d9 = await page.evaluate(() => window.__brScene.visualState())
    if (d9.discoveryVisible) break
  }
  check('tier 9 discovery overlay active', d9.discoveryVisible && d9.discoveryTier === 9,
    `visible=${d9?.discoveryVisible} tier=${d9?.discoveryTier}`)
  await shot(page, '11-discovery-t9-burst')
  await wait(500)
  await shot(page, '12-discovery-t9-reveal')
  await wait(1900)

  console.log('\n=== 8. Tier-only progression: locked ? → discovered colors (§9) ===')
  // Build real discoveries 2→3→4 through actual merges (QA-spawned balls
  // don't count — only merge-created tiers are discovered, by design).
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  let unlocked = await page.evaluate(() => window.__brScene.progressionUnlocked())
  check('progression starts with tiers 1-3 unlocked (Phase 2.13.1)', JSON.stringify(unlocked) === '[1,2,3]', `${JSON.stringify(unlocked)}`)
  await shot(page, '13-progression-locked')
  // T1 pair → tier 2
  await page.evaluate(() => window.__brScene.spawnAt(540, 1))
  await wait(140)
  await page.evaluate(() => window.__brScene.spawnAt(548, 1))
  await wait(1800)
  // T2 pair → tier 3
  await page.evaluate(() => window.__brScene.spawnAt(540, 2))
  await wait(140)
  await page.evaluate(() => window.__brScene.spawnAt(548, 2))
  await wait(1800)
  // T3 pair → tier 4 (+discovery overlay)
  await page.evaluate(() => window.__brScene.spawnAt(540, 3))
  await wait(140)
  await page.evaluate(() => window.__brScene.spawnAt(548, 3))
  await wait(2600)
  unlocked = await page.evaluate(() => window.__brScene.progressionUnlocked())
  check('progression unlocks 4 after a real tier-4 discovery', JSON.stringify(unlocked) === '[1,2,3,4]',
    `${JSON.stringify(unlocked)}`)
  await shot(page, '14-progression-unlocked')
  await page.evaluate(() => window.__brScene.restart())
  await wait(600)
  unlocked = await page.evaluate(() => window.__brScene.progressionUnlocked())
  check('progression resets to [1,2,3] on restart', JSON.stringify(unlocked) === '[1,2,3]', `${JSON.stringify(unlocked)}`)

  console.log('\n=== 9. Illustrated themes + mid-fade transition coverage (§6) ===')
  for (const name of ['light', 'space', 'jungle', 'fantasy']) {
    await page.evaluate((t) => window.__brScene.setTheme(t), name)
    await wait(1300)
    await shot(page, `15-theme-${name}`)
  }
  // Mid-fade: start light→space, capture at ~400ms, verify no blank canvas.
  await page.evaluate(() => window.__brScene.setTheme('light'))
  await wait(1300)
  await page.evaluate(() => window.__brScene.setTheme('space'))
  await wait(380)
  const sMid = PNG.sync.read(await shot(page, '16-theme-midfade'))
  const CORNERS = [[0.02, 0.03], [0.98, 0.03], [0.02, 0.97], [0.98, 0.97], [0.5, 0.985], [0.005, 0.5], [0.995, 0.5]]
  let blank = 0
  for (const [nx, ny] of CORNERS) {
    const c = px(sMid, nx, ny)
    // Blank canvas ≈ pure white or pure black at the extremes.
    if ((c.r > 252 && c.g > 252 && c.b > 252) || (c.r < 3 && c.g < 3 && c.b < 3)) blank++
  }
  check('mid-fade transition: no blank canvas anywhere', blank === 0, `${blank} blank probes`)
  await page.evaluate(() => window.__brScene.setTheme('light'))
  await wait(1300)

  console.log('\n=== 10. Restart during active presentation (§16.16) ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 3))
  await wait(140)
  await page.evaluate(() => window.__brScene.spawnAt(548, 3))
  await wait(800) // discovery mid-show
  const mid = await page.evaluate(() => window.__brScene.visualState())
  check('discovery active before restart', mid.discoveryVisible)
  await page.evaluate(() => window.__brScene.restart())
  await wait(900)
  const after = await page.evaluate(() => window.__brScene.visualState())
  check('restart kills overlay, popups, renderers', !after.discoveryVisible && after.popups === 0 && after.rendererBalls === 0,
    `overlay=${after.discoveryVisible} popups=${after.popups} balls=${after.rendererBalls}`)
  const uAfter = await page.evaluate(() => window.__brScene.progressionUnlocked())
  check('restart resets progression', JSON.stringify(uAfter) === '[1,2,3]', `${JSON.stringify(uAfter)}`)

  console.log('\n=== 11. Portrait mobile + wide desktop compositions ===')
  await page.setViewportSize({ width: 390, height: 844 })
  await wait(900)
  await shot(page, '17-portrait-390x844')
  const uiP = await page.evaluate(() => window.__brScene.uiPositions())
  check('portrait: all controls inside viewport',
    uiP.checkout.x > 0 && uiP.checkout.x < 390 && uiP.abilities.every((a) => a.x > 0 && a.x < 390 && a.y > 0 && a.y < 844),
    `checkout=(${Math.round(uiP.checkout.x)},${Math.round(uiP.checkout.y)})`)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await wait(900)
  await shot(page, '18-wide-1920x1080')
  const uiW = await page.evaluate(() => window.__brScene.uiPositions())
  check('wide: all controls inside viewport',
    uiW.checkout.x > 0 && uiW.checkout.x < 1920 && uiW.abilities.every((a) => a.x > 0 && a.x < 1920),
    `checkout=(${Math.round(uiW.checkout.x)},${Math.round(uiW.checkout.y)})`)
  await page.setViewportSize({ width: 1170, height: 658 })

  console.log('\n=== 12. Merge locality: replacement never teleports (§5) ===')
  // The original defect scenario: a DENSE pile around the merge point so the
  // space directly above is blocked. A T3 pillar flanked by two T2s; the T1
  // pair spawns inside the crowded gap. The T2 replacement must remain in
  // the same local region — never cross the container (unit tests pin the
  // ≤ ~240px ring bound; this verifies the real pipeline end-to-end).
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(380, 3, 1010, true))
  await wait(1300)
  await page.evaluate(() => window.__brScene.spawnAt(295, 2, 1030, true))
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(460, 2, 1030, true))
  await wait(600)
  const pileIds = await page.evaluate(() => {
    // QA-only id walk: T1 pair spawns into the gap between the pillars.
    return window.__brScene.spawnAt(372, 1, 995, true)
  })
  await wait(120)
  const pileIds2 = await page.evaluate(() => window.__brScene.spawnAt(414, 1, 995, true))
  await wait(1300)
  const midX = (pileIds ? 372 : 372) // spawn x; actual centers measured below
  const midY = 995
  // Find the newest entity created after the T1 pair (the replacement — or
  // its chain product if it immediately chain-merged with a neighbor, which
  // is also local by construction).
  let replacement = null
  for (let id = pileIds2.id + 1; id <= pileIds2.id + 60; id++) {
    const d = await page.evaluate((i) => window.__brScene.ballDetail(i), id)
    if (d) {
      replacement = d
    }
  }
  check('merge produced a replacement entity', replacement !== null,
    replacement ? `tier=${replacement.tier} pos=(${Math.round(replacement.center.pos.x)},${Math.round(replacement.center.pos.y)})` : 'not found')
  if (replacement) {
    const rx = replacement.center.pos.x, ry = replacement.center.pos.y
    const dist = Math.hypot(rx - midX, ry - midY)
    check('replacement stayed LOCAL to the merge point (≤302px)', dist <= 302,
      `dist=${Math.round(dist)}px mid=(${midX},${midY})`)
    check('replacement stayed left-of-center (no cross-container teleport)', rx < 520 && rx > 200,
      `x=${Math.round(rx)}`)
  }
  const dup = await page.evaluate(() => window.__brScene.visualState())
  check('no duplicate renderers (rendererBalls == registered)', dup.rendererBalls === dup.registered,
    `renderer=${dup.rendererBalls} registered=${dup.registered}`)
  await shot(page, '19-merge-locality')

  await browser.close()
  console.log(`\n${failures === 0 ? '✓ ALL PHASE 2.13.0 CHECKS PASSED' : `✗ ${failures} CHECKS FAILED`}`)
  console.log(`Screenshots: ${DIR}/`)
  process.exit(failures === 0 ? 0 : 1)
})()
