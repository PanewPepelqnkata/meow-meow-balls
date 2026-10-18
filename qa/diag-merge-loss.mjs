#!/usr/bin/env node
/** Diagnostic: dump every ball id/tier/state after the deep-jam merge. */
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setViewportSize({ width: 1170, height: 658 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(700)

await page.evaluate(() => window.__brScene.restart())
await wait(600)
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
const v1 = await page.evaluate(() => window.__brScene.visualState())
console.log('after fill:', JSON.stringify(v1.rendererBalls), 'registered', v1.registered)

const p1 = await page.evaluate(({ x, t, y }) => window.__brScene.spawnAt(x, t, y, true), { x: 300, t: 5, y: 950 })
const p2 = await page.evaluate(({ x, t, y }) => window.__brScene.spawnAt(x, t, y, true), { x: 345, t: 5, y: 950 })
console.log('pair ids:', p1.id, p2.id)

for (const t of [600, 1500, 3000, 5000, 8000]) {
  await wait(t === 600 ? 600 : t - [600, 1500, 3000, 5000, 8000][[600, 1500, 3000, 5000, 8000].indexOf(t) - 1])
  const balls = []
  for (let id = 1; id <= 80; id++) {
    const d = await page.evaluate((i) => window.__brScene.ballDetail(i), id)
    if (d) balls.push(`#${id}:T${d.tier}@(${Math.round(d.center.pos.x)},${Math.round(d.center.pos.y)})`)
  }
  const recs = await page.evaluate(() => window.__brScene.mergeLocality())
  const v = await page.evaluate(() => window.__brScene.visualState())
  console.log(`\nt=${t}ms renderer=${v.rendererBalls} registered=${v.registered}`)
  console.log('  balls:', balls.join(' '))
  console.log('  records:', JSON.stringify(recs.map((m) => ({ t: m.tier, x: Math.round(m.x), y: Math.round(m.y), def: m.deferredMs }))))
}
await page.screenshot({ path: 'qa/screens/p2132/diag-loss.png' })
await browser.close()
