import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { MAX_RENDER_DPR } from '../../config/stage'
import { COLLECTIBLE_TIERS, collectionDiscovery, collectionSlotsFor } from '../../config/collectibleCollection'
import type { KingdomMenuArtwork } from '../../react/kingdomMenuBridge'
import { authService } from '../../services/auth'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { resolveKingdomMenuLayout, type KingdomMenuLayout } from '../../ui/KingdomMenuLayout'
import {
  ballLookFor, ballOutlineWidth, drawBallFace, drawCollectibleBall, expressionAt, restContour,
  type BallExpression, type BallLook,
} from './BallAppearance'
import { INK_NUM, bakeKingdomLogo, bakeKingdomRushWord, clamp } from './KingdomMenuArt'
import { bakeThroneVaultHall } from './KingdomStallArt'
import { bakeKingdomMenuArtwork } from './KingdomMenuArtwork'
import { KINGDOM_GLOW_KEY, KingdomMenuEffects } from './KingdomMenuEffects'
import { bakeRoundTableCarousel } from './KingdomWidgetsArt'
import { loadSave, type SaveDataV1 } from '../state/save'
import { cycleColor } from './rgbCycle'

const INK = INK_NUM

interface HeroBall {
  container: Phaser.GameObjects.Container
  graphics: Phaser.GameObjects.Graphics
  tier: number
  theme?: string
  name: string
  status: string
  variant: number
  seed: number
  radius: number
  contour: Array<{ x: number; y: number }>
  outlineWidth: number
  visualRadius: number
  baseAngle: number
  x: number
  y: number
  depth: number
  phase: number
  speed: number
  blinkClosed: boolean
  blinkRemaining: number
  look: BallLook
  blinkLook: BallLook
  expression: BallExpression
  lastBlink: boolean
  gazeX: number
  gazeY: number
  jump: number
}

const MAX_BACKGROUND_TEXTURE_EDGE = 2048
const MAX_BACKGROUND_TEXTURE_PIXELS = 2_097_152
const NEUTRAL_GAZE = { x: 0, y: 0 } as const
const ROUND_TABLE_CAPACITY = 8

interface HeroSpec {
  key: string
  tier: number
  theme?: string
  variant: number
  name: string
  status: string
}

const CORE_HERO_META: Record<number, { name: string; status: string }> = {
  1: { name: 'Sunny', status: 'FIRST DROP' },
  2: { name: 'Berry', status: 'SWEET SPARK' },
  3: { name: 'Minty', status: 'FRESH BOUNCE' },
  4: { name: 'Tangerine', status: 'CITRUS GUARD' },
  5: { name: 'Classic Hero', status: 'HOUSE CLASSIC' },
  6: { name: 'Plum', status: 'VELVET KNIGHT' },
  7: { name: 'Coral', status: 'CROWN JEWEL' },
  8: { name: 'RGB Champion', status: 'PRISMATIC CROWN' },
}

const COLLECTIBLE_HERO_META: Record<string, { name: string; status: string }> = {
  shark: { name: 'Shark', status: 'TIDEKEEPER' },
  pig: { name: 'Pig', status: 'HEART OF THE HALL' },
  pirate: { name: 'Pirate', status: 'THE HIGH SEAS' },
  drunko: { name: 'Drunko', status: 'ROYAL TOAST' },
  robo: { name: 'Robo', status: 'IRON GUARD' },
  crab: { name: 'Crab', status: 'SHELL SENTINEL' },
}

