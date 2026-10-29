import Phaser from 'phaser'
import { drawLucide } from '../../ui/LucideIcon'
import { ChunkyButton, UI_COLORS } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { ballLookFor, ballOutlineWidth, drawBallFace, INK, restContour } from './BallAppearance'

/** Callbacks owned by PauseScene; this view never changes scene or run state. */
export interface PauseMenuHandlers {
  onResume(): void
  onRestart(): void
  onSettings(): void
  onMenu(): void
}

interface ButtonDefinition {
  label: string
  icon: string
  fill: number
  shadowColor: number
  highlightColor: number
  textColor: string
  iconColor: number
  onClick: () => void
}

/**
 * Pause card presentation for the gameplay scene.
 *
 * All geometry is CSS-world geometry: PauseScene's camera is responsible for
 * mapping it to the device-pixel canvas. The root owns a full-screen, silent
 * input blocker so an open pause card cannot leak taps to gameplay. Layout is
 * intentionally rebuild-safe: only the four ChunkyButtons and the blocker are
 * replaced on a settled resize; the static card/text/mascot objects are reused.
 */
export class PauseMenuView {
  private readonly scene: Phaser.Scene
  private readonly handlers: PauseMenuHandlers
  private readonly root: Phaser.GameObjects.Container
  private readonly cardG: Phaser.GameObjects.Graphics
  private readonly mascotG: Phaser.GameObjects.Graphics
  private readonly titleText: Phaser.GameObjects.Text
  private readonly scoreText: Phaser.GameObjects.Text
  private blocker: Phaser.GameObjects.Rectangle | null = null
  private buttonViews: ChunkyButton[] = []
  private buttonRects: Array<{ label: string; x: number; y: number; w: number; h: number }> = []
  private destroyed = false

  constructor(scene: Phaser.Scene, score: number, handlers: PauseMenuHandlers) {
    this.scene = scene
    this.handlers = handlers

    this.root = scene.add.container(0, 0).setName('pause-menu').setDepth(1000)
    this.cardG = scene.add.graphics().setName('pause-card')
    this.mascotG = scene.add.graphics().setName('pause-mascot')
    this.titleText = hudText(scene, 0, 0, 'PAUSED', 1, {
      color: '#f44336',
      size: 44,
      stroke: 5,
      origin: [0.5, 0.5],
      pad: 4,
    }).setName('pause-title')
    this.scoreText = hudText(scene, 0, 0, `SCORE ${formatScore(score)}`, 1, {
      color: '#2563eb',
      size: 22,
      stroke: 3,
      origin: [0.5, 0.5],
      pad: 3,
    }).setName('pause-score')

    this.root.add([this.cardG, this.mascotG, this.titleText, this.scoreText])
    this.layout()
  }

