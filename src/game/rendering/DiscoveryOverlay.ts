import Phaser from 'phaser'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawFantasyBall } from './BallAppearance'
import { cycleColor } from './rgbCycle'
import { variantIdFor } from '../state/runVariant'
import { getTier } from '../../config/ballTiers'
import { FONT_FAMILY } from '../../ui/Typography'
import { DISCOVERY } from '../../config/presentation'

/**
 * Phase 2.13.4 (spec §2) — SUBTLE BUT DRAMATIC discovery presentation.
 *
 * Owned by UIScene: that camera is exactly 1:1 with the viewport (no zoom,
 * no scroll), so geometry here IS viewport geometry.
 *
 * The GAME BACKGROUND STAYS VISIBLE — only a gentle dim covers it. On top:
 *
 *   ── gentle dim (the game world still readable behind) ──
 *   ══ ONE thick filled horizontal band across the middle ══
 *      colored to match the discovered ball, ink-outlined edges,
 *      halftone print strip + comic emphasis ticks
 *        NEW BALL DISCOVERED!   (bold yellow, black outline)
 *            ◉ the character, centered ON the band, on a cream
 *              spot-disc so it pops against its own color
 *            Tier N
 *      ✦ brief yellow sparkle flashes + edge highlight blinks ✦
 *
 * - The band is FULL-WIDTH, tier-colored (single source of truth: the tier
 *   config color), with a darker lower shade and 6px ink edges — one bold
 *   comic statement, not a full-screen takeover.
 * - Brief FLASHING HIGHLIGHTS: white edge lines along the band blink twice;
 *   yellow 4-point sparkles flash at the band's upper/lower thirds.
 * - Comic-style accents: a halftone dot strip under the band's top edge and
 *   short tapered ink emphasis ticks around the character.
 * - QUICK PUNCH-IN: the panel (band + disc + character) snaps in at ~0.74
 *   scale with a Back overshoot and a short impact shake — fast and
 *   punchy, not a slow zoom. Reduced motion drops the shake only.
 * - The character is drawn through the SHARED appearance pipeline (the
 *   exact ball that was spawned).
 *
 * Entrance is fast (~300ms); the world scene gates its step while showing.
 */

const DIM_DEPTH = 80
const PANEL_DEPTH = 80.5
const FLASH_DEPTH = 81
const CONTENT_DEPTH = 82

/** Gentle dim — the game background stays clearly visible through it. */
const DIM_ALPHA = 0.42
/** Ink for band edges, ticks and halftone dots. */
const COMIC_INK = 0x101014
/** Cream spot-disc behind the character (pops against the tier band). */
const DISC_COLOR = 0xfff6e0
/** Sparkle/highlight flash color. */
const FLASH_YELLOW = 0xffeb3b

/**
 * The character's presentation size, in viewport px.
 *
 * The character is drawn on a cream spot-disc of `radius * DISC_SCALE`
 * across. These bounds keep the presentation a READABLE STATEMENT on
 * every viewport instead of a full-screen takeover:
 *
 * - MAX_DISC_WIDTH_FRACTION: the disc may not exceed this fraction of the
 *   viewport width. On a 390px phone that caps the disc at 0.34 * 390 =
 *   133px across (the old code made it 253px — 65% of the screen).
 * - DISC_BAND_FILL: the disc may not exceed this fraction of the BAND's
 *   height — the disc is a spot-disc ON the band, so it must fit inside
 *   it. The old code never checked this, and the disc spilled over the
 *   band's edges on both the phone (33px) and the desktop (54px).
 * - MIN/MAX_DISPLAY_RADIUS: the character's own radius bounds.
 */
const DISC_SCALE = 1.35
const MAX_DISC_WIDTH_FRACTION = 0.34
const DISC_BAND_FILL = 0.86
const MIN_DISPLAY_RADIUS = 34
const MAX_DISPLAY_RADIUS = 110

/** Darken a color by a factor (band's lower shade). */
function shade(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f)
  const g = Math.round(((color >> 8) & 0xff) * f)
  const b = Math.round((color & 0xff) * f)
  return (r << 16) | (g << 8) | b
}

export class DiscoveryOverlay {
  private readonly scene: Phaser.Scene
  private objs: Phaser.GameObjects.GameObject[] = []
  private dimRect: Phaser.GameObjects.Rectangle | null = null
  /** Band + disc + character + ticks — the punched-in panel. */
  private panel: Phaser.GameObjects.Container | null = null
  /** Sparkles + edge highlights — the brief flashing accents. */
  private flashG: Phaser.GameObjects.Graphics | null = null
  private content: Phaser.GameObjects.Container | null = null
  private active = false
  private activeTier: number | null = null
  private activeSeed = 0
  private reducedMotion = false
  private dismissTimer: Phaser.Time.TimerEvent | null = null
  private resizeRegistered = false

