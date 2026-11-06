import Phaser from 'phaser'
import { ChunkyButton } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { authService } from '../../services/auth'
import {
  UPGRADE_CATALOG,
  normalizeUpgradeLevels,
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

const INK = 0x111625
const INK_HEX = '#111625'
const WOOD = 0x82441d
const WOOD_LIGHT = 0xb0652a
const WOOD_DARK = 0x4e230f
const WOOD_GRAIN = 0xd9934e
const CANOPY_RED = 0xbe2b2b
const CANOPY_CREAM = 0xf6ede0
const PAPER = 0xfff9ec
const PAPER_BASE = 0xf3e5c8
const PAPER_EDGE = 0xcab58e
const GREEN = 0x3ca72b
const GREEN_DARK = 0x27741b
const GREEN_LIGHT = 0x62cb49
const GOLD = 0xffce42
const SECONDARY_TEXT = '#806447'

const PRODUCTS = [
  { id: 'wallDuration', accent: 0x428fd7 },
  { id: 'shakeDuration', accent: 0xe85d47 },
  { id: 'shakeIntensity', accent: 0xf4c339 },
  { id: 'coinMagnet', name: 'Coin Magnet', benefit: 'BRING THE TREASURE CLOSER', accent: 0xdc4d43 },
  { id: 'mergeBonus', name: 'Merge Bonus', benefit: 'MAKE EVERY MERGE COUNT', accent: 0x5baf45 },
  { id: 'extraAbility', name: 'Extra Ability', benefit: 'A LITTLE EXTRA POWER', accent: 0x9a62ce },
] as const

type Product = (typeof PRODUCTS)[number]
type ProductId = Product['id']
type PurchaseStatus = { kind: 'success' | 'error'; message: string }
type BuyButton = { zone: Phaser.GameObjects.Zone; page: number; available: boolean }
type Drag = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastAt: number
  originX: number
  velocity: number
  dragging: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isUpgrade(product: Product): product is Extract<Product, { id: UpgradeId }> {
  return product.id in UPGRADE_CATALOG
}

/** The stall stays still; only the masked, two-row product pages move. */
export class StoreView {
  private readonly scene: Phaser.Scene
  private readonly storeContainer: Phaser.GameObjects.Container
  private readonly shopGraphics: Phaser.GameObjects.Graphics
  private readonly shopChrome: Phaser.GameObjects.Container
  private readonly itemContainer: Phaser.GameObjects.Container
  private readonly itemPageContainer: Phaser.GameObjects.Container
  private readonly navContainer: Phaser.GameObjects.Container
  private readonly maskGraphics: Phaser.GameObjects.Graphics
  private maskFilter: Phaser.Filters.Mask | null = null
  private readonly pointerPoint = new Phaser.Math.Vector2()
  private readonly shopX: number
  private readonly shopTopY: number
  private readonly shopW: number
  private readonly shopH: number
  private readonly headerH: number
  private readonly footerH: number
  private readonly postW: number
  private readonly gridX: number
  private readonly gridY: number
  private readonly gridW: number
  private readonly gridH: number
  private readonly gap: number
  private readonly columns: number
  private readonly pageSize: number
  private readonly pageCount: number
  private readonly pageStride: number
  private readonly reducedMotion: boolean
  private readonly purchasing = new Set<UpgradeId>()
  private readonly purchaseStatus = new Map<UpgradeId, PurchaseStatus>()
  private readonly buyButtons: BuyButton[] = []
  private currentPage = 0
  private pageTween: Phaser.Tweens.Tween | null = null
  private drag: Drag | null = null
  private suppressPurchaseUntil = 0
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
    this.reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const safe = readSafeArea()
    const left = Math.max(10, safe.left + 8)
    const right = Math.max(10, safe.right + 8)
    const availableW = Math.max(1, vw - left - right)
    const availableH = Math.max(1, vh - Math.max(18, safe.bottom + 14) - topY - 8)
    this.shopW = Math.floor(Math.min(1120, availableW))
    this.shopH = Math.floor(Math.min(790, availableH))
    this.shopX = Math.floor(left + (availableW - this.shopW) / 2)
    this.shopTopY = Math.floor(topY + 8 + (availableH - this.shopH) / 2)
    this.headerH = clamp(this.shopH * 0.21, 64, vw >= 700 ? 150 : 126)
    this.footerH = clamp(this.shopH * 0.13, 48, 88)
    this.postW = clamp(this.shopW * 0.042, 20, 43)
    const inset = this.postW + clamp(this.shopW * 0.022, 14, 26)
    this.gap = clamp(Math.min(this.shopW, this.shopH) * 0.022, 8, 15)
    this.gridX = this.shopX + inset
    this.gridY = this.shopTopY + this.headerH + 8
    this.gridW = Math.max(1, this.shopW - inset * 2)
    this.gridH = Math.max(1, this.shopH - this.headerH - this.footerH - 18)
    this.columns = vw >= 700 ? 3 : this.gridW >= 270 && this.gridH >= 400 ? 2 : 1
    this.pageSize = this.columns * 2
    this.pageCount = Math.ceil(PRODUCTS.length / this.pageSize)
    this.pageStride = this.gridW + this.gap * 2

    this.storeContainer = scene.add.container(0, 0).setName('merchant-store')
    parentContainer.add(this.storeContainer)
    this.shopGraphics = scene.add.graphics().setName('merchant-stall')
    this.shopChrome = scene.add.container(0, 0).setName('merchant-stall-sign')
    this.itemContainer = scene.add.container(this.gridX, this.gridY).setName('merchant-items')
    this.itemPageContainer = scene.add.container(0, 0).setName('merchant-item-pages')
    this.itemContainer.add(this.itemPageContainer)
    this.navContainer = scene.add.container(0, 0).setName('merchant-nav')
    this.storeContainer.add([this.shopGraphics, this.shopChrome, this.itemContainer, this.navContainer])

    // Phaser 4 uses a Mask filter in WebGL; GeometryMask remains the Canvas path.
    // Mask the stationary viewport, not the translating page container.
    this.maskGraphics = scene.add.graphics().setName('merchant-item-mask')
    this.maskGraphics.fillStyle(0xffffff).fillRect(this.gridX - 2, this.gridY - 5, this.gridW + 4, this.gridH + 12)
    if (scene.game.renderer.type === Phaser.WEBGL) {
      this.itemContainer.enableFilters()
      this.maskFilter = this.itemContainer.filters!.external.addMask(this.maskGraphics, false, scene.cameras.main, 'world')
      this.maskFilter.autoUpdate = false
    } else {
      this.itemContainer.setMask(new Phaser.Display.Masks.GeometryMask(scene, this.maskGraphics))
    }
    this.maskGraphics.setVisible(false)

    this.storeContainer.once(Phaser.GameObjects.Events.DESTROY, this.release, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    scene.input.on('pointerdown', this.beginDrag, this)
    scene.input.on('pointermove', this.moveDrag, this)
    scene.input.on('pointerup', this.finishDrag, this)
    scene.input.on('pointerupoutside', this.finishDrag, this)
    scene.input.on('gameout', this.cancelDrag, this)
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
    this.drag = null
    this.purchasing.clear()
    this.buyButtons.length = 0
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
    this.unsubscribeState?.()
    this.unsubscribeState = null
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    this.scene.input.off('pointerdown', this.beginDrag, this)
    this.scene.input.off('pointermove', this.moveDrag, this)
    this.scene.input.off('pointerup', this.finishDrag, this)
    this.scene.input.off('pointerupoutside', this.finishDrag, this)
    this.scene.input.off('gameout', this.cancelDrag, this)
    this.scene.tweens.killTweensOf(this.itemPageContainer)
    this.pageTween = null
    if (this.maskFilter) {
      this.itemContainer.filters?.external.remove(this.maskFilter, true)
      this.maskFilter = null
    } else {
      this.itemContainer.clearMask(true)
    }
    this.maskGraphics.destroy()
  }

  private renderShop(): void {
    const g = this.shopGraphics
    const { shopX: x, shopTopY: y, shopW: w, shopH: h, postW, headerH } = this
    const cx = x + w / 2
    const bottom = y + h
    g.fillStyle(INK, 0.25).fillEllipse(cx, bottom + 4, w * 0.97, 24)

    // A dark, planked recess lets the cream cards read as separate pinned goods.
    g.fillStyle(WOOD_DARK).fillRoundedRect(x + 10, y + headerH * 0.52, w - 20, h - headerH * 0.52, 9)
    g.lineStyle(4, INK).strokeRoundedRect(x + 10, y + headerH * 0.52, w - 20, h - headerH * 0.52, 9)
    const plankW = (w - 28) / 10
    for (let i = 0; i < 10; i++) {
      const px = x + 14 + i * plankW
      g.fillStyle(i % 2 ? WOOD : 0x914d25).fillRect(px, y + headerH * 0.56, plankW - 2, h - headerH * 0.56 - 9)
      g.lineStyle(1, WOOD_GRAIN, 0.24)
      g.lineBetween(px + 6, y + headerH, px + 8, bottom - 18)
      g.lineBetween(px + plankW - 8, y + headerH + 32, px + plankW - 11, bottom - 38)
    }
    g.fillStyle(INK, 0.18).fillRect(this.gridX - 8, this.gridY - 8, this.gridW + 16, this.gridH + 21)

    // Inked support pillars, cross-braces and the front counter rail.
    for (const px of [x + 7, x + w - postW - 7]) {
      this.drawWoodPanel(g, px, y + headerH * 0.3, postW, h - headerH * 0.3, 5)
      g.lineStyle(2, WOOD_GRAIN, 0.6)
      g.lineBetween(px + 6, y + headerH * 0.5, px + 7, bottom - 12)
      g.lineStyle(1.2, WOOD_DARK, 0.8)
      g.strokeEllipse(px + postW * 0.55, bottom - this.footerH * 0.75, postW * 0.32, 14)
    }
    g.lineStyle(13, INK).lineBetween(x + 18, y + headerH + 30, x + 78, y + headerH - 25)
    g.lineBetween(x + w - 18, y + headerH + 30, x + w - 78, y + headerH - 25)
    g.lineStyle(8, WOOD_LIGHT).lineBetween(x + 18, y + headerH + 30, x + 78, y + headerH - 25)
    g.lineBetween(x + w - 18, y + headerH + 30, x + w - 78, y + headerH - 25)
    this.drawWoodPanel(g, x + 4, bottom - this.footerH + 20, w - 8, 22, 6)
    g.lineStyle(2, WOOD_GRAIN, 0.6).lineBetween(x + 15, bottom - this.footerH + 25, x + w - 15, bottom - this.footerH + 25)

    this.drawCanopy(g)
    this.drawStoreSign(g)
    const pillarCenters = [x + 7 + postW / 2, x + w - 7 - postW / 2]
    const lanternW = clamp(w * 0.045, 21, 43)
    for (const px of pillarCenters) {
      this.drawLantern(g, px, y + headerH + 11, lanternW)
      this.drawBanner(g, px, y + headerH + lanternW + 25, postW * 0.92, clamp(h * 0.21, 48, 124))
    }
    this.drawBottomProps(g)
  }

  private drawWoodPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number): void {
    g.fillStyle(WOOD_DARK).fillRoundedRect(x + 1, y + 4, w, h, r)
    g.fillStyle(WOOD).fillRoundedRect(x, y, w, h, r)
    g.fillStyle(WOOD_LIGHT).fillRoundedRect(x + 3, y + 2, Math.max(1, w - 6), Math.max(1, h * 0.36), Math.min(r, 3))
    g.lineStyle(3, INK).strokeRoundedRect(x, y, w, h, r)
    g.lineStyle(1, WOOD_GRAIN, 0.65).lineBetween(x + 6, y + 5, x + w - 6, y + 5)
  }

  private drawCanopy(g: Phaser.GameObjects.Graphics): void {
    const { shopX: x, shopTopY: y, shopW: w, headerH } = this
    const roofTop = y + 4
    const roofBottom = y + headerH * 0.61
    const topInset = clamp(w * 0.045, 15, 42)
    const stripeCount = Math.max(8, Math.min(18, Math.round(w / 62) * 2))
    const topStripe = (w - topInset * 2) / stripeCount
    const stripeW = w / stripeCount
    const valanceH = clamp(headerH * 0.19, 12, 27)
    g.lineStyle(12, INK).lineBetween(x + topInset, roofTop, x, roofBottom + 6)
    g.lineBetween(x + w - topInset, roofTop, x + w, roofBottom + 6)
    g.lineStyle(7, WOOD_LIGHT).lineBetween(x + topInset, roofTop, x, roofBottom + 6)
    g.lineBetween(x + w - topInset, roofTop, x + w, roofBottom + 6)
    for (let i = 0; i < stripeCount; i++) {
      const topX = x + topInset + i * topStripe
      const bottomX = x + i * stripeW
      const color = i % 2 === 0 ? CANOPY_RED : CANOPY_CREAM
      g.fillStyle(color)
      g.beginPath()
      g.moveTo(topX, roofTop)
      g.lineTo(topX + topStripe + 0.5, roofTop)
      g.lineTo(bottomX + stripeW + 0.5, roofBottom)
      g.lineTo(bottomX, roofBottom)
      g.closePath().fillPath()
      g.lineStyle(1, INK, 0.27).lineBetween(topX, roofTop + 4, bottomX, roofBottom)
      g.fillStyle(color).fillRoundedRect(bottomX, roofBottom - 1, stripeW, valanceH, { tl: 0, tr: 0, bl: stripeW * 0.28, br: stripeW * 0.28 })
      g.lineStyle(2, INK).strokeRoundedRect(bottomX, roofBottom - 1, stripeW, valanceH, { tl: 0, tr: 0, bl: stripeW * 0.28, br: stripeW * 0.28 })
      g.lineStyle(2, i % 2 ? 0xffffff : 0xe96950, 0.55)
      g.lineBetween(topX + topStripe * 0.45, roofTop + 8, bottomX + stripeW * 0.45, roofBottom - 5)
      g.fillStyle(i % 2 ? 0xcbbc9d : 0x7e2426, 0.2).fillRect(bottomX + 2, roofBottom, stripeW - 4, 4)
    }
    this.drawWoodPanel(g, x + topInset - 7, y - 2, w - topInset * 2 + 14, 13, 4)
    g.lineStyle(3, INK).lineBetween(x, roofBottom, x + topInset, roofTop)
    g.lineBetween(x + w, roofBottom, x + w - topInset, roofTop)
  }

  private drawStoreSign(g: Phaser.GameObjects.Graphics): void {
    const cx = this.shopX + this.shopW / 2
    const signW = clamp(this.shopW * 0.44, 170, 430)
    const signH = clamp(this.headerH * 0.53, 36, 78)
    const cy = this.shopTopY + this.headerH * 0.39
    const left = cx - signW / 2
    const top = cy - signH / 2
    g.fillStyle(INK, 0.3).fillRoundedRect(left + 3, top + 7, signW, signH, 10)
    this.drawWoodPanel(g, left, top, signW, signH, 9)
    g.lineStyle(1.5, GOLD, 0.65).strokeRoundedRect(left + 5, top + 5, signW - 10, signH - 10, 5)
    g.lineStyle(1.2, WOOD_DARK, 0.7)
    g.lineBetween(left + 7, cy, left + signW - 7, cy)
    g.lineBetween(left + 12, top + signH - 12, left + signW - 14, top + signH - 12)
    for (const bx of [left + 9, left + signW - 9]) {
      g.fillStyle(GOLD).fillCircle(bx, cy, 2.5)
      g.lineStyle(1, INK).strokeCircle(bx, cy, 2.5)
    }
    const shieldX = left + signH * 0.51
    const r = signH * 0.4
    this.drawShield(g, shieldX, cy - 1, r, GOLD, 0x9b5b14)
    this.drawShield(g, shieldX, cy - 2, r * 0.73, WOOD_DARK, WOOD_DARK)
    // A bright shopping cart is deliberately drawn, not a font-dependent glyph.
    g.lineStyle(Math.max(2, r * 0.095), GOLD)
    g.beginPath()
    g.moveTo(shieldX - r * 0.47, cy - r * 0.35)
    g.lineTo(shieldX - r * 0.3, cy - r * 0.35)
    g.lineTo(shieldX - r * 0.14, cy + r * 0.19)
    g.lineTo(shieldX + r * 0.37, cy + r * 0.19)
    g.strokePath()
    g.strokeTriangle(shieldX - r * 0.24, cy - r * 0.23, shieldX + r * 0.48, cy - r * 0.23, shieldX + r * 0.28, cy + r * 0.08)
    g.fillStyle(GOLD).fillCircle(shieldX - r * 0.05, cy + r * 0.36, r * 0.09)
    g.fillCircle(shieldX + r * 0.3, cy + r * 0.36, r * 0.09)
    const titleLeft = left + signH * 1.03
    this.addFittedText(this.shopChrome, (titleLeft + left + signW - 12) / 2, cy - 2, 'STORE', signW - signH * 1.03 - 17, signH * 0.66, '#fff5d7')
      .setStroke(INK_HEX, Math.max(2, signH * 0.035)).setShadow(0, 3, '#4e230f', 0, false, true)
    const ribbonY = this.shopTopY + this.headerH * 0.86
    const ribbonH = clamp(this.headerH * 0.17, 14, 23)
    const ribbonW = signW * 1.04
    g.fillStyle(WOOD_DARK)
    g.fillTriangle(cx - ribbonW / 2 - 10, ribbonY - ribbonH / 2 - 2, cx - ribbonW / 2 + 9, ribbonY, cx - ribbonW / 2 - 10, ribbonY + ribbonH / 2 + 3)
    g.fillTriangle(cx + ribbonW / 2 + 10, ribbonY - ribbonH / 2 - 2, cx + ribbonW / 2 - 9, ribbonY, cx + ribbonW / 2 + 10, ribbonY + ribbonH / 2 + 3)
    this.drawWoodPanel(g, cx - ribbonW / 2, ribbonY - ribbonH / 2, ribbonW, ribbonH, 3)
    this.addFittedText(this.shopChrome, cx, ribbonY, 'UPGRADES • BOOSTS • ITEMS', ribbonW - 14, clamp(this.headerH * 0.09, 9, 13), '#ffdf85')
  }

  private drawShield(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, shade: number): void {
    g.fillStyle(fill)
    g.beginPath()
    g.moveTo(x, y - r)
    g.lineTo(x + r * 0.85, y - r * 0.61)
    g.lineTo(x + r * 0.68, y + r * 0.45)
    g.lineTo(x, y + r)
    g.lineTo(x - r * 0.68, y + r * 0.45)
    g.lineTo(x - r * 0.85, y - r * 0.61)
    g.closePath().fillPath()
    g.lineStyle(Math.max(1.5, r * 0.09), INK).strokePath()
    g.fillStyle(shade, 0.3).fillTriangle(x, y - r * 0.78, x + r * 0.66, y - r * 0.5, x, y + r * 0.78)
  }

  private drawLantern(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number): void {
    for (let i = 3; i > 0; i--) g.fillStyle(0xffc34d, 0.035).fillCircle(x, y + 4, w * (0.9 + i * 0.25))
    g.lineStyle(3, INK).lineBetween(x, y - w * 1.2, x, y - w * 0.5)
    g.lineBetween(x - w * 0.3, y - w * 1.2, x + w * 0.15, y - w * 1.2)
    g.lineStyle(1.5, 0x777474)
    for (let i = 0; i < 3; i++) g.strokeEllipse(x, y - w * (1.1 - i * 0.19), w * 0.14, w * 0.22)
    g.fillStyle(0xf0aa31).fillRoundedRect(x - w * 0.35, y - w * 0.4, w * 0.7, w * 0.95, 4)
    g.lineStyle(3, INK).strokeRoundedRect(x - w * 0.35, y - w * 0.4, w * 0.7, w * 0.95, 4)
    g.fillStyle(0xffe59a).fillRoundedRect(x - w * 0.22, y - w * 0.28, w * 0.44, w * 0.65, 2)
    g.fillStyle(0xfff3c2).fillTriangle(x - w * 0.13, y + w * 0.26, x + w * 0.12, y + w * 0.26, x + w * 0.04, y - w * 0.14)
    g.fillStyle(0x34393d).fillTriangle(x - w * 0.48, y - w * 0.39, x + w * 0.48, y - w * 0.39, x, y - w * 0.72)
    g.lineStyle(2, INK).strokeTriangle(x - w * 0.48, y - w * 0.39, x + w * 0.48, y - w * 0.39, x, y - w * 0.72)
    g.fillStyle(0x34393d).fillRoundedRect(x - w * 0.43, y + w * 0.46, w * 0.86, w * 0.15, 2)
    g.lineStyle(2, INK).lineBetween(x, y - w * 0.35, x, y + w * 0.48)
    g.lineBetween(x - w * 0.34, y + w * 0.18, x + w * 0.34, y + w * 0.18)
  }

  private drawBanner(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(CANOPY_RED)
    g.beginPath()
    g.moveTo(x - w / 2, y)
    g.lineTo(x + w / 2, y)
    g.lineTo(x + w / 2, y + h)
    g.lineTo(x, y + h - w * 0.42)
    g.lineTo(x - w / 2, y + h)
    g.closePath().fillPath()
    g.lineStyle(2, INK).strokePath()
    g.lineStyle(1, 0xee9861, 0.8)
    g.lineBetween(x - w / 2 + 3, y + 7, x - w / 2 + 3, y + h - 7)
    g.lineBetween(x + w / 2 - 3, y + 7, x + w / 2 - 3, y + h - 7)
    g.lineStyle(4, INK).lineBetween(x - w * 0.65, y, x + w * 0.65, y)
    g.lineStyle(2, GOLD).lineBetween(x - w * 0.65, y - 1, x + w * 0.65, y - 1)
    const r = w * 0.29
    const cy = y + Math.min(h * 0.37, w * 1.1)
    g.fillStyle(GOLD).fillCircle(x, cy, r)
    g.lineStyle(1.3, INK).strokeCircle(x, cy, r)
    g.fillStyle(INK).fillCircle(x - r * 0.32, cy - r * 0.13, Math.max(0.8, r * 0.1))
    g.fillCircle(x + r * 0.32, cy - r * 0.13, Math.max(0.8, r * 0.1))
    g.beginPath().arc(x, cy + r * 0.1, r * 0.4, 0.15, Math.PI - 0.15, false).strokePath()
  }

  private drawBottomProps(g: Phaser.GameObjects.Graphics): void {
    const { shopX: x, shopW: w } = this
    const bottom = this.shopTopY + this.shopH
    const scale = clamp(this.footerH / 82, 0.56, 1)
    this.drawBarrel(g, x + 30 * scale + 4, bottom + 1, 44 * scale, 62 * scale)
    this.drawBarrel(g, x + 67 * scale + 4, bottom + 2, 36 * scale, 46 * scale)
    for (let i = 0; i < 7; i++) {
      const coinX = x + (17 + (i % 4) * 10) * scale
      const coinY = bottom - (64 + Math.floor(i / 4) * 7) * scale
      drawCoin(g, coinX, coinY, 6 * scale)
    }
    drawCoin(g, x + 68 * scale, bottom - 6, 8 * scale)
    drawCoin(g, x + 86 * scale, bottom - 5, 7 * scale)
    const crateX = x + w - 76 * scale - 5
    const crateY = bottom - 39 * scale
    const crateW = 67 * scale
    const crateH = 39 * scale
    this.drawWoodPanel(g, crateX, crateY, crateW, crateH, 4)
    g.lineStyle(2, WOOD_DARK)
    g.lineBetween(crateX + crateW / 3, crateY + 3, crateX + crateW / 3, bottom - 1)
    g.lineBetween(crateX + crateW * 2 / 3, crateY + 3, crateX + crateW * 2 / 3, bottom - 1)
    g.lineStyle(6 * scale, INK).lineBetween(crateX + 5, bottom - 5, crateX + crateW - 5, crateY + 5)
    g.lineStyle(3 * scale, WOOD_GRAIN).lineBetween(crateX + 5, bottom - 5, crateX + crateW - 5, crateY + 5)
    g.fillStyle(GOLD).fillRoundedRect(crateX - 1, crateY + 2, crateW + 2, 6 * scale, 2)
    g.lineStyle(1.5, INK).strokeRoundedRect(crateX - 1, crateY + 2, crateW + 2, 6 * scale, 2)
    for (let i = 0; i < 5; i++) this.drawGem(g, crateX + (10 + i * 12) * scale, crateY - (i % 2 ? 11 : 5) * scale, (i % 2 ? 15 : 12) * scale)
    this.drawGem(g, crateX - 7 * scale, bottom - 5, 12 * scale)
    for (const gx of [x + 3, x + w - 5, x + 98 * scale, x + w - 95 * scale]) {
      g.fillStyle(0x397c33)
      g.fillTriangle(gx - 9 * scale, bottom + 5, gx - 8 * scale, bottom - 13 * scale, gx + 4 * scale, bottom + 4)
      g.fillTriangle(gx - 2 * scale, bottom + 5, gx + 7 * scale, bottom - 19 * scale, gx + 9 * scale, bottom + 5)
      g.lineStyle(1.2, INK).lineBetween(gx - 9 * scale, bottom + 5, gx - 8 * scale, bottom - 13 * scale)
      g.lineBetween(gx + 9 * scale, bottom + 5, gx + 7 * scale, bottom - 19 * scale)
      g.lineStyle(1, 0x86b54d).lineBetween(gx, bottom + 3, gx + 5 * scale, bottom - 10 * scale)
    }
  }

  private drawBarrel(g: Phaser.GameObjects.Graphics, x: number, bottom: number, w: number, h: number): void {
    const top = bottom - h
    g.fillStyle(WOOD_LIGHT).fillRoundedRect(x - w / 2, top + 5, w, h - 5, { tl: 10, tr: 10, bl: 9, br: 9 })
    g.lineStyle(3, INK).strokeRoundedRect(x - w / 2, top + 5, w, h - 5, { tl: 10, tr: 10, bl: 9, br: 9 })
    g.lineStyle(1.5, WOOD_DARK)
    for (const p of [-0.25, 0, 0.25]) g.lineBetween(x + w * p, top + 10, x + w * p * 0.85, bottom - 3)
    g.fillStyle(WOOD_DARK).fillEllipse(x, top + 7, w - 2, 14)
    g.lineStyle(2, INK).strokeEllipse(x, top + 7, w - 2, 14)
    g.lineStyle(2, WOOD_GRAIN).strokeEllipse(x, top + 6, w - 8, 9)
    for (const bandY of [top + h * 0.3, top + h * 0.77]) {
      g.fillStyle(0x6c7778).fillRoundedRect(x - w / 2 - 1, bandY, w + 2, 7, 2)
      g.lineStyle(1.5, INK).strokeRoundedRect(x - w / 2 - 1, bandY, w + 2, 7, 2)
      g.lineStyle(1, 0xbfc3b4).lineBetween(x - w / 2 + 3, bandY + 2, x + w / 2 - 3, bandY + 2)
    }
  }

  private drawGem(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    g.fillStyle(0xa45be2)
    g.beginPath()
    g.moveTo(x - r * 0.7, y - r * 0.23)
    g.lineTo(x - r * 0.33, y - r * 0.65)
    g.lineTo(x + r * 0.35, y - r * 0.65)
    g.lineTo(x + r * 0.7, y - r * 0.23)
    g.lineTo(x, y + r * 0.65)
    g.closePath().fillPath()
    g.lineStyle(Math.max(1, r * 0.12), INK).strokePath()
    g.fillStyle(0xdfb4ff).fillTriangle(x - r * 0.33, y - r * 0.6, x + r * 0.35, y - r * 0.6, x, y - r * 0.14)
    g.fillStyle(0x66319b).fillTriangle(x, y - r * 0.14, x + r * 0.65, y - r * 0.2, x, y + r * 0.6)
    g.lineStyle(1, 0xf1d5ff, 0.8).lineBetween(x - r * 0.5, y - r * 0.19, x, y + r * 0.46)
  }

  private renderItems(): void {
    this.buyButtons.length = 0
    this.itemPageContainer.removeAll(true)
    const save = loadSave()
    const levels = normalizeUpgradeLevels(save.upgrades)
    const balance = Number(save.coins) || 0
    const registered = authService.isRegisteredAccount()
    const cardW = (this.gridW - this.gap * (this.columns - 1)) / this.columns
    const cardH = (this.gridH - this.gap) / 2
    PRODUCTS.forEach((product, index) => {
      const page = Math.floor(index / this.pageSize)
      const slot = index % this.pageSize
      const col = slot % this.columns
      const row = Math.floor(slot / this.columns)
      const x = page * this.pageStride + col * (cardW + this.gap)
      const y = row * (cardH + this.gap)
      this.renderProductCard(x, y, cardW, cardH, product, page, levels, balance, registered)
    })
    this.updateBuyButtons()
  }

  private renderProductCard(
    x: number, y: number, w: number, h: number, product: Product, page: number,
    levels: UpgradeLevels, balance: number, registered: boolean,
  ): void {
    const card = this.scene.add.container(x + w / 2, y + h / 2).setName(`merchant-upgrade-${product.id}`)
    this.itemPageContainer.add(card)
    const g = this.scene.add.graphics().setName('merchant-upgrade-card')
    card.add(g)
    const left = -w / 2
    const top = -h / 2
    const padding = clamp(w * 0.045, 8, 15)
    this.drawParchment(g, left, top, w, h)
    const active = isUpgrade(product)
    const current = active ? levels[product.id] : 0
    const max = active ? UPGRADE_CATALOG[product.id].maxLevel : 10
    const maxed = active && current >= max
    const pending = active && this.purchasing.has(product.id)
    const cost = active ? upgradeCost(product.id, current) : 0
    const affordable = balance >= cost
    const status = active ? this.purchaseStatus.get(product.id) : undefined
    const title = active ? UPGRADE_CATALOG[product.id].name : product.name
    const benefit = active ? this.benefit(product.id) : product.benefit
    const compact = h < 185
    const iconR = compact ? clamp(h * 0.19, 10, 23) : clamp(Math.min(w * 0.145, h * 0.18), 18, 42)
    const iconX = left + padding + iconR
    const iconY = top + (compact ? h * 0.25 : h * 0.2)
    const art = this.scene.add.graphics().setName(`merchant-upgrade-art-${product.id}`)
    art.fillStyle(product.accent, 0.12).fillCircle(iconX, iconY, iconR * 1.12)
    this.drawProductIcon(art, product.id, iconX, iconY, iconR)
    if (!active) art.setAlpha(0.85)
    card.add(art)
    const textLeft = iconX + iconR + padding * 0.6
    const titleW = Math.max(1, w / 2 - padding - textLeft)
    const titleX = textLeft + titleW / 2
    const titleValue = !compact && titleW < 155 ? title.replace(' ', '\n') : title
    const titleSize = compact ? clamp(h * 0.16, 11, 17) : clamp(Math.min(w * 0.115, h * 0.115), 14, 23)
    this.addFittedText(card, titleX, top + h * (compact ? 0.14 : 0.18), titleValue, titleW, titleSize)
    const statusColor = status?.kind === 'success' ? '#27741b' : status?.kind === 'error' ? '#b32828' : SECONDARY_TEXT
    const detail = status?.message ?? (!compact && titleW < 125 ? benefit.replace(' / STAGE', '\n/ STAGE') : benefit)
    this.addFittedText(card, titleX, top + h * (compact ? 0.31 : 0.32), detail, titleW, compact ? 9 : 10, statusColor)

    const buttonH = compact ? clamp(h * 0.28, 22, 34) : clamp(h * 0.18, 31, 44)
    const buttonW = compact ? clamp(w * 0.32, 70, 128) : w - padding * 2 - 4
    const buttonX = compact ? w / 2 - padding - buttonW / 2 : 0
    const buttonY = top + h - buttonH / 2 - (compact ? 7 : 10)
    const statW = compact ? Math.max(1, w - padding * 2 - buttonW - 10) : w - padding * 2
    const statX = compact ? left + padding + statW / 2 : 0
    const transition = active
      ? `${this.effectValue(product.id, current)} → ${this.effectValue(product.id, Math.min(max, current + 1))}`
      : 'COMING SOON'
    const maxLabel = active ? `MAX EFFECT ${this.effectValue(product.id, max)}` : 'NOT AVAILABLE YET'
    const barH = compact ? 5 : clamp(h * 0.045, 7, 11)
    const barY = compact ? top + h - 8 : buttonY - buttonH / 2 - barH / 2 - 10
    const stageY = compact ? top + h - 20 : barY - barH / 2 - 12
    const maxY = compact ? top + h * 0.64 : stageY - 18
    const effectY = compact ? top + h * 0.47 : maxY - 23
    this.addFittedText(card, statX, effectY, transition, statW, compact ? 12 : clamp(h * 0.105, 17, 27), active ? INK_HEX : '#836c54')
    this.addFittedText(card, statX, maxY, maxLabel, statW, compact ? 8 : 10, SECONDARY_TEXT)
    this.addFittedText(card, statX, stageY, active ? `STAGE ${current} / ${max}` : 'STAGE — / —', statW, compact ? 8 : 10, active ? INK_HEX : SECONDARY_TEXT)
    this.renderStageBar(card, statX, barY, statW - 4, current, max, product.accent, barH)
    const label = !active ? 'COMING SOON' : pending ? 'BUYING...' : maxed ? 'MAXED'
      : !registered ? 'ACCOUNTS ONLY' : !affordable ? `NEED ${cost}` : `${cost}`
    const available = active && registered && affordable && !maxed && !pending
    this.renderBuyButton(card, buttonX, buttonY, buttonW, buttonH, label, active && !pending && !maxed && registered, active, available, page, () => {
      if (active) void this.purchase(product.id)
    })
  }

  private drawParchment(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const radius = clamp(Math.min(w, h) * 0.055, 5, 10)
    g.fillStyle(INK, 0.32).fillRoundedRect(x + 2, y + 5, w, h, radius)
    g.fillStyle(PAPER_BASE).fillRoundedRect(x, y, w, h, radius)
    g.fillStyle(PAPER).fillRoundedRect(x + 1, y, w - 2, h - 5, radius)
    g.lineStyle(2.5, INK).strokeRoundedRect(x, y, w, h, radius)
    g.lineStyle(1, PAPER_EDGE, 0.7).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, Math.max(2, radius - 3))
    g.fillStyle(PAPER_BASE).fillTriangle(x + w - 13, y + 1, x + w - 1, y + 13, x + w - 13, y + 13)
    g.lineStyle(1, PAPER_EDGE).lineBetween(x + w - 13, y + 1, x + w - 13, y + 13)
    g.lineBetween(x + w - 13, y + 13, x + w - 1, y + 13)
    g.fillStyle(PAPER_BASE).fillTriangle(x + 1, y + h - 12, x + 12, y + h - 1, x + 12, y + h - 12)
    g.lineStyle(1, PAPER_EDGE, 0.65)
    for (let sy = y + 23; sy < y + h - 18; sy += 11) {
      g.lineBetween(x + 6, sy, x + 6, sy + 4)
      g.lineBetween(x + w - 6, sy, x + w - 6, sy + 4)
    }
    for (const px of [x + 12, x + w - 12]) {
      g.fillStyle(WOOD_DARK, 0.2).fillCircle(px + 1, y + 11, 3)
      g.fillStyle(0xbc8f49).fillCircle(px, y + 9, 2.6)
      g.lineStyle(1, INK).strokeCircle(px, y + 9, 2.6)
      g.fillStyle(0xffe7a1).fillCircle(px - 0.6, y + 8.2, 0.8)
    }
  }

  private renderBuyButton(
    parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number,
    label: string, coin: boolean, active: boolean, available: boolean, page: number, onClick: () => void,
  ): void {
    const button = this.scene.add.container(x, y).setName(`merchant-buy-${parent.name.replace('merchant-upgrade-', '')}`)
    const g = this.scene.add.graphics()
    const radius = h / 2
    // Unaffordable/account-only upgrades remain green goods, not grey placeholders.
    g.fillStyle(INK).fillRoundedRect(-w / 2 - 1, -h / 2 + 4, w + 2, h + 1, radius)
    g.fillStyle(active ? GREEN_DARK : 0x716a59).fillRoundedRect(-w / 2, -h / 2 + 4, w, h - 1, radius)
    g.fillStyle(active ? GREEN : 0xaaa38e).fillRoundedRect(-w / 2, -h / 2, w, h - 2, radius)
    g.lineStyle(2.5, INK).strokeRoundedRect(-w / 2, -h / 2, w, h - 1, radius)
    g.fillStyle(active ? GREEN_LIGHT : 0xd1cbb6, 0.65).fillRoundedRect(-w / 2 + 10, -h / 2 + 3, Math.max(1, w - 20), Math.max(2, h * 0.16), radius * 0.3)
    button.add(g)
    const iconSpace = coin ? Math.min(23, h * 0.7) : 0
    const text = this.addFittedText(button, 0, -1, label, w - iconSpace - 17, clamp(h * 0.43, 10, 19), '#fff9dc')
      .setStroke(INK_HEX, active ? 1.5 : 1)
    if (coin) {
      const contentW = iconSpace + 5 + text.displayWidth
      drawCoin(g, -contentW / 2 + iconSpace / 2, -1, iconSpace * 0.45)
      text.setX(iconSpace / 2 + 2.5)
    }
    const zone = this.scene.add.zone(0, 0, w, h + 5).setName('merchant-buy-hit').setInteractive({ useHandCursor: available })
    let pressed: { id: number; x: number; y: number } | null = null
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!available) return
      pressed = { id: pointer.id, x: pointer.x, y: pointer.y }
    })
    zone.on('pointerout', () => {
      pressed = null
    })
    zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const start = pressed
      pressed = null
      if (!available || !start || pointer.id !== start.id || this.drag?.dragging || this.pageTween
        || this.scene.time.now < this.suppressPurchaseUntil) return
      // Object pointerup can precede the scene's swipe handler. Check the actual
      // pointer travel too, so dragging a purchase button never spends coins.
      const scale = this.scene.cameras.main.zoom || 1
      if (Math.hypot(pointer.x - start.x, pointer.y - start.y) / scale > 10) return
      onClick()
    })
    button.add(zone)
    parent.add(button)
    this.buyButtons.push({ zone, page, available })
  }

  private drawProductIcon(g: Phaser.GameObjects.Graphics, id: ProductId, x: number, y: number, r: number): void {
    const line = Math.max(1.4, r * 0.075)
    g.lineStyle(line, INK)
    if (id === 'wallDuration') {
      for (const side of [-1, 1]) {
        const wallX = x + (side < 0 ? -0.92 : 0.3) * r
        g.fillStyle(0x60a5e8).fillRoundedRect(wallX, y - r * 0.65, r * 0.62, r * 1.42, 3)
        g.lineStyle(line, INK).strokeRoundedRect(wallX, y - r * 0.65, r * 0.62, r * 1.42, 3)
        g.lineStyle(Math.max(1, r * 0.045), 0x2e609a)
        for (let row = 1; row < 4; row++) {
          const by = y - r * 0.65 + row * r * 0.355
          g.lineBetween(wallX, by, wallX + r * 0.62, by)
          g.lineBetween(wallX + r * (row % 2 ? 0.22 : 0.42), by - r * 0.355, wallX + r * (row % 2 ? 0.22 : 0.42), by)
        }
        g.lineStyle(1.5, 0xc4e9ff).lineBetween(wallX + 3, y - r * 0.55, wallX + 3, y + r * 0.62)
      }
      g.fillStyle(GOLD).fillCircle(x + r * 0.22, y + r * 0.18, r * 0.56)
      g.lineStyle(line, INK).strokeCircle(x + r * 0.22, y + r * 0.18, r * 0.56)
      g.fillStyle(0xfff1b1).fillCircle(x + r * 0.22, y + r * 0.18, r * 0.42)
      g.lineStyle(line, INK).lineBetween(x + r * 0.22, y + r * 0.18, x + r * 0.22, y - r * 0.1)
      g.lineBetween(x + r * 0.22, y + r * 0.18, x + r * 0.45, y + r * 0.31)
      return
    }
    if (id === 'shakeDuration') {
      g.fillStyle(0xe0eff1)
      g.beginPath()
      g.moveTo(x - r * 0.51, y - r * 0.7)
      g.lineTo(x + r * 0.51, y - r * 0.7)
      g.lineTo(x + r * 0.16, y)
      g.lineTo(x + r * 0.51, y + r * 0.7)
      g.lineTo(x - r * 0.51, y + r * 0.7)
      g.lineTo(x - r * 0.16, y)
      g.closePath().fillPath().strokePath()
      g.fillStyle(0xe8ac42).fillTriangle(x - r * 0.36, y - r * 0.43, x + r * 0.36, y - r * 0.43, x, y - r * 0.04)
      g.fillTriangle(x - r * 0.38, y + r * 0.57, x + r * 0.38, y + r * 0.57, x, y + r * 0.11)
      g.lineStyle(Math.max(1, r * 0.045), GOLD).lineBetween(x, y - r * 0.05, x, y + r * 0.37)
      for (const hy of [y - r * 0.83, y + r * 0.66]) {
        g.fillStyle(0xbc6540).fillRoundedRect(x - r * 0.66, hy, r * 1.32, r * 0.2, 3)
        g.lineStyle(line, INK).strokeRoundedRect(x - r * 0.66, hy, r * 1.32, r * 0.2, 3)
      }
      g.lineStyle(1.5, 0xffffff, 0.9).lineBetween(x - r * 0.36, y - r * 0.57, x - r * 0.14, y - r * 0.17)
      return
    }
    if (id === 'shakeIntensity') {
      g.fillStyle(0xf6c63d).fillCircle(x, y, r * 0.8)
      g.lineStyle(line, INK).strokeCircle(x, y, r * 0.8)
      g.lineStyle(2, 0xffe98b).beginPath().arc(x, y, r * 0.63, Math.PI * 1.05, Math.PI * 1.65, false).strokePath()
      this.drawBolt(g, x, y, r * 0.77)
      g.lineStyle(line, 0xdd7e2a)
      g.lineBetween(x - r * 0.9, y - r * 0.49, x - r * 1.06, y - r * 0.67)
      g.lineBetween(x + r * 0.9, y + r * 0.39, x + r * 1.06, y + r * 0.53)
      return
    }
    if (id === 'coinMagnet') {
      // A horseshoe made from a bold red U, with distinct silver pole caps.
      g.lineStyle(r * 0.55 + line * 2, INK).beginPath().arc(x, y - r * 0.12, r * 0.5, 0, Math.PI, false).strokePath()
      g.lineStyle(r * 0.55, 0xda4941).beginPath().arc(x, y - r * 0.12, r * 0.5, 0, Math.PI, false).strokePath()
      for (const side of [-1, 1]) {
        const px = x + side * r * 0.5
        g.fillStyle(0xda4941).fillRect(px - r * 0.275, y - r * 0.67, r * 0.55, r * 0.6)
        g.lineStyle(line, INK).strokeRect(px - r * 0.275, y - r * 0.67, r * 0.55, r * 0.6)
        g.fillStyle(0xc8d6db).fillRoundedRect(px - r * 0.275, y - r * 0.83, r * 0.55, r * 0.35, 2)
        g.strokeRoundedRect(px - r * 0.275, y - r * 0.83, r * 0.55, r * 0.35, 2)
        g.lineStyle(1.5, 0xffffff).lineBetween(px - r * 0.18, y - r * 0.73, px + r * 0.17, y - r * 0.73)
      }
      return
    }
    if (id === 'mergeBonus') {
      g.lineStyle(r * 0.18 + 2, INK).lineBetween(x, y, x + r * 0.25, y + r * 0.88)
      g.lineStyle(r * 0.16, 0x438a35).lineBetween(x, y, x + r * 0.25, y + r * 0.88)
      for (const [dx, dy] of [[-0.36, -0.39], [0.36, -0.39], [-0.36, 0.26], [0.36, 0.26]] as const) {
        g.fillStyle(0x62bb4a).fillCircle(x + dx * r, y + dy * r, r * 0.41)
        g.lineStyle(line, INK).strokeCircle(x + dx * r, y + dy * r, r * 0.41)
        g.lineStyle(1.5, 0xa7e578).lineBetween(x + dx * r, y + dy * r - r * 0.21, x + dx * r - r * 0.12, y + dy * r - r * 0.11)
      }
      g.fillStyle(0x62bb4a).fillCircle(x, y - r * 0.06, r * 0.24)
      return
    }
    this.drawShield(g, x, y, r * 0.9, 0x9566d4, 0x542f88)
    g.lineStyle(1.5, 0xd6b1fa).lineBetween(x - r * 0.6, y - r * 0.48, x - r * 0.43, y + r * 0.27)
    g.fillStyle(GOLD)
    g.beginPath()
    g.moveTo(x - r * 0.17, y + r * 0.5)
    g.lineTo(x + r * 0.21, y + r * 0.5)
    g.lineTo(x + r * 0.21, y - r * 0.03)
    g.lineTo(x + r * 0.46, y - r * 0.03)
    g.lineTo(x + r * 0.02, y - r * 0.53)
    g.lineTo(x - r * 0.43, y - r * 0.03)
    g.lineTo(x - r * 0.17, y - r * 0.03)
    g.closePath().fillPath()
    g.lineStyle(line, INK).strokePath()
  }

  private drawBolt(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    g.fillStyle(0xffed78)
    g.beginPath()
    g.moveTo(x + r * 0.03, y - r)
    g.lineTo(x + r * 0.48, y - r)
    g.lineTo(x + r * 0.15, y - r * 0.23)
    g.lineTo(x + r * 0.55, y - r * 0.23)
    g.lineTo(x - r * 0.28, y + r * 0.91)
    g.lineTo(x - r * 0.05, y + r * 0.12)
    g.lineTo(x - r * 0.43, y + r * 0.12)
    g.closePath().fillPath()
    g.lineStyle(Math.max(1.4, r * 0.09), INK).strokePath()
  }

  private renderStageBar(parent: Phaser.GameObjects.Container, x: number, y: number, width: number, current: number, max: number, accent: number, height: number): void {
    const g = this.scene.add.graphics().setName('merchant-stage-bar')
    const gap = clamp(width / (max * 8), 1.5, 4)
    const pipW = Math.max(1, (width - gap * (max - 1)) / max)
    const left = x - width / 2
    g.fillStyle(0xd9cbb2).fillRoundedRect(left - 3, y - height / 2 - 3, width + 6, height + 6, 4)
    g.lineStyle(1, PAPER_EDGE).strokeRoundedRect(left - 3, y - height / 2 - 3, width + 6, height + 6, 4)
    for (let i = 0; i < max; i++) {
      const px = left + i * (pipW + gap)
      g.fillStyle(i < current ? accent : 0xe9ddc6).fillRoundedRect(px, y - height / 2, pipW, height, 2)
      g.lineStyle(1, i < current ? INK : 0xb9a98d, i < current ? 0.65 : 0.7).strokeRoundedRect(px, y - height / 2, pipW, height, 2)
      if (i < current) g.fillStyle(0xffffff, 0.3).fillRect(px + 2, y - height / 2 + 1, Math.max(1, pipW - 4), 2)
    }
    parent.add(g)
  }

  private benefit(id: UpgradeId): string {
    if (id === 'wallDuration') return `+${this.formatDuration(wallDurationMs(1) - wallDurationMs(0))} WALL TIME / STAGE`
    if (id === 'shakeDuration') return `+${this.formatDuration(shakeDurationMs(1) - shakeDurationMs(0))} SHAKE / STAGE`
    return `+${Math.round((shakeImpulseMultiplier(1) - shakeImpulseMultiplier(0)) * 100)}% SHAKE POWER / STAGE`
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

  private addFittedText(parent: Phaser.GameObjects.Container, x: number, y: number, value: string, maxWidth: number, size: number, color = INK_HEX): Phaser.GameObjects.Text {
    const text = hudText(this.scene, x, y, value, 1, {
      color, size, stroke: 0, pad: 1, origin: [0.5, 0.5], shadow: false,
    }).setStroke(INK_HEX, 0).setAlign('center')
    text.setScale(Math.min(1, Math.max(0.1, maxWidth / Math.max(1, text.width))))
    parent.add(text)
    return text
  }

  private renderBottomNav(): void {
    this.navContainer.removeAll(true)
    const centerX = this.shopX + this.shopW / 2
    const bottom = this.shopTopY + this.shopH
    const dotsY = bottom - this.footerH + 10
    const dots = this.scene.add.graphics().setName('merchant-page-dots')
    const dotGap = 18
    for (let i = 0; i < this.pageCount; i++) {
      const dotX = centerX + (i - (this.pageCount - 1) / 2) * dotGap
      dots.fillStyle(INK, 0.7).fillCircle(dotX, dotsY + 1, 5)
      dots.fillStyle(i === this.currentPage ? GOLD : 0xd0a673, i === this.currentPage ? 1 : 0.55).fillCircle(dotX, dotsY, 3.5)
      if (this.pageCount > 1) {
        const zone = this.scene.add.zone(dotX, dotsY, 18, 24).setName(`merchant-page-${i + 1}`).setInteractive({ useHandCursor: true })
        zone.on('pointerup', () => this.setPage(i))
        this.navContainer.add(zone)
      }
    }
    this.navContainer.add(dots)
    const readoutW = clamp(this.shopW * 0.36, 154, 280)
    const readoutH = clamp(this.footerH * 0.5, 28, 43)
    const readoutY = bottom - readoutH / 2 - 5
    const readout = this.scene.add.container(centerX, readoutY).setName('merchant-coin-balance')
    const g = this.scene.add.graphics()
    this.drawWoodPanel(g, -readoutW / 2, -readoutH / 2, readoutW, readoutH, readoutH / 2)
    g.fillStyle(WOOD_DARK).fillRoundedRect(-readoutW / 2 + 6, -readoutH / 2 + 6, readoutW - 12, readoutH - 12, readoutH / 2)
    g.lineStyle(1, 0xe1a556, 0.8).strokeRoundedRect(-readoutW / 2 + 5, -readoutH / 2 + 5, readoutW - 10, readoutH - 10, readoutH / 2)
    drawCoin(g, -readoutW / 2 + readoutH * 0.59, -1, readoutH * 0.32)
    readout.add(g)
    this.addFittedText(readout, readoutH * 0.3, -1, `COINS ${formatCoins(Number(loadSave().coins) || 0)}`, readoutW - readoutH - 12, clamp(readoutH * 0.48, 12, 20), '#ffe289')
    this.navContainer.add(readout)
    const arrowY = this.gridY + this.gridH * 0.5
    for (const direction of [-1, 1] as const) {
      const atEnd = direction < 0 ? this.currentPage === 0 : this.currentPage === this.pageCount - 1
      const arrow = new ChunkyButton({
        scene: this.scene,
        x: direction < 0 ? this.shopX + 7 + this.postW / 2 : this.shopX + this.shopW - 7 - this.postW / 2,
        y: arrowY,
        w: clamp(this.postW + 8, 31, 49),
        h: clamp(this.postW + 10, 38, 52),
        label: direction < 0 ? '<' : '>',
        fontSize: clamp(this.postW * 0.8, 22, 32),
        fill: WOOD_LIGHT,
        shadowColor: WOOD_DARK,
        highlightColor: WOOD_GRAIN,
        textColor: '#ffe9ac',
        onClick: () => this.setPage(this.currentPage + direction),
      })
      arrow.container.setName(direction < 0 ? 'merchant-prev' : 'merchant-next').setAlpha(atEnd ? 0.5 : 1)
      arrow.setDisabled(atEnd)
      this.navContainer.add(arrow.container)
    }
  }

  private updateBuyButtons(): void {
    const moving = !!this.pageTween || !!this.drag?.dragging
    for (const { zone, page, available } of this.buyButtons) {
      if (zone.input) zone.input.enabled = available && page === this.currentPage && !moving
    }
  }

  private setPage(page: number): void {
    if (this.destroyed) return
    this.currentPage = clamp(page, 0, this.pageCount - 1)
    this.scene.tweens.killTweensOf(this.itemPageContainer)
    this.pageTween = null
    const target = -this.currentPage * this.pageStride
    this.renderBottomNav()
    if (this.reducedMotion || Math.abs(this.itemPageContainer.x - target) < 0.5) {
      this.itemPageContainer.setX(target)
      this.updateBuyButtons()
      return
    }
    this.pageTween = this.scene.tweens.add({
      targets: this.itemPageContainer,
      x: target,
      duration: 270,
      ease: 'Cubic.Out',
      onComplete: () => {
        if (this.destroyed) return
        this.pageTween = null
        this.updateBuyButtons()
      },
    })
    this.updateBuyButtons()
  }

  private beginDrag(pointer: Phaser.Input.Pointer): void {
    if (this.destroyed || this.pageCount < 2 || this.drag) return
    const point = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerPoint)
    if (point.x < this.gridX || point.x > this.gridX + this.gridW || point.y < this.gridY || point.y > this.gridY + this.gridH) return
    this.scene.tweens.killTweensOf(this.itemPageContainer)
    this.pageTween = null
    this.drag = {
      pointerId: pointer.id,
      startX: point.x, startY: point.y, lastX: point.x, lastAt: this.scene.time.now,
      originX: this.itemPageContainer.x, velocity: 0, dragging: false,
    }
  }

  private moveDrag(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag
    if (!drag || drag.pointerId !== pointer.id || !pointer.isDown) return
    const point = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerPoint)
    const dx = point.x - drag.startX
    const dy = point.y - drag.startY
    if (!drag.dragging) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
        this.cancelDrag()
        return
      }
      if (Math.abs(dx) < 10) return
      drag.dragging = true
      this.updateBuyButtons()
    }
    const elapsed = Math.max(1, this.scene.time.now - drag.lastAt)
    drag.velocity = clamp(drag.velocity * 0.45 + ((point.x - drag.lastX) / elapsed) * 0.55, -2.5, 2.5)
    drag.lastX = point.x
    drag.lastAt = this.scene.time.now
    const minX = -(this.pageCount - 1) * this.pageStride
    const rawX = drag.originX + dx
    const boundedX = clamp(rawX, minX, 0)
    this.itemPageContainer.setX(boundedX + (rawX - boundedX) * 0.22)
  }

  private finishDrag(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag
    if (!drag || drag.pointerId !== pointer.id) return
    this.drag = null
    let targetPage = this.currentPage
    if (drag.dragging) {
      const point = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerPoint)
      const dx = point.x - drag.startX
      const velocity = this.scene.time.now - drag.lastAt < 100 ? drag.velocity : 0
      const projected = dx + velocity * 120
      const threshold = Math.min(68, this.gridW * 0.2)
      if (Math.abs(dx) > threshold || (Math.abs(dx) > 12 && Math.abs(velocity) > 0.45)) targetPage += projected < 0 ? 1 : -1
      this.suppressPurchaseUntil = this.scene.time.now + 100
    }
    this.setPage(targetPage)
  }

  private cancelDrag(): void {
    if (!this.drag) return
    this.drag = null
    this.suppressPurchaseUntil = this.scene.time.now + 100
    this.setPage(this.currentPage)
  }

  private async purchase(id: UpgradeId): Promise<void> {
    if (this.destroyed || !authService.isRegisteredAccount()) return
    const save = loadSave()
    const current = normalizeUpgradeLevels(save.upgrades)[id]
    const cost = upgradeCost(id, current)
    if (current >= UPGRADE_CATALOG[id].maxLevel || cost <= 0 || (Number(save.coins) || 0) < cost || this.purchasing.has(id)) return
    this.purchasing.add(id)
    this.purchaseStatus.delete(id)
    this.renderItems()
    const revision = this.lifecycleRevision
    try {
      const { error } = await authService.purchaseUpgrade(id)
      if (this.destroyed || revision !== this.lifecycleRevision) return
      this.purchaseStatus.set(id, error
        ? { kind: 'error', message: error.message || 'PURCHASE FAILED' }
        : { kind: 'success', message: 'PURCHASED!' })
    } catch (error) {
      if (this.destroyed || revision !== this.lifecycleRevision) return
      this.purchaseStatus.set(id, { kind: 'error', message: error instanceof Error ? error.message : 'PURCHASE FAILED' })
    } finally {
      if (!this.destroyed && revision === this.lifecycleRevision) {
        this.purchasing.delete(id)
        this.renderItems()
        this.renderBottomNav()
      }
    }
  }
}