  /** Recompute CSS-world geometry after a settled DPR/orientation resize. */
  layout(): void {
    if (this.destroyed) return

    const z = this.scene.game.scale.displayScale.x || 1
    const vw = Math.max(1, this.scene.scale.width / z)
    const vh = Math.max(1, this.scene.scale.height / z)
    const safe = readSafeArea()
    const left = safe.left + 12
    const right = safe.right + 12
    const top = safe.top + 8
    const bottom = vh - safe.bottom - 8
    const availableW = Math.max(1, vw - left - right)
    const availableH = Math.max(1, bottom - top)
    const landscape = vw > vh
    const compactLandscape = landscape && vh <= 520

    // Leave clear space between the visible button slabs, not only their hit boxes.
    const cardW = Math.min(landscape ? 620 : 430, availableW)
    const cardX = left + (availableW - cardW) / 2
    const cx = cardX + cardW / 2
    const compactPhone = !landscape && vw <= 340
    const buttonH = landscape ? (compactLandscape ? 46 : 52) : compactPhone ? 44 : vw <= 430 ? 48 : 52
    const actionGap = landscape ? 16 : compactPhone ? 18 : 20
    const columnGap = 10
    const rows = landscape ? 2 : 4
    const mascotRadius = landscape ? (compactLandscape ? 22 : 28) : compactPhone ? 25 : 28
    const mascotBlock = mascotRadius * 2 + 8

    this.titleText.setFontSize(landscape && !compactLandscape ? 46 : compactLandscape || compactPhone ? 38 : 42)
    this.titleText.setScale(1)
    fitText(this.titleText, Math.max(1, cardW - 36))
    this.scoreText.setFontSize(compactLandscape || compactPhone ? 19 : 21)
    this.scoreText.setScale(1)
    fitText(this.scoreText, Math.max(1, cardW - 48))
    const titleBlock = Math.ceil(this.titleText.displayHeight)
    const scoreBlock = Math.ceil(Math.max(33.5, this.scoreText.displayHeight))

    let paddingTop = landscape ? (compactLandscape ? 14 : 18) : compactPhone ? 18 : 20
    let paddingBottom = landscape ? (compactLandscape ? 16 : 20) : compactPhone ? 20 : 22
    let titleMascotGap = landscape ? (compactLandscape ? 4 : 5) : 6
    let mascotScoreGap = landscape ? (compactLandscape ? 4 : 5) : 8
    let scoreActionsGap = landscape ? (compactLandscape ? 8 : 12) : compactPhone ? 12 : 14
    const actionBodyH = rows * buttonH + (rows - 1) * actionGap
    const actionSlabAllowance = 9
    const fixedH = titleBlock + mascotBlock + scoreBlock + actionBodyH + actionSlabAllowance
    const spacingH = paddingTop + paddingBottom + titleMascotGap + mascotScoreGap + scoreActionsGap
    // Short/safe-area-constrained screens yield spacing, never shrink just the backing card.
    const spacingScale = Math.max(0, Math.min(1, (availableH - fixedH) / spacingH))
    paddingTop *= spacingScale
    paddingBottom *= spacingScale
    titleMascotGap *= spacingScale
    mascotScoreGap *= spacingScale
    scoreActionsGap *= spacingScale
    const cardH = fixedH + paddingTop + paddingBottom + titleMascotGap + mascotScoreGap + scoreActionsGap
    const cardY = top + Math.max(0, (availableH - cardH) / 2)

    this.rebuildBlocker(vw, vh)

    let cursor = cardY + paddingTop
    const titleY = cursor + titleBlock / 2
    cursor += titleBlock + titleMascotGap
    const mascotY = cursor + mascotBlock / 2
    cursor += mascotBlock + mascotScoreGap
    const scoreY = cursor + scoreBlock / 2
    cursor += scoreBlock + scoreActionsGap
    const actionsTop = cursor

    this.titleText.setPosition(cx, titleY)
    this.scoreText.setPosition(cx, scoreY)
    this.drawCard(cardX, cardY, cardW, cardH)

    this.mascotG.setPosition(cx, mascotY)
    this.drawMascot(mascotRadius)

    // The four controls are recreated because ChunkyButton intentionally keeps
    // its dimensions immutable. Destroying the old containers also releases
    // their pointer listeners before a new settled layout is installed.
    this.destroyButtons()
    const buttonW = landscape
      ? Math.min(280, Math.max(44, Math.floor((cardW - 48 - columnGap) / 2)))
      : Math.max(44, cardW - (compactPhone ? 40 : 48))
    const definitions = this.definitions()
    const positions: Array<{ x: number; y: number }> = []
    if (landscape) {
      const gridW = buttonW * 2 + columnGap
      const firstX = cx - gridW / 2 + buttonW / 2
      for (let row = 0; row < 2; row++) {
        const y = actionsTop + row * (buttonH + actionGap) + buttonH / 2
        positions.push({ x: firstX, y }, { x: firstX + buttonW + columnGap, y })
      }
    } else {
      const x = cx
      for (let row = 0; row < 4; row++) {
        positions.push({ x, y: actionsTop + row * (buttonH + actionGap) + buttonH / 2 })
      }
    }

    for (let i = 0; i < definitions.length; i++) {
      const definition = definitions[i]!
      const position = positions[i]!
      const button = new ChunkyButton({
        scene: this.scene,
        x: position.x,
        y: position.y,
        w: buttonW,
        h: buttonH,
        label: definition.label,
        icon: (g, iconCx, iconCy, iconSize) =>
          drawLucide(g, definition.icon, iconCx, iconCy, iconSize, definition.iconColor, 2.5),
        iconSize: Math.min(22, Math.round(buttonH * 0.46)),
        fill: definition.fill,
        shadowColor: definition.shadowColor,
        highlightColor: definition.highlightColor,
        textColor: definition.textColor,
        fontSize: Math.max(15, Math.round(buttonH * 0.38)),
        onClick: definition.onClick,
      })
      button.container.setName(`pause-button-${definition.label.toLowerCase().replace(/ /g, '-')}`)
      this.root.add(button.container)
      this.buttonViews.push(button)
      this.buttonRects.push({
        label: definition.label,
        x: Math.round(position.x - buttonW / 2),
        y: Math.round(position.y - buttonH / 2),
        w: buttonW,
        h: buttonH,
      })
    }
  }

  /** CSS-world top-left rectangles, in RESUME/RESTART/SETTINGS/MAIN MENU order. */
  buttons(): Array<{ label: string; x: number; y: number; w: number; h: number }> {
    return this.buttonRects.map((rect) => ({ ...rect }))
  }

