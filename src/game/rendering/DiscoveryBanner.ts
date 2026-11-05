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

interface ArtProfile {
  left: number
  right: number
  top: number
  bottom: number
  contentScale: number
}

const LANDSCAPE_ART: ArtProfile = { left: -2.75, right: 9.45, top: -3.05, bottom: 2.75, contentScale: 1 }
const PORTRAIT_ART: ArtProfile = { left: -2.75, right: 8.15, top: -2.85, bottom: 2.4, contentScale: 0.84 }

export interface BannerRect {
  cx: number
  cy: number
  halfLen: number
  halfThick: number
  angle: number
  portrait: boolean
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

function artProfile(portrait: boolean): ArtProfile {
  return portrait ? PORTRAIT_ART : LANDSCAPE_ART
}

function transformedBounds(angle: number, unit: number, profile: ArtProfile): { left: number; right: number; top: number; bottom: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const corners = [
    { x: profile.left * unit, y: profile.top * unit },
    { x: profile.right * unit, y: profile.top * unit },
    { x: profile.right * unit, y: profile.bottom * unit },
    { x: profile.left * unit, y: profile.bottom * unit },
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
  const bounds = transformedBounds(rect.angle, rect.halfThick, artProfile(rect.portrait))
  return {
    left: rect.cx + bounds.left,
    right: rect.cx + bounds.right,
    top: rect.cy + bounds.top,
    bottom: rect.cy + bounds.bottom,
  }
}

/** Holder x that places the transformed artwork wholly beyond the right edge. */
export function bannerOffscreenX(rect: BannerRect, viewportWidth: number, clearance = 18): number {
  const finalBounds = bannerArtworkBounds(rect)
  return rect.cx + Math.max(rect.halfThick * 6, viewportWidth - finalBounds.left + clearance)
}

/**
 * Compact pop-art geometry. `cx/cy` is the unlocked character's impact
 * centre, not the panel centre; everything else uses stable local units.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  const portrait = vh > vw
  const halfThick = portrait
    ? Math.min(vw * 0.044, vh * 0.021, 17)
    : Math.min(vh * 0.032, vw * 0.018, 26)
  const halfLen = halfThick * (portrait ? 4.5 : 5.25)
  const angle = portrait ? -0.04 : -0.065
  const bounds = transformedBounds(angle, halfThick, artProfile(portrait))
  const rightMargin = portrait ? Math.max(14, vw * 0.04) : Math.max(44, vw * 0.056)
  const topMargin = portrait ? Math.max(132, vh * 0.156) : Math.max(28, vh * 0.04)
  return {
    cx: vw - rightMargin - bounds.right,
    cy: topMargin - bounds.top,
    halfLen,
    halfThick,
    angle,
    portrait,
  }
}

function pointInsidePolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

function pointSegmentDistanceSquared(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  const nearestX = a.x + t * dx
  const nearestY = a.y + t * dy
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2
}

/** True only when the complete circle fits inside the polygon. */
export function circleInsidePolygon(
  center: { x: number; y: number },
  radius: number,
  polygon: Array<{ x: number; y: number }>,
): boolean {
  if (radius < 0 || !pointInsidePolygon(center, polygon)) return false
  const radiusSquared = radius * radius
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b || pointSegmentDistanceSquared(center, a, b) < radiusSquared) return false
  }
  return true
}

