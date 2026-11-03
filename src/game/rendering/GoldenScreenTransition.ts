import Phaser from 'phaser'

const DURATION_MS = 500

/** A non-blocking, single-pass light sweep; navigation can happen immediately. */
export function playGoldenScreenTransition(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  w: number,
  h: number,
  reducedMotion: boolean,
): () => void {
  if (reducedMotion) return () => undefined

  const overlay = scene.add.container(0, 0)
  parent.add(overlay)
  parent.bringToTop(overlay)

  const sweep = scene.add.graphics()
  overlay.add(sweep)

  const halfWidth = w * 0.2
  const lean = h * 0.16
  const extent = halfWidth + lean

  // Draw once: overlapping translucent bands soften the light without a
  // viewport texture, blend-mode flash, or any per-frame Graphics redraw.
  const band = (width: number, color: number, alpha: number): void => {
    sweep.fillStyle(color, alpha)
    sweep.beginPath()
    sweep.moveTo(lean - width, 0)
    sweep.lineTo(lean + width, 0)
    sweep.lineTo(-lean + width, h)
    sweep.lineTo(-lean - width, h)
    sweep.closePath()
    sweep.fillPath()
  }
  band(halfWidth, 0xffcf70, 0.025)
  band(halfWidth * 0.78, 0xffde91, 0.035)
  band(halfWidth * 0.56, 0xffe7ae, 0.045)
  band(halfWidth * 0.34, 0xffefd0, 0.06)
  band(halfWidth * 0.12, 0xfff7e4, 0.09)
  sweep.setPosition(-extent, 0).setAlpha(0)

  let released = false
  const tweens: Phaser.Tweens.Tween[] = []
  const release = (): void => {
    if (released) return
    released = true
    for (const tween of tweens) tween.remove()
    tweens.length = 0
  }
  const cleanup = (): void => {
    if (released) return
    release()
    overlay.destroy()
  }

  // Also stop the animation if its parent destroys the overlay first.
  overlay.once(Phaser.GameObjects.Events.DESTROY, release)

  tweens.push(scene.tweens.add({
    targets: sweep,
    alpha: 1,
    duration: 90,
    hold: DURATION_MS - 180,
    yoyo: true,
    ease: 'Sine.easeInOut',
  }))
  tweens.push(scene.tweens.add({
    targets: sweep,
    x: w + extent,
    duration: DURATION_MS,
    ease: 'Sine.easeInOut',
    onComplete: cleanup,
  }))

  return cleanup
}
