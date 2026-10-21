import { chromium } from 'playwright'

/**
 * Shared helpers for the browser QA scripts.
 *
 * The QA scripts guard invariants that CANNOT be unit-tested here: the
 * repo has no Phaser-in-vitest infrastructure (phaser's package exports
 * block the deep imports the test runner needs), and the crash class this
 * guards is a Phaser-internal one — a texture removed while a live sprite
 * is bound to it.
 */

export const QA_URL = process.env.QA_URL ?? 'http://localhost:5188'

/** Boot the game and start a run. Returns the Playwright page. */
export async function bootGame({ diag = true } = {}) {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // The fault containment logs the FIRST contained frame error on
    // purpose — that is the mechanism working, not a failure.
    if (m.text().includes('contained a frame error')) return
    errors.push(`CONSOLE: ${m.text()}`)
  })
  await page.goto(`${QA_URL}${diag ? '/?diag=1' : '/'}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => {
      const c = document.querySelector('.game-container canvas')
      return c && c.width > 0
    },
    { timeout: 20000 },
  )
  await page.waitForTimeout(1500)
  // Tap the play button to leave the title screen.
  const play = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const m = Math.round(Math.max(12, Math.min(22, Math.min(vw, vh) * 0.025)))
    const chipH = Math.round(Math.max(30, Math.min(44, vh * 0.052)))
    const playH = Math.round(Math.max(52, Math.min(76, vh * 0.085)))
    const navH = Math.round(Math.max(40, Math.min(56, vh * 0.058)))
    const chipY = vh - m - chipH / 2
    const nav2Y = chipY - chipH / 2 - 12 - navH / 2
    const nav1Y = nav2Y - navH - 10
    return { x: vw / 2, y: nav1Y - navH / 2 - 12 - playH / 2 }
  })
  await page.touchscreen.tap(play.x, play.y)
  await page.waitForFunction(
    () => window.__brGame?.scene.getScene('StartIntroScene')?.scene.settings.status === 8,
    { timeout: 60000 },
  )
  await page.waitForTimeout(800)
  return { browser, page, errors }
}

/** The current frame counter, or -1 if the game is not running. */
export async function frameCount(page) {
  return page.evaluate(() => window.__brGame?.loop?.frame ?? -1)
}

/**
 * Report the result and set the process exit code.
 * `failures` is a list of human-readable failure descriptions.
 */
export function report(name, failures, extra = '') {
  if (extra) console.log(extra)
  if (failures.length === 0) {
    console.log(`PASS  ${name}`)
    process.exit(0)
  }
  console.log(`FAIL  ${name}`)
  for (const f of failures) console.log(`      - ${f}`)
  process.exit(1)
}
