import Phaser from 'phaser'

export interface ChampionEntranceParts {
  ball: Phaser.GameObjects.Container
  medal: Phaser.GameObjects.Container
  name: Phaser.GameObjects.Container
  score: Phaser.GameObjects.Container
  scoreText: Phaser.GameObjects.Text
  value: number
}

/** Transform-only, cancel-safe reveal. Scores always settle to real values. */
export function playLeaderboardEntrance(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  background: Phaser.GameObjects.Image,
  base: Phaser.GameObjects.Image,
  champions: readonly ChampionEntranceParts[],
  panel: Phaser.GameObjects.Container | null,
  w: number,
  h: number,
  reducedMotion: boolean,
): () => void {
  if (reducedMotion) return () => undefined
  const tweens: Phaser.Tweens.Tween[] = []
  const effects = scene.add.container(0, 0)
  parent.add(effects)
  // Darken the temple, not the champion artwork being revealed over it.
  parent.moveTo(effects, 1)
  const dark = scene.add.rectangle(w / 2, h / 2, w, h, 0x050713, 1).setAlpha(0.9)
  const beam = scene.add.graphics()
  for (const [spread, alpha] of [[0.42, 0.035], [0.32, 0.055], [0.2, 0.08]] as const) {
    beam.fillStyle(0xffdc8b, alpha)
    beam.beginPath()
    beam.moveTo(w * 0.43, -12)
    beam.lineTo(w * 0.57, -12)
    beam.lineTo(w * (0.5 + spread), h)
    beam.lineTo(w * (0.5 - spread), h)
    beam.closePath()
    beam.fillPath()
  }
  beam.setAlpha(0)
  effects.add([dark, beam])
  const add = (config: Phaser.Types.Tweens.TweenBuilderConfig) => {
    const tween = scene.tweens.add(config)
    tweens.push(tween)
    return tween
  }
  const settles: Array<() => void> = []
  let released = false
  const cleanup = () => {
    if (released) return
    released = true
    for (const tween of tweens) tween.stop()
    for (const settle of settles) settle()
    effects.destroy()
  }
  settles.push(() => background.setAlpha(1))
  background.setAlpha(0.25)
  add({ targets: beam, alpha: 1, duration: 340, ease: 'Sine.easeOut' })
  add({ targets: dark, alpha: 0, delay: 160, duration: 700, ease: 'Quad.easeOut' })
  add({ targets: background, alpha: 1, delay: 180, duration: 540, ease: 'Sine.easeOut' })
  const baseY = base.y
  settles.push(() => base.setY(baseY).setAlpha(1))
  base.setY(baseY + 20).setAlpha(0)
  add({ targets: base, y: baseY, alpha: 1, delay: 330, duration: 370, ease: 'Cubic.easeOut' })
  const reveal = (target: Phaser.GameObjects.Container, delay: number, move: number, scale: number) => {
    const y = target.y
    settles.push(() => target.setY(y).setScale(1).setAlpha(1))
    target.setY(y + move).setScale(scale).setAlpha(0)
    add({ targets: target, y, alpha: 1, scaleX: 1, scaleY: 1,
      delay, duration: 260, ease: 'Cubic.easeOut' })
  }
  for (const [index, champion] of champions.entries()) {
    const offset = index * 65
    const ballY = champion.ball.y
    settles.push(() => champion.ball.setY(ballY).setScale(1).setAlpha(1))
    champion.ball.setY(ballY - 44).setAlpha(0)
    add({ targets: champion.ball, y: ballY, alpha: 1, delay: 560 + offset,
      duration: 270, ease: 'Quad.easeIn', onComplete: () => {
        champion.ball.setScale(1.07, 0.92)
        add({ targets: champion.ball, scaleX: 1, scaleY: 1, duration: 160, ease: 'Sine.easeOut' })
      } })
    reveal(champion.medal, 850 + offset, 0, 0.75)
    reveal(champion.name, 1040 + offset, 8, 1)
    reveal(champion.score, 1130 + offset, 5, 1)
    champion.scoreText.setText('0')
    settles.push(() => champion.scoreText.setText(champion.value.toLocaleString('en-US')))
    const counter = { value: 0 }
    add({ targets: counter, value: champion.value, delay: 1180 + offset, duration: 480,
      ease: 'Cubic.easeOut', onUpdate: () => champion.scoreText.setText(Math.round(counter.value).toLocaleString('en-US')) })
  }
  if (panel) reveal(panel, 1430, 10, 1)
  add({ targets: beam, alpha: 0, delay: 1250, duration: 550, onComplete: cleanup })
  return cleanup
}
