import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the DISCOVERY OVERLAY's sizing.
 *
 * The presentation is "one bold comic statement, NOT a full-screen
 * takeover" (the overlay's own design note), and the character sits on a
 * cream spot-disc ON the band — so the disc must fit INSIDE the band.
 *
 * The defect: the character's radius and the band's height were scaled
 * independently, and the disc was never checked against either. On a
 * 390px phone the character was 94px in radius — a 253px disc, 65% of the
 * screen width — in a 219px band, so the disc spilled 33px over the
 * band's top and bottom edges. Measured on the desktop reference too:
 * a 297px disc in a 243px band (54px over). The phone version looked
 * unported.
 *
 * The guard asserts, at a phone AND a desktop viewport:
 *  1. the disc fits inside the band (both edges),
 *  2. the disc does not take more than its share of the screen width,
 *  3. the character is drawn and the overlay is active.
 */
const failures = []
const { browser, errors } = await bootGame()

const VIEWPORTS = [
  ['phone', 390, 844],
  ['phone-small', 360, 640],
  ['tablet', 820, 1180],
  ['desktop', 1440, 900],
]

for (const [name, w, h] of VIEWPORTS) {
  // A FRESH page per viewport: resizing a live Phaser game tears down its
  // cameras (the scene's resize handler runs against a stale camera), so
  // the viewport must be set BEFORE the game boots.
  const vp = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 900 })
  const vpErrors = []
  vp.on('pageerror', (e) => vpErrors.push(e.message))
  await vp.goto(`${process.env.QA_URL ?? 'http://localhost:5188'}/`, { waitUntil: 'networkidle' })
  await vp.waitForFunction(
    () => {
      const c = document.querySelector('.game-container canvas')
      return c && c.width > 0
    },
    { timeout: 20000 },
  )
  await vp.waitForTimeout(1500)
  // Leave the title screen.
  const play = await vp.evaluate(() => {
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
  await vp.touchscreen.tap(play.x, play.y)
  await vp.waitForTimeout(4000)
  await vp.evaluate(() => {
    window.__brModules.gameBus.emit('discovery:show', { tier: 5, seed: 4242 })
  })
  await vp.waitForTimeout(500)
  const m = await vp.evaluate(() => {
    const g = window.__brGame
    const z = g.scale.displayScale.x || 1
    const vw = g.scale.width / z
    const vh = g.scale.height / z
    const ui = g.scene.getScene('UIScene')
    const ov = ui.discoveryOverlay
    let panel = null
    for (const o of ui.children.list ?? []) {
      if (o.type === 'Container' && o.list?.length >= 4) panel = o
    }
    if (!panel) return null
    const L = ov && typeof ov.layout === 'function' ? ov.layout() : null
    return {
      vw: Math.round(vw),
      vh: Math.round(vh),
      radius: L ? L.displayRadius : null,
      bandH: L ? L.bandH : null,
      active: ov?.isShowing?.() ?? false,
      ballVisible: panel.list[2]?.visible,
    }
  })
  await vp.close()
  if (!m) {
    failures.push(`${name}: the overlay's layout could not be read`)
    continue
  }
  const discD = m.radius * 1.35 * 2
  const widthPct = (discD / m.vw) * 100
  console.log(
    `${name.padEnd(12)} vw=${m.vw} radius=${m.radius?.toFixed(1)} disc=${discD.toFixed(0)}px (${widthPct.toFixed(0)}% of width) band=${m.bandH?.toFixed(0)}px`,
  )
  if (!m.active) failures.push(`${name}: the overlay is not active`)
  // 1. The disc must fit inside the band.
  if (discD > m.bandH) {
    failures.push(`${name}: the disc (${discD.toFixed(0)}px) does not fit the band (${m.bandH.toFixed(0)}px)`)
  }
  // 2. It must not take over the screen.
  if (widthPct > 36) {
    failures.push(`${name}: the disc takes ${widthPct.toFixed(0)}% of the screen width (must be ≤ 36%)`)
  }
  // The character must actually be drawn.
  if (m.ballVisible === false) failures.push(`${name}: the character is not visible`)
}

if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'discovery overlay: the character fits its band on every viewport',
  failures,
  `${VIEWPORTS.length} viewports`,
)
