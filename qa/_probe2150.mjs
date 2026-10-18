#!/usr/bin/env node
/** Throwaway visual probe for the Phase 2.15.0 home screen. */
import { chromium } from 'playwright'
import fs from 'node:fs'

const url = process.argv[2] || 'http://localhost:5174/'
const DIR = 'qa/screens/p2150'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
for (const [w, h] of [
  [320, 568],
  [390, 844],
  [1280, 720],
  [1728, 864],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(url + '?probe=1', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await wait(1200)
  const state = await page.evaluate(() => {
    const menu = window.__brMenu
    return { visible: menu?.visible?.(), btns: menu?.buttons?.() }
  })
  console.log(`${w}x${h}: visible=${state.visible}`)
  for (const b of state.btns ?? []) console.log(`   ${b.label}: x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.w)} h=${Math.round(b.h)} in=${b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h}`)
  await page.screenshot({ path: `${DIR}/probe-home-${w}x${h}.png` })
  // zoom-in of the wordmark band for close inspection
  await page.screenshot({
    path: `${DIR}/probe-logo-${w}x${h}.png`,
    clip: { x: Math.max(0, Math.round(w / 2 - 560)), y: 15, width: Math.min(1120, w), height: 190 },
  })
  const letters = await page.evaluate(() => window.__brMenu.letters?.() ?? [])
  console.log(`--- letters @ ${w}x${h}`)
  for (const l of letters) console.log(JSON.stringify(l))
  // panels
  for (const label of ['COLLECTION', 'JOURNAL']) {
    const btn = (state.btns ?? []).find((x) => x.label === label)
    if (btn) {
      await page.mouse.click(btn.x + btn.w / 2, btn.y + btn.h / 2)
      await wait(500)
      await page.screenshot({ path: `${DIR}/probe-${label.toLowerCase()}-${w}x${h}.png` })
      const back = (await page.evaluate(() => window.__brMenu.buttons())).find((x) => x.label === 'BACK')
      if (back) await page.mouse.click(back.x + back.w / 2, back.y + back.h / 2)
      await wait(350)
    }
  }
  await page.close()
}
await browser.close()
console.log('done')
