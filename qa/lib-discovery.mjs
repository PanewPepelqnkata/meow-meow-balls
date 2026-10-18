/**
 * Shared Phase 2.13.4 discovery-composition checks — SUBTLE BUT DRAMATIC
 * band presentation (supersedes the 2.13.3 full-bleed comic illustration).
 *
 * Composition verified (tier 4 assumed):
 *  - the GAME BACKGROUND stays visible under a gentle dim (corners are
 *    dimmed scene, NOT comic colors, NOT a dark void);
 *  - ONE thick filled horizontal band across the middle, tier-colored,
 *    full-width (red on both far sides at the band's center line);
 *  - band thickness measured on a vertical scan;
 *  - a cream spot-disc behind the character; the character centered on it;
 *  - bold yellow title with black outline at the top;
 *  - comic accents: halftone dot strip under the band's top edge and ink
 *    emphasis ticks around the character.
 *
 * Each suite passes its own `check(name, ok, detail)` runner.
 */
import { PNG } from 'pngjs'
import fs from 'node:fs'

export const px = (png, x, y) => {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] }
}
export const lum = (p) => (p.r + p.g + p.b) / 3
export const readShot = (path) => PNG.sync.read(fs.readFileSync(path))

export function verifyDiscoveryBand(check, png) {
  const vw = png.width
  const vh = png.height
  const cx = vw / 2
  const ballY = Math.round(vh * 0.48)
  const r = Math.min(120, Math.max(40, Math.min(vw, vh) * 0.15))
  const bandH = Math.max(130, Math.min(240, vh * 0.3))
  const bandTop = ballY - bandH / 2
  const isTier4Red = (p) => p.r > 150 && p.r > p.g * 1.8 && p.r > p.b * 1.8
  const isCream = (p) => p.r > 225 && p.g > 215 && p.b > 180

  // 1) No full-screen takeover: each corner patch shows the DIMMED GAME
  // scene — never comic-saturated panels, never a bright illustration.
  // (Theme-agnostic: the check is on saturation/luminance character, not
  // on a specific theme color.)
  const cornerStates = []
  for (const [x, y] of [[10, 10], [vw - 10, 10], [10, vh - 10], [vw - 10, vh - 10]]) {
    let quiet = 0
    let n = 0
    for (let dx = -6; dx <= 6; dx += 3) {
      for (let dy = -6; dy <= 6; dy += 3) {
        const p = px(png, x + dx, y + dy)
        const sat = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)
        n++
        if (sat < 60 && lum(p) < 215) quiet++
      }
    }
    cornerStates.push({ quiet: quiet / n, x, y })
  }
  check('corners show the dimmed game (no full-screen panels)',
    cornerStates.every((c) => c.quiet >= 0.5),
    `corner quiet fractions: ${cornerStates.map((c) => c.quiet.toFixed(2)).join('/')} (HUD chrome tolerated; a comic full-bleed would score ~0.0)`)

  // 1b) The game scene is VISIBLE through the gentle dim: the region below
  // the band (where the live pile/theme renders) carries dimmed colored
  // gameplay elements, not a flat cover.
  {
    let colored = 0
    let n = 0
    const bandBottom = ballY + bandH / 2
    for (let x = vw * 0.2; x < vw * 0.8; x += 3) {
      for (let y = bandBottom + 55; y < bandBottom + 115; y += 3) {
        const p = px(png, x, y)
        n++
        if (Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) > 35) colored++
      }
    }
    check('game scene visible through the gentle dim (below the band)',
      n > 0 && colored / n >= 0.05, `${((colored / Math.max(1, n)) * 100).toFixed(1)}% colored px below the band`)
  }

  // 2) The band: tier-colored across the middle, full width. Sample points
  // near both edges (sparkle and disc positions avoided on every size).
  const bandXs = [0.05, 0.1, 0.16, 0.84, 0.9, 0.95]
  let redPts = 0
  for (const fx of bandXs) {
    let hits = 0
    for (let dx = -4; dx <= 4; dx += 2) for (let dy = -4; dy <= 4; dy += 2) {
      if (isTier4Red(px(png, vw * fx + dx, ballY + dy))) hits++
    }
    if (hits >= 8) redPts++
  }
  check('one tier-colored horizontal band across the middle (full width)',
    redPts >= 5, `${redPts}/6 band sample points tier-red at y=${ballY}`)

  // 3) Band thickness: vertical scan at x=0.18w.
  let bandPixels = 0
  for (let y = ballY - bandH * 0.75; y < ballY + bandH * 0.75; y += 2) {
    if (isTier4Red(px(png, vw * 0.18, y))) bandPixels++
  }
  check('the band is thick', bandPixels * 2 >= bandH * 0.6,
    `${bandPixels * 2}px of tier-red on the vertical scan (band height ${Math.round(bandH)}px)`)

  // 4) Cream spot-disc behind the character.
  let discHits = 0
  for (let a = 0; a < 360; a += 15) {
    const p = px(png, cx + Math.cos((a * Math.PI) / 180) * r * 1.2, ballY + Math.sin((a * Math.PI) / 180) * r * 1.2)
    if (isCream(p)) discHits++
  }
  check('cream spot-disc behind the character', discHits >= 8, `${discHits}/24 disc ring samples cream`)

  // 5) The character itself, centered on the band.
  let ballHits = 0
  for (let x = cx - r * 0.5; x < cx + r * 0.5; x += 6) {
    for (let y = ballY - r * 0.5; y < ballY + r * 0.5; y += 6) {
      if (isTier4Red(px(png, x, y))) ballHits++
    }
  }
  check('the discovered character is centered on the band', ballHits >= 15, `${ballHits} red samples near center`)

  // 6) Title: bold yellow glyphs with black outline, top of the screen.
  let titleYellow = 0
  let titleInk = 0
  for (let x = vw * 0.2; x < vw * 0.8; x += 2) {
    for (let y = vh * 0.04; y < vh * 0.24; y += 2) {
      const p = px(png, x, y)
      if (p.r > 200 && p.g > 175 && p.b < 130) titleYellow++
      else if (lum(p) < 45) titleInk++
    }
  }
  check('bold yellow NEW BALL DISCOVERED! title', titleYellow >= 60, `${titleYellow} yellow px`)
  check('black outline on the title', titleInk >= 30, `${titleInk} ink px in the title band`)

  // 7) Comic accents: halftone print row inside the band's top edge — the
  // ink dot cores pull the tier-red channel far below the band fill.
  let dotHits = 0
  for (let x = vw * 0.3; x < vw * 0.7; x += 2) {
    if (px(png, x, bandTop + 26).r < 175) dotHits++
  }
  check('halftone print row inside the band top edge', dotHits >= 12, `${dotHits} dot-core samples`)
  // ...and ink emphasis ticks around the character.
  let tickHits = 0
  for (let a = 0; a < 360; a += 6) {
    const p = px(png, cx + Math.cos((a * Math.PI) / 180) * r * 1.8, ballY + Math.sin((a * Math.PI) / 180) * r * 1.8)
    if (lum(p) < 50) tickHits++
  }
  check('comic ink emphasis ticks around the character', tickHits >= 4, `${tickHits}/60 tick-ring samples ink`)
}