  /** Optional gameplay-slot bounds provider (portrait): returns the
   * viewport-px region between the HUD block and the control stack, where
   * the modal centers. `null` = desktop full-screen centering. */
  private slotBounds: (() => { top: number; bottom: number } | null) | null = null

  constructor(scene: Phaser.Scene, slotBounds?: () => { top: number; bottom: number } | null) {
    this.scene = scene
    this.slotBounds = slotBounds ?? null
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }
  }

  /** QA hook: is an overlay currently on screen? */
  isShowing(): boolean {
    return this.active
  }

  /** QA hook: the tier the active overlay is displaying. */
  get currentTier(): number | null {
    return this.activeTier
  }

  /** Present the modal for a first-time tier (caller owns first-time state). */
  show(tier: number, seed: number): void {
    this.destroyNow()
    this.active = true
    this.activeTier = tier
    this.activeSeed = seed

    this.build()
    this.playEntrance()

    if (!this.resizeRegistered) {
      this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
      this.resizeRegistered = true
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this)
        this.resizeRegistered = false
      })
    }

    this.dismissTimer = this.scene.time.delayedCall(DISCOVERY.showMs, () => this.hide())
  }

  /** Fade out and clean up (normal end of the presentation). */
  hide(): void {
    this.dismissTimer?.remove()
    this.dismissTimer = null
    const content = this.content
    const dim = this.dimRect
    const panel = this.panel
    const flash = this.flashG
    if (!content || !dim || !panel) {
      this.destroyNow()
      return
    }
    this.content = null
    this.dimRect = null
    this.panel = null
    this.flashG = null
    this.scene.tweens.add({
      targets: [content, dim, panel, flash].filter(Boolean),
      alpha: 0,
      duration: DISCOVERY.fadeMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        for (const o of this.objs) o.destroy()
        this.objs = []
        if (this.active) {
          this.active = false
          this.activeTier = null
        }
      },
    })
  }

  /** Instant teardown (restart / shutdown / re-show) — no fade, no stale state. */
  reset(): void {
    this.destroyNow()
  }

  // ------------------------------------------------------------------

  private destroyNow(): void {
    this.dismissTimer?.remove()
    this.dismissTimer = null
    this.scene.tweens.killTweensOf(this.objs)
    for (const o of this.objs) o.destroy()
    this.objs = []
    this.dimRect = null
    this.panel = null
    this.flashG = null
    this.content = null
    this.active = false
    this.activeTier = null
  }

  private onResize(): void {
    if (!this.active) return
    if (this.activeTier == null) return
    this.scene.tweens.killTweensOf(this.objs)
    for (const o of this.objs) o.destroy()
    this.objs = []
    this.dimRect = null
    this.panel = null
    this.flashG = null
    this.content = null
    this.build()
  }

  /**
   * Layout, in viewport pixels. The panel Graphics are drawn in coordinates
   * RELATIVE to the screen center (container at vw/2, vh/2) so the punch-in
   * scales around the middle of the composition.
   *
   * PUBLIC (read-only) so the sizing can be asserted from a browser guard:
   * the disc's size against the band's size is the invariant that was
   * broken on the phone.
   */
  layout(): {
    vw: number
    vh: number
    cx: number
    ballY: number
    displayRadius: number
    bandH: number
    titleY: number
    labelY: number
  } {
    // HiDPI: the UIScene camera frames the CSS-px region (buffer / scale) —
    // layout must match or the band lands off-center at DPR ≥ 2.
    const z = this.scene.game.scale.displayScale.x || 1
    const vw = this.scene.scale.width / z
    const vh = this.scene.scale.height / z
    // Portrait: center the presentation in the GAMEPLAY SLOT (below the
    // HUD block, above the control stack) — the permanent HUD owns the top
    // of the screen and the modal must never sit on top of it.
    const slot = this.slotBounds?.()
    const slotTop = slot?.top ?? 0
    const slotBottom = slot?.bottom ?? vh
    const cx = vw / 2
    const slotH = slotBottom - slotTop
    const slotMid = slotTop + slotH / 2
    const bandH = Math.min(slotH * 0.86, Math.max(150, vh * 0.26))
    const ballY = slotMid + slotH * 0.04
    // The character's radius is bounded by THREE things, and the smallest
    // one wins (the old code only had the first two, so the cream disc
    // spilled over the band's edges):
    //
    //   1. the width:  the disc is radius * DISC_SCALE across, and it
    //      must not eat the screen — the design calls this "one bold
    //      comic statement, not a full-screen takeover". On a 390px
    //      phone the old radius (94px) made a 253px disc = 65% of the
    //      screen width.
    //   2. the HEIGHT: the disc must FIT INSIDE the band (it is a
    //      spot-disc ON the band). The old code never checked this — on
    //      the phone the disc was 253px across in a 219px band (33px of
    //      overflow), and on desktop 297px in a 243px band (54px).
    //   3. the slot:  the character must fit the gameplay slot.
    //
    // The height bound is the one that was missing, and it is what made
    // the phone version look unported.
    const discScale = DISC_SCALE
    const maxByWidth = (vw * MAX_DISC_WIDTH_FRACTION) / (2 * discScale)
    const maxByBand = (bandH * DISC_BAND_FILL) / (2 * discScale)
    const maxBySlot = (slotH * 0.3) / discScale
    const displayRadius = Math.max(
      MIN_DISPLAY_RADIUS,
      Math.min(MAX_DISPLAY_RADIUS, maxByWidth, maxByBand, maxBySlot),
    )
    const titleY = slotTop + Math.max(26, slotH * 0.1)
    const labelY = Math.min(slotBottom - 24, ballY + displayRadius * discScale + 22)
    return { vw, vh, cx, ballY, displayRadius, bandH, titleY, labelY }
  }

  private build(): void {
    const tier = this.activeTier
    if (tier == null) return
    const { vw, vh, cx, ballY, displayRadius, bandH, titleY, labelY } = this.layout()
    const tierColor = getTier(tier)?.color ?? 0xffffff
    const charYRel = ballY - vh / 2 // character y relative to screen center

    // 1) Gentle dim — the game background stays visible.
    this.dimRect = this.scene.add
      .rectangle(cx, vh / 2, vw, vh, 0x101018, DIM_ALPHA)
      .setDepth(DIM_DEPTH)
    this.objs.push(this.dimRect)

    // 2) The panel: band + disc + character + emphasis ticks, punched in
    // around the screen center.
    this.panel = this.scene.add.container(cx, vh / 2).setDepth(PANEL_DEPTH)
    this.objs.push(this.panel)

    const bandG = this.scene.add.graphics()
    this.drawBand(bandG, vw, bandH, charYRel, tierColor)
    this.panel.add(bandG)

    const discG = this.scene.add.graphics()
    discG.fillStyle(DISC_COLOR, 1)
    discG.fillCircle(0, charYRel, displayRadius * DISC_SCALE)
    discG.lineStyle(5, INK, 1)
    discG.strokeCircle(0, charYRel, displayRadius * DISC_SCALE)
    this.panel.add(discG)

    const ballG = this.scene.add.graphics()
    this.drawDiscoveryBall(ballG, 0, charYRel, displayRadius, tier, this.activeSeed)
    this.panel.add(ballG)

    const ticksG = this.scene.add.graphics()
    this.drawEmphasisTicks(ticksG, charYRel, displayRadius)
    this.panel.add(ticksG)

    // 3) Brief flashing accents: sparkles + band edge highlight lines.
    this.flashG = this.scene.add.graphics().setDepth(FLASH_DEPTH).setPosition(cx, vh / 2)
    this.drawFlashes(this.flashG, vw, bandH, charYRel, displayRadius)
    this.flashG.setAlpha(0)
    this.objs.push(this.flashG)

    // 4) Input blocker.
    const blocker = this.scene.add
      .zone(0, 0, vw, vh)
      .setOrigin(0, 0)
      .setInteractive()
      .setDepth(DIM_DEPTH)
    blocker.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event?.stopPropagation()
    })
    this.objs.push(blocker)

    // 5) Text content (outside the panel so the punch-in does not stretch
    // it): title + tier label.
    this.content = this.scene.add.container(0, 0).setDepth(CONTENT_DEPTH)
    this.objs.push(this.content)

    const headline = this.scene.add
      .text(cx, titleY, 'NEW BALL DISCOVERED!', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.min(58, Math.max(26, vw * 0.032)))}px`,
        color: '#ffeb3b',
        stroke: '#111111',
        strokeThickness: 9,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        wordWrap: { width: Math.max(160, vw - 96), useAdvancedWrap: true },
      })
      .setOrigin(0.5, 0.5)
      .setShadow(0, 5, '#00000066', 0, false, true)
    const maxHeadlineW = Math.min(vw * 0.88, vw - 96)
    if (headline.width > maxHeadlineW) headline.setScale(maxHeadlineW / headline.width)
    this.content.add(headline)

    const tierLabel = this.scene.add
      .text(cx, labelY, `Tier ${tier}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.min(34, Math.max(20, vw * 0.02)))}px`,
        color: '#ffffff',
        stroke: '#111111',
        strokeThickness: 7,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
      .setShadow(0, 4, '#00000066', 0, false, true)
    const maxLabelW = vw * 0.6
    if (tierLabel.width > maxLabelW) tierLabel.setScale(maxLabelW / tierLabel.width)
    this.content.add(tierLabel)
  }

  /**
   * The ONE thick filled horizontal band: full-width, tier-colored, with an
   * ink-outlined top/bottom edge, a darker lower shade, and a subtle
   * halftone print strip under the top edge. Coordinates are relative to
   * the screen center; `charY` is the character's relative y (band center).
   */
  private drawBand(
    g: Phaser.GameObjects.Graphics,
    vw: number,
    bandH: number,
    charY: number,
    tierColor: number,
  ): void {
    const hw = vw / 2
    const top = charY - bandH / 2
    const bottom = charY + bandH / 2

    // Main fill.
    g.fillStyle(tierColor, 1)
    g.fillRect(-hw, top, vw, bandH)
    // Darker lower third (two-tone print shading).
    g.fillStyle(shade(tierColor, 0.78), 1)
    g.fillRect(-hw, top + bandH * 0.66, vw, bandH * 0.34)
    // Ink edges.
    g.lineStyle(6, COMIC_INK, 1)
    g.beginPath()
    g.moveTo(-hw, top)
    g.lineTo(hw, top)
    g.strokePath()
    g.beginPath()
    g.moveTo(-hw, bottom)
    g.lineTo(hw, bottom)
    g.strokePath()

    // Halftone print row well inside the top edge (comic print accent —
    // visible dot cores, clear of the ink edge and the flashing highlight).
    const spacing = Math.max(11, Math.min(16, vw * 0.011))
    const xOff = spacing / 2
    for (let x = -hw + xOff; x <= hw; x += spacing) {
      g.fillStyle(COMIC_INK, 0.5)
      g.fillCircle(x, top + 26, 2.6)
    }
  }

  /** Short tapered ink emphasis ticks around the character (not rays). */
  private drawEmphasisTicks(g: Phaser.GameObjects.Graphics, charY: number, rBall: number): void {
    const ticks = 10
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2 + 0.31
      const rIn = rBall * 1.62
      const rOut = rBall * 1.98
      const w = 4.5
      const dir = { x: Math.cos(a), y: Math.sin(a) }
      const perp = { x: -Math.sin(a), y: Math.cos(a) }
      g.fillStyle(COMIC_INK, 0.85)
      g.beginPath()
      g.moveTo(dir.x * rIn, charY + dir.y * rIn)
      g.lineTo(dir.x * rOut + perp.x * w, charY + dir.y * rOut + perp.y * w)
      g.lineTo(dir.x * rOut - perp.x * w, charY + dir.y * rOut - perp.y * w)
      g.closePath()
      g.fillPath()
    }
  }

  /**
   * The FLASH layer: white highlight lines along the band's inner edges and
   * yellow 4-point sparkles in the band's upper/lower thirds. Alpha is
   * tweened (blinked) — the geometry itself is drawn once.
   */
  private drawFlashes(
    g: Phaser.GameObjects.Graphics,
    vw: number,
    bandH: number,
    charY: number,
    rBall: number,
  ): void {
    const hw = vw / 2
    const top = charY - bandH / 2
    const bottom = charY + bandH / 2

    // White edge highlight lines (blinked) — inside the ink edges.
    g.fillStyle(0xffffff, 0.85)
    g.fillRect(-hw, top + 13, vw, 4)
    g.fillRect(-hw, bottom - 17, vw, 4)

    // Yellow 4-point sparkles at the band's thirds.
    const sparkle = (x: number, y: number, s: number) => {
      g.fillStyle(FLASH_YELLOW, 1)
      g.beginPath()
      g.moveTo(x, y - s)
      g.lineTo(x + s * 0.32, y - s * 0.32)
      g.lineTo(x + s, y)
      g.lineTo(x + s * 0.32, y + s * 0.32)
      g.lineTo(x, y + s)
      g.lineTo(x - s * 0.32, y + s * 0.32)
      g.lineTo(x - s, y)
      g.lineTo(x - s * 0.32, y - s * 0.32)
      g.closePath()
      g.fillPath()
      g.fillStyle(0xffffff, 0.9)
      g.fillCircle(x, y, s * 0.18)
    }
    sparkle(-hw + vw * 0.24, charY - bandH * 0.3, Math.max(14, rBall * 0.3))
    sparkle(hw - vw * 0.24, charY + bandH * 0.3, Math.max(14, rBall * 0.3))
    sparkle(hw - vw * 0.38, charY - bandH * 0.24, Math.max(10, rBall * 0.2))
  }

  private playEntrance(): void {
    const content = this.content
    const dim = this.dimRect
    const panel = this.panel
    const flash = this.flashG
    if (!content || !dim || !panel) return
    content.setAlpha(0)
    dim.setAlpha(0)
    panel.setAlpha(0)

    this.scene.tweens.add({ targets: dim, alpha: DIM_ALPHA, duration: 110, ease: 'Sine.easeIn' })
    this.scene.tweens.add({ targets: panel, alpha: 1, duration: 90, ease: 'Sine.easeIn' })

    // QUICK PUNCH-IN: snap up from 0.74 with a Back overshoot.
    panel.setScale(0.74)
    this.scene.tweens.add({
      targets: panel,
      scale: 1.05,
      duration: 240,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({ targets: panel, scale: 1, duration: 90, ease: 'Sine.easeOut' })
      },
    })

    // BRIEF FLASHING HIGHLIGHTS: the accent layer blinks hard, twice.
    if (flash) {
      this.scene.tweens.add({
        targets: flash,
        alpha: { from: 0, to: 1 },
        duration: 70,
        ease: 'Sine.easeOut',
        onComplete: () => {
          this.scene.tweens.add({
            targets: flash,
            alpha: 0.15,
            duration: 200,
            yoyo: true,
            repeat: 1,
            ease: 'Sine.easeInOut',
            onComplete: () => {
              this.scene.tweens.add({ targets: flash, alpha: 0.22, duration: 300, ease: 'Sine.easeOut' })
            },
          })
        },
      })
    }

    this.scene.tweens.add({ targets: content, alpha: 1, duration: 180, delay: 90, ease: 'Sine.easeIn' })

    // Character pop inside the panel.
    const ballG = panel.list[2] as Phaser.GameObjects.Graphics | undefined
    if (ballG) {
      ballG.setScale(0.4)
      this.scene.tweens.add({
        targets: ballG,
        scale: 1.12,
        duration: 260,
        delay: 110,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({ targets: ballG, scale: 1, duration: 100, ease: 'Sine.easeOut' })
        },
      })
    }

    // Title slam.
    const headline = content.list[0] as Phaser.GameObjects.Text | undefined
    if (headline) {
      const base = headline.scaleX
      headline.setScale(base * 0.5)
      this.scene.tweens.add({
        targets: headline,
        scale: base * 1.06,
        duration: 240,
        delay: 180,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({ targets: headline, scale: base, duration: 90, ease: 'Sine.easeOut' })
        },
      })
    }

    // Short impact shake on landing (content only; reduced-motion skips).
    if (!this.reducedMotion) {
      this.scene.tweens.add({
        targets: content,
        x: { from: -4, to: 4 },
        duration: 36,
        delay: 240,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
        onComplete: () => content.setX(0),
      })
    }
  }

  /** The discovered ball through the SHARED appearance pipeline. */
  private drawDiscoveryBall(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    tier: number,
    seed: number,
  ): void {
    const look = ballLookFor(tier, seed)
    const poly = restContour(look, radius, x, y, 48)

    if (tier === 9) {
      drawFantasyBall(g, x, y, radius, variantIdFor(9))
    } else {
      // Tier 8 is a plain ball whose colour cycles; the body fills the
      // CONTOUR (so it matches its ink outline) in the current cycle
      // colour, exactly like every other tier.
      g.fillStyle(tier === 8 ? cycleColor(Date.now()) : (getTier(tier)?.color ?? 0xffffff), 1)
      g.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
    }

    g.lineStyle(ballOutlineWidth(radius), INK, 1)
    g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
    drawBallFace(g, look, { x, y }, radius, 1)
  }
}
