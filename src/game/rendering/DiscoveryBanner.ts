import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { ballOutlineWidth, drawBallFace, restContour, ballLookFor, drawCollectibleBall, INK } from './BallAppearance'
import { themeFor, variantIdFor } from '../state/runVariant'
import { cycleColor } from './rgbCycle'
import { FONT_FAMILY } from '../../ui/Typography'
import { readSafeArea, type UiLayout } from '../../ui/ResponsiveLayout'

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
 * Responsive geometry for the approved compact reference. The source capture
 * has a ~320×62 px panel in a ~1671×770 gameplay viewport, with enough room
 * to its right for the pause button and the outward speed streaks.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  const isPortrait = vw < vh
  const halfLen = isPortrait ? Math.min(vw * 0.31, 128) : Math.min(vw * 0.102, 160)
  const halfThick = isPortrait
    ? Math.min(vw * 0.06, vh * 0.034, 26)
    : Math.min(vh * 0.04, vw * 0.023, 32)
  const angle = isPortrait ? 0.045 : 0.07
  const xExtent = Math.cos(angle) * halfLen + Math.sin(angle) * halfThick
  const yExtent = Math.sin(angle) * halfLen + Math.cos(angle) * halfThick
  const rightMargin = isPortrait ? Math.max(14, vw * 0.04) : Math.max(44, vw * 0.056)
  const topMargin = isPortrait ? Math.max(142, vh * 0.17) : Math.max(36, vh * 0.065)
  const cx = vw - rightMargin - xExtent
  const cy = topMargin + yExtent
  return { cx, cy, halfLen, halfThick, angle }
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
  private readonly hudLayout: (() => UiLayout) | null
  private objs: Phaser.GameObjects.GameObject[] = []
  private holder: Phaser.GameObjects.Container | null = null
  private streakG: Phaser.GameObjects.Graphics | null = null
  private bandG: Phaser.GameObjects.Graphics | null = null
  private flashG: Phaser.GameObjects.Graphics | null = null
  private burstG: Phaser.GameObjects.Graphics | null = null
  private ballG: Phaser.GameObjects.Graphics | null = null
  private labelPlateG: Phaser.GameObjects.Graphics | null = null
  private cloudG: Phaser.GameObjects.Graphics | null = null
  private text: Phaser.GameObjects.Text | null = null
  private textShadow: Phaser.GameObjects.Text | null = null
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
    return this.objs.length
  }

  isShowing(): boolean {
    return this.active
  }

  show(tier: number, seed: number, theme: string | null = null, variant: number | null = null): void {
    // A rapid second duplicate replaces every old layer/tween before new data
    // is read, so a character from the previous banner can never linger.
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
    if (layout) {
      if (layout.composition === 'portrait') {
        const top = rect.cy - (Math.sin(rect.angle) * rect.halfLen + Math.cos(rect.angle) * rect.halfThick)
        rect.cy += Math.max(0, layout.stack.hudBottom + 12 - top)
      } else {
        const safe = readSafeArea()
        const pauseCenterX = layout.vw - Math.max(12, safe.right + 8) - 24
        const right = rect.cx + Math.cos(rect.angle) * rect.halfLen + Math.sin(rect.angle) * rect.halfThick + rect.halfThick * 0.78
        rect.cx -= Math.max(0, right - (pauseCenterX - 32))
      }
    }

    this.streakG = this.scene.add.graphics()
    this.bandG = this.scene.add.graphics()
    this.flashG = this.scene.add.graphics()
    this.burstG = this.scene.add.graphics()
    this.ballG = this.scene.add.graphics()
    this.labelPlateG = this.scene.add.graphics()
    this.cloudG = this.scene.add.graphics()

    const label = `TIER ${tier}`
    const baseFontSize = Math.max(22, Math.min(rect.halfThick * 1.18, 38))
    const fontSize = Math.round(tier >= 10 ? baseFontSize * 0.9 : baseFontSize)
    const textStroke = Math.max(3, Math.round(rect.halfThick * 0.13))
    const resolution = Math.max(2, Math.min(window.devicePixelRatio || 1, 2))
    this.textShadow = this.scene.add
      .text(0, 0, label, {
        fontFamily: FONT_FAMILY,
        fontSize: `${fontSize}px`,
        color: '#111111',
        stroke: '#111111',
        strokeThickness: textStroke,
        resolution,
      })
      .setOrigin(0.5)
      .setAlpha(0.55)
    this.text = this.scene.add
      .text(0, 0, label, {
        fontFamily: FONT_FAMILY,
        fontSize: `${fontSize}px`,
        color: `#${TIER_LABEL_COLOR.toString(16).padStart(6, '0')}`,
        stroke: '#1a1a1a',
        strokeThickness: textStroke,
        resolution,
      })
      .setOrigin(0.5)

    const holder = this.scene.add.container(rect.cx, rect.cy).setRotation(rect.angle).setDepth(78.6)
    holder.add([
      this.streakG,
      this.bandG,
      this.flashG,
      this.burstG,
      this.ballG,
      this.labelPlateG,
      this.textShadow,
      this.text,
      this.cloudG,
    ])
    this.holder = holder
    this.objs.push(
      this.streakG,
      this.bandG,
      this.flashG,
      this.burstG,
      this.ballG,
      this.labelPlateG,
      this.textShadow,
      this.text,
      this.cloudG,
      holder,
    )

    this.drawStaticArtwork(rect)
    this.placeLayers(rect)
    if (tier === 8 && !this.reducedMotion) {
      this.rgbTimer = this.scene.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {
          if (!this.ballG) return
          this.ballG.clear()
          this.drawBall(this.ballG, rect)
        },
      })
    }

    if (this.reducedMotion) {
      this.applyFinalPose(rect)
    } else {
      this.playEntrance(rect)
    }
    this.dismissTimer = this.scene.time.delayedCall(BANNER_MS, () => this.dismiss())
  }

  /** Draw every vector exactly once. Animation below uses transforms only. */
  private drawStaticArtwork(rect: BannerRect): void {
    if (!this.streakG || !this.bandG || !this.flashG || !this.burstG || !this.ballG || !this.labelPlateG || !this.cloudG) return
    const local = (u: number, v: number): { x: number; y: number } => ({ x: u, y: v })

    this.drawSpeedStreaks(this.streakG, rect)

    const shOff = rect.halfThick * 0.11
    this.bandG.fillStyle(0x000000, 0.38)
    this.drawPanelShape(this.bandG, rect, local, shOff * 0.6, shOff, 1)
    this.bandG.fillStyle(INK, 1)
    this.drawPanelShape(this.bandG, rect, local, 0, 0, 1)

    const outerInk = Math.max(2.5, rect.halfThick * 0.08)
    this.bandG.fillStyle(BANNER_CREAM, 1)
    this.drawPanelShape(this.bandG, rect, local, 0, 0, 1, outerInk)
    const borderW = rect.halfThick * 0.19
    this.bandG.fillStyle(INK, 1)
    this.drawPanelShape(this.bandG, rect, local, 0, 0, 1, borderW)
    const purpleInset = borderW + Math.max(1.5, rect.halfThick * 0.045)
    this.bandG.fillStyle(BANNER_PURPLE, 1)
    this.drawPanelShape(this.bandG, rect, local, 0, 0, 1, purpleInset)

    // Computed once per show; no per-frame halftone allocations or redraws.
    this.bandG.fillStyle(0x45139b, 0.58)
    for (const dot of halftoneDots(rect, this.seed)) {
      const insideX = Math.abs(dot.x) < rect.halfLen - purpleInset * 1.6
      const endTaper = Math.abs(dot.x) > rect.halfLen * 0.82 ? 0.72 : 1
      const insideY = Math.abs(dot.y) < (rect.halfThick - purpleInset - dot.r) * endTaper
      if (insideX && insideY) this.bandG.fillCircle(dot.x, dot.y, dot.r)
    }

    this.bandG.lineStyle(Math.max(2, rect.halfThick * 0.065), INK, 1)
    this.strokePanelShape(this.bandG, rect, local, 0, 0, 1)
    this.bandG.lineStyle(Math.max(1.25, rect.halfThick * 0.038), BANNER_CREAM, 0.92)
    this.strokePanelShape(this.bandG, rect, local, 0, 0, 1, purpleInset + rect.halfThick * 0.065)

    this.drawFlash(this.flashG, rect)
    this.drawBurst(this.burstG, rect)
    this.drawBall(this.ballG, rect)
    this.drawLabelPlate(this.labelPlateG, rect)
    this.drawImpactCloud(this.cloudG, -rect.halfLen, 0, rect.halfThick * 0.34)
    this.drawImpactCloud(this.cloudG, rect.halfLen, 0, rect.halfThick * 0.34)
  }

  private placeLayers(rect: BannerRect): void {
    if (!this.flashG || !this.burstG || !this.ballG || !this.labelPlateG || !this.text || !this.textShadow) return
    const ballU = (0.375 - 0.5) * rect.halfLen * 2
    const labelU = (0.75 - 0.5) * rect.halfLen * 2
    this.flashG.setPosition(ballU, 0)
    this.burstG.setPosition(ballU, 0)
    this.ballG.setPosition(ballU, 0).setRotation(-rect.angle)
    this.labelPlateG.setPosition(labelU, 0)
    this.textShadow.setPosition(labelU + 2.5, 2.5)
    this.text.setPosition(labelU, 0)
  }

  private applyFinalPose(rect: BannerRect): void {
    if (!this.holder || !this.streakG || !this.bandG || !this.flashG || !this.burstG || !this.ballG || !this.labelPlateG || !this.cloudG || !this.text || !this.textShadow) return
    const ballU = (0.375 - 0.5) * rect.halfLen * 2
    this.holder.setAlpha(1)
    this.streakG.setAlpha(0.92).setScale(1)
    this.bandG.setAlpha(1).setScale(1)
    this.flashG.setAlpha(0).setScale(1)
    this.burstG.setAlpha(1).setScale(1)
    this.ballG.setAlpha(1).setScale(1).setPosition(ballU, 0)
    this.labelPlateG.setAlpha(1).setScale(1)
    this.cloudG.setAlpha(1).setScale(1)
    this.textShadow.setAlpha(0.55).setScale(1)
    this.text.setAlpha(1).setScale(1)
  }

  private playEntrance(rect: BannerRect): void {
    if (!this.holder || !this.streakG || !this.bandG || !this.flashG || !this.burstG || !this.ballG || !this.labelPlateG || !this.cloudG || !this.text || !this.textShadow) return
    const ballU = (0.375 - 0.5) * rect.halfLen * 2
    const settle = rect.halfThick * 0.28
    const localDownX = Math.sin(rect.angle) * settle
    const localDownY = Math.cos(rect.angle) * settle

    this.holder.setAlpha(1)
    this.streakG.setAlpha(0)
    this.bandG.setAlpha(0).setScale(0.08, 0.76)
    this.flashG.setAlpha(0).setScale(0.2)
    this.burstG.setAlpha(0).setScale(0.12)
    this.ballG.setAlpha(0).setScale(0.16).setPosition(ballU + localDownX, localDownY)
    this.labelPlateG.setAlpha(0).setScale(0.18, 0.78)
    this.cloudG.setAlpha(0).setScale(0.35)
    this.textShadow.setAlpha(0).setScale(0.2)
    this.text.setAlpha(0).setScale(0.2)

    const flashIn = this.scene.tweens.add({
      targets: this.flashG,
      alpha: 1,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 55,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (!this.flashG) return
        const flashOut = this.scene.tweens.add({
          targets: this.flashG,
          alpha: 0,
          scaleX: 1.65,
          scaleY: 1.65,
          duration: 115,
          ease: 'Cubic.easeOut',
        })
        this.tweens.push(flashOut)
      },
    })
    this.tweens.push(flashIn)
    this.tweens.push(
      this.scene.tweens.add({
        targets: this.burstG,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: 25,
        duration: 180,
        ease: 'Back.easeOut.config(0.65)',
      }),
      this.scene.tweens.add({
        targets: this.ballG,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        x: ballU,
        y: 0,
        delay: 70,
        duration: 200,
        ease: 'Back.easeOut.config(0.75)',
      }),
      this.scene.tweens.add({
        targets: this.bandG,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: 75,
        duration: 230,
        ease: 'Back.easeOut.config(0.35)',
      }),
      this.scene.tweens.add({
        targets: this.streakG,
        alpha: 0.92,
        delay: 125,
        duration: 125,
        ease: 'Cubic.easeOut',
      }),
      this.scene.tweens.add({
        targets: this.cloudG,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: 135,
        duration: 140,
        ease: 'Back.easeOut.config(0.55)',
      }),
      this.scene.tweens.add({
        targets: this.labelPlateG,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: 155,
        duration: 155,
        ease: 'Back.easeOut.config(0.65)',
      }),
      this.scene.tweens.add({
        targets: [this.textShadow, this.text],
        alpha: { from: 0, to: 1 },
        scaleX: 1,
        scaleY: 1,
        delay: 175,
        duration: 170,
        ease: 'Back.easeOut.config(0.8)',
        onComplete: () => this.textShadow?.setAlpha(0.55),
      }),
    )

    // Screen-vertical 1.5 px bob. Root rotation is cancelled in local x/y.
    const idle = rect.halfThick * 0.05
    this.tweens.push(
      this.scene.tweens.add({
        targets: this.ballG,
        x: ballU - Math.sin(rect.angle) * idle,
        y: -Math.cos(rect.angle) * idle,
        delay: 430,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    )
  }

  /** Brief cream/yellow impact glint, always behind the actual character. */
  private drawFlash(g: Phaser.GameObjects.Graphics, rect: BannerRect): void {
    const r = rect.halfThick * 0.72
    const rays = 8
    const drawRays = (width: number, color: number, alpha: number): void => {
      g.lineStyle(width, color, alpha)
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2
        g.beginPath()
        g.moveTo(Math.cos(a) * r * 1.62, Math.sin(a) * r * 1.62)
        g.lineTo(Math.cos(a) * r * 2.12, Math.sin(a) * r * 2.12)
        g.strokePath()
      }
    }
    drawRays(Math.max(3, rect.halfThick * 0.13), INK, 0.9)
    drawRays(Math.max(1.5, rect.halfThick * 0.065), BANNER_CREAM, 1)
    g.fillStyle(EXPLOSION_YELLOW, 0.75)
    g.fillCircle(0, 0, r * 1.3)
  }

  private drawBurst(g: Phaser.GameObjects.Graphics, rect: BannerRect): void {
    const radius = rect.halfThick * 0.66
    const points = explosionPoints(0, 0, radius, this.seed)
    const vectors = points.map((p) => new Phaser.Math.Vector2(p.x, p.y))
    g.fillStyle(EXPLOSION_YELLOW, 1)
    g.fillPoints(vectors, true)
    g.fillStyle(EXPLOSION_ORANGE, 0.4)
    g.fillCircle(radius * 0.1, radius * 0.12, radius * 1.2)
    g.fillStyle(EXPLOSION_YELLOW, 1)
    g.fillCircle(0, 0, radius * 1.08)
    g.lineStyle(Math.max(3, rect.halfThick * 0.075), INK, 1)
    g.strokePoints(vectors, true, true)
  }

  private drawBall(g: Phaser.GameObjects.Graphics, rect: BannerRect): void {
    const radius = rect.halfThick * 0.8
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
    g.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
    g.lineStyle(ballOutlineWidth(radius), INK, 1)
    g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
    drawBallFace(g, look, { x: 0, y: 0 }, radius, 1)
  }

  /** Fixed, balanced motion accents. The right group stops before Pause. */
  private drawSpeedStreaks(g: Phaser.GameObjects.Graphics, rect: BannerRect): void {
    const segments: Array<[number, number, number, number]> = [
      [-rect.halfLen * 0.97, -rect.halfThick * 0.58, -rect.halfLen - rect.halfThick * 1.2, -rect.halfThick * 0.82],
      [-rect.halfLen * 0.98, 0, -rect.halfLen - rect.halfThick, -rect.halfThick * 0.08],
      [-rect.halfLen * 0.97, rect.halfThick * 0.58, -rect.halfLen - rect.halfThick * 1.25, rect.halfThick * 0.82],
      [rect.halfLen * 0.4, rect.halfThick * 0.94, rect.halfLen + rect.halfThick * 0.72, rect.halfThick * 1.22],
      [rect.halfLen * 0.56, rect.halfThick * 1.14, rect.halfLen + rect.halfThick * 0.64, rect.halfThick * 1.42],
      [rect.halfLen * 0.7, rect.halfThick * 1.34, rect.halfLen + rect.halfThick * 0.54, rect.halfThick * 1.58],
    ]
    const lineW = Math.max(1.25, rect.halfThick * 0.04)
    const drawPass = (width: number, color: number, alpha: number): void => {
      g.lineStyle(width, color, alpha)
      for (const [x1, y1, x2, y2] of segments) {
        g.beginPath()
        g.moveTo(x1, y1)
        g.lineTo(x2, y2)
        g.strokePath()
      }
    }
    drawPass(lineW + Math.max(1.25, rect.halfThick * 0.04), INK, 0.88)
    drawPass(lineW, BANNER_CREAM, 0.96)
  }

  private drawImpactCloud(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void {
    const lobes = [
      { x: -0.48, y: 0, r: 0.52 },
      { x: -0.12, y: -0.42, r: 0.5 },
      { x: 0.28, y: -0.18, r: 0.55 },
      { x: 0.32, y: 0.3, r: 0.48 },
      { x: -0.12, y: 0.36, r: 0.5 },
    ]
    for (const lobe of lobes) {
      g.fillStyle(INK, 1)
      g.fillCircle(x + lobe.x * size, y + lobe.y * size, lobe.r * size + Math.max(1.25, size * 0.11))
    }
    for (const lobe of lobes) {
      g.fillStyle(BANNER_CREAM, 1)
      g.fillCircle(x + lobe.x * size, y + lobe.y * size, lobe.r * size)
    }
  }

  private drawLabelPlate(g: Phaser.GameObjects.Graphics, rect: BannerRect): void {
    const halfW = Math.min(rect.halfLen * 0.34, rect.halfThick * 2.1)
    const halfH = rect.halfThick * 0.58
    const points = (inset: number): Phaser.Math.Vector2[] => {
      const w = halfW - inset
      const h = halfH - inset
      return [
        new Phaser.Math.Vector2(-w, -h * 0.68),
        new Phaser.Math.Vector2(-w * 0.86, -h),
        new Phaser.Math.Vector2(w * 0.82, -h * 0.9),
        new Phaser.Math.Vector2(w, -h * 0.44),
        new Phaser.Math.Vector2(w * 0.92, h * 0.78),
        new Phaser.Math.Vector2(-w * 0.82, h),
        new Phaser.Math.Vector2(-w, h * 0.58),
      ]
    }
    g.fillStyle(INK, 1)
    g.fillPoints(points(0), true)
    g.fillStyle(BANNER_CREAM, 1)
    g.fillPoints(points(Math.max(1.75, rect.halfThick * 0.065)), true)
  }

  private drawPanelShape(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    offsetX: number,
    offsetY: number,
    scale: number,
    inset: number = 0,
  ): void {
    const points = this.panelPoints(rect, local, scale, inset)
    g.fillPoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true)
  }

  private strokePanelShape(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    offsetX: number,
    offsetY: number,
    scale: number,
    inset: number = 0,
  ): void {
    const points = this.panelPoints(rect, local, scale, inset)
    g.strokePoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true, true)
  }

  private panelPoints(
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    scale: number,
    inset: number,
  ): Array<{ x: number; y: number }> {
    const hl = (rect.halfLen - inset) * scale
    const ht = (rect.halfThick - inset) * scale
    const cut = ht * 0.34
    return [
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
  }

  /** Anchored comic compression: every layer exits around its local origin. */
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
    this.tweens.push(
      this.scene.tweens.add({
        targets: this.holder,
        alpha: 0,
        duration: 170,
        ease: 'Cubic.easeIn',
        onComplete: () => this.destroy(),
      }),
    )
    if (this.bandG) this.tweens.push(this.scene.tweens.add({ targets: this.bandG, scaleX: 0.7, scaleY: 0.82, duration: 170, ease: 'Cubic.easeIn' }))
    if (this.streakG) this.tweens.push(this.scene.tweens.add({ targets: this.streakG, alpha: 0, duration: 90 }))
    const popLayers: Phaser.GameObjects.GameObject[] = []
    for (const layer of [this.burstG, this.ballG, this.labelPlateG, this.textShadow, this.text, this.cloudG]) {
      if (layer) popLayers.push(layer)
    }
    this.tweens.push(this.scene.tweens.add({ targets: popLayers, scaleX: 0.82, scaleY: 0.82, duration: 150, ease: 'Cubic.easeIn' }))
  }

  destroy(): void {
    this.active = false
    this.dismissTimer?.remove()
    this.dismissTimer = null
    this.rgbTimer?.remove()
    this.rgbTimer = null
    for (const tween of this.tweens) tween.stop()
    this.tweens = []
    this.scene.tweens.killTweensOf(this.objs)
    for (const obj of this.objs) obj.destroy()
    this.objs = []
    this.holder = null
    this.streakG = null
    this.bandG = null
    this.flashG = null
    this.burstG = null
    this.ballG = null
    this.labelPlateG = null
    this.cloudG = null
    this.text = null
    this.textShadow = null
  }
}
