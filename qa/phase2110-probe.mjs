/* global window, console, process, document */
/**
 * Phase 2.11.0 pixel-level visual QA.
 *
 * The model session cannot inspect images directly, so this script verifies
 * the RENDERED SCREENSHOTS programmatically: it decodes each
 * qa/screens/p11-<w>x<h>.png and asserts on actual pixel colors at the
 * layout-defined positions — warm background + grid, green score text,
 * yellow Check Out, blue ability buttons, striped container, claw gold,
 * and tier-colored ball pixels inside the container.
 *
 * Usage: node qa/phase2110-probe.mjs [baseURL]
 * Exits non-zero on any failure; prints a PASS/FAIL line per viewport.
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const BASE = process.argv[2] ?? 'http://localhost:5199'
const VIEWPORTS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1280, 720],
  [1440, 900],
  [1648, 936],
  [1920, 1080],
]

const near = (c, t, tol) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol && Math.abs(c[2] - t[2]) <= tol
const countNear = (png, x0, y0, x1, y1, target, tol) => {
  let n = 0
  for (let y = Math.max(0, y0 | 0); y < Math.min(png.height, y1); y++) {
    for (let x = Math.max(0, x0 | 0); x < Math.min(png.width, x1); x++) {
      const i = (y * png.width + x) * 4
      if (near([png.data[i], png.data[i + 1], png.data[i + 2]], target, tol)) n++
    }
  }
  return n
}

// Reference colors (matching src/ui modules and ballTiers).
const BG = [243, 241, 235] // #F3F1EB
const GRID = [215, 220, 224] // #D7DCE0
const GREEN = [0, 232, 59] // #00E83B score
const YELLOW = [255, 217, 59] // #FFD93B checkout
const BLUE = [45, 116, 201] // #2D74C9 abilities
const GOLD = [255, 201, 59] // #FFC93B claw
const WHITE = [255, 255, 255]
const BLACK = [26, 26, 26]

const failures = []
const browser = await chromium.launch()
for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${BASE}/?vp=${w}x${h}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await page.waitForTimeout(1000)
  await page.evaluate(() => {
    const s = window.__brScene
    s.dropAt(360)
    s.dropAt(300)
    s.dropAt(420)
  })
  await page.waitForTimeout(2200)
  // Face-containment probe needs a SETTLED pile: sleeping balls ⇒ no active
  // merge bursts (their white flash particles would read as face pixels).
  await page
    .waitForFunction(
      () => {
        const t = window.__brScene.telemetry()
        return t.balls.length > 0 && t.balls.every((b) => b.sleeping)
      },
      { timeout: 12000 },
    )
    .catch(() => {})
  // POPUP_TTL_MS is 700ms — wait past it so no merge "+N" popup lingers.
  await page.waitForTimeout(1500)

  const ui = await page.evaluate(() => window.__brScene.uiPositions())
  const st = await page.evaluate(() => ({ tiers: window.__brState.tiers, score: window.__brState.score }))
  const shot = await page.screenshot()
  const png = PNG.sync.read(shot)

  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok, detail })

  // 1. Warm background visible in the top-left corner region: sample a small
  // patch and accept the warm bg OR a grid line (lines run under the corner
  // depending on viewport size).
  let bgOk = 0
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * png.width + x) * 4
      const px = [png.data[i], png.data[i + 1], png.data[i + 2]]
      if (near(px, BG, 14) || near(px, GRID, 14)) bgOk++
    }
  }
  check('warm bg corner', bgOk >= 60, `bgPx=${bgOk}/64`)

  // 2. Grid lines present somewhere along the top rows (desktop: 40px cells;
  // mobile: 26px). Scan a horizontal strip free of UI on desktop; on mobile
  // scan just above the mid line.
  const gy = Math.floor(h * 0.45)
  let gridHits = 0
  for (let x = 1; x < w - 1; x++) {
    const i = (gy * png.width + x) * 4
    const px = [png.data[i], png.data[i + 1], png.data[i + 2]]
    if (near(px, GRID, 14)) gridHits++
  }
  check('grid lines present', gridHits > 8, `hits=${gridHits}`)

  // 3. Score green text top-center.
  const greenTop = countNear(png, w / 2 - 150, 0, w / 2 + 150, h * 0.18, GREEN, 60)
  check('green score top-center', greenTop > 40, `greenPx=${greenTop}`)

  // 4. Check Out yellow button.
  if (ui?.checkout) {
    const s = Math.min(w, h) * 0.09
    const yel = countNear(png, ui.checkout.x - s, ui.checkout.y - s, ui.checkout.x + s, ui.checkout.y + s, YELLOW, 60)
    check('checkout yellow', yel > 50, `yellowPx=${yel} at ${Math.round(ui.checkout.x)},${Math.round(ui.checkout.y)}`)
  } else check('checkout yellow', false, 'no uiPositions hook')

  // 5. Ability buttons blue.
  if (ui?.abilities?.length) {
    const s = Math.min(w, h) * 0.05
    let totalBlue = 0
    for (const c of ui.abilities) {
      totalBlue += countNear(png, c.x - s, c.y - s, c.x + s, c.y + s, BLUE, 60)
    }
    check('ability buttons blue', totalBlue > 300, `bluePx=${totalBlue}`)
  } else check('ability buttons blue', false, 'no uiPositions hook')

  // 6. Striped container: black + white stripes somewhere in the lower-middle.
  // Phase 2.11.1: threshold lowered 200→140 — the old count was inflated by
  // the (buggy) oversized eye whites; corrected faces draw far less white.
  const stripeZone = [w / 2 - w * 0.2, h * 0.5, w / 2 + w * 0.2, h * 0.92]
  const black = countNear(png, ...stripeZone, BLACK, 40)
  const whiteStripe = countNear(png, ...stripeZone, WHITE, 12)
  check('container stripes', black > 200 && whiteStripe > 90, `black=${black} white=${whiteStripe}`)

  // 7. Tier-colored ball pixels inside the container zone.
  const { getTierColor } = await import('./tierColors.mjs')
  let ballPx = 0
  for (const tier of st.tiers) {
    const col = getTierColor(tier)
    ballPx += countNear(png, ...stripeZone, col, 40)
  }
  check('ball characters visible', ballPx > 80, `ballPx=${ballPx} tiers=${st.tiers.join(',')}`)

  // 8. Claw gold above the container (desktop + portrait: spawn zone upper
  // middle of the screen).
  const gold = countNear(png, w / 2 - w * 0.15, h * 0.02, w / 2 + w * 0.15, h * 0.55, GOLD, 50)
  check('claw present', gold > 60, `goldPx=${gold}`)

  // 9. No horizontal scroll.
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth)
  check('no horizontal scroll', scroll <= w, `scrollWidth=${scroll}`)

  // 10. FACE CONTAINMENT (Phase 2.11.1 Priority 7): every pure-white pixel
  // in the CONTAINER INTERIOR region (sclera + pupil highlights — nothing
  // else in the game renders pure white there; the striped walls/floor are
  // white but lie OUTSIDE the interior) must sit within 0.714·R + 2.5px of
  // SOME ball center. Catches eyes/mouth/highlights escaping their own ball
  // AND faces bleeding onto neighbors. The claw-held ball is included as a
  // ball; the next-ball preview is checked separately in its own disc.
  const sceneData = await page.evaluate(([w, h]) => {
    const cam = window.__brGame.scene.getScene('playground').cameras.main
    // Phaser semantics: worldView.x/y is the world point at viewport (0,0).
    const proj = (x, y) => ({ x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom })
    const rad = { 1: 38, 2: 48, 3: 57, 4: 75, 5: 97, 6: 126, 7: 164 }
    const balls = window.__brScene.telemetry().balls.map((b) => {
      const p = proj(b.cx, b.cy)
      return { x: p.x, y: p.y, r: (rad[b.tier] ?? 38) * cam.zoom }
    })
    const tier = window.__brGame.registry.get('next') ?? 1
    // The claw's ACTUAL displayed ball — registry 'next' can momentarily lag
    // the claw's redraw (reroll timing), which would mis-size the probe's
    // claw entry and flag the claw ball's own eye whites as stray.
    const ci = window.__brScene.clawInfo ? window.__brScene.clawInfo() : { tier, visible: true }
    const sp = window.__brScene.spawnInfo(ci.tier)
    const cp = proj(sp.x, sp.y)
    if (ci.visible) balls.push({ x: cp.x, y: cp.y, r: (rad[ci.tier] ?? 38) * cam.zoom })
    const tl = proj(165, 220)
    const br = proj(555, 1076)
    const ui = window.__brScene.uiPositions()
    const nb = ui.nextBall
    // Portrait: the ability bar overlays the lower screen — clamp the region
    // above it so its white ICONS never read as stray face pixels; same for
    // the tier row's white "?" glyphs on locked nodes.
    const abilTop = ui.abilities.length ? Math.min(...ui.abilities.map((a) => a.y)) : br.y
    const tiersTop = ui.tiersTop ?? br.y
    // Region top: on PORTRAIT also skip the top-strip text bottoms (Global /
    // Check Out labels sit inside the region x-range). Landscape keeps the
    // claw inside the region — it's the topmost face to check.
    const isPortrait = h > w
    const regionY0 = isPortrait && nb ? Math.max(tl.y, nb.y - nb.diameter / 2 - 4) : tl.y
    return { balls, region: [tl.x, regionY0, br.x, Math.min(br.y, abilTop - 8, tiersTop - 6)], nb }
  }, [w, h])
  const isWhite = (i) =>
    png.data[i] >= 243 && png.data[i + 1] >= 243 && png.data[i + 2] >= 243
  // Sclera extends to 0.714R + ~1.5px of anti-aliasing — the per-ball slack
  // 0.714·R + 2.5px covers AA at every scale, while a neighbor's contained
  // face (≥ ~0.95R away across a contact) stays far outside.
  const faceSlack = (r) => 0.714 * r + 2.5
  // Cutout: the next-ball preview block (ball + its label) on portrait sits
  // above the container where its WHITE LABEL would read as a stray face.
  // The label is top-origin (hudText) and extends ~30px past its anchor.
  const cut = sceneData.nb
    ? {
        x0: sceneData.nb.x - 85,
        x1: sceneData.nb.x + 85,
        y0: sceneData.nb.y - sceneData.nb.diameter / 2 - 10,
        y1: sceneData.nb.y + sceneData.nb.diameter / 2 + 90,
      }
    : null
  let strayFacePx = 0
  let faceWhitePx = 0
  {
    const [rx0, ry0, rx1, ry1] = sceneData.region
    for (let y = Math.max(0, ry0 | 0); y < Math.min(png.height, ry1); y++) {
      for (let x = Math.max(0, rx0 | 0); x < Math.min(png.width, rx1); x++) {
        const i = (y * png.width + x) * 4
        if (!isWhite(i)) continue
        faceWhitePx++
        if (cut && x >= cut.x0 && x <= cut.x1 && y >= cut.y0 && y <= cut.y1) continue
        let inside = false
        for (const b of sceneData.balls) {
          if (Math.hypot(x - b.x, y - b.y) <= faceSlack(b.r)) {
            inside = true
            break
          }
        }
        if (!inside) strayFacePx++
      }
    }
  }
  check(
    'faces contained in their balls',
    strayFacePx === 0 && faceWhitePx > 30,
    `stray=${strayFacePx} faceWhite=${faceWhitePx}`,
  )

  // 11. Preview ball: the face must exist AND stay inside the preview disc.
  // Circular scan — square corners would catch unrelated HUD text.
  if (sceneData.nb) {
    const r = sceneData.nb.diameter / 2
    let insideWhite = 0
    let stray = 0
    for (let y = Math.round(sceneData.nb.y - r); y <= Math.round(sceneData.nb.y + r); y++) {
      for (let x = Math.round(sceneData.nb.x - r); x <= Math.round(sceneData.nb.x + r); x++) {
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue
        const dd = Math.hypot(x - sceneData.nb.x, y - sceneData.nb.y)
        if (dd > r) continue
        const i = (y * png.width + x) * 4
        if (!isWhite(i)) continue
        if (dd <= 0.714 * r + 2.5) insideWhite++
        else stray++
      }
    }
    check('preview face legible + contained', insideWhite >= 8 && stray === 0, `in=${insideWhite} stray=${stray}`)
  } else check('preview face legible + contained', false, 'no nextBall in uiPositions')

  const failed = checks.filter((c) => !c.ok)
  console.log(`${w}x${h}: ${failed.length === 0 ? 'PASS' : 'FAIL'} ${failed.length ? JSON.stringify(failed) : ''}`)
  if (failed.length) failures.push({ vp: `${w}x${h}`, failed })
  await page.close()
}
await browser.close()
if (failures.length) {
  console.error('FAILURES:', JSON.stringify(failures, null, 1))
  process.exit(1)
}
console.log('ALL VIEWPORTS PASS')
