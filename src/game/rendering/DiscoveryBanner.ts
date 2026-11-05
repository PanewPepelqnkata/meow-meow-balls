import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { ballOutlineWidth, drawBallFace, restContour, ballLookFor, drawCollectibleBall, INK } from './BallAppearance'
import { themeFor, variantIdFor } from '../state/runVariant'
import { cycleColor } from './rgbCycle'
import { FONT_FAMILY } from '../../ui/Typography'
import { readSafeArea, type UiLayout } from '../../ui/ResponsiveLayout'

/** How long a repeat-unlock banner stays visible, including its exit. */
export const BANNER_MS = 2200

const CREAM = 0xffedc2
const RED = 0xf6244a
const YELLOW = 0xffc400
const YELLOW_LIGHT = 0xffe36b
const SHADOW = 0x080914

/** Local pop-art bounds, expressed in units of `halfThick`. */
const ART_LEFT = -2.75
const ART_RIGHT = 10.05
const ART_TOP = -3.15
const ART_BOTTOM = 2.85

export interface BannerRect {
  cx: number
  cy: number
  halfLen: number
  halfThick: number
  angle: number
}

/** `?discovery=wind` remains the isolated QA route for the repeat banner. */
export function bannerForcedByVariant(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('discovery') === 'wind'
}

/** Deterministic per-character RNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function transformedBounds(angle: number, unit: number): { left: number; right: number; top: number; bottom: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const corners = [
    { x: ART_LEFT * unit, y: ART_TOP * unit },
    { x: ART_RIGHT * unit, y: ART_TOP * unit },
    { x: ART_RIGHT * unit, y: ART_BOTTOM * unit },
    { x: ART_LEFT * unit, y: ART_BOTTOM * unit },
  ]
  const xs = corners.map((p) => cos * p.x - sin * p.y)
  const ys = corners.map((p) => sin * p.x + cos * p.y)
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

/** Exact painted footprint after the banner's root rotation and translation. */
export function bannerArtworkBounds(rect: BannerRect): { left: number; right: number; top: number; bottom: number } {
  const bounds = transformedBounds(rect.angle, rect.halfThick)
  return {
    left: rect.cx + bounds.left,
    right: rect.cx + bounds.right,
    top: rect.cy + bounds.top,
    bottom: rect.cy + bounds.bottom,
  }
}

/**
 * Compact pop-art geometry. `cx/cy` is the unlocked character's impact
 * centre, not the panel centre; everything else uses stable local units.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  const portrait = vh > vw
  const halfThick = portrait
    ? Math.min(vw * 0.041, vh * 0.021, 16)
    : Math.min(vh * 0.032, vw * 0.018, 26)
  const halfLen = halfThick * 5.25
  const angle = portrait ? -0.045 : -0.065
  const bounds = transformedBounds(angle, halfThick)
  const rightMargin = portrait ? Math.max(14, vw * 0.04) : Math.max(44, vw * 0.056)
  const topMargin = portrait ? Math.max(142, vh * 0.17) : Math.max(28, vh * 0.04)
  return {
    cx: vw - rightMargin - bounds.right,
    cy: topMargin - bounds.top,
    halfLen,
    halfThick,
    angle,
  }
}

function vectors(points: Array<{ x: number; y: number }>): Phaser.Math.Vector2[] {
  return points.map((p) => new Phaser.Math.Vector2(p.x, p.y))
}

function impactPoints(radius: number, seed: number, count = 14): Array<{ x: number; y: number }> {
  const rng = makeRng(seed)
  const result: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count * 2; i++) {
    const outer = i % 2 === 0
    const angle = (i / (count * 2)) * Math.PI * 2 - Math.PI / 2 + (rng() - 0.5) * 0.045
    const profile = outer ? 0.82 + rng() * 0.34 : 0.46 + rng() * 0.11
    result.push({ x: Math.cos(angle) * radius * profile, y: Math.sin(angle) * radius * profile })
  }
  return result
}

function fillPolygon(g: Phaser.GameObjects.Graphics, color: number, points: Array<{ x: number; y: number }>, alpha = 1): void {
  g.fillStyle(color, alpha)
  g.fillPoints(vectors(points), true)
}

/**
 * Repeat unlock presentation only. First-time discovery and persistence stay
 * in PlaygroundScene; this class owns screen-space art, motion, and cleanup.
 */
