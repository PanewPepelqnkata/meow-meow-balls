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
 * COMIC-BOOK STYLE (matching reference exactly):
 * - TALL substantial panel (not a thin strip)
 * - Angular comic-panel silhouette with pointed ends
 * - THICK cream/off-white outer border with dark outline
 * - Deep purple interior with subtle halftone dots
 * - LARGE ball centered in a SMALLER irregular explosion
 * - HUGE bold yellow/orange tier label
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
 * The banner's rect for a viewport. TALL and substantial like the reference.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  const isPortrait = vw < vh
  // TALL banner - much thicker than before
  const halfLen = isPortrait ? vw * 0.42 : Math.min(vw * 0.32, 420)
  const halfThick = isPortrait ? vh * 0.085 : Math.min(vh * 0.11, 85) // MUCH taller
  // Position: top area, slight tilt
  const cx = vw * 0.55
  const cy = vh * (isPortrait ? 0.14 : 0.16)
  const angle = 0.05 // ~2.9 degrees tilt
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
 * Generate irregular jagged explosion points (NOT symmetrical sun rays).
 * The explosion is SMALLER than the ball - it frames the character.
 */
function explosionPoints(
  cx: number,
  cy: number,
  ballRadius: number,
  seed: number,
): { x: number; y: number }[] {
  const rng = makeRng(seed)
  const points: { x: number; y: number }[] = []
  // Explosion is only slightly larger than the ball
  const innerR = ballRadius * 1.1
  const outerR = ballRadius * 1.5
  const spikes = 10 // Fewer, more jagged spikes

  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    const isOuter = i % 2 === 0
    // Very irregular spike lengths
    const baseR = isOuter ? outerR : innerR
    const variance = isOuter ? 0.35 : 0.2
    const r = baseR * (1 - variance + rng() * variance * 2)
    points.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    })
  }
  return points
}

/**
 * Generate small impact cloud points at banner ends.
 */
function impactCloudPoints(
  cx: number,
  cy: number,
  size: number,
  seed: number,
): { x: number; y: number; r: number }[] {
  const rng = makeRng(seed)
  const puffs: { x: number; y: number; r: number }[] = []
  const count = 4 + Math.floor(rng() * 2)
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2
    const dist = size * (0.2 + rng() * 0.5)
    puffs.push({
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist * 0.5,
      r: size * (0.2 + rng() * 0.25),
    })
  }
  return puffs
}

/**
 * Generate speed lines extending from banner ends.
 */
