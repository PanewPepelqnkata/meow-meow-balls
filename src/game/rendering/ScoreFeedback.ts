import Phaser from 'phaser'
import { gradeForChain } from '../../config/presentation'
import { getTier } from '../../config/ballTiers'
import { COMBO_FEEDBACK, comboStyleFor } from '../../config/comboFeedback'

/**
 * Merge reward feedback driven by REAL game state.
 *
 * - The `+N` popup shows the actual points awarded, tinted with the merged
 *   tier's color (bold cartoon lettering, thick outline, offset shadow).
 * - The grade label and `Nx Combo!` derive from the REAL merge-chain depth
 *   passed by MergeSystem via the centralized `gradeForChain` mapping —
 *   never from score size, so an ordinary single merge can never show a top
 *   grade.
 * - SIZING/ANIMATION live in `src/config/comboFeedback.ts`: every combo
 *   level is visibly bigger/brighter than the last (punch + bounce + wiggle,
 *   halo, star sparkles), with hard size ceilings so a mega-chain can never
 *   cover the play field.
 * - Concurrent popups stagger into separate lanes so overlapping merges
 *   stay readable and never stack on one pixel.
 */

const POPUP_DEPTH = 1000

interface ScorePopup {
  container: Phaser.GameObjects.Container
  created: number
  duration: number
}

export class ScoreFeedback {
  private scene: Phaser.Scene
  private popups: ScorePopup[] = []
  /** Lane cycler: spreads simultaneous popups vertically. */
  private lane = 0
  /** Live merge-burst objects (killed on restart). */
  private burstObjs: Array<Phaser.GameObjects.GameObject> = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /** QA hook (read-only): live popup count. */
  get popupCount(): number {
    return this.popups.length
  }

