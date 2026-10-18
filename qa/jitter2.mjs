/* global window, console, process, Image, document */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const BASE = process.argv[2] ?? 'http://localhost:5174/?fastboot=1'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })
for (const x of [280, 440, 360, 320, 400]) {
  await page.evaluate((x) => window.__brScene.dropAt(x), x)
  await page.waitForTimeout(500)
}
await page.waitForTimeout(4000)
const bufA = (await page.screenshot({ type: 'png' })).toString('base64')
await page.waitForTimeout(1000)
const bufB = (await page.screenshot({ type: 'png' })).toString('base64')
const diff = await page.evaluate(async ({ a, b }) => {
  const load = (data) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.src = 'data:image/png;base64,' + data
  })
  const [ia, ib] = await Promise.all([load(a), load(b)])
  const cv = document.createElement('canvas')
  cv.width = ia.width; cv.height = ia.height
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(ia, 0, 0)
  const da = ctx.getImageData(0, 0, ia.width, ia.height).data
  ctx.clearRect(0, 0, ia.width, ia.height)
  ctx.drawImage(ib, 0, 0)
  const db = ctx.getImageData(0, 0, ia.width, ia.height).data
  const grid = {}
  let changed = 0
  for (let y = 0; y < ia.height; y++) {
    for (let x = 0; x < ia.width; x++) {
      const i = (y * ia.width + x) * 4
      const d = Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2])
      if (d > 12) {
        changed++
        const k = `${Math.floor(x/90)*90},${Math.floor(y/90)*90}`
        grid[k] = (grid[k] ?? 0) + 1
      }
    }
  }
  return { changed, total: ia.width * ia.height, grid }
}, { a: bufA, b: bufB })
console.log('JITTER changed=' + diff.changed + '/' + diff.total)
console.log('regions>50:', Object.entries(diff.grid).filter(([,v]) => v > 50).sort((x,y) => y[1]-x[1]).slice(0, 12))
writeFileSync('qa/jitter-grid.json', JSON.stringify(diff, null, 1))
await browser.close()
