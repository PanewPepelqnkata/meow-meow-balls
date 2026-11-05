import Phaser from 'phaser'
import { ChunkyButton, UI_COLORS } from '../../ui/DesignSystem'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { hudText } from '../../ui/Typography'
import { drawBallIcon } from '../scenes/TitleScene'
import { INK } from './BallAppearance'

const TEST_ITEMS = [
  { name: 'TEST ITEM', tier: 1, seed: 100 },
  { name: 'TEST ITEM', tier: 2, seed: 200 },
  { name: 'TEST ITEM', tier: 3, seed: 300 },
  { name: 'TEST ITEM', tier: 4, seed: 400 },
  { name: 'TEST ITEM', tier: 5, seed: 500 },
  { name: 'TEST ITEM', tier: 6, seed: 600 },
] as const

type TestItem = (typeof TEST_ITEMS)[number]

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
const UNAVAILABLE = 0xc0392b
const SHADOW = 0x05070e

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** A roadside merchant's canvas sack, filled with unavailable test wares. */
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

    this.renderBag()
    this.renderItems()
    this.renderDrawstring(this.drawstringGraphics)
    this.renderBottomNav()

    this.storeContainer.once(Phaser.GameObjects.Events.DESTROY, this.release, this)
  }

  public destroy(): void {
    if (this.destroyed) return
    this.release()
    this.storeContainer.destroy()
  }

  private release(): void {
    if (this.destroyed) return
    this.destroyed = true
    // StoreView has no active input handlers or timers. Kill only tweens that
    // target this view so parent-scene transitions cannot retain its objects.
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
    const portrait = this.vw <= this.vh
    const cols = portrait ? 2 : 3
    const rows = Math.ceil(TEST_ITEMS.length / cols)
    const inset = clamp(this.bagW * 0.065, 10, 30)
    const gap = clamp(Math.min(this.bagW, this.bagH) * 0.025, 5, 12)
    const gridTop = this.bagTopY - Math.min(18, this.bagOpeningH * 0.32)
    const gridBottom = this.bagTopY + this.bagH - Math.max(24, this.bagH * 0.1)
    const gridW = Math.max(1, this.bagW - inset * 2)
    const gridH = Math.max(1, gridBottom - gridTop)
    const cardW = Math.max(1, (gridW - gap * (cols - 1)) / cols)
    const cardH = Math.max(1, (gridH - gap * (rows - 1)) / rows)

    TEST_ITEMS.forEach((item, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = this.bagX + inset + col * (cardW + gap)
      const y = gridTop + row * (cardH + gap) + (row === 0 && index % 2 === 1 ? Math.min(8, cardH * 0.08) : 0)
      this.renderItemCard(x, y, cardW, cardH, item, index)
    })
  }

  private renderItemCard(x: number, y: number, w: number, h: number, item: TestItem, index: number): void {
    const card = this.scene.add.container(x + w / 2, y + h / 2).setName(`merchant-item-${index + 1}`)
    card.setAngle(Phaser.Math.FloatBetween(-3, 3))
    this.itemContainer.add(card)

    const g = this.scene.add.graphics().setName('merchant-item-card')
    card.add(g)
    const radius = clamp(Math.min(w, h) * 0.1, 4, 8)
    const left = -w / 2
    const top = -h / 2

    // A raised parchment base and a slightly greyed unavailable wash.
    g.fillStyle(PARCHMENT_BASE, 1)
    g.fillRoundedRect(left + 2, top + 3, w, h, radius)
    g.fillStyle(PARCHMENT, 0.95)
    g.fillRoundedRect(left, top, w, h, radius)
    g.fillStyle(0x7a6f62, 0.07)
    g.fillRoundedRect(left, top, w, h, radius)
    g.lineStyle(1, PARCHMENT_BORDER, 1)
    g.strokeRoundedRect(left, top, w, h, radius)
    g.lineStyle(0.75, INK, 0.12)
    g.strokeRoundedRect(left + 1, top + 1, Math.max(1, w - 2), Math.max(1, h - 2), Math.max(2, radius - 1))
    g.lineStyle(1, 0xffffff, 0.32)
    g.strokeRoundedRect(left + 2, top + 2, Math.max(1, w - 4), Math.max(1, h - 4), Math.max(2, radius - 2))

    const labelY = top + clamp(h * 0.13, 8, 14)
    const label = hudText(this.scene, 0, labelY, item.name, 1, {
      color: PRIMARY_TEXT,
      size: 11,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    }).setStroke('#000000', 0)
    label.setScale(Math.min(1, Math.max(0.05, (w - 8) / Math.max(1, label.width))))
    card.add(label)

    const iconG = this.scene.add.graphics().setName('merchant-item-ball')
    const iconR = clamp(Math.min(w * 0.2, h * 0.27), 4, 30)
    const iconY = clamp(-h * 0.04, top + iconR + 10, -top - iconR - 12)
    drawBallIcon(this.scene, iconG, item.tier, 0, iconY, iconR, {
      seed: item.seed,
      detail: 24,
      character: true,
      layer: card,
    })
    iconG.setAlpha(0.76)
    card.add(iconG)

    this.renderPriceTag(card, w, h)
    this.renderUnavailableStamp(card, w, h)
  }

  private renderPriceTag(card: Phaser.GameObjects.Container, w: number, h: number): void {
    const tag = this.scene.add.container(w * 0.28, h * 0.16).setName('merchant-price-tag')
    const tagG = this.scene.add.graphics()
    const tagW = clamp(w * 0.27, 24, 52)
    const tagH = clamp(h * 0.2, 14, 24)
    const tx = -tagW / 2
    const ty = -tagH / 2
    tagG.lineStyle(1, 0x8a7a66, 0.9)
    tagG.lineBetween(0, -h * 0.66, 0, ty)
    tagG.fillStyle(PARCHMENT, 1)
    tagG.fillRoundedRect(tx, ty, tagW, tagH, 3)
    tagG.lineStyle(1, PARCHMENT_BORDER, 1)
    tagG.strokeRoundedRect(tx, ty, tagW, tagH, 3)
    tagG.fillStyle(0x8a7a66, 0.7)
    tagG.fillCircle(tx + 5, ty + 5, 1.3)
    tag.add(tagG)

    const price = hudText(this.scene, 0, 0, 'N/A', 1, {
      color: SECONDARY_TEXT,
      size: 9,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    }).setStroke('#000000', 0)
    price.setScale(Math.min(1, Math.max(0.05, (tagW - 4) / Math.max(1, price.width))))
    tag.add(price)
    card.add(tag)
  }

  private renderUnavailableStamp(card: Phaser.GameObjects.Container, w: number, h: number): void {
    const stamp = this.scene.add.container(0, h * 0.32).setName('merchant-unavailable-stamp')
    stamp.setRotation(-0.055)
    const stampW = clamp(w * 0.86, 34, Math.max(34, w - 8))
    const stampH = clamp(h * 0.16, 12, 20)
    const stampG = this.scene.add.graphics()
    stampG.lineStyle(1.3, UNAVAILABLE, 0.8)
    stampG.strokeRoundedRect(-stampW / 2, -stampH / 2, stampW, stampH, 3)
    stampG.lineStyle(0.7, UNAVAILABLE, 0.5)
    stampG.strokeRoundedRect(-stampW / 2 + 2, -stampH / 2 + 2, Math.max(1, stampW - 4), Math.max(1, stampH - 4), 2)
    stamp.add(stampG)

    const label = hudText(this.scene, 0, 0, 'NOT AVAILABLE', 1, {
      color: '#c0392b',
      size: 10,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    }).setStroke('#000000', 0).setAlpha(0.85)
    label.setScale(Math.min(1, Math.max(0.05, (stampW - 7) / Math.max(1, label.width))))
    stamp.add(label)
    card.add(stamp)
  }

  private renderBottomNav(): void {
    const statusW = clamp(this.bagW * 0.35, 136, 218)
    const status = new ChunkyButton({
      scene: this.scene,
      x: this.vw / 2,
      y: this.navY,
      w: statusW,
      h: 38,
      label: 'COMING SOON',
      fontSize: 12,
      textColor: UI_COLORS.TEXT_GOLD,
      fill: UI_COLORS.BTN_GRAY,
      shadowColor: UI_COLORS.BTN_GRAY_SHADOW,
      highlightColor: UI_COLORS.BTN_GRAY_HIGHLIGHT,
      pill: true,
      disabled: true,
    })
    status.container.setName('merchant-coming-soon')
    this.navContainer.add(status.container)
  }
}
