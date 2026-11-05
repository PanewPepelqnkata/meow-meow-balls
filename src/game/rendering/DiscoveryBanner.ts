import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { ballOutlineWidth, drawBallFace, restContour, ballLookFor, drawCollectibleBall, INK } from './BallAppearance'
import { themeFor, variantIdFor } from '../state/runVariant'
import { cycleColor } from './rgbCycle'
import { FONT_FAMILY } from '../../ui/Typography'

/**
 * THE REPEAT-DISCOVERY BANNER — comic-book style announcement for a
 * ball the player has ALREADY discovered in an earlier run.
 *
 * COMIC-BOOK STYLE (matching the approved repeat-unlock reference):
 * - Compact, upper-right horizontal panel that stays clear of gameplay
 * - Angular comic-panel silhouette with clipped corners
 * - THICK cream/off-white outer border with dark outline
 * - Deep purple interior with subtle halftone dots
 * - Readable ball centered in a controlled irregular impact burst
 * - Bold yellow/orange tier label on a cream plate
 * - Small white impact clouds at the ends
 * - Speed lines extending outward
 */

/** How long a banner stays up, ms. */
export const BANNER_MS = 2000

/** Deep purple for the banner field. */
const BANNER_PURPLE = 0x6d28d9
/** Cream/off-white for the border. */
const BANNER_CREAM = 0xfff8e7
/** Bright yellow for the explosion center. */
const EXPLOSION_YELLOW = 0xfde047
/** Restrained lower-right shading inside the impact burst. */
const EXPLOSION_ORANGE = 0xf59e0b
/** Tier label yellow-orange. */
const TIER_LABEL_COLOR = 0xfbbf24

/** The banner's geometry, measured once per show. */
interface BannerRect {
  cx: number
  cy: number
  halfLen: number
  halfThick: number
  angle: number
}

/**
 * Is the banner forced as THE discovery presentation? (?discovery=wind)
 */
export function bannerForcedByVariant(): boolean {
  if (typeof window === 'undefined') return false
  const p = new URLSearchParams(window.location.search).get('discovery') ?? ''
  return p === 'wind'
}

/** Deterministic per-seed RNG (mulberry32). */
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

/**
 * The reference is 1380×1140: its panel body is about 730×140 px, with its
 * right edge and top edge anchored to the viewport rather than to gameplay.
 * Preserve those proportions responsively and derive the centre from the
 * anchored bounds so rotation never pulls the banner into mid-screen.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  const isPortrait = vw < vh
  const halfLen = isPortrait ? Math.min(vw * 0.37, 150) : Math.min(vw * 0.265, 360)
  const halfThick = isPortrait
    ? Math.min(vw * 0.088, vh * 0.048, 38)
    : Math.min(vh * 0.06, vw * 0.05, 68)
  const angle = isPortrait ? 0.045 : 0.12
  const xExtent = Math.cos(angle) * halfLen + Math.sin(angle) * halfThick
  const yExtent = Math.sin(angle) * halfLen + Math.cos(angle) * halfThick
  const rightMargin = Math.max(14, vw * 0.018)
  const topMargin = isPortrait ? Math.max(142, vh * 0.17) : Math.max(52, vh * 0.07)
  const cx = vw - rightMargin - xExtent
  const cy = topMargin + yExtent
  return { cx, cy, halfLen, halfThick, angle }
}

/** A point along the band's centre line, t in 0..1 (0 = left end). */
function bandPoint(rect: BannerRect, t: number): { x: number; y: number } {
  const u = (t - 0.5) * rect.halfLen * 2
  return {
    x: rect.cx + Math.cos(rect.angle) * u,
    y: rect.cy + Math.sin(rect.angle) * u,
  }
}

/**
 * Generate subtle halftone dots for the banner background.
 */
