import { chromium } from 'playwright'

/**
 * Guards the PRODUCTION `?diag=1` READOUT.
 *
 * The device readout is the only frame-delivery measurement the user can
 * make on the phone, so it must work in a PRODUCTION build. It did not:
 * the physics/render split was only reachable through the dev-only
 * PerfOverlay, so the prod WALL line printed `phys ?ms render ?ms` — the
 * user could see the FPS but not WHERE the frame time went.
 *
 * This guard runs against a production build (vite preview) and asserts:
 *  1. the diag panel is installed in prod,
 *  2. the FPS line is live,
 *  3. the WALL line reports REAL physics and render milliseconds (not
 *     '?'), and
 *  4. the split is plausible (physics + render > 0, both finite).
 *
 * Requires a preview server: QA_PROD_URL (default http://localhost:5199).
 */
const URL = process.env.QA_PROD_URL ?? 'http://localhost:5199/?diag=1'

const failures = []
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
})
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
} catch (e) {
  console.log(`SKIP: no production preview at ${URL} (${e.message})`)
  console.log('  start one with: npm run build && npx vite preview --port 5199')
  await browser.close()
  process.exit(0)
}

await page.waitForFunction(
  () => {
    const c = document.querySelector('.game-container canvas')
    return c && c.width > 0
  },
  { timeout: 20000 },
)
await page.waitForTimeout(1500)

// Leave the title screen.
const play = await page.evaluate(() => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const chipH = Math.round(Math.max(30, Math.min(44, vh * 0.052)))
  const playH = Math.round(Math.max(52, Math.min(76, vh * 0.085)))
  const navH = Math.round(Math.max(40, Math.min(56, vh * 0.058)))
  const chipY = vh - Math.round(Math.max(12, Math.min(22, Math.min(vw, vh) * 0.025))) - chipH / 2
  const nav2Y = chipY - chipH / 2 - 12 - navH / 2
  const nav1Y = nav2Y - navH - 10
  return { x: vw / 2, y: nav1Y - navH / 2 - 12 - playH / 2 }
})
await page.touchscreen.tap(play.x, play.y)
await page.waitForTimeout(4000)
// Play a little so the pile is alive and the timings are real.
for (let i = 0; i < 6; i++) {
  await page.evaluate((x) => window.__brScene?.dropAt(x), 280 + ((i * 37) % 180))
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1500)

const panel = await page.evaluate(() => {
  const all = [...document.querySelectorAll('div')]
  const el = all.find((d) => d.style && d.style.position === 'fixed' && d.style.zIndex === '99999')
  return el ? el.textContent : ''
})

console.log('the production ?diag=1 panel:')
for (const line of panel.split('\n')) console.log(`   ${line}`)

if (!panel) failures.push('the diag panel is not installed in the production build')
if (!/FPS avg /.test(panel)) failures.push('the FPS line is not live in the production build')

const wall = panel.match(/WALL phys ([\d.?]+)ms render ([\d.?]+)ms/)
if (!wall) {
  failures.push('the WALL line is missing from the production readout')
} else {
  const phys = Number(wall[1])
  const rend = Number(wall[2])
  if (!Number.isFinite(phys) || !Number.isFinite(rend)) {
    failures.push(`the WALL line reports a non-numeric split (phys ${wall[1]} render ${wall[2]})`)
  } else if (wall[1] === '?' || wall[2] === '?') {
    failures.push('the production WALL line does not report the physics/render split')
  } else if (phys + rend <= 0) {
    failures.push(`the production WALL line reports zero work (phys ${phys} render ${rend})`)
  } else {
    console.log(`\nthe prod split is live: phys ${phys}ms render ${rend}ms`)
  }
}
if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
if (failures.length) {
  console.log(`FAIL  the production ?diag=1 readout reports the physics/render split`)
  for (const f of failures) console.log(`      - ${f}`)
  process.exit(1)
}
console.log('PASS  the production ?diag=1 readout reports the physics/render split')
