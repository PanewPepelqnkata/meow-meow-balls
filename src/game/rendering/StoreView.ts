import Phaser from 'phaser'
import { ChunkyButton, UI_COLORS } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { authService } from '../../services/auth'
import {
  UPGRADE_CATALOG,
  type UpgradeId,
  type UpgradeLevels,
  shakeDurationMs,
  shakeImpulseMultiplier,
  upgradeCost,
  wallDurationMs,
} from '../../config/abilityUpgrades'
import { gameBus } from '../events/gameBus'
import { loadSave } from '../state/save'
import { drawCoin, formatCoins } from './Coin'
import { INK } from './BallAppearance'

const UPGRADE_IDS: readonly UpgradeId[] = ['wallDuration', 'shakeDuration', 'shakeIntensity']

// Warm paper, ink and worn wood are shared with the collection book. The blue
// and gold accents keep the shop tied to the rest of the Ball Rush chrome.
const WOOD = 0x5a3b25
const WOOD_DARK = 0x2d1d16
const WOOD_LIGHT = 0x94663d
const WOOD_GRAIN = 0xb48754
const CANOPY_RED = 0xd64b3d
const CANOPY_RED_DARK = 0x9e2f2c
const PAPER = 0xf8f2e1
const PAPER_BASE = 0xe6dac2
const PAPER_EDGE = 0xc9b88f
const PRIMARY_TEXT = '#2d241e'
const SECONDARY_TEXT = '#786a5a'
const GOLD_TEXT = '#7a5411'
const SHADOW = 0x05070e
const ACCENT_BLUE = 0x3478d4
const ACCENT_GOLD = 0xf0b52d
const ACCENT_CORAL = 0xe35c4d

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

type PurchaseStatus = { kind: 'success' | 'error'; message: string }

/** A hand-drawn merchant stall containing account-only ability upgrades. */
export class StoreView {
  private readonly storeContainer: Phaser.GameObjects.Container
  private readonly shopGraphics: Phaser.GameObjects.Graphics
  private readonly shopChrome: Phaser.GameObjects.Container
  private readonly itemContainer: Phaser.GameObjects.Container
  private readonly navContainer: Phaser.GameObjects.Container
  private readonly scene: Phaser.Scene
  private readonly shopX: number
  private readonly shopTopY: number
  private readonly shopW: number
  private readonly shopH: number
  private readonly navY: number
  private currentPage = 0
  private paged = false
  private readonly purchasing = new Set<UpgradeId>()
  private readonly purchaseStatus = new Map<UpgradeId, PurchaseStatus>()
  private unsubscribeAuth: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private lifecycleRevision = 0
  private destroyed = false

  constructor(
    scene: Phaser.Scene,
    parentContainer: Phaser.GameObjects.Container,
    vw: number,
    vh: number,
    topY: number,
  ) {
    this.scene = scene

    const safe = readSafeArea()
    const left = Math.max(12, safe.left + 8)
    const right = Math.max(12, safe.right + 8)
    const availableW = Math.max(1, vw - left - right)
    this.shopW = Math.floor(Math.min(920, availableW))
    this.shopX = Math.floor(left + (availableW - this.shopW) / 2)
    this.shopTopY = topY + (vh < 500 ? 10 : 16)
    this.navY = vh - Math.max(36, safe.bottom + 30)
    const availableH = Math.max(1, this.navY - this.shopTopY - 28)
    this.shopH = Math.floor(Math.min(620, availableH))

    this.storeContainer = scene.add.container(0, 0).setName('merchant-store')
    parentContainer.add(this.storeContainer)
    this.shopGraphics = scene.add.graphics().setName('merchant-stall')
    this.shopChrome = scene.add.container(0, 0).setName('merchant-stall-sign')
    this.itemContainer = scene.add.container(0, 0).setName('merchant-items')
    this.navContainer = scene.add.container(0, 0).setName('merchant-nav')
    this.storeContainer.add([this.shopGraphics, this.shopChrome, this.itemContainer, this.navContainer])

    this.storeContainer.once(Phaser.GameObjects.Events.DESTROY, this.release, this)
    this.unsubscribeAuth = authService.onAuthStateChange(() => {
      if (this.destroyed) return
      this.lifecycleRevision++
      this.purchasing.clear()
      this.purchaseStatus.clear()
      this.renderShop()
      this.renderItems()
      this.renderBottomNav()
    })
    this.unsubscribeState = gameBus.on('state:save', () => {
      if (this.destroyed) return
      this.renderItems()
      this.renderBottomNav()
    })

    this.renderShop()
    this.renderItems()
    this.renderBottomNav()
  }