function halftoneDots(rect: BannerRect, seed: number): { x: number; y: number; r: number }[] {
  const rng = makeRng(seed)
  const dots: { x: number; y: number; r: number }[] = []
  const spacing = rect.halfThick * 0.28
  const rows = Math.ceil((rect.halfThick * 2) / spacing) + 1
  const cols = Math.ceil((rect.halfLen * 2) / spacing) + 1
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offsetX = (row % 2) * spacing * 0.5
      const x = -rect.halfLen + col * spacing + offsetX - spacing * 0.5
      const y = -rect.halfThick + row * spacing - spacing * 0.5
      const r = spacing * 0.2 * (0.5 + rng() * 0.5) // Smaller, subtler dots
      dots.push({ x, y, r })
    }
  }
  return dots
}

/**
 * Generate 10 controlled, irregular impact spikes. The filled inner body is
 * close to the ball while the short outer points provide the comic impact.
 */
function explosionPoints(
  cx: number,
  cy: number,
  ballRadius: number,
  seed: number,
): { x: number; y: number }[] {
  const rng = makeRng(seed)
  const points: { x: number; y: number }[] = []
  const innerR = ballRadius * 1.3
  const outerR = ballRadius * 1.95
  const spikes = 10
  const profile = [1.14, 0.86, 1.04, 0.82, 1.1, 0.9, 1.02, 0.84, 1.08, 0.88]

  for (let i = 0; i < spikes * 2; i++) {
    const jitter = (rng() - 0.5) * 0.09
    const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2 + jitter
    const isOuter = i % 2 === 0
    const profileScale = isOuter ? (profile[i / 2] ?? 1) : 1
    const baseR = (isOuter ? outerR : innerR) * profileScale
    const variance = isOuter ? 0.06 : 0.07
    const r = baseR * (1 - variance + rng() * variance * 2)
    points.push({
      x: cx + Math.cos(angle) * r * 1.18,
      y: cy + Math.sin(angle) * r,
    })
  }
  return points
}


/**
 * THE BANNER — one instance on the UIScene.
 */
export class DiscoveryBanner {
  private scene: Phaser.Scene
  private objs: Phaser.GameObjects.GameObject[] = []
  get objsCount(): number {
    return this.objs.length
  }

  private bandG: Phaser.GameObjects.Graphics | null = null
  private burstG: Phaser.GameObjects.Graphics | null = null
  private ballG: Phaser.GameObjects.Graphics | null = null
  private effectsG: Phaser.GameObjects.Graphics | null = null
  private text: Phaser.GameObjects.Text | null = null
  private textShadow: Phaser.GameObjects.Text | null = null
  private tweens: Phaser.Tweens.Tween[] = []
  private rect: BannerRect | null = null
  private tier = 1
  private seed = 0
  private theme: string | null = null
  private variant: number | null = null
  private animPhase = 0
  private ballPop = 0
  private burstPop = 0
  private panelPop = 0
  private labelPop = 0
  private labelSize = 0
  private active = false
  private reducedMotion = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  isShowing(): boolean {
    return this.active
  }

