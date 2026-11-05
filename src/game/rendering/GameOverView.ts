import Phaser from 'phaser'
import { drawLucide } from '../../ui/LucideIcon'
import { FONT_FAMILY } from '../../ui/Typography'
import { doodleSilhouette, darkenFill } from '../../ui/CartoonButton'
import { getTier } from '../../config/ballTiers'
import { GAME_OVER_SEQUENCE as SEQ } from '../../config/gameOverSequence'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, type BallExpression } from './BallAppearance'

const CREAM = 0xfff8ec
const BLUE = 0x2d74c9
const RED = 0xf44336
const INK_COLOR = '#1a1a1a'

interface RunPresentation {
  score: number
  best: number
  isNewBest: boolean
  saveScore?: { onSave: () => void }
  saved: boolean
}

/** A small rematch invitation, with the same ball art as the finished run. */
export class GameOverView {
  private objs: Phaser.GameObjects.GameObject[] = []
  private tweens: Phaser.Tweens.Tween[] = []
  private run: RunPresentation | null = null
  private reducedMotion = false
  private lastButtonCenter = { x: 0, y: 0 }
  private saveRow: {
    icon: Phaser.GameObjects.Graphics
    label: Phaser.GameObjects.Text
    subtitle: Phaser.GameObjects.Text
    hit: Phaser.GameObjects.Rectangle
  } | null = null

  private readonly scene: Phaser.Scene
  private readonly onRestart: () => void
  private readonly onMenu: () => void

  constructor(scene: Phaser.Scene, onRestart: () => void, onMenu: () => void) {
    this.scene = scene
    this.onRestart = onRestart
    this.onMenu = onMenu
  }

  get visible(): boolean {
    return this.objs.length > 0
  }

  /** Viewport-space center of Play Again (QA/automation hook). */
  get buttonCenter(): { x: number; y: number } {
    return this.lastButtonCenter
  }

