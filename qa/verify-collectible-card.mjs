import { chromium } from 'playwright'
import { report } from './lib-game.mjs'

/**
 * Guards the COLLECTIBLE CARD's presentation.
 *
 * The card must:
 *  1. be CENTRED on the viewport (it was low, below the middle);
 *  2. be LARGE and dramatic (it is the whole point of the moment);
 *  3. HIDE THE HUD — the score, the best, the next-ball preview, the tier
 *     track and the ability bar all sat around the card and made it look
 *     broken;
 *  4. have a DARKENED background (the dim covers the whole camera);
 *  5. have a GLOW BEHIND the card (the light spills out past its edges);
 *  6. restore the HUD when it is dismissed.
 */
const failures = []
const URL = process.env.QA_PROD_URL ?? 'http://localhost:5188/?discovery=card'

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

const read = () =>
  page.evaluate(() => {
    const g = window.__brGame
    const ui = g.scene.getScene('UIScene')
    const ov = ui.discoveryOverlay
    const L = ov.layout()
    const dim = ov.dimImage ?? ov.dimRect
    const glow = ov.glowG
    const cam = ui.cameras.main
    const hud = ui.children.list.filter((c) => {
      const d = c.depth ?? 0
      return d < 78 && d >= 30
    })
    return {
      vw: Math.round(L.vw),
      vh: Math.round(L.vh),
      ballY: Math.round(L.ballY),
      cardCentreY: Math.round(L.cardCentreY),
      radius: Math.round(L.displayRadius),
      dimAlpha: dim ? +dim.alpha.toFixed(2) : -1,
      dimW: dim ? dim.displayWidth : 0,
      dimH: dim ? dim.displayHeight : 0,
      camW: cam ? cam.width : 0,
      camH: cam ? cam.height : 0,
      // The glow blooms when the card lands, so it is checked AFTER the
      // card has arrived (at the moment the card pops).
      glowVisible: glow ? glow.visible : false,
      glowAlpha: glow ? +glow.alpha.toFixed(2) : -1,
      hudVisible: hud.filter((c) => c.visible).length,
      hudTotal: hud.length,
      active: ov.isShowing(),
    }
  })

// The HUD is up before the card.
const before = await read()
if (before.hudVisible === 0) failures.push('the HUD was already hidden before the card')

await page.evaluate(() => {
  window.__brModules.gameBus.emit('discovery:show', { tier: 5, seed: 4242 })
})
await page.waitForTimeout(800)
const during = await read()
console.log('during the card:', JSON.stringify(during, null, 1))

// 1. The card is centred.
if (Math.abs(during.cardCentreY - during.vh / 2) > during.vh * 0.08) {
  failures.push(
    `the card is not centred (its centre is at y=${during.cardCentreY}, the viewport's middle is ${Math.round(during.vh / 2)})`,
  )
}
// 2. It is big and dramatic.
if (during.radius < 26) failures.push(`the character is tiny (radius ${during.radius}px)`)
// 3. The HUD is hidden.
if (during.hudVisible !== 0) {
  failures.push(`${during.hudVisible} HUD objects are still visible behind the card`)
}
// The state AFTER the card has popped (the glow blooms then, and the dim
// eases back to the card's dim).
const afterPop = await read()

// 4. The background is darkened, and the dim covers the WHOLE camera.
// The dim is sized in WORLD units (the camera's world view), while
// camW/camH are the camera's BUFFER size (world × zoom) — so the
// comparison must be against the world view.
// The dim's alpha right after the card arrives is the card's dim (the
// reveal's full black is asserted by the qa:reveal guard).
if (afterPop.dimAlpha < 0.5) failures.push(`the background is not darkened (dim alpha ${afterPop.dimAlpha})`)
// The dim is an IMAGE with scrollFactor 0, sized to the camera's BUFFER
// (the device pixels) — it must cover the whole buffer.
if (during.dimW < during.camW * 0.98 || during.dimH < during.camH * 0.98) {
  failures.push(
    `the dim does not cover the screen (${during.dimW}x${during.dimH}, the camera's buffer is ${during.camW}x${during.camH})`,
  )
}
// 5. The glow is behind the card — it blooms when the card lands, so
// it is checked a moment AFTER the card has arrived.
if (!afterPop.glowVisible) failures.push('the glow behind the card is not visible')

// 6. The HUD comes back.
await page.evaluate(() => {
  window.__brModules.gameBus.emit('ui:restart', {})
})
await page.waitForTimeout(2600)
const after = await read()
if (after.hudVisible === 0) failures.push('the HUD did not come back after the card')

if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'the collectible card: centred, dramatic, the HUD hidden, a glow behind it',
  failures,
  `centre=${during.cardCentreY}/${during.vh} hud=${during.hudVisible}/${during.hudTotal} dim=${during.dimAlpha}`,
)
