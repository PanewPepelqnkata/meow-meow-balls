#!/usr/bin/env node
/**
 * Phase 2.12.2 — Visual structure inspection of saved screenshots.
 *
 * Renders each discovery screenshot as an ASCII brightness map so the actual
 * COMPOSITION can be reviewed in text: dim uniformity, the centered ball,
 * headline position, and whether HUD areas are uniformly dimmed. Also prints
 * exact luminance statistics per region. This substitutes for image viewing
 * (unavailable in this session) with a faithful, reviewable representation.
 */
import { PNG } from 'pngjs'
import { readdirSync, readFileSync } from 'fs'

const DIR = process.argv[2] || 'qa/screens/p2122'
const CHARS = ' .:-=+*#%@' // dark → bright

function render(png, cols = 100) {
  const rows = Math.round((png.height / png.width) * cols * 0.5)
  const cw = png.width / cols, ch = png.height / rows
  let out = ''
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Average the cell.
      let sum = 0, n = 0
      const x0 = Math.floor(c * cw), y0 = Math.floor(r * ch)
      for (let y = y0; y < Math.min(png.height, y0 + ch); y += 2) {
        for (let x = x0; x < Math.min(png.width, x0 + cw); x += 2) {
          const i = (png.width * y + x) << 2
          sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]
          n++
        }
      }
      const lum = n ? sum / n : 0
      out += CHARS[Math.min(CHARS.length - 1, Math.floor((lum / 255) * CHARS.length))]
    }
    out += '\n'
  }
  return out
}

function regionStats(png, x0f, y0f, x1f, y1f) {
  const x0 = Math.floor(x0f * png.width), x1 = Math.floor(x1f * png.width)
  const y0 = Math.floor(y0f * png.height), y1 = Math.floor(y1f * png.height)
  let min = 255, max = 0, sum = 0, n = 0
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (png.width * y + x) << 2
      const lum = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]
      if (lum < min) min = lum
      if (lum > max) max = lum
      sum += lum
      n++
    }
  }
  return { min: Math.round(min), max: Math.round(max), avg: Math.round(sum / n) }
}

const PATTERN = process.argv[3] ?? '-2-discovery.png'
const files = readdirSync(DIR).filter((f) => f.endsWith(PATTERN)).sort()
for (const f of files) {
  const png = PNG.sync.read(readFileSync(`${DIR}/${f}`))
  console.log(`\n${'='.repeat(72)}\n${f}  (${png.width}×${png.height})\n${'='.repeat(72)}`)
  // Left strip (0–6% width) and top strip luminance — the dim must dominate.
  console.log(`left strip 0-6%:   ${JSON.stringify(regionStats(png, 0, 0.05, 0.06, 0.95))}  (min/max/avg lum — must be uniformly dark)`)
  console.log(`top strip 0-4%:    ${JSON.stringify(regionStats(png, 0.05, 0, 0.95, 0.04))}`)
  console.log(`right strip 94-100%: ${JSON.stringify(regionStats(png, 0.94, 0.05, 1, 0.95))}`)
  console.log(`bottom strip 96-100%: ${JSON.stringify(regionStats(png, 0.05, 0.96, 0.95, 1))}`)
  console.log(`center (ball/headline): ${JSON.stringify(regionStats(png, 0.3, 0.2, 0.7, 0.75))}  (must contain bright content)`)
  console.log('\nBrightness map (@ = bright, space = dark):')
  console.log(render(png))
}
