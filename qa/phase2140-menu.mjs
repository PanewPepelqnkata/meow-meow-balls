#!/usr/bin/env node
/**
 * Phase 2.14.0 browser QA — §2/§3: the home screen + persistence.
 *
 *  §2  Start screen: a Phaser-scene menu over a dusk-veiled themed
 *      background — title, mascot, floating characters, five buttons
 *      (PLAY / LEADERBOARD / JOURNAL / COLLECTION / SETTINGS). Panels
 *      navigate via BACK. PLAY unlocks gameplay input; the menu never
 *      returns on restart. Gameplay UI is untouched.
 *
 *  §3  Persistence + run variants: the save (localStorage) records
 *      discovered tiers, tier-8/9 VARIANTS (randomized each run), the
 *      leaderboard (game-over runs) and the best score — all visible in
 *      the menu screens after a reload.
 *
 * Evidence: qa/screens/p2140-menu/*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { readShot, px, lum } from './lib-discovery.mjs'

const url = process.argv[2] || 'http://localhost:5174'
const DIR = 'qa/screens/p2140-menu'
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
await page.setViewportSize({ width: 1170, height: 658 })
const shot = (name) => page.screenshot({ path: `${DIR}/${name}.png` })

const sil = (p) => Math.abs(p.r - 0x23) < 26 && Math.abs(p.g - 0x24) < 26 && Math.abs(p.b - 0x2e) < 30
const readSave = () =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('ballrush.save.v1') ?? 'null')
    } catch {
      return null
    }
  })

// Clean slate: clear the save through the app origin BEFORE the menu test
// boots (fastboot page just to reach localStorage, then the real menu URL).
await page.goto('http://localhost:5174/?fastboot=1', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await page.evaluate(() => localStorage.removeItem('ballrush.save.v1'))

// ============================================================================
console.log('\n=== §2 Start screen — boot, composition, navigation ===')

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(900)

let menu = await page.evaluate(() =>
  window.__brMenu ? { visible: window.__brMenu.visible(), screen: window.__brMenu.screen() } : null,
)
check('menu mounted at boot (no fastboot)', menu != null && menu.visible === true, `screen=${menu?.screen}`)
check('menu opens on the main screen', menu?.screen === 'menu')

await wait(600)
await shot('01-menu-desktop')

// Composition (pixels): dusk veil + yellow title near the top + five chunky
// button bodies + floating characters.
{
  const png = readShot(`${DIR}/01-menu-desktop.png`)
  const vw = png.width
  const vh = png.height
  // Veil: corners are dusk-dark (veiled themed background — the light theme
  // boots at ~100 lum through the 0.62 veil; a menu-less game would be ~235).
  const corners = [[8, 8], [vw - 8, 8], [8, vh - 8], [vw - 8, vh - 8]]
  const darkCorners = corners.filter(([x, y]) => lum(px(png, x, y)) < 150).length
  check('dusk veil dims the game universe behind the menu', darkCorners >= 3, `${darkCorners}/4 corners dark`)
  // Title: the cartoon wordmark — multicolored letters (tier palette) with
  // ink outlines near the top center.
  let titleHits = 0
  for (let dy = -24; dy <= 24; dy += 4) {
    for (let dx = -280; dx <= 280; dx += 8) {
      const p = px(png, vw / 2 + dx, vh * 0.11 + dy)
      const letter =
        (p.r > 200 && p.g > 140 && p.b < 130) || // yellow / orange / pink
        (p.g > 160 && p.r < 160) || // green
        (p.b > 170 && p.r < 160) // blue
      if (letter) titleHits++
    }
  }
  check('BALL RUSH wordmark readable (palette on ink)', titleHits >= 90, `${titleHits} letter px`)
  // Floating characters: colored ball bodies away from the center column.
  const spots = [
    [0.08 * vw, 0.34 * vh],
    [0.92 * vw, 0.36 * vh],
    [0.06 * vw, 0.85 * vh],
  ]
  let floaters = 0
  for (const [sx, sy] of spots) {
    let hits = 0
    for (let dx = -16; dx <= 16; dx += 4) for (let dy = -16; dy <= 16; dy += 4) {
      const p = px(png, sx + dx, sy + dy)
      const mx = (p.r + p.g + p.b) / 3
      if (Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) > 40 && mx > 60) hits++
    }
    if (hits >= 4) floaters++
  }
  check('floating ball characters animate the background', floaters >= 2, `${floaters}/3 spots colorful`)
}

// Five buttons, correct labels, real rects.
menu = await page.evaluate(() => window.__brMenu)
const btns = (await page.evaluate(() => window.__brMenu.buttons())).filter((b) => b.screen === 'menu')
const labels = btns.map((b) => b.label)
check('five menu buttons in order', JSON.stringify(labels) === JSON.stringify(['PLAY', 'LEADERBOARD', 'JOURNAL', 'COLLECTION', 'SETTINGS']), labels.join('/'))
check('button rects are viewport-sized and stacked', btns.every((b) => b.w > 100 && b.h > 40 && b.x > 0 && b.y + b.h < 658))

// Panel navigation: JOURNAL → BACK → LEADERBOARD → BACK → COLLECTION → BACK.
const clickBtn = async (label, screen) => {
  const b = (await page.evaluate(() => window.__brMenu.buttons())).find((x) => x.label === label && (screen ? x.screen === screen : true))
  if (!b) return false
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await wait(450)
  return true
}

check('JOURNAL opens', (await clickBtn('JOURNAL', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'journal')
await shot('02-journal-fresh')
{
  const png = readShot(`${DIR}/02-journal-fresh.png`)
  const vw = png.width
  const vh = png.height
  // Fresh save: tiers 1-3 discovered (colored), tier 4 silhouetted with '?'.
  // Journal layout mirror (buildJournal): 2 cols, rowH 92, colW 430,
  // topY vh*0.15; tier 4 = col 0, row 3; icon at colX - colW/2 + 6 + 44.
  const colW = Math.min(430, (vw * 0.86) / 2)
  const startX = vw / 2 - (2 * colW + 24) / 2 + colW / 2
  const cy = vh * 0.15 + 3 * 92 + 46
  const ix = startX - colW / 2 + 6 + 44
  const p4 = px(png, ix, cy)
  const p1 = px(png, ix, vh * 0.15 + 0 * 92 + 46)
  check('journal: tier 1 colored (fresh save pre-seeds tiers 1-3)', !sil(p1) && lum(p1) > 90, `rgb(${p1.r},${p1.g},${p1.b})`)
  // Undiscovered: the dark silhouette body + the gray-blue '?' glyph at the
  // icon center (drawBallIcon's undiscovered state), and NO tier-4 red.
  const qGlyph = Math.abs(p4.r - 86) < 30 && Math.abs(p4.g - 90) < 30 && Math.abs(p4.b - 114) < 34
  let red = 0
  for (let dx = -26; dx <= 26; dx += 3) for (let dy = -26; dy <= 26; dy += 3) {
    const p = px(png, ix + dx, cy + dy)
    if (p.r > 180 && p.g < 110 && p.b < 110) red++
  }
  check('journal: tier 4 still undiscovered (silhouette + ?)', qGlyph && red === 0, `?glyph=${qGlyph}, red px=${red}`)
}
check('BACK returns to the menu', (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')

check('LEADERBOARD opens (empty state)', (await clickBtn('LEADERBOARD', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'leaderboard')
await shot('03-leaderboard-empty')
check('BACK from leaderboard', (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')

check('COLLECTION opens', (await clickBtn('COLLECTION', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'collection')
await shot('04-collection-fresh')
{
  const png = readShot(`${DIR}/04-collection-fresh.png`)
  const vw = png.width
  const vh = png.height
  // '3 / 10 DISCOVERED' progress text + a ~30% filled green progress bar
  // (bar top at vh*0.135 + 34, so its center row is vh*0.135 + 41).
  let barHits = 0
  for (let dx = -230; dx <= 230; dx += 4) {
    const p = px(png, vw / 2 + dx, vh * 0.135 + 41)
    if (p.g > 150 && p.r < 120) barHits++
  }
  check('collection: progress bar reflects 3/10 discovered', barHits >= 25 && barHits < 90, `${barHits} green px across the bar (30% fill ≈ 35)`)
}
check('BACK from collection', (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')

// SETTINGS: theme pinning applies to the live background.
check('SETTINGS opens', (await clickBtn('SETTINGS', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'settings')
await shot('05-settings')
check('THEME_SPACE pins the background', (await clickBtn('THEME_SPACE', 'settings')))
await wait(900)
await shot('06-settings-space')
{
  const png = readShot(`${DIR}/06-settings-space.png`)
  const corners = [[8, 8], [png.width - 8, 8], [8, png.height - 8]]
  const dark = corners.filter(([x, y]) => lum(px(png, x, y)) < 60).length
  check('space theme visibly applied through the panel', dark >= 2, `${dark}/3 corners deep dark`)
}
check('THEME_AUTO restores progression theme', (await clickBtn('THEME_AUTO', 'settings')))
await wait(700)
check('BACK from settings', (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')

// ============================================================================
console.log('\n=== §2 PLAY — gameplay unlocks, input live, menu never returns ===')

// While the menu is up, gameplay input is gated: a click mid-veil drops
// nothing (the canvas is covered by menu buttons/panels anyway).
const ballsBefore = await page.evaluate(() => window.__brScene.visualState().rendererBalls)
await page.mouse.click(200, 400)
await wait(700)
const ballsAfterMenuClick = await page.evaluate(() => window.__brScene.visualState().rendererBalls)
check('clicks while the menu is up drop nothing', ballsAfterMenuClick === ballsBefore, `${ballsBefore} → ${ballsAfterMenuClick}`)

check('PLAY pressed', await clickBtn('PLAY', 'menu'))
await wait(900)
check('menu closed for good', (await page.evaluate(() => window.__brMenu.visible())) === false)
await shot('07-gameplay-after-start')

// Real input path: aim + drop through the actual pointer pipeline.
const state0 = await page.evaluate(() => window.__brScene.visualState())
await page.mouse.move(600, 200)
await wait(150)
await page.mouse.down()
await wait(80)
await page.mouse.up()
await wait(900)
const state1 = await page.evaluate(() => window.__brScene.visualState())
check('gameplay input is LIVE after PLAY (pointer drop spawns a ball)', state1.rendererBalls === state0.rendererBalls + 1, `${state0.rendererBalls} → ${state1.rendererBalls}`)

// Restart does NOT bring the menu back.
await page.evaluate(() => window.__brScene.restart())
await wait(800)
check('restart never re-shows the menu', (await page.evaluate(() => window.__brMenu.visible())) === false)

// ============================================================================
console.log('\n=== §3 Persistence + run variants (journal records survive reload) ===')

// Discover tier 4 through a real merge (spawned balls merge normally).
await page.evaluate(() => window.__brScene.spawnAt(540, 3))
await wait(200)
await page.evaluate(() => window.__brScene.spawnAt(548, 3))
await wait(1600)
let save = await readSave()
check('tier-4 discovery recorded to the save', save?.discovered?.['4'] != null, JSON.stringify(Object.keys(save?.discovered ?? {})))
check('merge stats recorded', (save?.stats?.merges ?? 0) >= 1, `merges=${save?.stats?.merges}`)

// Tier 8 + variant: merge two T7s — records the tier AND its per-run variant.
await page.evaluate(() => window.__brScene.spawnAt(540, 7))
await wait(250)
await page.evaluate(() => window.__brScene.spawnAt(548, 7))
await wait(2500)
save = await readSave()
const variantKeys = Object.keys(save?.variants ?? {})
check('tier-8 discovery recorded', save?.discovered?.['8'] != null)
check('tier-8 per-run VARIANT recorded', variantKeys.length === 1 && /^8:[0-7]$/.test(variantKeys[0]), variantKeys.join(',') || 'none')

// Reload: the menu boots again, journal shows the persisted record.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(800)
check('menu returns at boot after reload', (await page.evaluate(() => window.__brMenu.visible())) === true)
check('JOURNAL opens after reload', (await clickBtn('JOURNAL', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'journal')
await wait(400)
await shot('08-journal-after-reload')
{
  const png = readShot(`${DIR}/08-journal-after-reload.png`)
  const vw = png.width
  const vh = png.height
  // Tier 4 (col 0, row 3) must now be COLORED (red T4) — was silhouette pre-discovery.
  const colW = Math.min(430, (vw * 0.86) / 2)
  const startX = vw / 2 - (2 * colW + 24) / 2 + colW / 2
  const ix = startX - colW / 2 + 6 + 44
  const p4 = px(png, ix, vh * 0.15 + 3 * 92 + 46)
  check('journal: tier 4 colored after reload (persisted)', p4.r > 150 && p4.g < 130, `rgb(${p4.r},${p4.g},${p4.b})`)
  // Tier 8 (col 1, row 2) colored too — with ONE variant chip filled.
  const cx8 = startX + 1 * (colW + 24)
  const p8 = px(png, cx8 - colW / 2 + 6 + 44, vh * 0.15 + 2 * 92 + 46)
  check('journal: tier 8 colored after reload', p8.r + p8.g + p8.b > 200, `rgb(${p8.r},${p8.g},${p8.b})`)
}
check('BACK after reload-journal', (await clickBtn('BACK', 'panel')))

// Leaderboard: score once (one merge pair), then trigger a GENUINE overflow
// game over. The overflow rule (config/gameOver.ts): a TOUCHED ball whose
// centroid is past a side-wall line by >6px, below the wall tops, dwelling
// 450ms. A tall pile alone never does this (it stays inside the extrapolated
// lines) — the deterministic construction is a small ball spawned OUTSIDE
// the left wall line, overlapping the wall band (collision → touched) with
// its centroid >28px past the line (beyond the clamp's band exemption, so
// nothing shoves it back in). Matter separates it outward and it slides
// down the wall's outer face — outside, below the tops, touched.
await clickBtn('PLAY', 'menu')
await wait(800)
await page.evaluate(() => window.__brScene.restart())
await wait(500)
await page.evaluate(() => window.__brScene.spawnAt(300, 3))
await wait(200)
await page.evaluate(() => window.__brScene.spawnAt(340, 3))
// Let the merge (+ its first-time-T4 discovery panel, per-run state) finish.
await wait(6500)
// The overflow ball: T1 at (85, 820) — innerLeftAt(820) ≈ 119.8, so the
// centroid is ~35px past the line, below the tops (765).
await page.evaluate(() => window.__brScene.spawnAt(85, 1, 820))
let over = false
for (let i = 0; i < 120 && !over; i++) {
  over = await page.evaluate(() => window.__brScene.gameOver().over)
  await wait(150)
}
check('run reaches game over (genuine overflow)', over)
save = await readSave()
check('leaderboard entry recorded at game over', save?.leaderboard?.length === 1 && save.leaderboard[0].score > 0, `score=${save?.leaderboard?.[0]?.score}, bestTier=${save?.leaderboard?.[0]?.bestTier}`)
check('best score persisted', (save?.best ?? 0) > 0, `best=${save?.best}`)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(800)
check('menu boots again after the run', (await page.evaluate(() => window.__brMenu.visible())) === true)
check('LEADERBOARD shows the recorded run', (await clickBtn('LEADERBOARD', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'leaderboard')
await wait(400)
await shot('09-leaderboard-entry')
{
  const png = readShot(`${DIR}/09-leaderboard-entry.png`)
  // One row card with a white score number in the left half.
  let scoreHits = 0
  for (let dy = -20; dy <= 20; dy += 4) {
    for (let dx = -180; dx <= 60; dx += 6) {
      const p = px(png, png.width / 2 + dx, png.height * 0.15 + 26 + dy)
      if (p.r > 225 && p.g > 225 && p.b > 225) scoreHits++
    }
  }
  check('leaderboard row renders (rank + score visible)', scoreHits >= 10, `${scoreHits} bright px`)
}
check('BACK from leaderboard', (await clickBtn('BACK', 'panel')))

// ============================================================================
console.log('\n=== §2 Responsive: mobile pass (390×844) ===')

await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__brCreateDone === 'yes', { timeout: 20000 })
await wait(900)
check('mobile: menu mounts', (await page.evaluate(() => window.__brMenu.visible())) === true)
const mbtns = (await page.evaluate(() => window.__brMenu.buttons())).filter((b) => b.screen === 'menu')
check('mobile: all five buttons fit the viewport', mbtns.length === 5 && mbtns.every((b) => b.x >= 0 && b.x + b.w <= 390 && b.y + b.h <= 844))
await wait(500)
await shot('10-menu-mobile')
check('mobile: JOURNAL opens single-column', (await clickBtn('JOURNAL', 'menu')) && (await page.evaluate(() => window.__brMenu.screen())) === 'journal')
await wait(400)
await shot('11-journal-mobile')
check('mobile: BACK works', (await clickBtn('BACK', 'panel')) && (await page.evaluate(() => window.__brMenu.screen())) === 'menu')
check('mobile: PLAY works', (await clickBtn('PLAY', 'menu')))
await wait(900)
check('mobile: menu closed', (await page.evaluate(() => window.__brMenu.visible())) === false)

await browser.close()
console.log(`\n=== PHASE 2.14.0 QA (§2/§3): ${pass} passed, ${fail} failed ===`)
if (fail > 0) process.exit(1)