export class DiscoveryBanner {
  private readonly scene: Phaser.Scene
  private readonly hudLayout: (() => UiLayout) | null
  private holder: Phaser.GameObjects.Container | null = null
  private railsC: Phaser.GameObjects.Container | null = null
  private panelC: Phaser.GameObjects.Container | null = null
  private burstC: Phaser.GameObjects.Container | null = null
  private ballC: Phaser.GameObjects.Container | null = null
  private cloudC: Phaser.GameObjects.Container | null = null
  private duplicateC: Phaser.GameObjects.Container | null = null
  private tierC: Phaser.GameObjects.Container | null = null
  private accentC: Phaser.GameObjects.Container | null = null
  private flashC: Phaser.GameObjects.Container | null = null
  private ballG: Phaser.GameObjects.Graphics | null = null
  private tweens: Phaser.Tweens.Tween[] = []
  private dismissTimer: Phaser.Time.TimerEvent | null = null
  private rgbTimer: Phaser.Time.TimerEvent | null = null
  private tier = 1
  private seed = 0
  private theme: string | null = null
  private variant: number | null = null
  private active = false
  private reducedMotion = false

  constructor(scene: Phaser.Scene, hudLayout?: () => UiLayout) {
    this.scene = scene
    this.hudLayout = hudLayout ?? null
  }

  get objsCount(): number {
    return this.holder ? this.holder.list.length + 1 : 0
  }

  isShowing(): boolean {
    return this.active
  }

  show(tier: number, seed: number, theme: string | null = null, variant: number | null = null): void {
    // Fast consecutive duplicates cannot retain the previous character.
    this.destroy()
    this.active = true
    this.tier = tier
    this.seed = seed
    this.theme = theme
    this.variant = variant
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }

    const z = this.scene.game.scale.displayScale.x || 1
    const layout = this.hudLayout?.()
    const vw = layout?.vw ?? this.scene.scale.width / z
    const vh = layout?.vh ?? this.scene.scale.height / z
    const rect = bannerRect(vw, vh)
    this.clampToHud(rect, layout)
    const unit = rect.halfThick

    const holder = this.scene.add.container(rect.cx, rect.cy).setRotation(rect.angle).setDepth(78.6)
    this.holder = holder

    this.railsC = this.makeGraphicsLayer(holder, (g) => this.drawRails(g, unit, seed))
    this.panelC = this.makeGraphicsLayer(holder, (g) => this.drawPanel(g, unit, seed))
    this.accentC = this.makeGraphicsLayer(holder, (g) => this.drawAccents(g, unit, seed))
    this.flashC = this.makeGraphicsLayer(holder, (g) => this.drawFlash(g, unit))
    this.burstC = this.makeGraphicsLayer(holder, (g) => this.drawBurst(g, unit, seed))
    this.cloudC = this.makeGraphicsLayer(holder, (g) => this.drawCloud(g, unit))

    this.ballG = this.scene.add.graphics()
    this.drawBall(this.ballG, unit)
    this.ballC = this.scene.add.container(0, 0, [this.ballG]).setRotation(-rect.angle)
    holder.add(this.ballC)

    this.duplicateC = this.buildDuplicateTab(holder, unit)
    this.tierC = this.buildTierLabel(holder, unit, tier)

