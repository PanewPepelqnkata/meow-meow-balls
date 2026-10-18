/* global window, console, process */
/**
 * Phase 2.11.1 visual-regression screenshots (spec Priority 7):
 *   1 small blue ball at rest        qa/screens/p111-1-small.png
 *   2 medium ball at rest            qa/screens/p111-2-medium.png
 *   3 large ball at rest             qa/screens/p111-3-large.png
 *   4 ball during compression        qa/screens/p111-4-compression.png
 *   5 dense pile                     qa/screens/p111-5-pile.png
 *   6 next-ball preview              qa/screens/p111-6-preview.png
 *   7 crane ball                     qa/screens/p111-7-crane.png
 *   8 merge + replacement            qa/screens/p111-8-merge.png
 *   9 mobile portrait                qa/screens/p111-9-mobile.png
 *  10 desktop 1648×936               qa/screens/p111-10-desktop.png
 *  + all 9 supported viewports       qa/screens/p111-vp-<w>x<h>.png
 *
 * Usage: node qa/phase2111.mjs [baseURL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5199'
const browser = await chromium.launch()

async function page(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } })
  await p.goto(`${BASE}/?vp=${w}x${h}`, { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await p.waitForTimeout(800)
  return p
}
const settle = (p, timeout = 15000) =>
  p
    .waitForFunction(() => {
      const t = window.__brScene.telemetry()
      return t.balls.length > 0 && t.balls.every((b) => b.sleeping)
    }, { timeout })
    .catch(() => {})
const shot = (p, name) => p.screenshot({ path: `qa/screens/${name}.png` })

// --- scenarios 1-3: single balls at rest (desktop) --------------------------
{
  const p = await page(1648, 936)
  await p.evaluate(() => { window.__brScene.restart(); window.__brScene.spawnAt(360, 1) })
  await settle(p)
  await shot(p, 'p111-1-small')
  await p.evaluate(() => { window.__brScene.restart(); window.__brScene.spawnAt(360, 4) })
  await settle(p)
  await shot(p, 'p111-2-medium')
  await p.evaluate(() => { window.__brScene.restart(); window.__brScene.spawnAt(360, 7) })
  await settle(p)
  await shot(p, 'p111-3-large')
  await p.close()
}

// --- scenario 4: compression (ball squeezed under a dropped heavy ball) -----
{
  const p = await page(1648, 936)
  await p.evaluate(() => {
    window.__brScene.restart()
    window.__brScene.spawnAt(360, 5)
  })
  await settle(p, 8000)
  // drop a heavy ball straight onto it and capture mid-compression
  await p.evaluate(() => window.__brScene.spawnAt(360, 6))
  await p.waitForTimeout(260)
  await shot(p, 'p111-4-compression')
  await settle(p, 8000)
  await p.close()
}

// --- scenario 5: dense pile --------------------------------------------------
{
  const p = await page(1648, 936)
  await p.evaluate(() => {
    window.__brScene.restart()
    const tiers = [2, 3, 2, 3, 4, 3, 2, 3, 4, 5, 3, 2]
    tiers.forEach((t, i) => window.__brScene.spawnAt(240 + (i % 4) * 80, t, 700 - (i % 6) * 90))
  })
  await settle(p, 20000)
  await p.waitForTimeout(600)
  await shot(p, 'p111-5-pile')
  await p.close()
}

// --- scenarios 6-7: preview + crane (desktop + mobile) -----------------------
{
  const p = await page(1648, 936)
  await p.evaluate(() => window.__brScene.restart())
  await p.waitForTimeout(700)
  await shot(p, 'p111-6-preview')
  await p.evaluate(() => window.__brScene.dropAt(300))
  await p.waitForTimeout(1400)
  await shot(p, 'p111-7-crane')
  await p.close()
  const m = await page(390, 844)
  await m.evaluate(() => window.__brScene.restart())
  await m.waitForTimeout(700)
  await shot(m, 'p111-9-mobile')
  await m.close()
}

// --- scenario 8: merge + replacement -----------------------------------------
{
  const p = await page(1648, 936)
  await p.evaluate(() => {
    window.__brScene.restart()
    window.__brScene.spawnAt(320, 2)
  })
  await settle(p, 10000)
  await p.evaluate(() => window.__brScene.dropAt(320))
  await p.waitForTimeout(1200)
  await settle(p, 12000)
  await p.waitForTimeout(400)
  await shot(p, 'p111-8-merge')
  await p.close()
}

// --- scenario 10: desktop reference ------------------------------------------
{
  const p = await page(1648, 936)
  await p.evaluate(() => window.__brScene.restart())
  await p.waitForTimeout(700)
  await p.evaluate(() => { window.__brScene.dropAt(320); window.__brScene.dropAt(400) })
  await settle(p, 15000)
  await shot(p, 'p111-10-desktop')
  await p.close()
}

// --- all 9 supported viewports ------------------------------------------------
const VIEWPORTS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1280, 720],
  [1440, 900],
  [1648, 936],
  [1920, 1080],
]
for (const [w, h] of VIEWPORTS) {
  const p = await page(w, h)
  await p.evaluate(() => window.__brScene.restart())
  await p.waitForTimeout(700)
  await p.evaluate(() => { window.__brScene.dropAt(320); window.__brScene.dropAt(400) })
  await settle(p, 15000)
  await shot(p, `p111-vp-${w}x${h}`)
  await p.close()
}

await browser.close()
console.log('PHASE 2.11.1 SCREENSHOTS SAVED')