export function unlockedRoundTablePool(save: SaveDataV1 = loadSave()): HeroSpec[] {
  const pool: HeroSpec[] = []
  for (let tier = 1; tier <= 8; tier++) {
    if (save.discovered[String(tier)] == null) continue
    const meta = CORE_HERO_META[tier] ?? { name: `Tier ${tier}`, status: 'ROYAL GUARD' }
    pool.push({ key: `core:${tier}`, tier, variant: 0, name: meta.name, status: meta.status })
  }
  for (const tier of COLLECTIBLE_TIERS) {
    for (const slot of collectionSlotsFor(tier)) {
      if (!slot.theme) continue
      const found = collectionDiscovery(save.variants, tier, slot.theme)
      if (!found) continue
      const meta = COLLECTIBLE_HERO_META[slot.theme] ?? {
        name: slot.label ?? slot.theme.toUpperCase(),
        status: `TIER ${tier} CHAMPION`,
      }
      pool.push({
        key: `collectible:${tier}:${slot.theme}`,
        tier,
        theme: slot.theme,
        variant: found.variant,
        name: meta.name,
        status: meta.status,
      })
    }
  }
  return pool
}

export function selectRoundTableSpecs(
  pool: readonly HeroSpec[],
  maxCount = ROUND_TABLE_CAPACITY,
  rng: () => number = Math.random,
): HeroSpec[] {
  if (pool.length <= maxCount) return [...pool]
  const copy = [...pool]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = tmp
  }
  return copy.slice(0, maxCount)
}

type PointerLike = Phaser.Input.Pointer

/** Animated throne hall and Round Table artwork. Native React controls own menu labels and hit targets. */
export class KingdomMenuView {
  private readonly root: Phaser.GameObjects.Container
  private readonly decorations: Phaser.GameObjects.Container
  private readonly effects: KingdomMenuEffects
  private hall: Phaser.GameObjects.Image | null = null
  private logo: Phaser.GameObjects.Container | null = null
  private logoRush: Phaser.GameObjects.Image | null = null
  private logoRushBaseY = 0
  private logoRushBaseScaleX = 1
  private logoRushBaseScaleY = 1
  private logoSparkles: Phaser.GameObjects.Graphics | null = null
  private carousel: Phaser.GameObjects.Container | null = null
  private carouselGlow: Phaser.GameObjects.Image | null = null
  private heroLayer: Phaser.GameObjects.Container | null = null
  private ribbon: Phaser.GameObjects.Container | null = null
  private ribbonName: Phaser.GameObjects.Text | null = null
  private ribbonStatus: Phaser.GameObjects.Text | null = null
  private readonly heroes: HeroBall[] = []
  private layout: KingdomMenuLayout | null = null
  private artwork: KingdomMenuArtwork | null = null
  private animationTime = 0
  private entranceElapsed = 0
  private entrancePlayed = false
  private entranceActive = false
  private ribbonRemaining = 0
  private carouselRotation = 0
  private carouselVelocity = 0
  private pointerDownX = 0
  private pointerDownY = 0
  private pointerLastX = 0
  private pointerId: number | null = null
  private pointerDragging = false
  private pressedHero: HeroBall | null = null
  private renderedDpr = 0
  private unlockedSignature = ''
  private selectedSpecs: HeroSpec[] = []
  private destroyed = false
  private pageHidden = false
  private readonly pointerWorld = new Phaser.Math.Vector2()
  private readonly gaze = { x: 0, y: 0 }
  private readonly onVisibilityChange: () => void
  private readonly onPointerDown = (pointer: PointerLike): void => { this.pointerDown(pointer) }
  private readonly onPointerMove = (pointer: PointerLike): void => { this.pointerMove(pointer) }
  private readonly onPointerUp = (pointer: PointerLike): void => { this.pointerUp(pointer) }

  constructor(private readonly scene: Phaser.Scene, parent: Phaser.GameObjects.Container, private readonly reducedMotion: boolean) {
    this.root = scene.add.container(0, 0).setName('kingdom-menu-root')
    this.decorations = scene.add.container(0, 0).setName('kingdom-noninteractive-art')
    this.effects = new KingdomMenuEffects(scene, reducedMotion)
    this.root.add([this.effects.ambient, this.effects.surface, this.effects.sunbeams, this.effects.banners, this.effects.chandeliers, this.decorations, this.effects.particles])
    parent.add(this.root)
    this.onVisibilityChange = () => { this.pageHidden = document.hidden }
    this.onVisibilityChange()
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    scene.input.on('pointerdown', this.onPointerDown)
    scene.input.on('pointermove', this.onPointerMove)
    scene.input.on('pointerup', this.onPointerUp)
    scene.input.on('pointerupoutside', this.onPointerUp)
  }

