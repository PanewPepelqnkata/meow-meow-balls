import Phaser from 'phaser'
import { GAME_OVER_SEQUENCE as CFG } from '../../config/gameOverSequence'

/** Brief end-of-run reaction before the overlay appears over the intact pile. */

export class GameOverSequence {
  private readonly scene: Phaser.Scene
  private readonly reducedMotion: boolean
  /** Forces panic faces during the reaction without changing any live ball. */
  panicOverride = 0
  private running = false
  private timer: Phaser.Time.TimerEvent | null = null

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** React once, then show the overlay without removing or rescaling balls. */
  start(onDone: () => void): void {
    if (this.running) return
    this.running = true
    this.panicOverride = 1
    if (!this.reducedMotion) {
      this.scene.cameras.main.shake(CFG.shakeDurationMs, CFG.shakeStrength)
    }
    this.timer = this.scene.time.delayedCall(CFG.panicMs, () => {
      this.timer = null
      this.running = false
      this.panicOverride = 0
      onDone()
    })
  }

  /** Cancel a pending completion when the run or scene is torn down. */
  destroy(): void {
    if (this.timer != null) this.scene.time.removeEvent(this.timer)
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this)
    this.timer = null
    this.running = false
    this.panicOverride = 0
  }
}
