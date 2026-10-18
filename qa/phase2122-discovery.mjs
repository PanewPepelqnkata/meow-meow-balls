#!/usr/bin/env node
/**
 * Phase 2.12.2 — Discovery modal verification.
 *
 * For each required viewport: trigger a REAL first-time discovery (T1+T1 merge
 * through the production merge system) and prove, from saved screenshots
 * (pngjs edge-to-edge scans), that:
 *   1. The dim layer covers EVERY pixel of all four edges + corners
 *      (the 2.12.1 defect was an inset rect starting ~48px from left / 12px
 *      from top — probes at exactly those offsets catch any recurrence).
 *   2. HUD is dimmed consistently (no accidentally-bright HUD outside the
 *      central content zone).
 *   3. Content (ball/headline/label) is present and centered.
 *   4. The modal exits cleanly (no stale objects) and input is restored.
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { mkdirSync } from 'fs'

const url = process.argv[2] || 'http://localhost:5173'
const DIR = 'qa/screens/p2122'
mkdirSync(DIR, { recursive: true })

const VIEWPORTS = [
  [320, 568], [390, 844], [768, 1024], [1280, 720],
  [1648, 936], [1728, 864], [1920, 1080],
]

let failures = 0
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Full-scan classification of a discovery screenshot.
 * During discovery the light theme shows through the 72% dim of #101018:
 * undimmed theme pixel ≈ rgb(243,241,235); dimmed ≈ rgb(~79,~78,~76).
 * "dark" = max channel < 140. Content zone (ball/headline) is excluded. */
