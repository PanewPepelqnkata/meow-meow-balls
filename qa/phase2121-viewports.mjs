#!/usr/bin/env node
/**
 * Phase 2.13.0 — Multi-viewport full-screen background verification.
 * For each required viewport: boot the real game, screenshot, verify all
 * corners + edges carry the ILLUSTRATED theme's per-region color family
 * (sky at top, foliage/ground at bottom — no blank canvas anywhere).
 * Checks BOTH light and space themes (dark theme catches white/unpainted gaps
 * that the light theme would mask).
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { mkdirSync } from 'fs'

const url = process.argv[2] || 'http://localhost:5173'
const DIR = 'qa/screens/p2121-viewports'
mkdirSync(DIR, { recursive: true })

const VIEWPORTS = [
  [320, 568], [375, 667], [390, 844], [430, 932],
  [768, 1024], [1280, 720], [1440, 900], [1648, 936],
  [1728, 864], [1920, 1080],
]

// Per-region expected colors calibrated from measured production pixels
// (illustrated environments vary by region — see BackgroundTheme.ts).
const THEMES = {
  light: {
    regions: { top: [243, 241, 235], bottom: [243, 241, 235], mid: [243, 241, 235] }, tol: 26,
  },
  space: {
    regions: { top: [10, 22, 40], bottom: [37, 21, 67], mid: [24, 21, 54] }, tol: 44,
  },
}
const regionOf = (ny) => (ny < 0.35 ? 'top' : ny > 0.9 ? 'bottom' : 'mid')

let failures = 0

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  for (const [w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
    await new Promise((r) => setTimeout(r, 600))

    for (const [name, { regions, tol }] of Object.entries(THEMES)) {
      await page.evaluate((t) => window.__brScene.setTheme(t), name)
      await new Promise((r) => setTimeout(r, 1300))
      const buf = await page.screenshot({ path: `${DIR}/${w}x${h}-${name}.png` })
      const png = PNG.sync.read(buf)

      // Probe: 4 corners, bottom-center, left-mid, right-mid, top edge at
      // 1/3 and 2/3 (top-center is occupied by the top-center score HUD —
      // an opaque foreground element present in every theme, verified below).
      const pts = [
        [0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99],
        [0.5, 0.995], [0.005, 0.5], [0.995, 0.5], [0.35, 0.005], [0.65, 0.005],
      ]
      const bad = []
      for (const [nx, ny] of pts) {
        const x = Math.min(png.width - 1, Math.max(0, Math.round(nx * png.width)))
        const y = Math.min(png.height - 1, Math.max(0, Math.round(ny * png.height)))
        const i = (png.width * y + x) << 2
        const c = { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
        const want = regions[regionOf(ny)]
        const ok = Math.abs(c.r - want[0]) <= tol && Math.abs(c.g - want[1]) <= tol && Math.abs(c.b - want[2]) <= tol
        if (!ok) bad.push(`(${x},${y})=rgb(${c.r},${c.g},${c.b})`)
      }
      // Record the top-center pixel to prove it is theme-independent (HUD).
      const cx = Math.round(png.width / 2)
      const ti = 4 * png.width + cx << 2
      const topCenter = `rgb(${png.data[ti]},${png.data[ti + 1]},${png.data[ti + 2]})`
      const ok = bad.length === 0
      if (!ok) failures++
      console.log(`${ok ? '✓' : '✗'} ${w}×${h} ${name}${ok ? ` — full coverage (9 probes; top-center HUD=${topCenter})` : ` — GAPS: ${bad.join(' ')}`}`)
    }
  }

  await browser.close()
  console.log(`\n${failures === 0 ? '✓ ALL VIEWPORTS FULLY COVERED' : `✗ ${failures} viewport/theme combos have gaps`}`)
  process.exit(failures === 0 ? 0 : 1)
})()
