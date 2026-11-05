/**
 * Golden coin with a ball silhouette — the game's currency.
 * Used in game-over screen (coins earned) and main menu (total coins).
 */

import Phaser from 'phaser'
import { INK } from './BallAppearance'

const GOLD = 0xe5ad32
const GOLD_DARK = 0xb8860b
const GOLD_LIGHT = 0xf4d03f
const BALL_SHADE = 0x8b6914

/**
 * Draw a golden coin with a subtle ball silhouette inside.
 * @param g Phaser Graphics to draw into
 * @param x Center X
 * @param y Center Y
 * @param r Coin radius
 */
export function drawCoin(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  // Outer rim (darker gold)
  g.fillStyle(GOLD_DARK, 1)
  g.fillCircle(x, y, r)
  g.lineStyle(1.5, INK, 0.9)
  g.strokeCircle(x, y, r)

  // Inner face (bright gold)
  g.fillStyle(GOLD, 1)
  g.fillCircle(x, y, r * 0.82)

  // Top-left highlight (light gold)
  g.fillStyle(GOLD_LIGHT, 0.7)
  g.fillEllipse(x - r * 0.25, y - r * 0.28, r * 0.5, r * 0.28)

  // Ball silhouette (subtle darker shade, slightly offset down-right)
  const ballR = r * 0.45
  const ballX = x + r * 0.06
  const ballY = y + r * 0.08
  g.fillStyle(BALL_SHADE, 0.35)
  g.fillCircle(ballX, ballY, ballR)

  // Ball outline (subtle)
  g.lineStyle(1, INK, 0.25)
  g.strokeCircle(ballX, ballY, ballR)

  // Ball highlight (tiny, top-left of ball)
  g.fillStyle(0xffffff, 0.2)
  g.fillEllipse(ballX - ballR * 0.3, ballY - ballR * 0.35, ballR * 0.35, ballR * 0.2)
}

/**
 * Calculate coins earned for a given score: score / 1000, rounded to 1 decimal place.
 */
export function coinsForScore(score: number): number {
  return Math.round((score / 1000) * 10) / 10
}

/**
 * Format coin count for display: 15.8, 142.0, etc.
 * Always shows one decimal place.
 */
export function formatCoins(coins: number): string {
  return coins.toFixed(1)
}