  build(width: number, height: number): void {
    if (this.destroyed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const previous = this.layout
    this.layout = resolveKingdomMenuLayout(width, height, readSafeArea(), authService.isAuthenticated())
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR)
    this.artwork = bakeKingdomMenuArtwork(this.scene, this.layout, dpr)
    const pool = unlockedRoundTablePool(loadSave())
    const nextSignature = pool.map((item) => `${item.key}:${item.variant}`).join('|')
    const collectionChanged = nextSignature !== this.unlockedSignature
    if (collectionChanged || this.selectedSpecs.length === 0) {
      this.unlockedSignature = nextSignature
      this.selectedSpecs = selectRoundTableSpecs(pool, ROUND_TABLE_CAPACITY)
    }
    const layoutUnchanged =
      previous?.width === width &&
      previous.height === height &&
      this.renderedDpr === dpr &&
      previous.logo.x === this.layout.logo.x &&
      previous.logo.y === this.layout.logo.y &&
      previous.logo.w === this.layout.logo.w &&
      previous.carousel.x === this.layout.carousel.x &&
      previous.carousel.y === this.layout.carousel.y &&
      previous.carousel.w === this.layout.carousel.w &&
      previous.carousel.h === this.layout.carousel.h
    if (layoutUnchanged) {
      if (previous.buttons[previous.buttons.length - 1]?.action === this.layout.buttons[previous.buttons.length - 1]?.action) this.layout = previous
      if (collectionChanged && this.carousel) {
        this.clearRoundTable()
        this.buildRoundTable(dpr)
      }
      return
    }
    this.renderedDpr = dpr
    this.clearArtwork()
    const backgroundDpr = Math.min(dpr, MAX_BACKGROUND_TEXTURE_EDGE / Math.max(Math.ceil(width), Math.ceil(height)), Math.sqrt(MAX_BACKGROUND_TEXTURE_PIXELS / (Math.ceil(width) * Math.ceil(height))))
    this.hall = bakeThroneVaultHall(this.scene, this.layout, backgroundDpr)
    this.root.addAt(this.hall, 0)
    this.effects.build(this.layout)
    const logoRect = this.layout.logo
    this.logo = this.scene.add.container(logoRect.x + logoRect.w / 2, logoRect.y + logoRect.h / 2)
    const logoBase = bakeKingdomLogo(this.scene, logoRect.w, logoRect.h, dpr, false)
    this.logoRush = bakeKingdomRushWord(this.scene, logoRect.w, logoRect.h, dpr)
    this.logoRushBaseY = this.logoRush.y
    this.logoRushBaseScaleX = this.logoRush.scaleX
    this.logoRushBaseScaleY = this.logoRush.scaleY
    this.logoSparkles = this.scene.add.graphics()
    this.logo.add([logoBase, this.logoRush, this.logoSparkles])
    this.decorations.add(this.logo)
    this.buildRoundTable(dpr)
    this.entranceActive = !this.entrancePlayed && !this.reducedMotion
    this.entrancePlayed = true
    this.entranceElapsed = 0
    this.applyEntrance(this.entranceActive ? 0 : 1)
    this.renderLogoSparkles(this.reducedMotion ? 0 : this.animationTime)
  }

