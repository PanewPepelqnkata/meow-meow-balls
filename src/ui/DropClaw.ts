import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { spawnY } from '../config/spawn'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawCollectibleBall } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/**
 * Metal shading palette directly sampled and matched to the reference arcade claw:
 * - Steel light highlight: #dcdfe3
 * - Steel mid body: #b2b7be
 * - Steel dark shadow/core: #797f88
 * - Rim/bevel light: #ffffff
 * - Black rubber tips: #151618
 * - Ink outlines: INK (0x1a1a1a)
 */
const METAL = {
  highlight: 0xdcdfe3,
  body: 0xb2b7be,
  shadow: 0x797f88,
  glint: 0xffffff,
  rubber: 0x151618,
  rubberHighlight: 0x3d4147,
  collarLight: 0xc4c9cf,
  collarDark: 0x6e737c,
}

/**
 * Desktop drop claw recreated 1:1 from the reference mechanical arcade claw illustration:
 *
 * Anatomy:
 * 1. Top square mounting block with right-side rivets and beveled highlight.
 * 2. Vertical cylindrical telescopic shaft running through the center (divided into
 *    upper segment, ring collar, middle shaft, and lower collar/stop).
 * 3. Wide hexagonal sliding loop bracket (hollow geometric hexagon that slides vertically
 *    along the shaft, driving the claw linkage).
 * 4. Two elegant curved chrome tubular arms extending outward from the sliding bracket's
 *    lower corners, sweeping gracefully down around the ball, ending with black rubber pincer tips.
 *
 * Mechanical Linkage & Animation:
 * - Drop (release):
 *   * The center hexagonal bracket slides UP along the central shaft (~10-12px)
 *   * The two curved prongs swing wide open (~38° outward) as the linkage pulls up
 *   * Snappy, tactile hydraulic release (Back.easeOut.config(1.2), 160ms)
 * - Reload (grab):
 *   * As the new ball enters, the bracket drives DOWN the shaft
 *   * The prongs clamp inward and embrace the ball with a cushioned elastic grab
 *     (Back.easeOut.config(1.3), 260ms), snugly gripping the lower curvature
 * - Aim Performance Contract:
 *   * Transforms operate purely on container positions and rotations (zero re-tessellation).
 */
export class DropClaw {
  private readonly scene: Phaser.Scene
  private readonly g: Phaser.GameObjects.Graphics
  private holder: Phaser.GameObjects.Container | null = null

  // Central stationary shaft assembly
  private shaftG: Phaser.GameObjects.Graphics | null = null

  // Vertical sliding bracket container (slides up when opening, down when closing)
  private sliderContainer: Phaser.GameObjects.Container | null = null
  private hexG: Phaser.GameObjects.Graphics | null = null

  // Left and Right articulated prongs (pivoting on sliderContainer)
  private armL: Phaser.GameObjects.Container | null = null
  private armR: Phaser.GameObjects.Container | null = null
  private armGL: Phaser.GameObjects.Graphics | null = null
  private armGR: Phaser.GameObjects.Graphics | null = null

  private objectsCache: Array<Phaser.GameObjects.GameObject> | null = null
  private aimX = 360
  private tier = 1
  private seed = 1
  private visible = true
  /** false during the drop cooldown — the claw shows no ball, arms opened. */
  private holding = true
  /** Mobile composition: the mechanical claw is hidden — the current ball simply floats. */
  private mobile = false

  // Base Y position for the sliding hexagonal bracket
  private sliderBaseY = 0

  // Track active tweens
  private activeTweens: Phaser.Tweens.Tween[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.g = scene.add.graphics().setDepth(5)
  }

  /** Composition switch (from responsive layout). */
  setMobile(mobile: boolean): void {
    if (this.mobile !== mobile) {
      this.mobile = mobile
      this.redraw()
    }
  }