  show(tier: number, seed: number, theme: string | null = null, variant: number | null = null): void {
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
    const vw = this.scene.scale.width / z
    const vh = this.scene.scale.height / z
    this.rect = bannerRect(vw, vh)
    this.ballPop = 0
    this.burstPop = 0
    this.panelPop = 0
    this.labelPop = 0

    // Create graphics layers
    this.bandG = this.scene.add.graphics().setDepth(78.6)
    this.burstG = this.scene.add.graphics().setDepth(78.7)
    this.ballG = this.scene.add.graphics().setDepth(78.75)
    this.effectsG = this.scene.add.graphics().setDepth(78.65)

    const fontSize = Math.round(Math.max(24, Math.min(this.rect.halfThick * 0.86, 56)))
    const textStroke = Math.max(4, Math.round(this.rect.halfThick * 0.1))
    this.textShadow = this.scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${fontSize}px`,
        color: '#000000',
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
      .setDepth(78.79)
      .setAlpha(0.5)

    this.text = this.scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${fontSize}px`,
        color: '#fbbf24',
        stroke: '#1a1a1a',
        strokeThickness: textStroke,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
      .setDepth(78.8)

    this.objs.push(this.bandG, this.burstG, this.ballG, this.effectsG, this.textShadow, this.text)

    // Container for all elements
    const holder = this.scene.add.container(0, 0).setDepth(78.6)
    holder.add([this.bandG, this.effectsG, this.burstG, this.ballG, this.textShadow, this.text])
    this.objs.push(holder)
    this.holder = holder

    // ---- COMIC-BOOK ENTRANCE ANIMATION ----
    // The holder remains at the viewport anchor; only its artwork pops.
    holder.alpha = this.reducedMotion ? 1 : 0

    if (this.reducedMotion) {
      this.panelPop = 1
      this.burstPop = 1
      this.ballPop = 1
      this.labelPop = 1
      this.draw()
      this.dismissTimer = this.scene.time.delayedCall(BANNER_MS, () => this.dismiss())
      return
    }

    // Quick flash
    this.tweens.push(
      this.scene.tweens.add({
        targets: holder,
        alpha: 1,
        duration: 60,
        ease: 'Sine.easeOut',
      }),
    )

    // Panel expands
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        panelPop: 1,
        duration: 220,
        delay: 35,
        ease: 'Cubic.easeOut',
      }),
    )

    // Explosion pops in
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        burstPop: 1,
        duration: 220,
        delay: 90,
        ease: 'Back.easeOut.config(0.65)',
      }),
    )

    // Ball pops into center
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        ballPop: 1,
        duration: 240,
        delay: 145,
        ease: 'Back.easeOut.config(0.75)',
      }),
    )

    // Tier label punches in
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        labelPop: 1,
        duration: 190,
        delay: 220,
        ease: 'Back.easeOut.config(0.8)',
      }),
    )


    // Animation clock
    this.animTween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 8000,
      repeat: -1,
      onUpdate: (tween) => {
        const v = tween.getValue()
        if (v == null) return
        this.animPhase = v
        this.draw()
      },
    })

    // Auto-dismiss
    this.dismissTimer = this.scene.time.delayedCall(BANNER_MS, () => this.dismiss())
  }

  private holder: Phaser.GameObjects.Container | null = null
  private animTween: Phaser.Tweens.Tween | null = null
  private dismissTimer: Phaser.Time.TimerEvent | null = null

  /** Draw the complete banner. */
  private draw(): void {
    const rect = this.rect
    if (!rect || !this.bandG || !this.ballG || !this.burstG || !this.effectsG) return

    const g = this.bandG
    g.clear()
    this.effectsG.clear()
    this.burstG.clear()
    this.ballG.clear()

    const color = getTier(this.tier)?.color ?? 0xffffff
    const cos = Math.cos(rect.angle)
    const sin = Math.sin(rect.angle)
    const local = (u: number, v: number): { x: number; y: number } => ({
      x: rect.cx + cos * u - sin * v,
      y: rect.cy + sin * u + cos * v,
    })

    const panelScale = this.panelPop
    if (panelScale < 0.01) return

    // Fixed paired accents stay tucked behind the ends, never floating loose.
    this.drawSpeedStreaks(g, rect, local, panelScale)

    // ---- OFFSET SHADOW + DARK OUTLINE + CREAM DOUBLE BORDER ----
    const shOff = rect.halfThick * 0.1
    g.fillStyle(0x000000, 0.42)
    this.drawPanelShape(g, rect, local, shOff * 0.6, shOff, panelScale)

    g.fillStyle(INK, 1)
    this.drawPanelShape(g, rect, local, 0, 0, panelScale)

    const outerInk = Math.max(3, rect.halfThick * 0.07)
    g.fillStyle(BANNER_CREAM, 1)
    this.drawPanelShape(g, rect, local, 0, 0, panelScale, outerInk)

    const borderW = rect.halfThick * 0.18
    g.fillStyle(INK, 1)
    this.drawPanelShape(g, rect, local, 0, 0, panelScale, borderW)
    const purpleInset = borderW + Math.max(2, rect.halfThick * 0.04)
    g.fillStyle(BANNER_PURPLE, 1)
    this.drawPanelShape(g, rect, local, 0, 0, panelScale, purpleInset)

    // ---- SUBTLE HALFTONE DOTS ----
    const dots = halftoneDots(rect, this.seed)
    g.fillStyle(0x45139b, 0.54)
    for (const d of dots) {
      const p = local(d.x * panelScale, d.y * panelScale)
      const insideX = Math.abs(d.x) < rect.halfLen - purpleInset * 1.6
      if (insideX && Math.abs(d.y) < rect.halfThick - purpleInset - d.r) {
        g.fillCircle(p.x, p.y, d.r * panelScale)
      }
    }

    g.lineStyle(Math.max(2, rect.halfThick * 0.055), INK, 1)
    this.strokePanelShape(g, rect, local, 0, 0, panelScale)
    g.lineStyle(Math.max(1.5, rect.halfThick * 0.035), BANNER_CREAM, 0.9)
    this.strokePanelShape(g, rect, local, 0, 0, panelScale, purpleInset + rect.halfThick * 0.06)

    // ---- CREAM LABEL PLATE + ATTACHED IMPACT CLOUDS ----
    this.drawLabelPlate(this.effectsG, rect, local, panelScale)
    this.drawImpactCloud(this.effectsG, local, -rect.halfLen * panelScale, 0, rect.halfThick * 0.3 * panelScale)
    this.drawImpactCloud(this.effectsG, local, rect.halfLen * panelScale, 0, rect.halfThick * 0.3 * panelScale)

    // ---- COMPACT IMPACT BURST + REAL UNLOCKED CHARACTER ----
    const ballScale = this.ballPop
    const burstScale = this.burstPop
    if (ballScale > 0.01 || burstScale > 0.01) {
      const ballCenter = bandPoint(rect, 0.38)
      const baseBallRadius = rect.halfThick * 0.64
      const ballRadius = baseBallRadius * ballScale
      const bob = Math.sin(this.animPhase * Math.PI) * baseBallRadius * 0.025

      if (burstScale > 0.01) {
        const burstRadius = baseBallRadius * burstScale
        const explosionPts = explosionPoints(ballCenter.x, ballCenter.y + bob, burstRadius, this.seed)
        this.burstG.fillStyle(EXPLOSION_YELLOW, 1)
        this.burstG.fillPoints(explosionPts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
        // Restrained orange crescent remains mostly behind the character.
        this.burstG.fillStyle(EXPLOSION_ORANGE, 0.42)
        this.burstG.fillCircle(ballCenter.x + burstRadius * 0.1, ballCenter.y + bob + burstRadius * 0.12, burstRadius * 1.2)
        this.burstG.fillStyle(EXPLOSION_YELLOW, 1)
        this.burstG.fillCircle(ballCenter.x, ballCenter.y + bob, burstRadius * 1.08)
        this.burstG.lineStyle(Math.max(3, rect.halfThick * 0.065), INK, 1)
        this.burstG.strokePoints(explosionPts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      }

      if (ballScale > 0.01) {
        const look = ballLookFor(this.tier, this.seed)
        const poly = restContour(look, ballRadius, ballCenter.x, ballCenter.y + bob, 48)

        if (this.tier === 9 || this.tier === 10) {
          const theme = this.theme ?? themeFor(this.tier)
          const variant = this.variant ?? variantIdFor(this.tier)
          drawCollectibleBall(this.ballG, ballCenter.x, ballCenter.y + bob, ballRadius, this.tier, variant, undefined, 0, undefined, this.seed, theme ?? undefined)
        } else {
          this.ballG.fillStyle(this.tier === 8 ? cycleColor(Date.now()) : color, 1)
          this.ballG.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
          this.ballG.lineStyle(ballOutlineWidth(ballRadius), INK, 1)
          this.ballG.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
          drawBallFace(this.ballG, look, { x: ballCenter.x, y: ballCenter.y + bob }, ballRadius, 1)
        }
      }
    }

    // ---- PROMINENT TIER LABEL ----
    const labelScale = this.labelPop
    if (this.text && this.textShadow && labelScale > 0.01) {
      const p = bandPoint(rect, 0.81)
      this.text.setText(`TIER ${this.tier}`)
      this.textShadow.setText(`TIER ${this.tier}`)

      const size = Math.round(Math.max(24, Math.min(rect.halfThick * 0.86, 56)) * labelScale)
      if (this.labelSize !== size) {
        this.labelSize = size
        this.text.setFontSize(size)
        this.textShadow.setFontSize(size)
      }

      const bounce = Math.sin(labelScale * Math.PI) * 3
      this.text.setPosition(p.x, p.y - bounce)
      this.textShadow.setPosition(p.x + 4, p.y + 4 - bounce)
      this.text.setRotation(rect.angle)
      this.textShadow.setRotation(rect.angle)
      this.text.setColor(`#${TIER_LABEL_COLOR.toString(16).padStart(6, '0')}`)
    }
  }

  /** Fixed, symmetrical motion accents tucked behind the panel ends. */
  private drawSpeedStreaks(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    scale: number,
  ): void {
    const lineW = Math.max(1.5, rect.halfThick * 0.035) * scale
    const segments: Array<[number, number, number, number]> = [
      [-rect.halfLen * 0.98, -rect.halfThick * 0.55, -rect.halfLen - rect.halfThick * 0.88, -rect.halfThick * 0.82],
      [-rect.halfLen * 0.98, 0, -rect.halfLen - rect.halfThick * 0.72, -rect.halfThick * 0.08],
      [-rect.halfLen * 0.98, rect.halfThick * 0.55, -rect.halfLen - rect.halfThick, rect.halfThick * 0.78],
      [rect.halfLen * 0.62, rect.halfThick * 1.02, rect.halfLen * 0.98, rect.halfThick * 1.08],
      [rect.halfLen * 0.68, rect.halfThick * 1.18, rect.halfLen * 0.98, rect.halfThick * 1.23],
      [rect.halfLen * 0.76, rect.halfThick * 1.34, rect.halfLen * 0.98, rect.halfThick * 1.38],
    ]
    const drawPass = (width: number, color: number, alpha: number): void => {
      g.lineStyle(width, color, alpha)
      for (const [u1, v1, u2, v2] of segments) {
        const inner = local(u1 * scale, v1 * scale)
        const outer = local(u2 * scale, v2 * scale)
        g.beginPath()
        g.moveTo(inner.x, inner.y)
        g.lineTo(outer.x, outer.y)
        g.strokePath()
      }
    }
    drawPass(lineW + Math.max(1.5, rect.halfThick * 0.035), INK, 0.9)
    drawPass(lineW, BANNER_CREAM, 0.96)
  }

  /** Cream comic puff attached directly to a panel tip. */
  private drawImpactCloud(
    g: Phaser.GameObjects.Graphics,
    local: (u: number, v: number) => { x: number; y: number },
    u: number,
    v: number,
    size: number,
  ): void {
    const p = local(u, v)
    const lobes = [
      { x: -0.48, y: 0, r: 0.52 },
      { x: -0.12, y: -0.42, r: 0.5 },
      { x: 0.28, y: -0.18, r: 0.55 },
      { x: 0.32, y: 0.3, r: 0.48 },
      { x: -0.12, y: 0.36, r: 0.5 },
    ]
    for (const lobe of lobes) {
      g.fillStyle(INK, 1)
      g.fillCircle(p.x + lobe.x * size, p.y + lobe.y * size, lobe.r * size + Math.max(1.5, size * 0.11))
    }
    for (const lobe of lobes) {
      g.fillStyle(BANNER_CREAM, 1)
      g.fillCircle(p.x + lobe.x * size, p.y + lobe.y * size, lobe.r * size)
    }
  }

  /** Cream clipped ribbon behind the tier label, as in the reference. */
  private drawLabelPlate(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    scale: number,
  ): void {
    const centerU = rect.halfLen * 0.62 * scale
    const halfW = Math.min(rect.halfLen * 0.25, rect.halfThick * 1.72) * scale
    const halfH = rect.halfThick * 0.55 * scale
    const points = (inset: number): Phaser.Math.Vector2[] => {
      const w = halfW - inset
      const h = halfH - inset
      return [
        local(centerU - w, -h * 0.7),
        local(centerU - w * 0.86, -h),
        local(centerU + w * 0.82, -h * 0.9),
        local(centerU + w, -h * 0.45),
        local(centerU + w * 0.92, h * 0.78),
        local(centerU - w * 0.82, h),
        local(centerU - w, h * 0.58),
      ].map((p) => new Phaser.Math.Vector2(p.x, p.y))
    }
    g.fillStyle(INK, 1)
    g.fillPoints(points(0), true)
    g.fillStyle(BANNER_CREAM, 1)
    g.fillPoints(points(Math.max(2, rect.halfThick * 0.055) * scale), true)
  }

  /** Draw the angular comic-panel shape. */
  private drawPanelShape(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    offsetX: number,
    offsetY: number,
    scale: number,
    inset: number = 0,
  ): void {
    const hl = (rect.halfLen - inset) * scale
    const ht = (rect.halfThick - inset) * scale

    // Long panel with mostly straight edges and restrained clipped corners.
    const cut = ht * 0.34
    const points = [
      local(-hl, -ht * 0.52),
      local(-hl + cut, -ht * 0.92),
      local(-hl * 0.3, -ht),
      local(hl - cut, -ht * 0.88),
      local(hl, -ht * 0.52),
      local(hl, ht * 0.5),
      local(hl - cut, ht * 0.92),
      local(-hl * 0.45, ht),
      local(-hl + cut, ht * 0.86),
      local(-hl, ht * 0.48),
    ]

    g.fillPoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true)
  }

  /** Stroke the panel shape outline. */
  private strokePanelShape(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    offsetX: number,
    offsetY: number,
    scale: number,
    inset: number = 0,
  ): void {
    const hl = (rect.halfLen - inset) * scale
    const ht = (rect.halfThick - inset) * scale
    const cut = ht * 0.34
    const points = [
      local(-hl, -ht * 0.52),
      local(-hl + cut, -ht * 0.92),
      local(-hl * 0.3, -ht),
      local(hl - cut, -ht * 0.88),
      local(hl, -ht * 0.52),
      local(hl, ht * 0.5),
      local(hl - cut, ht * 0.92),
      local(-hl * 0.45, ht),
      local(-hl + cut, ht * 0.86),
      local(-hl, ht * 0.48),
    ]

    g.strokePoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true, true)
  }

  /** Anchored comic-style exit: fade/compress in place, never sweep gameplay. */
  dismiss(): void {
    if (!this.active) return
    const holder = this.holder
    if (!holder) {
      this.destroy()
      return
    }
    if (this.reducedMotion) {
      this.destroy()
      return
    }
    this.tweens.push(
      this.scene.tweens.add({
        targets: holder,
        alpha: 0,
        duration: 150,
        ease: 'Cubic.easeIn',
        onComplete: () => this.destroy(),
      }),
    )
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        panelPop: 0.86,
        burstPop: 0.82,
        ballPop: 0.9,
        labelPop: 0.88,
        duration: 150,
        ease: 'Cubic.easeIn',
      }),
    )
  }

  /** Tear down every object and tween. */
  destroy(): void {
    this.active = false
    this.dismissTimer?.remove()
    this.dismissTimer = null
    for (const t of this.tweens) t.stop()
    this.tweens = []
    this.animTween?.stop()
    this.animTween = null
    this.scene.tweens.killTweensOf(this.objs)
    for (const o of this.objs) o.destroy()
    this.objs = []
    this.bandG = null
    this.burstG = null
    this.ballG = null
    this.effectsG = null
    this.text = null
    this.textShadow = null
    this.holder = null
    this.rect = null
  }
}
