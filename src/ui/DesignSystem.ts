import Phaser from 'phaser'
import { hudText } from './Typography'

/**
 * Ball Rush Unified UI Design System & Tokens.
 * Single source of truth for colors, typography, buttons, cards, and screen chrome.
 */
export const UI_COLORS = {
  // Backdrops & Overlays
  BACKDROP_DIM: 0x0b0c16,
  BACKDROP_ALPHA: 0.92,
  PANEL_BG: 0x161b2e,
  PANEL_BORDER: 0x2b3555,
  CARD_BG: 0x1a2138,
  CARD_BG_HOVER: 0x222a47,
  CARD_BORDER: 0x33416b,
  CARD_BORDER_LOCKED: 0x1e2538,

  // Text Colors
  TEXT_GOLD: '#ffd93b',
  TEXT_BLUE: '#4fc3f7',
  TEXT_WHITE: '#ffffff',
  TEXT_MUTED: '#8e9bb5',
  TEXT_DARK: '#1a1a1a',

  // Buttons & Accents
  BTN_BLUE: 0x2563eb,
  BTN_BLUE_SHADOW: 0x1d4ed8,
  BTN_BLUE_HIGHLIGHT: 0x60a5fa,

  BTN_GOLD: 0xf59e0b,
  BTN_GOLD_SHADOW: 0xd97706,
  BTN_GOLD_HIGHLIGHT: 0xfcd34d,

  BTN_RED: 0xd92b2b,
  BTN_RED_SHADOW: 0x991b1b,
  BTN_RED_HIGHLIGHT: 0xef4444,

  BTN_GRAY: 0x374151,
  BTN_GRAY_SHADOW: 0x1f2937,
  BTN_GRAY_HIGHLIGHT: 0x4b5563,

  INK: 0x1a1a1a,
  INK_HEX: '#1a1a1a',
} as const

export interface ChunkyButtonOptions {
  scene: Phaser.Scene
  x: number
  y: number
  w: number
  h: number
  label?: string
  icon?: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number) => void
  iconSize?: number
  fill?: number
  shadowColor?: number
  highlightColor?: number
  textColor?: string
  fontSize?: number
  disabled?: boolean
  onClick?: () => void
}

/**
 * Reusable Chunky Cartoon Button (pure Phaser GameObjects container).
 * Matches the game's bold cartoon identity with thick borders, physical 3D drop slab,
 * top specular sheen, and animated squash on press.
 */
export class ChunkyButton {
  public readonly container: Phaser.GameObjects.Container
  private bg: Phaser.GameObjects.Graphics
  private labelText: Phaser.GameObjects.Text | null = null
  private iconG: Phaser.GameObjects.Graphics | null = null
  private hitZone: Phaser.GameObjects.Zone
  private options: ChunkyButtonOptions
  private isPressed = false
  // no hover state needed

