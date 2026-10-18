/* global window, console, process */
/* Phase 2.9.9 Raise Walls browser verification — production game, no query
 * params. Captures screenshots at all five wall phases and measures the LIVE
 * Matter collider vertices (window.__brScene.wallGeometry) at each one:
 *   1. floor vertices identical in every phase,
 *   2. wall footpoints fixed,
 *   3. wall tops move UP during raising,
 *   4. raised height > normal height,
 *   5. geometry returns exactly to normal after expiry.
 * Vertex ORDER from Matter is not stable across rebuilds, so the script
 * derives tops/footpoints geometrically (min/max y) and compares vertex SETS.
 * Writes qa/walls-report.json + qa/screens/w*.png.
 * Usage: node qa/walls.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173/'
mkdirSync('qa/screens', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', null, { timeout: 20000 })

for (const x of [300, 420]) {
  await page.evaluate((x) => window.__brScene.dropAt(x), x)
  await page.waitForTimeout(600)
}
await page.waitForTimeout(2500)

const geo = () => page.evaluate(() => window.__brScene.wallGeometry())
const shot = (name) => page.screenshot({ path: `qa/screens/${name}.png`, type: 'png' })
const waitForPhase = async (phase, timeoutMs = 8000) => {
  await page.waitForFunction(
    (p) => window.__brScene.wallGeometry().phase === p,
    phase,
    { timeout: timeoutMs, polling: 120 },
  )
}

/** Geometric measurements independent of Matter's vertex ordering. */
const measure = (g) => {
  const wallPts = (wall) => {
    const ys = wall.map((v) => v.y)
    const top = Math.min(...ys)
    const foot = Math.max(...ys)
    // footpoints: the (up to 2) vertices at max y, sorted for stable compare
    const footPts = wall.filter((v) => Math.abs(v.y - foot) < 0.05).map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).sort()
    // tops: the (up to 2) vertices at min y
    const topPts = wall.filter((v) => Math.abs(v.y - top) < 0.05).map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).sort()
    return { top: +top.toFixed(1), foot: +foot.toFixed(1), footPts, topPts }
  }
  return { phase: g.phase, height: g.height, left: wallPts(g.left), right: wallPts(g.right), floor: g.floor, raw: g }
}

const report = { phases: [], checks: {} }
const capture = async (label, file) => {
  const m = measure(await geo())
  await shot(file)
  report.phases.push({ label, file: `qa/screens/${file}.png`, ...m })
  console.log(`${label}: phase=${m.phase} h=${m.height} topL=${m.left.top} footL=${m.left.footPts.join('/')} floorY=${m.floor[0].y}`)
  return m
}

const normal0 = await capture('normal (before)', 'w0-walls-normal')

// Activate via the real HUD button (extend power at stage (216, 1236))
const raiseBtn = (await page.evaluate(() => window.__brScene.uiPositions())).abilities[2]
await page.mouse.click(raiseBtn.x, raiseBtn.y)
await page.waitForTimeout(450) // mid raise (900ms ease)
const midRaise = await capture('mid raise', 'w1-raise-mid')
await waitForPhase('raised')
const raised = await capture('fully raised', 'w2-raise-full')

// hold is 25s; poll for the lowering to start, then capture mid-way
await waitForPhase('lowering', 30_000)
await page.waitForTimeout(450)
const midLower = await capture('mid lowering', 'w3-lower-mid')
await waitForPhase('normal')
await page.waitForTimeout(200)
const backNormal = await capture('normal (after expiry)', 'w4-walls-normal-again')

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const vkey = (wall) => JSON.stringify(wall.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).sort())
report.checks = {
  floorFixedEveryPhase: report.phases.every((p) => same(p.floor, normal0.floor)),
  footpointsFixedEveryPhase: report.phases.every((p) => same(p.left.footPts, normal0.left.footPts) && same(p.right.footPts, normal0.right.footPts)),
  topsMoveUpDuringRaise: midRaise.left.top < normal0.left.top && midRaise.right.top < normal0.right.top,
  raisedHeightGreaterThanNormal: raised.height > normal0.height,
  raisedTopsAboveNormalTops: raised.left.top < normal0.left.top,
  topsMoveBackDownDuringLowering: midLower.left.top > raised.left.top && midLower.left.top < normal0.left.top,
  // Matter may ROTATE the vertex list when rebuilding a body (setVertices
  // re-orients the hull), so compare geometry as sorted vertex sets
  geometryReturnsAfterExpiry:
    vkey(backNormal.raw.left) === vkey(normal0.raw.left) &&
    vkey(backNormal.raw.right) === vkey(normal0.raw.right) &&
    backNormal.phase === 'normal',
}
console.log('CHECKS', JSON.stringify(report.checks, null, 2))
writeFileSync('qa/walls-report.json', JSON.stringify(report, null, 2))
await browser.close()
const pass = Object.values(report.checks).every(Boolean)
console.log(pass ? 'WALLS VERIFICATION PASS' : 'WALLS VERIFICATION FAIL')
process.exit(pass ? 0 : 1)
