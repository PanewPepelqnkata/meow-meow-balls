import Phaser from 'phaser'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawTier9Ball } from './BallAppearance'
import { cycleColor } from './rgbCycle'
import { variantIdFor } from '../state/runVariant'
import { getTier } from '../../config/ballTiers'
import { FONT_FAMILY } from '../../ui/Typography'

/**
 * THE REPEAT-DISCOVERY BANNER — the small NON-BLOCKING animation for a
 * ball the player has ALREADY discovered in an earlier run (and, in the
 * ?discovery=wind QA mode, for EVERY discovery).
 *
 * Unlike the collectible-card modal, the banner never pauses the game,
 * never dims the screen and never takes input: it is a ribbon pinned to
 * the top-right corner that glides in, shows the character, and glides
 * out.
 *
 * The character is drawn by the REAL discovery-ball pipeline
 * (restContour + drawBallFace — the same code the collectible card and
 * the overlay use), so the ball in the ribbon is the actual character:
 * same wobbled silhouette, same face, same colours.
 *
 * GEOMETRY: the ribbon runs from the MIDDLE of the top edge (left end,
 * HIGH) down to the right side (right end, LOWER) and off past the
 * top-right corner — a relaxed downward slope to the right.
 *
 * MOTION — everything is continuous and eased, nothing steps:
 *  - entrance: the ribbon glides in with a soft overshoot and settles;
 *    the character pops a beat later (Back ease on its own scale).
 *  - idle: the ribbon breathes (thickness ±3% on a slow sine), three
 *    silky wind ribbons drift through it (long, tapering, slow — a cool
 *    flow, not static dashes), the character bobs gently — all phase-
 *    locked to the same frame-rate clock.
 *  - exit: a fast squash (anticipation), then the glide-out — the mirror
 *    of the entrance.
 *
 * Style: (?discovery=wind) — in wind mode EVERY discovery, first-time or
 * not, uses the banner so it can be tested on a clean save.
 */

/** How long a banner stays up, ms. Short — it must not distract. */
export const BANNER_MS = 1500

/** The banner field's deep purple. */
const BANNER_PURPLE = 0x3a2160
/** The wind lines' light purple. */
const WIND_PURPLE = 0xc9a6ff

