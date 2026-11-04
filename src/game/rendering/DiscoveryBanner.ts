import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { ballOutlineWidth, drawBallFace, restContour, ballLookFor, drawCollectibleBall, INK } from './BallAppearance'
import { themeFor, variantIdFor } from '../state/runVariant'
import { cycleColor } from './rgbCycle'
import { FONT_FAMILY } from '../../ui/Typography'

/**
 * THE REPEAT-DISCOVERY BANNER — the small NON-BLOCKING animation for a
 * ball the player has ALREADY discovered in an earlier run (and, in the
 * ?discovery=wind QA mode, for EVERY discovery).
 *
 * Unlike the collectible-card modal, the banner never pauses the game,
 * never dims the screen and never takes input: it is a ribbon pinned to
 * the top of the screen that slides in, shows the character, and leaves.
 *
 * The character is drawn by the REAL discovery-ball pipeline
 * (restContour + drawBallFace — the same code the collectible card and
 * the overlay use), so the ball in the ribbon is the actual character:
 * same wobbled silhouette, same face, same colours.
 *
 * COMIC-BOOK STYLE (redesign):
 * - Purple halftone banner with cream comic-panel border
 * - Yellow starburst/explosion behind the character
 * - Bold yellow/orange tier label with dark outline
 * - Motion streaks and impact clouds
 * - Dynamic, energetic comic-book feel
 */

/** How long a banner stays up, ms. Short — it must not distract. */
export const BANNER_MS = 1800

/** The banner field's rich purple. */
const BANNER_PURPLE = 0x7c3aed
/** The banner's cream/off-white border. */
const BANNER_CREAM = 0xfff8e7
/** The starburst yellow. */
const STARBURST_YELLOW = 0xfbbf24
/** The starburst inner highlight. */
const STARBURST_HIGHLIGHT = 0xfde68a
/** The tier label's orange-yellow. */
const TIER_LABEL_COLOR = 0xf59e0b

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
 * In wind mode EVERY discovery — including a genuinely first-time one —
 * uses the banner, so it can be tested on a clean save without first
 * collecting the tier for real.
 */
export function bannerForcedByVariant(): boolean {
  if (typeof window === 'undefined') return false
  const p = new URLSearchParams(window.location.search).get('discovery') ?? ''
  return p === 'wind'
}

/** Deterministic per-seed RNG (mulberry32) — the same ball always
 * doodles/blows the same way. */
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
 * The banner's rect for a viewport. The band runs from the MIDDLE of the
 * top edge (off-screen corner) down-right at a slight tilt, ending near
 * the right side. Sized to fit the character + tier label.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  const isPortrait = vw < vh
  // Banner size: wider on desktop, still prominent on mobile
  const halfLen = isPortrait ? vw * 0.42 : Math.min(vw * 0.32, 420)
  const halfThick = isPortrait ? vh * 0.055 : Math.min(vh * 0.07, 56)
  // Position: top-right area, tilted slightly down toward the right
  const cx = vw * 0.62
  const cy = vh * (isPortrait ? 0.12 : 0.14)
  const angle = 0.08 // ~4.6 degrees tilt
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
 * Generate halftone dots for the banner background.
 * Returns an array of {x, y, r} in banner-local coordinates.
 */
function halftoneDots(rect: BannerRect, seed: number): { x: number; y: number; r: number }[] {
  const rng = makeRng(seed)
  const dots: { x: number; y: number; r: number }[] = []
  const spacing = rect.halfThick * 0.35
  const rows = Math.ceil((rect.halfThick * 2) / spacing)
  const cols = Math.ceil((rect.halfLen * 2) / spacing)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Offset every other row for the classic halftone pattern
      const offset = (row % 2) * spacing * 0.5
      const x = -rect.halfLen + col * spacing + offset
      const y = -rect.halfThick + row * spacing
      // Vary dot size slightly for organic feel
      const r = spacing * 0.28 * (0.7 + rng() * 0.3)
      dots.push({ x, y, r })
    }
  }
  return dots
}

/**
 * Generate starburst spike points around a center.
 * Returns points for a jagged comic explosion shape.
 */
function starburstPoints(cx: number, cy: number, innerR: number, outerR: number, spikes: number, seed: number): { x: number; y: number }[] {
  const rng = makeRng(seed)
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2
    const isOuter = i % 2 === 0
    // Vary the spike lengths for organic feel
    const r = isOuter ? outerR * (0.85 + rng() * 0.3) : innerR * (0.9 + rng() * 0.2)
    points.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    })
  }
  return points
}

