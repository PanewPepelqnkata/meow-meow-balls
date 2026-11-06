import Phaser from 'phaser'
import { ChunkyButton, UI_COLORS } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { authService } from '../../services/auth'
import { UPGRADE_CATALOG, type UpgradeId, type UpgradeLevels, shakeDurationMs, shakeImpulseMultiplier, upgradeCost, wallDurationMs } from '../../config/abilityUpgrades'
import { gameBus } from '../events/gameBus'
import { loadSave } from '../state/save'
import { drawCoin, formatCoins } from './Coin'
import { INK } from './BallAppearance'

const UPGRADE_IDS: readonly UpgradeId[] = ['wallDuration', 'shakeDuration', 'shakeIntensity']

const BAG_CANVAS = 0x8b7355
const BAG_STROKE = 0x5c4a32
const BAG_STITCH = 0xb29461
const BAG_OPENING = 0x4a3828
const DRAWSTRING = 0x3d2b1f
const PARCHMENT = 0xf8f2e1
const PARCHMENT_BORDER = 0xd0c2a5
const PARCHMENT_BASE = 0xe6dac2
const PRIMARY_TEXT = '#2d241e'
const SECONDARY_TEXT = '#8a7a66'
const SHADOW = 0x05070e

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** A roadside merchant's canvas sack, now stocked with account-only ability upgrades. */
type PurchaseStatus = { kind: 'success' | 'error'; message: string }

export class StoreView {
  private readonly storeContainer: Phaser.GameObjects.Container
  private readonly bagGraphics: Phaser.GameObjects.Graphics
  private readonly drawstringGraphics: Phaser.GameObjects.Graphics
  private readonly itemContainer: Phaser.GameObjects.Container
  private readonly navContainer: Phaser.GameObjects.Container
  private readonly scene: Phaser.Scene
  private readonly vw: number
  private readonly vh: number
  private readonly bagX: number
  private readonly bagTopY: number
  private readonly bagW: number
  private readonly bagH: number
  private readonly bagOpeningH: number
  private readonly navY: number
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
    this.vw = vw
    this.vh = vh

    const safe = readSafeArea()
    const left = Math.max(12, safe.left + 8)
    const right = Math.max(12, safe.right + 8)
    const availableW = Math.max(1, vw - left - right)
    this.bagW = Math.floor(Math.min(600, availableW))
    this.bagX = Math.floor(left + (availableW - this.bagW) / 2)
    this.bagTopY = topY + 30
    this.navY = vh - Math.max(36, safe.bottom + 30)
    const availableH = Math.max(1, this.navY - 36 - this.bagTopY)
    this.bagH = Math.floor(Math.min(500, availableH))
    this.bagOpeningH = clamp(this.bagH * 0.16, 32, 76)

    this.storeContainer = scene.add.container(0, 0).setName('merchant-store')
    parentContainer.add(this.storeContainer)
    this.bagGraphics = scene.add.graphics().setName('merchant-bag')
    this.itemContainer = scene.add.container(0, 0).setName('merchant-items')
    this.drawstringGraphics = scene.add.graphics().setName('merchant-drawstring')
    this.navContainer = scene.add.container(0, 0).setName('merchant-nav')
    this.storeContainer.add([this.bagGraphics, this.itemContainer, this.drawstringGraphics, this.navContainer])

    this.storeContainer.once(Phaser.GameObjects.Events.DESTROY, this.release, this)
    this.unsubscribeAuth = authService.onAuthStateChange(() => {
      if (this.destroyed) return
      this.lifecycleRevision++
      this.purchasing.clear()
      this.purchaseStatus.clear()
      this.renderItems()
      this.renderBottomNav()
    })
    this.unsubscribeState = gameBus.on('state:save', () => {
      if (this.destroyed) return
      this.renderItems()
      this.renderBottomNav()
    })