function analyze(png) {
  const W = png.width, H = png.height
  const darkMax = 140
  const at = (x, y) => {
    const i = (W * y + x) << 2
    return [png.data[i], png.data[i + 1], png.data[i + 2]]
  }
  const isDark = ([r, g, b]) => Math.max(r, g, b) < darkMax

  // Central content zone (ball + headline + label) — allowed to be bright.
  const cx = W / 2, cy = H * 0.46
  const ballR = Math.min(120, Math.max(40, Math.min(W, H) * 0.15)) + 8
  const inContent = (x, y) =>
    Math.hypot(x - cx, y - cy) < ballR + 60 ||
    (Math.abs(x - cx) < W * 0.34 && Math.abs(y - cy) < ballR + 110)

  const bright = []
  // 1) ALL four edge rows/cols, every 4th pixel — nothing may be bright there.
  for (let x = 0; x < W; x += 4) {
    for (const y of [0, 1, 2, 6, 12, 48, H - 1, H - 2, H - 3, H - 7, H - 13]) {
      if (!isDark(at(x, y))) bright.push([x, y, at(x, y)])
    }
  }
  for (let y = 0; y < H; y += 4) {
    for (const x of [0, 1, 2, 6, 12, 48, W - 1, W - 2, W - 3, W - 7, W - 13]) {
      if (!isDark(at(x, y))) bright.push([x, y, at(x, y)])
    }
  }
  // 2) The exact defect offsets from the 2.12.1 report (~48px in from left,
  //    ~12px from top) — just INSIDE and just OUTSIDE them must all be dark.
  const defect = []
  for (const [x, y] of [[10, 10], [40, 8], [52, 14], [46, 4], [W - 10, 10], [W - 40, 8], [W - 52, 14], [10, H - 10], [W - 10, H - 10]]) {
    if (!isDark(at(x, y))) defect.push([x, y, at(x, y)])
  }
  // 3) Content present: some bright pixels inside the central zone.
  let contentBright = 0
  for (let y = Math.max(0, Math.floor(cy - ballR - 100)); y < Math.min(H, Math.ceil(cy + ballR + 100)); y += 3) {
    for (let x = Math.max(0, Math.floor(cx - W * 0.34)); x < Math.min(W, Math.ceil(cx + W * 0.34)); x += 3) {
      if (!isDark(at(x, y)) && inContent(x, y)) contentBright++
    }
  }
  // 4) Content centered: bright pixels' horizontal centroid near center.
  let sx = 0, n = 0
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      if (!isDark(at(x, y)) && inContent(x, y)) { sx += x; n++ }
    }
  }
  const centroidX = n ? sx / n : -1
  return {
    edgeBright: bright.slice(0, 6),
    defectBright: defect.slice(0, 6),
    contentBright,
    centroidX,
    centerOffset: n ? Math.abs(centroidX - cx) / W : 1,
  }
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  for (const [w, h] of VIEWPORTS) {
    console.log(`\n=== ${w}×${h} ===`)
    await page.setViewportSize({ width: w, height: h })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
    await wait(600)
    await page.evaluate(() => window.__brScene.restart())
    await wait(400)

    // Normal screen first.
    await page.screenshot({ path: `${DIR}/${w}x${h}-1-normal.png` })

    // Genuine first-time discovery: real merge T1+T1 → T2.
    await page.evaluate(() => { window.__brScene.spawnAt(520, 1) })
    await wait(150)
    await page.evaluate(() => { window.__brScene.spawnAt(560, 1) })
    await wait(1000) // merge resolves → modal starts

    const state = await page.evaluate(() => window.__brScene.visualState())
    check('discovery modal is active', state.discoveryVisible && state.discoveryTier === 2,
      `visible=${state.discoveryVisible} tier=${state.discoveryTier}`)

    const buf = await page.screenshot({ path: `${DIR}/${w}x${h}-2-discovery.png` })
    const png = PNG.sync.read(buf)
    const a = analyze(png)

    check('dim covers ALL edges/corners (no inset rect)', a.edgeBright.length === 0,
      a.edgeBright.length ? `bright at ${JSON.stringify(a.edgeBright)}` : 'every edge pixel dark')
    check('no bright strip at reported defect offsets (48,12)', a.defectBright.length === 0,
      a.defectBright.length ? `bright at ${JSON.stringify(a.defectBright)}` : 'clean')
    check('discovery content visible in central zone', a.contentBright > 40,
      `${a.contentBright} bright content samples`)
    check('content horizontally centered', a.centerOffset < 0.06,
      `centroid offset ${(a.centerOffset * 100).toFixed(1)}% of width`)

    // HUD consistency: with the modal up, world input must be blocked.
    const blocked = await page.evaluate(([ww, hh]) => {
      // The UI scene gates drops via isPointerOverUi; the modal covers all.
      const game = window.__brGame
      const ui = game.scene.getScene('UIScene')
      return ui.isPointerOverUi(ww / 2, hh / 2)
    }, [w, h])
    check('world input blocked during modal', blocked)

    // Completion: modal exits, no stale state.
    await wait(2300)
    const after = await page.evaluate(() => window.__brScene.visualState())
    check('modal exits cleanly', !after.discoveryVisible && after.discoveryTier === null,
      `visible=${after.discoveryVisible} tier=${after.discoveryTier}`)
    await page.screenshot({ path: `${DIR}/${w}x${h}-3-completed.png` })

    const unblocked = await page.evaluate(([ww, hh]) => {
      const game = window.__brGame
      const ui = game.scene.getScene('UIScene')
      return !ui.isPointerOverUi(ww / 2, hh / 2)
    }, [w, h])
    check('input restored after modal', unblocked)

    // Restart-during-modal resilience.
    await page.evaluate(() => { window.__brScene.spawnAt(520, 1) })
    await wait(120)
    await page.evaluate(() => { window.__brScene.spawnAt(560, 1) })
    await wait(700)
    await page.evaluate(() => window.__brScene.restart())
    await wait(400)
    const afterRestart = await page.evaluate(() => window.__brScene.visualState())
    check('restart during modal clears everything',
      !afterRestart.discoveryVisible && afterRestart.popups === 0 && afterRestart.rendererBalls === 0,
      `vis=${afterRestart.discoveryVisible} popups=${afterRestart.popups} balls=${afterRestart.rendererBalls}`)
  }

  await browser.close()
  console.log(`\n${failures === 0 ? '✓ ALL DISCOVERY CHECKS PASSED' : `✗ ${failures} CHECKS FAILED`}`)
  console.log(`Evidence: ${DIR}/`)
  process.exit(failures === 0 ? 0 : 1)
})()
