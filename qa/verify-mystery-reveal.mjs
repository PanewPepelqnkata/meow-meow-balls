import { chromium } from 'playwright'
import { report } from './lib-game.mjs'

/**
 * Guards the MYSTERY REVEAL — the collectible card's entrance.
 *
 * The user asked for: "a reveal of the card with a huge question mark in
 * the middle of the card and black background and then the card pops".
 *
 * The guard asserts the three beats of that sequence, by sampling the
 * LIVE state (not a screenshot — a screenshot's round-trip drifts the
 * timeline):
 *
 *  1. the MYSTERY: the "?" is visible and the screen is fully BLACK
 *     (the dim is opaque) — and the card is NOT up yet;
 *  2. the POP: the card arrives, the "?" is gone, and the dim eases back
 *     to the card's dim;
 *  3. the DURATION: the card stays on screen long enough to read
 *     (the dismiss timer counts from the card's arrival, not from the
 *     start of the reveal — before the fix the card was visible for less
 *     than a second).
 */
const failures = []
const URL = process.env.QA_URL ?? 'http://localhost:5188/?discovery=card'

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
})
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(
  () => {
    const c = document.querySelector('.game-container canvas')
    return c && c.width > 0
  },
  { timeout: 20000 },
)
await page.waitForTimeout(1500)
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

// Sample the whole reveal from inside the page (no round-trip drift).
const timeline = await page.evaluate(async () => {
  const ui = window.__brGame.scene.getScene('UIScene')
  const samples = []
  window.__brModules.gameBus.emit('discovery:show', { tier: 5, seed: 4242 })
  const t0 = performance.now()
  for (let i = 0; i < 26; i++) {
    await new Promise((r) => setTimeout(r, 120))
    const ov = ui.discoveryOverlay
    const dim = ov.dimImage ?? ov.dimRect
    samples.push({
      t: Math.round(performance.now() - t0),
      mystery: ov.mysteryText ? ov.mysteryText.visible && ov.mysteryText.alpha > 0.1 : false,
      mysteryAlpha: ov.mysteryText ? +ov.mysteryText.alpha.toFixed(2) : -1,
      panel: ov.panel ? +ov.panel.alpha.toFixed(2) : -1,
      dim: dim ? +dim.alpha.toFixed(2) : -1,
      active: ov.isShowing(),
    })
  }
  return samples
})

for (const s of timeline) {
  console.log(
    `${String(s.t).padStart(4)}ms  mystery=${s.mystery ? 'YES' : 'no '}  panel=${s.panel}  dim=${s.dim}  active=${s.active}`,
  )
}

// 1. THE MYSTERY: the "?" is up, the screen is black, the card is not.
const mysteryPhase = timeline.filter((s) => s.mystery && s.panel < 0.5)
if (mysteryPhase.length === 0) failures.push('the "?" never appeared')
else {
  const black = mysteryPhase.every((s) => s.dim > 0.95)
  if (!black) failures.push('the reveal was not on a black screen (the dim was not fully opaque)')
  console.log(`\nthe "?" held for ${mysteryPhase.length * 120}ms on a black screen`)
}

// 2. THE POP: the card arrives and the "?" goes.
const popped = timeline.find((s) => !s.mystery && s.panel > 0.9)
if (!popped) failures.push('the card never appeared')
else {
  console.log(`the card popped at ${popped.t}ms`)
  // And the dim eases back to the card's dim.
  const after = timeline.find((s) => s.t > popped.t + 400)
  if (after && after.dim > 0.95) failures.push('the background stayed fully black after the card arrived')
}

// 3. THE DURATION: the card stays up long enough to read.
if (popped) {
  const stillUp = timeline.filter((s) => s.t > popped.t && s.active)
  const readMs = stillUp.length ? stillUp[stillUp.length - 1].t - popped.t : 0
  console.log(`the card stayed up for ${readMs}ms`)
  if (readMs < 2000) {
    failures.push(`the card was only up for ${readMs}ms — too short to read the name, the stats and the flavour`)
  }
}

if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'the mystery reveal: a "?" on black, then the card pops and stays',
  failures,
  `mystery held ${mysteryPhase.length * 120}ms`,
)
