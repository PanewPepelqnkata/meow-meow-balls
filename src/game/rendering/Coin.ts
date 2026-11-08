/**
 * Canonical Ball Rush coin artwork and currency formatting.
 * Single source of truth used across Main Menu, Store, Game Over, and all UI.
 */
import Phaser from 'phaser'
import { INK } from './BallAppearance'
import { INK_HEX, starPath } from './KingdomMenuArt'

const COIN_BODY = 0xf5b82e
const COIN_CRESCENT = 0xfff29c
const COIN_INNER_RING = 0xc87e19
const COIN_STAR = 0xfff6b8

/** Paint the canonical 4-point star coin onto a 2D canvas context. */
export function paintCanonicalCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(r, r)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.fillStyle = '#f5b82e'
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.11
  ctx.beginPath()
  ctx.arc(0, 0, 0.86, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#fff29c'
  ctx.beginPath()
  ctx.arc(-0.08, -0.1, 0.72, Math.PI * 0.95, Math.PI * 1.95)
  ctx.fill()
  ctx.strokeStyle = '#c87e19'
  ctx.lineWidth = 0.11
  ctx.beginPath()
  ctx.arc(0, 0, 0.62, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#fff6b8'
  starPath(ctx, 0, 0, 0.42, 4, 0.44)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.08
  ctx.stroke()
  ctx.restore()
}

/** Draw the canonical 4-point star coin in Phaser Graphics (Store, Game Over, etc.). */
export function drawCoin(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  const scale = r / 0.86
  const outerR = scale * 0.86
  const outerStroke = Math.max(1.2, scale * 0.11)

  // Subtle drop shadow for depth on wooden/parchment surfaces
  g.fillStyle(INK, 0.28)
  g.fillCircle(x + outerR * 0.06, y + outerR * 0.09, outerR)

  // Main golden coin disc (#f5b82e)
  g.fillStyle(COIN_BODY, 1)
  g.fillCircle(x, y, outerR)

  // Top-left specular crescent highlight (#fff29c)
  g.fillStyle(COIN_CRESCENT, 1)
  g.beginPath()
  g.arc(x - scale * 0.08, y - scale * 0.1, scale * 0.72, Math.PI * 0.95, Math.PI * 1.95, false)
  g.closePath()
  g.fillPath()

  // Outer ink outline (#111625)
  g.lineStyle(outerStroke, INK, 1)
  g.strokeCircle(x, y, outerR)

  // Warm amber inner ring (#c87e19)
  g.lineStyle(Math.max(1, scale * 0.11), COIN_INNER_RING, 1)
  g.strokeCircle(x, y, scale * 0.62)

  // Center 4-point star emblem (#fff6b8 with #111625 stroke)
  const starOuter = scale * 0.42
  const starInner = starOuter * 0.44
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 4
    const rad = i % 2 === 0 ? starOuter : starInner
    pts.push({ x: x + Math.cos(angle) * rad, y: y + Math.sin(angle) * rad })
  }
  g.fillStyle(COIN_STAR, 1)
  g.beginPath()
  g.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) {
    g.lineTo(pts[i]!.x, pts[i]!.y)
  }
  g.closePath()
  g.fillPath()
  g.lineStyle(Math.max(0.9, scale * 0.08), INK, 1)
  g.strokePath()
}

/** Calculate coins earned: score / 1000, rounded to one decimal place. */
export function coinsForScore(score: number): number {
  return Math.round((score / 1000) * 10) / 10
}

/** Always format a balance with one decimal place. */
export function formatCoins(coins: number): string {
  return coins.toFixed(1)
}