  public destroy(): void {
    if (this.destroyed) return
    this.release()
    this.storeContainer.destroy()
  }

  private release(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.lifecycleRevision++
    this.purchasing.clear()
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
    this.unsubscribeState?.()
    this.unsubscribeState = null
    this.scene.tweens.killTweensOf(this.storeContainer)
  }

  /** Draw the wooden roadside shop and its little merchant. */
  private renderShop(): void {
    const g = this.shopGraphics
    const { shopX: x, shopTopY: y, shopW: w, shopH: h } = this
    const radius = clamp(Math.min(w, h) * 0.055, 10, 20)
    const headerH = this.headerHeight()
    const cx = x + w / 2

    g.clear()
    g.fillStyle(SHADOW, 0.36)
    g.fillEllipse(cx, y + h + 8, Math.max(40, w * 0.86), Math.max(8, Math.min(24, h * 0.07)))

    // Thick inked wood backing and a warm page-like center.
    g.fillStyle(WOOD_DARK, 1)
    g.fillRoundedRect(x - 4, y + 5, w + 8, h + 6, radius + 3)
    g.fillStyle(WOOD, 1)
    g.fillRoundedRect(x, y, w, h, radius)
    g.lineStyle(3, WOOD_DARK, 1)
    g.strokeRoundedRect(x, y, w, h, radius)
    g.lineStyle(1.4, WOOD_LIGHT, 0.9)
    g.strokeRoundedRect(x + 4, y + 4, Math.max(1, w - 8), Math.max(1, h - 8), Math.max(4, radius - 4))

    // Inked plank seams and the shelf rail behind the cards.
    g.lineStyle(1, WOOD_GRAIN, 0.35)
    const plankStep = clamp(w * 0.13, 28, 76)
    for (let sx = x + plankStep; sx < x + w; sx += plankStep) {
      g.lineBetween(sx, y + headerH + 2, sx - 2, y + h - 7)
    }
    g.lineStyle(2, WOOD_DARK, 0.72)
    g.lineBetween(x + 10, y + headerH - 1, x + w - 10, y + headerH - 1)
    g.lineStyle(1, WOOD_LIGHT, 0.6)
    g.lineBetween(x + 14, y + headerH + 3, x + w - 14, y + headerH + 3)

    // Red striped awning and hanging peg details make this read as a shop,
    // rather than a generic panel.
    const awningY = y - Math.min(8, h * 0.035)
    const awningH = clamp(headerH * 0.25, 10, 18)
    g.fillStyle(WOOD_DARK, 1)
    g.fillRoundedRect(x + 8, awningY + 3, Math.max(1, w - 16), awningH + 4, 6)
    g.fillStyle(CANOPY_RED, 1)
    g.fillRoundedRect(x + 10, awningY, Math.max(1, w - 20), awningH, 5)
    const stripes = Math.max(3, Math.floor(w / 64))
    const stripeW = (w - 20) / stripes
    for (let i = 0; i < stripes; i += 2) {
      g.fillStyle(CANOPY_RED_DARK, 0.8)
      g.fillRect(x + 10 + i * stripeW, awningY, stripeW, awningH)
    }
    g.lineStyle(1.4, INK, 0.85)
    g.strokeRoundedRect(x + 10, awningY, Math.max(1, w - 20), awningH, 5)
    for (let i = 0; i <= stripes; i++) {
      const pegX = x + 10 + i * stripeW
      g.fillStyle(0xffd77a, 1)
      g.fillCircle(pegX, awningY + awningH + 2, 1.8)
    }

    // Tiny merchant peeks out beside the sign.
    const merchantR = clamp(Math.min(w, headerH) * 0.28, 9, 16)
    this.drawMerchant(g, x + w - merchantR - 13, y + headerH * 0.46, merchantR)

    this.shopChrome.removeAll(true)
    const signX = x + w * 0.45
    const signMaxW = Math.max(56, w - merchantR * 2 - 42)
    this.addFittedText(this.shopChrome, signX, y + headerH * 0.38, "BALLKEEPER'S SHOP", signMaxW, clamp(headerH * 0.25, 11, 18), '#fff4d2')
    this.addFittedText(this.shopChrome, signX, y + headerH * 0.73, 'TUNE YOUR SPECIAL MOVES', signMaxW, clamp(headerH * 0.15, 8, 11), '#f1d39a')
  }

