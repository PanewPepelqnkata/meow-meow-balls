import Phaser from 'phaser'
import { hudText } from './Typography'
import { drawLucide } from './LucideIcon'
import { readSafeArea } from './ResponsiveLayout'

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
  pill?: boolean
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
  private pressPointerId: number | null = null
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

    this.layoutContent()

    this.hitZone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: !options.disabled })
    this.container.add(this.hitZone)

    this.hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.options.disabled || this.pressPointerId !== null) return
      this.pressPointerId = pointer.id
      this.isPressed = true
      this.render()
    })

    this.hitZone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.options.disabled || this.pressPointerId !== pointer.id) return
      this.pressPointerId = null
      this.isPressed = false
      this.render()
      options.onClick?.()
    })

    this.hitZone.on('pointerout', (pointer: Phaser.Input.Pointer) => {
      if (this.pressPointerId !== null && this.pressPointerId !== pointer.id) return
      this.pressPointerId = null
      this.isPressed = false
      this.render()
    })

    this.setDisabled(!!options.disabled)
  }

  public setDisabled(disabled: boolean): void {
    this.options.disabled = disabled
    if (disabled) {
      this.pressPointerId = null
      this.isPressed = false
    }
    if (this.hitZone.input) {
      this.hitZone.input.enabled = !disabled
      this.hitZone.input.cursor = disabled ? 'default' : 'pointer'
    }
    this.render()
  }

  public setLabel(label: string): void {
    this.options.label = label
    if (this.labelText) {
      this.labelText.setText(label)
    }
    this.layoutContent()
  }

  private layoutContent(): void {
    if (!this.labelText) return
    const iconSize = this.iconG ? (this.options.iconSize ?? Math.round(this.options.h * 0.45)) : 0
    const gap = this.iconG ? 6 : 0
    const availableW = Math.max(1, this.options.w - 20 - iconSize - gap)
    this.labelText.setScale(Math.min(1, availableW / Math.max(1, this.labelText.width)))
    if (this.iconG) {
      const totalW = iconSize + gap + this.labelText.displayWidth
      this.iconG.setX(-totalW / 2 + iconSize / 2)
      this.labelText.setOrigin(0, 0.5).setX(-totalW / 2 + iconSize + gap)
    }
  }

  public render(): void {
    const { w, h, disabled } = this.options
    const fill = disabled ? UI_COLORS.BTN_GRAY : (this.options.fill ?? UI_COLORS.BTN_BLUE)
    const shadow = disabled ? UI_COLORS.BTN_GRAY_SHADOW : (this.options.shadowColor ?? UI_COLORS.BTN_BLUE_SHADOW)
    const highlight = disabled ? UI_COLORS.BTN_GRAY_HIGHLIGHT : (this.options.highlightColor ?? UI_COLORS.BTN_BLUE_HIGHLIGHT)

    this.bg.clear()

    const cornerR = this.options.pill ? h / 2 : Math.min(16, h * 0.32)
    const slabH = this.isPressed ? 1 : 5
    const offsetY = this.isPressed ? 3 : 0

    // Outline / Drop slab (tactile 3D bottom drop)
    this.bg.fillStyle(UI_COLORS.INK, 1)
    this.bg.fillRoundedRect(-w / 2 - 2, -h / 2 + 1 + slabH, w + 4, h + 3, cornerR)

    // Side 3D extrusion slab
    this.bg.fillStyle(shadow, 1)
    this.bg.fillRoundedRect(-w / 2, -h / 2 + slabH, w, h, cornerR)

    // Main surface
    this.bg.fillStyle(fill, 1)
    this.bg.fillRoundedRect(-w / 2, -h / 2 + offsetY, w, h - 2, cornerR)

    // Top highlight pill (specular gloss)
    if (!this.isPressed && !disabled) {
      this.bg.fillStyle(highlight, 0.4)
      const hlInset = this.options.pill ? 12 : 6
      this.bg.fillRoundedRect(-w / 2 + hlInset, -h / 2 + 3 + offsetY, w - hlInset * 2, Math.max(3, h * 0.2), cornerR * 0.5)
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
 * Safe-area-aware secondary header. Narrow screens reserve a separate title slot beside Back.
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

  const safe = readSafeArea()
  const compact = vh < 480
  const edge = Math.max(12, Math.min(28, Math.round(vw * 0.035)))
  const left = Math.max(edge, safe.left + 8)
  const right = Math.max(edge, safe.right + 8)
  const topMargin = Math.max(compact ? 10 : 18, safe.top + 8)
  const backW = vw < 600 || compact ? 82 : 100
  const backH = compact ? 36 : 40
  const backX = left + backW / 2
  const backY = topMargin + backH / 2
  const backBtn = new ChunkyButton({
    scene,
    x: backX,
    y: backY,
    w: backW,
    h: backH,
    label: 'BACK',
    icon: (g, cx, cy, s) => drawLucide(g, 'arrow-left', cx, cy, s, 0xffffff, 2.5),
    iconSize: 18,
    fontSize: 13,
    pill: true,
    fill: UI_COLORS.BTN_BLUE,
    shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
    highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
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

  const titleLeft = left + backW + 12
  const titleRight = vw < 700 ? vw - right : vw - Math.max(titleLeft, right)
  const titleX = vw < 700 ? (titleLeft + titleRight) / 2 : vw / 2
  const titleMaxW = Math.max(1, titleRight - titleLeft)
  const titleSize = compact || vw < 600 ? 26 : 32
  const titleText = hudText(scene, titleX, backY - 1, title.toUpperCase(), 1, {
    color: UI_COLORS.TEXT_GOLD,
    size: titleSize,
    stroke: 5,
    origin: [0.5, 0.5],
  })
  titleText.setScale(Math.min(1, titleMaxW / Math.max(1, titleText.width)))
  parentContainer.add(titleText)

  // The subtitle is bounded independently of the title / Back row.
  if (subtitle) {
    const subText = hudText(scene, (left + vw - right) / 2, topMargin + backH + (compact ? 14 : 18), subtitle, 1, {
      color: UI_COLORS.TEXT_MUTED,
      size: compact ? 11 : vw < 600 ? 10 : 12,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    subText.setAlpha(0.9)
    subText.setScale(Math.min(1, (vw - left - right) / Math.max(1, subText.width)))
    parentContainer.add(subText)
  }

  const contentTopY = topMargin + backH + (subtitle ? (compact ? 28 : 36) : (compact ? 10 : 18))
  return { headerH: contentTopY - topMargin, contentTopY }
}
