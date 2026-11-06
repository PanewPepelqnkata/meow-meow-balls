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
import { ballLookFor, ballOutlineWidth, drawBallFace, INK as BALL_INK, restContour } from './BallAppearance'
import { drawCoin, formatCoins } from './Coin'
import { bakeCanvas } from './RoughArt'

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
const SECONDARY_TEXT = '#72563a'
const WARM_LIGHT_TEXTURE = 'merchant-warm-radial'
const LIGHT_TEXTURE_SIZE = 256
const ENTRANCE_DURATION_SEC = 0.28
const ENTRANCE_STAGGER_SEC = 0.05

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
type BuyButton = {
  zone: Phaser.GameObjects.Zone
  hoverZone: Phaser.GameObjects.Zone
  button: Phaser.GameObjects.Container
  sheenG: Phaser.GameObjects.Graphics
  hoverShadow: Phaser.GameObjects.Graphics
  hoverBorder: Phaser.GameObjects.Graphics
  card: Phaser.GameObjects.Container
  art: Phaser.GameObjects.Graphics
  page: number
  slotIndex: number
  available: boolean
  baseY: number
  buttonBaseY: number
  buttonW: number
  buttonH: number
  cardHovered: boolean
  buttonHovered: boolean
  pressed: boolean
  hoverMix: number
  pressMix: number
}
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

type LanternRig = {
  pivotX: number
  pivotY: number
  armLen: number
  w: number
  phase: number
  freq: number
  flickerSeed: number
  headX: number
  headY: number
  swingAngle: number
  flicker: number
  ambient: Phaser.GameObjects.Image
  surface: Phaser.GameObjects.Image
  halo: Phaser.GameObjects.Image
  body: Phaser.GameObjects.Container
  flame: Phaser.GameObjects.Graphics
}

type BannerRig = {
  x: number
  y: number
  w: number
  h: number
  phase: number
  freq: number
}

type DustMote = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  side: 0 | 1
}

type SparkleNode = {
  x: number
  y: number
  r: number
  phase: number
  speed: number
  color: number
}