function vectors(points: Array<{ x: number; y: number }>): Phaser.Math.Vector2[] {
  return points.map((p) => new Phaser.Math.Vector2(p.x, p.y))
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
  private offscreenX = 0

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
    const profile = artProfile(rect.portrait)
    this.offscreenX = bannerOffscreenX(rect, vw)

    const holder = this.scene.add.container(rect.cx, rect.cy).setRotation(rect.angle).setDepth(78.6)
    this.holder = holder

    this.railsC = this.makeGraphicsLayer(holder, (g) => this.drawRails(g, unit), profile.contentScale)
    this.panelC = this.makeGraphicsLayer(holder, (g) => this.drawPanel(g, unit), profile.contentScale)
    this.accentC = this.makeGraphicsLayer(holder, (g) => this.drawAccents(g, unit), profile.contentScale)
    this.flashC = this.makeGraphicsLayer(holder, (g) => this.drawFlash(g, unit))
    this.burstC = this.makeGraphicsLayer(holder, (g) => this.drawBurst(g, unit))
    this.cloudC = this.makeGraphicsLayer(holder, (g) => this.drawCloud(g, unit))

    this.ballG = this.scene.add.graphics()
    this.drawBall(this.ballG, unit, rect.portrait)
    this.ballC = this.scene.add.container(0, 0, [this.ballG]).setRotation(-rect.angle)
    holder.add(this.ballC)

    this.duplicateC = this.buildDuplicateTab(holder, unit, rect.portrait)
    this.tierC = this.buildTierLabel(holder, unit, tier, rect.portrait)

    if (tier === 8 && !this.reducedMotion) {
      this.rgbTimer = this.scene.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {
          if (!this.ballG) return
          this.ballG.clear()
          this.drawBall(this.ballG, unit, rect.portrait)
        },
      })
    }

    if (this.reducedMotion) this.applyFinalPose()
    else this.playEntrance(rect)
    this.dismissTimer = this.scene.time.delayedCall(BANNER_MS, () => this.dismiss())
  }

  private clampToHud(rect: BannerRect, layout: UiLayout | undefined): void {
    if (!layout) return
    const bounds = transformedBounds(rect.angle, rect.halfThick, artProfile(rect.portrait))
    if (layout.composition === 'portrait') {
      rect.cy += Math.max(0, layout.stack.hudBottom - 12 - (rect.cy + bounds.top))
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
    contentScale = 1,
  ): Phaser.GameObjects.Container {
    const g = this.scene.add.graphics().setScale(contentScale)
    draw(g)
    const container = this.scene.add.container(0, 0, [g])
    holder.add(container)
    return container
  }

  private drawRails(g: Phaser.GameObjects.Graphics, s: number): void {
    const topShadow = [
      { x: 1.2 * s, y: -2.05 * s }, { x: 9.35 * s, y: -2.74 * s },
      { x: 8.98 * s, y: -2.33 * s }, { x: 1.45 * s, y: -1.62 * s },
    ]
    const topCream = [
      { x: 1.45 * s, y: -1.97 * s }, { x: 9.12 * s, y: -2.59 * s },
      { x: 8.84 * s, y: -2.36 * s }, { x: 1.58 * s, y: -1.72 * s },
    ]
    const topYellow = [
      { x: 6.25 * s, y: -2.42 * s }, { x: 9.3 * s, y: -2.82 * s },
      { x: 8.84 * s, y: -2.46 * s }, { x: 6.05 * s, y: -2.17 * s },
    ]
    const bottomShadow = [
      { x: 1.1 * s, y: 1.6 * s }, { x: 9.3 * s, y: 0.66 * s },
      { x: 8.86 * s, y: 1.34 * s }, { x: 1.35 * s, y: 2.25 * s },
    ]
    const bottomCream = [
      { x: 1.32 * s, y: 1.52 * s }, { x: 9.08 * s, y: 0.75 * s },
      { x: 8.75 * s, y: 1.15 * s }, { x: 1.5 * s, y: 2.02 * s },
    ]
    const bottomYellow = [
      { x: 5.9 * s, y: 1.68 * s }, { x: 9.32 * s, y: 1.02 * s },
      { x: 8.78 * s, y: 1.56 * s }, { x: 5.62 * s, y: 2.06 * s },
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
      g.moveTo((6.75 + i * 0.38) * s, (1.88 + i * 0.14) * s)
      g.lineTo((9.05 - i * 0.08) * s, (1.47 + i * 0.05) * s)
      g.strokePath()
    }

    // Deliberate print hatches replace the old random spray of dots.
    g.lineStyle(Math.max(1, s * 0.045), SHADOW, 0.72)
    for (let i = 0; i < 5; i++) {
      const x = (7.05 + i * 0.48) * s
      g.beginPath()
      g.moveTo(x, -2.68 * s)
      g.lineTo(x + 0.22 * s, -2.48 * s)
      g.strokePath()
    }
    for (let i = 0; i < 4; i++) {
      const x = (7.05 + i * 0.55) * s
      g.beginPath()
      g.moveTo(x, 1.72 * s)
      g.lineTo(x + 0.25 * s, 1.92 * s)
      g.strokePath()
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

  private drawPanel(g: Phaser.GameObjects.Graphics, s: number): void {
    const shadow = this.panelPolygon(s).map((p) => ({ x: p.x + 0.18 * s, y: p.y + 0.2 * s }))
    fillPolygon(g, 0x000000, shadow, 0.5)
    fillPolygon(g, SHADOW, this.panelPolygon(s))
    fillPolygon(g, CREAM, this.panelPolygon(s, 0.13 * s))
    fillPolygon(g, SHADOW, this.panelPolygon(s, 0.26 * s))
    const redPanel = this.panelPolygon(s, 0.38 * s)
    fillPolygon(g, RED, redPanel)

    // A strict offset grid gives a deliberate screen-print halftone. Every
    // dot is geometrically contained inside the red wedge.
    g.fillStyle(SHADOW, 0.72)
    const dotRadius = s * 0.045
    const edgeClearance = dotRadius + Math.max(0.5, s * 0.01)
    for (let row = 0; row < 8; row++) {
      const y = (-1.32 + row * 0.41) * s
      for (let col = 0; col < 24; col++) {
        const x = (0.78 + col * 0.36 + (row % 2) * 0.18) * s
        if (circleInsidePolygon({ x, y }, edgeClearance, redPanel)) g.fillCircle(x, y, dotRadius)
      }
    }

    // One clean highlight line adds print depth without spray or noise.
    g.lineStyle(Math.max(1.25, s * 0.055), 0xff6a7e, 0.75)
    g.beginPath()
    g.moveTo(1.05 * s, -0.98 * s)
    g.lineTo(7.85 * s, -1.5 * s)
    g.strokePath()
  }

  private drawBurst(g: Phaser.GameObjects.Graphics, s: number): void {
    // A clean inked medallion replaces the old radial sunburst. The cream
    // rim separates every dynamic character cleanly from the red panel.
    g.fillStyle(SHADOW, 1)
    g.fillCircle(0, 0, 1.5 * s)
    g.fillStyle(CREAM, 1)
    g.fillCircle(0, 0, 1.32 * s)
    g.lineStyle(Math.max(2.5, s * 0.1), SHADOW, 1)
    g.strokeCircle(0, 0, 1.32 * s)
  }


  private drawBall(g: Phaser.GameObjects.Graphics, s: number, portrait: boolean): void {
    const radius = (portrait ? 1.08 : 1.02) * s
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
    // A single attached impact tail replaces the old hand-like cloud lobes.
    const shadow = [
      { x: -1.1 * s, y: 0.72 * s },
      { x: -1.8 * s, y: 1.3 * s },
      { x: -0.98 * s, y: 1.22 * s },
    ]
    const cream = [
      { x: -1.13 * s, y: 0.83 * s },
      { x: -1.58 * s, y: 1.19 * s },
      { x: -1.04 * s, y: 1.12 * s },
    ]
    fillPolygon(g, SHADOW, shadow)
    fillPolygon(g, CREAM, cream)
    g.lineStyle(Math.max(1.25, s * 0.055), SHADOW, 1)
    g.strokePoints(vectors(cream), true, true)
  }

  private drawAccents(g: Phaser.GameObjects.Graphics, s: number): void {
    // Restrained punctuation only: three diamonds and four short motion cuts.
    for (const p of [{ x: -1.95, y: -1.15 }, { x: 1.45, y: -1.8 }, { x: 1.78, y: 1.38 }]) {
      fillPolygon(g, YELLOW, [
        { x: p.x * s, y: (p.y - 0.15) * s },
        { x: (p.x + 0.1) * s, y: p.y * s },
        { x: p.x * s, y: (p.y + 0.15) * s },
        { x: (p.x - 0.1) * s, y: p.y * s },
      ])
    }
    g.lineStyle(Math.max(1.25, s * 0.055), YELLOW_LIGHT, 0.92)
    for (const cut of [
      { x1: -2.3, y1: -0.45, x2: -2.65, y2: -0.62 },
      { x1: -2.28, y1: 0.02, x2: -2.72, y2: 0.02 },
      { x1: -2.15, y1: 0.5, x2: -2.52, y2: 0.68 },
      { x1: 1.55, y1: -1.52, x2: 1.85, y2: -1.78 },
    ]) {
      g.beginPath()
      g.moveTo(cut.x1 * s, cut.y1 * s)
      g.lineTo(cut.x2 * s, cut.y2 * s)
      g.strokePath()
    }
  }

  private drawFlash(g: Phaser.GameObjects.Graphics, s: number): void {
    // A compact ring/diamond flash avoids reintroducing radial sun rays.
    g.lineStyle(Math.max(2, s * 0.08), YELLOW_LIGHT, 0.95)
    g.strokeCircle(0, 0, 1.65 * s)
    for (const p of [{ x: 0, y: -1.95 }, { x: 1.92, y: 0 }, { x: 0, y: 1.95 }, { x: -1.92, y: 0 }]) {
      fillPolygon(g, CREAM, [
        { x: p.x * s, y: (p.y - 0.18) * s },
        { x: (p.x + 0.12) * s, y: p.y * s },
        { x: p.x * s, y: (p.y + 0.18) * s },
        { x: (p.x - 0.12) * s, y: p.y * s },
      ])
    }
  }

  private buildDuplicateTab(holder: Phaser.GameObjects.Container, s: number, portrait: boolean): Phaser.GameObjects.Container {
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

    const size = Math.max(12, Math.round(s * (portrait ? 0.78 : 0.72)))
    const text = this.scene.add.text(-0.1 * s, -0.03 * s, 'DUPLICATE!', {
      fontFamily: FONT_FAMILY,
      fontStyle: 'italic',
      fontSize: `${size}px`,
      color: '#111111',
      resolution: Math.max(2, Math.min(window.devicePixelRatio || 1, 2)),
    }).setOrigin(0.5)
    const container = this.scene.add.container((portrait ? 3.75 : 4.55) * s, (portrait ? -1.82 : -2.06) * s, [g, text])
    holder.add(container)
    return container
  }

  private buildTierLabel(holder: Phaser.GameObjects.Container, s: number, tier: number, portrait: boolean): Phaser.GameObjects.Container {
    const scale = portrait ? (tier >= 10 ? 1.75 : 1.95) : (tier >= 10 ? 1.56 : 1.84)
    const size = Math.max(24, Math.round(s * scale))
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
    const container = this.scene.add.container((portrait ? 4.35 : 5.2) * s, (portrait ? -0.05 : -0.12) * s, [shadow, text])
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

    // The complete card—not a persistent connector—slides in from off-screen right.
    this.holder.setPosition(this.offscreenX, rect.cy).setAlpha(0.2)
    this.railsC.setAlpha(0).setPosition(1.8 * s, 0)
    this.panelC.setAlpha(0).setScale(0.04, 0.72)
    this.burstC.setAlpha(0).setScale(0.2)
    this.ballC.setAlpha(0).setScale(0.16).setPosition(0, 0.55 * s)
    this.cloudC.setAlpha(0).setScale(0.2).setPosition(-0.2 * s, 0.12 * s)
    this.duplicateC.setAlpha(0).setScale(0.3).setPosition(tabBase.x + 1.1 * s, tabBase.y - 0.65 * s)
    this.tierC.setAlpha(0).setScale(0.2).setPosition(tierBase.x + 1.05 * s, tierBase.y)
    this.accentC.setAlpha(0)
    this.flashC.setAlpha(0).setScale(0.25)

    this.addTween({ targets: this.holder, x: rect.cx, alpha: 1, duration: 320, ease: 'Cubic.easeOut' })
    this.addTween({ targets: this.flashC, alpha: 1, scaleX: 1, scaleY: 1, delay: 75, duration: 65, ease: 'Cubic.easeOut', onComplete: () => {
      if (!this.flashC) return
      this.addTween({ targets: this.flashC, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 120, ease: 'Cubic.easeOut' })
    } })
    this.addTween({ targets: this.burstC, alpha: 1, scaleX: 1, scaleY: 1, delay: 70, duration: 205, ease: 'Back.easeOut.config(0.55)' })
    this.addTween({ targets: this.railsC, alpha: 1, x: 0, delay: 95, duration: 225, ease: 'Cubic.easeOut' })
    this.addTween({ targets: this.panelC, alpha: 1, scaleX: 1, scaleY: 1, delay: 105, duration: 245, ease: 'Back.easeOut.config(0.32)' })
    this.addTween({ targets: this.ballC, alpha: 1, scaleX: 1, scaleY: 1, y: 0, delay: 125, duration: 215, ease: 'Back.easeOut.config(0.7)' })
    this.addTween({ targets: this.cloudC, alpha: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, delay: 145, duration: 175, ease: 'Back.easeOut.config(0.55)' })
    this.addTween({ targets: this.duplicateC, alpha: 1, scaleX: 1, scaleY: 1, x: tabBase.x, y: tabBase.y, delay: 170, duration: 205, ease: 'Back.easeOut.config(0.7)' })
    this.addTween({ targets: this.tierC, alpha: 1, scaleX: 1, scaleY: 1, x: tierBase.x, y: tierBase.y, delay: 205, duration: 185, ease: 'Back.easeOut.config(0.8)' })
    this.addTween({ targets: this.accentC, alpha: 1, delay: 220, duration: 135, ease: 'Cubic.easeOut' })

    // A short impact aftershock, followed by restrained independent motion.
    this.addTween({ targets: this.holder, x: rect.cx + 2.2, duration: 42, delay: 365, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.ballC, x: -Math.sin(rect.angle) * 1.15, y: -Math.cos(rect.angle) * 1.15, delay: 520, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.burstC, scaleX: 1.012, scaleY: 1.012, delay: 560, duration: 920, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.duplicateC, y: tabBase.y - 1, delay: 600, duration: 820, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.addTween({ targets: this.railsC, x: 1, delay: 620, duration: 980, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
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
    const s = this.hudLayout?.().composition === 'portrait' ? 17 : 24
    if (this.panelC) this.addTween({ targets: this.panelC, scaleX: 0.08, scaleY: 0.78, alpha: 0, duration: 190, ease: 'Cubic.easeIn' })
    if (this.railsC) this.addTween({ targets: this.railsC, x: s * 1.8, alpha: 0, duration: 180, ease: 'Cubic.easeIn' })
    for (const layer of [this.burstC, this.ballC, this.cloudC]) {
      if (layer) this.addTween({ targets: layer, scaleX: 0.8, scaleY: 0.8, alpha: 0, duration: 180, ease: 'Cubic.easeIn' })
    }
    for (const layer of [this.duplicateC, this.tierC, this.accentC]) {
      if (layer) this.addTween({ targets: layer, x: layer.x + s, alpha: 0, duration: 155, ease: 'Cubic.easeIn' })
    }
    this.addTween({ targets: this.holder, x: this.offscreenX, alpha: 0, duration: 260, ease: 'Cubic.easeIn', onComplete: () => this.destroy() })
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
    this.offscreenX = 0
  }
}
