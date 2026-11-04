import Phaser from 'phaser'

/**
 * Floating text notification system for in-game messages.
 * Shows text that floats upward and fades out over 4 seconds.
 * Multiple notifications stack vertically.
 */
export class FloatingTextNotification {
  private scene: Phaser.Scene
  private notifications: Array<{
    text: Phaser.GameObjects.Text
    tween: Phaser.Tweens.Tween
  }> = []
  private baseY: number

  constructor(scene: Phaser.Scene, baseY: number) {
    this.scene = scene
    this.baseY = baseY
  }

  /**
   * Show a notification message. Stacks on top of existing notifications.
   * Text floats upward and fades out over 4 seconds.
   */
  show(message: string, x: number): void {
    // Calculate stack position (each notification is 40px above the previous)
    const stackOffset = this.notifications.length * 40
    const y = this.baseY - stackOffset

    const text = this.scene.add.text(x, y, message, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    })
    text.setOrigin(0.5, 0.5)
    text.setDepth(1000) // Above everything

    // Float upward and fade out over 4 seconds
    const tween = this.scene.tweens.add({
      targets: text,
      y: y - 60,
      alpha: 0,
      duration: 4000,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        text.destroy()
        const index = this.notifications.findIndex((n) => n.text === text)
        if (index >= 0) this.notifications.splice(index, 1)
      },
    })

    this.notifications.push({ text, tween })
  }

  /**
   * Clear all active notifications.
   */
  clear(): void {
    for (const n of this.notifications) {
      n.tween.stop()
      n.text.destroy()
    }
    this.notifications = []
  }

  /**
   * Update the base Y position (e.g., when layout changes).
   */
  setBaseY(y: number): void {
    this.baseY = y
  }
}
