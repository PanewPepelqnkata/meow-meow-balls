import { bootGame, report } from './lib-game.mjs'

/**
 * Guards the THEME-TRANSITION BAKE STORM.
 *
 * On a portrait phone the first tier-4+ discovery transitions the
 * background to the space theme. That transition bakes full-screen
 * textures (art, stars, grid, gradient) AND three 900x520 nebula
 * composites.
 *
 * The nebula bake was NOT covered by the boot prewarm, so it landed in
 * the MERGE frame — the exact frame the player merges. Measured before the
 * fix: a single 70-80ms frame (54.3 ms of it the nebula bake), on top of
 * the merge's own work.
 *
 * The guard asserts:
 *  1. the nebula textures exist BEFORE the transition is requested
 *     (the boot prewarm baked them), and
 *  2. the transition itself is cheap (< 30ms) — i.e. no bake storm.
 */
const failures = []
const { browser, page, errors } = await bootGame()

// 1. The prewarm must have run at boot.
const pre = await page.evaluate(() => {
  const g = window.__brGame
  const keys = g.textures.getTextureKeys()
  return {
    nebulae: keys.filter((k) => k.startsWith('br-nebula-')).length,
    spaceArt: keys.includes('br-art-space'),
    stars: keys.includes('br-stars'),
    grid: keys.includes('br-grid'),
  }
})
console.log('after boot (prewarmed):', JSON.stringify(pre))
if (pre.nebulae < 3) failures.push(`the boot prewarm did not bake the nebula textures (${pre.nebulae}/3)`)

// 2. The transition must be cheap.
const t = await page.evaluate(() => {
  const bg = window.__brGame.scene.getScene('BackgroundScene')
  const t0 = performance.now()
  bg.setTheme('space', 600)
  return performance.now() - t0
})
console.log(`the theme transition now costs ${t.toFixed(1)}ms`)
if (t > 30) failures.push(`the theme transition still costs ${t.toFixed(1)}ms (the bake storm is back)`)

// 3. And again — a second transition must be cheap too (the prune path
// drops the art textures of invisible themes).
const t2 = await page.evaluate(() => {
  const bg = window.__brGame.scene.getScene('BackgroundScene')
  const t0 = performance.now()
  bg.setTheme('light', 600)
  return performance.now() - t0
})
console.log(`the reverse transition costs ${t2.toFixed(1)}ms`)
if (t2 > 30) failures.push(`the reverse transition costs ${t2.toFixed(1)}ms`)

if (errors.length) failures.push(`page errors: ${errors.slice(0, 2).join(' | ')}`)

await browser.close()
report(
  'theme transition: the bake storm is prewarmed, not paid in the merge frame',
  failures,
  `nebulae=${pre.nebulae} transition=${t.toFixed(1)}ms`,
)