/** The banner's geometry, measured once per show. */
interface BannerRect {
  /** The band's angle (radians) — from the top-right corner toward the
   * middle of the top edge. */
  angle: number
  /** The band's centre point (anchored just off the top-right corner). */
  cx: number
  cy: number
  /** The band's half-length (along the angle) and half-thickness. */
  halfLen: number
  halfThick: number
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
 * top edge (the left, HIGH end) down toward the RIGHT side — the right
 * end sits LOWER than the left, a relaxed downward slope — and continues
 * off-screen past the top-right corner.
 */
export function bannerRect(vw: number, vh: number): BannerRect {
  // The thickness floor is the phone size; on a desktop viewport it grows
  // with the height (like the card's width cap), so the ribbon keeps its
  // presence on a big screen — its floor is ~46px on a phone and up to
  // ~76px on a 1080p+ window.
  const halfThick = Math.max(23, Math.min(vh * 0.085, 76) / 2)
  // LEFT end: starts past the middle of the top edge, LOW on screen
  // (~13% down). On a wide viewport the left end is pushed RIGHT so the
  // ribbon stays a SHORT box — on a phone it fills the half-width, on a
  // desktop it's a compact stamp near the corner, never a full-width bar.
  const leftX = Math.max(vw * 0.5, vw - vh * 0.62)
  const innerX = leftX
  const innerY = vh * 0.13
  // RIGHT end: lower than the left — it exits past the top-right corner
  // noticeably BELOW where the left end sits.
  const cornerX = vw * 1.06
  const cornerY = vh * 0.23
  const cx = (innerX + cornerX) / 2
  const cy = (innerY + cornerY) / 2
  const dx = innerX - cornerX
  const dy = innerY - cornerY
  const halfLen = Math.hypot(dx, dy) / 2 + vw * 0.02
  return { angle: Math.atan2(dy, dx), cx, cy, halfLen, halfThick }
}

/** A point along the band's centre line, t in 0..1 (0 = corner end). */
function bandPoint(rect: BannerRect, t: number): { x: number; y: number } {
  const len = rect.halfLen * 2
  return {
    x: rect.cx + Math.cos(rect.angle) * (t - 0.5) * len,
    y: rect.cy + Math.sin(rect.angle) * (t - 0.5) * len,
  }
}

/**
 * The banner's WIND — fast straight streaks that shoot through the band.
 * The lanes are spread EVENLY across the band's FULL thickness (edge to
 * edge, inset by the stroke margin), and every streak is hard-clipped to
 * the band's box: nothing ever pokes out of it. Deterministic per seed.
 */
export function bannerStreaks(rect: BannerRect, seed: number): { v: number; len: number; speed: number; phase: number; width: number; alpha: number }[] {
  const rng = makeRng(seed * 31337 + 7)
  // The stroke inset: a streak's centre never comes closer than this to
  // the box edge — enough that its own stroke width AND the ink frame
  // (±4px, overdrawn on the fill) both stay clear of it.
  const margin = 9
  // EIGHT lanes — evenly spread across the full thickness, so at any
  // moment the box is filled with lines top to bottom.
  const lanes = 8
  const out: { v: number; len: number; speed: number; phase: number; width: number; alpha: number }[] = []
  for (let i = 0; i < lanes; i++) {
    const t = i / (lanes - 1)
    const v = (t - 0.5) * 2 * (rect.halfThick - margin)
    // FAST: the streak's wrap takes ~0.7–1.1s, so the VISIBLE crossing
    // (the box's ~130px chord) flashes by in ~0.3–0.5s.
    const speed = 8 + rng() * 4
    // Long straight runs — most of the box's length, so they read as
    // lines passing, not ticks.
    const len = rect.halfLen * (0.6 + rng() * 0.45)
    const phase = rng()
    const width = 2 + rng() * 1.5
    const alpha = 0.38 + rng() * 0.3
    out.push({ v, len, speed, phase, width, alpha })
  }
  return out
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
  private text: Phaser.GameObjects.Text | null = null
  private tweens: Phaser.Tweens.Tween[] = []
  private rect: BannerRect | null = null
  private tier = 1
  private seed = 0
  private wind = 0 // wind phase clock (0..1 loops)
  /** The character's pop-in scale (0 → 1, Back-eased on arrival). */
  private ballPop = 0
  /** The label's current font size — avoids re-setting it every frame. */
  private labelSize = 0
  private active = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  isShowing(): boolean {
    return this.active
  }

  show(tier: number, seed: number): void {
    this.destroy()
    this.active = true
    this.tier = tier
    this.seed = seed
    // HiDPI: `scale.width` is the BACKING-BUFFER size (CSS px × dpr), and
    // the UIScene camera frames the CSS-px region — the same conversion
    // DiscoveryOverlay.layout() makes. Sizing from scale.width directly
    // drew the banner at half size and half position on dpr-2 phones.
    const z = this.scene.game.scale.displayScale.x || 1
    const vw = this.scene.scale.width / z
    const vh = this.scene.scale.height / z
    this.rect = bannerRect(vw, vh)
    this.ballPop = 0

    // Three layers: shadow+band, the character, the tier label.
    this.bandG = this.scene.add.graphics().setDepth(78.6)
    this.ballG = this.scene.add.graphics().setDepth(78.75)
    this.text = this.scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.max(15, Math.min(vw * 0.042, 24)))}px`,
        color: '#ffffff',
        stroke: '#1a1a1a',
        strokeThickness: 5,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
      .setDepth(78.8)
    this.objs.push(this.bandG, this.ballG, this.text)

    // One container holds everything so the entrance/exit move the whole
    // ribbon as one piece.
    const holder = this.scene.add.container(0, 0).setDepth(78.6)
    holder.add([this.bandG, this.ballG, this.text])
    this.objs.push(holder)
    this.holder = holder

    // ---- THE ENTRANCE — three quick beats, all eased, no whip-snap ----
    // 1. The ribbon GLIDES in from the corner: brisk but eased, a light
    //    fade and a barely-there scale settle (0.96 → 1).
    // 2. The character pops a beat later: a small Back ease (1.06 peak,
    //    not a cartoon bounce) on its own scale — it arrives, softly.
    // 3. The tier label fades up last.
    const angle = this.rect.angle
    const startOffset = -vw * 0.42
    holder.x = Math.cos(angle) * startOffset
    holder.y = Math.sin(angle) * startOffset
    holder.alpha = 0
    holder.setScale(0.96)
    this.tweens.push(
      this.scene.tweens.add({ targets: holder, alpha: 1, duration: 220, ease: 'Sine.easeOut' }),
      this.scene.tweens.add({ targets: holder, x: 0, y: 0, duration: 460, ease: 'Sine.easeInOut' }),
      this.scene.tweens.add({ targets: holder, scaleX: 1, scaleY: 1, duration: 400, ease: 'Sine.easeOut' }),
    )
    this.tweens.push(
      this.scene.tweens.add({ targets: this, ballPop: 1, duration: 320, delay: 180, ease: 'Back.easeOut' }),
    )
    if (this.text) {
      this.text.alpha = 0
      this.tweens.push(this.scene.tweens.add({ targets: this.text, alpha: 1, duration: 220, delay: 280, ease: 'Sine.easeOut' }))
    }

    // The wind clock: a repeating counter redraws EVERY FRAME (onUpdate
    // fires per frame — 60fps), so the drifting ribbons, the character's
    // idle bob and the ribbon's breathing are all continuous, not stepped.
    // The clock loops every 9s: the wind shift uses it modulo the band
    // length, so each ribbon glides through at its own calm pace.
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

  /** (Re)draw the band and the character. Runs at frame rate — everything
   * here is continuous: the streaming wind, the ribbon's breathing, the
   * character's idle bob and its pop-in scale. */
  private draw(): void {
    const rect = this.rect
    if (!rect || !this.bandG || !this.ballG) return
    const g = this.bandG
    g.clear()
    const color = getTier(this.tier)?.color ?? 0xffffff

    // ---- The band's purple field: a rotated rounded-rect ribbon ----
    const cos = Math.cos(rect.angle)
    const sin = Math.sin(rect.angle)
    const thick = rect.halfThick * 2
    const local = (u: number, v: number): { x: number; y: number } => ({
      x: rect.cx + cos * u - sin * v,
      y: rect.cy + sin * u + cos * v,
    })
    // BREATHING: the ribbon's thickness swells and relaxes on a slow sine
    // (±3%) — a calm held breath, not a static slab.
    const breathe = 1 + Math.sin(this.wind * Math.PI * 2 * 0.45) * 0.03
    const halfT = rect.halfThick * breathe
    const r = thick * 0.42
    // The drop shadow — a soft dark band offset down-right, so the ribbon
    // lifts off the game behind it (its offset scales with the ribbon).
    const shOff = Math.max(5, thick * 0.09)
    g.fillStyle(0x000000, 0.2)
    g.fillPoints(
      [
        local(-rect.halfLen + shOff * 0.7, -halfT + r + shOff),
        local(-rect.halfLen + r + shOff * 0.7, -halfT + shOff),
        local(rect.halfLen - r + shOff * 0.7, -halfT + shOff),
        local(rect.halfLen + shOff * 0.7, -halfT + r + shOff),
        local(rect.halfLen + shOff * 0.7, halfT - r + shOff),
        local(rect.halfLen - r + shOff * 0.7, halfT + shOff),
        local(-rect.halfLen + r + shOff * 0.7, halfT + shOff),
        local(-rect.halfLen + shOff * 0.7, halfT - r + shOff),
      ].map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
    )
    // Field: the band body from off-corner to the inner end.
    g.fillStyle(BANNER_PURPLE, 0.97)
    g.fillPoints(
      [
        local(-rect.halfLen, -halfT + r),
        local(-rect.halfLen + r, -halfT),
        local(rect.halfLen - r, -halfT),
        local(rect.halfLen, -halfT + r),
        local(rect.halfLen, halfT - r),
        local(rect.halfLen - r, halfT),
        local(-rect.halfLen + r, halfT),
        local(-rect.halfLen, halfT - r),
      ].map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
    )
    // The ink frame.
    g.lineStyle(4, INK, 1)
    g.strokePoints(
      [
        local(-rect.halfLen, -halfT + r),
        local(-rect.halfLen + r, -halfT),
        local(rect.halfLen - r, -halfT),
        local(rect.halfLen, -halfT + r),
        local(rect.halfLen, halfT - r),
        local(rect.halfLen - r, halfT),
        local(-rect.halfLen + r, halfT),
        local(-rect.halfLen, halfT - r),
      ].map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
      true,
    )

    // ---- The WIND — fast straight streaks ALIGNED WITH THE BOX TILT ----
    // The streaks run parallel to the band's own axis (the box's tilt):
    // same angle, same direction, so each line is exactly parallel to the
    // box's long edges. Each lane sits at a fixed perpendicular offset v
    // inside the box, and the streak slides along the axis (u) and is
    // hard-clipped to the box's length — one single stroke per streak, so
    // no kinks and no broken fragments. Drawn on this layer (below the
    // character), so they pass behind it.
    for (const sp of bannerStreaks(rect, this.seed)) {
      // Slide along the axis: the head's u position wraps over the box's
      // length plus the streak's own length.
      const travel = rect.halfLen * 2 + sp.len
      const headU = -rect.halfLen + ((this.wind * sp.speed + sp.phase) % 1) * travel
      // Hard clip to the box's length: the drawn part runs from
      // max(headU - len, -halfLen) to min(headU, +halfLen).
      const u0 = Math.max(headU - sp.len, -rect.halfLen)
      const u1 = Math.min(headU, rect.halfLen)
      if (u1 - u0 < 12) continue // entering/exiting sliver — skip: no broken fragments
      const a = local(u0, sp.v)
      const b = local(u1, sp.v)
      g.lineStyle(sp.width, WIND_PURPLE, sp.alpha)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.strokePath()
    }

    // ---- THE CHARACTER — the REAL discovery-ball renderer ----
    // Same contour + face pipeline as the collectible card and the
    // discovery overlay (restContour + drawBallFace), so the character in
    // the ribbon is THE character, not an approximation of it.
    this.ballG.clear()
    // The character sits between the band's left end and its middle —
    // on the HIGH half of the slope, where the label won't collide.
    const ball = bandPoint(rect, 0.72)
    const radius = rect.halfThick * 0.72
    // Idle bob: a gentle vertical float (±4% of the radius, ~4.4s period
    // — a lazy drift, not a fidget), phase-locked to the wind clock.
    const bob = Math.sin(this.wind * Math.PI * 2 * 0.45) * radius * 0.04
    // Pop: the character scales 0→1 with a Back overshoot on arrival.
    const pop = this.ballPop
    if (pop > 0.01) {
      const pr = radius * pop
      // A soft contact shadow under the character, shrinking as it pops.
      g.fillStyle(0x000000, 0.25 * pop)
      g.fillEllipse(ball.x + 2, ball.y + radius * 0.82, pr * 1.5, pr * 0.36)
      const look = ballLookFor(this.tier, this.seed)
      const poly = restContour(look, pr, ball.x, ball.y + bob, 48)
      if (this.tier === 9) {
        // The theme ball paints its own face — part of the design. The
        // run's theme roll (shark/pig) picks the renderer; the variant
        // picks the palette within the theme.
        drawTier9Ball(this.ballG, ball.x, ball.y + bob, pr, variantIdFor(9), undefined, 0, undefined, this.seed)
      } else {
        this.ballG.fillStyle(this.tier === 8 ? cycleColor(Date.now()) : color, 1)
        this.ballG.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
        this.ballG.lineStyle(ballOutlineWidth(pr), INK, 1)
        this.ballG.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
        drawBallFace(this.ballG, look, { x: ball.x, y: ball.y + bob }, pr, 1)
      }
    }

    // ---- The tier label toward the band's right end (beyond the ball) —
    // it rides the LOWER part of the slope, reading downhill. Sized from
    // the band's own thickness so it scales with the ribbon (phone and
    // desktop alike), and coloured with the character's tier colour.
    if (this.text) {
      const p = bandPoint(rect, 0.3)
      this.text.setText(`TIER ${this.tier}`)
      const size = Math.round(Math.max(13, Math.min(rect.halfThick * 0.62, 30)))
      if (this.labelSize !== size) {
        this.labelSize = size
        this.text.setFontSize(size)
      }
      // The text object's own position is in the holder's space — the
      // holder sits at (0,0), so that is the WORLD point (same space the
      // band and the ball draw in).
      this.text.setPosition(p.x, p.y)
      this.text.setColor(`#${color.toString(16).padStart(6, '0')}`)
    }
  }

  /** Glide back out toward the corner, then destroy. A brief, tiny
   * settle (anticipation) first, then the glide-out — the mirror of the
   * entrance, so the ribbon leaves the way it came. */
  dismiss(): void {
    if (!this.active) return
    const holder = this.holder
    const rect = this.rect
    if (!holder || !rect) {
      this.destroy()
      return
    }
    // Same CSS-px conversion as show(): the exit offset must match the
    // entrance's coordinate space or the banner flies the wrong distance.
    const z = this.scene.game.scale.displayScale.x || 1
    const vw = this.scene.scale.width / z
    const angle = rect.angle
    const outX = Math.cos(angle) * -vw * 0.42
    const outY = Math.sin(angle) * -vw * 0.42
    // Anticipation: a brief 100ms breath-in (slight lift) before the
    // quick glide-out.
    this.tweens.push(
      this.scene.tweens.add({
        targets: holder,
        scaleX: 0.97,
        scaleY: 1.02,
        duration: 100,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.tweens.push(
            this.scene.tweens.add({
              targets: holder,
              x: outX,
              y: outY,
              alpha: 0,
              scaleX: 0.94,
              scaleY: 0.94,
              duration: 340,
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
    this.ballG = null
    this.text = null
    this.holder = null
    this.rect = null
  }
}