type CelebrationBurst = {
  x: number
  y: number
  bornAt: number
  page: number
  duration: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isUpgrade(product: Product): product is Extract<Product, { id: UpgradeId }> {
  return product.id in UPGRADE_CATALOG
}

/** Smooth organic flame flicker combining 3 incommensurate harmonics in [0.72, 1.18]. */
function sampleFlameFlicker(tSec: number, seed: number): number {
  const a = Math.sin(tSec * 5.7 + seed * 1.9) * 0.11
  const b = Math.sin(tSec * 13.3 + seed * 4.3) * 0.065
  const c = Math.cos(tSec * 23.1 + seed * 7.1) * 0.035
  const slow = Math.sin(tSec * 1.85 + seed * 0.7) * 0.05
  return 0.96 + a + b + c + slow
}

function paintWarmLight(ctx: CanvasRenderingContext2D): void {
  const center = LIGHT_TEXTURE_SIZE / 2
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255, 230, 146, 1)')
  gradient.addColorStop(0.16, 'rgba(255, 210, 100, 0.82)')
  gradient.addColorStop(0.4, 'rgba(255, 179, 62, 0.38)')
  gradient.addColorStop(0.7, 'rgba(255, 156, 40, 0.09)')
  gradient.addColorStop(1, 'rgba(255, 156, 40, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE)
}

/** The stall stays still; only the masked, two-row product pages move. */
export class StoreView {
  private readonly scene: Phaser.Scene
  private readonly storeContainer: Phaser.GameObjects.Container
  private readonly ambientLightLayer: Phaser.GameObjects.Container
  private readonly shopGraphics: Phaser.GameObjects.Graphics
  private readonly surfaceLightLayer: Phaser.GameObjects.Container
  private readonly surfaceLightG: Phaser.GameObjects.Graphics
  private readonly canopyAnimG: Phaser.GameObjects.Graphics
  private readonly foregroundAnimG: Phaser.GameObjects.Graphics
  private readonly lanternLayer: Phaser.GameObjects.Container
  private readonly atmosphereG: Phaser.GameObjects.Graphics
  private readonly shopChrome: Phaser.GameObjects.Container
  private readonly signBackingG: Phaser.GameObjects.Graphics
  private readonly signSheenG: Phaser.GameObjects.Graphics
  private readonly itemContainer: Phaser.GameObjects.Container
  private readonly itemPageContainer: Phaser.GameObjects.Container
  private readonly celebrationG: Phaser.GameObjects.Graphics
  private readonly navContainer: Phaser.GameObjects.Container
  private readonly maskGraphics: Phaser.GameObjects.Graphics
  private maskFilter: (Phaser.Filters.Mask & { active?: boolean }) | null = null
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
  private readonly desktopHover: boolean
  private readonly canopyCorners = { tl: 0, tr: 0, bl: 0, br: 0 }
  private readonly purchasing = new Set<UpgradeId>()
  private readonly purchaseStatus = new Map<UpgradeId, PurchaseStatus>()
  private readonly buyButtons: BuyButton[] = []
  private readonly lanterns: LanternRig[] = []
  private readonly banners: BannerRig[] = []
  private readonly dustMotes: DustMote[] = []
  private readonly sparkles: SparkleNode[] = []
  private readonly celebrations: CelebrationBurst[] = []
  private currentPage = 0
  private visualPageProgress = 0
  private pageTween: Phaser.Tweens.Tween | null = null
  private pageTweenPaused = false
  private drag: Drag | null = null
  private suppressPurchaseUntil = 0
  private unsubscribeAuth: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private lifecycleRevision = 0
  private destroyed = false
  private entranceElapsedSec = 0
  private entranceActive = true
  private animElapsedSec = 0
  private pageDotsG: Phaser.GameObjects.Graphics | null = null

  constructor(
    scene: Phaser.Scene,
    parentContainer: Phaser.GameObjects.Container,
    vw: number,
    vh: number,
    topY: number,
  ) {
    this.scene = scene
    this.reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.entranceActive = !this.reducedMotion
    this.desktopHover = vw >= 700
      && typeof window !== 'undefined'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const safe = readSafeArea()
    const left = Math.max(10, safe.left + 8)
    const right = Math.max(10, safe.right + 8)
    const availableW = Math.max(1, vw - left - right)
    const availableH = Math.max(1, vh - Math.max(18, safe.bottom + 14) - topY - 8)
    this.shopW = Math.floor(Math.min(1120, availableW))
    this.shopH = Math.floor(Math.min(790, availableH))
    this.shopX = Math.floor(left + (availableW - this.shopW) / 2)
    this.shopTopY = Math.floor(topY + 8 + (availableH - this.shopH) / 2)
    this.headerH = Math.round(clamp(this.shopH * 0.21, 64, vw >= 700 ? 150 : 126))
    this.footerH = Math.round(clamp(this.shopH * 0.13, 48, 88))
    this.postW = Math.round(clamp(this.shopW * 0.042, 20, 43))
    const inset = Math.round(this.postW + clamp(this.shopW * 0.022, 14, 26))
    this.gap = Math.round(clamp(Math.min(this.shopW, this.shopH) * 0.022, 8, 15))
    this.gridX = Math.round(this.shopX + inset)
    this.gridY = Math.round(this.shopTopY + this.headerH + 8)
    this.gridW = Math.max(1, Math.round(this.shopW - inset * 2))
    this.gridH = Math.max(1, Math.round(this.shopH - this.headerH - this.footerH - 18))
    this.columns = vw >= 700 ? 3 : this.gridW >= 270 && this.gridH >= 400 ? 2 : 1
    this.pageSize = this.columns * 2
    this.pageCount = Math.ceil(PRODUCTS.length / this.pageSize)
    this.pageStride = this.gridW + this.gap * 2
    const scallopRadius = this.shopW / Math.max(8, Math.min(18, Math.round(this.shopW / 62) * 2)) * 0.28
    this.canopyCorners.bl = scallopRadius
    this.canopyCorners.br = scallopRadius

    this.storeContainer = scene.add.container(0, 0).setName('merchant-store')
    parentContainer.add(this.storeContainer)
    this.ambientLightLayer = scene.add.container(0, 0).setName('merchant-ambient-light')
    this.shopGraphics = scene.add.graphics().setName('merchant-stall')
    this.surfaceLightLayer = scene.add.container(0, 0).setName('merchant-surface-light')
    this.surfaceLightG = scene.add.graphics()
    this.surfaceLightLayer.add(this.surfaceLightG)
    this.canopyAnimG = scene.add.graphics().setName('merchant-canopy-anim')
    this.foregroundAnimG = scene.add.graphics().setName('merchant-foreground-anim')
    this.lanternLayer = scene.add.container(0, 0).setName('merchant-lanterns')
    this.atmosphereG = scene.add.graphics().setName('merchant-atmosphere')
    this.shopChrome = scene.add.container(0, 0).setName('merchant-stall-sign')
    this.signBackingG = scene.add.graphics().setName('merchant-sign-backing')
    this.signSheenG = scene.add.graphics()
    this.shopChrome.add([this.signBackingG, this.signSheenG])
    this.itemContainer = scene.add.container(this.gridX, this.gridY).setName('merchant-items')
    this.itemPageContainer = scene.add.container(0, 0).setName('merchant-item-pages')
    this.celebrationG = scene.add.graphics().setName('merchant-celebration')
    this.itemContainer.add([this.itemPageContainer, this.celebrationG])
    this.navContainer = scene.add.container(0, 0).setName('merchant-nav')
    this.storeContainer.add([
      this.ambientLightLayer,
      this.shopGraphics,
      this.surfaceLightLayer,
      this.canopyAnimG,
      this.foregroundAnimG,
      this.lanternLayer,
      this.shopChrome,
      this.itemContainer,
      this.atmosphereG,
      this.navContainer,
    ])

    // Phaser 4 uses a Mask filter in WebGL; GeometryMask remains the Canvas path.
    // The measured WebGL FBO was 2560×1600 for CSS 1280×800 at DPR 2.
    // Bypass the observed extra filter sampling while idle; clipping remains active
    // throughout a slide or an interrupted drag, with off-page cards hidden at rest.
    this.maskGraphics = scene.add.graphics().setName('merchant-item-mask')
    this.maskGraphics.fillStyle(0xffffff).fillRect(this.gridX - 2, this.gridY - 5, this.gridW + 4, this.gridH + 12)
    if (scene.game?.renderer?.type === Phaser.WEBGL) {
      this.itemContainer.enableFilters()
      this.maskFilter = this.itemContainer.filters!.external.addMask(this.maskGraphics, false, scene.cameras.main, 'world')
      this.maskFilter.autoUpdate = false
      this.maskFilter.active = false
    } else {
      this.itemContainer.setMask(new Phaser.Display.Masks.GeometryMask(scene, this.maskGraphics))
    }
    this.maskGraphics.setVisible(false)

    this.initEnvironmentalRigs()

    this.storeContainer.once(Phaser.GameObjects.Events.DESTROY, this.release, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onSceneUpdate, this)
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
      this.celebrations.length = 0
      this.celebrationG.clear()
      this.renderItems()
      this.renderBottomNav()
    })
    this.unsubscribeState = gameBus.on('state:save', () => {
      if (this.destroyed) return
      this.renderItems()
      this.renderBottomNav()
    })
    this.renderShop()
    this.renderDynamicEnvironment(0)
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
    this.celebrations.length = 0
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
    this.unsubscribeState?.()
    this.unsubscribeState = null
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onSceneUpdate, this)
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

  private initEnvironmentalRigs(): void {
    const { shopX: x, shopTopY: y, shopW: w, shopH: h, postW, headerH } = this
    const bottom = y + h
    const lanternW = clamp(w * 0.048, 22, 44)
    const bannerW = postW * 0.92
    const bannerH = clamp(h * 0.21, 48, 124)
    bakeCanvas(this.scene, WARM_LIGHT_TEXTURE, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE, paintWarmLight)

    for (let idx = 0; idx < 2; idx++) {
      const px = idx === 0 ? x + 7 + postW / 2 : x + w - 7 - postW / 2
      const lanternY = y + headerH + 11
      const pivotY = lanternY - lanternW * 1.18
      const ambient = this.scene.add.image(px, lanternY, WARM_LIGHT_TEXTURE)
      const surface = this.scene.add.image(px, lanternY, WARM_LIGHT_TEXTURE)
      const halo = this.scene.add.image(px, lanternY, WARM_LIGHT_TEXTURE)
      this.ambientLightLayer.add(ambient)
      this.surfaceLightLayer.add(surface)
      this.lanternLayer.add(halo)
      const body = this.scene.add.container(px, lanternY).setName(`merchant-lantern-${idx + 1}`)
      const housing = this.scene.add.graphics()
      const flame = this.scene.add.graphics().setName(`merchant-lantern-flame-${idx + 1}`)
      const frame = this.scene.add.graphics()
      this.drawLanternHousing(housing, frame, lanternW)
      body.add([housing, flame, frame])
      this.lanternLayer.add(body)
      this.lanterns.push({
        pivotX: px,
        pivotY,
        armLen: lanternY - pivotY,
        w: lanternW,
        phase: idx === 0 ? 0.35 : 2.45,
        freq: idx === 0 ? 1.55 : 1.38,
        flickerSeed: idx === 0 ? 1.1 : 4.7,
        headX: px,
        headY: lanternY,
        swingAngle: 0,
        flicker: 1,
        ambient, surface, halo, body, flame,
      })
      this.banners.push({
        x: px,
        y: y + headerH + lanternW + 25,
        w: bannerW,
        h: bannerH,
        phase: idx === 0 ? 1.2 : 3.6,
        freq: idx === 0 ? 1.25 : 1.42,
      })
    }

    this.dustMotes.length = 0
    for (let i = 0; i < 14; i++) {
      const side: 0 | 1 = (i % 2) as 0 | 1
      const rig = this.lanterns[side]!
      const spreadX = ((i * 37) % 100) / 100 - 0.5
      const spreadY = ((i * 53) % 100) / 100 - 0.35
      this.dustMotes.push({
        x: rig.pivotX + spreadX * rig.w * 3.4,
        y: rig.pivotY + rig.armLen + spreadY * rig.w * 3.8,
        vx: (side === 0 ? 1 : -1) * (2.2 + (i % 3) * 0.9),
        vy: -3.2 - (i % 4) * 1.1,
        r: 1.2 + (i % 3) * 0.55,
        phase: i * 0.83,
        side,
      })
    }

    const scale = clamp(this.footerH / 82, 0.56, 1)
    const rightBarrelX = x + w - 34 * scale - 4
    const rightSmallBarrelX = x + w - 71 * scale - 4
    this.sparkles.length = 0
    this.sparkles.push(
      { x: x + 30 * scale + 4, y: bottom - 55 * scale, r: 4.5 * scale, phase: 0.2, speed: 1.7, color: 0xfff3b0 },
      { x: x + 67 * scale + 4, y: bottom - 40 * scale, r: 4.0 * scale, phase: 2.1, speed: 1.45, color: 0xffe680 },
      { x: rightBarrelX, y: bottom - 56 * scale, r: 4.8 * scale, phase: 3.8, speed: 1.6, color: 0xf4d6ff },
      { x: rightSmallBarrelX, y: bottom - 41 * scale, r: 3.8 * scale, phase: 5.1, speed: 1.9, color: 0xe6b8ff },
    )
  }

  private onSceneUpdate(_time: number, delta: number): void {
    if (this.destroyed) return
    const visible = this.isVisible()
    if (this.pageTween) {
      if (!visible && !this.pageTweenPaused) this.pageTween.pause()
      else if (visible && this.pageTweenPaused) this.pageTween.resume()
      this.pageTweenPaused = !visible
    }
    if (!visible) return
    const dt = clamp((Number(delta) || 16.67) / 1000, 0.001, 0.1)
    if (!this.reducedMotion) {
      this.animElapsedSec += dt
      if (this.entranceActive) {
        this.entranceElapsedSec += dt
        this.entranceActive = this.entranceElapsedSec
          < ENTRANCE_DURATION_SEC + (Math.min(this.pageSize, PRODUCTS.length) - 1) * ENTRANCE_STAGGER_SEC
      }
      this.renderDynamicEnvironment(this.animElapsedSec)
    }
    this.updateCardAndNavAnimations(dt, this.animElapsedSec)
  }

  private isVisible(): boolean {
    if (typeof document !== 'undefined' && document.hidden) return false
    let ancestor: Phaser.GameObjects.Container | null = this.storeContainer
    while (ancestor) {
      if (!ancestor.visible) return false
      ancestor = ancestor.parentContainer
    }
    return true
  }

  private renderShop(): void {
    const g = this.shopGraphics
    g.clear()
    const { shopX: x, shopTopY: y, shopW: w, shopH: h, postW, headerH } = this
    const cx = x + w / 2
    const bottom = y + h
    g.fillStyle(INK, 0.28).fillEllipse(cx, bottom + 4, w * 0.97, 26)

    // A dark, planked recess lets the cream cards read as separate pinned goods.
    g.fillStyle(WOOD_DARK).fillRoundedRect(x + 10, y + headerH * 0.52, w - 20, h - headerH * 0.52, 9)
    g.lineStyle(4, INK).strokeRoundedRect(x + 10, y + headerH * 0.52, w - 20, h - headerH * 0.52, 9)
    const plankW = (w - 28) / 10
    for (let i = 0; i < 10; i++) {
      const px = x + 14 + i * plankW
      g.fillStyle(i % 2 ? WOOD : 0x914d25).fillRect(px, y + headerH * 0.56, plankW - 2, h - headerH * 0.56 - 9)
      g.lineStyle(1, WOOD_GRAIN, 0.26)
      g.lineBetween(px + 6, y + headerH, px + 8, bottom - 18)
      g.lineBetween(px + plankW - 8, y + headerH + 32, px + plankW - 11, bottom - 38)
    }
    g.fillStyle(INK, 0.2).fillRect(this.gridX - 8, this.gridY - 8, this.gridW + 16, this.gridH + 21)

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

    this.drawCanopyRoof(g)
    this.drawStoreSign(this.signBackingG)
    this.drawBottomPropsStatic(g)
    for (const rig of this.lanterns) {
      g.lineStyle(3, INK).lineBetween(rig.pivotX - rig.w * 0.3, rig.pivotY, rig.pivotX + rig.w * 0.16, rig.pivotY)
    }
  }

  /** Only moving cloth, foliage, flames and small reflections redraw; lights reuse one bake. */
  private renderDynamicEnvironment(tSec: number): void {
    const surfaceG = this.surfaceLightG
    const fgG = this.foregroundAnimG
    surfaceG.clear()
    this.canopyAnimG.clear()
    fgG.clear()
    this.atmosphereG.clear()
    const { shopX: x, shopTopY: y, shopW: w, shopH: h, headerH, postW } = this
    let totalFlicker = 0

    for (let idx = 0; idx < this.lanterns.length; idx++) {
      const rig = this.lanterns[idx]!
      rig.swingAngle = this.reducedMotion ? 0
        : Math.sin(tSec * rig.freq + rig.phase) * 0.055
          + Math.sin(tSec * rig.freq * 0.53 + rig.phase * 1.7) * 0.02
      rig.headX = rig.pivotX + Math.sin(rig.swingAngle) * rig.armLen
      rig.headY = rig.pivotY + Math.cos(rig.swingAngle) * rig.armLen
      rig.flicker = this.reducedMotion ? 1 : sampleFlameFlicker(tSec, rig.flickerSeed)
      totalFlicker += rig.flicker
      const breath = 0.94 + rig.flicker * 0.06
      rig.ambient.setPosition(rig.headX, rig.headY + rig.w * 0.12)
        .setDisplaySize(rig.w * 8.5 * breath, rig.w * 7.4 * breath).setAlpha(0.3 * rig.flicker)
      rig.surface.setPosition(rig.headX, rig.headY + rig.w * 0.08)
        .setDisplaySize(rig.w * 5.2 * breath, rig.w * 5.2 * breath).setAlpha(0.27 * rig.flicker)
      rig.halo.setPosition(rig.headX, rig.headY + rig.w * 0.1)
        .setDisplaySize(rig.w * 2.6 * breath, rig.w * 2.6 * breath).setAlpha(0.32 * rig.flicker)

      const pillarEdgeX = idx === 0 ? x + 7 + postW - 2 : x + w - 7 - postW + 2
      surfaceG.lineStyle(2.5, 0xffd269, 0.34 * rig.flicker)
      surfaceG.lineBetween(pillarEdgeX, rig.headY - rig.w * 1.4, pillarEdgeX, rig.headY + rig.w * 2.3)
      const braceX1 = idx === 0 ? x + 20 : x + w - 20
      const braceX2 = idx === 0 ? x + 76 : x + w - 76
      surfaceG.lineStyle(2.2, 0xffdf80, 0.38 * rig.flicker)
      surfaceG.lineBetween(braceX1, y + headerH + 28, braceX2, y + headerH - 23)
      this.drawLanternAnimated(fgG, rig, tSec)
      this.drawBannerAnimated(fgG, this.banners[idx]!, tSec, rig.flicker)
    }
    this.signSheenG.setAlpha(totalFlicker / this.lanterns.length)
    this.drawCanopyValanceAnimated(this.canopyAnimG, tSec)
    this.drawFoliageAnimated(fgG, x, w, y + h, tSec)
    if (!this.reducedMotion) this.drawAtmosphereParticles(this.atmosphereG, tSec)
  }

  private drawWoodPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number): void {
    g.fillStyle(WOOD_DARK).fillRoundedRect(x + 1, y + 4, w, h, r)
    g.fillStyle(WOOD).fillRoundedRect(x, y, w, h, r)
    g.fillStyle(WOOD_LIGHT).fillRoundedRect(x + 3, y + 2, Math.max(1, w - 6), Math.max(1, h * 0.36), Math.min(r, 3))
    g.lineStyle(3, INK).strokeRoundedRect(x, y, w, h, r)
    g.lineStyle(1, WOOD_GRAIN, 0.65).lineBetween(x + 6, y + 5, x + w - 6, y + 5)
  }

  private drawCanopyRoof(g: Phaser.GameObjects.Graphics): void {
    const { shopX: x, shopTopY: y, shopW: w, headerH } = this
    const roofTop = y + 4
    const roofBottom = y + headerH * 0.61
    const topInset = clamp(w * 0.045, 15, 42)
    const stripeCount = Math.max(8, Math.min(18, Math.round(w / 62) * 2))
    const topStripe = (w - topInset * 2) / stripeCount
    const stripeW = w / stripeCount
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
      g.lineStyle(2, i % 2 ? 0xffffff : 0xe96950, 0.55)
      g.lineBetween(topX + topStripe * 0.45, roofTop + 8, bottomX + stripeW * 0.45, roofBottom - 5)
    }
    this.drawWoodPanel(g, x + topInset - 7, y - 2, w - topInset * 2 + 14, 13, 4)
    g.lineStyle(3, INK).lineBetween(x, roofBottom, x + topInset, roofTop)
    g.lineBetween(x + w, roofBottom, x + w - topInset, roofTop)
  }

  private drawCanopyValanceAnimated(g: Phaser.GameObjects.Graphics, tSec: number): void {
    const { shopX: x, shopTopY: y, shopW: w, headerH } = this
    const roofBottom = y + headerH * 0.61
    const stripeCount = Math.max(8, Math.min(18, Math.round(w / 62) * 2))
    const stripeW = w / stripeCount
    const baseValanceH = clamp(headerH * 0.19, 12, 27)
    for (let i = 0; i < stripeCount; i++) {
      const bottomX = x + i * stripeW
      const color = i % 2 === 0 ? CANOPY_RED : CANOPY_CREAM
      const wave = this.reducedMotion ? 0 : Math.sin(tSec * 2.1 + i * 0.65) * 1.45
      const swayX = this.reducedMotion ? 0 : Math.cos(tSec * 1.6 + i * 0.5) * 0.55
      const vh = baseValanceH + wave
      g.fillStyle(color).fillRoundedRect(bottomX + swayX, roofBottom - 1, stripeW, vh, this.canopyCorners)
      g.lineStyle(2, INK).strokeRoundedRect(bottomX + swayX, roofBottom - 1, stripeW, vh, this.canopyCorners)
      g.fillStyle(i % 2 ? 0xcbbc9d : 0x7e2426, 0.22).fillRect(bottomX + swayX + 2, roofBottom, stripeW - 4, 4)

      // Warm lantern under-glow on outer canopy scallops
      const centerScallopX = bottomX + stripeW * 0.5
      for (const st of this.lanterns) {
        const dist = Math.abs(centerScallopX - st.headX)
        if (dist < stripeW * 2.6) {
          const rimAlpha = (1 - dist / (stripeW * 2.6)) * 0.26 * st.flicker
          g.fillStyle(0xffdc78, rimAlpha).fillRoundedRect(
            bottomX + swayX + 2,
            roofBottom + vh * 0.45,
            stripeW - 4,
            vh * 0.48,
            stripeW * 0.22,
          )
        }
      }
    }
  }

  private drawStoreSign(g: Phaser.GameObjects.Graphics): void {
    const cx = this.shopX + this.shopW / 2
    const signW = clamp(this.shopW * 0.44, 170, 430)
    const signH = clamp(this.headerH * 0.53, 36, 78)
    const cy = this.shopTopY + this.headerH * 0.39
    const left = cx - signW / 2
    const top = cy - signH / 2
    this.signSheenG.lineStyle(1.8, 0xffe494, 0.25)
      .lineBetween(cx - signW * 0.44, top + 3, cx + signW * 0.44, top + 3)
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
    this.addFittedText(this.shopChrome, cx, cy - 2, 'STORE', signW - 32, signH * 0.66, '#fff5d7')
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

  private drawLanternHousing(g: Phaser.GameObjects.Graphics, frame: Phaser.GameObjects.Graphics, w: number): void {
    g.fillStyle(0xf0aa31).fillRoundedRect(-w * 0.36, -w * 0.4, w * 0.72, w * 0.96, 4)
    g.lineStyle(3, INK).strokeRoundedRect(-w * 0.36, -w * 0.4, w * 0.72, w * 0.96, 4)
    g.fillStyle(0xffd66b, 0.92).fillRoundedRect(-w * 0.24, -w * 0.29, w * 0.48, w * 0.68, 2)
    frame.fillStyle(0x34393d).fillTriangle(-w * 0.49, -w * 0.39, w * 0.49, -w * 0.39, 0, -w * 0.73)
    frame.lineStyle(2, INK).strokeTriangle(-w * 0.49, -w * 0.39, w * 0.49, -w * 0.39, 0, -w * 0.73)
    frame.fillStyle(0x34393d).fillRoundedRect(-w * 0.43, w * 0.46, w * 0.86, w * 0.15, 2)
    frame.lineStyle(2, INK).strokeRoundedRect(-w * 0.43, w * 0.46, w * 0.86, w * 0.15, 2)
    frame.lineBetween(0, -w * 0.35, 0, w * 0.48)
    frame.lineBetween(-w * 0.35, w * 0.18, w * 0.35, w * 0.18)
    frame.lineStyle(1.5, 0xfff9db, 0.65).lineBetween(-w * 0.18, -w * 0.22, -w * 0.18, w * 0.22)
    frame.lineStyle(1.2, 0xffe5a2, 0.8).lineBetween(-w * 0.31, -w * 0.32, -w * 0.31, w * 0.4)
  }

  private drawLanternAnimated(g: Phaser.GameObjects.Graphics, rig: LanternRig, tSec: number): void {
    const { pivotX, pivotY, headX, headY, swingAngle, flicker, w } = rig
    const topAttachX = headX - Math.sin(swingAngle) * w * 0.73
    const topAttachY = headY - Math.cos(swingAngle) * w * 0.73
    g.lineStyle(3, INK).lineBetween(pivotX, pivotY, topAttachX, topAttachY)
    g.lineStyle(1.5, 0x999590)
    for (let i = 0; i < 3; i++) {
      const fraction = (i + 0.5) / 3
      g.strokeEllipse(pivotX + (topAttachX - pivotX) * fraction,
        pivotY + (topAttachY - pivotY) * fraction, w * 0.14, w * 0.21)
    }
    rig.body.setPosition(headX, headY).setRotation(swingAngle === 0 ? 0 : -swingAngle)
    const flame = rig.flame
    flame.clear()
    const sway = this.reducedMotion ? 0 : Math.sin(tSec * 9.5 + rig.flickerSeed * 2.3) * w * 0.045
    const height = w * 0.44 * clamp(flicker, 0.82, 1.16)
    const baseY = w * 0.28
    flame.fillStyle(0xff7b1c, 0.92).fillTriangle(-w * 0.16, baseY, w * 0.16, baseY, sway, baseY - height)
    flame.fillStyle(0xffde59, 0.96).fillTriangle(-w * 0.11, baseY, w * 0.11, baseY, sway * 0.7, baseY - height * 0.78)
    flame.fillStyle(0xffffe8, 0.98).fillTriangle(-w * 0.055, baseY, w * 0.055, baseY, sway * 0.35, baseY - height * 0.46)
    flame.lineStyle(1.4, 0xfff0ac, 0.3 * flicker)
      .lineBetween(w * 0.29, -w * 0.25, w * 0.29, w * 0.36)
  }

  private drawBannerAnimated(
    g: Phaser.GameObjects.Graphics,
    b: BannerRig,
    tSec: number,
    lanternFlicker: number,
  ): void {
    const { x, y, w, h, phase, freq } = b
    const tipSway = this.reducedMotion ? 0 : Math.sin(tSec * freq + phase) * 2.4
    const midSway = this.reducedMotion ? 0 : Math.sin(tSec * freq + phase - 0.6) * 1.1

    g.fillStyle(CANOPY_RED)
    g.beginPath()
    g.moveTo(x - w / 2, y)
    g.lineTo(x + w / 2, y)
    g.lineTo(x + w / 2 + tipSway, y + h)
    g.lineTo(x + tipSway * 0.85, y + h - w * 0.42)
    g.lineTo(x - w / 2 + tipSway, y + h)
    g.closePath().fillPath()
    g.lineStyle(2, INK).strokePath()

    // Warm gold trim & top lantern sheen
    g.lineStyle(1.2, 0xf4a868, 0.75 + (lanternFlicker - 1) * 0.35)
    g.lineBetween(x - w / 2 + 3, y + 7, x - w / 2 + 3 + tipSway * 0.85, y + h - 7)
    g.lineBetween(x + w / 2 - 3, y + 7, x + w / 2 - 3 + tipSway * 0.85, y + h - 7)
    g.lineStyle(4, INK).lineBetween(x - w * 0.65, y, x + w * 0.65, y)
    g.lineStyle(2, GOLD).lineBetween(x - w * 0.65, y - 1, x + w * 0.65, y - 1)

    const r = w * 0.31
    const cx = x + midSway
    const cy = y + Math.min(h * 0.37, w * 1.1)
    this.drawBannerYellowBall(g, cx, cy, r, phase > 2 ? 602 : 601)
  }

  private drawBannerYellowBall(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, seed: number): void {
    const look = ballLookFor(6, seed)
    const poly = restContour(look, r, cx, cy, 32)
    const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))
    g.fillStyle(0xe0c200, 1)
    g.fillPoints(pts, true)
    const innerPts = poly.map((p) => new Phaser.Math.Vector2(
      cx + (p.x - cx) * 0.92 - r * 0.03,
      cy + (p.y - cy) * 0.92 - r * 0.04,
    ))
    g.fillStyle(0xffeb3b, 1)
    g.fillPoints(innerPts, true)
    g.lineStyle(Math.max(1.5, ballOutlineWidth(r) * 0.85), BALL_INK, 1)
    g.strokePoints(pts, true, true)
    drawBallFace(g, look, { x: cx, y: cy }, r, 1, undefined, true)
  }

  private drawBottomPropsStatic(g: Phaser.GameObjects.Graphics): void {
    const { shopX: x, shopW: w } = this
    const bottom = this.shopTopY + this.shopH
    const scale = clamp(this.footerH / 82, 0.56, 1)
    const leftBigX = x + 30 * scale + 4
    const leftSmallX = x + 67 * scale + 4
    this.drawFilledBarrel(g, leftBigX, bottom + 1, 44 * scale, 62 * scale, (innerX, openY, innerW) => {
      const offsets = [
        { dx: -0.28, dy: 1.5, r: 5.5 },
        { dx: 0.0, dy: 0.2, r: 6.0 },
        { dx: 0.27, dy: 1.4, r: 5.5 },
        { dx: -0.15, dy: 3.2, r: 5.8 },
        { dx: 0.16, dy: 3.0, r: 5.8 },
      ]
      for (const c of offsets) {
        drawCoin(g, innerX + innerW * c.dx, openY + c.dy * scale, c.r * scale)
      }
    })
    this.drawFilledBarrel(g, leftSmallX, bottom + 2, 36 * scale, 46 * scale, (innerX, openY, innerW) => {
      const offsets = [
        { dx: -0.22, dy: 1.4, r: 5.0 },
        { dx: 0.04, dy: 0.5, r: 5.4 },
        { dx: 0.24, dy: 1.8, r: 4.8 },
        { dx: -0.06, dy: 2.8, r: 5.2 },
      ]
      for (const c of offsets) {
        drawCoin(g, innerX + innerW * c.dx, openY + c.dy * scale, c.r * scale)
      }
    })
    const rightBigX = x + w - 30 * scale - 4
    const rightSmallX = x + w - 67 * scale - 4
    this.drawFilledBarrel(g, rightBigX, bottom + 1, 44 * scale, 62 * scale, (innerX, openY, innerW) => {
      const gems = [
        { dx: -0.24, dy: 1.2, r: 9.5 },
        { dx: 0.02, dy: -0.2, r: 10.5 },
        { dx: 0.24, dy: 1.4, r: 9.2 },
        { dx: -0.11, dy: 3.0, r: 9.8 },
        { dx: 0.14, dy: 2.8, r: 9.5 },
      ]
      for (const gem of gems) {
        this.drawGem(g, innerX + innerW * gem.dx, openY + gem.dy * scale, gem.r * scale)
      }
    })
    this.drawFilledBarrel(g, rightSmallX, bottom + 2, 36 * scale, 46 * scale, (innerX, openY, innerW) => {
      const gems = [
        { dx: -0.2, dy: 1.4, r: 8.2 },
        { dx: 0.05, dy: 0.4, r: 9.0 },
        { dx: 0.22, dy: 1.8, r: 8.0 },
        { dx: -0.04, dy: 2.7, r: 8.5 },
      ]
      for (const gem of gems) {
        this.drawGem(g, innerX + innerW * gem.dx, openY + gem.dy * scale, gem.r * scale)
      }
    })
  }

  private drawFoliageAnimated(g: Phaser.GameObjects.Graphics, x: number, w: number, bottom: number, tSec: number): void {
    const scale = clamp(this.footerH / 82, 0.56, 1)
    for (let idx = 0; idx < 4; idx++) {
      const gx = idx === 0 ? x + 3 : idx === 1 ? x + w - 5
        : idx === 2 ? x + 98 * scale : x + w - 95 * scale
      const sway = this.reducedMotion ? 0
        : Math.sin(tSec * 2.2 + idx * 1.35) * (2.8 * scale)
      const tipX1 = gx - 8 * scale + sway * 0.75
      const tipX2 = gx + 7 * scale + sway
      g.fillStyle(0x397c33)
      g.fillTriangle(gx - 9 * scale, bottom + 5, tipX1, bottom - 13 * scale, gx + 4 * scale, bottom + 4)
      g.fillTriangle(gx - 2 * scale, bottom + 5, tipX2, bottom - 19 * scale, gx + 9 * scale, bottom + 5)
      g.lineStyle(1.2, INK).lineBetween(gx - 9 * scale, bottom + 5, tipX1, bottom - 13 * scale)
      g.lineBetween(gx + 9 * scale, bottom + 5, tipX2, bottom - 19 * scale)
      g.lineStyle(1, 0x86b54d).lineBetween(gx, bottom + 3, tipX1 + 4 * scale, bottom - 10 * scale)
    }
  }

  private drawAtmosphereParticles(g: Phaser.GameObjects.Graphics, tSec: number): void {
    // Floating golden dust motes around lanterns
    for (const mote of this.dustMotes) {
      const rig = this.lanterns[mote.side]!
      const age = tSec + mote.phase
      const cycle = (age * 0.6) % 1
      const curX = mote.x + Math.sin(age * 1.8) * 16 + mote.vx * cycle * 8
      const curY = mote.y + mote.vy * cycle * 22
      const dist = Math.hypot(curX - rig.headX, curY - rig.headY)
      const lanternFactor = clamp(1 - dist / (rig.w * 3.8), 0, 1)
      const alpha = Math.sin(cycle * Math.PI) * (0.18 + lanternFactor * 0.55) * rig.flicker
      if (alpha > 0.04) {
        g.fillStyle(0xffe98f, alpha)
        g.fillCircle(curX, curY, mote.r * (0.8 + lanternFactor * 0.35))
      }
    }

    // Rare sparkling twinkles on coins & bottom gems
    for (const sp of this.sparkles) {
      const tw = (Math.sin(tSec * sp.speed * 0.35 + sp.phase) + 1) * 0.5
      if (tw > 0.97) {
        const scale = (tw - 0.97) / 0.03
        const curR = sp.r * scale
        g.fillStyle(sp.color, scale * 0.85)
        g.fillCircle(sp.x, sp.y, curR * 0.45)
        g.lineStyle(1.4, sp.color, scale)
        g.lineBetween(sp.x - curR, sp.y, sp.x + curR, sp.y)
        g.lineBetween(sp.x, sp.y - curR, sp.x, sp.y + curR)
      }
    }
  }

  private drawFilledBarrel(
    g: Phaser.GameObjects.Graphics,
    x: number,
    bottom: number,
    w: number,
    h: number,
    drawContents: (cx: number, openY: number, innerW: number) => void,
  ): void {
    const top = bottom - h
    const openY = top + 7
    const rimRx = (w - 2) / 2
    const rimRy = 6.5
    // 1. Back rim and dark hollow interior
    g.fillStyle(0x2a1106).fillEllipse(x, openY, w - 2, rimRy * 2)
    g.lineStyle(2.5, INK).strokeEllipse(x, openY, w - 2, rimRy * 2)
    g.lineStyle(1.5, WOOD_GRAIN, 0.7).strokeEllipse(x, openY - 0.5, w - 7, (rimRy - 1.5) * 2)
    // 2. Treasure nestled inside the open barrel mouth
    drawContents(x, openY, w - 10)
    // 3. Interior shadow gradient blending the lower edge of the treasure into the barrel
    g.fillStyle(WOOD_DARK, 0.55).fillEllipse(x, openY + rimRy * 0.45, w - 6, rimRy * 1.1)
    // 4. Front barrel stave body overlapping the lower half of the opening
    const bodyTop = openY + 1
    const bodyH = Math.max(10, bottom - bodyTop)
    g.fillStyle(WOOD_LIGHT).fillRoundedRect(x - w / 2, bodyTop, w, bodyH, { tl: 4, tr: 4, bl: 9, br: 9 })
    g.lineStyle(3, INK).strokeRoundedRect(x - w / 2, bodyTop, w, bodyH, { tl: 4, tr: 4, bl: 9, br: 9 })
    g.lineStyle(1.5, WOOD_DARK)
    for (const p of [-0.25, 0, 0.25]) g.lineBetween(x + w * p, bodyTop + 3, x + w * p * 0.85, bottom - 3)
    // Front wooden lip arc wrapping over the bottom of the coins/gems
    g.lineStyle(3, WOOD_LIGHT)
    g.beginPath().arc(x, openY, rimRx - 1, 0.08, Math.PI - 0.08, false).strokePath()
    g.lineStyle(1.5, WOOD_GRAIN, 0.85)
    g.beginPath().arc(x, openY - 0.5, rimRx - 3, 0.12, Math.PI - 0.12, false).strokePath()
    g.lineStyle(2.2, INK)
    g.beginPath().arc(x, openY + 0.5, rimRx, 0.05, Math.PI - 0.05, false).strokePath()
    // Metal hoops
    for (const bandY of [top + h * 0.32, top + h * 0.77]) {
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
    const cardW = Math.round((this.gridW - this.gap * (this.columns - 1)) / this.columns)
    const cardH = Math.round((this.gridH - this.gap) / 2)
    PRODUCTS.forEach((product, index) => {
      const page = Math.floor(index / this.pageSize)
      const slot = index % this.pageSize
      const col = slot % this.columns
      const row = Math.floor(slot / this.columns)
      const x = Math.round(page * this.pageStride + col * (cardW + this.gap))
      const y = Math.round(row * (cardH + this.gap))
      this.renderProductCard(x, y, cardW, cardH, product, page, slot, levels, balance, registered)
    })
    this.updateCardVisibility()
    this.updateBuyButtons()
    // Apply the current entrance clock before the new display objects can render.
    this.updateCardAndNavAnimations(0, this.animElapsedSec)
  }

  private renderProductCard(
    x: number, y: number, w: number, h: number, product: Product, page: number, slotIndex: number,
    levels: UpgradeLevels, balance: number, registered: boolean,
  ): void {
    const card = this.scene.add.container(Math.round(x + w / 2), Math.round(y + h / 2))
      .setSize(w, h).setName(`merchant-upgrade-${product.id}`)
    this.itemPageContainer.add(card)
    const g = this.scene.add.graphics().setName('merchant-upgrade-card')
    card.add(g)
    const left = -Math.round(w / 2)
    const top = -Math.round(h / 2)
    const padding = Math.round(clamp(w * 0.045, 8, 15))
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
    const iconR = Math.round(compact ? clamp(h * 0.19, 10, 23) : clamp(Math.min(w * 0.145, h * 0.18), 18, 42))
    const iconX = Math.round(left + padding + iconR)
    const iconY = Math.round(top + (compact ? h * 0.25 : h * 0.2))
    const art = this.scene.add.graphics().setName(`merchant-upgrade-art-${product.id}`)
    art.fillStyle(product.accent, 0.12).fillCircle(iconX, iconY, iconR * 1.12)
    this.drawProductIcon(art, product.id, iconX, iconY, iconR)
    if (!active) art.setAlpha(0.85)
    card.add(art)
    const textLeft = Math.round(iconX + iconR + padding * 0.6)
    const titleW = Math.max(1, Math.round(w / 2 - padding - textLeft))
    const titleX = Math.round(textLeft + titleW / 2)
    const titleValue = !compact && titleW < 155 ? title.replace(' ', '\n') : title
    const titleSize = Math.round(compact ? clamp(h * 0.16, 11, 17) : clamp(Math.min(w * 0.115, h * 0.115), 14, 23))
    this.addFittedText(card, titleX, Math.round(top + h * (compact ? 0.14 : 0.18)), titleValue, titleW, titleSize)
    const statusColor = status?.kind === 'success' ? '#27741b' : status?.kind === 'error' ? '#b32828' : SECONDARY_TEXT
    const detail = status?.message ?? (!compact && titleW < 125 ? benefit.replace(' / STAGE', '\n/ STAGE') : benefit)
    this.addFittedText(card, titleX, Math.round(top + h * (compact ? 0.31 : 0.32)), detail, titleW, compact ? 9 : 10, statusColor)

    const buttonH = Math.round(compact ? clamp(h * 0.28, 22, 34) : clamp(h * 0.18, 31, 44))
    const buttonW = Math.round(compact ? clamp(w * 0.32, 70, 128) : w - padding * 2 - 4)
    const buttonX = Math.round(compact ? w / 2 - padding - buttonW / 2 : 0)
    const buttonY = Math.round(top + h - buttonH / 2 - (compact ? 7 : 10))
    const statW = Math.round(compact ? Math.max(1, w - padding * 2 - buttonW - 10) : w - padding * 2)
    const statX = Math.round(compact ? left + padding + statW / 2 : 0)
    const transition = active
      ? `${this.effectValue(product.id, current)} → ${this.effectValue(product.id, Math.min(max, current + 1))}`
      : 'COMING SOON'
    const maxLabel = active ? `MAX EFFECT ${this.effectValue(product.id, max)}` : 'NOT AVAILABLE YET'
    const barH = Math.round(compact ? 5 : clamp(h * 0.045, 7, 11))
    const barY = Math.round(compact ? top + h - 8 : buttonY - buttonH / 2 - barH / 2 - 10)
    const stageY = Math.round(compact ? top + h - 20 : barY - barH / 2 - 12)
    const maxY = Math.round(compact ? top + h * 0.64 : stageY - 18)
    const effectY = Math.round(compact ? top + h * 0.47 : maxY - 23)
    this.addFittedText(card, statX, effectY, transition, statW, compact ? 12 : Math.round(clamp(h * 0.105, 17, 27)), active ? INK_HEX : '#836c54')
    this.addFittedText(card, statX, maxY, maxLabel, statW, compact ? 8 : 10, SECONDARY_TEXT)
    this.addFittedText(card, statX, stageY, active ? `STAGE ${current} / ${max}` : 'STAGE — / —', statW, compact ? 8 : 10, active ? INK_HEX : SECONDARY_TEXT)
    this.renderStageBar(card, statX, barY, statW - 4, current, max, product.accent, barH)
    const label = !active ? 'COMING SOON' : pending ? 'BUYING...' : maxed ? 'MAXED'
      : !registered ? 'ACCOUNTS ONLY' : !affordable ? `NEED ${cost}` : `${cost}`
    const available = active && registered && affordable && !maxed && !pending
    this.renderBuyButton(
      card, buttonX, buttonY, buttonW, buttonH, label,
      active && !pending && !maxed && registered, active, available, page, slotIndex, art, () => {
        if (active) void this.purchase(product.id, card.x, card.y, page)
      },
    )
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
    label: string, coin: boolean, active: boolean, available: boolean, page: number, slotIndex: number,
    art: Phaser.GameObjects.Graphics, onClick: () => void,
  ): void {
    const button = this.scene.add.container(x, y).setName(`merchant-buy-${parent.name.replace('merchant-upgrade-', '')}`)
    const g = this.scene.add.graphics()
    const sheenG = this.scene.add.graphics()
    const radius = h / 2
    g.fillStyle(INK).fillRoundedRect(-w / 2 - 1, -h / 2 + 4, w + 2, h + 1, radius)
    g.fillStyle(active ? GREEN_DARK : 0x716a59).fillRoundedRect(-w / 2, -h / 2 + 4, w, h - 1, radius)
    g.fillStyle(active ? GREEN : 0xaaa38e).fillRoundedRect(-w / 2, -h / 2, w, h - 2, radius)
    g.lineStyle(2.5, INK).strokeRoundedRect(-w / 2, -h / 2, w, h - 1, radius)
    g.fillStyle(active ? GREEN_LIGHT : 0xd1cbb6, 0.65).fillRoundedRect(-w / 2 + 10, -h / 2 + 3, Math.max(1, w - 20), Math.max(2, h * 0.16), radius * 0.3)
    button.add([g, sheenG])
    const iconSpace = coin ? Math.min(23, h * 0.7) : 0
    const text = this.addFittedText(button, 0, -1, label, w - iconSpace - 17, clamp(h * 0.43, 10, 19), '#fff9dc')
      .setStroke(INK_HEX, active ? 1.5 : 1)
    if (coin) {
      const contentW = iconSpace + 5 + text.displayWidth
      drawCoin(g, -contentW / 2 + iconSpace / 2, -1, iconSpace * 0.45)
      text.setX(iconSpace / 2 + 2.5)
    }
    const zone = this.scene.add.zone(0, 0, w, h + 5).setName('merchant-buy-hit').setInteractive({ useHandCursor: available })
    const left = -Math.round(parent.width / 2)
    const top = -Math.round(parent.height / 2)
    const cardRadius = clamp(Math.min(parent.width, parent.height) * 0.055, 5, 10)
    const hoverShadow = this.scene.add.graphics().setAlpha(0).setName('merchant-card-hover-shadow')
    hoverShadow.fillStyle(INK, 0.26).fillRoundedRect(left + 3, top + 10, parent.width, parent.height, cardRadius)
    parent.addAt(hoverShadow, 0)
    const hoverBorder = this.scene.add.graphics().setAlpha(0).setName('merchant-card-hover-border')
    hoverBorder.lineStyle(2, 0xe1ac50, 0.95)
      .strokeRoundedRect(left + 1, top + 1, parent.width - 2, parent.height - 2, cardRadius)
    const hoverZone = this.scene.add.zone(0, 0, parent.width, parent.height)
      .setName('merchant-card-hover-hit').setInteractive()
    parent.add([hoverBorder, hoverZone])

    const entry: BuyButton = {
      zone,
      hoverZone,
      button,
      sheenG,
      hoverShadow,
      hoverBorder,
      card: parent,
      art,
      page,
      slotIndex,
      available,
      baseY: parent.y,
      buttonBaseY: y,
      buttonW: w,
      buttonH: h,
      cardHovered: false,
      buttonHovered: false,
      pressed: false,
      hoverMix: 0,
      pressMix: 0,
    }
    hoverZone.on('pointerover', () => { entry.cardHovered = true })
    hoverZone.on('pointerout', () => { entry.cardHovered = false })

    let pressedState: { id: number; x: number; y: number } | null = null
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!available) return
      pressedState = { id: pointer.id, x: pointer.x, y: pointer.y }
      entry.pressed = true
    })
    zone.on('pointerover', () => {
      entry.buttonHovered = true
    })
    zone.on('pointerout', () => {
      pressedState = null
      entry.pressed = false
      entry.buttonHovered = false
    })
    zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const start = pressedState
      pressedState = null
      entry.pressed = false
      if (!available || !start || pointer.id !== start.id || this.isPageMoving()
        || this.scene.time.now < this.suppressPurchaseUntil) return
      const scale = this.scene.cameras.main.zoom || 1
      if (Math.hypot(pointer.x - start.x, pointer.y - start.y) / scale > 10) return
      onClick()
    })
    button.add(zone)
    parent.add(button)
    this.buyButtons.push(entry)
  }

  private updateCardAndNavAnimations(dt: number, tSec: number): void {
    const moving = this.isPageMoving()
    for (const entry of this.buyButtons) {
      if (entry.page !== this.currentPage && !moving) continue
      const targetHover = this.desktopHover && !this.reducedMotion && !moving
        && (entry.cardHovered || entry.buttonHovered) ? 1 : 0
      const targetPress = entry.pressed && !moving ? 1 : 0
      entry.hoverMix += (targetHover - entry.hoverMix) * clamp(dt * 12, 0, 1)
      entry.pressMix = this.reducedMotion ? targetPress
        : entry.pressMix + (targetPress - entry.pressMix) * clamp(dt * 20, 0, 1)
      if (Math.abs(targetPress - entry.pressMix) < 0.001) entry.pressMix = targetPress

      const entrance = this.entranceActive && entry.page === 0
        ? clamp((this.entranceElapsedSec - entry.slotIndex * ENTRANCE_STAGGER_SEC) / ENTRANCE_DURATION_SEC, 0, 1)
        : 1
      const entranceOffset = Math.pow(1 - entrance, 3) * 22
      entry.card.setY(Math.round(entry.baseY + entranceOffset - entry.hoverMix * 4)).setAlpha(entrance)
      entry.hoverShadow.setAlpha(entry.hoverMix)
      entry.hoverBorder.setAlpha(entry.hoverMix)
      // Only the illustration floats. Text and parchment retain a unit scale and pixel-aligned baseline.
      entry.art.setY(!this.reducedMotion && !moving && entrance === 1
        ? Math.sin(tSec * 1.6 + entry.slotIndex * 1.05) * 1.2 : 0)

      // Match the existing ChunkyButton's short, physical press; arrows already provide their own feedback.
      entry.button.setScale(1 + entry.pressMix * 0.04, 1 - entry.pressMix * 0.08)
        .setY(entry.buttonBaseY + entry.pressMix * 3)
      if (!this.reducedMotion && entry.available) {
        entry.sheenG.clear()
        const phase = (tSec * 1.35 + entry.slotIndex * 0.4) % 1
        entry.sheenG.lineStyle(1.8, 0xffe684, Math.sin(phase * Math.PI) * 0.38)
          .strokeRoundedRect(-entry.buttonW / 2 + 1, -entry.buttonH / 2 + 1,
            entry.buttonW - 2, entry.buttonH - 2, entry.buttonH / 2)
      }
    }
    if (this.celebrations.length > 0) this.updateCelebrations()
    if (this.pageCount > 1 && this.pageDotsG && !this.reducedMotion) {
      const target = moving ? clamp(-this.itemPageContainer.x / this.pageStride, 0, this.pageCount - 1) : this.currentPage
      if (Math.abs(target - this.visualPageProgress) > 0.001) {
        this.visualPageProgress += (target - this.visualPageProgress) * clamp(dt * 14, 0, 1)
        if (Math.abs(target - this.visualPageProgress) < 0.001) this.visualPageProgress = target
        this.renderDotsGraphic(this.pageDotsG)
      }
    }
  }

  private updateCelebrations(): void {
    const cg = this.celebrationG
    cg.clear()
    if (this.celebrations.length === 0) return
    const now = this.animElapsedSec
    const moving = this.isPageMoving()
    for (let i = this.celebrations.length - 1; i >= 0; i--) {
      const c = this.celebrations[i]!
      const age = now - c.bornAt
      if (age >= c.duration) {
        const last = this.celebrations.pop()!
        if (i < this.celebrations.length) this.celebrations[i] = last
        continue
      }
      if (c.page !== this.currentPage && !moving) continue
      const progress = age / c.duration
      const count = 12
      const burstR = (1 - Math.pow(1 - progress, 2)) * 64
      const alpha = (1 - progress) * 0.95
      const radius = 3 * (1 - progress * 0.5)
      const coinRadius = 4.5 * (1 - progress * 0.4)
      for (let p = 0; p < count; p++) {
        const angle = (p / count) * Math.PI * 2
        const px = c.x + this.itemPageContainer.x + Math.cos(angle) * burstR
        const py = c.y + Math.sin(angle) * burstR - progress * 24
        cg.fillStyle(p % 2 ? 0xffdf5e : 0xffa436, alpha)
        cg.fillCircle(px, py, radius)
        if (p % 3 === 0) {
          drawCoin(cg, px, py, coinRadius)
        }
      }
    }
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
    let fontSize = Math.max(8, Math.round(size))
    const text = hudText(this.scene, Math.round(x), Math.round(y), value, 1, {
      color, size: fontSize, stroke: 0, pad: 1, origin: [0.5, 0.5], shadow: false,
    }).setStroke(INK_HEX, 0).setAlign('center')
    if (fontSize < 10) text.setFontSize(fontSize)
    while (text.width > maxWidth && fontSize > 8) {
      fontSize = Math.max(8, Math.min(fontSize - 1, Math.floor(fontSize * maxWidth / text.width)))
      text.setFontSize(fontSize)
    }
    // Wrap unusually long labels rather than turning their text canvas into a tiny bitmap.
    if (text.width > maxWidth) text.setWordWrapWidth(Math.max(1, maxWidth - 2), true)
    parent.add(text)
    return text
  }

  private renderBottomNav(): void {
    this.navContainer.removeAll(true)
    const centerX = Math.round(this.shopX + this.shopW / 2)
    const bottom = Math.round(this.shopTopY + this.shopH)
    const dotsY = bottom - this.footerH + 10
    const dots = this.scene.add.graphics().setName('merchant-page-dots')
    this.pageDotsG = dots
    this.renderDotsGraphic(dots)
    const dotGap = 20
    if (this.pageCount > 1) {
      for (let i = 0; i < this.pageCount; i++) {
        const dotX = centerX + (i - (this.pageCount - 1) / 2) * dotGap
        const zone = this.scene.add.zone(dotX, dotsY, 20, 26).setName(`merchant-page-${i + 1}`).setInteractive({ useHandCursor: true })
        zone.on('pointerup', () => this.setPage(i))
        this.navContainer.add(zone)
      }
    }
    this.navContainer.add(dots)
    const readoutW = Math.round(clamp(this.shopW * 0.38, 164, 290))
    const readoutH = Math.round(clamp(this.footerH * 0.5, 28, 43))
    const readoutY = Math.round(bottom - readoutH / 2 - 5)
    const readout = this.scene.add.container(centerX, readoutY).setName('merchant-coin-balance')
    const g = this.scene.add.graphics()
    const pillR = readoutH / 2
    const innerR = Math.max(4, (readoutH - 8) / 2)
    const wellR = Math.max(3, (readoutH - 12) / 2)
    g.fillStyle(INK, 0.45).fillRoundedRect(-readoutW / 2 + 1, -readoutH / 2 + 3, readoutW, readoutH, pillR)
    g.fillStyle(WOOD_LIGHT).fillRoundedRect(-readoutW / 2, -readoutH / 2, readoutW, readoutH, pillR)
    g.lineStyle(2.5, INK, 1).strokeRoundedRect(-readoutW / 2, -readoutH / 2, readoutW, readoutH, pillR)
    g.fillStyle(WOOD_DARK).fillRoundedRect(-readoutW / 2 + 5, -readoutH / 2 + 5, readoutW - 10, readoutH - 10, wellR)
    g.lineStyle(1.5, GOLD, 0.85).strokeRoundedRect(-readoutW / 2 + 4, -readoutH / 2 + 4, readoutW - 8, readoutH - 8, innerR)
    readout.add(g)
    const balanceLabel = `${formatCoins(Number(loadSave().coins) || 0)} COINS`
    const coinR = Math.round(readoutH * 0.28)
    const gap = Math.round(clamp(readoutH * 0.22, 6, 10))
    const maxTextW = readoutW - coinR * 2 - gap - 24
    const textObj = this.addFittedText(
      readout,
      0,
      0,
      balanceLabel,
      maxTextW,
      Math.round(clamp(readoutH * 0.46, 12, 19)),
      '#ffe289',
    )
    const totalContentW = coinR * 2 + gap + textObj.width
    const startX = -totalContentW / 2
    const coinX = Math.round(startX + coinR)
    const textX = Math.round(startX + coinR * 2 + gap + textObj.width / 2)
    textObj.setX(textX)
    drawCoin(g, coinX, 0, coinR)
    this.navContainer.add(readout)
    const arrowY = Math.round(this.gridY + this.gridH * 0.5)
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
        disabledFill: 0x181b24,
        disabledShadowColor: 0x090b10,
        disabledHighlightColor: 0x3b4254,
        disabledKeepOpaque: true,
        textColor: '#ffe9ac',
        onClick: () => this.setPage(this.currentPage + direction),
      })
      arrow.container.setName(direction < 0 ? 'merchant-prev' : 'merchant-next').setAlpha(1)
      arrow.setDisabled(atEnd)
      this.navContainer.add(arrow.container)
    }
  }

  private renderDotsGraphic(dots: Phaser.GameObjects.Graphics): void {
    dots.clear()
    const centerX = Math.round(this.shopX + this.shopW / 2)
    const bottom = Math.round(this.shopTopY + this.shopH)
    const dotsY = bottom - this.footerH + 10
    const dotGap = 20
    for (let i = 0; i < this.pageCount; i++) {
      const dotX = centerX + (i - (this.pageCount - 1) / 2) * dotGap
      const dist = Math.abs(i - this.visualPageProgress)
      const activeFraction = clamp(1 - dist, 0, 1)
      dots.fillStyle(INK, 0.7).fillCircle(dotX, dotsY + 1, 5)
      if (activeFraction > 0.05) {
        const pillW = 7 + activeFraction * 8
        dots.fillStyle(GOLD, 0.95).fillRoundedRect(dotX - pillW / 2, dotsY - 3.5, pillW, 7, 3.5)
      } else {
        dots.fillStyle(0xd0a673, 0.55).fillCircle(dotX, dotsY, 3.5)
      }
    }
  }

  private isPageMoving(): boolean {
    return !!this.pageTween || !!this.drag?.dragging
      || Math.abs(this.itemPageContainer.x + this.currentPage * this.pageStride) > 0.5
  }

  private updateBuyButtons(): void {
    const moving = this.isPageMoving()
    for (const entry of this.buyButtons) {
      const current = entry.page === this.currentPage && !moving
      if (entry.zone.input) entry.zone.input.enabled = entry.available && current
      if (entry.hoverZone.input) entry.hoverZone.input.enabled = this.desktopHover && current
      if (!current) {
        entry.cardHovered = false
        entry.buttonHovered = false
        entry.pressed = false
      }
    }
  }

  private updateCardVisibility(): void {
    const moving = this.isPageMoving()
    if (this.maskFilter) {
      this.maskFilter.active = moving
    }
    for (const entry of this.buyButtons) {
      entry.card.setVisible(moving || entry.page === this.currentPage)
    }
  }

  private setPage(page: number): void {
    if (this.destroyed) return
    this.drag = null
    this.currentPage = clamp(page, 0, this.pageCount - 1)
    this.scene.tweens.killTweensOf(this.itemPageContainer)
    this.pageTween = null
    this.pageTweenPaused = false
    const target = -this.currentPage * this.pageStride
    if (this.reducedMotion || Math.abs(this.itemPageContainer.x - target) < 0.5) {
      this.itemPageContainer.setX(target)
      if (this.reducedMotion) this.visualPageProgress = this.currentPage
    } else {
      this.pageTween = this.scene.tweens.add({
        targets: this.itemPageContainer,
        x: target,
        duration: 270,
        ease: 'Cubic.Out',
        onComplete: () => {
          if (this.destroyed) return
          this.pageTween = null
          this.pageTweenPaused = false
          this.updateCardVisibility()
          this.updateBuyButtons()
        },
      })
      if (!this.isVisible()) {
        this.pageTween.pause()
        this.pageTweenPaused = true
      }
    }
    // Assign the tween first so both outgoing and incoming cards stay visible and masked.
    this.updateCardVisibility()
    this.updateBuyButtons()
    this.renderBottomNav()
  }

  private beginDrag(pointer: Phaser.Input.Pointer): void {
    if (this.destroyed || !this.isVisible() || this.pageCount < 2 || this.drag) return
    const point = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerPoint)
    if (point.x < this.gridX || point.x > this.gridX + this.gridW || point.y < this.gridY || point.y > this.gridY + this.gridH) return
    this.scene.tweens.killTweensOf(this.itemPageContainer)
    this.pageTween = null
    this.pageTweenPaused = false
    this.drag = {
      pointerId: pointer.id,
      startX: point.x, startY: point.y, lastX: point.x, lastAt: this.scene.time.now,
      originX: this.itemPageContainer.x, velocity: 0, dragging: false,
    }
    this.updateCardVisibility()
    this.updateBuyButtons()
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
      this.updateCardVisibility()
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

  private async purchase(id: UpgradeId, burstX: number, burstY: number, page: number): Promise<void> {
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
      if (error) {
        this.purchaseStatus.set(id, { kind: 'error', message: error.message || 'PURCHASE FAILED' })
      } else {
        this.purchaseStatus.set(id, { kind: 'success', message: 'PURCHASED!' })
        if (!this.reducedMotion) {
          this.celebrations.push({
            x: burstX,
            y: burstY,
            page,
            bornAt: this.animElapsedSec,
            duration: 0.65,
          })
        }
      }
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