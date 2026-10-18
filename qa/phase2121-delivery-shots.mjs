#!/usr/bin/env node
/** Phase 2.12.1 — final deliverable screenshots (real gameplay, real events). */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const url = process.argv[2] || 'http://localhost:5173'
const DIR = 'qa/screens/p2121-delivery'
mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  for (const [w, h, tag] of [[1728, 864, 'desktop'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
    await wait(700)
    await page.evaluate(() => window.__brScene.restart())
    await wait(400)

    // 1. Initial state
    await page.screenshot({ path: `${DIR}/${tag}-1-initial.png` })

    // 2. Dropped balls (real drops from the claw)
    await page.evaluate(() => { window.__brScene.dropAt(540); })
    await wait(600)
    await page.evaluate(() => { window.__brScene.dropAt(620); })
    await wait(1200)
    await page.screenshot({ path: `${DIR}/${tag}-2-drops.png` })

    // 3. Merge with popup (spawn pair that will merge)
    await page.evaluate(() => { window.__brScene.spawnAt(520, 1); window.__brScene.spawnAt(560, 1) })
    await wait(700)
    await page.screenshot({ path: `${DIR}/${tag}-3-merge-popup.png` })

    // 4. Discovery overlay
    await page.evaluate(() => window.__brScene.restart())
    await wait(400)
    await page.evaluate(() => { window.__brScene.spawnAt(520, 1); window.__brScene.spawnAt(560, 1) })
    await wait(1000)
    await page.screenshot({ path: `${DIR}/${tag}-4-discovery.png` })
    await wait(2300)

    // 5. Tier 8 + Tier 9 in play
    await page.evaluate(() => { window.__brScene.spawnAt(500, 8); window.__brScene.spawnAt(600, 9) })
    await wait(1400)
    await page.screenshot({ path: `${DIR}/${tag}-5-tier8-tier9.png` })

    // 6-8. Themes
    for (const theme of ['space', 'jungle', 'fantasy']) {
      await page.evaluate((t) => window.__brScene.setTheme(t), theme)
      await wait(1300)
      await page.screenshot({ path: `${DIR}/${tag}-6-theme-${theme}.png` })
    }
    await page.evaluate(() => window.__brScene.setTheme('light'))
    await wait(1100)
    console.log(`✓ ${tag} set complete`)
  }

  await browser.close()
  console.log(`\nScreenshots: ${DIR}/`)
})()
