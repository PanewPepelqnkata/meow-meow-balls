/**
 * Phase 2.16.1 smoke — doodle big-eye balls, 12 tiers, circular ring.
 * Desktop 1648×936 (ring + faces) and mobile 390×844 (row + faces).
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const URL = 'http://localhost:5179'
const DIR = 'qa/screens/p2161-smoke'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await chromium.launch()
const errs = []
try {
  // ---- desktop ------------------------------------------------------------
  const p = await b.newPage({ viewport: { width: 1648, height: 936 } })
  p.on('pageerror', (e) => errs.push('desktop: ' + e.message))
  await p.goto(URL, { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await wait(1200)
  await p.screenshot({ path: `${DIR}/desktop-menu.png` })

  // Press PLAY.
  const play = (await p.evaluate(() => window.__brMenu.buttons())).find((x) => x.label === 'PLAY')
  await p.mouse.click(play.x + play.w / 2, play.y + play.h / 2)
  await wait(1500)
  // Cast a few balls so the big doodle eyes are visible.
  await p.evaluate(() => {
    window.__brScene.spawnAt(300, 1)
    window.__brScene.spawnAt(420, 2)
    window.__brScene.spawnAt(360, 3)
    window.__brScene.spawnAt(250, 4)
  })
  await wait(2200)
  await p.screenshot({ path: `${DIR}/desktop-gameplay.png` })

  const state = await p.evaluate(() => window.__brScene.visualState())
  console.log('desktop:', JSON.stringify({ menuScreen: await p.evaluate(() => window.__brMenu.screen()), ...state }))

  // ---- mobile -------------------------------------------------------------
  const m = await b.newPage({ viewport: { width: 390, height: 844 } })
  m.on('pageerror', (e) => errs.push('mobile: ' + e.message))
  await m.goto(URL, { waitUntil: 'networkidle' })
  await m.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await wait(1200)
  await m.screenshot({ path: `${DIR}/mobile-menu.png` })
  const playM = (await m.evaluate(() => window.__brMenu.buttons())).find((x) => x.label === 'PLAY')
  await m.mouse.click(playM.x + playM.w / 2, playM.y + playM.h / 2)
  await wait(1500)
  await m.evaluate(() => {
    window.__brScene.spawnAt(300, 1)
    window.__brScene.spawnAt(400, 2)
    window.__brScene.spawnAt(350, 3)
  })
  await wait(2000)
  await m.screenshot({ path: `${DIR}/mobile-gameplay.png` })
  console.log('mobile:', JSON.stringify(await m.evaluate(() => window.__brScene.visualState())))
  await m.close()
  await p.close()
} finally {
  await b.close()
}
console.log('pageerrors:', JSON.stringify(errs))
console.log('done')
