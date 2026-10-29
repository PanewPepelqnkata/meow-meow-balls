import Phaser from 'phaser'
import { gameBus } from '../events/gameBus'
import { PauseMenuView } from '../rendering/PauseMenuView'
import type { UIScene } from './UIScene'

/** Active overlay while the world and HUD scenes are paused underneath it. */
export class PauseScene extends Phaser.Scene {
  private menu: PauseMenuView | null = null
  private leaving = false

  constructor() {
    super('PauseScene')
  }

  create(data: { score?: number } = {}): void {
    this.leaving = false
    this.input.enabled = true
    this.scene.bringToTop()
    this.applyDprCamera()
    this.menu = new PauseMenuView(this, data.score ?? 0, {
      onResume: () => this.resumeRun(),
      onRestart: () => this.restartRun(),
      onSettings: () => this.openSettings(),
      onMenu: () => this.returnToMenu(),
    })
    this.game.events.on('br:dpr', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('br:dpr', this.layout, this)
      this.menu?.destroy()
      this.menu = null
    })
  }

  private applyDprCamera(): void {
    const z = this.game.scale.displayScale.x || 1
    this.cameras.main.setZoom(z)
    this.cameras.main.centerOn(this.scale.width / z / 2, this.scale.height / z / 2)
  }

  private layout(): void {
    this.applyDprCamera()
    this.menu?.layout()
  }

  private resumeRun(): void {
    if (this.leaving) return
    this.leaving = true
    gameBus.emit('ui:resume', {})
    this.resumeScenes()
    this.scene.stop()
  }

  private restartRun(): void {
    if (this.leaving) return
    this.leaving = true
    gameBus.emit('ui:restart', {})
    this.resumeScenes()
    this.scene.stop()
  }

  private openSettings(): void {
    if (this.leaving || !this.sys.isVisible()) return
    this.input.enabled = false
    this.scene.setVisible(false)
    this.scene.launch('TitleScene', { returnToPause: true })
  }

  private returnToMenu(): void {
    if (this.leaving) return
    this.leaving = true
    const ui = this.scene.get('UIScene') as UIScene
    ui.returnToMenu()
    this.scene.stop()
  }

  private resumeScenes(): void {
    // Discard the wall-time tween delta accumulated while the scenes were stopped.
    // No tween is stepped here; its next normal update advances only a live-frame delta.
    for (const key of ['playground', 'UIScene']) {
      const scene = this.scene.get(key)
      scene.tweens.getDelta(true)
      this.scene.resume(key)
    }
  }
}