  getLayout(): KingdomMenuLayout | null { return this.layout }
  getArtwork(): KingdomMenuArtwork | null { return this.artwork }
  getChipRect(): { x: number; y: number; w: number; h: number } | null {
    return this.layout ? { ...this.layout.stats } : null
  }
  getLogoBox(): { w: number; h: number; y: number } | null {
    return this.layout ? { w: this.layout.logo.w, h: this.layout.logo.h, y: this.layout.logo.y + this.layout.logo.h / 2 } : null
  }
  getCastInfo(): Array<{ x: number; y: number; tier: number; r: number; glassX: number; glassY: number; glassRadius: number; theme?: string; name: string; depth: number }> {
    if (!this.carousel) return []
    const matrix = this.carousel.getWorldTransformMatrix()
    const center = matrix.transformPoint(this.layout!.carousel.w * 0.5, this.layout!.carousel.h * 0.55)
    const scale = Math.max(this.carousel.scaleX, this.carousel.scaleY)
    return this.heroes.map((hero) => {
      const world = hero.container.getWorldTransformMatrix()
      return {
        x: world.tx,
        y: world.ty - hero.radius * 0.54 * Math.max(hero.container.scaleX, hero.container.scaleY) * scale,
        tier: hero.tier,
        r: hero.visualRadius * Math.max(hero.container.scaleX, hero.container.scaleY) * scale,
        glassX: center.x,
        glassY: center.y,
        glassRadius: Math.min(this.layout!.carousel.w, this.layout!.carousel.h) * 0.4 * scale,
        theme: hero.theme,
        name: hero.name,
        depth: hero.depth,
      }
    })
  }
  getAnimationState(): { time: number; entrance: boolean; active: boolean; dustMotes: number; chandeliers: number; banners: number; carouselPedestals: number; carouselRotation: number } {
    return {
      time: this.animationTime,
      entrance: this.entranceActive,
      active: this.isVisible() && !this.reducedMotion,
      dustMotes: this.layout && !this.reducedMotion ? 30 : 0,
      chandeliers: this.layout ? 2 : 0,
      banners: this.layout ? 4 : 0,
      carouselPedestals: this.layout ? 8 : 0,
      carouselRotation: this.carouselRotation,
    }
  }
  setVisible(visible: boolean): void { if (!this.destroyed) this.root.setVisible(visible) }

  update(_time: number, deltaMs: number): void {
    if (!this.layout || !this.isVisible()) return
    const dt = Number.isFinite(deltaMs) ? clamp(deltaMs / 1000, 0, 0.05) : 0
    if (!this.reducedMotion) this.animationTime += dt
    const t = this.animationTime
    if (this.entranceActive) {
      this.entranceElapsed += dt
      const progress = Math.min(1, this.entranceElapsed / 0.72)
      this.applyEntrance(progress)
      if (progress === 1) this.entranceActive = false
    } else {
      this.logo!.y = this.layout.logo.y + this.layout.logo.h / 2 + (this.reducedMotion ? 0 : Math.sin(t * 0.95) * 1.8)
      this.logo!.rotation = this.reducedMotion ? 0 : Math.sin(t * 0.61) * 0.003
      if (this.logoRush) {
        const rushWave = this.reducedMotion ? 0 : Math.sin(t * 2.35)
        this.logoRush.setScale(this.logoRushBaseScaleX * (1 + rushWave * 0.038), this.logoRushBaseScaleY * (1 + (this.reducedMotion ? 0 : Math.sin(t * 2.35 + 0.45) * 0.044)))
        this.logoRush.y = this.logoRushBaseY + (this.reducedMotion ? 0 : Math.cos(t * 2.35) * 1.6)
        this.logoRush.rotation = this.reducedMotion ? 0 : Math.sin(t * 1.45) * 0.016
      }
    }
    const pointer = this.scene.input.activePointer
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorld)
    this.gaze.x = clamp((world.x - this.layout.width / 2) / Math.max(1, this.layout.width / 2), -1, 1)
    this.gaze.y = clamp((world.y - this.layout.height / 2) / Math.max(1, this.layout.height / 2), -1, 1)
    if (!this.reducedMotion && !this.pointerDragging) {
      this.carouselVelocity *= Math.pow(0.075, dt)
      this.carouselRotation += this.carouselVelocity * dt
      this.carouselRotation += dt * 0.18
    } else if (this.reducedMotion) {
      this.carouselVelocity = 0
    }
    this.updateCarousel(t, dt)
    this.effects.update(t)
    this.renderLogoSparkles(t)
    if (this.ribbonRemaining > 0) {
      this.ribbonRemaining = Math.max(0, this.ribbonRemaining - dt)
      this.ribbon?.setAlpha(Math.min(1, this.ribbonRemaining * 3))
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.scene.input.off('pointerdown', this.onPointerDown)
    this.scene.input.off('pointermove', this.onPointerMove)
    this.scene.input.off('pointerup', this.onPointerUp)
    this.scene.input.off('pointerupoutside', this.onPointerUp)
    this.clearArtwork()
    this.effects.destroy()
    this.root.destroy(true)
    this.layout = null
    this.artwork = null
  }

