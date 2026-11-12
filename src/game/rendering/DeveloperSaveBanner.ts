import Phaser from 'phaser'
import { hudText } from '../../ui/Typography'

/**
 * The "developer save" announcement: the first overflow of a blessed run
 * explodes the falling ball and this banner bounces in the middle of the
 * screen while the run keeps going.
 *
 * Screen-space UI art in the CSS-pixel space every HUD element uses. It
 * deliberately does NOT set `scrollFactor(0)`: the UI camera is zoomed by
 * the render DPR and scrolled to frame CSS pixels, and scroll factor 0
 * would pin this banner to the raw camera viewport (the top-left corner on
 * a phone) instead of the layout position.
 */
export class DeveloperSaveBanner {
  private root: Phaser.GameObjects.Container | null = null
  private readonly tweens: Phaser.Tweens.Tween[] = []
  private dismissTimer: Phaser.Time.TimerEvent | null = null
  private reducedMotion = false

  constructor(private readonly scene: Phaser.Scene) {}

  get visible(): boolean {
    return this.root !== null
  }

  show(): void {
    this.destroy()
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }
    const dpr = this.scene.game.scale.displayScale.x || 1
    const vw = this.scene.scale.width / dpr
    const vh = this.scene.scale.height / dpr
    const size = vw < 600
      ? Math.round(Math.min(38, Math.max(23, vw * 0.098)))
      : Math.round(Math.min(56, Math.max(34, vw * 0.045)))
    const wrapWidth = Math.max(180, Math.min(vw - 36, 620))

    const root = this.scene.add.container(vw / 2, vh * 0.42).setDepth(240)
      .setName('developer-save-banner')
    this.root = root

    // A soft ink plate keeps the big type readable over any pile/theme.
    const plate = this.scene.add.graphics()
    plate.fillStyle(0x000000, 0.28)
    plate.fillRoundedRect(-wrapWidth / 2 - 14, -size * 2.1, wrapWidth + 28, size * 4.2, 22)
    root.add(plate)

    const text = hudText(this.scene, 0, 0, 'YOU WERE SAVED BY\nthe developer <3', 1, {
      color: '#ffe27a',
      size,
      stroke: Math.max(4, Math.round(size * 0.16)),
      origin: [0.5, 0.5],
      shadow: true,
    })
    text.setAlign('center').setWordWrapWidth(wrapWidth, true).setName('developer-save-text')
    root.add(text)

    if (this.reducedMotion) {
      root.setAlpha(1).setScale(1)
      this.dismissTimer = this.scene.time.delayedCall(2600, () => this.exit())
      return
    }

    // Punch in, overshoot, settle — then keep bouncing in place.
    root.setScale(0.45).setAlpha(0).setRotation(-0.04)
    this.addTween({
      targets: root,
      scale: 1,
      alpha: 1,
      rotation: 0,
      duration: 430,
      ease: 'Back.easeOut',
    })
    this.addTween({
      targets: root,
      y: vh * 0.42 - 14,
      duration: 620,
      delay: 200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.addTween({
      targets: root,
      rotation: 0.018,
      duration: 340,
      delay: 200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.addTween({
      targets: text,
      scale: 1.045,
      duration: 520,
      delay: 430,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.dismissTimer = this.scene.time.delayedCall(3000, () => this.exit())
  }

  destroy(): void {
    this.dismissTimer?.remove(false)
    this.dismissTimer = null
    for (const tween of this.tweens) tween.remove()
    this.tweens.length = 0
    const root = this.root
    this.root = null
    root?.destroy()
  }

  private exit(): void {
    const root = this.root
    if (!root) return
    if (this.reducedMotion) {
      this.destroy()
      return
    }
    for (const tween of this.tweens) tween.remove()
    this.tweens.length = 0
    this.addTween({
      targets: root,
      alpha: 0,
      scale: 0.88,
      duration: 260,
      ease: 'Cubic.easeIn',
      onComplete: () => this.destroy(),
    })
  }

  private addTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    const tween = this.scene.tweens.add(config)
    this.tweens.push(tween)
  }
}
