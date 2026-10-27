import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { spawnY } from '../config/spawn'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawCollectibleBall } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/** Palette constants: Hazardous Industrial Doodle (Hazard Yellow & Ink Chevron) */
const PALETTE = {
  hazardYellow: 0xffd028,   // High-vis vibrant doodle yellow
  hazardDark: 0x1f2229,     // Deep ink / dark chevron stripe
  steelMid: 0x4a525d,       // Structural chassis grey
  steelLight: 0x8d96a0,     // Beveled plate highlight
  boltBrass: 0xeb9c26,      // Cartoon bolt / pin gold
  boltHighlight: 0xffea78,  // Bolt specular gleam
  pistonSilver: 0xc8d0d8,   // Hydraulic rod
  warnRed: 0xee3838,        // Tiny blinking warning beacon
}

/**
 * Desktop drop claw: HAZARDOUS MECHANICAL DOODLE CLAW (2-joint).
 *
 * Visuals:
 * - Hand-drawn doodle ink outlines (matching the game's bold ink line art).
 * - Hazard chevron warning stripes (hazard yellow + ink black diagonal bands).
 * - Chunky cartoon mechanical joints: oversized shoulder hinge, exposed hydraulic
 *   piston rod, bolted elbow disc, and curved dual-prong pincer clamp pads.
 * - Center industrial chassis box with warning chevrons, mounting bolts, and red beacon light.
 *
 * Animations:
 * - Drop (release): Fluid mechanical snap open (arms whip back with smooth Quad.easeOut
 *   and gentle settle; chassis executes a damped springy recoil bob).
 * - Reload (grab): Arms swing inward and clamp the new ball with an elastic cushioned
 *   squeeze (smooth overshoot and settle, perfectly hugging the contour).
 */
export class DropClaw {
  private readonly scene: Phaser.Scene
  private readonly g: Phaser.GameObjects.Graphics
  private holder: Phaser.GameObjects.Container | null = null
  private chassisG: Phaser.GameObjects.Graphics | null = null

  // Articulated Arm Containers (Left and Right)
  // Hierarchy: holder -> armContainer (shoulder pivot) -> forearmContainer (elbow pivot)
  private armL: Phaser.GameObjects.Container | null = null
  private armR: Phaser.GameObjects.Container | null = null
  private forearmL: Phaser.GameObjects.Container | null = null
  private forearmR: Phaser.GameObjects.Container | null = null

  private upperGL: Phaser.GameObjects.Graphics | null = null
  private upperGR: Phaser.GameObjects.Graphics | null = null
  private foreGL: Phaser.GameObjects.Graphics | null = null
  private foreGR: Phaser.GameObjects.Graphics | null = null