  /** Release every object created by this view. Safe to call more than once. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.destroyButtons()
    this.root.destroy()
    this.blocker = null
    this.buttonRects = []
  }

  private definitions(): ButtonDefinition[] {
    return [
      {
        label: 'RESUME',
        icon: 'play',
        fill: UI_COLORS.BTN_BLUE,
        shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
        highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
        textColor: '#ffffff',
        iconColor: 0xffffff,
        onClick: () => this.handlers.onResume(),
      },
      {
        label: 'RESTART',
        icon: 'rotate-ccw',
        fill: UI_COLORS.BTN_RED,
        shadowColor: UI_COLORS.BTN_RED_SHADOW,
        highlightColor: UI_COLORS.BTN_RED_HIGHLIGHT,
        textColor: '#ffffff',
        iconColor: 0xffffff,
        onClick: () => this.handlers.onRestart(),
      },
      {
        label: 'SETTINGS',
        icon: 'settings',
        fill: UI_COLORS.BTN_BLUE,
        shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
        highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
        textColor: '#ffffff',
        iconColor: 0xffffff,
        onClick: () => this.handlers.onSettings(),
      },
      {
        label: 'MAIN MENU',
        icon: 'house',
        fill: UI_COLORS.PANEL_BORDER,
        shadowColor: UI_COLORS.PANEL_BG,
        highlightColor: 0x64748b,
        textColor: '#ffffff',
        iconColor: 0xffffff,
        onClick: () => this.handlers.onMenu(),
      },
    ]
  }

  private rebuildBlocker(vw: number, vh: number): void {
    this.blocker?.destroy()
    this.blocker = this.scene.add
      .rectangle(0, 0, vw, vh, UI_COLORS.BACKDROP_DIM, 0.72)
      .setOrigin(0, 0)
      .setName('pause-dim-blocker')
      .setInteractive({ useHandCursor: false })
    this.root.addAt(this.blocker, 0)
  }

  private drawCard(cardX: number, cardY: number, cardW: number, cardH: number): void {
    const radius = Math.min(24, Math.max(14, cardW * 0.065))
    const g = this.cardG
    g.clear()

    // A dark drop plate and a cream paper face give the panel the same tactile
    // silhouette language as ChunkyButton without adding a per-frame texture.
    g.fillStyle(0x000000, 0.28)
    g.fillRoundedRect(cardX + 5, cardY + 8, cardW, cardH, radius)
    g.fillStyle(0xfff8ec, 1)
    g.fillRoundedRect(cardX, cardY, cardW, cardH, radius)
    g.lineStyle(4, INK, 1)
    g.strokeRoundedRect(cardX, cardY, cardW, cardH, radius)

    // Small blue header glint and a quiet score capsule keep the card from
    // reading as a flat dialog while preserving the navy/red game palette.
    g.fillStyle(UI_COLORS.BTN_BLUE, 0.16)
    g.fillRoundedRect(cardX + 24, cardY + 16, Math.max(1, cardW - 48), 8, 4)
    g.fillStyle(0xffffff, 0.32)
    g.fillEllipse(cardX + cardW * 0.22, cardY + cardH * 0.15, cardW * 0.34, Math.min(28, cardH * 0.12))

    const scorePillW = Math.min(cardW - 34, Math.max(134, Math.min(250, this.scoreText.width + 30)))
    const scorePillY = this.scoreText.y
    g.fillStyle(UI_COLORS.BTN_BLUE, 0.12)
    g.fillRoundedRect(cardX + (cardW - scorePillW) / 2, scorePillY - 16, scorePillW, 32, 16)
    g.lineStyle(1.5, UI_COLORS.BTN_BLUE, 0.32)
    g.strokeRoundedRect(cardX + (cardW - scorePillW) / 2, scorePillY - 16, scorePillW, 32, 16)
  }

  private drawMascot(radius: number): void {
    const g = this.mascotG
    g.clear()
    const look = ballLookFor(1, 0x5eed)
    const poly = restContour(look, radius, 0, 0, 32)
    const points = poly.map((point) => new Phaser.Math.Vector2(point.x, point.y))
    g.fillStyle(0x000000, 0.12)
    g.fillEllipse(2, radius * 0.95, radius * 1.55, Math.max(4, radius * 0.3))
    g.fillStyle(0x4fc3f7, 1)
    g.fillPoints(points, true)
    g.lineStyle(ballOutlineWidth(radius), INK, 1)
    g.strokePoints(points, true, true)
    drawBallFace(g, look, { x: 0, y: 0 }, radius, 1)
  }

  private destroyButtons(): void {
    for (const button of this.buttonViews) button.destroy()
    this.buttonViews = []
    this.buttonRects = []
  }
}

function formatScore(score: number): string {
  return score.toLocaleString('en-US')
}

function fitText(text: Phaser.GameObjects.Text, maxWidth: number): void {
  const width = Math.max(1, text.displayWidth)
  if (width > maxWidth) text.setScale(maxWidth / width)
}