    this.renderBag()
    this.renderItems()
    this.renderDrawstring(this.drawstringGraphics)
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
    // StoreView has no active timers. Kill only tweens that target this view
    // so parent-scene transitions cannot retain its objects.
    this.scene.tweens.killTweensOf(this.storeContainer)
  }

  private renderBag(): void {
    const g = this.bagGraphics
    const { bagX: x, bagTopY: y, bagW: w, bagH: h, bagOpeningH: openingH } = this
    const cx = x + w / 2
    const bodyTop = y + openingH * 0.22
    const bodyH = Math.max(1, h - openingH * 0.22)
    const radius = clamp(Math.min(w, h) * 0.08, 10, 28)

    g.clear()

    // Ground shadow first, so the sack has a physical place to sit.
    g.fillStyle(SHADOW, 0.4)
    g.fillEllipse(cx, y + h + 9, Math.max(30, w * 0.82), Math.max(8, Math.min(28, h * 0.09)))

    // Canvas body and its dark ink edge.
    g.fillStyle(BAG_CANVAS, 1)
    g.fillRoundedRect(x, bodyTop, w, bodyH, radius)
    g.lineStyle(3, BAG_STROKE, 1)
    g.strokeRoundedRect(x, bodyTop, w, bodyH, radius)

    // A quiet canvas seam gives the broad body some woven structure.
    g.lineStyle(1, 0xc0a477, 0.22)
    g.lineBetween(cx, bodyTop + radius, cx, y + h - radius)
    g.lineStyle(1, 0xd0b888, 0.16)
    g.lineBetween(x + w * 0.18, bodyTop + radius, x + w * 0.2, y + h - radius)
    g.lineBetween(x + w * 0.82, bodyTop + radius, x + w * 0.8, y + h - radius)

    // Dark fabric visible through the open mouth of the sack.
    g.fillStyle(BAG_OPENING, 1)
    g.fillEllipse(cx, y + openingH * 0.48, Math.max(20, w - 24), openingH)
    g.lineStyle(2, BAG_STROKE, 1)
    g.strokeEllipse(cx, y + openingH * 0.48, Math.max(20, w - 24), openingH)

    // Stitching around the canvas perimeter, matching the book's dashed trim.
    g.lineStyle(1.2, BAG_STITCH, 0.85)
    const stitch = 10
    for (let sx = x + 18; sx < x + w - 18; sx += stitch) {
      g.lineBetween(sx, bodyTop + 3, Math.min(sx + 5, x + w - 18), bodyTop + 3)
      g.lineBetween(sx, y + h - 4, Math.min(sx + 5, x + w - 18), y + h - 4)
    }
    for (let sy = bodyTop + 20; sy < y + h - 20; sy += stitch) {
      g.lineBetween(x + 3, sy, x + 3, Math.min(sy + 5, y + h - 20))
      g.lineBetween(x + w - 3, sy, x + w - 3, Math.min(sy + 5, y + h - 20))
    }

    this.renderDrawstring(g)
  }

  private renderDrawstring(g: Phaser.GameObjects.Graphics): void {
    const x = this.bagX
    const y = this.bagTopY
    const w = this.bagW
    const cx = x + w / 2
    const openingH = this.bagOpeningH
    g.lineStyle(2, DRAWSTRING, 1)
    this.strokeQuadratic(g, x + 20, y + openingH * 0.14, x + w * 0.25, y + openingH * 0.72, cx, y + openingH * 0.54)
    this.strokeQuadratic(g, x + w - 20, y + openingH * 0.14, x + w * 0.75, y + openingH * 0.72, cx, y + openingH * 0.54)
    g.fillStyle(DRAWSTRING, 1)
    g.fillCircle(cx, y + openingH * 0.54, 3)
    g.lineStyle(2, DRAWSTRING, 1)
    g.lineBetween(cx - 1, y + openingH * 0.56, cx - 9, y + openingH * 0.82)
    g.lineBetween(cx + 1, y + openingH * 0.56, cx + 9, y + openingH * 0.82)
  }

  private strokeQuadratic(
    g: Phaser.GameObjects.Graphics,
    x0: number,
    y0: number,
    controlX: number,
    controlY: number,
    x1: number,
    y1: number,
  ): void {
    g.beginPath()
    g.moveTo(x0, y0)
    for (let i = 1; i <= 8; i++) {
      const t = i / 8
      const mt = 1 - t
      g.lineTo(mt * mt * x0 + 2 * mt * t * controlX + t * t * x1, mt * mt * y0 + 2 * mt * t * controlY + t * t * y1)
    }
    g.strokePath()
  }

  private renderItems(): void {
    if (this.destroyed) return
    this.itemContainer.removeAll(true)

    const portrait = this.vw <= this.vh
    const cols = portrait ? 2 : 3
    const rows = Math.ceil(UPGRADE_IDS.length / cols)
    const inset = clamp(this.bagW * 0.065, 10, 30)
    const gap = clamp(Math.min(this.bagW, this.bagH) * 0.025, 5, 12)
    const gridTop = this.bagTopY - Math.min(18, this.bagOpeningH * 0.32)
    const gridBottom = this.bagTopY + this.bagH - Math.max(24, this.bagH * 0.1)
    const gridW = Math.max(1, this.bagW - inset * 2)
    const gridH = Math.max(1, gridBottom - gridTop)
    const cardW = Math.max(1, (gridW - gap * (cols - 1)) / cols)
    const cardH = Math.max(1, (gridH - gap * (rows - 1)) / rows)

    UPGRADE_IDS.forEach((id, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = this.bagX + inset + col * (cardW + gap)
      const y = gridTop + row * (cardH + gap) + (row === 0 && index % 2 === 1 ? Math.min(8, cardH * 0.08) : 0)
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
    const card = this.scene.add.container(x + w / 2, y + h / 2).setName(`merchant-upgrade-${id}`)
    card.setAngle(index % 2 === 0 ? -0.018 : 0.022)
    this.itemContainer.add(card)

    const g = this.scene.add.graphics().setName('merchant-upgrade-card')
    const radius = clamp(Math.min(w, h) * 0.1, 4, 8)
    const left = -w / 2
    const top = -h / 2
    g.fillStyle(PARCHMENT_BASE, 1)
    g.fillRoundedRect(left + 2, top + 3, w, h, radius)
    g.fillStyle(PARCHMENT, 0.98)
    g.fillRoundedRect(left, top, w, h, radius)
    g.lineStyle(1, PARCHMENT_BORDER, 1)
    g.strokeRoundedRect(left, top, w, h, radius)
    g.lineStyle(0.75, INK, 0.12)
    g.strokeRoundedRect(left + 1, top + 1, Math.max(1, w - 2), Math.max(1, h - 2), Math.max(2, radius - 1))
    g.lineStyle(1, 0xffffff, 0.32)
    g.strokeRoundedRect(left + 2, top + 2, Math.max(1, w - 4), Math.max(1, h - 4), Math.max(2, radius - 2))
    card.add(g)

    const title = id === 'shakeIntensity' ? 'SHAKE POWER' : definition.label.toUpperCase()
    this.addFittedText(card, 0, top + clamp(h * 0.12, 12, 18), title, Math.max(1, w - 12), 12)
    this.addFittedText(card, 0, top + clamp(h * 0.25, 25, 35), definition.description, Math.max(1, w - 14), 8, SECONDARY_TEXT)
    const value = `${this.effectValue(id, current)} → ${this.effectValue(id, next)} / ${this.effectValue(id, definition.maxLevel)}`
    this.addFittedText(card, 0, top + h * 0.44, value, Math.max(1, w - 12), 10, PRIMARY_TEXT)
    this.addFittedText(card, 0, top + h * 0.56, `LEVEL ${current}/${definition.maxLevel}`, Math.max(1, w - 12), 10, SECONDARY_TEXT)

    this.renderPriceTag(card, w, h, cost, maxed)

    const buttonH = clamp(h * 0.19, 26, 34)
    const buttonLabel = pending ? 'PENDING...' : maxed ? 'MAX LEVEL' : !registered ? 'ACCOUNT ONLY' : insufficient ? 'NEED COINS' : `BUY ${cost}`
    const button = new ChunkyButton({
      scene: this.scene,
      x: 0,
      y: top + h * 0.78,
      w: Math.max(52, w - 18),
      h: buttonH,
      label: buttonLabel,
      fontSize: 10,
      textColor: UI_COLORS.TEXT_DARK,
      fill: UI_COLORS.BTN_GOLD,
      shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
      highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
      pill: true,
      disabled,
      onClick: () => {
        void this.purchase(id)
      },
    })
    card.add(button.container)

    const status = this.purchaseStatus.get(id)
    if (status) {
      this.addFittedText(card, 0, top + h * 0.66, status.message, Math.max(1, w - 12), 9, status.kind === 'success' ? '#397a3b' : '#b53b2e')
    }
  }

  private renderPriceTag(card: Phaser.GameObjects.Container, w: number, h: number, cost: number, maxed: boolean): void {
    const tagW = clamp(w * 0.34, 38, 66)
    const tagH = clamp(h * 0.16, 18, 26)
    const tag = this.scene.add.container(w / 2 - tagW / 2 - 7, -h / 2 + tagH / 2 + 8).setName('merchant-price-tag')
    const tagG = this.scene.add.graphics()
    tagG.fillStyle(PARCHMENT, 1)
    tagG.fillRoundedRect(-tagW / 2, -tagH / 2, tagW, tagH, 3)
    tagG.lineStyle(1, PARCHMENT_BORDER, 1)
    tagG.strokeRoundedRect(-tagW / 2, -tagH / 2, tagW, tagH, 3)
    tagG.fillStyle(0x8a7a66, 0.7)
    tagG.fillCircle(-tagW / 2 + 5, -tagH / 2 + 5, 1.3)
    if (!maxed) drawCoin(tagG, -tagW * 0.24, 0, Math.max(3, tagH * 0.22))
    tag.add(tagG)
    const price = hudText(this.scene, maxed ? 0 : tagW * 0.12, 0, maxed ? 'MAX' : `${cost}`, 1, {
      color: maxed ? SECONDARY_TEXT : '#7a5411',
      size: 9,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    }).setStroke('#000000', 0)
    price.setScale(Math.min(1, Math.max(0.1, (tagW - 8) / Math.max(1, price.width))))
    tag.add(price)
    card.add(tag)
  }

  private renderAccountGate(): void {
    const signW = Math.max(1, this.bagW - 18)
    const shopTop = this.bagTopY - Math.min(20, this.bagOpeningH * 0.4)
    const shopBottom = this.bagTopY + this.bagH
    const signH = Math.max(1, shopBottom - shopTop)
    const sign = this.scene.add.container(this.bagX + this.bagW / 2, shopTop + signH / 2).setName('merchant-account-sign')
    sign.setAngle(-0.018)
    const g = this.scene.add.graphics()
    const halfW = signW / 2
    const halfH = signH / 2
    g.fillStyle(PARCHMENT_BASE, 1)
    g.beginPath()
    g.moveTo(-halfW + 4, -halfH)
    g.lineTo(halfW - 3, -halfH + 2)
    g.lineTo(halfW, halfH - 4)
    g.lineTo(-halfW + 2, halfH)
    g.closePath()
    g.fillPath()
    g.lineStyle(2, BAG_STROKE, 1)
    g.strokePath()
    g.lineStyle(1, PARCHMENT_BORDER, 1)
    g.strokeRect(-halfW + 7, -halfH + 7, Math.max(1, signW - 14), Math.max(1, signH - 14))
    sign.add(g)
    const label = hudText(this.scene, 0, 0, 'ONLY FOR PLAYERS WITH ACCOUNTS', 1, {
      color: PRIMARY_TEXT,
      size: 22,
      stroke: 1.5,
      origin: [0.5, 0.5],
      shadow: false,
    })
    label.setScale(Math.min(1, Math.max(0.1, (signW - 28) / Math.max(1, label.width))))
    sign.add(label)
    this.itemContainer.add(sign)
    const blocker = this.scene.add.zone(this.bagX + this.bagW / 2, shopTop + signH / 2, signW, signH)
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
    const statusW = clamp(this.bagW * 0.42, 150, 240)
    const balance = Number(loadSave().coins) || 0
    const status = new ChunkyButton({
      scene: this.scene,
      x: this.vw / 2,
      y: this.navY,
      w: statusW,
      h: 38,
      label: registered ? `COINS ${formatCoins(balance)}` : 'ACCOUNT SHOP',
      icon: registered ? (g, cx, cy, size) => drawCoin(g, cx, cy, Math.max(4, size * 0.42)) : undefined,
      iconSize: 18,
      fontSize: 12,
      textColor: UI_COLORS.TEXT_GOLD,
      fill: UI_COLORS.BTN_GRAY,
      shadowColor: UI_COLORS.BTN_GRAY_SHADOW,
      highlightColor: UI_COLORS.BTN_GRAY_HIGHLIGHT,
      pill: true,
      disabled: true,
    })
    status.container.setName('merchant-coin-balance')
    this.navContainer.add(status.container)
  }
}
