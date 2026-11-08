import { FONT_FAMILY } from '../../ui/Typography'
import { INK_HEX, rrPath } from './KingdomMenuArt'
import type { KingdomButtonIconKind } from './KingdomIconPaint'
import { paintButtonIcon } from './KingdomIconPaint'

export const STORE_INK = 0x111625
export const STORE_INK_HEX = '#111625'
export const STORE_WOOD = 0x82441d
export const STORE_WOOD_LIGHT = 0xb0652a
export const STORE_WOOD_DARK = 0x4e230f
export const STORE_WOOD_GRAIN = 0xd9934e
export const STORE_CANOPY_RED = 0xbe2b2b
export const STORE_CANOPY_CREAM = 0xf6ede0
export const STORE_GOLD = 0xffce42
export const STORE_PAPER = 0xfff9ec
export const STORE_PAPER_BASE = 0xf3e5c8
export const STORE_GREEN = 0x3ca72b
export const STORE_GREEN_DARK = 0x27741b
export const STORE_GREEN_LIGHT = 0x62cb49
function paintBolt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = '#ffce42'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = Math.max(0.65, r * 0.34)
  ctx.stroke()
  ctx.fillStyle = '#fff4a8'
  ctx.beginPath()
  ctx.ellipse(x - r * 0.24, y - r * 0.28, r * 0.4, r * 0.28, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#82441d'
  ctx.beginPath()
  ctx.moveTo(x - r * 0.32, y + r * 0.2)
  ctx.lineTo(x + r * 0.32, y - r * 0.2)
  ctx.stroke()
}

function signPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, play: boolean): void {
  rrPath(ctx, x, y, w, h, Math.min(play ? 18 : 13, h * (play ? 0.34 : 0.26)))
}

function paintWoodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.strokeStyle = '#4e230f'
  ctx.lineWidth = Math.max(0.9, h * 0.022)
  for (const fraction of [0.24, 0.76]) {
    ctx.beginPath()
    ctx.moveTo(x + h * 0.2, y + h * fraction)
    ctx.bezierCurveTo(x + w * 0.32, y + h * (fraction - 0.03), x + w * 0.64, y + h * (fraction + 0.03), x + w - h * 0.2, y + h * fraction)
    ctx.stroke()
  }
  ctx.strokeStyle = '#d9934e'
  ctx.lineWidth = Math.max(0.7, h * 0.016)
  ctx.beginPath()
  ctx.moveTo(x + h * 0.32, y + h * 0.1)
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.06, x + w - h * 0.28, y + h * 0.1)
  ctx.stroke()
}

function paintMedallionBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, isPlay: boolean): void {
  ctx.save()
  // Outer shadow
  ctx.fillStyle = 'rgba(17, 22, 37, 0.38)'
  ctx.beginPath()
  ctx.arc(cx + 0.8, cy + 1.8, r * 1.05, 0, Math.PI * 2)
  ctx.fill()

  // Forged gold/brass outer bezel
  const bezelGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  bezelGrad.addColorStop(0, '#fff2a6')
  bezelGrad.addColorStop(0.45, '#f2b632')
  bezelGrad.addColorStop(1, '#9c6214')
  ctx.fillStyle = bezelGrad
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = Math.max(1.5, r * 0.13)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Recessed dark royal velvet/mahogany well so the 3D icon pops with high contrast
  const wellGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.05, cx, cy, r * 0.82)
  if (isPlay) {
    wellGrad.addColorStop(0, '#2c851f')
    wellGrad.addColorStop(1, '#164d0f')
  } else {
    wellGrad.addColorStop(0, '#3e2638')
    wellGrad.addColorStop(1, '#1e1424')
  }
  ctx.fillStyle = wellGrad
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = Math.max(1, r * 0.09)
  ctx.stroke()
  ctx.restore()
}

