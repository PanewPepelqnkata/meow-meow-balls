import Phaser from 'phaser'
import { FONT_FAMILY } from '../../ui/Typography'
import { bakeCanvas } from './RoughArt'

export const INK_HEX = '#111625'
export const INK_NUM = 0x111625

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function rrPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
): void {
  const radii = typeof r === 'number' ? [r, r, r, r] : r
  const [tl, tr, br, bl] = radii.map((v) => Math.min(v, w / 2, h / 2)) as [number, number, number, number]
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

export function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  points = 5,
  innerRatio = 0.45,
): void {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const rad = i % 2 === 0 ? r : r * innerRatio
    const x = cx + Math.cos(a) * rad
    const y = cy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/** Faceted metal, a rolled lower band, and inset gems remain legible at icon size. */
export function paintCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  strokeW: number,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(w, h)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const body = new Path2D('M -.36 .32 Q -.39 -.02 -.46 -.3 L -.22 -.08 L 0 -.48 L .22 -.08 L .46 -.3 Q .39 -.02 .36 .32 Q 0 .48 -.36 .32 Z')
  ctx.fillStyle = '#f7b51b'
  ctx.fill(body)
  ctx.save()
  ctx.clip(body)
  ctx.fillStyle = '#fff08c'
  ctx.fill(new Path2D('M -.46 -.3 L -.22 -.08 L 0 -.48 L -.05 .25 L -.34 .25 Z'))
  ctx.fillStyle = '#d88112'
  ctx.fill(new Path2D('M .22 -.08 L .46 -.3 L .36 .4 L .1 .38 Z'))
  ctx.restore()
  // Draw the outline in unscaled units so a wide crown does not acquire heavy sides.
  ctx.restore()
  ctx.save()
  ctx.translate(cx, cy)
  const crown = new Path2D()
  crown.addPath(body, new DOMMatrix().scale(w, h))
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = strokeW
  ctx.lineJoin = 'round'
  ctx.stroke(crown)
  const band = new Path2D(`M ${-w * 0.36} ${h * 0.24} Q 0 ${h * 0.34} ${w * 0.36} ${h * 0.24} L ${w * 0.35} ${h * 0.42} Q 0 ${h * 0.52} ${-w * 0.35} ${h * 0.42} Z`)
  ctx.fillStyle = '#efa71d'
  ctx.fill(band)
  ctx.strokeStyle = '#8b451b'
  ctx.lineWidth = strokeW * 0.55
  ctx.stroke(band)
  ctx.strokeStyle = '#fff2a5'
  ctx.beginPath()
  ctx.moveTo(-w * 0.3, h * 0.29)
  ctx.quadraticCurveTo(0, h * 0.37, w * 0.27, h * 0.29)
  ctx.stroke()
  for (const [x, y, color] of [[-0.23, 0.1, '#e84237'], [0, 0.06, '#ed4334'], [0.23, 0.1, '#e84237']] as const) {
    const gem = new Path2D(`M ${x * w} ${(y - 0.13) * h} Q ${(x + 0.065) * w} ${y * h} ${x * w} ${(y + 0.12) * h} Q ${(x - 0.065) * w} ${y * h} ${x * w} ${(y - 0.13) * h} Z`)
    ctx.fillStyle = '#8d322d'
    ctx.fill(gem)
    ctx.strokeStyle = '#8b451b'
    ctx.lineWidth = strokeW * 0.45
    ctx.stroke(gem)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(x * w - w * 0.008, y * h - h * 0.025, w * 0.026, h * 0.07, -0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff4c5'
    ctx.beginPath()
    ctx.arc(x * w - w * 0.012, y * h - h * 0.057, w * 0.009, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const [x, y] of [[-0.46, -0.3], [0, -0.48], [0.46, -0.3]] as const) {
    const r = w * 0.058
    ctx.fillStyle = '#efa51a'
    ctx.beginPath()
    ctx.arc(x * w, y * h, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = strokeW * 0.8
    ctx.stroke()
    ctx.fillStyle = '#fff3a3'
    ctx.beginPath()
    ctx.arc(x * w - r * 0.27, y * h - r * 0.28, r * 0.47, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Pointed laurel blades have a bright face and a folded, amber underside. */
export function paintLaurelWing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  flipX: boolean,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(flipX ? -scale : scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(2, 29)
  ctx.bezierCurveTo(-21, 14, -28, -10, -24, -35)
  ctx.stroke()
  ctx.strokeStyle = '#e9a522'
  ctx.lineWidth = 2.5
  ctx.stroke()
  const leaves = [
    [-3, 24, -31, 19, -40, 2, -12, 0],
    [-14, 10, -39, -1, -42, -22, -14, -17],
    [-22, -6, -38, -23, -31, -45, -14, -33],
    [-22, -21, -26, -42, -15, -59, -5, -40],
    [-11, 15, 5, 9, 10, -8, -7, -5],
  ] as const
  for (const [bx, by, qx, qy, tx, ty, rx, ry] of leaves) {
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.quadraticCurveTo(qx, qy, tx, ty)
    ctx.quadraticCurveTo(rx, ry, bx, by)
    ctx.closePath()
    ctx.fillStyle = '#f5b926'
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.quadraticCurveTo(qx, qy, tx, ty)
    ctx.quadraticCurveTo((tx + bx) / 2 + 3, (ty + by) / 2, bx, by)
    ctx.fillStyle = '#ffe66a'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(bx - 1, by - 2)
    ctx.quadraticCurveTo((bx + tx) / 2, (by + ty) / 2 - 2, tx + 2, ty + 3)
    ctx.strokeStyle = '#bd7417'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.restore()
}

function paintRibbonTail(ctx: CanvasRenderingContext2D, flip: boolean): void {
  ctx.save()
  ctx.translate(180, 0)
  ctx.scale(flip ? -1 : 1, 1)
  // Back fold shadow
  const backFold = new Path2D('M -90 90 L -116 96 L -106 132 L -80 126 Z')
  ctx.fillStyle = '#7c1830'
  ctx.fill(backFold)
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 3.2
  ctx.stroke(backFold)
  // Forked crimson ribbon tail
  const tail = new Path2D('M -98 96 Q -124 96 -146 108 L -129 120 L -138 137 Q -114 131 -90 134 L -84 108 Z')
  ctx.fillStyle = '#d93240'
  ctx.fill(tail)
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 3.4
  ctx.stroke(tail)
  ctx.fillStyle = '#ff6856'
  ctx.fill(new Path2D('M -98 98 Q -122 99 -140 108 L -124 113 L -92 108 Z'))
  ctx.fillStyle = '#9e1d36'
  ctx.fill(new Path2D('M -96 112 L -90 132 L -110 128 L -114 112 Z'))
  // Side crimson cuff wrapping the lower shield edge
  const cuff = new Path2D('M -105 86 Q -110 108 -102 130 Q -86 133 -70 130 L -74 90 Q -90 88 -105 86 Z')
  ctx.fillStyle = '#c8293b'
  ctx.fill(cuff)
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 3.3
  ctx.stroke(cuff)
  ctx.fillStyle = '#f25549'
  ctx.fill(new Path2D('M -102 89 Q -106 106 -99 125 L -90 126 Q -95 107 -91 90 Z'))
  ctx.restore()
}

function paintCrestWood(ctx: CanvasRenderingContext2D): void {
  // Compact, shield-like royal timber backing that frames the stacked wordmark without wide plaque distortion
  const crest = new Path2D('M 74 52 Q 79 38 104 33 Q 180 16 256 33 Q 281 38 286 52 L 278 127 Q 276 141 258 143 Q 180 137 102 143 Q 84 141 82 127 Z')
  ctx.save()
  ctx.translate(0, 5)
  ctx.fillStyle = '#4e230f'
  ctx.fill(crest)
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 4.2
  ctx.stroke(crest)
  ctx.restore()
  ctx.fillStyle = '#f4b530'
  ctx.fill(crest)
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 3.8
  ctx.stroke(crest)
  ctx.save()
  ctx.clip(crest)
  // Top gold rim highlight
  ctx.fillStyle = '#fff099'
  ctx.fill(new Path2D('M 76 52 Q 180 18 284 52 L 280 62 Q 180 28 80 62 Z'))
  const timber = new Path2D('M 82 55 Q 85 44 108 39 Q 180 22 252 39 Q 275 44 278 55 L 272 125 Q 271 135 255 136 Q 180 130 105 136 Q 89 135 88 125 Z')
  ctx.fillStyle = '#82441d'
  ctx.fill(timber)
  ctx.strokeStyle = '#4e230f'
  ctx.lineWidth = 2.4
  ctx.stroke(timber)
  ctx.fillStyle = '#b0652a'
  ctx.fill(new Path2D('M 84 56 Q 180 24 276 56 L 274 76 Q 180 56 86 76 Z'))
  ctx.fillStyle = '#5c281c'
  ctx.fill(new Path2D('M 86 98 Q 180 86 274 98 L 272 134 Q 180 127 88 134 Z'))
  // Subtle plank seams
  ctx.strokeStyle = '#4e230f'
  ctx.lineWidth = 2.0
  ctx.beginPath()
  ctx.moveTo(85, 80)
  ctx.quadraticCurveTo(180, 62, 275, 80)
  ctx.moveTo(87, 106)
  ctx.quadraticCurveTo(180, 92, 273, 106)
  ctx.stroke()
  ctx.restore()
  // Corner gold rivets
  for (const [x, y] of [[90, 53], [270, 53], [92, 126], [268, 126]] as const) {
    ctx.fillStyle = '#4e230f'
    ctx.beginPath()
    ctx.arc(x, y + 1.2, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffd569'
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.1
    ctx.stroke()
  }
}

function paintCrestWord(ctx: CanvasRenderingContext2D, word: string, y: number, cyan: boolean): void {
  ctx.save()
  const fontSize = cyan ? 62 : 58
  ctx.font = `900 ${fontSize}px ${FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const widths = Array.from(word, (char) => ctx.measureText(char).width)
  const gap = cyan ? 2.5 : 2
  const naturalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (word.length - 1)
  // Never stretch letters horizontally (>1.0); keep natural compact Lilita One proportions
  const maxSpan = cyan ? 176 : 162
  const widthScale = Math.min(1, maxSpan / Math.max(1, naturalWidth))
  const totalSpan = naturalWidth * widthScale
  let x = 180 - totalSpan / 2
  for (let i = 0; i < word.length; i++) {
    const width = widths[i]! * widthScale
    const centeredIdx = i - (word.length - 1) / 2
    const arch = centeredIdx * centeredIdx * (cyan ? 1.15 : 1.3)
    ctx.save()
    ctx.translate(x + width / 2, y + arch)
    ctx.rotate(centeredIdx * (cyan ? 0.028 : 0.032))
    ctx.scale(widthScale, 1)
    // Deep 3D block extrusion
    for (let d = 6; d >= 1; d--) {
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 9.5
      ctx.strokeText(word[i]!, 0, d)
      ctx.fillStyle = cyan ? '#0b6296' : '#a86728'
      ctx.fillText(word[i]!, 0, d)
    }
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 9
    ctx.strokeText(word[i]!, 0, 0)
    const face = ctx.createLinearGradient(0, -26, 0, 24)
    if (cyan) {
      face.addColorStop(0, '#e6ffff')
      face.addColorStop(0.32, '#73ecff')
      face.addColorStop(0.75, '#25b6f2')
      face.addColorStop(1, '#1289cc')
    } else {
      face.addColorStop(0, '#ffffff')
      face.addColorStop(0.45, '#fff6d6')
      face.addColorStop(1, '#ffd478')
    }
    ctx.fillStyle = face
    ctx.fillText(word[i]!, 0, 0)
    // Top specular gloss bar
    ctx.fillStyle = cyan ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.62)'
    ctx.fillText(word[i]!, 0, -1.2)
    ctx.restore()
    x += width + gap * widthScale
  }
  ctx.restore()
}

/** Authored in a 360 × 156 box; both words share one compact arched crest with zero horizontal stretch. */
export function paintKingdomLogo(ctx: CanvasRenderingContext2D, w: number, h: number, includeRush = true): void {
  const scale = Math.min(w / 360, h / 156)
  ctx.save()
  ctx.translate((w - 360 * scale) / 2, (h - 156 * scale) / 2)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintRibbonTail(ctx, false)
  paintRibbonTail(ctx, true)
  paintLaurelWing(ctx, 82, 96, 0.98, false)
  paintLaurelWing(ctx, 278, 96, 0.98, true)
  paintCrestWood(ctx)
  paintCrown(ctx, 180, 24, 72, 38, 2.8)
  paintCrestWord(ctx, 'BALL', 65, false)
  if (includeRush) paintCrestWord(ctx, 'RUSH', 113, true)
  ctx.restore()
}

export function paintKingdomRushOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const scale = Math.min(w / 360, h / 156)
  ctx.save()
  ctx.translate((w - 360 * scale) / 2, (h - 156 * scale) / 2)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintCrestWord(ctx, 'RUSH', 113, true)
  ctx.restore()
}

/** Supersampled 2x canvas bake so the crest and 3D lettering stay razor-sharp on all displays. */
export function bakeKingdomLogo(
  scene: Phaser.Scene,
  w: number,
  h: number,
  dpr: number,
  includeRush = true,
): Phaser.GameObjects.Image {
  const key = includeRush ? 'br-kingdom-logo' : 'br-kingdom-logo-base'
  const hiW = Math.ceil(w * 1.5)
  const hiH = Math.ceil(h * 1.5)
  bakeCanvas(scene, key, hiW, hiH, (ctx) => paintKingdomLogo(ctx, hiW, hiH, includeRush), Math.max(2, dpr))
  return scene.add.image(0, 0, key).setDisplaySize(Math.ceil(w), Math.ceil(h))
}

export function bakeKingdomRushWord(
  scene: Phaser.Scene,
  w: number,
  h: number,
  dpr: number,
): Phaser.GameObjects.Image {
  const key = 'br-kingdom-logo-rush'
  const hiW = Math.ceil(w * 1.5)
  const hiH = Math.ceil(h * 1.5)
  bakeCanvas(scene, key, hiW, hiH, (ctx) => paintKingdomRushOverlay(ctx, hiW, hiH), Math.max(2, dpr))
  const scale = Math.min(w / 360, h / 156)
  const rushOffsetY = (113 - 78) * scale
  return scene.add.image(0, rushOffsetY, key).setOrigin(0.5, 113 / 156).setDisplaySize(Math.ceil(w), Math.ceil(h))
}
