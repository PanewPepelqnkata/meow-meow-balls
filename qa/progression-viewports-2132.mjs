#!/usr/bin/env node
/**
 * Phase 2.13.2 §4 — progression arc across landscape viewports.
 * Verifies at each size: nodes on-screen, tier colors at nodes 1-3, locked
 * dark nodes 4-10, curve visible in gaps, and node 10 clear of the
 * container's outer-left edge (camera math replicated deterministically).
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { PNG } from 'pngjs'

const url = process.argv[2] || 'http://localhost:5174/?fastboot=1'
const DIR = 'qa/screens/p2132'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SIZES = [
  [1170, 658],
  [1648, 936],
  [1920, 1080],
]

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })

let fail = 0
for (const [vw, vh] of SIZES) {
  await page.setViewportSize({ width: vw, height: vh })
  await wait(600)
  await page.evaluate(() => window.__brScene.restart())
  await wait(700)
  const file = `${DIR}/progression-${vw}x${vh}.png`
  await page.screenshot({ path: file })
  const png = PNG.sync.read(fs.readFileSync(file))
  const px = (x, y) => {
    const i = (Math.round(y) * png.width + Math.round(x)) * 4
    return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
  }

  // Layout math (ResponsiveLayout desktop branch).
  const ds = Math.min(vw / 1648, vh / 936)
  const cx = 184 * (vw / 1648)
  const cy = 1560 * ds
  const r = 777 * ds
  const a0 = -1.7085
  const a1 = -1.0662
  const rr = Math.max(10, 19 * ds)
  const node = (i) => {
    const a = a0 + ((a1 - a0) * i) / 9
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }
  }

  const issues = []
  // All nodes on-screen with margin.
  for (let i = 0; i < 10; i++) {
    const n = node(i)
    if (n.x - rr < 4 || n.y - rr < 4 || n.x + rr > vw - 4 || n.y + rr > vh - 4) {
      issues.push(`node ${i + 1} clipped at (${n.x.toFixed(0)},${n.y.toFixed(0)})`)
    }
  }
  // Tier colors at nodes 1-3.
  const colorHits = (i, test) => {
    const n = node(i)
    let hits = 0
    for (let dx = -rr * 0.55; dx <= rr * 0.55; dx += 1.5)
      for (let dy = -rr * 0.55; dy <= rr * 0.55; dy += 1.5) if (test(px(n.x + dx, n.y + dy))) hits++
    return hits
  }
  const cyan = colorHits(0, (p) => p.b > 200 && p.g > 170 && p.r < 140)
  const green = colorHits(1, (p) => p.g > 150 && p.r < 110 && p.b < 130)
  const pink = colorHits(2, (p) => p.r > 170 && p.b > 110 && p.g < 150)
  if (cyan < 8 || green < 8 || pink < 8) issues.push(`node colors weak: cyan=${cyan} green=${green} pink=${pink}`)
  // Locked nodes dark.
  let lockedDark = 0
  for (let i = 3; i <= 9; i++) {
    const n = node(i)
    let dark = 0
    for (let dx = -rr * 0.9; dx <= rr * 0.9; dx += 1.5)
      for (let dy = -rr * 0.9; dy <= rr * 0.9; dy += 1.5) {
        const p = px(n.x + dx, n.y + dy)
        if (p.r < 60 && p.g < 64 && p.b < 68) dark++
      }
    if (dark >= 20) lockedDark++
  }
  if (lockedDark < 6) issues.push(`only ${lockedDark}/7 locked nodes dark`)
  // Curve visible in inter-node gaps.
  let curveHits = 0
  for (let i = 0; i < 9; i++) {
    const am = a0 + ((a1 - a0) * (i + 0.5)) / 9
    for (let d = 0; d <= 4; d += 2) {
      const p = px(cx + Math.cos(am) * r, cy + Math.sin(am) * r + d - 2)
      if (p.b > 200 && p.r < 130 && p.g > 100 && p.g < 175) curveHits++
    }
  }
  if (curveHits < 10) issues.push(`curve samples low: ${curveHits}`)
  // Node 10 clear of the container's outer-left edge (camera math).
  const zoom = Math.min(vw / 720, vh / 955, (0.279 * vw) / 540, Math.max(0.4, (0.905 * vh - 65.4 - 6) / 855))
  const containerLeft = (90 - 360) * zoom + vw / 2
  const n10 = node(9)
  const margin = containerLeft - (n10.x + rr)
  if (margin < 5) issues.push(`node 10 overlaps container: margin ${margin.toFixed(0)}px`)

  const ok = issues.length === 0
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${vw}×${vh}: nodes on-screen, colors c/g/p=${cyan}/${green}/${pink}, locked ${lockedDark}/7, curve=${curveHits}, container margin=${margin.toFixed(0)}px${ok ? '' : ` — ${issues.join('; ')}`}`)
}
await browser.close()
console.log(fail === 0 ? '\nPROGRESSION ARC VERIFIED ACROSS VIEWPORTS' : `\n${fail} VIEWPORT(S) FAILED`)
process.exit(fail ? 1 : 0)