function speedLines(
  rect: BannerRect,
  seed: number,
): { x1: number; y1: number; x2: number; y2: number; width: number }[] {
  const rng = makeRng(seed + 777)
  const lines: { x1: number; y1: number; x2: number; y2: number; width: number }[] = []

  // Left side speed lines
  for (let i = 0; i < 3; i++) {
    const yOff = (rng() - 0.5) * rect.halfThick * 0.8
    const len = rect.halfThick * (0.6 + rng() * 0.8)
    lines.push({
      x1: -rect.halfLen - len,
      y1: yOff,
      x2: -rect.halfLen + rect.halfThick * 0.15,
      y2: yOff * 0.2,
      width: 2 + rng() * 2,
    })
  }

  // Right side speed lines
  for (let i = 0; i < 3; i++) {
    const yOff = (rng() - 0.5) * rect.halfThick * 0.8
    const len = rect.halfThick * (0.6 + rng() * 0.8)
    lines.push({
      x1: rect.halfLen - rect.halfThick * 0.15,
      y1: yOff * 0.2,
      x2: rect.halfLen + len,
      y2: yOff,
      width: 2 + rng() * 2,
    })
  }

  return lines
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

    // HUGE tier label with shadow
    const fontSize = Math.round(Math.max(32, Math.min(vw * 0.08, 56)))
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
        strokeThickness: 10,
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
    holder.setScale(0.6)
    holder.alpha = 0

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
        duration: 250,
        delay: 50,
        ease: 'Back.easeOut.config(1.5)',
      }),
    )

    // Explosion pops in
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        burstPop: 1,
        duration: 280,
        delay: 100,
        ease: 'Back.easeOut.config(1.3)',
      }),
    )

    // Ball pops into center
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        ballPop: 1,
        duration: 300,
        delay: 180,
        ease: 'Back.easeOut.config(1.2)',
      }),
    )

    // Tier label punches in
    this.tweens.push(
      this.scene.tweens.add({
        targets: this,
        labelPop: 1,
        duration: 220,
        delay: 280,
        ease: 'Back.easeOut.config(1.8)',
      }),
    )

    // Scale up holder
    this.tweens.push(
      this.scene.tweens.add({
        targets: holder,
        scaleX: 1,
        scaleY: 1,
        duration: 300,
        ease: 'Back.easeOut.config(1.1)',
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

    // ---- LAYERED SHADOW ----
    const shOff = rect.halfThick * 0.12
    g.fillStyle(0x000000, 0.35)
    this.drawPanelShape(g, rect, local, shOff * 0.6, shOff, panelScale)

    // ---- THICK CREAM OUTER BORDER ----
    g.fillStyle(BANNER_CREAM, 1)
    this.drawPanelShape(g, rect, local, 0, 0, panelScale)

    // ---- PURPLE INTERIOR ----
    const borderW = rect.halfThick * 0.18 // THICK border
    g.fillStyle(BANNER_PURPLE, 1)
    this.drawPanelShape(g, rect, local, 0, 0, panelScale, borderW)

    // ---- SUBTLE HALFTONE DOTS ----
    const dots = halftoneDots(rect, this.seed)
    g.fillStyle(0x5b21b6, 0.5) // Subtle darker purple
    for (const d of dots) {
      const p = local(d.x * panelScale, d.y * panelScale)
      if (Math.abs(d.y) < rect.halfThick - borderW - d.r * 0.5) {
        g.fillCircle(p.x, p.y, d.r * panelScale)
      }
    }

    // ---- THICK DARK OUTLINE ----
    g.lineStyle(6, INK, 1)
    this.strokePanelShape(g, rect, local, 0, 0, panelScale)

    // ---- INNER CREAM HIGHLIGHT ----
    g.lineStyle(3, BANNER_CREAM, 0.8)
    this.strokePanelShape(g, rect, local, 0, 0, panelScale, borderW * 0.4)

    // ---- SPEED LINES ----
    const lines = speedLines(rect, this.seed)
    for (const l of lines) {
      const a = local(l.x1 * panelScale, l.y1 * panelScale)
      const b = local(l.x2 * panelScale, l.y2 * panelScale)
      g.lineStyle(l.width, BANNER_CREAM, 0.85)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.strokePath()
    }

    // ---- SMALL IMPACT CLOUDS ----
    const leftCloud = impactCloudPoints(-rect.halfLen * 0.95, 0, rect.halfThick * 0.35, this.seed)
    const rightCloud = impactCloudPoints(rect.halfLen * 0.95, 0, rect.halfThick * 0.35, this.seed + 1)
    g.fillStyle(0xffffff, 0.95)
    for (const p of [...leftCloud, ...rightCloud]) {
      const pos = local(p.x * panelScale, p.y * panelScale)
      g.fillCircle(pos.x, pos.y, p.r * panelScale)
    }

    // ---- THE CHARACTER AND EXPLOSION ----
    const ballScale = this.ballPop
    const burstScale = this.burstPop
    if (ballScale > 0.01 || burstScale > 0.01) {
      const ballCenter = bandPoint(rect, 0.28)
      // BALL IS LARGE - takes up most of the explosion
      const ballRadius = rect.halfThick * 0.85 * ballScale

      // Subtle idle bob
      const bob = Math.sin(this.animPhase * Math.PI * 2 * 0.5) * ballRadius * 0.03

      // Draw explosion BEHIND the ball (smaller than ball)
      if (burstScale > 0.01) {
        const explosionPts = explosionPoints(ballCenter.x, ballCenter.y + bob, ballRadius * burstScale, this.seed)
        // Yellow center
        this.burstG.fillStyle(EXPLOSION_YELLOW, 1)
        this.burstG.fillPoints(explosionPts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
        // Thick dark outline
        this.burstG.lineStyle(5, INK, 1)
        this.burstG.strokePoints(explosionPts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      }

      // Draw the BALL (large, centered in explosion)
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

    // ---- HUGE TIER LABEL ----
    const labelScale = this.labelPop
    if (this.text && this.textShadow && labelScale > 0.01) {
      const p = bandPoint(rect, 0.72)
      this.text.setText(`TIER ${this.tier}`)
      this.textShadow.setText(`TIER ${this.tier}`)

      const size = Math.round(Math.max(28, Math.min(rect.halfThick * 0.75, 48)) * labelScale)
      if (this.labelSize !== size) {
        this.labelSize = size
        this.text.setFontSize(size)
        this.textShadow.setFontSize(size)
      }

      const bounce = Math.sin(labelScale * Math.PI) * 4
      this.text.setPosition(p.x, p.y - bounce)
      this.textShadow.setPosition(p.x + 4, p.y + 4 - bounce)
      this.text.setColor(`#${TIER_LABEL_COLOR.toString(16).padStart(6, '0')}`)
    }
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

    // Angular comic-panel shape with pointed ends
    const pointLen = ht * 0.7
    const notch = ht * 0.12

    const points = [
      // Left pointed end
      local(-hl - pointLen, 0),
      local(-hl + notch, -ht * 0.75),
      // Top edge
      local(-hl * 0.25, -ht),
      local(hl * 0.75, -ht * 0.92),
      // Right pointed end
      local(hl + pointLen, -ht * 0.15),
      local(hl + pointLen * 0.75, ht * 0.25),
      // Bottom edge
      local(hl * 0.55, ht),
      local(-hl * 0.35, ht * 0.88),
      // Back to left
      local(-hl + notch * 0.6, ht * 0.35),
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
    const pointLen = ht * 0.7
    const notch = ht * 0.12

    const points = [
      local(-hl - pointLen, 0),
      local(-hl + notch, -ht * 0.75),
      local(-hl * 0.25, -ht),
      local(hl * 0.75, -ht * 0.92),
      local(hl + pointLen, -ht * 0.15),
      local(hl + pointLen * 0.75, ht * 0.25),
      local(hl * 0.55, ht),
      local(-hl * 0.35, ht * 0.88),
      local(-hl + notch * 0.6, ht * 0.35),
    ]

    g.strokePoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true, true)
  }

  /** Comic-style exit. */
  dismiss(): void {
    if (!this.active) return
    const holder = this.holder
    if (!holder) {
      this.destroy()
      return
    }

    this.tweens.push(
      this.scene.tweens.add({
        targets: holder,
        scaleX: 1.08,
        scaleY: 0.88,
        duration: 80,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.tweens.push(
            this.scene.tweens.add({
              targets: holder,
              x: '+=180',
              alpha: 0,
              scaleX: 0.75,
              scaleY: 0.75,
              duration: 180,
              ease: 'Sine.easeIn',
              onComplete: () => this.destroy(),
            }),
          )
        },
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