/**
 * Generate motion streaks for the comic effect.
 */
function motionStreaks(rect: BannerRect, seed: number): { x1: number; y1: number; x2: number; y2: number; width: number; alpha: number }[] {
  const rng = makeRng(seed + 999)
  const streaks: { x1: number; y1: number; x2: number; y2: number; width: number; alpha: number }[] = []
  // Streaks at the left end (pointing left, toward where banner came from)
  for (let i = 0; i < 3; i++) {
    const yOff = (rng() - 0.5) * rect.halfThick * 1.5
    const len = rect.halfThick * (0.8 + rng() * 0.6)
    streaks.push({
      x1: -rect.halfLen - len,
      y1: yOff,
      x2: -rect.halfLen + rect.halfThick * 0.3,
      y2: yOff * 0.3,
      width: 2 + rng() * 2,
      alpha: 0.6 + rng() * 0.3,
    })
  }
  // Streaks at the right end
  for (let i = 0; i < 3; i++) {
    const yOff = (rng() - 0.5) * rect.halfThick * 1.5
    const len = rect.halfThick * (0.8 + rng() * 0.6)
    streaks.push({
      x1: rect.halfLen - rect.halfThick * 0.3,
      y1: yOff * 0.3,
      x2: rect.halfLen + len,
      y2: yOff,
      width: 2 + rng() * 2,
      alpha: 0.6 + rng() * 0.3,
    })
  }
  return streaks
}

/**
 * THE BANNER — one instance on the UIScene. Owns its objects, cleans up
 * after itself, and never blocks input (no interactive zones, no dim).
 */
export class DiscoveryBanner {
  private scene: Phaser.Scene
  private objs: Phaser.GameObjects.GameObject[] = []
  /** QA hook: how many objects the banner owns right now. */
  get objsCount(): number {
    return this.objs.length
  }
  private bandG: Phaser.GameObjects.Graphics | null = null
  private ballG: Phaser.GameObjects.Graphics | null = null
  private burstG: Phaser.GameObjects.Graphics | null = null
  private text: Phaser.GameObjects.Text | null = null
  private tweens: Phaser.Tweens.Tween[] = []
  private rect: BannerRect | null = null
  private tier = 1
  private seed = 0
  private theme: string | null = null
  private variant: number | null = null
  private wind = 0 // animation phase clock (0..1 loops)
  /** The character's pop-in scale (0 → 1, Back-eased on arrival). */
  private ballPop = 0
  /** The starburst's pop-in scale. */
  private burstPop = 0
  /** The label's current font size — avoids re-setting it every frame. */
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
    // HiDPI: `scale.width` is the BACKING-BUFFER size (CSS px × dpr), and
    // the UIScene camera frames the CSS-px region — the same conversion
    // DiscoveryOverlay.layout() makes. Sizing from scale.width directly
    // drew the banner at half size and half position on dpr-2 phones.
    const z = this.scene.game.scale.displayScale.x || 1
    const vw = this.scene.scale.width / z
    const vh = this.scene.scale.height / z
    this.rect = bannerRect(vw, vh)
    this.ballPop = 0
    this.burstPop = 0

