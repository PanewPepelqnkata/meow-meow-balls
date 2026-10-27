import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { spawnY } from '../config/spawn'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawCollectibleBall } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/**
 * Game-consistent doodle metal palette:
 * - Softer, warm metallic grays matching the game's doodle ink and stone palette
 * - Bold doodle ink: INK (0x1a1a1a)
 * - Cream white doodle glint: 0xffffff
 * - Soft warm chrome: 0xd2d7e1
 * - Warm shadow: 0x939ba8
 * - Dark crevice tone: 0x565c69
 * - Matte dark rubber boot: 0x222429
 * - Rubber gloss arc: 0x484c56
 */
const DOODLE_PALETTE = {
  ink: INK,
  highlight: 0xf4f6fa,
  body: 0xd2d7e1,
  shadow: 0x939ba8,
  crevice: 0x565c69,
  glint: 0xffffff,
  collarAccent: 0xe6e9f0,
  rubber: 0x222429,
  rubberSheen: 0x484c56,
}

/**
 * Helper to generate 2D polyline points for rounded rectangles with organic doodle corners.
 */
function doodleRoundedRect(x: number, y: number, w: number, h: number, r: number): Array<{ x: number; y: number }> {
  const rad = Math.min(r, w / 2, h / 2)
  const pts: Array<{ x: number; y: number }> = []
  const steps = 4 // 4 segments per corner arc is smooth and organic
  const corners = [
    { cx: x + w - rad, cy: y + rad, start: -Math.PI / 2, end: 0 },
    { cx: x + w - rad, cy: y + h - rad, start: 0, end: Math.PI / 2 },
    { cx: x + rad, cy: y + h - rad, start: Math.PI / 2, end: Math.PI },
    { cx: x + rad, cy: y + rad, start: Math.PI, end: (3 * Math.PI) / 2 },
  ]
  for (const c of corners) {
    for (let s = 0; s <= steps; s++) {
      const a = c.start + ((c.end - c.start) * s) / steps
      pts.push({ x: c.cx + Math.cos(a) * rad, y: c.cy + Math.sin(a) * rad })
    }
  }
  return pts
}

/**
 * Desktop Drop Claw: Playful hand-drawn doodle arcade claw matching the game's style.
 *
 * Refined Visual Design (Doodle Arcade Aesthetic):
 * - Soft rounded doodle corners on all plates and collars (no harsh razor-sharp edges).
 * - Organic cylindrical chrome shading with hand-drawn specular gleam streaks.
 * - Symmetrical hollow hexagonal slider bracket with rounded corner arcs, beveled facets,
 *   and clear central shaft visibility.
 * - Smooth, sweeping curved chrome tubular arms terminating in chunky rounded rubber boots
 *   with a playful doodle highlight dot.
 * - Hand-drawn ink outlines (2.5px to 3.5px line weight) matching the ball line work.
 *
 * Polished Kinematics & Animations:
 * - DROP (Fluid Mechanical Release):
 *   * Phase 1: Micro-anticipation jolt where prongs give an instant 15ms pulse
 *   * Phase 2: Smooth outward widening swing (`Cubic.easeOut` into soft settle, 200ms)
 *     expanding prongs from resting ball grip out to ~36° outward flair.
 *   * Hexagonal collar lifts smoothly up the shaft (12px, 180ms) driving the linkage.
 * - RELOAD (Cushioned Grab):
 *   * Prongs glide inward and gently clamp around the new ball with an elastic,
 *     satisfying cushioned squeeze (`Back.easeOut.config(1.2)` over 270ms).
 *   * Hexagonal collar glides back down into grip position with a soft settle.
 */
export class DropClaw {
  private readonly scene: Phaser.Scene
  private readonly g: Phaser.GameObjects.Graphics
  private holder: Phaser.GameObjects.Container | null = null

  // Central stationary shaft assembly
  private shaftG: Phaser.GameObjects.Graphics | null = null

  // Vertical sliding bracket container
  private sliderContainer: Phaser.GameObjects.Container | null = null
  private hexG: Phaser.GameObjects.Graphics | null = null

  // Left and Right articulated arms
  private armL: Phaser.GameObjects.Container | null = null
  private armR: Phaser.GameObjects.Container | null = null
  private armGL: Phaser.GameObjects.Graphics | null = null
  private armGR: Phaser.GameObjects.Graphics | null = null