  private headerHeight(): number {
    return clamp(this.shopH * 0.13, 38, 72)
  }

  private drawMerchant(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    // Body, scarf and friendly face use the same thick ink silhouette as book balls.
    g.fillStyle(INK, 0.24)
    g.fillEllipse(x + 1, y + r * 1.1, r * 1.65, r * 0.55)
    g.fillStyle(0x3d72c9, 1)
    g.fillRoundedRect(x - r * 0.62, y + r * 0.42, r * 1.24, r * 0.9, r * 0.26)
    g.lineStyle(Math.max(1, r * 0.13), INK, 1)
    g.strokeRoundedRect(x - r * 0.62, y + r * 0.42, r * 1.24, r * 0.9, r * 0.26)
    g.fillStyle(0xffd1a0, 1)
    g.fillCircle(x, y, r * 0.72)
    g.lineStyle(Math.max(1, r * 0.12), INK, 1)
    g.strokeCircle(x, y, r * 0.72)
    // Pointed cap.
    g.fillStyle(0xd64b3d, 1)
    g.fillTriangle(x - r * 0.8, y - r * 0.48, x + r * 0.8, y - r * 0.48, x + r * 0.1, y - r * 1.2)
    g.lineStyle(Math.max(1, r * 0.1), INK, 1)
    g.strokeTriangle(x - r * 0.8, y - r * 0.48, x + r * 0.8, y - r * 0.48, x + r * 0.1, y - r * 1.2)
    g.fillStyle(INK, 1)
    g.fillCircle(x - r * 0.24, y - r * 0.03, Math.max(1, r * 0.075))
    g.fillCircle(x + r * 0.24, y - r * 0.03, Math.max(1, r * 0.075))
    g.lineStyle(Math.max(0.8, r * 0.06), INK, 1)
    g.beginPath()
    g.arc(x, y + r * 0.12, r * 0.28, 0.18, Math.PI - 0.18, false)
    g.strokePath()
  }

  private renderItems(): void {
    if (this.destroyed) return
    this.itemContainer.removeAll(true)

    const inset = clamp(this.shopW * 0.04, 10, 24)
    const gap = clamp(Math.min(this.shopW, this.shopH) * 0.02, 6, 12)
    const gridTop = this.shopTopY + this.headerHeight() + 8
    const gridBottom = this.shopTopY + this.shopH - 10
    const gridW = Math.max(1, this.shopW - inset * 2)
    const gridH = Math.max(1, gridBottom - gridTop)
    const cols = this.shopW >= 700 ? 3 : 1
    // Short phones get real paging controls, not unreadably shrunken cards.
    this.paged = cols === 1 && gridH < UPGRADE_IDS.length * 96 + gap * 2
    const rows = this.paged ? 1 : Math.ceil(UPGRADE_IDS.length / cols)
    const cardW = Math.max(1, (gridW - gap * (cols - 1)) / cols)
    const cardH = Math.max(1, (gridH - gap * (rows - 1)) / rows)

    UPGRADE_IDS.forEach((id, index) => {
      if (this.paged && index !== this.currentPage) return
      const col = this.paged ? 0 : index % cols
      const row = this.paged ? 0 : Math.floor(index / cols)
      const x = this.shopX + inset + col * (cardW + gap)
      const y = gridTop + row * (cardH + gap)
      this.renderUpgradeCard(x, y, cardW, cardH, id, index)
    })

    if (!authService.isRegisteredAccount()) this.renderAccountGate()
  }

  private currentLevels(): UpgradeLevels {
    const raw = loadSave().upgrades
    return {
      wallDuration: Math.max(0, Math.floor(Number(raw?.wallDuration ?? 0))),
      shakeDuration: Math.max(0, Math.floor(Number(raw?.shakeDuration ?? 0))),
      shakeIntensity: Math.max(0, Math.floor(Number(raw?.shakeIntensity ?? 0))),
    }
  }

  private effectValue(id: UpgradeId, level: number): string {
    if (id === 'wallDuration') return this.formatDuration(wallDurationMs(level))
    if (id === 'shakeDuration') return this.formatDuration(shakeDurationMs(level))
    return `${shakeImpulseMultiplier(level).toFixed(1)}x`
  }