  /** QA hook (read-only): text labels currently shown. */
  get popupLabels(): string[] {
    return this.popups.map((p) => {
      const texts = p.container?.list.filter(
        (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text,
      )
      return texts?.map((t) => t.text).join(' | ') ?? ''
    })
  }

  /** QA hook (read-only): alphas of live popups. */
  get popupAlphas(): number[] {
    return this.popups.map((p) => p.container?.alpha ?? 0)
  }

  /**
   * Show the reward for one completed merge.
   * @param chainDepth the REAL merge-chain depth from MergeSystem (≥1).
   * @param tier the merged-into tier (colors the `+N` text).
   */
  showScoreReward(points: number, x: number, y: number, showGrade = true, chainDepth = 1, tier = 2): void {
    if (this.popups.length >= COMBO_FEEDBACK.maxPopups) return
    const depth = Math.max(1, chainDepth)
    const style = comboStyleFor(depth)
    const duration = style.durationMs

    // Stagger lanes so quick chains don't stack every label on one pixel.
    // Only apply the offset while older popups are still fading.
    const active = this.popups.filter((p) => this.scene.time.now - p.created < duration * 0.6)
    const laneIdx = active.length > 0 ? this.lane++ % COMBO_FEEDBACK.laneOffsetsX.length : 0
    const px = x + COMBO_FEEDBACK.laneOffsetsX[laneIdx]!
    // Keep the floating stack inside the stage: never above the HUD zone.
    const py = Math.max(120, y - 20 - laneIdx * COMBO_FEEDBACK.laneOffsetY)

    const container = this.scene.add.container(px, py).setDepth(POPUP_DEPTH)

    // Halo ring (depth ≥ 3): a soft colored ellipse behind the text stack.
    if (style.haloColor) {
      const halo = this.scene.add.graphics()
      halo.fillStyle(Phaser.Display.Color.HexStringToColor(style.haloColor).color, style.haloAlpha)
      halo.fillEllipse(0, 34, style.scoreSize * 2.6, (style.scoreSize + style.gradeSize) * 1.15)
      container.add(halo)
      halo.setScale(0.4)
      this.scene.tweens.add({
        targets: halo,
        scale: 1,
        alpha: { from: 0, to: 1 },
        duration: style.punchMs,
        ease: 'Back.easeOut',
      })
    }

    // `+N` in the merged tier's color — bold, outlined, offset shadow.
    const tierColor = getTier(tier)?.color ?? 0xffeb3b
    const scoreSize = Math.min(style.scoreSize, COMBO_FEEDBACK.maxScoreSize)
    const scoreText = this.scene.add.text(0, 0, `+${points}`, {
      fontFamily: 'Lilita One, Arial Black, sans-serif',
      fontSize: `${scoreSize}px`,
      color: '#' + tierColor.toString(16).padStart(6, '0'),
      stroke: '#000000',
      strokeThickness: style.scoreStroke,
    })
    scoreText.setOrigin(0.5)
    scoreText.setShadow(style.shadowOffset, style.shadowOffset, '#000000', style.shadowOffset * 2, true, true)
    container.add(scoreText)

    if (showGrade) {
      const { grade, color } = gradeForChain(depth)
      const gradeText = this.scene.add.text(0, scoreSize * 0.62, grade, {
        fontFamily: 'Lilita One, Arial Black, sans-serif',
        fontSize: `${Math.min(style.gradeSize, COMBO_FEEDBACK.maxGradeSize)}px`,
        color,
        stroke: '#000000',
        strokeThickness: style.gradeStroke,
      })
      gradeText.setOrigin(0.5)
      gradeText.setShadow(style.shadowOffset, style.shadowOffset, '#000000', style.shadowOffset * 2, true, true)
      container.add(gradeText)

      if (depth >= 2) {
        const comboY = scoreSize * 0.62 + Math.min(style.comboSize, COMBO_FEEDBACK.maxComboSize) * 1.15
        const comboText = this.scene.add.text(0, comboY, `${depth}x Combo!`, {
          fontFamily: 'Lilita One, Arial Black, sans-serif',
          fontSize: `${Math.min(style.comboSize, COMBO_FEEDBACK.maxComboSize)}px`,
          color: style.comboColor,
          stroke: '#000000',
          strokeThickness: style.comboStroke,
        })
        comboText.setOrigin(0.5)
        comboText.setShadow(style.shadowOffset, style.shadowOffset, '#000000', style.shadowOffset * 2, true, true)
        container.add(comboText)
        // Combo line gets its own delayed mini-punch (staggered energy).
        comboText.setScale(0.4)
        comboText.setAlpha(0)
        this.scene.tweens.add({
          targets: comboText,
          scale: 1,
          alpha: 1,
          delay: style.punchMs * 0.5,
          duration: style.punchMs,
          ease: 'Back.easeOut',
        })
      }
    }

    // Star sparkles (depth ≥ 3): tiny stars popping around the text.
    for (let i = 0; i < style.sparkles; i++) {
      const ang = (i / style.sparkles) * Math.PI * 2 + (depth % 3)
      const dist = scoreSize * (0.75 + (i % 3) * 0.28)
      const sx = Math.cos(ang) * dist
      const sy = Math.sin(ang) * dist * 0.72 + scoreSize * 0.2
      const star = this.scene.add.graphics()
      star.fillStyle(0xfff3b0, 1)
      star.fillCircle(0, 0, 2.4 + (i % 3))
      star.fillStyle(0xffffff, 1)
      star.fillCircle(0, 0, 1.2)
      star.setPosition(px + sx, py + sy)
      star.setDepth(POPUP_DEPTH - 1)
      star.setAlpha(0)
      star.setScale(0.4)
      this.burstObjs.push(star)
      this.scene.tweens.add({
        targets: star,
        alpha: { from: 0, to: 1 },
        scale: { from: 0.4, to: 1.15 },
        delay: style.punchMs * 0.4 + i * 36,
        duration: 170,
        yoyo: true,
        hold: 60,
        ease: 'Sine.easeOut',
        onComplete: () => {
          this.burstObjs = this.burstObjs.filter((o) => o !== star)
          star.destroy()
        },
      })
    }

    // Punchy entrance → settle → optional bounce → float → fade.
    container.setScale(0.7)
    container.setAlpha(0)
    this.scene.tweens.add({
      targets: container,
      scale: style.punchScale,
      alpha: 1,
      angle: { from: -style.wiggleDeg, to: style.wiggleDeg },
      duration: style.punchMs,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: container,
          scale: 1,
          angle: 0,
          duration: style.settleMs,
          ease: 'Sine.easeOut',
          onComplete: () => {
            if (style.bounceScale > 0) {
              this.scene.tweens.add({
                targets: container,
                scale: style.bounceScale,
                duration: style.bounceMs / 2,
                yoyo: true,
                ease: 'Sine.easeInOut',
              })
            }
          },
        })
      },
    })
    this.scene.tweens.add({
      targets: container,
      y: py - style.risePx,
      duration: duration * 0.7,
      ease: 'Sine.easeOut',
    })
    this.scene.tweens.add({
      targets: container,
      alpha: 0,
      delay: duration * 0.58,
      duration: duration * 0.42,
      ease: 'Sine.easeIn',
      onComplete: () => {
        container.destroy()
        this.popups = this.popups.filter((p) => p.container !== container)
      },
    })

    this.popups.push({ container, created: this.scene.time.now, duration })
  }

  /**
   * Restrained burst at the ACTUAL merge location — a brief impact ring
   * plus tier-colored confetti/sparkles. Pure visual objects (no physics
   * bodies), bounded count, everything self-destroys.
   */
  showMergeBurst(x: number, y: number, tier: number): void {
    const tierColor = getTier(tier)?.color ?? 0xffeb3b
    const depth = this.scene.add.graphics().setDepth(999)

    // Impact ring: quick expand + fade (~300ms) — a plain tween on a proxy
    // (frame-rate independent, no 16ms polling timer).
    const ringStart = 18
    const ringEnd = 52
    depth.lineStyle(3, tierColor, 0.9)
    depth.strokeCircle(x, y, ringStart)
    this.burstObjs.push(depth)
    const ringProxy = { r: ringStart }
    this.scene.tweens.add({
      targets: ringProxy,
      r: ringEnd,
      duration: 300,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        depth.clear()
        const fade = 1 - (ringProxy.r - ringStart) / (ringEnd - ringStart)
        depth.lineStyle(3, tierColor, 0.9 * fade)
        depth.strokeCircle(x, y, ringProxy.r)
      },
      onComplete: () => {
        this.burstObjs = this.burstObjs.filter((o) => o !== depth)
        depth.destroy()
      },
    })

    // Confetti sparks: bounded (≤ 10), tier-colored, gravity-free drift.
    const sparks = Math.min(10, 5 + tier)
    for (let i = 0; i < sparks; i++) {
      const ang = (i / sparks) * Math.PI * 2 + tier
      const dist = 26 + (i % 4) * 9
      const dot = this.scene.add.circle(x, y, 2.4 + (i % 3), tierColor).setDepth(999)
      this.burstObjs.push(dot)
      this.scene.tweens.add({
        targets: dot,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist - 6,
        alpha: { from: 1, to: 0 },
        scale: { from: 1, to: 0.4 },
        duration: 380 + (i % 4) * 60,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.burstObjs = this.burstObjs.filter((o) => o !== dot)
          dot.destroy()
        },
      })
    }
  }

  /** Reset combo state (e.g., on game restart). */
  resetCombo(): void {
    this.lane = 0
  }

  /** Clear all active popups (e.g., on restart). */
  clearAll(): void {
    for (const p of this.popups) p.container?.destroy()
    this.popups = []
    for (const o of this.burstObjs) o.destroy()
    this.burstObjs = []
  }

  destroy(): void {
    this.clearAll()
  }
}
