import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 400 } })
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes')
const report = await page.evaluate(async () => {
  const fam = '"Lilita One", "Arial Black", sans-serif'
  await document.fonts.load('72px "Lilita One"')
  const out = []
  for (const sz of [36, 45, 72]) {
    for (const ch of ['L', 'U', 'S', 'H', 'B']) {
      const c = document.createElement('canvas')
      const g = c.getContext('2d')
      g.font = `${sz}px ${fam}`
      const m = g.measureText(ch)
      out.push({
        sz, ch,
        w: Math.round(m.width),
        asc: Math.round(m.actualBoundingBoxAscent),
        desc: Math.round(m.actualBoundingBoxDescent),
        right: Math.round(m.actualBoundingBoxRight),
        left: Math.round(m.actualBoundingBoxLeft),
        families: [...document.fonts].map((f) => `${f.family}/${f.status}`).join(' | '),
      })
    }
    const stamp = await document.fonts.check(`${sz}px ${fam}`)
    out.push({ sz, loaded: stamp, ch: 'CHECK' })
  }
  return out
})
for (const r of report) console.log(JSON.stringify(r))
await browser.close()
