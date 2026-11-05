import Phaser from 'phaser'
import { drawLucide } from '../../ui/LucideIcon'
import { FONT_FAMILY } from '../../ui/Typography'
import { doodleSilhouette, darkenFill } from '../../ui/CartoonButton'
import { getTier } from '../../config/ballTiers'
import { GAME_OVER_SEQUENCE as SEQ } from '../../config/gameOverSequence'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, type BallExpression } from './BallAppearance'
import { drawCoin, formatCoins } from './Coin'
import { loadSave } from '../state/save'

const CREAM = 0xfff8ec
const BLUE = 0x2d74c9
const RED = 0xf44336
const INK_COLOR = '#1a1a1a'


interface RunStats {
  tierReached: number
  ballsMerged: number
  durationMs: number
}

interface RunPresentation {
  score: number
  best: number
  isNewBest: boolean
  saveScore?: { onSave: () => void }
  stats?: RunStats
  saved: boolean
}

/** A small rematch invitation, with the same ball art as the finished run. */
export class GameOverView {
  private objs: Phaser.GameObjects.GameObject[] = []
  private tweens: Phaser.Tweens.Tween[] = []
  private run: RunPresentation | null = null
  private reducedMotion = false
  private restarting = false
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

  show(score: number, best: number, isNewBest: boolean, saveScore?: { onSave: () => void }, stats?: RunStats): void {
    this.hide()
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }
    this.run = { score, best, isNewBest, saveScore, stats, saved: false }
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.scene.game.events.on('br:dpr', this.onResize, this)
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.hide, this)
    this.draw(this.run, true)
  }

  private onResize(): void {
    if (!this.run || this.restarting) return
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

    const dim = scene.add.rectangle(vw / 2, vh / 2, vw, vh, INK, 0.32).setDepth(60)
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

    const labelY = wide ? 20 : title.y + title.height + 12
    const scoreLabel = text(columnX, labelY, 'YOUR SCORE', 12, INK_COLOR)
    const scoreText = text(columnX, scoreLabel.y + scoreLabel.height + 3, run.score.toLocaleString(), 84, '#2d74c9', 3)
      .setShadow(0, 3, '#1a1a1a26', 2, true, true)
    scoreText.setScale(Math.min(1, (columnW - 12) / scoreText.width))
    const reactionY = scoreText.y + scoreText.displayHeight + 5
    const reaction = text(
      columnX,
      reactionY,
      newBest ? 'NEW BEST!  Look at you go.' : run.score === 0 ? 'A fresh start? You\'ve got this.' : 'The crew is ready for a rematch.',
      13,
      newBest ? '#f44336' : INK_COLOR,
    )

    // Coins earned this run (score / 1000)
    const coinsEarned = Math.round((run.score / 1000) * 10) / 10
    const totalCoins = loadSave().coins
    const coinY = reaction.y + reaction.height + 14
    const coinG = scene.add.graphics()
    drawCoin(coinG, columnX - 52, coinY + 11, 14)
    const coinText = text(columnX - 30, coinY, `+${formatCoins(coinsEarned)}`, 22, '#b8860b', 2)
    const coinTotal = text(columnX + 30, coinY + 4, `(${formatCoins(totalCoins)} total)`, 12, INK_COLOR)
    content.add([coinG, coinText, coinTotal])

    const statsY = coinY + 22
    const statsH = 84
    const cellW = columnW / 4
    const statsLeft = columnX - columnW / 2
    const formatDuration = (totalSeconds: number): string => {
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor(totalSeconds / 60) % 60
      const seconds = String(totalSeconds % 60).padStart(2, '0')
      return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
    }
    const metrics = [
      { label: 'BEST', icon: 'trophy', value: run.best, accent: 0xe5ad32, color: '#976208' },
      { label: 'TIER', icon: 'layers', value: run.stats?.tierReached ?? null, accent: 0x9662d2, color: '#7945b3' },
      { label: 'MERGES', icon: 'git-merge', value: run.stats?.ballsMerged ?? null, accent: 0x36a66c, color: '#257c4c' },
      { label: 'TIME', icon: 'clock', value: run.stats ? Math.floor(run.stats.durationMs / 1000) : null, accent: 0xef913b, color: '#b65b16' },
    ]
    metrics.forEach((metric, i) => {
      const x = statsLeft + cellW * (i + 0.5)
      const cell = scene.add.container(x, statsY)
      const tile = scene.add.graphics()
      tile.fillStyle(metric.accent, 0.08)
      tile.fillRoundedRect(-cellW / 2 + 3, 0, cellW - 6, statsH, 12)
      tile.lineStyle(1, metric.accent, 0.24)
      tile.strokeRoundedRect(-cellW / 2 + 3, 0, cellW - 6, statsH, 12)
      tile.fillStyle(metric.accent, 0.22)
      tile.fillCircle(0, 18, 12)
      tile.lineStyle(1, metric.accent, 0.4)
      tile.strokeCircle(0, 18, 12)
      const icon = scene.add.graphics()
      drawLucide(icon, metric.icon, 0, 18, 13, darkenFill(metric.accent, 0.72), 2.2)
      const formatValue = (value: number): string => metric.label === 'TIME' ? formatDuration(value) : value.toLocaleString()
      const value = text(0, 47, metric.value === null ? '—' : formatValue(metric.value), 26, metric.color).setOrigin(0.5)
      value.setScale(Math.min(1, (cellW - 12) / value.width))
      const label = text(0, 71, metric.label, 10, INK_COLOR).setOrigin(0.5)
      cell.add([tile, icon, value, label])
      content.add(cell)
      if (newBest && i === 0) {
        tile.fillStyle(metric.accent, 1)
        tile.fillRoundedRect(-26, -10, 52, 14, 5)
        const badge = text(0, -3, 'NEW BEST', 8, INK_COLOR).setOrigin(0.5)
        cell.add(badge)
      }
      if (motion) {
        const delay = 160 + i * 65
        cell.setY(statsY + 6).setAlpha(0)
        this.tweens.push(scene.tweens.add({
          targets: cell,
          y: statsY,
          alpha: 1,
          duration: 280,
          delay,
          ease: 'Cubic.easeOut',
        }))
        if (metric.value !== null && metric.value > 0) {
          const counter = { value: 0 }
          value.setText(formatValue(0))
          this.tweens.push(scene.tweens.add({
            targets: counter,
            value: metric.value,
            duration: SEQ.scoreCountMs,
            delay,
            ease: 'Cubic.easeOut',
            onUpdate: () => value.setText(formatValue(Math.round(counter.value))),
          }))
        }
      }
    })

    const primaryY = statsY + statsH + 12 + 32
    const primary = scene.add.container(columnX, primaryY)
    const replayGlow = scene.add.graphics().setPosition(columnX, primaryY).setAlpha(0.15)
    for (let spread = 14; spread >= 2; spread -= 4) {
      replayGlow.fillStyle(0x1689e8, 0.2)
      replayGlow.fillEllipse(0, 0, columnW + spread * 2, 64 + spread * 1.5)
    }
    const replayShadow = scene.add.graphics().setPosition(columnX, primaryY).setAlpha(0)
    replayShadow.fillStyle(INK, 0.14)
    replayShadow.fillPoints(doodleSilhouette(columnW, 64, 16, 17, 2.5).map((p) => new Phaser.Math.Vector2(p.x, p.y + 12)), true)
    const replayContour = doodleSilhouette(columnW, 64, 16, 17, 2.5).map((p) => new Phaser.Math.Vector2(p.x, p.y))
    const addReplayLayer = (offsetY: number, fill: number): void => {
      const points = replayContour.map((p) => new Phaser.Math.Vector2(p.x, p.y + offsetY))
      const layer = scene.add.graphics()
      layer.fillStyle(INK, 0.3)
      layer.fillPoints(points.map((p) => new Phaser.Math.Vector2(p.x, p.y + 3)), true)
      layer.fillStyle(fill, 1)
      layer.fillPoints(points, true)
      layer.lineStyle(3, INK, 1)
      layer.strokePoints(points, true, true)
      primary.add(layer)
    }
    addReplayLayer(8, 0x0b3974)
    addReplayLayer(4, 0x145eaa)
    const replayFace = scene.add.container(0, 0)
    primary.add(replayFace)
    this.drawPlate(replayFace, columnW, 64, 0x1689e8, 16, 17, 5)
    const replayBorder = scene.add.graphics()
    replayFace.add(replayBorder)
    const borderCycle = { phase: 0 }
    const blendColor = (from: number, to: number, amount: number): number => {
      const r = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * amount)
      const g = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * amount)
      const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * amount)
      return (r << 16) | (g << 8) | b
    }
    const paintReplayBorder = (): void => {
      replayBorder.clear()
      for (let i = 0; i < replayContour.length; i++) {
        const a = replayContour[i]!
        const b = replayContour[(i + 1) % replayContour.length]!
        const mix = 0.5 + 0.5 * Math.sin((i / replayContour.length) * Math.PI * 2 + borderCycle.phase)
        replayBorder.lineStyle(2.8, blendColor(BLUE, 0x45d8ff, mix), 1)
        replayBorder.lineBetween(a.x, a.y, b.x, b.y)
      }
    }
    paintReplayBorder()
    if (!this.reducedMotion) {
      this.tweens.push(scene.tweens.add({
        targets: borderCycle,
        phase: Math.PI * 2,
        duration: 2400,
        repeat: -1,
        ease: 'Linear',
        onUpdate: paintReplayBorder,
      }))
    }
    const replayIcon = scene.add.graphics()
    drawLucide(replayIcon, 'rotate-ccw', 0, 0, 23, CREAM, 2.6)
    const replayLabel = text(0, 0, 'PLAY AGAIN', 26, '#fff8ec', 2)
    replayFace.add([replayIcon, replayLabel])
    const replayUnitW = 23 + 10 + replayLabel.width
    replayIcon.setPosition(-replayUnitW / 2 + 23 / 2, 0)
    replayLabel.setPosition(-replayUnitW / 2 + 23 + 10, -replayLabel.height / 2)
    replayLabel.setOrigin(0, 0)
    const replayHit = scene.add.rectangle(0, 0, columnW, 64, CREAM, 0.001).setInteractive({ useHandCursor: true })
    primary.add(replayHit)
    const orbitLine = scene.add.graphics()
    primary.add(orbitLine)
    content.add([replayGlow, replayShadow, primary])
    this.bindAction(primary, replayHit, this.onRestart, true, replayShadow)
    if (!this.reducedMotion) {
      const sweep = { angle: 0 }
      const paintOrbitLine = (): void => {
        orbitLine.clear()
        const n = replayContour.length
        const head = Math.floor(sweep.angle / (Math.PI * 2) * n) % n
        const trail = 28
        for (let i = 0; i < trail; i++) {
          const idx = (head - i + n) % n
          const a = replayContour[idx]!
          const b = replayContour[(idx + 1) % n]!
          const fade = 1 - i / trail
          orbitLine.lineStyle(2.2, blendColor(0x45d8ff, CREAM, fade), fade * 0.9)
          orbitLine.lineBetween(a.x, a.y, b.x, b.y)
        }
      }
      paintOrbitLine()
      this.tweens.push(scene.tweens.add({
        targets: sweep,
        angle: Math.PI * 2,
        duration: 2400,
        repeat: -1,
        ease: 'Linear',
        onUpdate: paintOrbitLine,
      }))
      const releaseFace = (): void => {
        scene.tweens.killTweensOf(replayFace)
        this.tweens.push(scene.tweens.add({
          targets: replayFace,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          duration: 300,
          ease: 'Elastic.easeOut',
        }))
      }
      replayHit.on('pointerdown', () => {
        scene.tweens.killTweensOf(replayFace)
        replayFace.setScale(1.02, 0.96).setAngle(-1.4)
      })
      replayHit.on('pointerup', releaseFace)
      replayHit.on('pointerout', releaseFace)
    }
    if (!this.reducedMotion) {
      this.tweens.push(scene.tweens.add({ targets: replayGlow, alpha: 0.25, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }))
    }

    // Home has a quieter cream plate. Guest saving remains a tertiary action,
    // never a second primary button or a requirement for another run.
    const footerY = primaryY + 32 + 14 + 29
    const homeX = wide && run.saveScore ? columnX - 78 : columnX
    const home = scene.add.container(homeX, footerY)
    content.add(home)
    const homeW = wide && run.saveScore ? 100 : 144
    const homeBody = scene.add.graphics()
    homeBody.fillStyle(0xfffdf7, 1)
    homeBody.lineStyle(2.5, RED, 1)
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
      panel.setAlpha(0).setScale(fit * 0.92).setY(vh / 2 + 12)
      this.tweens.push(
        scene.tweens.add({ targets: dim, alpha: 1, duration: 240, ease: 'Quad.easeOut' }),
        scene.tweens.add({ targets: panel, alpha: 1, duration: 220, ease: 'Quad.easeOut' }),
        scene.tweens.add({ targets: panel, y: vh / 2, scale: fit, duration: 380, ease: 'Back.easeOut.config(1.15)' }),
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

  private bindAction(
    container: Phaser.GameObjects.Container,
    hit: Phaser.GameObjects.Rectangle,
    onPress: () => void,
    replay = false,
    shadow?: Phaser.GameObjects.Graphics,
  ): void {
    const scene = this.scene
    const baseY = container.y
    let hovered = false
    let pressed = false
    const idle = (): void => {
      if (!replay || this.reducedMotion || hovered || pressed || this.restarting) return
      this.tweens.push(scene.tweens.add({ targets: container, scale: 1.03, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }))
    }
    const feedback = (scale: number, lift = 0, bounce = false, onComplete?: () => void): void => {
      scene.tweens.killTweensOf(container)
      container.setAlpha(pressed ? 0.88 : 1)
      shadow?.setAlpha(hovered && !pressed ? 1 : 0)
      if (this.reducedMotion) {
        container.setScale(scale).setY(baseY + lift)
        onComplete?.()
        return
      }
      this.tweens.push(scene.tweens.add({
        targets: container,
        scale,
        y: baseY + lift,
        duration: bounce ? 320 : 90,
        ease: bounce ? 'Elastic.easeOut' : 'Quad.easeOut',
        onComplete: () => {
          if (onComplete) onComplete()
          else idle()
        },
      }))
    }
    hit.on('pointerover', () => {
      if (this.restarting) return
      hovered = true
      feedback(pressed ? 0.95 : 1.05, pressed ? 0 : -2)
    })
    hit.on('pointerout', () => {
      if (this.restarting) return
      hovered = false
      const wasPressed = pressed
      pressed = false
      feedback(1, 0, wasPressed)
    })
    hit.on('pointerdown', () => {
      if (this.restarting) return
      pressed = true
      feedback(0.95)
    })
    hit.on('pointerup', () => {
      if (this.restarting || !pressed) return
      pressed = false
      if (replay) {
        this.restarting = true
        hit.disableInteractive()
        // Keep even a quick tap's spring visible before replacing the view.
        container.setScale(0.95)
      }
      feedback(1, 0, true, replay ? onPress : undefined)
      if (!replay) onPress()
    })
    idle()
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
    this.restarting = false
  }
}
