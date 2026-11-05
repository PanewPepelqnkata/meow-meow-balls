/** Shared minted Ball Rush coin artwork and currency formatting. */
import Phaser from 'phaser'
import { INK } from './BallAppearance'

const GOLD = 0xf5bd35
const GOLD_DARK = 0x9b5c12
const GOLD_LIGHT = 0xffe78a
const RIM = 0xd88b1f

/** Draw a bold arcade token with a raised center and simple ball emblem. */
export function drawCoin(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.fillStyle(INK, 1)
  g.fillCircle(x + r * 0.08, y + r * 0.1, r)
  g.fillStyle(GOLD_DARK, 1)
  g.fillCircle(x, y, r)
  g.lineStyle(Math.max(1.5, r * 0.14), INK, 1)
  g.strokeCircle(x, y, r * 0.94)

  g.fillStyle(GOLD, 1)
  g.fillCircle(x, y, r * 0.73)
  g.lineStyle(Math.max(1, r * 0.07), RIM, 1)
  g.strokeCircle(x, y, r * 0.73)

  // A compact ball emblem: round body, eyes and smile stay recognizable small.
  const br = r * 0.36
  const by = y + r * 0.06
  g.fillStyle(GOLD_DARK, 1)
  g.fillCircle(x, by, br)
  g.lineStyle(Math.max(1, r * 0.07), INK, 1)
  g.strokeCircle(x, by, br)
  g.fillStyle(GOLD_LIGHT, 1)
  g.fillCircle(x - br * 0.3, by - br * 0.3, br * 0.1)
  g.fillCircle(x + br * 0.3, by - br * 0.3, br * 0.1)
  g.lineStyle(Math.max(1, r * 0.06), INK, 1)
  g.beginPath()
  g.arc(x, by + br * 0.04, br * 0.37, 0.2, Math.PI - 0.2, false)
  g.strokePath()

  g.lineStyle(Math.max(1, r * 0.08), GOLD_LIGHT, 0.9)
  g.beginPath()
  g.arc(x, y, r * 0.8, Math.PI * 1.12, Math.PI * 1.62, false)
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