    if (tier === 8 && !this.reducedMotion) {
      this.rgbTimer = this.scene.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {
          if (!this.ballG) return
          this.ballG.clear()
          this.drawBall(this.ballG, unit)
        },
      })
    }

    if (this.reducedMotion) this.applyFinalPose()
    else this.playEntrance(rect)
    this.dismissTimer = this.scene.time.delayedCall(BANNER_MS, () => this.dismiss())
  }

  private clampToHud(rect: BannerRect, layout: UiLayout | undefined): void {
    if (!layout) return
    const bounds = transformedBounds(rect.angle, rect.halfThick)
    if (layout.composition === 'portrait') {
      rect.cy += Math.max(0, layout.stack.hudBottom - 4 - (rect.cy + bounds.top))
      return
    }
    const safe = readSafeArea()
    const pauseCenterX = layout.vw - Math.max(12, safe.right + 8) - 24
    const allowedRight = pauseCenterX - 32
    rect.cx -= Math.max(0, rect.cx + bounds.right - allowedRight)
  }

  private makeGraphicsLayer(
    holder: Phaser.GameObjects.Container,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): Phaser.GameObjects.Container {
    const g = this.scene.add.graphics()
    draw(g)
    const container = this.scene.add.container(0, 0, [g])
    holder.add(container)
    return container
  }

  private drawRails(g: Phaser.GameObjects.Graphics, s: number, seed: number): void {
    const topShadow = [
      { x: 1.2 * s, y: -2.05 * s }, { x: 10.05 * s, y: -3.02 * s },
      { x: 9.75 * s, y: -2.5 * s }, { x: 1.45 * s, y: -1.62 * s },
    ]
    const topCream = [
      { x: 1.45 * s, y: -1.97 * s }, { x: 9.88 * s, y: -2.86 * s },
      { x: 9.48 * s, y: -2.57 * s }, { x: 1.58 * s, y: -1.72 * s },
    ]
    const topYellow = [
      { x: 6.15 * s, y: -2.64 * s }, { x: 10.02 * s, y: -3.12 * s },
      { x: 9.42 * s, y: -2.74 * s }, { x: 6.05 * s, y: -2.34 * s },
    ]
    const bottomShadow = [
      { x: 1.1 * s, y: 1.6 * s }, { x: 9.75 * s, y: 0.53 * s },
      { x: 9.05 * s, y: 1.42 * s }, { x: 1.35 * s, y: 2.25 * s },
    ]
    const bottomCream = [
      { x: 1.32 * s, y: 1.52 * s }, { x: 9.42 * s, y: 0.58 * s },
      { x: 8.92 * s, y: 1.12 * s }, { x: 1.5 * s, y: 2.02 * s },
    ]
    const bottomYellow = [
      { x: 5.85 * s, y: 1.67 * s }, { x: 9.95 * s, y: 1.03 * s },
      { x: 9.14 * s, y: 1.61 * s }, { x: 5.55 * s, y: 2.08 * s },
    ]
    fillPolygon(g, SHADOW, topShadow)
    fillPolygon(g, CREAM, topCream)
    fillPolygon(g, YELLOW, topYellow)
    fillPolygon(g, SHADOW, bottomShadow)
    fillPolygon(g, CREAM, bottomCream)
    fillPolygon(g, YELLOW, bottomYellow)

    // Parallel ink speed cuts from the preview.
    g.lineStyle(Math.max(1.5, s * 0.075), SHADOW, 0.95)
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      g.moveTo((6.9 + i * 0.42) * s, (1.9 + i * 0.16) * s)
      g.lineTo((9.65 - i * 0.08) * s, (1.45 + i * 0.06) * s)
      g.strokePath()
    }

    const rng = makeRng(seed + 811)
    g.fillStyle(YELLOW_LIGHT, 0.92)
    for (let i = 0; i < 38; i++) {
      const x = (6.8 + rng() * 3.1) * s
      const y = (-3.02 + rng() * 0.62) * s
      g.fillCircle(x, y, s * (0.025 + rng() * 0.035))
    }
    for (let i = 0; i < 38; i++) {
      const x = (6.75 + rng() * 3.15) * s
      const y = (1.78 + rng() * 0.58) * s
      g.fillCircle(x, y, s * (0.025 + rng() * 0.035))
    }
  }

  private panelPolygon(s: number, inset = 0): Array<{ x: number; y: number }> {
    const k = inset / s
    return [
      { x: (0.4 + k) * s, y: (-1.35 + k) * s },
      { x: (8.78 - k) * s, y: (-2.0 + k) * s },
      { x: (9.15 - k) * s, y: (0.78 - k) * s },
      { x: (0.3 + k) * s, y: (1.92 - k) * s },
    ]
  }

  private drawPanel(g: Phaser.GameObjects.Graphics, s: number, seed: number): void {
    const shadow = this.panelPolygon(s).map((p) => ({ x: p.x + 0.18 * s, y: p.y + 0.2 * s }))
    fillPolygon(g, 0x000000, shadow, 0.5)
    fillPolygon(g, SHADOW, this.panelPolygon(s))
    fillPolygon(g, CREAM, this.panelPolygon(s, 0.13 * s))
    fillPolygon(g, SHADOW, this.panelPolygon(s, 0.26 * s))
    fillPolygon(g, RED, this.panelPolygon(s, 0.38 * s))

    const rng = makeRng(seed + 313)
    g.fillStyle(SHADOW, 0.92)
    for (let col = 0; col < 24; col++) {
      const x = (0.9 + col * 0.32) * s
      const top = (-1.22 - (x / s) * 0.075) * s
      const bottom = (1.55 - (x / s) * 0.12) * s
      for (let row = 0; row < 7; row++) {
        const y = top + (row / 6) * (bottom - top)
        if ((col + row) % 2 === 0 || rng() > 0.4) g.fillCircle(x, y, s * 0.055)
      }
    }

    // Small red highlight strip keeps the panel from reading as a flat sticker.
    g.lineStyle(Math.max(1.25, s * 0.055), 0xff5a70, 0.72)
    g.beginPath()
    g.moveTo(1.05 * s, -0.98 * s)
    g.lineTo(7.85 * s, -1.5 * s)
    g.strokePath()
  }

  private drawBurst(g: Phaser.GameObjects.Graphics, s: number, seed: number): void {
    const shadow = impactPoints(2.15 * s, seed + 17)
    fillPolygon(g, SHADOW, shadow)
    const cream = impactPoints(1.92 * s, seed + 17)
    fillPolygon(g, CREAM, cream)
    g.lineStyle(Math.max(2.5, s * 0.1), SHADOW, 1)
    g.strokePoints(vectors(cream), true, true)
  }

  private drawBall(g: Phaser.GameObjects.Graphics, s: number): void {
    const radius = 1.02 * s
    const color = getTier(this.tier)?.color ?? 0xffffff
    if (this.tier === 9 || this.tier === 10) {
      const theme = this.theme ?? themeFor(this.tier)
      const variant = this.variant ?? variantIdFor(this.tier)
      drawCollectibleBall(g, 0, 0, radius, this.tier, variant, undefined, 0, undefined, this.seed, theme ?? undefined)
      return
    }
    const look = ballLookFor(this.tier, this.seed)
    const poly = restContour(look, radius, 0, 0, 48)
    g.fillStyle(this.tier === 8 ? cycleColor(Date.now()) : color, 1)
    g.fillPoints(vectors(poly), true)
    g.lineStyle(ballOutlineWidth(radius), INK, 1)
    g.strokePoints(vectors(poly), true, true)
    drawBallFace(g, look, { x: 0, y: 0 }, radius, 1)
  }

  private drawCloud(g: Phaser.GameObjects.Graphics, s: number): void {
    const cx = -1.48 * s
    const cy = 1.12 * s
    const lobes = [
      { x: -0.45, y: 0.08, r: 0.48 }, { x: -0.1, y: -0.28, r: 0.58 },
      { x: 0.34, y: -0.12, r: 0.52 }, { x: 0.48, y: 0.28, r: 0.48 },
      { x: 0, y: 0.38, r: 0.62 },
    ]
    for (const l of lobes) {
      g.fillStyle(SHADOW, 1)
      g.fillCircle(cx + l.x * s, cy + l.y * s, (l.r + 0.11) * s)
    }
    for (const l of lobes) {
      g.fillStyle(CREAM, 1)
      g.fillCircle(cx + l.x * s, cy + l.y * s, l.r * s)
    }
    g.lineStyle(Math.max(1.25, s * 0.06), SHADOW, 0.9)
    for (const mark of [
      { x1: -0.45, y1: 0.05, x2: -0.66, y2: 0.34 },
      { x1: 0.06, y1: 0.18, x2: -0.12, y2: 0.51 },
      { x1: 0.35, y1: -0.05, x2: 0.58, y2: 0.12 },
    ]) {
      g.beginPath()
      g.moveTo(cx + mark.x1 * s, cy + mark.y1 * s)
      g.lineTo(cx + mark.x2 * s, cy + mark.y2 * s)
      g.strokePath()
    }
  }

  private drawAccents(g: Phaser.GameObjects.Graphics, s: number, seed: number): void {
    const rng = makeRng(seed + 991)
    g.fillStyle(YELLOW_LIGHT, 0.95)
    for (let i = 0; i < 28; i++) {
      const a = -Math.PI * 0.9 + rng() * Math.PI * 1.5
      const r = (1.95 + rng() * 0.72) * s
      g.fillCircle(Math.cos(a) * r, Math.sin(a) * r, s * (0.025 + rng() * 0.04))
    }
    // Three tiny impact diamonds add the flashy comic punctuation.
    for (const p of [{ x: -2.2, y: -0.9 }, { x: 1.5, y: -2.15 }, { x: 1.95, y: 1.55 }]) {
      fillPolygon(g, YELLOW, [
        { x: p.x * s, y: (p.y - 0.14) * s },
        { x: (p.x + 0.09) * s, y: p.y * s },
        { x: p.x * s, y: (p.y + 0.14) * s },
        { x: (p.x - 0.09) * s, y: p.y * s },
      ])
    }
  }

  private drawFlash(g: Phaser.GameObjects.Graphics, s: number): void {
    g.fillStyle(0xffffff, 0.95)
    g.fillCircle(0, 0, 0.46 * s)
    const rays = 10
    g.lineStyle(Math.max(2, s * 0.075), YELLOW_LIGHT, 1)
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2
      g.beginPath()
      g.moveTo(Math.cos(a) * 1.45 * s, Math.sin(a) * 1.45 * s)
      g.lineTo(Math.cos(a) * 2.25 * s, Math.sin(a) * 2.25 * s)
      g.strokePath()
    }
  }

  private buildDuplicateTab(holder: Phaser.GameObjects.Container, s: number): Phaser.GameObjects.Container {
    const g = this.scene.add.graphics()
    const shadow = [
      { x: -2.65 * s, y: -0.62 * s }, { x: 2.65 * s, y: -0.95 * s },
      { x: 2.42 * s, y: 0.68 * s }, { x: -2.92 * s, y: 0.92 * s },
    ]
    const plate = shadow.map((p) => ({ x: p.x - 0.1 * s, y: p.y - 0.12 * s }))
    fillPolygon(g, SHADOW, shadow)
    fillPolygon(g, CREAM, plate)
    g.lineStyle(Math.max(1.5, s * 0.065), SHADOW, 1)
    g.strokePoints(vectors(plate), true, true)

    const size = Math.max(12, Math.round(s * 0.72))
    const text = this.scene.add.text(-0.1 * s, -0.03 * s, 'DUPLICATE!', {
      fontFamily: FONT_FAMILY,
      fontStyle: 'italic',
      fontSize: `${size}px`,
      color: '#111111',
      resolution: Math.max(2, Math.min(window.devicePixelRatio || 1, 2)),
    }).setOrigin(0.5)
    const container = this.scene.add.container(4.55 * s, -2.06 * s, [g, text])
    holder.add(container)
    return container
  }

  private buildTierLabel(holder: Phaser.GameObjects.Container, s: number, tier: number): Phaser.GameObjects.Container {
    const size = Math.max(24, Math.round(s * (tier >= 10 ? 1.56 : 1.84)))
    const resolution = Math.max(2, Math.min(window.devicePixelRatio || 1, 2))
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FONT_FAMILY,
      fontStyle: 'italic',
      fontSize: `${size}px`,
      color: '#ffc400',
      stroke: '#111111',
      strokeThickness: Math.max(4, Math.round(s * 0.18)),
      resolution,
    }
    const shadow = this.scene.add.text(0.13 * s, 0.18 * s, `TIER ${tier}`, {
      ...style,
      color: '#111111',
      stroke: '#111111',
    }).setOrigin(0.5).setAlpha(0.7)
    const text = this.scene.add.text(0, 0, `TIER ${tier}`, style).setOrigin(0.5)
    const container = this.scene.add.container(5.2 * s, -0.12 * s, [shadow, text])
    holder.add(container)
    return container
  }

  private applyFinalPose(): void {
    for (const layer of this.layers()) layer.setAlpha(1).setScale(1).setPosition(layer.x, layer.y)
    this.flashC?.setAlpha(0)
  }

  private playEntrance(rect: BannerRect): void {
    if (!this.holder || !this.railsC || !this.panelC || !this.burstC || !this.ballC || !this.cloudC ||
      !this.duplicateC || !this.tierC || !this.accentC || !this.flashC) return
    const s = rect.halfThick
    const tabBase = { x: this.duplicateC.x, y: this.duplicateC.y }
    const tierBase = { x: this.tierC.x, y: this.tierC.y }

    this.holder.setAlpha(1)
    this.railsC.setAlpha(0).setPosition(1.8 * s, 0)
    this.panelC.setAlpha(0).setScale(0.04, 0.72)
    this.burstC.setAlpha(0).setScale(0.08).setRotation(-0.26)
    this.ballC.setAlpha(0).setScale(0.12).setPosition(0, 0.7 * s)
    this.cloudC.setAlpha(0).setScale(0.15).setPosition(-0.3 * s, 0.15 * s)
    this.duplicateC.setAlpha(0).setScale(0.25).setPosition(tabBase.x + 1.2 * s, tabBase.y - 0.8 * s)
    this.tierC.setAlpha(0).setScale(0.18).setPosition(tierBase.x + 1.15 * s, tierBase.y)
    this.accentC.setAlpha(0)
    this.flashC.setAlpha(0).setScale(0.15)

    this.addTween({ targets: this.flashC, alpha: 1, scaleX: 1, scaleY: 1, duration: 55, ease: 'Cubic.easeOut', onComplete: () => {
      if (!this.flashC) return
      this.addTween({ targets: this.flashC, alpha: 0, scaleX: 1.9, scaleY: 1.9, duration: 130, ease: 'Cubic.easeOut' })
    } })
    this.addTween({ targets: this.burstC, alpha: 1, scaleX: 1, scaleY: 1, rotation: 0, delay: 20, duration: 210, ease: 'Back.easeOut.config(0.75)' })
    this.addTween({ targets: this.railsC, alpha: 1, x: 0, delay: 55, duration: 235, ease: 'Cubic.easeOut' })
    this.addTween({ targets: this.panelC, alpha: 1, scaleX: 1, scaleY: 1, delay: 70, duration: 250, ease: 'Back.easeOut.config(0.38)' })
    this.addTween({ targets: this.ballC, alpha: 1, scaleX: 1, scaleY: 1, y: 0, delay: 95, duration: 220, ease: 'Back.easeOut.config(0.85)' })
    this.addTween({ targets: this.cloudC, alpha: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, delay: 120, duration: 180, ease: 'Back.easeOut.config(0.7)' })
    this.addTween({ targets: this.duplicateC, alpha: 1, scaleX: 1, scaleY: 1, x: tabBase.x, y: tabBase.y, delay: 140, duration: 210, ease: 'Back.easeOut.config(0.8)' })
    this.addTween({ targets: this.tierC, alpha: 1, scaleX: 1, scaleY: 1, x: tierBase.x, y: tierBase.y, delay: 180, duration: 190, ease: 'Back.easeOut.config(0.95)' })
    this.addTween({ targets: this.accentC, alpha: 1, delay: 190, duration: 150, ease: 'Cubic.easeOut' })

    // A brief aftershock sells the impact, then restrained independent motion.
    this.addTween({ targets: this.holder, x: rect.cx + 2.4, duration: 45, delay: 250, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.ballC, x: -Math.sin(rect.angle) * 1.25, y: -Math.cos(rect.angle) * 1.25, delay: 430, duration: 720, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.burstC, rotation: 0.018, scaleX: 1.015, scaleY: 1.015, delay: 470, duration: 880, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.duplicateC, y: tabBase.y - 1.2, delay: 520, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.railsC, x: 1.3, delay: 560, duration: 920, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.accentC, alpha: 0.62, delay: 600, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }

  private addTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    this.tweens.push(this.scene.tweens.add(config))
  }

  private layers(): Phaser.GameObjects.Container[] {
    return [this.railsC, this.panelC, this.accentC, this.flashC, this.burstC, this.cloudC,
      this.ballC, this.duplicateC, this.tierC].filter((layer): layer is Phaser.GameObjects.Container => layer !== null)
  }

  dismiss(): void {
    if (!this.active) return
    if (this.reducedMotion) {
      this.destroy()
      return
    }
    this.dismissTimer?.remove()
    this.dismissTimer = null
    for (const tween of this.tweens) tween.stop()
    this.tweens = []
    if (!this.holder) {
      this.destroy()
      return
    }
    const s = this.holder ? (this.hudLayout?.().composition === 'portrait' ? 16 : 24) : 24
    if (this.panelC) this.addTween({ targets: this.panelC, scaleX: 0.04, scaleY: 0.72, alpha: 0, duration: 180, ease: 'Cubic.easeIn' })
    if (this.railsC) this.addTween({ targets: this.railsC, x: s * 2, alpha: 0, duration: 170, ease: 'Cubic.easeIn' })
    for (const layer of [this.burstC, this.ballC, this.cloudC]) {
      if (layer) this.addTween({ targets: layer, scaleX: 0.76, scaleY: 0.76, alpha: 0, duration: 170, ease: 'Cubic.easeIn' })
    }
    for (const layer of [this.duplicateC, this.tierC, this.accentC]) {
      if (layer) this.addTween({ targets: layer, x: layer.x + s, alpha: 0, duration: 145, ease: 'Cubic.easeIn' })
    }
    this.addTween({ targets: this.holder, alpha: 0, duration: 190, ease: 'Cubic.easeIn', onComplete: () => this.destroy() })
  }

  destroy(): void {
    this.active = false
    this.dismissTimer?.remove()
    this.dismissTimer = null
    this.rgbTimer?.remove()
    this.rgbTimer = null
    for (const tween of this.tweens) tween.stop()
    this.tweens = []
    if (this.holder) {
      this.scene.tweens.killTweensOf([this.holder, ...this.layers()])
      this.holder.removeAll(true)
      this.holder.destroy()
    }
    this.holder = null
    this.railsC = null
    this.panelC = null
    this.burstC = null
    this.ballC = null
    this.cloudC = null
    this.duplicateC = null
    this.tierC = null
    this.accentC = null
    this.flashC = null
    this.ballG = null
  }
}