  private objectsCache: Array<Phaser.GameObjects.GameObject> | null = null
  private aimX = 360
  private tier = 1
  private seed = 1
  private visible = true
  /** false during drop cooldown — ball is hidden and claw stays WIDENED open. */
  private holding = true
  /** Mobile composition: claw hardware is hidden; ball floats at drop position. */
  private mobile = false

  // Base Y position for the sliding bracket when gripping the ball
  private sliderBaseY = 0

  // Track active tweens
  private activeTweens: Phaser.Tweens.Tween[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.g = scene.add.graphics().setDepth(5)
  }

  setMobile(mobile: boolean): void {
    if (this.mobile !== mobile) {
      this.mobile = mobile
      this.redraw()
    }
  }

  info(): { tier: number; seed: number; visible: boolean } {
    return { tier: this.tier, seed: this.seed, visible: this.visible }
  }

  objects(): Array<Phaser.GameObjects.GameObject> {
    return this.objectsCache ?? [this.g]
  }

  setAim(x: number): void {
    if (x !== this.aimX) {
      this.aimX = x
      if (this.holder) this.holder.x = x
    }
  }

  setBall(tier: number, seed: number): void {
    if (tier !== this.tier || seed !== this.seed) {
      this.tier = tier
      this.seed = seed
      this.redraw()
    }
  }

  /**
   * Cooldown trigger:
   * - On drop (holding: false): Claw WIDENS OUTWARD (arms swing outward, bracket slides up).
   * - On reload (holding: true): Claw TIGHTENS INWARD (arms clamp gently around new ball).
   */
  setHolding(holding: boolean): void {
    if (this.holding !== holding) {
      this.holding = holding
      if (!holding) {
        this.redrawBallOnly()
        if (!this.mobile) this.playWidenDropAnimation()
      } else {
        this.redraw()
        if (!this.mobile) this.playTightenReloadAnimation()
      }
    }
  }

  private stopArmTweens(): void {
    for (const tw of this.activeTweens) {
      if (tw && tw.isPlaying()) tw.stop()
    }
    this.activeTweens = []
  }

  /**
   * Drop Release and Return Lifecycle:
   * 1. Release: Prongs widen smoothly (0.58 rad outward) while bracket lifts 12px (180ms).
   * 2. Return: After ball clears (~140ms hold), prongs smoothly glide back to resting position
   *    (rotation 0) and bracket glides back to sliderBaseY (over 320ms, Cubic.easeInOut).
   */
  private playWidenDropAnimation(): void {
    if (!this.sliderContainer || !this.armL || !this.armR) return
    this.stopArmTweens()

    const openAngle = 0.58 // ~33.2 deg outward release
    const liftY = this.sliderBaseY - 12

    // 1. Sliding hex bracket glides UP on release, then smoothly glides back down
    const twSlide = this.scene.tweens.add({
      targets: this.sliderContainer,
      y: liftY,
      duration: 180,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (!this.sliderContainer) return
        const twReturn = this.scene.tweens.add({
          targets: this.sliderContainer,
          y: this.sliderBaseY,
          delay: 140, // brief pause so ball clears
          duration: 320,
          ease: 'Cubic.easeInOut',
        })
        this.activeTweens.push(twReturn)
      },
    })

    // 2. Left and Right prongs widen open on release, then smoothly return to resting state
    const twArmL = this.scene.tweens.add({
      targets: this.armL,
      rotation: openAngle,
      duration: 190,
      ease: 'Back.easeOut.config(1.05)',
      onComplete: () => {
        if (!this.armL) return
        const twReturnL = this.scene.tweens.add({
          targets: this.armL,
          rotation: 0,
          delay: 140, // brief pause so ball clears
          duration: 320,
          ease: 'Cubic.easeInOut',
        })
        this.activeTweens.push(twReturnL)
      },
    })
    const twArmR = this.scene.tweens.add({
      targets: this.armR,
      rotation: -openAngle,
      duration: 190,
      ease: 'Back.easeOut.config(1.05)',
      onComplete: () => {
        if (!this.armR) return
        const twReturnR = this.scene.tweens.add({
          targets: this.armR,
          rotation: 0,
          delay: 140, // brief pause so ball clears
          duration: 320,
          ease: 'Cubic.easeInOut',
        })
        this.activeTweens.push(twReturnR)
      },
    })

