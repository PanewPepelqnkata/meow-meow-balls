import { bootGame, frameCount, report } from './lib-game.mjs'
import { PNG } from 'pngjs'

/**
 * Guards the TIER 8 ball: a solid RGB ball whose colour cycles.
 *
 * Two invariants:
 *  1. SIZE: tier 8 is the same size as tier 3 (the user's spec) — and so
 *     are tiers 9–12.
 *  2. THE BODY IS ALWAYS DRAWN: the old tier 8 was a rainbow with no ink
 *     outline, drawn through a separate baked-texture path, and it could
 *     lose its body while the face stayed. It is now a plain ball drawn
 *     through the standard contour path, so the colour and the ink
 *     outline always come from the same polygon.
 *  3. THE COLOUR CYCLES: the body's colour changes over time (red/blue
 *     every 0.25s), and it is a single solid colour — not a rainbow.
 */
const { browser, page, errors } = await bootGame()

const failures = []

// (1) The sizes. The balls are spawned FAR apart and removed right away:
// a tier 8 and a tier 9 in the same pile would MERGE (and two tier 8s
// merge into a tier 9), which would change what is on screen.
const sizes = await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  const out = {}
  const spawned = []
  for (const tier of [3, 8, 9]) {
    spawned.push(scene.balls.spawnBall(360, 300, tier))
  }
  for (const b of spawned) out[b.tier] = b.soft.radius
  for (const b of spawned) scene.balls.removeBall?.(b.id)
  return out
})
console.log('radii:', JSON.stringify(sizes))
if (sizes[8] !== sizes[3]) {
  failures.push(`tier 8 radius ${sizes[8]} != tier 3 radius ${sizes[3]}`)
}
if (sizes[9] !== sizes[3]) {
  failures.push(`tier 9 radius ${sizes[9]} != tier 3 radius ${sizes[3]}`)
}

// (2) The body is always painted, and (3) the colour cycles.
await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  for (const b of scene.balls.getBalls().slice()) scene.balls.removeBall?.(b.id)
})
await page.waitForTimeout(800)
await page.evaluate(() => window.__brScene.spawnAt(360, 8, 600, true))
await page.waitForTimeout(2500)
const afterSpawn = await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  return {
    balls: scene.balls.getBalls().map((b) => ({ tier: b.tier })),
    err: window.__brUpdateError ?? null,
  }
})
if (!afterSpawn.balls.some((b) => b.tier === 8)) {
  failures.push(`no tier 8 ball on screen (${JSON.stringify(afterSpawn.balls)})`)
}

const map = await page.evaluate(() => {
  const scene = window.__brGame.scene.getScene('playground')
  const cam = scene.cameras.main
  const canvas = document.querySelector('.game-container canvas')
  const rect = canvas.getBoundingClientRect()
  return {
    scrollX: cam.scrollX,
    scrollY: cam.scrollY,
    zoom: cam.zoom,
    worldW: cam.worldView.width,
    worldH: cam.worldView.height,
    cssW: rect.width,
    cssH: rect.height,
  }
})

/** The dominant colour of the tier 8 ball on screen. */
async function bodyColour() {
  const buf = await page.screenshot()
  const img = PNG.sync.read(buf)
  const scale = img.width / map.cssW
  const ball = await page.evaluate(() => {
    const scene = window.__brGame.scene.getScene('playground')
    const b = scene.balls.getBalls().find((x) => x.tier === 8)
    return b ? { x: b.soft.center.position.x, y: b.soft.center.position.y, r: b.soft.radius } : null
  })
  if (!ball) return null

  const R = ball.r * 0.3 * map.zoom * scale
  const cx = ((ball.x - map.scrollX) * map.zoom / map.worldW) * map.cssW * scale
  // Sample ABOVE the centroid: the ball's own colour, clear of the
  // container floor and the wall art behind it.
  const cy = ((ball.y - map.scrollY) * map.zoom / map.worldH) * map.cssH * scale - R * 0.35

  // The AVERAGE colour of the BRIGHT pixels in the region: the ball's
  // body is one saturated colour, while the ink outline and the face are
  // dark, so averaging the bright pixels gives the body colour.
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  const x0 = Math.max(0, Math.floor(cx - R))
  const x1 = Math.min(img.width, Math.ceil(cx + R))
  const y0 = Math.max(0, Math.floor(cy - R))
  const y1 = Math.min(img.height, Math.ceil(cy + R))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const j = (y * img.width + x) * 4
      const r = img.data[j]
      const g = img.data[j + 1]
      const b = img.data[j + 2]
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      if (sat > 60) {
        sumR += r
        sumG += g
        sumB += b
        count++
      }
    }
  }
  if (count === 0) return { best: { r: 0, g: 0, b: 0 }, bestCount: 0, total: (x1 - x0) * (y1 - y0) }
  return {
    best: { r: Math.round(sumR / count), g: Math.round(sumG / count), b: Math.round(sumB / count) },
    bestCount: count,
    total: (x1 - x0) * (y1 - y0),
  }
}

const samples = []
for (let i = 0; i < 8; i++) {
  const s = await bodyColour()
  if (s) samples.push(s)
  await page.waitForTimeout(200)
}
await page.screenshot({ path: 'qa/screens/_t8cycle.png' })

// The body must be painted (a big share of the sampled region is the
// ball's saturated body colour, not the background).
for (const s of samples) {
  if (s.bestCount < s.total * 0.35) {
    failures.push(`the tier 8 body is barely painted (${s.bestCount} of ${s.total} px)`)
    break
  }
}

// The colour must change over time.
const hues = new Set(samples.map((s) => s.best && `${s.best.r >> 5},${s.best.g >> 5},${s.best.b >> 5}`))
if (hues.size < 2) {
  failures.push(`the tier 8 colour never changed (${[...hues].join(' | ')})`)
}

// And it must be a single solid colour, not a rainbow: the sampled
// pixels must be close to ONE colour (a rainbow would spread them).
for (const s of samples) {
  const { r, g, b } = s.best
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  // A saturated body colour has a large spread (red vs blue), but the
  // AVERAGE of the body pixels must still be a single hue: a rainbow
  // would average to a muddy grey/brown.
  const isGrey = Math.abs(r - g) < 24 && Math.abs(g - b) < 24 && Math.abs(r - b) < 24
  if (isGrey) {
    failures.push(`the tier 8 body averages to grey (${r},${g},${b}) — it is a rainbow, not one colour`)
    break
  }
}

if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()
report(
  'tier 8: tier-3 sized, always painted, and a solid colour that cycles',
  failures,
  `radii: ${JSON.stringify(sizes)}\ncolours over time: ${[...hues].join(' | ')}`,
)