/** Paints into a (w + 16) × (h + 16) image; the physical face starts at (8, 8). */
export function paintSignboardButton(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  iconKind: KingdomButtonIconKind,
  isPlay: boolean,
  compactGrid: boolean,
  label = '',
  showIcon = true,
): void {
  const x = 8
  const y = 8
  const depth = h * (isPlay ? 0.095 : 0.09)
  const faceH = h - depth
  const border = Math.max(2.5, faceH * 0.085)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Soft drop shadow
  ctx.fillStyle = 'rgba(17, 22, 37, 0.34)'
  signPath(ctx, x + 1, y + depth + 2.5, w, faceH, isPlay)
  ctx.fill()

  // Bottom 3D lip
  ctx.fillStyle = isPlay ? '#236b18' : '#431f10'
  signPath(ctx, x, y + depth, w, faceH, isPlay)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = isPlay ? 2.6 : Math.max(2, h * 0.05)
  ctx.stroke()

  // Main button body
  const bodyGrad = ctx.createLinearGradient(x, y, x, y + faceH)
  if (isPlay) {
    bodyGrad.addColorStop(0, '#55c93d')
    bodyGrad.addColorStop(0.55, '#3ca72b')
    bodyGrad.addColorStop(1, '#2b821d')
  } else {
    bodyGrad.addColorStop(0, '#9c5425')
    bodyGrad.addColorStop(0.5, '#7e3f19')
    bodyGrad.addColorStop(1, '#5c2b10')
  }
  ctx.fillStyle = bodyGrad
  signPath(ctx, x, y, w, faceH, isPlay)
  ctx.fill()

  ctx.save()
  signPath(ctx, x, y, w, faceH, isPlay)
  ctx.clip()
  // Top bevel sheen
  ctx.fillStyle = isPlay ? 'rgba(162, 248, 132, 0.42)' : 'rgba(228, 152, 88, 0.34)'
  ctx.fillRect(x, y, w, Math.max(4, faceH * 0.2))
  // Bottom inner shadow
  ctx.fillStyle = isPlay ? 'rgba(24, 78, 16, 0.35)' : 'rgba(42, 17, 7, 0.42)'
  ctx.fillRect(x, y + faceH * 0.82, w, faceH * 0.18)
  if (!isPlay) paintWoodGrain(ctx, x, y, w, faceH)
  ctx.restore()

  // Crisp outer ink outline
  signPath(ctx, x, y, w, faceH, isPlay)
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = isPlay ? 2.6 : Math.max(2.1, h * 0.05)
  ctx.stroke()

  // Inner brass/gold frame inlay + corner rivets
  rrPath(ctx, x + border, y + border, w - border * 2, faceH - border * 2, Math.max(5, Math.min(11, faceH * 0.2)))
  ctx.strokeStyle = isPlay ? 'rgba(255, 247, 178, 0.55)' : 'rgba(255, 206, 66, 0.72)'
  ctx.lineWidth = Math.max(1, h * 0.024)
  ctx.stroke()
  if (!isPlay) {
    const boltOffset = border + 3.2
    paintBolt(ctx, x + w - boltOffset, y + boltOffset, Math.max(1.5, faceH * 0.036))
    paintBolt(ctx, x + w - boltOffset, y + faceH - boltOffset, Math.max(1.5, faceH * 0.036))
  }

  const iconX = x + (isPlay ? faceH * 0.62 : compactGrid ? faceH * 0.56 : faceH * 0.62)
  const iconY = y + faceH * 0.5
  if (showIcon && !isPlay) {
    const badgeR = faceH * (compactGrid ? 0.36 : 0.38)
    paintMedallionBadge(ctx, iconX, iconY, badgeR, false)
    paintButtonIcon(ctx, iconKind, iconX, iconY, badgeR * 0.68)
  }
  if (showIcon && isPlay) {
    const badgeR = faceH * 0.36
    paintMedallionBadge(ctx, iconX, iconY, badgeR, true)
    paintButtonIcon(ctx, 'play', iconX + badgeR * 0.06, iconY, badgeR * 0.58)
  }
  if (label) paintSignLabel(ctx, label, x, y, w, faceH, iconX, isPlay, compactGrid)
  ctx.restore()
}

function paintSignLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, w: number, h: number, iconX: number, play: boolean, compact: boolean): void {
  const size = h * (play ? 0.52 : compact ? 0.34 : 0.38)
  const left = iconX + h * 0.44
  const right = x + w - (play ? h * 0.45 : h * 0.28)
  ctx.font = `900 ${size}px ${FONT_FAMILY}`
  const fit = Math.min(1, Math.max(20, right - left) / Math.max(1, ctx.measureText(label).width))
  ctx.font = `900 ${size * fit}px ${FONT_FAMILY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const textX = play ? x + w * 0.54 : (left + right) / 2
  const textY = y + h * 0.52
  ctx.lineWidth = play ? size * fit * 0.2 : Math.max(1.3, size * fit * 0.1)
  ctx.strokeStyle = INK_HEX
  ctx.strokeText(label, textX, textY + (play ? 1.5 : 0.5))
  ctx.fillStyle = '#fff9ec'
  ctx.fillText(label, textX, textY)
}
/** Text and icons are deliberately separate: the native menu owns each value once. */
export function paintStatsPlaque(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pad = 2.5
  const radius = Math.min(12, h * 0.22)
  ctx.fillStyle = 'rgba(17, 22, 37, 0.32)'
  rrPath(ctx, pad + 0.5, pad + 3.5, w - pad * 2, h - pad * 2 - 1, radius)
  ctx.fill()
  // Thick timber edges surround a carved, dark wood recess.
  ctx.fillStyle = '#4e230f'
  rrPath(ctx, pad, pad + 2, w - pad * 2, h - pad * 2 - 2, radius)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 2.2
  ctx.stroke()
  ctx.fillStyle = '#82441d'
  rrPath(ctx, pad, pad, w - pad * 2, h - pad * 2 - 2, radius)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#b0652a'
  rrPath(ctx, pad + 1.6, pad + 1.2, w - pad * 2 - 3.2, h - pad * 2 - 5.2, radius - 1.5)
  ctx.fill()
  ctx.fillStyle = '#4e230f'
  rrPath(ctx, pad + 4, pad + 4, w - pad * 2 - 8, h - pad * 2 - 9.6, radius - 4)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.save()
  ctx.clip()
  ctx.globalAlpha = 0.4
  paintWoodGrain(ctx, pad + 4, pad + 4, w - pad * 2 - 8, h - pad * 2 - 9.6)
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(17, 22, 37, 0.16)'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.52)
  ctx.quadraticCurveTo(w * 0.5, h * 0.64, w, h * 0.48)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.fill()
  ctx.restore()
  // Brass inlay and fasteners sit on the rim, clear of the native stat bands.
  ctx.strokeStyle = '#ffce42'
  ctx.lineWidth = 1
  rrPath(ctx, pad + 2.7, pad + 2.7, w - pad * 2 - 5.4, h - pad * 2 - 7, radius - 2.7)
  ctx.stroke()
  paintBolt(ctx, pad + 3.1, h * 0.5, 1.6)
  paintBolt(ctx, w - pad - 3.1, h * 0.5, 1.6)
  for (const frac of [1 / 3, 2 / 3]) {
    const x = Math.round(w * frac)
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(x - 0.5, h * 0.22)
    ctx.lineTo(x - 0.5, h * 0.74)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 206, 66, 0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + 0.7, h * 0.23)
    ctx.lineTo(x + 0.7, h * 0.73)
    ctx.stroke()
  }
  ctx.restore()
}