    this.activeTweens.push(twSlide, twArmL, twArmR)
  }

  /**
   * Reload Clamping Animation:
   * When the new ball arrives (after the 1s cooldown), the claw gives a soft, tactile
   * cushioned squeeze around the new ball (pulse in by 0.06 rad, then settle to 0).
   */
  private playTightenReloadAnimation(): void {
    if (!this.sliderContainer || !this.armL || !this.armR) return
    this.stopArmTweens()

    // If arms already settled at 0, perform a brief cushioned embrace around the new ball
    const twArmL = this.scene.tweens.add({
      targets: this.armL,
      rotation: -0.06, // subtle inward hug
      duration: 120,
      ease: 'Quad.easeOut',
      yoyo: true,
      onYoyo: () => {
        if (this.armL) this.armL.rotation = 0
      },
    })
    const twArmR = this.scene.tweens.add({
      targets: this.armR,
      rotation: 0.06, // subtle inward hug
      duration: 120,
      ease: 'Quad.easeOut',
      yoyo: true,
      onYoyo: () => {
        if (this.armR) this.armR.rotation = 0
      },
    })

    // Micro bounce on slider bracket to give mechanical feedback
    const twSlide = this.scene.tweens.add({
      targets: this.sliderContainer,
      y: this.sliderBaseY + 2,
      duration: 110,
      ease: 'Quad.easeOut',
      yoyo: true,
    })

    this.activeTweens.push(twSlide, twArmL, twArmR)
  }

  private redrawBallOnly(): void {
    this.g.clear()
    if (!this.holding || !this.visible) return

    const tier = getTier(this.tier)
    if (!tier) return
    const r = tier.radius
    const by = spawnY(r)
    const x = 0

    const look = ballLookFor(this.tier, this.seed)
    const poly = restContour(look, r, x, by, 48)

    if (this.tier === 8) {
      const pts = poly.map((p) => ({ x: p.x, y: p.y }))
      this.g.fillStyle(cycleColor(Date.now()), 1)
      this.g.fillPoints(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      this.g.lineStyle(ballOutlineWidth(r), INK, 1)
      this.g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(this.g, look, { x, y: by }, r, 1)
    } else if (this.tier === 9 || this.tier === 10) {
      drawCollectibleBall(this.g, x, by, r, this.tier, variantIdFor(this.tier), poly, 0, undefined, this.seed)
    } else {
      this.g.fillStyle(tier.color, 1)
      this.g.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      this.g.lineStyle(ballOutlineWidth(r), INK, 1)
      this.g.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(this.g, look, { x, y: by }, r, 1)
    }
  }

  /**
   * Stationary Central Shaft Assembly:
   * Playfully rounded doodle geometry with soft chrome highlights and charming rivets.
   */
  private drawShaftAssembly(g: Phaser.GameObjects.Graphics, topBlockY: number, bottomStopY: number): void {
    g.clear()
    const cx = 0

    // Top suspension cable entering from stage top
    g.lineStyle(3.5, DOODLE_PALETTE.ink, 1)
    g.lineBetween(cx, 0, cx, topBlockY)

    // 1. TOP SQUARE MOUNTING BLOCK (rounded corners, doodle bevel)
    const blockW = 36
    const blockH = 34
    const blockX = cx - blockW / 2
    const blockCornerR = 4
    const blockPts = doodleRoundedRect(blockX, topBlockY, blockW, blockH, blockCornerR)
    const blockV2 = blockPts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // Base body fill
    g.fillStyle(DOODLE_PALETTE.body, 1)
    g.fillPoints(blockV2, true)

    // Soft left highlight facet
    const hlW = blockW * 0.44
    const hlPts = doodleRoundedRect(blockX + 2, topBlockY + 2, hlW, blockH - 4, 3)
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillPoints(hlPts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)

    // Soft right shadow facet
    const shW = 5
    const shPts = doodleRoundedRect(blockX + blockW - shW - 2, topBlockY + 2, shW, blockH - 4, 2)
    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.fillPoints(shPts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)

    // Specular doodle glint arc on top-left corner
    g.lineStyle(2, DOODLE_PALETTE.glint, 0.9)
    g.beginPath()
    g.moveTo(blockX + 3, topBlockY + blockH * 0.5)
    g.lineTo(blockX + 3, topBlockY + 4)
    g.lineTo(blockX + blockW * 0.55, topBlockY + 3)
    g.strokePath()

    // Outer doodle ink stroke
    g.lineStyle(2.8, DOODLE_PALETTE.ink, 1)
    g.strokePoints(blockV2, true, true)

    // Charming rivet dots on the right edge
    g.fillStyle(DOODLE_PALETTE.ink, 1)
    g.fillCircle(blockX + blockW - 5, topBlockY + 11, 2)
    g.fillCircle(blockX + blockW - 5, topBlockY + 23, 2)
    // Tiny highlight gleam on rivets
    g.fillStyle(DOODLE_PALETTE.glint, 0.8)
    g.fillCircle(blockX + blockW - 5.7, topBlockY + 10.3, 0.7)
    g.fillCircle(blockX + blockW - 5.7, topBlockY + 22.3, 0.7)

    // 2. CENTRAL CYLINDRICAL SHAFT (rounded capsule edges)
    const shaftW = 24
    const shaftX = cx - shaftW / 2
    const shaftTopY = topBlockY + blockH - 2
    const shaftH = bottomStopY - shaftTopY + 2
    const shaftPts = doodleRoundedRect(shaftX, shaftTopY, shaftW, shaftH, 3)
    const shaftV2 = shaftPts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // Shaft metallic fill
    g.fillStyle(DOODLE_PALETTE.body, 1)
    g.fillPoints(shaftV2, true)

    // Left highlight band
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillRect(shaftX + 2, shaftTopY + 2, shaftW * 0.42, shaftH - 4)

    // Crisp doodle glint line
    g.fillStyle(DOODLE_PALETTE.glint, 0.85)
    g.fillRect(shaftX + 4.5, shaftTopY + 3, 2.5, shaftH - 6)

    // Right core shadow band
    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.fillRect(shaftX + shaftW - 7, shaftTopY + 2, 5, shaftH - 4)

    // Shaft ink outline
    g.lineStyle(2.6, DOODLE_PALETTE.ink, 1)
    g.strokePoints(shaftV2, true, true)

    // 3. MIDDLE CYLINDRICAL COLLAR RING (rounded collar with center seam)
    const collarY = shaftTopY + 30
    const collarW = 38
    const collarH = 14
    const collarX = cx - collarW / 2
    const collarPts = doodleRoundedRect(collarX, collarY, collarW, collarH, 3)
    const collarV2 = collarPts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // Collar body
    g.fillStyle(DOODLE_PALETTE.collarAccent, 1)
    g.fillPoints(collarV2, true)

    // Left highlight
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillRect(collarX + 2, collarY + 2, collarW * 0.44, collarH - 4)

    // Right shadow
    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.fillRect(collarX + collarW - 7, collarY + 2, 5, collarH - 4)

    // Collar ink outline
    g.lineStyle(2.6, DOODLE_PALETTE.ink, 1)
    g.strokePoints(collarV2, true, true)

    // Horizontal center seam line
    g.lineStyle(1.6, DOODLE_PALETTE.ink, 0.7)
    g.lineBetween(collarX + 2, collarY + collarH * 0.5, collarX + collarW - 2, collarY + collarH * 0.5)

    // 4. BOTTOM STOPPER BLOCK (rounded stopper)
    const stopW = 34
    const stopH = 16
    const stopX = cx - stopW / 2
    const stopY = bottomStopY - stopH
    const stopPts = doodleRoundedRect(stopX, stopY, stopW, stopH, 4)
    const stopV2 = stopPts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    g.fillStyle(DOODLE_PALETTE.body, 1)
    g.fillPoints(stopV2, true)

    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillRect(stopX + 2, stopY + 2, stopW * 0.44, stopH - 4)

    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.fillRect(stopX + stopW - 7, stopY + 2, 5, stopH - 4)

    g.lineStyle(2.6, DOODLE_PALETTE.ink, 1)
    g.strokePoints(stopV2, true, true)
  }

  /**
   * Symmetrical Hollow Hexagonal Slider Bracket:
   * Smooth rounded corners, beveled facets, and hollow cutout revealing shaft.
   */
  private drawHexBracket(g: Phaser.GameObjects.Graphics): void {
    g.clear()

    // Outer hexagon dimensions: width 70px, height 52px
    const halfW = 35
    const halfH = 26
    const chamferX = 14
    const chamferY = 13

    const outerPts: Array<{ x: number; y: number }> = [
      { x: -chamferX, y: -halfH },
      { x: chamferX, y: -halfH },
      { x: halfW, y: -halfH + chamferY },
      { x: halfW, y: halfH - chamferY },
      { x: chamferX, y: halfH },
      { x: -chamferX, y: halfH },
      { x: -halfW, y: halfH - chamferY },
      { x: -halfW, y: -halfH + chamferY },
    ]

    // Inner hollow cut-out (rounded proportions)
    const inHalfW = 25
    const inHalfH = 17
    const inChamferX = 10
    const inChamferY = 8.5

    const innerPts: Array<{ x: number; y: number }> = [
      { x: -inChamferX, y: -inHalfH },
      { x: inChamferX, y: -inHalfH },
      { x: inHalfW, y: -inHalfH + inChamferY },
      { x: inHalfW, y: inHalfH - inChamferY },
      { x: inChamferX, y: inHalfH },
      { x: -inChamferX, y: inHalfH },
      { x: -inHalfW, y: inHalfH - inChamferY },
      { x: -inHalfW, y: -inHalfH + inChamferY },
    ]

    // 1. Solid outer hexagon fill
    g.fillStyle(DOODLE_PALETTE.body, 1)
    g.beginPath()
    g.moveTo(outerPts[0]!.x, outerPts[0]!.y)
    for (let i = 1; i < outerPts.length; i++) {
      g.lineTo(outerPts[i]!.x, outerPts[i]!.y)
    }
    g.closePath()
    g.fillPath()

    // 2. Beveled highlight facet (top-left chamfer)
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.beginPath()
    g.moveTo(outerPts[7]!.x, outerPts[7]!.y)
    g.lineTo(outerPts[0]!.x, outerPts[0]!.y)
    g.lineTo(outerPts[1]!.x, outerPts[1]!.y)
    g.lineTo(innerPts[1]!.x, innerPts[1]!.y)
    g.lineTo(innerPts[0]!.x, innerPts[0]!.y)
    g.lineTo(innerPts[7]!.x, innerPts[7]!.y)
    g.closePath()
    g.fillPath()

    // 3. Beveled shadow facet (bottom-right chamfer)
    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.beginPath()
    g.moveTo(outerPts[2]!.x, outerPts[2]!.y)
    g.lineTo(outerPts[3]!.x, outerPts[3]!.y)
    g.lineTo(outerPts[4]!.x, outerPts[4]!.y)
    g.lineTo(innerPts[4]!.x, innerPts[4]!.y)
    g.lineTo(innerPts[3]!.x, innerPts[3]!.y)
    g.lineTo(innerPts[2]!.x, innerPts[2]!.y)
    g.closePath()
    g.fillPath()

    // 4. Center cutout revealing shaft slice behind it
    const shaftW = 24
    const shaftX = -shaftW / 2
    g.fillStyle(DOODLE_PALETTE.body, 1)
    g.fillRect(shaftX, -inHalfH, shaftW, inHalfH * 2)
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillRect(shaftX + 2, -inHalfH, shaftW * 0.42, inHalfH * 2)
    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.fillRect(shaftX + shaftW - 7, -inHalfH, 5, inHalfH * 2)
    g.lineStyle(2, DOODLE_PALETTE.ink, 1)
    g.lineBetween(shaftX, -inHalfH, shaftX, inHalfH)
    g.lineBetween(shaftX + shaftW, -inHalfH, shaftX + shaftW, inHalfH)

    // Outer Hexagon Ink Outline (chunky, soft doodle ink)
    g.lineStyle(2.8, DOODLE_PALETTE.ink, 1)
    g.beginPath()
    g.moveTo(outerPts[0]!.x, outerPts[0]!.y)
    for (let i = 1; i < outerPts.length; i++) {
      g.lineTo(outerPts[i]!.x, outerPts[i]!.y)
    }
    g.closePath()
    g.strokePath()

    // Inner Hexagon Ink Outline
    g.lineStyle(2.4, DOODLE_PALETTE.ink, 1)
    g.beginPath()
    g.moveTo(innerPts[0]!.x, innerPts[0]!.y)
    for (let i = 1; i < innerPts.length; i++) {
      g.lineTo(innerPts[i]!.x, innerPts[i]!.y)
    }
    g.closePath()
    g.strokePath()

    // Diagonal chamfer lines connecting inner & outer corners
    for (let i = 0; i < outerPts.length; i++) {
      g.lineStyle(1.6, DOODLE_PALETTE.ink, 0.75)
      g.lineBetween(outerPts[i]!.x, outerPts[i]!.y, innerPts[i]!.x, innerPts[i]!.y)
    }

    // Specular white doodle gleams along top chamfer edge
    g.lineStyle(2.2, DOODLE_PALETTE.glint, 0.9)
    g.lineBetween(outerPts[7]!.x + 1, outerPts[7]!.y + 1, outerPts[0]!.x, outerPts[0]!.y + 1)
    g.lineBetween(outerPts[0]!.x, outerPts[0]!.y + 1, outerPts[1]!.x - 1, outerPts[1]!.y + 1)
  }

  /**
   * Refined Doodle Tubular Arm with Organic Curves & Friendly Rubber Boot:
   * Origin (0,0) is at the hinge pivot.
   * Sweeps smoothly around the ball radius, terminating in a soft, rounded black rubber boot
   * with a playful highlight dot.
   */
  private drawArmProng(g: Phaser.GameObjects.Graphics, r: number, tipX: number, tipY: number): void {
    g.clear()

    // Bezier control point for smooth, graceful outward-sweeping tubular curve
    const cpx = r * 0.96 + 18
    const cpy = tipY * 0.36

    const pts: Array<{ x: number; y: number }> = []
    const segs = 22
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const ax = 0 + (cpx - 0) * t
      const ay = 0 + (cpy - 0) * t
      const bx = cpx + (tipX - cpx) * t
      const byy = cpy + (tipY - cpy) * t
      pts.push({ x: ax + (bx - ax) * t, y: ay + (byy - ay) * t })
    }

    const v2 = pts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // 1. Chunky Doodle Ink Underlay (gives bold, clean cartoon silhouette)
    g.lineStyle(9.5, DOODLE_PALETTE.ink, 1)
    g.strokePoints(v2, false, false)

    // 2. Soft Chrome Tubular Body
    g.lineStyle(6.5, DOODLE_PALETTE.body, 1)
    g.strokePoints(v2, false, false)

    // 3. Highlight Specular Line along outer perimeter
    g.lineStyle(2.8, DOODLE_PALETTE.highlight, 1)
    g.strokePoints(v2, false, false)

    // 4. White Doodle Specular Glint along the curve's outer apex
    const apexStart = Math.floor(segs * 0.18)
    const apexEnd = Math.floor(segs * 0.65)
    const apexPts = pts.slice(apexStart, apexEnd).map((p) => new Phaser.Math.Vector2(p.x - 0.7, p.y - 0.7))
    g.lineStyle(1.8, DOODLE_PALETTE.glint, 0.9)
    g.strokePoints(apexPts, false, false)

    // 5. Shoulder Pivot Joint Disc at (0, 0)
    g.fillStyle(DOODLE_PALETTE.shadow, 1)
    g.fillCircle(0, 0, 5.5)
    g.lineStyle(2.2, DOODLE_PALETTE.ink, 1)
    g.strokeCircle(0, 0, 5.5)
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillCircle(-1.2, -1.2, 2.2)

    // 6. Charming Rounded Black Rubber Boot / Pincer Tip
    // Angles gently inward to cradle the lower curve of the ball
    const bootLen = Math.max(18, r * 0.28)
    const bootAngle = Math.PI * 0.93 // gently inward
    const bootEndX = tipX + Math.cos(bootAngle) * bootLen
    const bootEndY = tipY + Math.sin(bootAngle) * bootLen

    // Rubber boot ink underlay
    g.lineStyle(11, DOODLE_PALETTE.ink, 1)
    g.lineBetween(tipX, tipY, bootEndX, bootEndY)

    // Rubber boot deep matte fill
    g.lineStyle(8, DOODLE_PALETTE.rubber, 1)
    g.lineBetween(tipX, tipY, bootEndX, bootEndY)

    // Soft rubber specular sheen
    g.lineStyle(2.2, DOODLE_PALETTE.rubberSheen, 0.85)
    g.lineBetween(tipX - 2, tipY - 1, bootEndX + 2, bootEndY - 1)

    // Rounded rubber tip cap (smooth friendly doodle bead)
    g.fillStyle(DOODLE_PALETTE.rubber, 1)
    g.fillCircle(bootEndX, bootEndY, 4)
    g.lineStyle(2, DOODLE_PALETTE.ink, 1)
    g.strokeCircle(bootEndX, bootEndY, 4)

    // Playful doodle highlight speck on the tip
    g.fillStyle(DOODLE_PALETTE.glint, 0.9)
    g.fillCircle(bootEndX - 1, bootEndY - 1.2, 1.2)

    // Retaining collar ring connecting chrome arm to rubber boot
    g.fillStyle(DOODLE_PALETTE.highlight, 1)
    g.fillCircle(tipX, tipY, 5)
    g.lineStyle(2, DOODLE_PALETTE.ink, 1)
    g.strokeCircle(tipX, tipY, 5)
    g.fillStyle(DOODLE_PALETTE.glint, 0.8)
    g.fillCircle(tipX - 1, tipY - 1, 1.5)
  }

  private redraw(): void {
    if (!this.holder) {
      this.holder = this.scene.add.container(0, 0)
      this.holder.setDepth(this.g.depth)
      this.holder.add(this.g)

      // Stationary shaft assembly
      this.shaftG = this.scene.add.graphics()
      this.holder.add(this.shaftG)

      // Sliding hexagonal bracket container
      this.sliderContainer = this.scene.add.container(0, 0)
      this.hexG = this.scene.add.graphics()
      this.sliderContainer.add(this.hexG)

      // Left and Right arm containers (both with standard scaleX: 1)
      this.armL = this.scene.add.container(0, 0)
      this.armGL = this.scene.add.graphics()
      this.armL.add(this.armGL)

      this.armR = this.scene.add.container(0, 0)
      this.armGR = this.scene.add.graphics()
      this.armR.add(this.armGR)

      this.sliderContainer.add([this.armL, this.armR])
      this.holder.add(this.sliderContainer)

      this.objectsCache = [this.holder]
    }

    this.holder.x = this.aimX

    if (!this.visible) {
      this.g.setVisible(false)
      this.holder.setVisible(false)
      return
    }
    this.g.setVisible(true)
    this.holder.setVisible(true)

    // Draw the ball
    this.redrawBallOnly()

    // Mobile: hide claw hardware
    if (this.mobile) {
      this.shaftG?.setVisible(false)
      this.sliderContainer?.setVisible(false)
      return
    }

    this.shaftG?.setVisible(true)
    this.sliderContainer?.setVisible(true)

    const tier = getTier(this.tier)
    if (!tier) return
    const r = tier.radius
    const by = spawnY(r)

    // Symmetrical coordinates matching game proportions:
    const topBlockY = 40
    const hexCenterY = by - r - 26
    const bottomStopY = hexCenterY + 36

    // 1. Draw Stationary Shaft Assembly
    this.drawShaftAssembly(this.shaftG!, topBlockY, bottomStopY)

    // 2. Position Sliding Hexagonal Bracket
    this.sliderBaseY = hexCenterY
    this.sliderContainer!.setPosition(0, this.holding ? this.sliderBaseY : this.sliderBaseY - 12)

    // Draw Hexagon graphics inside sliding container
    this.drawHexBracket(this.hexG!)

    // 3. Mount and Draw Prongs (pivot at hexagon lower corners: ±24px, +13px)
    const mountX = 24
    const mountY = 13

    this.armL!.setPosition(-mountX, mountY)
    this.armR!.setPosition(mountX, mountY)

    // Symmetric mirrored arm containers
    this.armL!.scaleX = -1
    this.armR!.scaleX = 1

    // Tip coordinates relative to mount:
    // Grips down to the lower third of the ball
    const tipRelX = r * 0.82
    const tipRelY = (by + r * 0.55) - (hexCenterY + mountY)

    this.drawArmProng(this.armGL!, r, tipRelX, tipRelY)
    this.drawArmProng(this.armGR!, r, tipRelX, tipRelY)

    // Set initial rotations
    this.stopArmTweens()
    this.armL!.rotation = 0
    this.armR!.rotation = 0
  }
}
