#!/usr/bin/env node
/**
 * Phase 2.12.1 — Final verification.
 *
 * Strategy: analyze REAL screenshots with pngjs (the WebGL canvas cannot be
 * read via drawImage — preserveDrawingBuffer is off — so in-page sampling
 * returns black). Functional checks read the dev-only `__brScene.visualState()`
 * hook so every claim is tied to actual rendered scene objects.
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { mkdirSync } from 'fs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2121-verified'
mkdirSync(DIR, { recursive: true })

let failures = 0
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Screenshot → PNG → sample at normalized coords. */
async function shot(page, name) {
  const buf = await page.screenshot({ path: `${DIR}/${name}.png` })
  return { png: PNG.sync.read(buf), name }
}

function px(png, nx, ny) {
  const x = Math.min(png.width - 1, Math.max(0, Math.round(nx * png.width)))
  const y = Math.min(png.height - 1, Math.max(0, Math.round(ny * png.height)))
  const i = (png.width * y + x) << 2
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
}

function near(c, want, tol) {
  return c && Math.abs(c.r - want[0]) <= tol && Math.abs(c.g - want[1]) <= tol && Math.abs(c.b - want[2]) <= tol
}

function hueOf({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max - min < 30 || max < 60) return null
  let h
  if (max === r) h = ((g - b) / (max - min)) % 6
  else if (max === g) h = (b - r) / (max - min) + 2
  else h = (r - g) / (max - min) + 4
  return ((h * 60) + 360) % 360
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1728, height: 864 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 15000 })
  await wait(700)

  console.log('Phase 2.13.0 — Final verification (screenshot-based)\n')
  console.log('=== 1. Theme coverage: illustrated environments, full viewport ===')
  // Phase 2.13.0: themes are ILLUSTRATED environments now, so probes check
  // per-region color families (sky at top, foliage/ground at bottom) instead
  // of one flat fill. Values calibrated from measured production pixels.
  const CORNERS = [[0.02, 0.03], [0.98, 0.03], [0.02, 0.97], [0.98, 0.97], [0.5, 0.985], [0.005, 0.5], [0.995, 0.5]]
  const EXPECT = {
    light: { top: [[243, 241, 235], 26], bottom: [[243, 241, 235], 26], mid: [[243, 241, 235], 26] },
    space: { top: [[10, 22, 40], 34], bottom: [[37, 21, 67], 38], mid: [[24, 21, 54], 42] },
    // Phase 2.13.1: jungle top = the scalloped canopy band (0x47925c), the
    // bottom corners sit on the leafy mounds / tree line blend.
    jungle: { top: [[71, 146, 92], 18], bottom: [[58, 120, 84], 30], mid: [[157, 213, 177], 40] },
    fantasy: { top: [[29, 23, 65], 36], bottom: [[50, 60, 85], 46], mid: [[52, 35, 87], 42] },
  }
  const regionOf = (ny) => (ny < 0.35 ? 'top' : ny > 0.9 ? 'bottom' : 'mid')
  for (const [name, regions] of Object.entries(EXPECT)) {
    await page.evaluate((t) => window.__brScene.setTheme(t), name)
    await wait(1300) // 800ms crossfade + settle
    const s = await shot(page, `theme-${name}`)
    let allOk = true
    const detail = []
    for (const [nx, ny] of CORNERS) {
      const c = px(s.png, nx, ny)
      const [rgb, tol] = regions[regionOf(ny)]
      const ok = near(c, rgb, tol)
      allOk = allOk && ok
      detail.push(`(${nx},${ny})=rgb(${c.r},${c.g},${c.b})`)
    }
    check(`${name} covers full viewport (illustrated)`, allOk, detail.join(' '))
  }
  await page.evaluate(() => window.__brScene.setTheme('light'))
  await wait(1100)

  console.log('\n=== 2. Tier 8 rainbow body (hue diversity scan) ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 8))
  await wait(1400)
  const s8 = await shot(page, 'tier8-rainbow')
  // Horizontal scanline through the mid-lower screen where the spawned T8 rests.
  const hues = new Set()
  for (let i = 0; i <= 120; i++) {
    const nx = 0.30 + (0.40 * i) / 120
    for (const ny of [0.52, 0.60, 0.68]) {
      const h = hueOf(px(s8.png, nx, ny))
      if (h !== null) hues.add(Math.round(h / 30) * 30)
    }
  }
  check('tier8 shows ≥4 distinct hue sectors on scanline', hues.size >= 4,
    `sectors: ${[...hues].sort((a, b) => a - b).join('°,')}°`)

  console.log('\n=== 3. Tier 9 fantasy body (pastel pink scan) ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 9))
  await wait(1400)
  const s9 = await shot(page, 'tier9-fantasy')
  let pinkish = 0, samples = 0
  for (let i = 0; i <= 100; i++) {
    const nx = 0.32 + (0.36 * i) / 100
    for (const ny of [0.54, 0.62, 0.70]) {
      const c = px(s9.png, nx, ny)
      samples++
      if (c.r > 185 && c.r > c.g + 8 && c.b > 140 && Math.abs(c.r - c.b) < 100) pinkish++
    }
  }
  check('tier9 body has pastel-pink region', pinkish >= 8, `${pinkish}/${samples} scan samples pink-dominant`)

  console.log('\n=== 4. Real merge → score reward ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  const before = await page.evaluate(() => window.__brScene.gameOver().score)
  await page.evaluate(() => window.__brScene.spawnAt(540, 1))
  await wait(200)
  await page.evaluate(() => window.__brScene.spawnAt(545, 1))
  await wait(700)
  const mid = await page.evaluate(() => ({
    score: window.__brScene.gameOver().score,
    vis: window.__brScene.visualState(),
  }))
  check('score increased on merge', mid.score > before, `${before} → ${mid.score}`)
  check('score popup rendered with +points', mid.vis.popupTexts.some((t) => t.startsWith('+')),
    `labels: [${mid.vis.popupTexts.join(', ')}]`)
  const sMerge = await shot(page, 'merge-popup')
  await wait(1600)
  const late = await page.evaluate(() => window.__brScene.visualState())
  check('popup cleared after animation', late.popups === 0, `${late.popups} remain`)

  console.log('\n=== 5. Real chain merge → combo label (chainDepth from MergeSystem) ===')
  // Phase 2.13.0: the grade/combo MUST come from the real chain state
  // (chainWindowMs=400), not a cosmetic wall-clock counter. Build a genuine
  // chain: a settled T2, then a T1 pair right above it — the T1 merge's
  // replacement contacts the T2 immediately (second merge inside the window).
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 2))
  await wait(1400) // settle to the floor
  await page.evaluate(() => { window.__brScene.spawnAt(540, 1, 940, true); window.__brScene.spawnAt(545, 1, 940, true) })
  await wait(1000)
  const combo = await page.evaluate(() => window.__brScene.visualState())
  check('chain merge shows combo label', combo.popupTexts.some((t) => t.toLowerCase().includes('combo')),
    `labels: [${combo.popupTexts.join(', ')}]`)
  await shot(page, 'chain-combo')

  console.log('\n=== 6. Discovery: tiers 1–3 silent, tier 4+ full-screen anime ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(500)
  await page.evaluate(() => window.__brScene.spawnAt(540, 1))
  await wait(150)
  await page.evaluate(() => window.__brScene.spawnAt(545, 1))
  await wait(900) // merge → tier 2
  const t2 = await page.evaluate(() => window.__brScene.visualState())
  check('tier 2 merge does NOT trigger discovery', !t2.discoveryVisible,
    `visible=${t2.discoveryVisible}`)
  await page.evaluate(() => window.__brScene.spawnAt(540, 3))
  await wait(150)
  await page.evaluate(() => window.__brScene.spawnAt(545, 3))
  await wait(900) // merge → tier 4 (first-time, ≥ minTier)
  const disc = await page.evaluate(() => window.__brScene.visualState())
  check('first-time tier 4 discovery overlay active', disc.discoveryVisible && disc.discoveryTier === 4,
    `visible=${disc.discoveryVisible} tier=${disc.discoveryTier}`)
  await shot(page, 'discovery-active')
  await wait(2300)
  const discLate = await page.evaluate(() => window.__brScene.visualState())
  check('discovery overlay completes', !discLate.discoveryVisible)
  await shot(page, 'discovery-cleared')

  console.log('\n=== 7. Restart resets transient state ===')
  await page.evaluate(() => window.__brScene.restart())
  await wait(700)
  const clean = await page.evaluate(() => window.__brScene.visualState())
  check('popups cleared', clean.popups === 0, `${clean.popups}`)
  check('overlay hidden', !clean.discoveryVisible)
  check('renderer empty', clean.rendererBalls === 0, `${clean.rendererBalls}`)
  await shot(page, 'after-restart')

  await browser.close()
  console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECKS FAILED`}`)
  console.log(`Screenshots: ${DIR}/`)
  process.exit(failures === 0 ? 0 : 1)
})()
