import Phaser from 'phaser'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawFantasyBall } from './BallAppearance'
import { cycleColor } from './rgbCycle'
import { variantIdFor } from '../state/runVariant'
import { getTier } from '../../config/ballTiers'
import { FONT_FAMILY } from '../../ui/Typography'
import { DISCOVERY } from '../../config/presentation'
import {
  selectedDiscoveryStyle,
  tintColor,
  type DiscoveryStyle,
} from './discoveryStyles'
import { buildBallCard } from './ballCard'

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
/** The collectible card's paper stock — a warm cream, like the disc. */
const CARD_PAPER = 0xfff3d6
/** The card's portrait-window backdrop — a soft warm sky wash. */
const CARD_SKY = 0xffeec2
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
/**
 * The narrow-viewport band is a slim stripe (the user asked for the
 * presentation to be "much thinner on phone", with the ball "basically
 * getting out of the line behind it"). This is its floor, so the ball
 * always has room to break out of the band.
 */
const BAND_MIN_H_NARROW = 96

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
  /**
   * Which presentation to use. Read once from the URL (?discovery=spot)
   * so a style can be tried on the device without a rebuild; the default
   * is the shipped 'band' presentation.
   */
  private readonly style: DiscoveryStyle = selectedDiscoveryStyle()

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
    // The BAND is thinner on a phone. The user asked for the presentation
    // to be "much thinner on phone" with the ball "basically getting out
    // of the line behind it" — the band is a stripe the ball sits in, not
    // a panel the ball sits on.
    //
    // So the band's height is a fraction of the VIEWPORT (not the slot):
    // on a phone it is a slim stripe, and on a wide screen it can be the
    // full dramatic band. The narrow-viewport band is also what lets the
    // ball sit ON the band (its centre on the band's centre line) with
    // the disc's top and bottom just kissing the band's edges.
    const narrow = vw < 560
    const style = this.style
    // Only the 'band' style HAS a band. The others (spot / stamp / reveal /
    // card) are a character and its furniture, so they get MORE room for
    // the character and a taller band-free composition.
    const bandH = style === 'band'
      ? narrow
        ? Math.max(BAND_MIN_H_NARROW, Math.min(vh * 0.15, slotH * 0.3))
        : Math.min(slotH * 0.86, Math.max(150, vh * 0.26))
      : Math.max(BAND_MIN_H_NARROW, Math.min(vh * 0.18, slotH * 0.34))
    // The character's CENTRE. For the 'band' style it sits a little ABOVE
    // the band's centre line, so the disc breaks out of the band's TOP
    // edge (the "the ball gets out of the line behind it" look). For the
    // other styles there is no band, and the title needs room ABOVE the
    // character — so the character sits lower in the slot.
    let ballY =
      style === 'band'
        ? slotMid + slotH * 0.04 - (narrow ? bandH * 0.12 : 0)
        : slotMid + slotH * 0.16
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
    // The TITLE and the TIER LABEL are placed per style. The title must
    // CLEAR the character (it used to overlap it in every non-band
    // style), and the label sits under the character.
    const bandBottom = ballY + bandH / 2
    // The character's visual extent (the disc/medallion around it).
    const artR = displayRadius * (style === 'stamp' ? 1.55 : style === 'reveal' ? 1.5 : style === 'card' ? 1.6 : discScale)
    const charTop = ballY - artR
    const charBottom = ballY + artR
    // The title's own half-height, so it can be placed to CLEAR the art.
    const titleHalf = Math.max(18, vw * 0.032 * 0.62)
    let titleY: number
    let labelY: number
    if (style === 'band') {
      // The title is high, above the band; the label is inside the band.
      titleY = slotTop + Math.max(26, slotH * 0.1)
      labelY = Math.min(bandBottom - 10, charBottom + 18)
    } else {
      // Every other style: the title sits ABOVE the art with a clear gap,
      // and the label below it.
      //
      // The title is placed by INVERTING the constraint (the title's
      // bottom edge must clear the art's top edge), and if that would
      // push the title off the top of the slot, the ART is pushed DOWN
      // instead — so the title never overlaps the character on any
      // viewport.
      const wantTitleY = charTop - titleHalf - 12
      const minTitleY = slotTop + titleHalf + 6
      if (wantTitleY >= minTitleY) {
        titleY = wantTitleY
      } else {
        // Not enough room above: move the character down to make it.
        const shift = minTitleY - wantTitleY
        ballY += shift
        titleY = minTitleY
      }
      labelY = Math.min(slotBottom - 20, ballY + artR + 26)
    }
    return { vw, vh, cx, ballY, displayRadius, bandH, titleY, labelY }
  }

  private build(): void {
    const tier = this.activeTier
    if (tier == null) return
    const { vw, vh, cx, ballY, displayRadius, bandH, titleY, labelY } = this.layout()
    const color = getTier(tier)?.color ?? 0xffffff
    const charYRel = ballY - vh / 2 // character y relative to screen center
    const style = this.style

    // 1) The dim behind the presentation.
    // The COLLECTIBLE CARD wants a DARK backdrop (the user asked for a
    // darkened background) so the cream card pops like a collectible in a
    // display case. The other styles keep the gentle dim, with the game
    // still readable behind.
    const dimAlpha = style === 'card' ? 0.74 : DIM_ALPHA
    // The dim must cover the WHOLE camera, in the camera's WORLD units —
    // the UIScene's camera is zoomed (the buffer is at dpr), so a
    // CSS-px-sized rectangle only covers a quarter of the screen.
    const cam = this.scene.cameras.main
    const camW = cam ? cam.width : vw
    const camH = cam ? cam.height : vh
    this.dimRect = this.scene.add
      .rectangle(camW / 2, camH / 2, camW, camH, 0x0a0c14, dimAlpha)
      .setDepth(DIM_DEPTH)
    this.objs.push(this.dimRect)

    // 2) The panel: the style's own furniture (band, disc, stamp, rays…)
    //    plus the character, punched in around the screen center.
    this.panel = this.scene.add.container(cx, vh / 2).setDepth(PANEL_DEPTH)
    this.objs.push(this.panel)

    if (style === 'band') {
      const bandG = this.scene.add.graphics()
      this.drawBand(bandG, vw, bandH, charYRel, color)
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
    } else if (style === 'spot') {
      // NO band — the character alone, on a soft glow disc, with a burst of
      // tapered rays behind it. The calmest option: nothing covers the
      // game behind it.
      const glowG = this.scene.add.graphics()
      glowG.fillStyle(tintColor(color, 0.55), 0.5)
      glowG.fillCircle(0, charYRel, displayRadius * 1.9)
      glowG.fillStyle(tintColor(color, 0.3), 0.45)
      glowG.fillCircle(0, charYRel, displayRadius * 2.5)
      this.panel.add(glowG)

      const raysG = this.scene.add.graphics()
      this.drawEmphasisTicks(raysG, charYRel, displayRadius)
      this.panel.add(raysG)

      const ballG = this.scene.add.graphics()
      this.drawDiscoveryBall(ballG, 0, charYRel, displayRadius, tier, this.activeSeed)
      this.panel.add(ballG)
    } else if (style === 'stamp') {
      // A round INK STAMP the character slams down onto.
      const stampG = this.scene.add.graphics()
      this.drawStamp(stampG, charYRel, displayRadius, color)
      this.panel.add(stampG)

      const ballG = this.scene.add.graphics()
      this.drawDiscoveryBall(ballG, 0, charYRel, displayRadius, tier, this.activeSeed)
      this.panel.add(ballG)
    } else if (style === 'reveal') {
      // An IRIS: a hole opens out from the centre and reveals the
      // character (the iris ring is a separate layer above it).
      const ringG = this.scene.add.graphics()
      this.drawIrisRing(ringG, charYRel, displayRadius, color)
      this.panel.add(ringG)

      const ballG = this.scene.add.graphics()
      this.drawDiscoveryBall(ballG, 0, charYRel, displayRadius, tier, this.activeSeed)
      this.panel.add(ballG)
    } else {
      // 'card' — a COLLECTIBLE CARD: a Pokédex-style entry with a name
      // plate, a sun-glow portrait window, a stat block and a flavour line.
      const cardG = this.scene.add.graphics()
      this.drawCard(cardG, charYRel, displayRadius, color)
      this.panel.add(cardG)

      const ballG = this.scene.add.graphics()
      this.drawDiscoveryBall(ballG, 0, charYRel, displayRadius, tier, this.activeSeed)
      this.panel.add(ballG)
    }

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

    if (style === 'card') {
      this.buildCardText(cx, ballY, displayRadius)
      return
    }

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
   * The STAMP furniture: a round ink medallion the character slams down
   * onto — a medal / rubber-stamp look, with a double ink ring, a scalloped
   * edge and small tick marks around the rim.
   */
  private drawStamp(
    g: Phaser.GameObjects.Graphics,
    charY: number,
    rBall: number,
    color: number,
  ): void {
    const r = rBall * 1.42
    // The scalloped edge: 24 short radial teeth around the rim.
    const teeth = 24
    g.fillStyle(color, 1)
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2
      const rr = r * 1.1
      g.fillCircle(Math.cos(a) * rr, charY + Math.sin(a) * rr, r * 0.1)
    }
    // The medallion: a lighter disc with a thick ink rim.
    g.fillStyle(tintColor(color, 0.45), 1)
    g.fillCircle(0, charY, r)
    g.lineStyle(6, COMIC_INK, 1)
    g.strokeCircle(0, charY, r)
    // A second, thinner ring inside it.
    g.lineStyle(3, COMIC_INK, 0.55)
    g.strokeCircle(0, charY, r * 0.88)
    // Four small bolts at the diagonals.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2
      g.fillStyle(COMIC_INK, 0.75)
      g.fillCircle(Math.cos(a) * r * 0.78, charY + Math.sin(a) * r * 0.78, r * 0.07)
    }
  }

  /**
   * The IRIS furniture: a thick ring the character is revealed inside. The
   * iris hole is drawn by the ANIMATION (a mask that opens out), and this
   * is the ring that stays once it has opened.
   */
  private drawIrisRing(
    g: Phaser.GameObjects.Graphics,
    charY: number,
    rBall: number,
    color: number,
  ): void {
    const r = rBall * 1.5
    g.lineStyle(7, COMIC_INK, 1)
    g.strokeCircle(0, charY, r)
    g.lineStyle(3, tintColor(color, 0.5), 0.9)
    g.strokeCircle(0, charY, r - 6)
  }

  /**
   * The collectible card's TEXT: the name plate, the stat block's labels
   * and values, and the flavour line.
   *
   * The card's geometry mirrors drawCard()'s, so the text lands exactly
   * on the bars and the plate.
   */
  private buildCardText(cx: number, ballY: number, rBall: number): void {
    const content = this.content
    if (!content) return
    const tier = this.activeTier ?? 1
    const card = buildBallCard(tier, this.activeSeed)
    const w = rBall * 4.1
    const h = rBall * 5.4
    const x = cx - w / 2
    const y = ballY - h / 2
    const plateH = rBall * 0.92
    const winTop = y + plateH + rBall * 0.24
    const winH = h * 0.42
    const winX = x + rBall * 0.24
    const winW = w - rBall * 0.48
    const statTop = winTop + winH + rBall * 0.3
    const statH = h * 0.2
    const statW = winW * 0.58
    const gap = statH / 7
    const barH = Math.max(3, rBall * 0.1)

    // The NAME plate: the species name, big, in the game's font. It is
    // drawn over the tier-coloured plate in white with an ink outline.
    const nameText = this.scene.add
      .text(cx, y + 6 + plateH * 0.42, card.name.toUpperCase(), {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.min(30, Math.max(15, w * 0.105)))}px`,
        color: '#ffffff',
        stroke: '#111111',
        strokeThickness: 6,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
      .setShadow(0, 3, '#00000055', 0, false, true)
    if (nameText.width > winW) nameText.setScale(winW / nameText.width)
    content.add(nameText)

    // The TYPE line, small, just under the name.
    const kindText = this.scene.add
      .text(cx, y + 6 + plateH * 0.84, card.kind, {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.min(18, Math.max(10, w * 0.058)))}px`,
        color: '#111111',
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0.5, 0.5)
    content.add(kindText)

    // The STAT BLOCK: the label on the bar, the value at its end.
    const stats = card.stats
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i]
      if (!s) continue
      const by = statTop + i * gap + barH * 1.2
      const label = this.scene.add
        .text(winX + 3, by, s.label, {
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(Math.min(13, Math.max(8, w * 0.042)))}px`,
          color: '#111111',
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        })
        .setOrigin(0, 0.5)
      content.add(label)
      const value = this.scene.add
        .text(winX + statW - 3, by, String(s.value), {
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(Math.min(14, Math.max(9, w * 0.046)))}px`,
          color: '#111111',
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        })
        .setOrigin(1, 0.5)
      content.add(value)
    }

    // The FLAVOUR line, under the stat block — the character's dex entry.
    const footY = statTop + statH + rBall * 0.2
    const flavour = this.scene.add
      .text(cx, footY, card.flavour, {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(Math.min(13, Math.max(8, w * 0.043)))}px`,
        color: '#3a3020',
        stroke: '#fff3d6',
        strokeThickness: 3,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        wordWrap: { width: winW, useAdvancedWrap: true },
        align: 'center',
      })
      .setOrigin(0.5, 0)
    content.add(flavour)
  }

  /**
   * THE COLLECTIBLE CARD — a Pokédex-style entry, drawn in the game's own
   * hand-drawn style.
   *
   * The layout follows the collectible-card language so it reads
   * instantly: a thick ink frame, a NAME plate across the top, a framed
   * portrait window with a SUN GLOW behind the character, a stat block
   * down the left of the lower half, and a flavour line at the bottom.
   *
   * Everything is in the game's ink + cream + tier-colour palette, with
   * the wobbled hand-drawn edges the rest of the game uses.
   */
  private drawCard(
    g: Phaser.GameObjects.Graphics,
    charY: number,
    rBall: number,
    color: number,
  ): void {
    const card = buildBallCard(this.activeTier ?? 1, this.activeSeed)
    // The card's proportions: a portrait card, a bit taller than wide.
    // It is BIG — a collectible card wants presence, and the phone has
    // the room now that the band is gone.
    const w = rBall * 4.1
    const h = rBall * 5.4
    const x = -w / 2
    const y = charY - h / 2
    const r = rBall * 0.34
    const ink = COMIC_INK

    // ---- The card body -------------------------------------------------
    // A soft drop shadow behind the card (it lifts off the dark background).
    g.fillStyle(0x000000, 0.35)
    g.fillRoundedRect(x + 5, y + 7, w, h, r)
    // The card stock: warm cream.
    g.fillStyle(CARD_PAPER, 1)
    g.fillRoundedRect(x, y, w, h, r)
    // The thick ink frame.
    g.lineStyle(7, ink, 1)
    g.strokeRoundedRect(x, y, w, h, r)

    // ---- The NAME plate (top) ------------------------------------------
    const plateH = rBall * 0.92
    g.fillStyle(color, 1)
    g.fillRoundedRect(x + 6, y + 6, w - 12, plateH, { tl: r * 0.7, tr: r * 0.7, bl: 0, br: 0 })
    g.lineStyle(4, ink, 1)
    g.strokeRoundedRect(x + 6, y + 6, w - 12, plateH, { tl: r * 0.7, tr: r * 0.7, bl: 0, br: 0 })
    // The name text lives on the plate (added by build() as a Text object).

    // ---- The portrait window (with the SUN GLOW) ------------------------
    const winTop = y + plateH + rBall * 0.24
    const winH = h * 0.42
    const winX = x + rBall * 0.24
    const winW = w - rBall * 0.48
    const winR = rBall * 0.26

    // The window's backdrop: a warm sky wash.
    g.fillStyle(CARD_SKY, 1)
    g.fillRoundedRect(winX, winTop, winW, winH, winR)

    // THE SUN GLOW — concentric warm rings behind the character, brighter
    // in the middle. This is the "it is catching the light" halo.
    const glowX = winX + winW / 2
    const glowY = winTop + winH / 2
    const sunR = Math.min(winW, winH) * 0.46
    g.fillStyle(tintColor(FLASH_YELLOW, 0.35), 0.28)
    g.fillCircle(glowX, glowY, sunR)
    g.fillStyle(tintColor(FLASH_YELLOW, 0.6), 0.34)
    g.fillCircle(glowX, glowY, sunR * 0.74)
    g.fillStyle(FLASH_YELLOW, 0.4)
    g.fillCircle(glowX, glowY, sunR * 0.48)
    // A few sun rays radiating out of the glow.
    g.lineStyle(3, tintColor(FLASH_YELLOW, 0.5), 0.5)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2
      const r0 = sunR * 0.62
      const r1 = sunR * 1.02
      g.beginPath()
      g.moveTo(glowX + Math.cos(a) * r0, glowY + Math.sin(a) * r0)
      g.lineTo(glowX + Math.cos(a) * r1, glowY + Math.sin(a) * r1)
      g.strokePath()
    }

    // The window's ink frame.
    g.lineStyle(5, ink, 1)
    g.strokeRoundedRect(winX, winTop, winW, winH, winR)

    // ---- The stat block (lower left) -----------------------------------
    // The label and the numbers are Text objects (added by build()); the
    // BARS are drawn here, behind them.
    const statTop = winTop + winH + rBall * 0.34
    const statH = h * 0.24
    const statW = winW * 0.66
    const barH = Math.max(2.5, rBall * 0.055)
    const gap = statH / 7
    for (let i = 0; i < card.stats.length; i++) {
      const s = card.stats[i]!
      const by = statTop + i * gap
      // The bar's track — a thin line UNDER the label and value, so the
      // text stays legible (the old version drew the bar over the text).
      g.fillStyle(0xd8d0bd, 1)
      g.fillRoundedRect(winX, by + barH * 3.2, statW, barH, barH / 2)
      // The bar's fill — the tier colour, so the block reads as one thing.
      g.fillStyle(color, 1)
      g.fillRoundedRect(winX, by + barH * 3.2, (statW * s.value) / 99, barH, barH / 2)
      g.lineStyle(1.5, ink, 0.7)
      g.strokeRoundedRect(winX, by + barH * 3.2, statW, barH, barH / 2)
    }

    // ---- The footer rule + the flavour line's underline ----------------
    const footY = statTop + statH + rBall * 0.16
    g.lineStyle(3, ink, 0.65)
    g.beginPath()
    g.moveTo(winX, footY)
    g.lineTo(winX + winW, footY)
    g.strokePath()

    // A small tier badge in the bottom-right corner.
    const badgeR = rBall * 0.32
    const badgeX = x + w - badgeR - rBall * 0.26
    const badgeY = y + h - badgeR - rBall * 0.3
    g.fillStyle(color, 1)
    g.fillCircle(badgeX, badgeY, badgeR)
    g.lineStyle(4, ink, 1)
    g.strokeCircle(badgeX, badgeY, badgeR)
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

  /**
   * The entrance choreography, per style.
   *
   * Every style shares the same beat structure — the dim fades in over the
   * background's theme crossfade, the panel arrives, the character pops,
   * the title lands — but the CHARACTERISATION differs:
   *
   * - band:   the band slides in from the side and the character punches
   *           up through it (the current presentation).
   * - spot:   the character simply grows into place from nothing, with a
   *           soft pulse around it. The calmest option.
   * - stamp:  the character SLAMS down from above onto its medallion, with
   *           a shockwave ring and a hard impact shake.
   * - reveal: an iris opens out from a point and reveals the character.
   * - card:   the card springs up from below with a gentle bounce.
   */
  private playEntrance(): void {
    const content = this.content
    const dim = this.dimRect
    const panel = this.panel
    const flash = this.flashG
    if (!content || !dim || !panel) return
    content.setAlpha(0)
    dim.setAlpha(0)
    panel.setAlpha(0)

    // The DIM fades in over the background's theme crossfade, so the scene
    // behind the presentation changes WITH a transition instead of
    // snapping. The theme milestone fires in the same frame as the
    // discovery (the merge that discovers the tier also advances the
    // background), and a short dim was over before the crossfade had
    // visibly started — the change read as a hard cut.
    this.scene.tweens.add({
      targets: dim,
      // The dim's target alpha is per-style: the collectible card wants a
      // DARK backdrop (the old fixed DIM_ALPHA left the game fully
      // visible behind the card).
      alpha: this.style === 'card' ? 0.74 : DIM_ALPHA,
      duration: 420,
      ease: 'Sine.easeInOut',
    })

    const style = this.style
    const ballG = panel.list[panel.list.length - 1] as Phaser.GameObjects.Graphics | undefined
    const headline = content.list[0] as Phaser.GameObjects.Text | undefined
    const label = content.list[1] as Phaser.GameObjects.Text | undefined

    if (style === 'stamp') {
      // The character SLAMS down onto its medallion.
      panel.setAlpha(1)
      if (ballG) {
        ballG.setScale(2.1)
        ballG.setAlpha(0)
        this.scene.tweens.add({
          targets: ballG,
          scale: 1,
          alpha: 1,
          duration: 200,
          delay: 120,
          ease: 'Quad.easeIn',
        })
      }
      // The medallion arrives just behind it.
      const stampG = panel.list[0] as Phaser.GameObjects.Graphics | undefined
      if (stampG) {
        stampG.setScale(1.5)
        stampG.setAlpha(0)
        this.scene.tweens.add({
          targets: stampG,
          scale: 1,
          alpha: 1,
          duration: 260,
          delay: 160,
          ease: 'Back.easeOut',
        })
      }
      // A shockwave ring expanding out of the impact.
      const wave = this.scene.add.graphics().setDepth(FLASH_DEPTH).setPosition(panel.x, panel.y)
      this.objs.push(wave)
      const L = this.layout()
      wave.lineStyle(6, COMIC_INK, 0.9)
      wave.strokeCircle(0, L.ballY - L.vh / 2, L.displayRadius)
      wave.setAlpha(0)
      this.scene.tweens.add({
        targets: wave,
        scale: 2.6,
        alpha: 0,
        duration: 420,
        delay: 300,
        ease: 'Cubic.easeOut',
      })
      this.scene.tweens.add({
        targets: content,
        alpha: 1,
        duration: 140,
        delay: 300,
        ease: 'Sine.easeIn',
      })
      if (headline) {
        const base = headline.scaleX
        headline.setScale(base * 0.6)
        this.scene.tweens.add({
          targets: headline,
          scale: base,
          duration: 220,
          delay: 300,
          ease: 'Back.easeOut',
        })
      }
      // A hard impact shake.
      if (!this.reducedMotion) {
        this.scene.tweens.add({
          targets: content,
          x: { from: -6, to: 6 },
          duration: 30,
          delay: 320,
          yoyo: true,
          repeat: 3,
          ease: 'Sine.easeInOut',
          onComplete: () => content.setX(0),
        })
      }
      return
    }

    if (style === 'reveal') {
      // An IRIS opens out from the character's centre.
      panel.setAlpha(1)
      if (ballG) {
        // The character starts tiny and grows as the iris opens.
        ballG.setScale(0.05)
        this.scene.tweens.add({
          targets: ballG,
          scale: 1,
          duration: 380,
          delay: 120,
          ease: 'Cubic.easeOut',
        })
      }
      const ringG = panel.list[0] as Phaser.GameObjects.Graphics | undefined
      if (ringG) {
        ringG.setScale(0.05)
        ringG.setAlpha(0)
        this.scene.tweens.add({
          targets: ringG,
          scale: 1,
          alpha: 1,
          duration: 380,
          delay: 120,
          ease: 'Cubic.easeOut',
        })
      }
      this.scene.tweens.add({
        targets: content,
        alpha: 1,
        duration: 200,
        delay: 260,
        ease: 'Sine.easeIn',
      })
      if (headline) {
        const base = headline.scaleX
        headline.setAlpha(0)
        this.scene.tweens.add({
          targets: headline,
          alpha: 1,
          duration: 220,
          delay: 300,
          ease: 'Sine.easeIn',
          onComplete: () => {
            this.scene.tweens.add({ targets: headline, scale: base * 1.04, duration: 120, yoyo: true, ease: 'Sine.easeOut' })
          },
        })
      }
      return
    }

    if (style === 'card') {
      // The card springs up from below.
      panel.setAlpha(1)
      panel.setScale(0.82)
      // The panel's own position, nudged down — the card springs UP from
      // below. (An absolute y would be wrong: the container lives at the
      // screen centre, not the origin.)
      const restY = panel.y
      panel.y = restY + 70
      this.scene.tweens.add({
        targets: panel,
        y: restY,
        duration: 420,
        delay: 100,
        ease: 'Back.easeOut',
      })
      this.scene.tweens.add({
        targets: panel,
        scale: 1,
        duration: 420,
        delay: 100,
        ease: 'Back.easeOut',
      })
      if (ballG) {
        ballG.setScale(0.5)
        this.scene.tweens.add({
          targets: ballG,
          scale: 1,
          duration: 300,
          delay: 220,
          ease: 'Back.easeOut',
        })
      }
      this.scene.tweens.add({
        targets: content,
        alpha: 1,
        duration: 200,
        delay: 200,
        ease: 'Sine.easeIn',
      })
      if (headline) {
        const base = headline.scaleX
        headline.setScale(base * 0.9)
        this.scene.tweens.add({
          targets: headline,
          scale: base,
          duration: 240,
          delay: 240,
          ease: 'Back.easeOut',
        })
      }
      return
    }

    if (style === 'spot') {
      // The character simply GROWS into place — nothing else moves.
      panel.setAlpha(1)
      if (ballG) {
        ballG.setScale(0.2)
        ballG.setAlpha(0)
        this.scene.tweens.add({
          targets: ballG,
          scale: 1,
          alpha: 1,
          duration: 340,
          delay: 140,
          ease: 'Back.easeOut',
        })
      }
      this.scene.tweens.add({
        targets: content,
        alpha: 1,
        duration: 220,
        delay: 200,
        ease: 'Sine.easeIn',
      })
      if (headline) {
        const base = headline.scaleX
        headline.setScale(base * 0.94)
        this.scene.tweens.add({
          targets: headline,
          scale: base,
          duration: 260,
          delay: 220,
          ease: 'Back.easeOut',
        })
      }
      if (label) {
        const base = label.scaleX
        label.setScale(base * 0.9)
        this.scene.tweens.add({
          targets: label,
          scale: base,
          duration: 260,
          delay: 280,
          ease: 'Back.easeOut',
        })
      }
      return
    }

    // 'band' — the shipped presentation: the band slides in from the side
    // and the character punches up through it.
    this.scene.tweens.add({
      targets: panel,
      alpha: 1,
      duration: 90,
      delay: 180,
      ease: 'Sine.easeIn',
    })
    panel.setScale(0.74)
    this.scene.tweens.add({
      targets: panel,
      scale: 1.05,
      duration: 240,
      delay: 180,
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
        delay: 240,
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

    this.scene.tweens.add({ targets: content, alpha: 1, duration: 180, delay: 260, ease: 'Sine.easeIn' })

    // Character pop inside the panel.
    if (ballG) {
      ballG.setScale(0.4)
      this.scene.tweens.add({
        targets: ballG,
        scale: 1.12,
        duration: 260,
        delay: 280,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({ targets: ballG, scale: 1, duration: 100, ease: 'Sine.easeOut' })
        },
      })
    }

    // Title slam.
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
