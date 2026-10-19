import Phaser from 'phaser'
import type { UiLayout } from './ResponsiveLayout'
import { hudText, SCORE_GREEN, WHITE } from './Typography'

/**
 * Phase 2.11.0 score display (spec §5): Best + Global ranking top-left
 * (white fill, thick ink outline) and the current Score top-center in the
 * reference green `#00E83B`. One consistent display font via Typography.
 */
export class ScoreDisplay {
  private best: Phaser.GameObjects.Text | null = null
  private global: Phaser.GameObjects.Text | null = null
  private score: Phaser.GameObjects.Text | null = null
  private scoreVal = 0
  private bestVal = 0
  private readonly scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  layout(l: UiLayout): void {
    const pop = (old: Phaser.GameObjects.Text | null, x: number, y: number): boolean =>
      old != null && Math.abs(old.x - x) < 0.5 && Math.abs(old.y - y) < 0.5
    // Rendered px size (hudText rounds design·fontScale) — rebuild when the
    // layout scales the text differently (orientation/size change).
    const rendered = (design: number): number => Math.max(10, Math.round(design * l.fontScale))

    // Best/Global sizes are layout-driven (portrait keeps them clearly
    // smaller than the score hero; landscape matches the reference sizes).
    if (!pop(this.best, l.best.x, l.best.y) || this.best?.style?.fontSize !== `${rendered(l.bestSize)}px`) {
      this.best?.destroy()
      this.best = hudText(this.scene, l.best.x, l.best.y, `Best: ${this.bestVal}`, l.fontScale, {
        color: WHITE,
        size: l.bestSize,
        stroke: 4,
      })
    } else {
      this.best?.setPosition(l.best.x, l.best.y)
    }
    if (!pop(this.global, l.global.x, l.global.y) || this.global?.style?.fontSize !== `${rendered(l.globalSize)}px`) {
      this.global?.destroy()
      this.global = hudText(this.scene, l.global.x, l.global.y, this.globalText(), l.fontScale, {
        color: WHITE,
        size: l.globalSize,
        stroke: 3,
      })
    } else {
      this.global?.setPosition(l.global.x, l.global.y)
    }
    if (!pop(this.score, l.score.x, l.score.y)) {
      this.score?.destroy()
      this.score = hudText(this.scene, l.score.x, l.score.y, `Score: ${this.scoreVal}`, l.fontScale, {
        color: SCORE_GREEN,
        // Design size comes from the layout. The landscape value must match
        // ResponsiveLayout.WORLD_GEOM.SCORE_DESIGN_SIZE.
        size: l.scoreSize,
        stroke: 4,
        origin: [0.5, 0],
      })
    } else {
      this.score?.setPosition(l.score.x, l.score.y)
    }
  }

  private globalText(): string {
    // No leaderboard backend exists yet (Phase 9) — the rank is shown
    // honestly as a dash; the layout/text style matches the reference.
    // Portrait shortens the line so the top row always fits Best + Score.
    return 'Global #—'
  }

  setScore(score: number, best: number): void {
    this.scoreVal = score
    this.bestVal = best
    this.score?.setText(`Score: ${score}`)
    this.best?.setText(`Best: ${best}`)
  }
}