  private objectsCache: Array<Phaser.GameObjects.GameObject> | null = null
  private aimX = 360
  private tier = 1
  private seed = 1
  private visible = true
  /** false during the drop cooldown — the claw shows no ball, arms opened. */
  private holding = true
  /** Mobile composition: the mechanical claw is hidden — the current ball simply floats. */
  private mobile = false

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
   * Cooldown state: on drop (holding: false) arms snap open with smooth recoil.
   * On reload (holding: true) arms clamp the new ball with cushioned bounce.
   */
  setHolding(holding: boolean): void {
    if (this.holding !== holding) {
      this.holding = holding
      if (!holding) {
        // Drop trigger: immediately hide ball and fire snappy open animation
        this.redrawBallOnly()
        if (!this.mobile) this.playDropAnimation()
      } else {
        // Reload trigger: new ball arrives, fire cushioned clamp animation
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
   * Smooth, punchy drop animation:
   * Upper arm swings outward smoothly while forearm curls slightly outward;
   * Chassis kicks up by 3px with a damped elastic rebound.
   */
  private playDropAnimation(): void {
    if (!this.armL || !this.armR || !this.forearmL || !this.forearmR || !this.chassisG) return
    this.stopArmTweens()

    const openAngleShoulder = 0.44 // ~25 deg
    const openAngleElbow = -0.28    // ~16 deg

    // Shoulder swing (smooth punchy release)
    const twL1 = this.scene.tweens.add({
      targets: this.armL,
      rotation: -openAngleShoulder,
      duration: 180,
      ease: 'Back.easeOut.config(1.1)',
    })
    const twR1 = this.scene.tweens.add({
      targets: this.armR,
      rotation: openAngleShoulder,
      duration: 180,
      ease: 'Back.easeOut.config(1.1)',
    })

    // Forearm secondary motion (fluid lag behind shoulder)
    const twL2 = this.scene.tweens.add({
      targets: this.forearmL,
      rotation: -openAngleElbow,
      duration: 200,
      ease: 'Quad.easeOut',
    })
    const twR2 = this.scene.tweens.add({
      targets: this.forearmR,
      rotation: openAngleElbow,
      duration: 200,
      ease: 'Quad.easeOut',
    })

    // Chassis springy recoil
    const twRecoil = this.scene.tweens.add({
      targets: [this.chassisG, this.armL, this.armR],
      y: '-=4',
      duration: 80,
      yoyo: true,
      ease: 'Quad.easeOut',
    })

    this.activeTweens.push(twL1, twR1, twL2, twR2, twRecoil)
  }

  /**
   * Fluid reload animation:
   * Arms reach inward and clamp the new ball with an elastic cushioned squeeze.
   */
  private playReloadAnimation(): void {
    if (!this.armL || !this.armR || !this.forearmL || !this.forearmR) return
    this.stopArmTweens()

    // Smooth cushioned grab: Back.easeOut creates a gentle settling squeeze
    const twL1 = this.scene.tweens.add({
      targets: this.armL,
      rotation: 0,
      duration: 260,
      ease: 'Back.easeOut.config(1.25)',
    })
    const twR1 = this.scene.tweens.add({
      targets: this.armR,
      rotation: 0,
      duration: 260,
      ease: 'Back.easeOut.config(1.25)',
    })
    const twL2 = this.scene.tweens.add({
      targets: this.forearmL,
      rotation: 0,
      duration: 280,
      ease: 'Back.easeOut.config(1.2)',
    })
    const twR2 = this.scene.tweens.add({
      targets: this.forearmR,
      rotation: 0,
      duration: 280,
      ease: 'Back.easeOut.config(1.2)',
    })

    this.activeTweens.push(twL1, twR1, twL2, twR2)
  }

  /** Redraws only the ball graphics without re-creating arm structures */
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
   * Draws the Hazardous Doodle Chassis:
   * Heavy suspension cable, hazard chevron stripe band, chunky bolts, and warning beacon.
   */
  private drawChassis(g: Phaser.GameObjects.Graphics, headY: number): void {
    g.clear()
    const x = 0
    const topY = 0

    // 1. Chunky Doodle Cable & Conduit Lines
    g.lineStyle(6, INK, 1)
    g.lineBetween(x, topY, x, headY - 14)
    g.lineStyle(3.5, PALETTE.steelMid, 1)
    g.lineBetween(x, topY, x, headY - 14)

    // Pneumatic hose with doodle curl/stripe
    g.lineStyle(3, PALETTE.hazardYellow, 0.9)
    g.lineBetween(x + 5, topY, x + 5, headY - 14)
    g.lineStyle(1.5, INK, 0.8)
    g.lineBetween(x + 5, topY, x + 5, headY - 14)

    // Mounting Top Collar
    g.fillStyle(PALETTE.hazardDark, 1)
    g.fillRect(x - 12, headY - 18, 24, 6)
    g.lineStyle(2.5, INK, 1)
    g.strokeRect(x - 12, headY - 18, 24, 6)

    // 2. Main Chassis Box
    const w = 48
    const h = 26
    const left = x - w / 2
    const top = headY - 12

    // Shadow under chassis
    g.fillStyle(INK, 0.35)
    g.fillRoundedRect(left + 2, top + 2, w, h, 4)

    // Yellow hazard base plate
    g.fillStyle(PALETTE.hazardYellow, 1)
    g.fillRoundedRect(left, top, w, h, 4)

    // Diagonal Hazard Chevron Stripes across the center plate
    // Draw 4 diagonal dark stripes
    const stripeW = 6
    for (let sx = left - 6; sx < left + w + 12; sx += stripeW * 2) {
      g.fillStyle(PALETTE.hazardDark, 1)
      g.beginPath()
      g.moveTo(Math.max(left, sx), top)
      g.lineTo(Math.min(left + w, sx + stripeW), top)
      g.lineTo(Math.min(left + w, sx + stripeW - 8), top + h)
      g.lineTo(Math.max(left, sx - 8), top + h)
      g.closePath()
      g.fillPath()
    }

    // Heavy doodle ink border over chassis
    g.lineStyle(3, INK, 1)
    g.strokeRoundedRect(left, top, w, h, 4)

    // Inner plate bevel
    g.lineStyle(1.5, 0xffffff, 0.4)
    g.strokeRoundedRect(left + 2, top + 2, w - 4, h - 4, 3)

    // Center Warning Beacon Lamp (red glowing dome)
    g.fillStyle(PALETTE.hazardDark, 1)
    g.fillCircle(x, headY + 1, 6)
    g.lineStyle(2, INK, 1)
    g.strokeCircle(x, headY + 1, 6)

    g.fillStyle(PALETTE.warnRed, 1)
    g.fillCircle(x, headY + 1, 4)
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(x - 1.2, headY - 0.2, 1.3) // specular doodle gleam

    // Chunky Cartoon Corner Bolts
    const bolts = [
      { bx: left + 5, by: top + 5 },
      { bx: left + w - 5, by: top + 5 },
      { bx: left + 5, by: top + h - 5 },
      { bx: left + w - 5, by: top + h - 5 },
    ]
    for (const b of bolts) {
      g.fillStyle(PALETTE.boltBrass, 1)
      g.fillCircle(b.bx, b.by, 2.8)
      g.fillStyle(PALETTE.boltHighlight, 1)
      g.fillCircle(b.bx - 0.8, b.by - 0.8, 1.2)
      g.lineStyle(1.5, INK, 1)
      g.strokeCircle(b.bx, b.by, 2.8)
    }

    // Shoulder Hinge Protrusions on sides
    for (const s of [-1, 1]) {
      const hx = s * 21
      const hy = headY + 5
      g.fillStyle(PALETTE.hazardDark, 1)
      g.fillCircle(hx, hy, 7)
      g.lineStyle(2.5, INK, 1)
      g.strokeCircle(hx, hy, 7)

      g.fillStyle(PALETTE.hazardYellow, 1)
      g.fillCircle(hx, hy, 4.5)
      g.fillStyle(PALETTE.boltBrass, 1)
      g.fillCircle(hx, hy, 2.5)
      g.lineStyle(1.5, INK, 1)
      g.strokeCircle(hx, hy, 2.5)
    }
  }

  /**
   * Upper Arm: Shoulder joint (0, 0) -> Elbow joint (elbowX, elbowY).
   * Hazardous beam featuring yellow/black chevrons, exposed hydraulic strut, and chunky bolts.
   */
  private drawUpperArm(g: Phaser.GameObjects.Graphics, elbowX: number, elbowY: number): void {
    g.clear()

    // 1. Diagonal Hydraulic Cylinder Strut
    const midX = elbowX * 0.45
    const midY = elbowY * 0.45
    g.lineStyle(5, INK, 1)
    g.lineBetween(0, 0, midX, midY)
    g.lineStyle(3, PALETTE.hazardDark, 1)
    g.lineBetween(0, 0, midX, midY)

    g.lineStyle(4, INK, 1)
    g.lineBetween(midX, midY, elbowX, elbowY)
    g.lineStyle(2.5, PALETTE.pistonSilver, 1)
    g.lineBetween(midX, midY, elbowX, elbowY)

    // 2. Main Structural Beam with Doodle Hazard Striping
    // Heavy black underlay stroke
    g.lineStyle(11, INK, 1)
    g.lineBetween(0, 0, elbowX, elbowY)

    // Vibrant hazard yellow beam body
    g.lineStyle(8, PALETTE.hazardYellow, 1)
    g.lineBetween(0, 0, elbowX, elbowY)

    // Draw hazard chevron bands across the upper arm
    const len = Math.hypot(elbowX, elbowY)
    const bandCount = Math.max(3, Math.floor(len / 10))
    for (let i = 1; i < bandCount; i += 2) {
      const t0 = (i - 0.4) / bandCount
      const t1 = (i + 0.4) / bandCount
      g.lineStyle(7.5, PALETTE.hazardDark, 1)
      g.lineBetween(elbowX * t0, elbowY * t0, elbowX * t1, elbowY * t1)
    }

    // Specular highlight line along top edge
    g.lineStyle(2, 0xffffff, 0.4)
    g.lineBetween(0, -1, elbowX, elbowY - 1)

    // 3. Shoulder Knuckle Joint at (0, 0)
    g.fillStyle(PALETTE.hazardDark, 1)
    g.fillCircle(0, 0, 7.5)
    g.lineStyle(2.5, INK, 1)
    g.strokeCircle(0, 0, 7.5)

    g.fillStyle(PALETTE.boltBrass, 1)
    g.fillCircle(0, 0, 4)
    g.fillStyle(PALETTE.boltHighlight, 1)
    g.fillCircle(-1, -1, 1.5)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(0, 0, 4)

    // 4. Large Bolted Elbow Knuckle at (elbowX, elbowY)
    g.fillStyle(PALETTE.hazardDark, 1)
    g.fillCircle(elbowX, elbowY, 9)
    g.lineStyle(2.5, INK, 1)
    g.strokeCircle(elbowX, elbowY, 9)

    g.fillStyle(PALETTE.hazardYellow, 1)
    g.fillCircle(elbowX, elbowY, 6.5)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(elbowX, elbowY, 6.5)

    g.fillStyle(PALETTE.boltBrass, 1)
    g.fillCircle(elbowX, elbowY, 4)
    g.fillStyle(PALETTE.boltHighlight, 1)
    g.fillCircle(elbowX - 1, elbowY - 1, 1.5)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(elbowX, elbowY, 4)
  }

  /**
   * Forearm & Gripper Claw: Pivots at Elbow (0, 0).
   * Curved heavy doodle beam with hazard stripe segments, ending in dual-prong mechanical
   * pincer pads that cradle the ball's lower curvature.
   */
  private drawForearm(g: Phaser.GameObjects.Graphics, r: number, tipX: number, tipY: number): void {
    g.clear()

    const cpx = r * 0.52
    const cpy = tipY * 0.44

    const pts: Array<{ x: number; y: number }> = []
    const numSegments = 14
    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments
      const ax = 0 + (cpx - 0) * t
      const ay = 0 + (cpy - 0) * t
      const bx = cpx + (tipX - cpx) * t
      const byPoint = cpy + (tipY - cpy) * t
      pts.push({ x: ax + (bx - ax) * t, y: ay + (byPoint - ay) * t })
    }

    const v2 = pts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // 1. Chunky Doodle Ink Outline
    g.lineStyle(11, INK, 1)
    g.strokePoints(v2, false, false)

    // 2. High-Vis Hazard Yellow Forearm Core
    g.lineStyle(7.5, PALETTE.hazardYellow, 1)
    g.strokePoints(v2, false, false)

    // 3. Diagonal Hazard Stripe Accents along the curved beam
    for (let i = 2; i < pts.length - 2; i += 3) {
      const pA = pts[i]
      const pB = pts[i + 1]
      if (pA && pB) {
        g.lineStyle(7, PALETTE.hazardDark, 1)
        g.lineBetween(pA.x, pA.y, pB.x, pB.y)
      }
    }

    // Doodle inner highlight glint
    g.lineStyle(2, 0xffffff, 0.4)
    g.strokePoints(v2, false, false)

    // 4. Mid-Forearm Reinforcement Bolt
    const midIdx = Math.floor(pts.length * 0.5)
    const midPt = pts[midIdx] ?? { x: cpx, y: cpy }
    g.fillStyle(PALETTE.hazardDark, 1)
    g.fillCircle(midPt.x, midPt.y, 4)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(midPt.x, midPt.y, 4)
    g.fillStyle(PALETTE.boltBrass, 1)
    g.fillCircle(midPt.x, midPt.y, 2.5)

    // 5. Wrist Joint at (tipX, tipY)
    g.fillStyle(PALETTE.hazardDark, 1)
    g.fillCircle(tipX, tipY, 7)
    g.lineStyle(2.5, INK, 1)
    g.strokeCircle(tipX, tipY, 7)
    g.fillStyle(PALETTE.hazardYellow, 1)
    g.fillCircle(tipX, tipY, 4.5)
    g.fillStyle(PALETTE.boltBrass, 1)
    g.fillCircle(tipX, tipY, 2.8)

    // 6. Articulated Dual-Prong Pincer Grippers (Chunky Doodle Pincer Claws)
    // Outer claw prong
    const p1x = tipX - r * 0.26
    const p1y = tipY + r * 0.22
    g.lineStyle(8, INK, 1)
    g.lineBetween(tipX, tipY, p1x, p1y)
    g.lineStyle(5, PALETTE.hazardDark, 1)
    g.lineBetween(tipX, tipY, p1x, p1y)

    // Inner claw prong (hugging ball contour)
    const p2x = tipX - r * 0.14
    const p2y = tipY + r * 0.28
    g.lineStyle(7, INK, 1)
    g.lineBetween(tipX, tipY, p2x, p2y)
    g.lineStyle(4, PALETTE.hazardYellow, 1)
    g.lineBetween(tipX, tipY, p2x, p2y)

    // Textured doodle gripper pads at tips
    g.fillStyle(PALETTE.hazardYellow, 1)
    g.fillCircle(p1x, p1y, 3)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(p1x, p1y, 3)

    g.fillStyle(PALETTE.boltBrass, 1)
    g.fillCircle(p2x, p2y, 3)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(p2x, p2y, 3)
  }

  private redraw(): void {
    if (!this.holder) {
      this.holder = this.scene.add.container(0, 0)
      this.holder.setDepth(this.g.depth)
      this.holder.add(this.g)

      // Chassis graphics
      this.chassisG = this.scene.add.graphics()
      this.holder.add(this.chassisG)

      // Left Arm assembly
      this.armL = this.scene.add.container(0, 0)
      this.upperGL = this.scene.add.graphics()
      this.forearmL = this.scene.add.container(0, 0)
      this.foreGL = this.scene.add.graphics()
      this.forearmL.add(this.foreGL)
      this.armL.add([this.upperGL, this.forearmL])

      // Right Arm assembly
      this.armR = this.scene.add.container(0, 0)
      this.upperGR = this.scene.add.graphics()
      this.forearmR = this.scene.add.container(0, 0)
      this.foreGR = this.scene.add.graphics()
      this.forearmR.add(this.foreGR)
      this.armR.add([this.upperGR, this.forearmR])

      this.holder.add([this.armL, this.armR])
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
      this.chassisG?.setVisible(false)
      this.armL?.setVisible(false)
      this.armR?.setVisible(false)
      return
    }

    this.chassisG?.setVisible(true)
    this.armL?.setVisible(true)
    this.armR?.setVisible(true)

    const tier = getTier(this.tier)
    if (!tier) return
    const r = tier.radius
    const by = spawnY(r)
    const headY = by - r - 12

    // 1. Draw Hazardous Doodle Chassis
    this.drawChassis(this.chassisG!, headY)

    // 2. Kinematics tailored to ball radius r
    const shoulderMountX = 21
    const shoulderMountY = headY + 5

    this.armL!.setPosition(-shoulderMountX, shoulderMountY)
    this.armR!.setPosition(shoulderMountX, shoulderMountY)

    // Kinematics for closed grip pose:
    const elbowLocalX = r * 0.42 + 10
    const elbowLocalY = r * 0.45 + 12

    this.forearmL!.setPosition(elbowLocalX, elbowLocalY)
    this.forearmR!.setPosition(elbowLocalX, elbowLocalY)

    const tipRelX = r * 0.38 + 4
    const tipRelY = r * 0.95 + 8

    // Draw Left and Right Arm Art (mirrored via scaleX)
    this.armL!.scaleX = -1
    this.armR!.scaleX = 1

    this.drawUpperArm(this.upperGL!, elbowLocalX, elbowLocalY)
    this.drawUpperArm(this.upperGR!, elbowLocalX, elbowLocalY)

    this.drawForearm(this.foreGL!, r, tipRelX, tipRelY)
    this.drawForearm(this.foreGR!, r, tipRelX, tipRelY)

    // Set initial poses
    this.stopArmTweens()
    if (this.holding) {
      this.armL!.rotation = 0
      this.armR!.rotation = 0
      this.forearmL!.rotation = 0
      this.forearmR!.rotation = 0
    } else {
      this.armL!.rotation = -0.44
      this.armR!.rotation = 0.44
      this.forearmL!.rotation = 0.28
      this.forearmR!.rotation = -0.28
    }
  }
}