  private isVisible(): boolean {
    if (this.destroyed || this.pageHidden || !this.scene.sys.isVisible()) return false
    let ancestor: Phaser.GameObjects.Container | null = this.root
    while (ancestor) {
      if (!ancestor.visible) return false
      ancestor = ancestor.parentContainer
    }
    return true
  }

  private clearArtwork(): void {
    this.hall?.destroy()
    this.hall = null
    this.decorations.removeAll(true)
    this.effects.clear()
    this.logo = null
    this.logoRush = null
    this.logoSparkles = null
    this.clearRoundTable()
  }

  private clearRoundTable(): void {
    this.carouselGlow?.destroy()
    this.carouselGlow = null
    this.carousel?.destroy(true)
    this.carousel = null
    this.heroLayer = null
    this.ribbon = null
    this.ribbonName = null
    this.ribbonStatus = null
    this.heroes.length = 0
    this.ribbonRemaining = 0
    this.pressedHero = null
  }

  private buildRoundTable(dpr: number): void {
    const rect = this.layout!.carousel
    const u = Math.min(rect.w, rect.h) / 100
    this.carouselGlow = this.scene.add.image(rect.x + rect.w / 2, rect.y + rect.h * 0.6, KINGDOM_GLOW_KEY)
      .setDisplaySize(rect.w * 1.35, rect.h * 0.72).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.13)
    this.decorations.add(this.carouselGlow)
    const { backImg } = bakeRoundTableCarousel(this.scene, rect.w, rect.h, u, dpr)
    const cx = rect.w * 0.5
    const cy = rect.h * 0.455
    const rx = rect.w * 0.305
    const ry = rect.h * 0.096
    const radius = Math.max(9, Math.min(rect.w, rect.h) * 0.072)
    this.heroLayer = this.scene.add.container(0, 0).setName('round-table-hero-pedestals')
    this.carousel = this.scene.add.container(rect.x, rect.y, [backImg, this.heroLayer]).setName('round-table-of-heroes')
    this.decorations.add(this.carousel)
    const specs = this.selectedSpecs
    specs.forEach((spec, index) => {
      const graphics = this.scene.add.graphics()
      const pedestal = this.scene.add.graphics()
      // Raised 3D stone-and-gold podium with velvet cushion resting ON TOP of the table
      pedestal.fillStyle(0x141020, 0.42).fillEllipse(0, radius * 0.24, radius * 1.38, radius * 0.42)
      pedestal.fillStyle(0x524661, 1).fillRoundedRect(-radius * 0.82, -radius * 0.34, radius * 1.64, radius * 0.56, radius * 0.18)
      pedestal.lineStyle(Math.max(1.3, radius * 0.12), INK, 1).strokeRoundedRect(-radius * 0.82, -radius * 0.34, radius * 1.64, radius * 0.56, radius * 0.18)
      pedestal.fillStyle(0xd9a648, 1).fillEllipse(0, -radius * 0.32, radius * 1.56, radius * 0.38)
      pedestal.lineStyle(Math.max(1.1, radius * 0.1), INK, 1).strokeEllipse(0, -radius * 0.32, radius * 1.56, radius * 0.38)
      pedestal.fillStyle(0x9e2a45, 1).fillEllipse(0, -radius * 0.36, radius * 1.26, radius * 0.28)
      pedestal.fillStyle(0xd64d68, 0.75).fillEllipse(-radius * 0.16, -radius * 0.39, radius * 0.62, radius * 0.12)
      // Elevate ballContainer so the bottom of the ball rests cleanly on the podium cushion
      const ballContainer = this.scene.add.container(0, -radius * 1.22, [graphics])
      const container = this.scene.add.container(0, 0, [pedestal, ballContainer])
      this.heroLayer!.add(container)
      const seed = 8800 + index * 113 + spec.tier * 17
      const look = ballLookFor(spec.tier, seed)
      const contour = restContour(look, radius, 0, 0)
      const outlineWidth = Math.min(ballOutlineWidth(radius), radius * 0.28)
      const visualRadius = spec.tier >= 9 ? radius * 1.2 : contour.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), 0) + outlineWidth * 0.5
      const baseAngle = index / specs.length * Math.PI * 2 - Math.PI / 2
      const initialX = cx + Math.cos(baseAngle) * rx
      const initialY = cy + Math.sin(baseAngle) * ry
      const hero: HeroBall = {
        container,
        graphics,
        tier: spec.tier,
        theme: spec.theme,
        name: spec.name,
        status: spec.status,
        variant: spec.variant,
        seed,
        radius,
        contour,
        outlineWidth,
        visualRadius,
        baseAngle,
        x: initialX,
        y: initialY,
        depth: 0.5,
        phase: index * 0.82,
        speed: 0.7 + index * 0.045,
        blinkClosed: false,
        blinkRemaining: 1500 + index * 390,
        look,
        blinkLook: { ...look, eyeH: look.eyeH * 0.12 },
        expression: 'normal',
        lastBlink: false,
        gazeX: 0,
        gazeY: 0,
        jump: 0,
      }
      this.heroes.push(hero)
      this.drawHero(hero, 0, NEUTRAL_GAZE)
    })
    this.buildRibbon(rect)
    this.updateCarousel(this.reducedMotion ? 0 : this.animationTime, 0)
  }

  private buildRibbon(rect: { x: number; y: number; w: number; h: number }): void {
    const plate = this.scene.add.graphics()
    const ribbonW = Math.min(rect.w * 0.72, 340)
    const ribbonH = Math.max(32, Math.min(rect.h * 0.18, 58))
    plate.fillStyle(0x59213b, 0.98).fillRoundedRect(-ribbonW / 2, -ribbonH / 2, ribbonW, ribbonH, 7)
    plate.lineStyle(2.2, INK).strokeRoundedRect(-ribbonW / 2, -ribbonH / 2, ribbonW, ribbonH, 7)
    plate.lineStyle(1.1, 0xe6bc66).strokeRoundedRect(-ribbonW / 2 + 5, -ribbonH / 2 + 4, ribbonW - 10, ribbonH - 8, 4)
    const ribbon = this.scene.add.container(rect.x + rect.w / 2, rect.y + rect.h * 0.05, [plate])
      .setName('round-table-royal-ribbon').setAlpha(0)
    const name = this.scene.add.text(0, -ribbonH * 0.17, '', { fontFamily: 'Lilita One, Arial Black, sans-serif', fontSize: `${Math.max(13, Math.round(ribbonH * 0.31))}px`, color: '#fff3c9', stroke: '#111625', strokeThickness: 3 }).setOrigin(0.5)
    const status = this.scene.add.text(0, ribbonH * 0.2, '', { fontFamily: 'Lilita One, Arial Black, sans-serif', fontSize: `${Math.max(8, Math.round(ribbonH * 0.18))}px`, color: '#eac676', stroke: '#111625', strokeThickness: 2 }).setOrigin(0.5)
    ribbon.add([name, status])
    this.ribbon = ribbon
    this.ribbonName = name
    this.ribbonStatus = status
    this.decorations.add(ribbon)
  }

  private updateCarousel(t: number, dt: number): void {
    if (!this.carousel || !this.heroLayer || !this.layout) return
    const rect = this.layout.carousel
    const cx = rect.w * 0.5
    const cy = rect.h * 0.455
    const rx = rect.w * 0.305
    const ry = rect.h * 0.096
    for (const hero of this.heroes) {
      const angle = hero.baseAngle + this.carouselRotation
      const front = (Math.sin(angle) + 1) * 0.5
      hero.depth = front
      const targetX = cx + Math.cos(angle) * rx
      const targetY = cy + Math.sin(angle) * ry
      hero.x += (targetX - hero.x) * Math.min(1, dt * 12)
      hero.y += (targetY - hero.y) * Math.min(1, dt * 12)
      hero.blinkRemaining -= dt * 1000
      if (hero.blinkRemaining <= 0) {
        hero.blinkClosed = !hero.blinkClosed
        hero.blinkRemaining = hero.blinkClosed ? 115 : 2400 + ((hero.seed * 73 + Math.floor(t) * 281) % 2600)
      }
      if (hero.jump > 0) hero.jump = Math.max(0, hero.jump - dt * 2.9)
      const squash = this.reducedMotion ? 0 : Math.sin(t * hero.speed * 2 + hero.phase) * 0.018
      const depthScale = 0.72 + front * 0.34
      const jumpProgress = hero.jump > 0 ? Math.sin((1 - hero.jump) * Math.PI) : 0
      hero.container.setPosition(hero.x, hero.y - jumpProgress * hero.radius * 0.8).setScale(depthScale * (1 + squash + jumpProgress * 0.13), depthScale * (1 - squash - jumpProgress * 0.08))
      hero.container.setRotation(this.reducedMotion ? 0 : Math.sin(t * hero.speed * 0.7 + hero.phase) * 0.025)
      const expression = this.reducedMotion ? 'normal' : expressionAt(hero.seed, t * 1000)
      if (hero.tier === 8 || hero.expression !== expression || hero.lastBlink !== hero.blinkClosed || Math.abs(hero.gazeX - this.gaze.x) + Math.abs(hero.gazeY - this.gaze.y) > 0.08) {
        hero.expression = expression
        hero.lastBlink = hero.blinkClosed
        hero.gazeX = this.gaze.x
        hero.gazeY = this.gaze.y
        this.drawHero(hero, t * 1000, this.gaze)
      }
    }
    this.heroLayer.list.sort((a, b) => (a as Phaser.GameObjects.Container).y - (b as Phaser.GameObjects.Container).y)
    this.carouselGlow?.setAlpha(this.reducedMotion ? 0.13 : 0.13 + Math.sin(t * 1.05) * 0.025)
  }

  private pointerDown(pointer: PointerLike): void {
    if (!this.layout || !this.carousel || !this.isVisible()) return
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorld)
    if (!this.inCarousel(world.x, world.y)) return
    this.pointerId = pointer.id
    this.pointerDownX = world.x
    this.pointerDownY = world.y
    this.pointerLastX = world.x
    this.pointerDragging = false
    this.pressedHero = this.pickHero(world.x, world.y)
  }

  private pointerMove(pointer: PointerLike): void {
    if (this.pointerId !== pointer.id || !this.layout) return
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorld)
    const delta = world.x - this.pointerLastX
    if (!this.pointerDragging && Math.hypot(world.x - this.pointerDownX, world.y - this.pointerDownY) > 6) {
      this.pointerDragging = true
    }
    if (this.pointerDragging) {
      this.carouselRotation += delta / Math.max(1, this.layout.carousel.w) * Math.PI * 2.2
      this.carouselVelocity = delta / Math.max(1, this.layout.carousel.w) * Math.PI * 2.2 * 12
    }
    this.pointerLastX = world.x
  }

  private pointerUp(pointer: PointerLike): void {
    if (this.pointerId !== pointer.id) return
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorld)
    const hero = this.pressedHero
    if (!this.pointerDragging && hero && this.inCarousel(world.x, world.y)) this.triggerHero(hero)
    this.pointerId = null
    this.pointerDragging = false
    this.pressedHero = null
  }

  private inCarousel(x: number, y: number): boolean {
    const rect = this.layout!.carousel
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  }

  private pickHero(x: number, y: number): HeroBall | null {
    let selected: HeroBall | null = null
    let best = Infinity
    for (const hero of [...this.heroes].sort((a, b) => b.depth - a.depth)) {
      const world = hero.container.getWorldTransformMatrix()
      const dx = x - world.tx
      const dy = y - (world.ty - hero.radius * 0.52 * Math.max(hero.container.scaleX, hero.container.scaleY))
      const distance = Math.hypot(dx, dy)
      const hit = hero.visualRadius * Math.max(hero.container.scaleX, hero.container.scaleY) * 1.3
      if (distance <= hit && distance < best) {
        selected = hero
        best = distance
      }
    }
    return selected
  }

  private triggerHero(hero: HeroBall): void {
    hero.jump = 1
    this.ribbonRemaining = 2.6
    this.ribbonName?.setText(`★ ${hero.name.toUpperCase()} ★`)
    this.ribbonStatus?.setText(`${hero.status}  •  TIER ${hero.tier}`)
    this.ribbon?.setAlpha(1)
  }

  private drawHero(hero: HeroBall, time: number, gaze: { x: number; y: number }): void {
    const g = hero.graphics
    g.clear()
    if (hero.tier >= 9) {
      drawCollectibleBall(g, 0, 0, hero.radius * 0.86, hero.tier, hero.variant, undefined, 0, gaze, hero.seed, hero.theme, 0, undefined, true)
      return
    }
    g.fillStyle(hero.tier === 8 ? cycleColor(time) : getTier(hero.tier)?.color ?? 0xffd700, 1)
    g.beginPath().moveTo(hero.contour[0]!.x, hero.contour[0]!.y)
    for (let i = 1; i < hero.contour.length; i++) g.lineTo(hero.contour[i]!.x, hero.contour[i]!.y)
    g.closePath().fillPath()
    g.fillStyle(0xffffff, 0.28).fillCircle(-hero.radius * 0.28, -hero.radius * 0.3, hero.radius * 0.26)
    g.lineStyle(hero.outlineWidth, INK, 1).beginPath().moveTo(hero.contour[0]!.x, hero.contour[0]!.y)
    for (let i = 1; i < hero.contour.length; i++) g.lineTo(hero.contour[i]!.x, hero.contour[i]!.y)
    g.closePath().strokePath()
    drawBallFace(g, hero.blinkClosed ? hero.blinkLook : hero.look, { x: 0, y: 0 }, hero.radius, 1, { gaze, expr: hero.expression })
  }

  private renderLogoSparkles(t: number): void {
    if (!this.logoSparkles || !this.layout) return
    const g = this.logoSparkles
    g.clear()
    for (let i = 0; i < 3; i++) {
      const pulse = Math.max(0, Math.sin(t * 1.25 + i * 2.1))
      if (pulse < 0.5) continue
      const x = this.layout.logo.w * (i === 0 ? -0.1 : i === 1 ? 0.12 : 0.32)
      const y = this.layout.logo.h * (i === 2 ? 0.01 : -0.32)
      const r = 3.5 * pulse
      g.fillStyle(0xfff4d0, pulse * 0.75).beginPath().moveTo(x, y - r).lineTo(x + r * 0.23, y - r * 0.23).lineTo(x + r, y).lineTo(x + r * 0.23, y + r * 0.23).lineTo(x, y + r).lineTo(x - r * 0.23, y + r * 0.23).lineTo(x - r, y).lineTo(x - r * 0.23, y - r * 0.23).closePath().fillPath()
    }
  }

  private applyEntrance(progress: number): void {
    if (!this.layout) return
    const eased = 1 - Math.pow(1 - progress, 3)
    if (this.logo) this.logo.setAlpha(eased).setPosition(this.layout.logo.x + this.layout.logo.w / 2, this.layout.logo.y + this.layout.logo.h / 2 - (1 - eased) * 8).setScale(0.97 + eased * 0.03)
    if (this.carousel) this.carousel.setAlpha(eased).setPosition(this.layout.carousel.x + (1 - eased) * (this.layout.desktop ? 18 : 0), this.layout.carousel.y + (1 - eased) * 10).setScale(0.985 + eased * 0.015)
  }
}