  /** QA hook: current ball and claw state. */
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
   * Cooldown state: on drop (holding: false) bracket slides UP and prongs swing open.
   * On reload (holding: true) bracket drives DOWN and prongs clamp the ball.
   */
  setHolding(holding: boolean): void {
    if (this.holding !== holding) {
      this.holding = holding
      if (!holding) {
        this.redrawBallOnly()
        if (!this.mobile) this.playDropAnimation()
      } else {
        this.redraw()
        if (!this.mobile) this.playReloadAnimation()
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
   * Fluid mechanical drop animation:
   * Hexagonal bracket retracts UPWARDS along the shaft;
   * Left and right prongs swing outward with crisp mechanical snap.
   */
  private playDropAnimation(): void {
    if (!this.sliderContainer || !this.armL || !this.armR) return
    this.stopArmTweens()

    const openAngle = 0.58 // ~33 deg outward swing
    const liftY = this.sliderBaseY - 14

    // 1. Sliding hex bracket moves UP
    const twSlide = this.scene.tweens.add({
      targets: this.sliderContainer,
      y: liftY,
      duration: 170,
      ease: 'Back.easeOut.config(1.2)',
    })

    // 2. Prongs swing open smoothly
    const twArmL = this.scene.tweens.add({
      targets: this.armL,
      rotation: openAngle,
      duration: 180,
      ease: 'Back.easeOut.config(1.2)',
    })
    const twArmR = this.scene.tweens.add({
      targets: this.armR,
      rotation: -openAngle,
      duration: 180,
      ease: 'Back.easeOut.config(1.2)',
    })

    this.activeTweens.push(twSlide, twArmL, twArmR)
  }

  /**
   * Fluid mechanical reload animation:
   * Hexagonal bracket pushes DOWN into grip position;
   * Prongs swing inward and embrace the new ball with cushioned elastic grab.
   */
  private playReloadAnimation(): void {
    if (!this.sliderContainer || !this.armL || !this.armR) return
    this.stopArmTweens()

    // 1. Slider bracket descends back to closed base Y
    const twSlide = this.scene.tweens.add({
      targets: this.sliderContainer,
      y: this.sliderBaseY,
      duration: 250,
      ease: 'Back.easeOut.config(1.3)',
    })

    // 2. Prongs clamp inward to rotation 0 with cushioned squeeze
    const twArmL = this.scene.tweens.add({
      targets: this.armL,
      rotation: 0,
      duration: 260,
      ease: 'Back.easeOut.config(1.3)',
    })
    const twArmR = this.scene.tweens.add({
      targets: this.armR,
      rotation: 0,
      duration: 260,
      ease: 'Back.easeOut.config(1.3)',
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
      const pts = poly.map(p => ({ x: p.x, y: p.y }))
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
   * Draws the stationary central shaft assembly:
   * - Top square mounting block with right-side rivet dots.
   * - Vertical cylindrical chrome shaft with left highlight and right shadow.
   * - Middle cylindrical collar ring with chamfered bevels.
   * - Bottom cylindrical stopper.
   */
  private drawShaftAssembly(g: Phaser.GameObjects.Graphics, topBlockY: number, bottomStopY: number): void {
    g.clear()
    const cx = 0

    // Top cable entering from stage top
    g.lineStyle(4, INK, 1)
    g.lineBetween(cx, 0, cx, topBlockY)

    // 1. TOP SQUARE MOUNTING BLOCK (approx 36 x 34 px)
    const blockW = 36
    const blockH = 34
    const blockX = cx - blockW / 2

    // Main base fill
    g.fillStyle(METAL.body, 1)
    g.fillRect(blockX, topBlockY, blockW, blockH)

    // Left highlight facet
    g.fillStyle(METAL.highlight, 1)
    g.fillRect(blockX + 2, topBlockY + 2, blockW * 0.45, blockH - 4)

    // Specular glint line on top/left
    g.lineStyle(1.5, METAL.glint, 0.9)
    g.lineBetween(blockX + 2, topBlockY + 2, blockX + blockW - 4, topBlockY + 2)
    g.lineBetween(blockX + 2, topBlockY + 2, blockX + 2, topBlockY + blockH - 4)

    // Right shadow facet
    g.fillStyle(METAL.shadow, 1)
    g.fillRect(blockX + blockW - 6, topBlockY + 2, 4, blockH - 4)

    // Block ink outline
    g.lineStyle(2.5, INK, 1)
    g.strokeRect(blockX, topBlockY, blockW, blockH)

    // Rivet dots on the right edge (like reference image)
    g.fillStyle(INK, 1)
    g.fillCircle(blockX + blockW - 4, topBlockY + 11, 1.6)
    g.fillCircle(blockX + blockW - 4, topBlockY + 22, 1.6)

    // 2. CENTRAL CYLINDRICAL SHAFT (width ~24px)
    const shaftW = 24
    const shaftX = cx - shaftW / 2
    const shaftTopY = topBlockY + blockH
    const shaftH = bottomStopY - shaftTopY

    // Cylindrical gradient representation:
    // Base body
    g.fillStyle(METAL.body, 1)
    g.fillRect(shaftX, shaftTopY, shaftW, shaftH)

    // Left broad bright highlight strip
    g.fillStyle(METAL.highlight, 1)
    g.fillRect(shaftX + 2, shaftTopY, shaftW * 0.42, shaftH)

    // Thin white specular shine
    g.fillStyle(METAL.glint, 0.8)
    g.fillRect(shaftX + 4, shaftTopY, 2.5, shaftH)

    // Right dark core shadow strip
    g.fillStyle(METAL.shadow, 1)
    g.fillRect(shaftX + shaftW - 7, shaftTopY, 5, shaftH)

    // Shaft ink outline
    g.lineStyle(2.5, INK, 1)
    g.strokeRect(shaftX, shaftTopY, shaftW, shaftH)

    // 3. MIDDLE CYLINDRICAL COLLAR RING (positioned below top block)
    const collarY = shaftTopY + 32
    const collarW = 38
    const collarH = 14
    const collarX = cx - collarW / 2

    // Collar body
    g.fillStyle(METAL.collarLight, 1)
    g.fillRect(collarX, collarY, collarW, collarH)

    // Left highlight
    g.fillStyle(METAL.highlight, 1)
    g.fillRect(collarX + 2, collarY + 2, collarW * 0.45, collarH - 4)

    // Right shadow
    g.fillStyle(METAL.collarDark, 1)
    g.fillRect(collarX + collarW - 7, collarY + 2, 5, collarH - 4)

    // Collar ink outline
    g.lineStyle(2.5, INK, 1)
    g.strokeRect(collarX, collarY, collarW, collarH)

    // Horizontal seam line through collar center (reference detail)
    g.lineStyle(1.5, INK, 0.7)
    g.lineBetween(collarX, collarY + collarH * 0.5, collarX + collarW, collarY + collarH * 0.5)

    // 4. BOTTOM CYLINDRICAL STOPPER (width ~32px, below hexagon)
    const stopW = 34
    const stopH = 18
    const stopX = cx - stopW / 2

    g.fillStyle(METAL.body, 1)
    g.fillRect(stopX, bottomStopY - stopH, stopW, stopH)
    g.fillStyle(METAL.highlight, 1)
    g.fillRect(stopX + 2, bottomStopY - stopH + 2, stopW * 0.42, stopH - 4)
    g.fillStyle(METAL.shadow, 1)
    g.fillRect(stopX + stopW - 7, bottomStopY - stopH + 2, 5, stopH - 4)

    g.lineStyle(2.5, INK, 1)
    g.strokeRect(stopX, bottomStopY - stopH, stopW, stopH)
  }

  /**
   * Draws the sliding Hexagonal Bracket (Local Coords with (0,0) at its center).
   * Exact hollow hexagonal loop from the reference image with chamfered beveled facets.
   */
  private drawHexBracket(g: Phaser.GameObjects.Graphics): void {
    g.clear()

    // Outer hexagon dimensions: width ~68px, height ~52px
    const halfW = 34
    const halfH = 26
    const chamferX = 14
    const chamferY = 13

    // Outer polygon vertices (symmetrical horizontal hexagon)
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

    // Inner hollow cut-out dimensions (wall thickness approx 8.5px)
    const inHalfW = 25
    const inHalfH = 17.5
    const inChamferX = 10
    const inChamferY = 9

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

    // 1. Draw solid outer hexagon fill
    g.fillStyle(METAL.body, 1)
    g.beginPath()
    g.moveTo(outerPts[0]!.x, outerPts[0]!.y)
    for (let i = 1; i < outerPts.length; i++) {
      g.lineTo(outerPts[i]!.x, outerPts[i]!.y)
    }
    g.closePath()
    g.fillPath()

    // 2. Cut-out inner hexagon (draw with background/transparency)
    // In Phaser Graphics, we draw the inner facet shading and bevels:
    // Left/Top bevel highlight
    g.fillStyle(METAL.highlight, 1)
    g.beginPath()
    g.moveTo(outerPts[7]!.x, outerPts[7]!.y)
    g.lineTo(outerPts[0]!.x, outerPts[0]!.y)
    g.lineTo(outerPts[1]!.x, outerPts[1]!.y)
    g.lineTo(innerPts[1]!.x, innerPts[1]!.y)
    g.lineTo(innerPts[0]!.x, innerPts[0]!.y)
    g.lineTo(innerPts[7]!.x, innerPts[7]!.y)
    g.closePath()
    g.fillPath()

    // Right/Bottom bevel shadow
    g.fillStyle(METAL.shadow, 1)
    g.beginPath()
    g.moveTo(outerPts[2]!.x, outerPts[2]!.y)
    g.lineTo(outerPts[3]!.x, outerPts[3]!.y)
    g.lineTo(outerPts[4]!.x, outerPts[4]!.y)
    g.lineTo(innerPts[4]!.x, innerPts[4]!.y)
    g.lineTo(innerPts[3]!.x, innerPts[3]!.y)
    g.lineTo(innerPts[2]!.x, innerPts[2]!.y)
    g.closePath()
    g.fillPath()

    // Hollow clear out the center hole (so central shaft shows through)
    // We achieve the hollow frame look by drawing the inner hole with clear/shaft reveal
    // Phaser Graphics: clear inner area by stroking outer and inner paths with ink
    g.fillStyle(0x000000, 0) // transparent
    // To ensure hole reveals the shaft beneath, we redraw the visible shaft slice inside the hole:
    const shaftW = 24
    const shaftX = -shaftW / 2
    g.fillStyle(METAL.body, 1)
    g.fillRect(shaftX, -inHalfH, shaftW, inHalfH * 2)
    g.fillStyle(METAL.highlight, 1)
    g.fillRect(shaftX + 2, -inHalfH, shaftW * 0.42, inHalfH * 2)
    g.fillStyle(METAL.shadow, 1)
    g.fillRect(shaftX + shaftW - 7, -inHalfH, 5, inHalfH * 2)
    g.lineStyle(2, INK, 1)
    g.lineBetween(shaftX, -inHalfH, shaftX, inHalfH)
    g.lineBetween(shaftX + shaftW, -inHalfH, shaftX + shaftW, inHalfH)

    // Outer Hexagon Ink Outline
    g.lineStyle(2.5, INK, 1)
    g.beginPath()
    g.moveTo(outerPts[0]!.x, outerPts[0]!.y)
    for (let i = 1; i < outerPts.length; i++) {
      g.lineTo(outerPts[i]!.x, outerPts[i]!.y)
    }
    g.closePath()
    g.strokePath()

    // Inner Hexagon Ink Outline
    g.beginPath()
    g.moveTo(innerPts[0]!.x, innerPts[0]!.y)
    for (let i = 1; i < innerPts.length; i++) {
      g.lineTo(innerPts[i]!.x, innerPts[i]!.y)
    }
    g.closePath()
    g.strokePath()

    // Diagonal chamfer facet lines (corners)
    for (let i = 0; i < outerPts.length; i++) {
      g.lineStyle(1.5, INK, 0.7)
      g.lineBetween(outerPts[i]!.x, outerPts[i]!.y, innerPts[i]!.x, innerPts[i]!.y)
    }

    // Specular white gleams along top-left outer chamfer
    g.lineStyle(2, METAL.glint, 0.85)
    g.lineBetween(outerPts[7]!.x + 1, outerPts[7]!.y + 1, outerPts[0]!.x, outerPts[0]!.y + 1)
    g.lineBetween(outerPts[0]!.x, outerPts[0]!.y + 1, outerPts[1]!.x - 1, outerPts[1]!.y + 1)
  }

  /**
   * Draws one articulated tubular curved arm:
   * Origin (0,0) is at the bracket hinge mount.
   * Sweeps smoothly down and around the ball radius r, terminating in the
   * signature black rubber claw boot (angled inward).
   */
  private drawArmProng(g: Phaser.GameObjects.Graphics, r: number, tipX: number, tipY: number): void {
    g.clear()

    // Bezier control points for the smooth outward tubular curve
    const cpx = r * 0.95 + 16
    const cpy = tipY * 0.35

    const pts: Array<{ x: number; y: number }> = []
    const segs = 20
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const ax = 0 + (cpx - 0) * t
      const ay = 0 + (cpy - 0) * t
      const bx = cpx + (tipX - cpx) * t
      const byy = cpy + (tipY - cpy) * t
      pts.push({ x: ax + (bx - ax) * t, y: ay + (byy - ay) * t })
    }

    const v2 = pts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // 1. Heavy Black Ink Underlay (tubular outline)
    g.lineStyle(9, INK, 1)
    g.strokePoints(v2, false, false)

    // 2. Chrome Metallic Tubular Body
    g.lineStyle(6, METAL.body, 1)
    g.strokePoints(v2, false, false)

    // 3. Bright Specular Reflection Line along outer curve
    g.lineStyle(2.5, METAL.highlight, 1)
    g.strokePoints(v2, false, false)

    // 4. White Highlight Glint along the apex
    const apexStart = Math.floor(segs * 0.2)
    const apexEnd = Math.floor(segs * 0.65)
    const apexPts = pts.slice(apexStart, apexEnd).map((p) => new Phaser.Math.Vector2(p.x - 0.8, p.y - 0.8))
    g.lineStyle(1.5, METAL.glint, 0.9)
    g.strokePoints(apexPts, false, false)

    // 5. Shoulder Pivot Joint at (0, 0)
    g.fillStyle(METAL.shadow, 1)
    g.fillCircle(0, 0, 5)
    g.lineStyle(2, INK, 1)
    g.strokeCircle(0, 0, 5)
    g.fillStyle(METAL.highlight, 1)
    g.fillCircle(-1, -1, 2)

    // 6. Black Rubber Boot / Pincer Tip (angled inward towards the ball)
    // The boot angles horizontally inward towards -x by ~18-24px
    const bootLen = Math.max(16, r * 0.26)
    const bootAngle = Math.PI * 0.92 // nearly horizontal inward
    const bootEndX = tipX + Math.cos(bootAngle) * bootLen
    const bootEndY = tipY + Math.sin(bootAngle) * bootLen

    // Rubber boot ink underlay
    g.lineStyle(10, INK, 1)
    g.lineBetween(tipX, tipY, bootEndX, bootEndY)

    // Rubber boot dark body
    g.lineStyle(7.5, METAL.rubber, 1)
    g.lineBetween(tipX, tipY, bootEndX, bootEndY)

    // Subtle rubber sheen line
    g.lineStyle(2, METAL.rubberHighlight, 0.7)
    g.lineBetween(tipX - 2, tipY - 1, bootEndX + 2, bootEndY - 1)

    // Rounded tip cap
    g.fillStyle(METAL.rubber, 1)
    g.fillCircle(bootEndX, bootEndY, 3.5)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(bootEndX, bootEndY, 3.5)

    // Metal collar ring securing the rubber boot
    g.fillStyle(METAL.highlight, 1)
    g.fillCircle(tipX, tipY, 4.5)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(tipX, tipY, 4.5)
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

      // Articulated arms mounted onto the sliding bracket
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

    // Reference Proportions:
    // The top block sits near the ceiling; the hex bracket rests above the ball.
    const topBlockY = 40
    const hexCenterY = by - r - 26
    const bottomStopY = hexCenterY + 36

    // 1. Draw Stationary Shaft Assembly
    this.drawShaftAssembly(this.shaftG!, topBlockY, bottomStopY)

    // 2. Position Sliding Hexagonal Bracket
    this.sliderBaseY = hexCenterY
    this.sliderContainer!.setPosition(0, this.holding ? this.sliderBaseY : this.sliderBaseY - 14)

    // Draw Hexagon graphics inside sliding container
    this.drawHexBracket(this.hexG!)

    // 3. Mount and Draw Prongs (pivot at the hexagon's lower corners: ±24px, +13px)
    const mountX = 24
    const mountY = 13

    this.armL!.setPosition(-mountX, mountY)
    this.armR!.setPosition(mountX, mountY)

    // Mirror left and right arms
    this.armL!.scaleX = -1
    this.armR!.scaleX = 1

    // Tip coordinates relative to the mount:
    // Grips down to the lower third of the ball
    const tipRelX = r * 0.82
    const tipRelY = (by + r * 0.55) - (hexCenterY + mountY)

    this.drawArmProng(this.armGL!, r, tipRelX, tipRelY)
    this.drawArmProng(this.armGR!, r, tipRelX, tipRelY)

    // Set initial rotations
    this.stopArmTweens()
    if (this.holding) {
      this.armL!.rotation = 0
      this.armR!.rotation = 0
    } else {
      this.armL!.rotation = 0.58
      this.armR!.rotation = -0.58
    }
  }
}
