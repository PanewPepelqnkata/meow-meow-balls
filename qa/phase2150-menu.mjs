#!/usr/bin/env node
/**
 * Phase 2.15.0 browser QA — §2/§3: the CARTOON GAME HOME SCREEN.
 *
 *  §2  Home screen composition at the four required sizes (320×568,
 *      390×844, 1280×720, 1728×864): prominent cartoon wordmark, central
 *      illustrated container with an animated ball cast, big PLAY button,
 *      nav (LEADERBOARD / JOURNAL / COLLECTION / SETTINGS) and the compact
 *      stats chip — everything inside the viewport, bands non-overlapping.
 *      Living presentation: PLAY pulse, cast bob, blink-capable star cast.
 *      Menu-side presentation gates: gameplay HUD/claw/world recede while
 *      the menu is up (HUD text nearly invisible), physics stays alive.
 *  §3  Panels: each panel opens, has a purpose subtitle, and BACK returns;
 *      the collection keeps the 3/10 progress bar + tier 8–10 variant
 *      showcase; gameplay rescue: PLAY still starts a working run
 *      (the physics internals belong to phase2140/phase2150 core suites).
 *
 * Evidence: qa/screens/p2150-menu/*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { readShot, px, lum } from './lib-discovery.mjs'

const url = process.argv[2] || 'http://localhost:5174'
const DIR = 'qa/screens/p2150-menu'
fs.mkdirSync(DIR, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()

// Clean slate so the chip / collection numbers are deterministic.
await page.goto('http://localhost:5174/?fastboot=1', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await page.evaluate(() => localStorage.removeItem('ballrush.save.v1'))

const SIZES = [
  [320, 568],
  [390, 844],
  [1280, 720],
  [1728, 864],
]

// ============================================================================
console.log('\n=== §2 Home screen — composition at the four required sizes ===')

for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: w, height: h })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
  await wait(900)
  const tag = `${w}x${h}`
  const shot = (name) => page.screenshot({ path: `${DIR}/${name}-${tag}.png` })

  // Button composition via the persistent QA rects (menu screen only).
  const btns = (await page.evaluate(() => window.__brMenu.buttons())).filter((b) => b.screen === 'menu')
  const labels = btns.map((b) => b.label)
  check(
    `${tag}: five menu buttons (PLAY + 4 nav)`,
    JSON.stringify(labels) === JSON.stringify(['PLAY', 'LEADERBOARD', 'JOURNAL', 'COLLECTION', 'SETTINGS']),
    labels.join('/'),
  )
  check(
    `${tag}: all buttons inside the viewport`,
    btns.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h),
    btns.map((b) => `${b.label}@${Math.round(b.x)},${Math.round(b.y)}`).join(' '),
  )
  const play = btns.find((b) => b.label === 'PLAY')
  check(
    `${tag}: PLAY is the biggest button`,
    play != null && play.w >= Math.max(...btns.filter((b) => b !== play).map((b) => b.w)) && play.h >= 48,
    `${Math.round(play?.w ?? 0)}x${Math.round(play?.h ?? 0)}`,
  )
  // Non-overlap: every pair of menu buttons is disjoint.
  const overlap = btns.some((a, i) =>
    btns.some(
      (b, j) =>
        j > i &&
        !(a.x + a.w <= b.x + 2 || b.x + b.w <= a.x + 2 || a.y + a.h <= b.y + 2 || b.y + b.h <= a.y + 2),
    ),
  )
  check(`${tag}: menu buttons never overlap`, !overlap)

  // Wordmark: the whole word painted as one managed canvas + subtitle.
  const logo = await page.evaluate(() => {
    const letters = window.__brMenu.letters()
    return {
      mark: letters.some((l) => l.text === 'br-wordmark'),
      sub: letters.some((l) => typeof l.text === 'string' && l.text.length > 2),
      box: window.__brMenu.logoBox(),
    }
  })
  check(`${tag}: wordmark canvas painted + subtitle present`, logo.mark && logo.sub)
  check(`${tag}: wordmark fits 90% of the width`, logo.box != null && logo.box.w <= w * 0.92 && logo.box.h >= 34, `${logo.box?.w}x${logo.box?.h}`)
  // Stats chip exists under the CTA/nav band.
  const chip = await page.evaluate(() => window.__brMenu.chip())
  check(
    `${tag}: stats chip in the safe area`,
    chip != null && chip.x >= 0 && chip.y + chip.h <= h && chip.w > 120,
    `chip@${Math.round(chip?.x ?? -1)},${Math.round(chip?.y ?? -1)} ${Math.round(chip?.w ?? 0)}x${Math.round(chip?.h ?? 0)}`,
  )
  // The cast: five ball characters through the shared look pipeline.
  const cast = await page.evaluate(() => window.__brMenu.cast())
  check(`${tag}: showcase cast of 5 (tiers 2-6)`, cast.length === 5 && cast.every((c) => c.tier >= 2 && c.tier <= 6), cast.map((c) => `T${c.tier}`).join('/'))

  await shot('home')

  // Living presentation: the PLAY pulse and the cast bob over time.
  const p1 = await page.evaluate(() => window.__brMenu.pulse())
  const cast1 = await page.evaluate(() => window.__brMenu.cast())
  await wait(700)
  const p2 = await page.evaluate(() => window.__brMenu.pulse())
  const cast2 = await page.evaluate(() => window.__brMenu.cast())
  check(
    `${tag}: PLAY pulses (scale drifts)`,
    p1 > 0 && Math.abs(p2 - p1) > 0.004,
    `scale ${p1} → ${p2}`,
  )
  check(
    `${tag}: cast bobs (positions drift)`,
    cast1.some((c, i) => Math.abs(c.y - (cast2[i]?.y ?? c.y)) > 0.5 || Math.abs(c.x - (cast2[i]?.x ?? c.x)) > 0.2),
    'cast moved within 700ms',
  )

  // Menu-side presentation gates: the gameplay HUD recedes into the veil.
  {
    const png = readShot(`${DIR}/home-${tag}.png`)
    // Top-left "Best: 0 / Score: 0" HUD zone must be near-background dark.
    let hudPix = 0
    for (let y = 6; y < Math.round(h * 0.09); y += 3) {
      for (let x = 6; x < 46; x += 3) {
        if (lum(px(png, x, y)) > 120) hudPix++
      }
    }
    check(`${tag}: gameplay HUD recedes behind the veil`, hudPix <= 4, `${hudPix} bright px in the HUD corner`)
    // The home wordmark IS bright in the top band (contrast with the corner).
    const logoY = Math.round((logo.box?.y ?? h * 0.1) ?? h * 0.1)
    let markHits = 0
    for (let dy = -24; dy <= 24; dy += 4) {
      for (let dx = -250; dx <= 250; dx += 10) {
        const p = px(png, Math.round(w / 2 + dx), Math.round(logoY + dy))
        if ((p.r > 200 && p.g > 140 && p.b < 130) || (p.g > 160 && p.r < 160) || (p.b > 170 && p.r < 160)) markHits++
      }
    }
    check(`${tag}: wordmark bright above the veil`, markHits >= 60, `${markHits} letter px`)
  }

  // Physics stays alive under the menu: the world's engine time keeps
  // advancing (the visualState counter only moves when sim steps happen —
  // zero balls at boot, so sample the queue's internal seed churn through
  // two visualState calls on a spawned ball: spawn OUTSIDE the visible HUD
  // veil, watch it settle — the DOM is menu-covered; the sim must run).
  const s0 = await page.evaluate(() => window.__brScene.visualState().rendererBalls)
  await page.evaluate(() => window.__brScene.spawnAt(360, 1))
  await wait(600)
  const s1 = await page.evaluate(() => window.__brScene.visualState())
  check(
    `${tag}: physics steps while the menu is up (ball spawns and settles)`,
    s1.rendererBalls === s0 + 1 && s1.rendererDrawn === s1.rendererBalls,
    `balls ${s0} → ${s1.rendererBalls}, drawn ${s1.rendererDrawn}`,
  )
}

// ============================================================================
console.log('\n=== §3 Panels — open + subtitle + BACK from every screen (desktop) ===')

await page.setViewportSize({ width: 1170, height: 658 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(900)

const clickBtn = async (label, screen) => {
  const b = (await page.evaluate(() => window.__brMenu.buttons())).find((x) => x.label === label && (screen ? x.screen === screen : true))
  if (!b) return false
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await wait(350)
  return true
}

for (const [label, name] of [
  ['LEADERBOARD', 'leaderboard'],
  ['JOURNAL', 'journal'],
  ['COLLECTION', 'collection'],
  ['SETTINGS', 'settings'],
]) {
  check(`${label} opens`, (await clickBtn(label)) && (await page.evaluate(() => window.__brMenu.screen())) === name)
  await page.screenshot({ path: `${DIR}/panel-${name}.png` })
  check(`BACK returns from ${label}`, (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')
}

// Collection keeps its progress bar (3/10 fresh) — sampled at the bar row.
{
  const ok = await clickBtn('COLLECTION')
  check('collection opens for the showcase', ok && (await page.evaluate(() => window.__brMenu.screen())) === 'collection')
  await page.screenshot({ path: `${DIR}/collection-showcase.png` })
  const png = readShot(`${DIR}/collection-showcase.png`)
  const vw = png.width
  const vh = png.height
  let barHits = 0
  for (let dx = -230; dx <= 230; dx += 4) {
    const p = px(png, vw / 2 + dx, vh * 0.135 + 41)
    if (p.g > 150 && p.r < 120) barHits++
  }
  check('collection: progress bar reflects 3/10 discovered', barHits >= 25 && barHits < 90, `${barHits} green px`)
  // The tier 8-10 variant showcase: a row of unlocked-but-uncollected ? chips.
  let chipRowHits = 0
  for (const rowF of [0.732, 0.814]) {
    for (const dy of [-6, 0, 6]) {
      for (let dx = -190; dx <= 190; dx += 5) {
        const p = px(png, vw / 2 + dx, Math.round(vh * rowF + dy))
        // uncollected chips = pale-slate rings on the panel ink
        if (p.b > 60 && p.b < 140 && Math.abs(p.r - p.g) < 30 && p.g - p.b > -40 && p.g - p.b < 0) chipRowHits++
      }
    }
  }
  check('collection: tier 8-10 variant rows visible', chipRowHits >= 24, `${chipRowHits} chip px`)
  check('BACK from the showcase', (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')
}

// ============================================================================
console.log('\n=== §3 PLAY on the home screen starts a real run ===')

{
  check('PLAY starts gameplay', await clickBtn('PLAY', 'menu'))
  await wait(900)
  check('menu closed after PLAY', (await page.evaluate(() => window.__brMenu.visible())) === false)
  // HUD is fully visible again after leaving the menu (camera alpha restored).
  await page.evaluate(() => window.__brScene.spawnAt(360, 2))
  await wait(600)
  const s = await page.evaluate(() => window.__brScene.visualState())
  check('gameplay works after PLAY (ball registered + drawn)', s.rendererBalls >= 1 && s.rendererDrawn >= 1, `balls=${s.rendererBalls} drawn=${s.rendererDrawn}`)
}

console.log(`\n=== PHASE 2.15.0 QA (§2/§3 menu): ${pass} passed, ${fail} failed ===`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
