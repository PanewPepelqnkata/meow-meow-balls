/* global window, console, process */
/**
 * Phase 2.11.0 interaction QA: game-over overlay + restart, ability
 * buttons, pointer-gating, and shared appearance evidence.
 * Usage: node qa/phase2110-interact.mjs [baseURL]
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const BASE = process.argv[2] ?? 'http://localhost:5199'
const VP = [1280, 720]

const near = (c, t, tol) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol && Math.abs(c[2] - t[2]) <= tol
function countNear(png, x0, y0, x1, y1, target, tol) {
  let n = 0
  for (let y = Math.max(0, y0 | 0); y < Math.min(png.height, y1); y++) {
    for (let x = Math.max(0, x0 | 0); x < Math.min(png.width, x1); x++) {
      const i = (y * png.width + x) * 4
      if (near([png.data[i], png.data[i + 1], png.data[i + 2]], target, tol)) n++
    }
  }
  return n
}
function pixelAt(png, x, y) {
  const i = (y * png.width + x) * 4
  return [png.data[i], png.data[i + 1], png.data[i + 2]]
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VP[0], height: VP[1] } })
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await page.waitForTimeout(800)

// ---- 1. Ability buttons work through the real UI (UIScene → bus → world)
const ui = await page.evaluate(() => window.__brScene.uiPositions())
check('uiPositions exposed', !!ui?.abilities?.length, JSON.stringify(ui))

const before = await page.evaluate(() => window.__brState.balls)
await page.mouse.click(ui.abilities[0].x, ui.abilities[0].y) // SWAP — must NOT drop
await page.waitForTimeout(400)
const afterSwap = await page.evaluate(() => window.__brState.balls)
check('swap button click does not drop', afterSwap === before, `balls ${before}→${afterSwap}`)

const tierBefore = await page.evaluate(() => window.__brGame.registry.get('next').tier)
await page.mouse.click(ui.abilities[0].x, ui.abilities[0].y + 0.1) // swap already used → no-op
const tierAfter = await page.evaluate(() => window.__brGame.registry.get('next').tier)
check('swap once-per-run', tierAfter === tierBefore, `tier ${tierBefore}→${tierAfter}`)

await page.mouse.click(ui.abilities[2].x, ui.abilities[2].y) // RAISE
await page.waitForTimeout(300)
const walls = await page.evaluate(() => window.__brScene.wallGeometry())
check('raise button activates walls', walls.phase !== 'idle' && walls.height > 340, `phase=${walls.phase} h=${walls.height}`)
// countdown text pixels above raise button
const shot = await page.screenshot()
const png = PNG.sync.read(shot)
const whiteText = countNear(png, ui.abilities[2].x - 40, ui.abilities[2].y - 60, ui.abilities[2].x + 40, ui.abilities[2].y - 30, [255, 255, 255], 40)
check('walls countdown visible', whiteText > 30, `whitePx=${whiteText}`)

// ---- 2. Claw + preview share the next ball's appearance
const next = await page.evaluate(() => window.__brGame.registry.get('next'))
const TIER_RGB = { 1: [79, 195, 247], 2: [95, 212, 55], 3: [249, 110, 192], 4: [244, 67, 54], 5: [255, 152, 0], 6: [255, 235, 59] }
const tierCol = TIER_RGB[next.tier]
{
  const clawSample = await page.evaluate(() => {
    const g = window.__brGame
    const s = g.scene.getScene('playground')
    const cam = s.cameras.main
    const info = window.__brScene.spawnInfo(g.registry.get('next').tier)
    return { x: info.x, y: info.y, zoom: cam.zoom, cx: cam.width / 2, cy: cam.height / 2 }
  })
  // Phaser 4 camera: screen = (world - centerOn) * zoom + viewportCenter.
  // centerOn target = stage (360, 647.5) from ResponsiveLayout.
  const sx = (clawSample.x - 360) * clawSample.zoom + clawSample.cx
  const sy = (clawSample.y - 647.5) * clawSample.zoom + clawSample.cy
  const c = pixelAt(PNG.sync.read(await page.screenshot()), Math.round(sx), Math.round(sy))
  check('claw holds next tier color', near(c, tierCol, 60), `got rgb(${c.join(',')}) want ${tierCol.join(',')}`)
}
{
  const p2 = await page.evaluate(() => {
    const s = window.__brGame.scene.getScene('UIScene')
    const l = s.uiRoot?.layout_ ?? null
    return l ? { x: Math.round(l.nextBall.pos.x), y: Math.round(l.nextBall.pos.y) } : null
  })
  if (p2) {
    const c = pixelAt(PNG.sync.read(await page.screenshot()), p2.x, p2.y)
    check('preview shows next tier color', near(c, tierCol, 60), `got rgb(${c.join(',')}) want ${tierCol.join(',')}`)
  } else check('preview shows next tier color', false, 'no layout hook')
}

// ---- 3. Game over → overlay → PLAY AGAIN restart
await page.evaluate(() => {
  // Overflow: park a touched ball outside the right wall line below the tops.
  const s = window.__brScene
  s.spawnAt(660, 2, 760)
  s.dropAt(600)
})
await page.waitForTimeout(4500)
const go = await page.evaluate(() => window.__brScene.gameOver())
check('game over triggers', go.over && go.overlay, JSON.stringify(go))
const shot2 = PNG.sync.read(await page.screenshot())
const dimmed = countNear(shot2, 40, 40, 200, 120, [26, 26, 46], 70)
check('overlay dims viewport', dimmed > 200, `dimPx=${dimmed}`)
const btn = go.buttonViewport
await page.mouse.click(btn.x, btn.y)
await page.waitForTimeout(700)
const after = await page.evaluate(() => window.__brScene.gameOver())
check('play again restarts', !after.over && !after.overlay && after.score === 0, JSON.stringify(after))

// ---- 4. Keyboard R restart + Q/E shortcuts still wired
await page.keyboard.press('e')
await page.waitForTimeout(200)
const walls2 = await page.evaluate(() => window.__brScene.wallGeometry())
check('E key raises walls', walls2.height > 400 || walls2.phase !== 'idle', `h=${walls2.height}`)
await page.keyboard.press('r')
await page.waitForTimeout(400)
const afterR = await page.evaluate(() => window.__brScene.wallGeometry())
check('R key restarts (walls reset)', afterR.height < 420, `h=${afterR.height}`)

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n${failed.length} FAILURES` : '\nALL INTERACTION CHECKS PASS')
process.exit(failed.length ? 1 : 0)