  constructor(options: ChunkyButtonOptions) {
    this.options = options
    const { scene, x, y, w, h } = options

    this.container = scene.add.container(x, y)
    this.bg = scene.add.graphics()
    this.container.add(this.bg)

    if (options.label) {
      const fs = options.fontSize ?? Math.max(12, Math.round(h * 0.4))
      this.labelText = hudText(scene, 0, 0, options.label, 1, {
        color: options.textColor ?? '#ffffff',
        size: fs,
        stroke: 4,
        origin: [0.5, 0.5],
      })
      this.container.add(this.labelText)
    }

    if (options.icon) {
      this.iconG = scene.add.graphics()
      this.container.add(this.iconG)
    }

    this.hitZone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: !options.disabled })
    this.container.add(this.hitZone)

    this.hitZone.on('pointerdown', () => {
      if (this.options.disabled) return
      this.isPressed = true
      this.render()
    })

    this.hitZone.on('pointerup', () => {
      if (this.options.disabled) return
      this.isPressed = false
      this.render()
      options.onClick?.()
    })

    this.hitZone.on('pointerout', () => {
      this.isPressed = false
      this.render()
    })

    this.render()
  }

  public setDisabled(disabled: boolean): void {
    this.options.disabled = disabled
    if (this.hitZone.input) {
      this.hitZone.input.cursor = disabled ? 'default' : 'pointer'
    }
    this.render()
  }

  public setLabel(label: string): void {
    this.options.label = label
    if (this.labelText) {
      this.labelText.setText(label)
    }
  }

  public render(): void {
    const { w, h, disabled } = this.options
    const fill = disabled ? UI_COLORS.BTN_GRAY : (this.options.fill ?? UI_COLORS.BTN_BLUE)
    const shadow = disabled ? UI_COLORS.BTN_GRAY_SHADOW : (this.options.shadowColor ?? UI_COLORS.BTN_BLUE_SHADOW)
    const highlight = disabled ? UI_COLORS.BTN_GRAY_HIGHLIGHT : (this.options.highlightColor ?? UI_COLORS.BTN_BLUE_HIGHLIGHT)

    this.bg.clear()

    const cornerR = Math.min(12, h * 0.28)
    const slabH = this.isPressed ? 1 : 4
    const offsetY = this.isPressed ? 3 : 0

    // Outline / Drop slab
    this.bg.fillStyle(UI_COLORS.INK, 1)
    this.bg.fillRoundedRect(-w / 2 - 2, -h / 2 + 2 - 2 + slabH, w + 4, h + 4, cornerR + 2)

    // Side 3D extrusion slab
    this.bg.fillStyle(shadow, 1)
    this.bg.fillRoundedRect(-w / 2, -h / 2 + slabH, w, h, cornerR)

    // Main surface
    this.bg.fillStyle(fill, 1)
    this.bg.fillRoundedRect(-w / 2, -h / 2 + offsetY, w, h - 2, cornerR)

    // Top highlight pill
    if (!this.isPressed && !disabled) {
      this.bg.fillStyle(highlight, 0.4)
      this.bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, Math.max(3, h * 0.22), cornerR * 0.6)
    }

    // Border ink line
    this.bg.lineStyle(2.5, UI_COLORS.INK, 1)
    this.bg.strokeRoundedRect(-w / 2, -h / 2 + offsetY, w, h - 2 + (this.isPressed ? 0 : 2), cornerR)

    // Update Label / Icon Y offsets
    const contentY = offsetY + (this.isPressed ? 1 : -1)
    if (this.labelText) {
      this.labelText.setY(contentY)
      this.labelText.setAlpha(disabled ? 0.5 : 1)
    }

    if (this.iconG && this.options.icon) {
      this.iconG.clear()
      this.iconG.setY(contentY)
      const size = this.options.iconSize ?? Math.round(h * 0.45)
      this.options.icon(this.iconG, 0, 0, size)
      this.iconG.setAlpha(disabled ? 0.5 : 1)
    }
  }

  public destroy(): void {
    this.container.destroy()
  }
}

/**
 * Standard secondary screen header with left-aligned Back button, centered Title, and Subtitle.
 */
export function buildScreenHeader(
  scene: Phaser.Scene,
  parentContainer: Phaser.GameObjects.Container,
  opts: {
    vw: number
    vh: number
    title: string
    subtitle?: string
    onBack: () => void
    rectsCollector?: Array<{ label: string; x: number; y: number; w: number; h: number; screen: 'menu' | 'panel' | 'settings' }>
  },
): { headerH: number; contentTopY: number } {
  const { vw, vh, title, subtitle, onBack, rectsCollector } = opts

  const topMargin = Math.max(28, Math.round(vh * 0.055))
  const backW = Math.min(100, Math.max(84, Math.round(vw * 0.22)))
  const backH = 40
  const backX = Math.round(backW / 2 + Math.max(16, vw * 0.05))
  const backY = topMargin + backH / 2
  const backBtn = new ChunkyButton({
    scene,
    x: backX,
    y: backY,
    w: backW,
    h: backH,
    label: 'BACK',
    fontSize: 14,
    fill: UI_COLORS.BTN_BLUE,
    onClick: onBack,
  })
  parentContainer.add(backBtn.container)

  rectsCollector?.push({
    label: 'BACK',
    x: backX - backW / 2,
    y: backY - backH / 2,
    w: backW,
    h: backH,
    screen: 'panel',
  })

  // Title
  const titleSize = Math.max(20, Math.min(32, Math.round(vw * 0.06)))
  const titleY = topMargin + backH / 2 - 2
  const titleText = hudText(scene, vw / 2, titleY, title.toUpperCase(), 1, {
    color: UI_COLORS.TEXT_GOLD,
    size: titleSize,
    stroke: 5,
    origin: [0.5, 0.5],
  })
  parentContainer.add(titleText)

  // Subtitle sits clearly beneath the header bar
  let subtitleOffset = 0
  if (subtitle) {
    subtitleOffset = 28
    const subText = hudText(scene, vw / 2, titleY + backH / 2 + 18, subtitle, 1, {
      color: UI_COLORS.TEXT_MUTED,
      size: Math.max(10, Math.min(13, Math.round(vw * 0.028))),
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    subText.setAlpha(0.9)
    parentContainer.add(subText)
  }

  const contentTopY = topMargin + backH + subtitleOffset + 18
  return { headerH: contentTopY - topMargin, contentTopY }
}