  private formatDuration(milliseconds: number): string {
    const seconds = milliseconds / 1000
    return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`
  }

  private addFittedText(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    value: string,
    maxWidth: number,
    size: number,
    color = PRIMARY_TEXT,
  ): Phaser.GameObjects.Text {
    const text = hudText(this.scene, x, y, value, 1, {
      color,
      size,
      stroke: 0,
      pad: 0,
      origin: [0.5, 0.5],
      shadow: false,
    }).setStroke('#000000', 0)
    text.setScale(Math.min(1, Math.max(0.1, maxWidth / Math.max(1, text.width))))
    parent.add(text)
    return text
  }

  private renderUpgradeCard(x: number, y: number, w: number, h: number, id: UpgradeId, index: number): void {
    const definition = UPGRADE_CATALOG[id]
    const levels = this.currentLevels()
    const current = Math.min(definition.maxLevel, levels[id])
    const next = Math.min(definition.maxLevel, current + 1)
    const cost = upgradeCost(id, current)
    const registered = authService.isRegisteredAccount()
    const balance = Number(loadSave().coins) || 0
    const maxed = current >= definition.maxLevel
    const insufficient = registered && !maxed && balance < cost
    const pending = this.purchasing.has(id)
    const disabled = !registered || maxed || insufficient || pending
    const accent = id === 'wallDuration' ? ACCENT_BLUE : id === 'shakeDuration' ? ACCENT_CORAL : ACCENT_GOLD
    const card = this.scene.add.container(x + w / 2, y + h / 2).setName(`merchant-upgrade-${id}`)
    card.setRotation(index % 2 === 0 ? -0.002 : 0.002)
    this.itemContainer.add(card)

    const g = this.scene.add.graphics().setName('merchant-upgrade-card')
    const radius = clamp(Math.min(w, h) * 0.09, 6, 12)
    const left = -w / 2
    const top = -h / 2
    g.fillStyle(INK, 0.25)
    g.fillRoundedRect(left + 2, top + 4, w, h, radius)
    g.fillStyle(PAPER_BASE, 1)
    g.fillRoundedRect(left, top, w, h, radius)
    g.fillStyle(PAPER, 0.99)
    g.fillRoundedRect(left, top - 1, w, h - 1, radius)
    g.lineStyle(1.5, PAPER_EDGE, 1)
    g.strokeRoundedRect(left, top, w, h, radius)
    g.lineStyle(0.8, INK, 0.15)
    g.strokeRoundedRect(left + 2, top + 2, Math.max(1, w - 4), Math.max(1, h - 4), Math.max(3, radius - 2))
    g.lineStyle(1, 0xffffff, 0.42)
    g.strokeRoundedRect(left + 3, top + 3, Math.max(1, w - 6), Math.max(1, h - 6), Math.max(3, radius - 3))
    card.add(g)

    const upright = h >= 320 && w < 340
    const roomy = h >= 132
    const padding = clamp(w * 0.04, 10, 16)
    const buttonH = upright ? 44 : roomy ? 40 : 32
    const buttonW = upright ? w - 28 : clamp(w * 0.31, 88, 136)
    const buttonX = upright ? 0 : w / 2 - padding - buttonW / 2
    const buttonY = top + h - buttonH / 2 - 10
    const iconR = upright
      ? clamp(Math.min(w * 0.33, (h - 232) * 0.36), 28, 72)
      : clamp(Math.min(w * 0.12, (h - buttonH - 22) * 0.42), 16, 46)
    const iconX = upright ? 0 : left + padding + iconR + 2
    const iconY = upright ? top + (62 + h - 190) / 2 : top + iconR + 8
    const iconPlate = this.scene.add.graphics().setName(`merchant-upgrade-art-${id}`)
    iconPlate.fillStyle(accent, 0.12)
    iconPlate.fillCircle(iconX, iconY, iconR + (upright ? 8 : 3))
    iconPlate.lineStyle(1, accent, 0.42)
    iconPlate.strokeCircle(iconX, iconY, iconR + (upright ? 8 : 3))
    this.drawUpgradeIcon(iconPlate, id, iconX, iconY, iconR * 0.86)
    card.add(iconPlate)

    const textLeft = upright ? left + 12 : iconX + iconR + 10
    const textW = upright ? w - 24 : Math.max(1, w / 2 - padding - textLeft)
    const textX = textLeft + textW / 2
    const title = definition.name.toUpperCase()
    const benefit = id === 'wallDuration' ? '+1s WALL TIME / STAGE'
      : id === 'shakeDuration' ? '+0.5s SHAKE / STAGE' : '+10% BOUNCE + JITTER'
    const status = this.purchaseStatus.get(id)
    const statusColor = status?.kind === 'success' ? '#397a3b' : status?.kind === 'error' ? '#b53b2e' : SECONDARY_TEXT
    this.addFittedText(card, textX, top + (upright ? 22 : roomy ? 19 : 13), title, textW, upright ? 20 : roomy ? 17 : 14)
    this.addFittedText(card, textX, top + (upright ? 45 : roomy ? 40 : 28), status?.message ?? benefit, textW, upright ? 12 : 11, statusColor)

    if (upright) {
      // The paper inset clearly separates the current effect from the next purchase.
      g.fillStyle(accent, 0.08)
      g.fillRoundedRect(left + 12, top + h - 190, w - 24, 77, 9)
      g.lineStyle(1, accent, 0.28)
      g.strokeRoundedRect(left + 12, top + h - 190, w - 24, 77, 9)
      this.addFittedText(card, -w * 0.23, top + h - 174, 'NOW', w * 0.35, 11, SECONDARY_TEXT)
      this.addFittedText(card, w * 0.23, top + h - 174, maxed ? 'MAXED' : 'NEXT', w * 0.35, 11, SECONDARY_TEXT)
      this.addFittedText(card, -w * 0.23, top + h - 153, this.effectValue(id, current), w * 0.35, 23)
      this.addFittedText(card, 0, top + h - 153, '→', 22, 18, SECONDARY_TEXT)
      this.addFittedText(card, w * 0.23, top + h - 153, this.effectValue(id, next), w * 0.35, 23, GOLD_TEXT)
      this.addFittedText(card, 0, top + h - 128, `MAX EFFECT ${this.effectValue(id, definition.maxLevel)}`, w - 28, 11, SECONDARY_TEXT)
      this.addFittedText(card, 0, top + h - 105, `STAGE ${current} / ${definition.maxLevel}`, w - 28, 12)
      this.renderStageBar(card, 0, top + h - 85, w - 28, current, definition.maxLevel, accent)
    } else {
      const preview = maxed
        ? `${this.effectValue(id, current)} · MAX EFFECT`
        : `${this.effectValue(id, current)} → ${this.effectValue(id, next)} · MAX ${this.effectValue(id, definition.maxLevel)}`
      this.addFittedText(card, textX, top + (roomy ? 64 : 44), preview, textW, roomy ? 16 : 13, GOLD_TEXT)
      const progressW = Math.max(1, w - padding * 2 - buttonW - 14)
      const progressX = left + padding + progressW / 2
      this.renderStageBar(card, progressX, top + h - (roomy ? 33 : 26), progressW, current, definition.maxLevel, accent)
      this.addFittedText(card, progressX, top + h - (roomy ? 15 : 12), `STAGE ${current} / ${definition.maxLevel}`, progressW, roomy ? 11 : 10)
    }

    const buttonLabel = pending ? 'BUYING...' : maxed ? 'MAXED' : !registered ? `${cost} COINS` : insufficient ? `NEED ${cost}` : `BUY ${cost}`
    const button = new ChunkyButton({
      scene: this.scene,
      x: buttonX,
      y: buttonY,
      w: buttonW,
      h: buttonH,
      label: buttonLabel,
      icon: !maxed && !pending && registered ? (coinG, cx, cy, size) => drawCoin(coinG, cx, cy, size * 0.42) : undefined,
      iconSize: upright ? 18 : 14,
      fontSize: upright ? 16 : roomy ? 13 : 11,
      textColor: UI_COLORS.TEXT_WHITE,
      fill: UI_COLORS.BTN_GOLD,
      shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
      highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
      pill: true,
      disabled,
      onClick: () => {
        void this.purchase(id)
      },
    })
    button.container.setName(`merchant-buy-${id}`)
    card.add(button.container)
  }

  /** Draw the three ability objects: bricks/clock, wobbling timer and power ball. */
  private drawUpgradeIcon(g: Phaser.GameObjects.Graphics, id: UpgradeId, x: number, y: number, r: number): void {
    g.lineStyle(Math.max(1.3, r * 0.07), INK, 1)
    if (id === 'wallDuration') {
      // Two raised brick walls shelter a ball; the attached clock is the upgrade.
      const wallW = r * 0.48
      const wallH = r * 1.14
      g.fillStyle(0x5d9bea, 1)
      g.fillRoundedRect(x - r * 0.9, y - r * 0.35, wallW, wallH, r * 0.08)
      g.fillRoundedRect(x + r * 0.42, y - r * 0.35, wallW, wallH, r * 0.08)
      g.strokeRoundedRect(x - r * 0.9, y - r * 0.35, wallW, wallH, r * 0.08)
      g.strokeRoundedRect(x + r * 0.42, y - r * 0.35, wallW, wallH, r * 0.08)
      g.lineStyle(Math.max(0.8, r * 0.045), 0x255a95, 0.8)
      for (const side of [-1, 1] as const) {
        const wallX = side < 0 ? x - r * 0.9 : x + r * 0.42
        g.lineBetween(wallX, y + r * 0.04, wallX + wallW, y + r * 0.04)
        g.lineBetween(wallX, y + r * 0.42, wallX + wallW, y + r * 0.42)
        g.lineBetween(wallX + wallW / 2, y + r * 0.04, wallX + wallW / 2, y + r * 0.42)
      }
      g.fillStyle(0xf0b52d, 1)
      g.fillCircle(x - r * 0.04, y + r * 0.45, r * 0.3)
      g.lineStyle(Math.max(1, r * 0.06), INK, 1)
      g.strokeCircle(x - r * 0.04, y + r * 0.45, r * 0.3)
      g.fillStyle(INK, 1)
      g.fillCircle(x - r * 0.14, y + r * 0.4, Math.max(0.8, r * 0.035))
      g.fillCircle(x + r * 0.08, y + r * 0.4, Math.max(0.8, r * 0.035))
      g.lineBetween(x - r * 0.12, y + r * 0.54, x + r * 0.04, y + r * 0.54)
      g.lineStyle(Math.max(1.1, r * 0.07), INK, 1)
      g.fillStyle(0xffdc67, 1)
      g.fillCircle(x + r * 0.32, y - r * 0.43, r * 0.46)
      g.strokeCircle(x + r * 0.32, y - r * 0.43, r * 0.46)
      g.lineBetween(x + r * 0.32, y - r * 0.43, x + r * 0.32, y - r * 0.7)
      g.lineBetween(x + r * 0.32, y - r * 0.43, x + r * 0.53, y - r * 0.28)
      return
    }
    if (id === 'shakeDuration') {
      g.fillStyle(0xffd877, 1)
      g.beginPath()
      g.moveTo(x - r * 0.54, y - r * 0.72)
      g.lineTo(x + r * 0.54, y - r * 0.72)
      g.lineTo(x + r * 0.18, y)
      g.lineTo(x + r * 0.54, y + r * 0.72)
      g.lineTo(x - r * 0.54, y + r * 0.72)
      g.lineTo(x - r * 0.18, y)
      g.closePath()
      g.fillPath()
      g.strokePath()
      g.fillStyle(0xd88b31, 1)
      g.fillTriangle(x - r * 0.42, y - r * 0.48, x + r * 0.42, y - r * 0.48, x, y - r * 0.04)
      g.fillTriangle(x - r * 0.42, y + r * 0.48, x + r * 0.42, y + r * 0.48, x, y + r * 0.04)
      g.fillStyle(0xd65a45, 1)
      g.fillRoundedRect(x - r * 0.65, y - r * 0.84, r * 1.3, r * 0.2, r * 0.08)
      g.fillRoundedRect(x - r * 0.65, y + r * 0.65, r * 1.3, r * 0.2, r * 0.08)
      g.lineStyle(Math.max(0.8, r * 0.05), INK, 0.9)
      g.strokeRoundedRect(x - r * 0.65, y - r * 0.84, r * 1.3, r * 0.2, r * 0.08)
      g.strokeRoundedRect(x - r * 0.65, y + r * 0.65, r * 1.3, r * 0.2, r * 0.08)
      g.lineStyle(Math.max(0.8, r * 0.06), INK, 0.7)
      g.lineBetween(x - r * 0.86, y - r * 0.25, x - r * 1.04, y - r * 0.38)
      g.lineBetween(x + r * 0.86, y + r * 0.25, x + r * 1.04, y + r * 0.38)
      return
    }
    // A happy ball struck by a lightning bolt communicates intensity at a glance.
    g.fillStyle(0xf6c63d, 1)
    g.fillCircle(x, y + r * 0.18, r * 0.68)
    g.strokeCircle(x, y + r * 0.18, r * 0.68)
    g.fillStyle(INK, 1)
    g.fillCircle(x - r * 0.23, y + r * 0.08, Math.max(1, r * 0.07))
    g.fillCircle(x + r * 0.23, y + r * 0.08, Math.max(1, r * 0.07))
    g.lineStyle(Math.max(0.8, r * 0.06), INK, 1)
    g.beginPath()
    g.arc(x, y + r * 0.19, r * 0.26, 0.2, Math.PI - 0.2, false)
    g.strokePath()
    g.fillStyle(0xfff0a1, 1)
    g.beginPath()
    g.moveTo(x + r * 0.08, y - r * 0.94)
    g.lineTo(x + r * 0.52, y - r * 0.94)
    g.lineTo(x + r * 0.2, y - r * 0.35)
    g.lineTo(x + r * 0.54, y - r * 0.35)
    g.lineTo(x - r * 0.25, y + r * 0.5)
    g.lineTo(x - r * 0.03, y - r * 0.1)
    g.lineTo(x - r * 0.37, y - r * 0.1)
    g.closePath()
    g.fillPath()
    g.lineStyle(Math.max(0.9, r * 0.08), INK, 1)
    g.strokePath()
    g.lineStyle(Math.max(1, r * 0.06), ACCENT_CORAL, 1)
    g.lineBetween(x - r * 0.78, y - r * 0.2, x - r * 0.98, y - r * 0.37)
    g.lineBetween(x - r * 0.8, y + r * 0.35, x - r * 1.03, y + r * 0.4)
    g.lineBetween(x + r * 0.78, y - r * 0.2, x + r * 0.98, y - r * 0.37)
    g.lineBetween(x + r * 0.8, y + r * 0.35, x + r * 1.03, y + r * 0.4)
  }

  /** Segmented loading bar: every segment is one purchase stage. */
  private renderStageBar(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    width: number,
    current: number,
    max: number,
    accent: number,
  ): void {
    const g = this.scene.add.graphics().setName('merchant-stage-bar')
    const gap = clamp(width / Math.max(1, max * 8), 1.2, 3)
    const segmentW = Math.max(1, (width - gap * (max - 1)) / max)
    const height = clamp(segmentW * 0.48, 5, 9)
    const left = x - width / 2
    for (let i = 0; i < max; i++) {
      const filled = i < current
      g.fillStyle(filled ? accent : 0xd8cdb9, filled ? 1 : 0.8)
      g.fillRoundedRect(left + i * (segmentW + gap), y - height / 2, segmentW, height, Math.min(2, height / 2))
      g.lineStyle(0.7, INK, filled ? 0.45 : 0.18)
      g.strokeRoundedRect(left + i * (segmentW + gap), y - height / 2, segmentW, height, Math.min(2, height / 2))
    }
    parent.add(g)
  }

  /** Guests can browse the goods, but the account gate still blocks every purchase. */
  private renderAccountGate(): void {
    const headerH = this.headerHeight()
    const signW = Math.max(1, Math.min(340, this.shopW - 76))
    const sign = this.scene.add.container(this.shopX + this.shopW * 0.45, this.shopTopY + headerH * 0.73)
      .setName('merchant-account-sign')
    const g = this.scene.add.graphics()
    g.fillStyle(PAPER_BASE, 1)
    g.fillRoundedRect(-signW / 2, -9, signW, 18, 3)
    g.lineStyle(1, PAPER_EDGE, 1)
    g.strokeRoundedRect(-signW / 2, -9, signW, 18, 3)
    const lockX = -signW / 2 + 10
    g.lineStyle(1.4, WOOD_DARK, 1)
    g.strokeCircle(lockX, -2, 3.5)
    g.fillStyle(ACCENT_GOLD, 1)
    g.fillRoundedRect(lockX - 5, -1, 10, 7, 1.5)
    g.strokeRoundedRect(lockX - 5, -1, 10, 7, 1.5)
    sign.add(g)
    this.addFittedText(sign, 7, 0, 'ACCOUNTS ONLY · SIGN IN FROM HOME', signW - 26, 10)
    this.itemContainer.add(sign)

    const gateTop = this.shopTopY + headerH + 4
    const gateH = Math.max(1, this.shopTopY + this.shopH - 8 - gateTop)
    const blocker = this.scene.add.zone(this.shopX + this.shopW / 2, gateTop + gateH / 2, Math.max(1, this.shopW - 18), gateH)
      .setName('merchant-account-sign-blocker')
      .setInteractive({ useHandCursor: false })
    this.itemContainer.add(blocker)
  }

  private async purchase(id: UpgradeId): Promise<void> {
    if (this.destroyed || !authService.isRegisteredAccount()) return
    const definition = UPGRADE_CATALOG[id]
    const current = this.currentLevels()[id]
    const cost = upgradeCost(id, current)
    if (current >= definition.maxLevel || cost <= 0 || (Number(loadSave().coins) || 0) < cost || this.purchasing.has(id)) return

    this.purchasing.add(id)
    this.purchaseStatus.delete(id)
    this.renderItems()
    const revision = this.lifecycleRevision
    try {
      const result = await authService.purchaseUpgrade(id)
      if (this.destroyed || revision !== this.lifecycleRevision) return
      let error: unknown = null
      if (result && typeof result === 'object' && 'error' in result) error = result.error
      if (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.purchaseStatus.set(id, { kind: 'error', message: message || 'PURCHASE FAILED' })
      } else {
        this.purchaseStatus.set(id, { kind: 'success', message: 'PURCHASED!' })
      }
    } catch (error) {
      if (this.destroyed || revision !== this.lifecycleRevision) return
      const message = error instanceof Error ? error.message : String(error)
      this.purchaseStatus.set(id, { kind: 'error', message: message || 'PURCHASE FAILED' })
    } finally {
      if (!this.destroyed && revision === this.lifecycleRevision) {
        this.purchasing.delete(id)
        this.renderItems()
        this.renderBottomNav()
      }
    }
  }

  private renderBottomNav(): void {
    this.navContainer.removeAll(true)
    const registered = authService.isRegisteredAccount()
    const balance = Number(loadSave().coins) || 0
    const pager = this.paged
    const centerX = this.shopX + this.shopW / 2
    const readoutW = pager ? Math.max(1, this.shopW - 128) : Math.min(236, this.shopW - 20)
    const readout = this.scene.add.container(centerX, this.navY).setName('merchant-coin-balance')
    const g = this.scene.add.graphics()
    // A readout, not a disabled button: the coin balance is never an action.
    g.fillStyle(WOOD_DARK, 1)
    g.fillRoundedRect(-readoutW / 2, -18, readoutW, 36, 9)
    g.lineStyle(1, WOOD_GRAIN, 0.9)
    g.strokeRoundedRect(-readoutW / 2, -18, readoutW, 36, 9)
    if (registered) drawCoin(g, -readoutW / 2 + 17, 0, 10)
    readout.add(g)
    const labelX = registered ? 11 : 0
    this.addFittedText(readout, labelX, pager ? -6 : 0, registered ? `COINS ${formatCoins(balance)}` : 'ACCOUNT SHOP', readoutW - (registered ? 42 : 16), pager ? 13 : 15, '#ffdf7e')
    if (pager) this.addFittedText(readout, labelX, 10, `UPGRADE ${this.currentPage + 1} / ${UPGRADE_IDS.length}`, readoutW - 42, 10, '#d4c29b')
    this.navContainer.add(readout)

    if (pager) {
      for (const direction of [-1, 1] as const) {
        const button = new ChunkyButton({
          scene: this.scene,
          x: direction < 0 ? this.shopX + 27 : this.shopX + this.shopW - 27,
          y: this.navY - 1,
          w: 52,
          h: 36,
          label: direction < 0 ? 'PREV' : 'NEXT',
          fontSize: 11,
          fill: UI_COLORS.BTN_BLUE,
          shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
          highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
          disabled: direction < 0 ? this.currentPage === 0 : this.currentPage === UPGRADE_IDS.length - 1,
          onClick: () => {
            this.currentPage += direction
            this.renderItems()
            this.renderBottomNav()
          },
        })
        button.container.setName(direction < 0 ? 'merchant-prev' : 'merchant-next')
        this.navContainer.add(button.container)
      }
    }
  }
}
