import Phaser from 'phaser'
import type { UiLayout } from './ResponsiveLayout'
import { getTier } from '../config/ballTiers'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawTier9Ball } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'
import { hudText, WHITE } from './Typography'

/**
 * Phase 2.11.0 next-ball preview (spec §5, §11): draws the UPCOMING ball
 * through the SHARED `BallAppearance` pipeline — the same tier color, the
 * same seed, the same functions the gameplay renderer and the crane use.
 * Not a texture, not a generic circle: the actual character that will drop.
 */
export class NextBall {
  private g: Phaser.GameObjects.Graphics | null = null
  private label: Phaser.GameObjects.Text | null = null
  private tier = 1
  private seed = 1
  private pos: { x: number; y: number } = { x: 0, y: 0 }
  private diameter = 56
  private readonly scene: Phaser.Scene

  /** Hide the next-ball preview (the collectible card owns the screen). */
  setVisible(visible: boolean): void {
    this.g?.setVisible(visible)
    this.label?.setVisible(visible)
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /** QA hook: preview ball center + diameter (viewport px). */
  center(): { x: number; y: number; diameter: number } {
    return { x: this.pos.x, y: this.pos.y, diameter: this.diameter }
  }

  setNext(tier: number, seed: number): void {
    if (this.tier === tier && this.seed === seed) return
    this.tier = tier
    this.seed = seed
    this.redraw()
  }

  layout(l: UiLayout): void {
    this.pos = { x: l.nextBall.pos.x, y: l.nextBall.pos.y }
    this.diameter = l.nextBall.diameter
    this.g?.destroy()
    this.label?.destroy()
    this.g = this.scene.add.graphics().setDepth(42)
    // Portrait: the label sits BESIDE the disc (left-aligned block, compact).
    // Desktop: the label sits BELOW the disc (original centered layout).
    this.label = hudText(this.scene, l.nextBall.label.x, l.nextBall.label.y, 'Next Ball:', l.fontScale, {
      color: WHITE,
      size: 18,
      stroke: 3,
      origin: l.nextBall.labelAlign === 'left' ? [0, 0.5] : [0.5, 0],
    })
    this.redraw()
  }

  /** Draw the character centered at the configured position. */
  private redraw(): void {
    const g = this.g
    if (!g) return
    g.clear()
    const tier = getTier(this.tier)
    if (!tier || !this.label) return
    const r = this.diameter / 2
    const look = ballLookFor(this.tier, this.seed)
    const poly = restContour(look, r, this.pos.x, this.pos.y, 40)
    
    // Phase 2.12.1: Special rendering for Tier 8/9 in preview.
    // Phase 2.14.0: per-run variant (tiers 8-9 randomize each run).
    if (this.tier === 8) {
      // The cycling RGB ball: one solid colour, stepping every 0.25s.
      const pts = poly.map(p => ({ x: p.x, y: p.y }))
      g.fillStyle(cycleColor(Date.now()), 1)
      g.fillPoints(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(g, look, { x: this.pos.x, y: this.pos.y }, r, 1)
    } else if (this.tier === 9) {
      // The theme ball paints its own face — part of the design. The
      // run's theme roll (shark/pig) picks the renderer; the variant
      // picks the palette within the theme.
      drawTier9Ball(g, this.pos.x, this.pos.y, r, variantIdFor(9), poly, 0, undefined, this.seed)
    } else {
      g.fillStyle(tier.color, 1)
      g.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(g, look, { x: this.pos.x, y: this.pos.y }, r, 1)
    }
  }
}
