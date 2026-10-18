/* global window, console, process */
/**
 * Phase 2.11.0 visual QA: screenshots at all 9 supported viewports.
 * Usage: node qa/phase2110.mjs [baseURL]
 * Saves qa/screens/p11-<w>x<h>.png for manual visual inspection.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5199'
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

mkdirSync('qa/screens', { recursive: true })

const browser = await chromium.launch()
for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${BASE}/?vp=${w}x${h}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await page.waitForTimeout(1200) // font + layout + first paints
  // Drop a few balls so the container shows real characters + merges.
  await page.evaluate(() => {
    const s = window.__brScene
    s.dropAt(360)
    s.dropAt(300)
    s.dropAt(420)
  })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `qa/screens/p11-${w}x${h}.png` })
  // Collect layout diagnostics.
  const diag = await page.evaluate(() => {
    const st = window.__brState
    return { score: st.score, balls: st.balls, tiers: st.tiers }
  })
  console.log(`${w}x${h}:`, JSON.stringify(diag))
  await page.close()
}
await browser.close()
console.log('DONE')
