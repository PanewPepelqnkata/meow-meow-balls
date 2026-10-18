import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1170, height: 658 } })
await p.goto('http://localhost:5174/?fastboot=1', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 25000 })
await p.waitForTimeout(400)
await p.evaluate(() => window.__brScene.restart())
await p.waitForTimeout(600)
const rows = [1030, 950, 870, 790]
let k = 0
for (let r = 0; r < rows.length; r++) {
  const y = rows[r]
  const off = r % 2 === 0 ? 0 : 85
  for (let x = 235 + off; x <= 505 - off; x += 170) {
    const tier = (k + r) % 2 === 0 ? 4 : 5
    await p.evaluate(({ xx, tt, yy }) => window.__brScene.spawnAt(xx, tt, yy, true), { xx: x, tt: tier, yy: y })
    k++
    await p.waitForTimeout(35)
  }
}
await p.waitForTimeout(2600)
const ids = await p.evaluate(() => [
  window.__brScene.spawnAt(255, 5, 950, true).id,
  window.__brScene.spawnAt(300, 5, 950, true).id,
])
for (let i = 0; i < 16; i++) {
  await p.waitForTimeout(400)
  const s = await p.evaluate((ids) => {
    const d0 = window.__brScene.ballDetail(ids[0])
    return {
      gone: d0 == null,
      state: d0?.state,
      center: d0?.center?.pos,
      sleeping: d0?.center?.sleeping,
      near: d0?.near?.length ?? -1,
    }
  }, ids)
  console.log(i, JSON.stringify(s))
  if (s.gone) break
}
await b.close()