  show(score: number, best: number, isNewBest: boolean, saveScore?: { onSave: () => void }): void {
    this.hide()
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }
    this.run = { score, best, isNewBest, saveScore, saved: false }
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.scene.game.events.on('br:dpr', this.onResize, this)
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.hide, this)
    this.draw(this.run, true)
  }

  private onResize(): void {
    if (!this.run) return
    this.clearObjects()
    this.draw(this.run, false)
  }

  private draw(run: RunPresentation, entering: boolean): void {
    const scene = this.scene
    const z = scene.game.scale.displayScale.x || 1
    const vw = scene.scale.width / z
    const vh = scene.scale.height / z
    const wide = vw >= 520 && vw > vh && vh < 520
    const pw = wide ? 600 : 380
    const columnX = wide ? 134 : 0
    const columnW = wide ? 260 : 312
    const motion = entering && !this.reducedMotion
    const newBest = run.isNewBest && run.score > 0
    const strongRun = run.score > 0 && run.best > 0 && run.score >= run.best * 0.75

    const dim = scene.add.rectangle(vw / 2, vh / 2, vw, vh, INK, 0.46).setDepth(60)
    // The scrim owns pointer input; the completed pile remains visible behind it.
    dim.setInteractive()
    const panel = scene.add.container(vw / 2, vh / 2).setDepth(61)
    const content = scene.add.container(0, 0)
    panel.add(content)
    this.objs.push(dim, panel)

    const text = (x: number, y: number, value: string, size: number, color: string, stroke = 0): Phaser.GameObjects.Text => {
      const t = scene.add.text(x, y, value, {
        fontFamily: FONT_FAMILY,
        fontSize: `${size}px`,
        color,
        stroke: INK_COLOR,
        strokeThickness: stroke,
        resolution: Math.max(2, Math.min(window.devicePixelRatio || 1, 3)),
        padding: { left: 3, right: 3, top: 2, bottom: 2 },
      }).setOrigin(0.5, 0)
      content.add(t)
      return t
    }

    // Familiar blue, red and white core balls, not a separate mascot. Their
    // expressions answer the run; even an empty score gets an encouraging wink.
    const crewX = wide ? -150 : 0
    const crewY = wide ? 105 : 62
    const crew = scene.add.container(crewX, crewY)
    content.add(crew)
    const ball = (tier: number, seed: number, x: number, y: number, radius: number, angle: number, expr: BallExpression): void => {
      const look = ballLookFor(tier, seed)
      const points = restContour(look, radius, 0, 0, 40).map((p) => new Phaser.Math.Vector2(p.x, p.y))
      const g = scene.add.graphics()
      g.fillStyle(getTier(tier)!.color, 1)
      g.fillPoints(points, true)
      g.lineStyle(ballOutlineWidth(radius), INK, 1)
      g.strokePoints(points, true, true)
      drawBallFace(g, look, { x: 0, y: 0 }, radius, 1, {
        expr,
        gaze: { x: x < 0 ? 0.55 : -0.5, y: newBest ? -0.2 : 0.12 },
      })
      const c = scene.add.container(x, y, [g]).setAngle(angle)
      crew.add(c)
      if (motion) {
        this.tweens.push(scene.tweens.add({
          targets: c,
          y: y - (newBest ? 10 : 5),
          angle: angle + (x < 0 ? -5 : 5),
          duration: newBest ? 230 : 300,
          delay: 100 + (x === 0 ? 60 : 0),
          yoyo: true,
          repeat: newBest ? 1 : 0,
          ease: 'Sine.easeInOut',
        }))
      }
    }
    ball(1, 20260213, -65, 12, 32, -12, newBest || strongRun ? 'grin' : 'normal')
    ball(4, 20260218, 65, 13, 34, 12, newBest ? 'wink' : 'tongue')
    ball(7, 20260221, 0, 0, 41, -4, newBest || strongRun ? 'grin' : 'wink')

    const title = text(crewX, wide ? 167 : 111, run.score > 0 ? 'NICE RUN!' : 'ONE MORE?', 29, '#f44336', 2)
    if (wide) text(crewX, title.y + title.height + 5, 'The crew is on your side.', 13, INK_COLOR)

    const labelY = wide ? 20 : title.y + title.height + 5
    const scoreLabel = text(columnX, labelY, 'YOUR SCORE', 12, INK_COLOR)
    const scoreText = text(columnX, scoreLabel.y + scoreLabel.height - 1, run.score.toLocaleString(), 72, '#2d74c9', 3)
    scoreText.setScale(Math.min(1, (columnW - 12) / scoreText.width))
    const reactionY = scoreText.y + scoreText.displayHeight + 1
    const reaction = text(
      columnX,
      reactionY,
      newBest ? 'NEW BEST!  Look at you go.' : run.score === 0 ? 'A fresh start? You\'ve got this.' : 'The crew is ready for a rematch.',
      13,
      newBest ? '#f44336' : INK_COLOR,
    )

    const primaryY = reaction.y + reaction.height + 12 + 32
    const primary = scene.add.container(columnX, primaryY)
    content.add(primary)
    this.drawPlate(primary, columnW, 64, BLUE, 16, 17, 5)
    const replayIcon = scene.add.graphics()
    drawLucide(replayIcon, 'rotate-ccw', 0, 0, 23, CREAM, 2.6)
    const replayLabel = text(0, 0, 'PLAY AGAIN', 26, '#fff8ec', 2)
    primary.add([replayIcon, replayLabel])
    const replayUnitW = 23 + 10 + replayLabel.width
    replayIcon.setPosition(-replayUnitW / 2 + 23 / 2, 0)
    replayLabel.setPosition(-replayUnitW / 2 + 23 + 10, -replayLabel.height / 2)
    replayLabel.setOrigin(0, 0)
    const replayHit = scene.add.rectangle(0, 0, columnW, 64, CREAM, 0.001).setInteractive({ useHandCursor: true })
    primary.add(replayHit)
    this.bindAction(primary, replayHit, this.onRestart)

    // Home has a quieter cream plate. Guest saving remains a tertiary action,
    // never a second primary button or a requirement for another run.
    const footerY = primaryY + 32 + 6 + 29
    const homeX = wide && run.saveScore ? columnX - 78 : columnX
    const home = scene.add.container(homeX, footerY)
    content.add(home)
    const homeW = wide && run.saveScore ? 100 : 144
    const homeBody = scene.add.graphics()
    homeBody.fillStyle(CREAM, 1)
    homeBody.lineStyle(2, RED, 1)
    homeBody.fillRoundedRect(-homeW / 2, -20, homeW, 40, 13)
    homeBody.strokeRoundedRect(-homeW / 2, -20, homeW, 40, 13)
    const homeIcon = scene.add.graphics()
    drawLucide(homeIcon, 'house', 0, 0, 17, RED, 2.2)
    const homeLabel = text(0, 0, 'HOME', 18, '#f44336')
    home.add([homeBody, homeIcon, homeLabel])
    const homeUnitW = 17 + 7 + homeLabel.width
    homeIcon.setPosition(-homeUnitW / 2 + 17 / 2, 0)
    homeLabel.setOrigin(0, 0.5).setPosition(-homeUnitW / 2 + 24, 0)
    const homeHit = scene.add.rectangle(0, 0, homeW, 58, CREAM, 0.001).setInteractive({ useHandCursor: true })
    home.add(homeHit)
    this.bindAction(home, homeHit, this.onMenu)

    let bottom = footerY + 29
    if (run.saveScore) {
      const saveX = wide ? columnX + 53 : columnX
      const saveY = wide ? footerY : footerY + 58
      const save = scene.add.container(saveX, saveY)
      content.add(save)
      const icon = scene.add.graphics()
      const label = text(0, 0, 'SAVE SCORE', 13, '#2d74c9')
      const subtitle = text(0, 0, 'Log in / sign up', 10, INK_COLOR)
      save.add([icon, label, subtitle])
      const hit = scene.add.rectangle(0, 0, wide ? 150 : 240, 58, CREAM, 0.001).setInteractive({ useHandCursor: true })
      save.add(hit)
      this.bindAction(save, hit, run.saveScore.onSave)
      this.saveRow = { icon, label, subtitle, hit }
      this.layoutSaveRow(run.saved)
      bottom = saveY + 29
    }

    const ph = Math.max(bottom + 16, wide ? title.y + title.height + 42 : 0)
    content.setY(-ph / 2)
    const plate = scene.add.container(0, 0)
    panel.addAt(plate, 0)
    this.drawPlate(plate, pw, ph, CREAM, 27, 20260213, 7)
    // No minimum clamp: short viewports must fit vertically as well as horizontally.
    const fit = Math.min(1.05, (vw - 28) / (pw + 8), (vh - 32) / (ph + 14))
    panel.setScale(fit)
    this.lastButtonCenter = {
      x: vw / 2 + columnX * fit,
      y: vh / 2 + (primaryY - ph / 2) * fit,
    }

    if (motion) {
      dim.setAlpha(0)
      panel.setAlpha(0).setScale(fit * 0.96)
      this.tweens.push(
        scene.tweens.add({ targets: dim, alpha: 1, duration: 160, ease: 'Quad.easeOut' }),
        scene.tweens.add({ targets: panel, alpha: 1, scale: fit, duration: 220, ease: 'Cubic.easeOut' }),
      )
      const counter = { value: 0 }
      scoreText.setText('0')
      this.tweens.push(scene.tweens.add({
        targets: counter,
        value: run.score,
        duration: SEQ.scoreCountMs,
        ease: 'Cubic.easeOut',
        onUpdate: () => scoreText.setText(Math.round(counter.value).toLocaleString()),
      }))
    }
  }

  /** The existing doodle-button recipe, shared by the card and retry action. */
  private drawPlate(parent: Phaser.GameObjects.Container, width: number, height: number, fill: number, radius: number, seed: number, extrusion: number): void {
    const points = doodleSilhouette(width, height, radius, seed, 2.5).map((p) => new Phaser.Math.Vector2(p.x, p.y))
    const sidePoints = points.map((p) => new Phaser.Math.Vector2(p.x, p.y + extrusion))
    const shadowPoints = points.map((p) => new Phaser.Math.Vector2(p.x, p.y + extrusion + 5))
    const g = this.scene.add.graphics()
    g.fillStyle(INK, 0.16)
    g.fillPoints(shadowPoints, true)
    g.fillStyle(darkenFill(fill, 0.72), 1)
    g.fillPoints(sidePoints, true)
    g.lineStyle(4, INK, 1)
    g.strokePoints(sidePoints, true, true)
    g.fillStyle(fill, 1)
    g.fillPoints(points, true)
    g.strokePoints(points, true, true)
    g.fillStyle(0xffffff, 0.22)
    g.fillEllipse(-width * 0.25, -height * 0.31, width * 0.25, Math.min(16, height * 0.16))
    parent.add(g)
  }

  private bindAction(container: Phaser.GameObjects.Container, hit: Phaser.GameObjects.Rectangle, onPress: () => void): void {
    const feedback = (scale: number, alpha = 1): void => {
      this.scene.tweens.killTweensOf(container)
      container.setAlpha(alpha)
      if (this.reducedMotion) return
      this.tweens.push(this.scene.tweens.add({ targets: container, scale, duration: 90, ease: 'Quad.easeOut' }))
    }
    hit.on('pointerover', () => feedback(1.025))
    hit.on('pointerout', () => feedback(1))
    hit.on('pointerdown', () => feedback(0.97, 0.88))
    hit.on('pointerup', () => {
      feedback(1)
      onPress()
    })
  }

  private layoutSaveRow(saved: boolean): void {
    const row = this.saveRow
    if (!row) return
    const { icon, label, subtitle, hit } = row
    icon.clear()
    drawLucide(icon, saved ? 'check' : 'cloud-upload', 0, 0, 16, BLUE, 2.2)
    label.setText(saved ? 'SCORE SAVED!' : 'SAVE SCORE')
    subtitle.setText(saved ? 'Leaderboard updated' : 'Log in / sign up')
    const unitW = 16 + 6 + Math.max(label.width, subtitle.width)
    icon.setPosition(-unitW / 2 + 8, 0)
    label.setOrigin(0, 0.5).setPosition(-unitW / 2 + 22, -8)
    subtitle.setOrigin(0, 0.5).setPosition(-unitW / 2 + 22, 9)
    if (saved) hit.disableInteractive()
  }

  /** Post-auth confirmation; kept across viewport changes until the next run. */
  markScoreSaved(): void {
    if (!this.run || !this.saveRow) return
    this.run.saved = true
    this.layoutSaveRow(true)
  }

  private clearObjects(): void {
    for (const tween of this.tweens) tween.stop()
    this.tweens = []
    for (const object of this.objs) object.destroy()
    this.objs = []
    this.saveRow = null
  }

  /** Stop every owned animation and detach resize/shutdown hooks on dismissal. */
  hide(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.scene.game.events.off('br:dpr', this.onResize, this)
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.hide, this)
    this.clearObjects()
    this.run = null
  }
}