    // Four layers: shadow+band, starburst, the character, the tier label.
    this.bandG = this.scene.add.graphics().setDepth(78.6)
    this.burstG = this.scene.add.graphics().setDepth(78.7)
    this.ballG = this.scene.add.graphics().setDepth(78.75)
    this.text = this.scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.max(18, Math.min(vw * 0.05, 32)))}px`,
        color: '#f59e0b',
        stroke: '#1a1a1a',
        strokeThickness: 6,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
      .setDepth(78.8)
    this.objs.push(this.bandG, this.burstG, this.ballG, this.text)

    // One container holds everything so the entrance/exit move the whole
    // ribbon as one piece.
    const holder = this.scene.add.container(0, 0).setDepth(78.6)
    holder.add([this.bandG, this.burstG, this.ballG, this.text])
    this.objs.push(holder)
    this.holder = holder

    // ---- THE ENTRANCE — comic-book impact style ----
    // 1. Quick scale-in with overshoot (comic impact)
    // 2. Starburst pops first, then the character
    // 3. Tier label fades up last
    holder.setScale(0.7)
    holder.alpha = 0
    this.tweens.push(
      this.scene.tweens.add({ targets: holder, alpha: 1, duration: 150, ease: 'Sine.easeOut' }),
      this.scene.tweens.add({
        targets: holder,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 200,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.tweens.push(
            this.scene.tweens.add({
              targets: holder,
              scaleX: 1,
              scaleY: 1,
              duration: 100,
              ease: 'Sine.easeInOut',
            }),
          )
        },
      }),
    )
    // Starburst pops first
    this.tweens.push(
      this.scene.tweens.add({ targets: this, burstPop: 1, duration: 250, delay: 100, ease: 'Back.easeOut' }),
    )
    // Character pops a beat later
    this.tweens.push(
      this.scene.tweens.add({ targets: this, ballPop: 1, duration: 300, delay: 200, ease: 'Back.easeOut' }),
    )
    // Tier label fades up last
    if (this.text) {
      this.text.alpha = 0
      this.tweens.push(this.scene.tweens.add({ targets: this.text, alpha: 1, duration: 200, delay: 350, ease: 'Sine.easeOut' }))
    }

    // The animation clock: a repeating counter redraws EVERY FRAME (onUpdate
    // fires per frame — 60fps), so the character's idle bob and subtle
    // animations are continuous, not stepped.
    this.windTween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 9000,
      repeat: -1,
      onUpdate: (tween) => {
        const v = tween.getValue()
        if (v == null) return
        this.wind = v
        this.draw()
      },
    })

    // Auto-dismiss.
    this.dismissTimer = this.scene.time.delayedCall(BANNER_MS, () => this.dismiss())
  }

  private holder: Phaser.GameObjects.Container | null = null
  private windTween: Phaser.Tweens.Tween | null = null
  private dismissTimer: Phaser.Time.TimerEvent | null = null

  /** (Re)draw the banner, starburst, and character. Runs at frame rate. */
  private draw(): void {
    const rect = this.rect
    if (!rect || !this.bandG || !this.ballG || !this.burstG) return
    const g = this.bandG
    g.clear()
    const color = getTier(this.tier)?.color ?? 0xffffff

    const cos = Math.cos(rect.angle)
    const sin = Math.sin(rect.angle)
    const local = (u: number, v: number): { x: number; y: number } => ({
      x: rect.cx + cos * u - sin * v,
      y: rect.cy + sin * u + cos * v,
    })

    // ---- DROP SHADOW ----
    const shOff = Math.max(6, rect.halfThick * 0.12)
    g.fillStyle(0x000000, 0.25)
    this.drawBannerShape(g, rect, local, shOff * 0.5, shOff)

    // ---- CREAM BORDER (outer) ----
    g.fillStyle(BANNER_CREAM, 1)
    this.drawBannerShape(g, rect, local, 0, 0)

    // ---- PURPLE FIELD (inner, inset by border) ----
    const borderWidth = Math.max(4, rect.halfThick * 0.12)
    g.fillStyle(BANNER_PURPLE, 1)
    this.drawBannerShape(g, rect, local, 0, 0, borderWidth)

    // ---- HALFTONE DOTS ----
    const dots = halftoneDots(rect, this.seed)
    g.fillStyle(0x6d28d9, 0.6) // Slightly darker purple for dots
    for (const d of dots) {
      const p = local(d.x, d.y)
      // Only draw dots inside the purple area (not on the border)
      if (Math.abs(d.y) < rect.halfThick - borderWidth - d.r) {
        g.fillCircle(p.x, p.y, d.r)
      }
    }

    // ---- INK OUTLINE ----
    g.lineStyle(4, INK, 1)
    this.strokeBannerShape(g, rect, local, 0, 0)

    // ---- MOTION STREAKS ----
    const streaks = motionStreaks(rect, this.seed)
    for (const s of streaks) {
      const a = local(s.x1, s.y1)
      const b = local(s.x2, s.y2)
      g.lineStyle(s.width, BANNER_CREAM, s.alpha * 0.8)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.strokePath()
    }

    // ---- THE STARBURST (yellow explosion behind character) ----
    this.burstG.clear()
    const ballCenter = bandPoint(rect, 0.28)
    const burstRadius = rect.halfThick * 1.1
    if (this.burstPop > 0.01) {
      const br = burstRadius * this.burstPop
      // Outer starburst (yellow)
      const spikes = starburstPoints(ballCenter.x, ballCenter.y, br * 0.5, br, 12, this.seed)
      this.burstG.fillStyle(STARBURST_YELLOW, 1)
      this.burstG.fillPoints(spikes.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      this.burstG.lineStyle(3, INK, 1)
      this.burstG.strokePoints(spikes.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      // Inner highlight
      const innerSpikes = starburstPoints(ballCenter.x, ballCenter.y, br * 0.35, br * 0.7, 8, this.seed + 1)
      this.burstG.fillStyle(STARBURST_HIGHLIGHT, 0.7)
      this.burstG.fillPoints(innerSpikes.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
    }

    // ---- THE CHARACTER — the REAL discovery-ball renderer ----
    this.ballG.clear()
    const radius = rect.halfThick * 0.65
    // Idle bob: a gentle vertical float
    const bob = Math.sin(this.wind * Math.PI * 2 * 0.45) * radius * 0.05
    const pop = this.ballPop
    if (pop > 0.01) {
      const pr = radius * pop
      const look = ballLookFor(this.tier, this.seed)
      const poly = restContour(look, pr, ballCenter.x, ballCenter.y + bob, 48)
      if (this.tier === 9 || this.tier === 10) {
        const theme = this.theme ?? themeFor(this.tier)
        const variant = this.variant ?? variantIdFor(this.tier)
        drawCollectibleBall(this.ballG, ballCenter.x, ballCenter.y + bob, pr, this.tier, variant, undefined, 0, undefined, this.seed, theme ?? undefined)
      } else {
        this.ballG.fillStyle(this.tier === 8 ? cycleColor(Date.now()) : color, 1)
        this.ballG.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
        this.ballG.lineStyle(ballOutlineWidth(pr), INK, 1)
        this.ballG.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
        drawBallFace(this.ballG, look, { x: ballCenter.x, y: ballCenter.y + bob }, pr, 1)
      }
    }

    // ---- THE TIER LABEL ----
    if (this.text) {
      const p = bandPoint(rect, 0.72)
      this.text.setText(`TIER ${this.tier}`)
      const size = Math.round(Math.max(16, Math.min(rect.halfThick * 0.55, 36)))
      if (this.labelSize !== size) {
        this.labelSize = size
        this.text.setFontSize(size)
      }
      this.text.setPosition(p.x, p.y)
      this.text.setColor(`#${TIER_LABEL_COLOR.toString(16).padStart(6, '0')}`)
    }
  }

  /** Draw the banner shape (rounded rect with slight irregularity). */
  private drawBannerShape(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    offsetX: number,
    offsetY: number,
    inset: number = 0,
  ): void {
    const hl = rect.halfLen - inset
    const ht = rect.halfThick - inset
    const r = Math.min(ht * 0.35, 20) // Corner radius
    // Slightly irregular corners for comic feel
    const irr = rect.halfThick * 0.03

    const points = [
      local(-hl + r + irr, -ht),
      local(hl - r, -ht + irr),
      local(hl, -ht + r),
      local(hl - irr, ht - r),
      local(hl - r, ht),
      local(-hl + r, ht - irr),
      local(-hl, ht - r),
      local(-hl + irr, -ht + r),
    ]
    g.fillPoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true)
  }

  /** Stroke the banner shape outline. */
  private strokeBannerShape(
    g: Phaser.GameObjects.Graphics,
    rect: BannerRect,
    local: (u: number, v: number) => { x: number; y: number },
    offsetX: number,
    offsetY: number,
  ): void {
    const hl = rect.halfLen
    const ht = rect.halfThick
    const r = Math.min(ht * 0.35, 20)
    const irr = rect.halfThick * 0.03

    const points = [
      local(-hl + r + irr, -ht),
      local(hl - r, -ht + irr),
      local(hl, -ht + r),
      local(hl - irr, ht - r),
      local(hl - r, ht),
      local(-hl + r, ht - irr),
      local(-hl, ht - r),
      local(-hl + irr, -ht + r),
    ]
    g.strokePoints(points.map((p) => new Phaser.Math.Vector2(p.x + offsetX, p.y + offsetY)), true, true)
  }

  /** Comic-style exit: quick compress and slide out. */
  dismiss(): void {
    if (!this.active) return
    const holder = this.holder
    const rect = this.rect
    if (!holder || !rect) {
      this.destroy()
      return
    }
    // Quick compress then slide out
    this.tweens.push(
      this.scene.tweens.add({
        targets: holder,
        scaleX: 1.05,
        scaleY: 0.9,
        duration: 80,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.tweens.push(
            this.scene.tweens.add({
              targets: holder,
              x: rect.halfLen * 1.5,
              alpha: 0,
              scaleX: 0.8,
              scaleY: 0.8,
              duration: 250,
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
    this.windTween?.stop()
    this.windTween = null
    this.scene.tweens.killTweensOf(this.objs)
    for (const o of this.objs) o.destroy()
    this.objs = []
    this.bandG = null
    this.burstG = null
    this.ballG = null
    this.text = null
    this.holder = null
    this.rect = null
  }
}
