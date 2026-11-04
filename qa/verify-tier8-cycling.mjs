import { bootGame, frameCount, report } from './lib-game.mjs'
import { PNG } from 'pngjs'

/**
 * Guards the TIER 8 ball: a solid RGB ball whose colour cycles.
 *
 * Three invariants:
 *  1. SIZE: tier 8 is the same size as tier 3 (the user's spec) — and so
 *     are tiers 9–12.
 *  2. THE BODY IS ALWAYS DRAWN: the old tier 8 was a rainbow with no ink
 *     outline, drawn through a separate baked-texture path, and it could
 *     lose its body while the face stayed. It is now a plain ball drawn
 *     through the standard contour path, so the colour and the ink
 *     outline always come from the same polygon.
 *  3. THE COLOUR CYCLES: the body follows the five-colour clock cycle,
 *     including smooth blends, and remains a single solid colour — not a rainbow.
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
if (afterSpawn.err) failures.push(`tier 8 update error: ${afterSpawn.err}`)
if (!afterSpawn.balls.some((b) => b.tier === 8)) {
  failures.push(`no tier 8 ball on screen (${JSON.stringify(afterSpawn.balls)})`)
}


/** The dominant colour of the tier 8 ball on screen. */
async function bodyColour() {
  const ball = await page.evaluate(() => {
    const scene = window.__brGame.scene.getScene('playground')
    const b = scene.balls.getBalls().find((x) => x.tier === 8)
    if (!b) return null
    const color = window.__brModules.cycleColor(Date.now())
    const c = scene.cameras.main
    const canvas = document.querySelector('.game-container canvas')
    const rect = canvas.getBoundingClientRect()
    return {
      x: b.soft.center.position.x,
      y: b.soft.center.position.y,
      r: b.soft.radius,
      matrix: { a: c.matrix.a, b: c.matrix.b, c: c.matrix.c, d: c.matrix.d, e: c.matrix.e, f: c.matrix.f },
      cssW: rect.width,
      cssH: rect.height,
      canvasW: canvas.width,
      canvasH: canvas.height,
      cssLeft: rect.left,
      cssTop: rect.top,
      expected: { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff },
    }
  })
  if (!ball) return null
  const buf = await page.screenshot()
  const img = PNG.sync.read(buf)
  const scale = img.width / ball.cssW
  const bufferToCssX = ball.cssW / ball.canvasW
  const bufferToCssY = ball.cssH / ball.canvasH
  const centerX = ball.cssLeft * scale + (ball.matrix.a * ball.x + ball.matrix.c * ball.y + ball.matrix.e) * bufferToCssX * scale
  const centerY = ball.cssTop * scale + (ball.matrix.b * ball.x + ball.matrix.d * ball.y + ball.matrix.f) * bufferToCssY * scale
  const R = ball.r * ball.matrix.a * bufferToCssX * scale * 0.12
  const cx = centerX
  const cy = centerY

  // Match pixels to the renderer's current colour for coverage: unlike a
  // saturation threshold this covers white and the low-saturation midpoint
  // of a cyan→red blend. Keep a second, saturated-pixel average for the
  // anti-rainbow assertion on strongly coloured slots.
  const { expected } = ball
  const expectedSpread = Math.max(expected.r, expected.g, expected.b) - Math.min(expected.r, expected.g, expected.b)
  const maxChannelDelta = 56
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let painted = 0
  let chromaticR = 0
  let chromaticG = 0
  let chromaticB = 0
  let chromatic = 0
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
      const matchesExpected = Math.max(
        Math.abs(r - expected.r),
        Math.abs(g - expected.g),
        Math.abs(b - expected.b),
      ) <= maxChannelDelta
      if (matchesExpected) {
        sumR += r
        sumG += g
        sumB += b
        painted++
      }
      if (sat > 60) {
        chromaticR += r
        chromaticG += g
        chromaticB += b
        chromatic++
      }
    }
  }
  const total = (x1 - x0) * (y1 - y0)
  const best =
    expectedSpread >= 24 && chromatic >= total * 0.2 && chromatic > 0
      ? {
          r: Math.round(chromaticR / chromatic),
          g: Math.round(chromaticG / chromatic),
          b: Math.round(chromaticB / chromatic),
        }
      : painted > 0
        ? { r: Math.round(sumR / painted), g: Math.round(sumG / painted), b: Math.round(sumB / painted) }
        : { r: 0, g: 0, b: 0 }
  return {
    best,
    bestCount: painted,
    total,
    expected,
    chromaticCount: chromatic,
    sampleCenter: { x: Math.round(cx), y: Math.round(cy) },
    bounds: { x0, y0, x1, y1 },
  }
}

// Keep Date.now fixed while Chromium captures; RAF and physics still advance.
const cycleTimes = [0, 750, 1500, 2250, 3000, 585, 1335, 2835]
const samples = []
for (const time of cycleTimes) {
  await page.clock.setFixedTime(new Date(time))
  const frame = await frameCount(page)
  await page.waitForFunction((previous) => window.__brGame.loop.frame >= previous + 2, frame)
  const s = await bodyColour()
  if (s) samples.push(s)
}
await page.screenshot({ path: 'qa/screens/_t8cycle.png' })

// The body must be painted (a big share of the sampled region is the
// tier's current body colour, not the background). This remains a coverage
// assertion for every cycle slot, including the low-saturation white slot.
for (const s of samples) {
  if (s.bestCount < s.total * 0.30) {
    failures.push(`the tier 8 body is barely painted (${s.bestCount} of ${s.total} px)`)
    break
  }
}

// The colour must change over time.
const hues = new Set(samples.map((s) => s.best && `${s.best.r >> 5},${s.best.g >> 5},${s.best.b >> 5}`))
if (hues.size < 2) {
  failures.push(`the tier 8 colour never changed (${[...hues].join(' | ')})`)
}

// And it must be a single solid colour, not a rainbow. The sampled average
// must stay near the renderer's clock colour. A colourful body's average may
// not collapse to grey; the white slot is intentionally grey-like and is
// exempt from that one check.
for (const s of samples) {
  const { r, g, b } = s.best
  const { expected } = s
  const error = Math.max(Math.abs(r - expected.r), Math.abs(g - expected.g), Math.abs(b - expected.b))
  if (error > 72) {
    failures.push(
      `the tier 8 body colour does not match the live colour (${r},${g},${b} vs ${expected.r},${expected.g},${expected.b})`,
    )
    break
  }
  const expectedSpread = Math.max(expected.r, expected.g, expected.b) - Math.min(expected.r, expected.g, expected.b)
  const isGrey = Math.abs(r - g) < 24 && Math.abs(g - b) < 24 && Math.abs(r - b) < 24
  if (expectedSpread >= 24 && isGrey) {
    failures.push(`the tier 8 body averages to grey (${r},${g},${b}) — it is a rainbow, not one colour`)
    break
  }
}

if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()
report(
  'tier 8: tier-3 sized, always painted, and a solid colour that cycles',
  failures,
  `radii: ${JSON.stringify(sizes)}\ncolours over time: ${[...hues].join(' | ')}\nsamples: ${JSON.stringify(samples.map(({ best, bestCount, total, sampleCenter }) => ({ best, bestCount, total, sampleCenter })))}`,
)
