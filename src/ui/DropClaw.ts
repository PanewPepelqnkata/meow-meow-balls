import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { spawnY } from '../config/spawn'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK, drawCollectibleBall } from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/** Palette constants: Industrial Steampunk / Heavy Arcade Machinery (Dark steel & Brass) */
const PALETTE = {
  steelDark: 0x22262c,     // Gunmetal plate base
  steelMid: 0x485058,      // Structural beam & chassis
  steelLight: 0x8a929b,    // Highlights & beveled edges
  steelPiston: 0xb5bcc4,   // Polished hydraulic cylinder rod
  brass: 0xc9933b,         // Brass/bronze knuckle pins & bushings
  brassLight: 0xf3ca65,    // Polished brass highlight / rivet
  shadow: 0x111317,        // Deep cavity / rivet recess
  accentRed: 0xbf3030,     // Steampunk warning marker dot
}

/**
 * Desktop drop claw: TWO ARTICULATED MECHANICAL ARMS (2-joint: shoulder + elbow + gripper pad).
 * Heavy industrial / arcade grabber aesthetic with dark gunmetal plating, exposed hydraulic
 * piston struts, and brass joint pins.
 *
 * Animations:
 * - Drop (release): instant snappy snap-open with slight upward recoil jolt.
 * - Reload (grab): reach in and clamp down with cushioned elastic squeeze around the ball.
 *
 * Performance Contract:
 * - Hand geometry is baked per-tier inside articulated containers.
 * - Aim translation only moves the parent container (zero re-tessellation per pointermove).
 * - Arm motion operates via GPU transform tweens (rotation & translation), strictly avoiding
 *   per-frame vector recreation.
 */
export class DropClaw {
  private readonly scene: Phaser.Scene
  private readonly g: Phaser.GameObjects.Graphics
  private holder: Phaser.GameObjects.Container | null = null
  private chassisG: Phaser.GameObjects.Graphics | null = null

  // Articulated Arm Containers (Left and Right)
  // Hierarchy: holder -> armContainer (shoulder pivot) -> elbowContainer (elbow pivot)
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

  // Track active tweens for snappy interruption
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
   * Cooldown state: on drop (holding: false) arms snap open with snappy recoil.
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
   * Snappy & punchy drop animation:
   * Instant snap open + subtle chassis recoil jolt upwards.
   */
  private playDropAnimation(): void {
    if (!this.armL || !this.armR || !this.forearmL || !this.forearmR || !this.chassisG) return
    this.stopArmTweens()

    const openAngleShoulder = 0.52 // radians (~30 deg outward)
    const openAngleElbow = -0.38    // radians (~22 deg backward/flair)

    // Snappy snap open (very fast Cubic.easeOut with tiny overshoot settle)
    const twL1 = this.scene.tweens.add({
      targets: this.armL,
      rotation: -openAngleShoulder,
      duration: 130,
      ease: 'Back.easeOut.config(1.4)',
    })
    const twR1 = this.scene.tweens.add({
      targets: this.armR,
      rotation: openAngleShoulder,
      duration: 130,
      ease: 'Back.easeOut.config(1.4)',
    })
    const twL2 = this.scene.tweens.add({
      targets: this.forearmL,
      rotation: -openAngleElbow,
      duration: 150,
      ease: 'Cubic.easeOut',
    })
    const twR2 = this.scene.tweens.add({
      targets: this.forearmR,
      rotation: openAngleElbow,
      duration: 150,
      ease: 'Cubic.easeOut',
    })

    // Recoil jolt on the whole chassis (kick up by 4px, then recover)
    const twRecoil = this.scene.tweens.add({
      targets: [this.chassisG, this.armL, this.armR],
      y: '-=5',
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
    })

    this.activeTweens.push(twL1, twR1, twL2, twR2, twRecoil)
  }

  /**
   * Reload animation:
   * Reaches in and clamps firmly onto the new ball with elastic cushion.
   */
  private playReloadAnimation(): void {
    if (!this.armL || !this.armR || !this.forearmL || !this.forearmR) return
    this.stopArmTweens()

    // Start from current or slightly open angle, then snap into 0 (closed) with elastic bounce
    const twL1 = this.scene.tweens.add({
      targets: this.armL,
      rotation: 0,
      duration: 220,
      ease: 'Back.easeOut.config(1.6)',
    })
    const twR1 = this.scene.tweens.add({
      targets: this.armR,
      rotation: 0,
      duration: 220,
      ease: 'Back.easeOut.config(1.6)',
    })
    const twL2 = this.scene.tweens.add({
      targets: this.forearmL,
      rotation: 0,
      duration: 240,
      ease: 'Back.easeOut.config(1.5)',
    })
    const twR2 = this.scene.tweens.add({
      targets: this.forearmR,
      rotation: 0,
      duration: 240,
      ease: 'Back.easeOut.config(1.5)',
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
   * Draws the industrial chassis (heavy gantry head, cables, pressure dial, brass bolts).
   */
  private drawChassis(g: Phaser.GameObjects.Graphics, headY: number): void {
    g.clear()
    const x = 0
    const topY = 0

    // Heavy steel braided cable & pneumatic conduit lines
    g.lineStyle(6, PALETTE.steelDark, 1)
    g.lineBetween(x - 3, topY, x - 3, headY - 14)
    g.lineStyle(3, PALETTE.steelMid, 1)
    g.lineBetween(x - 3, topY, x - 3, headY - 14)

    g.lineStyle(3, PALETTE.steelPiston, 1)
    g.lineBetween(x + 4, topY, x + 4, headY - 14)

    // Top mounting collar / bracket
    g.fillStyle(PALETTE.steelDark, 1)
    g.fillRect(x - 10, headY - 18, 20, 6)
    g.lineStyle(2, INK, 1)
    g.strokeRect(x - 10, headY - 18, 20, 6)

    // Main Steampunk / Heavy Machinery Chassis Block
    const w = 46
    const h = 26
    const left = x - w / 2
    const top = headY - 12

    // Drop shadow under chassis
    g.fillStyle(PALETTE.shadow, 0.4)
    g.fillRoundedRect(left + 2, top + 2, w, h, 4)

    // Main housing body
    g.fillStyle(PALETTE.steelDark, 1)
    g.fillRoundedRect(left, top, w, h, 4)
    g.lineStyle(2.5, INK, 1)
    g.strokeRoundedRect(left, top, w, h, 4)

    // Inner beveled armor plate
    g.fillStyle(PALETTE.steelMid, 1)
    g.fillRoundedRect(left + 3, top + 3, w - 6, h - 6, 2)
    g.lineStyle(1.5, PALETTE.steelLight, 0.7)
    g.strokeRoundedRect(left + 3, top + 3, w - 6, h - 6, 2)

    // Center round pressure gauge / servo cap with brass rim
    g.fillStyle(PALETTE.brass, 1)
    g.fillCircle(x, headY + 1, 6.5)
    g.fillStyle(PALETTE.steelDark, 1)
    g.fillCircle(x, headY + 1, 4.5)
    g.fillStyle(PALETTE.accentRed, 1)
    g.fillCircle(x, headY + 1, 2)

    // Heavy brass corner bolts / rivets
    const boltOffsets = [
      { bx: left + 6, by: top + 6 },
      { bx: left + w - 6, by: top + 6 },
      { bx: left + 6, by: top + h - 6 },
      { bx: left + w - 6, by: top + h - 6 },
    ]
    for (const b of boltOffsets) {
      g.fillStyle(PALETTE.brass, 1)
      g.fillCircle(b.bx, b.by, 2.5)
      g.fillStyle(PALETTE.brassLight, 1)
      g.fillCircle(b.bx - 0.5, b.by - 0.5, 1)
      g.lineStyle(1, INK, 1)
      g.strokeCircle(b.bx, b.by, 2.5)
    }

    // Shoulder hinge brackets protruding at left and right
    for (const s of [-1, 1]) {
      const hx = s * 20
      const hy = headY + 5
      g.fillStyle(PALETTE.steelDark, 1)
      g.fillCircle(hx, hy, 6)
      g.lineStyle(2, INK, 1)
      g.strokeCircle(hx, hy, 6)
      g.fillStyle(PALETTE.brass, 1)
      g.fillCircle(hx, hy, 3.2)
      g.lineStyle(1, INK, 1)
      g.strokeCircle(hx, hy, 3.2)
    }
  }

  /**
   * Upper Arm: Shoulder joint (0, 0) -> Elbow joint (elbowX, elbowY).
   * Steel I-beam armature with exposed hydraulic cylinder strut and reinforced knuckle.
   */
  private drawUpperArm(g: Phaser.GameObjects.Graphics, elbowX: number, elbowY: number): void {
    g.clear()

    // 1. Hydraulic Piston Cylinder (diagonal background strut)
    const midX = elbowX * 0.4
    const midY = elbowY * 0.4
    g.lineStyle(5, PALETTE.steelDark, 1)
    g.lineBetween(0, 0, midX, midY)
    g.lineStyle(3, PALETTE.steelPiston, 1)
    g.lineBetween(midX, midY, elbowX, elbowY)

    // 2. Main Structural Girder / Beam
    g.lineStyle(9, INK, 1)
    g.lineBetween(0, 0, elbowX, elbowY)
    g.lineStyle(6.5, PALETTE.steelMid, 1)
    g.lineBetween(0, 0, elbowX, elbowY)
    g.lineStyle(3, PALETTE.steelLight, 0.8)
    g.lineBetween(0, 0, elbowX, elbowY)

    // 3. Shoulder Pin Assembly at (0, 0)
    g.fillStyle(PALETTE.steelDark, 1)
    g.fillCircle(0, 0, 7)
    g.lineStyle(2, INK, 1)
    g.strokeCircle(0, 0, 7)
    g.fillStyle(PALETTE.brass, 1)
    g.fillCircle(0, 0, 4)
    g.fillStyle(PALETTE.brassLight, 1)
    g.fillCircle(-1, -1, 1.5)
    g.lineStyle(1, INK, 1)
    g.strokeCircle(0, 0, 4)

    // 4. Large Elbow Knuckle Bushing at (elbowX, elbowY)
    g.fillStyle(PALETTE.steelDark, 1)
    g.fillCircle(elbowX, elbowY, 8.5)
    g.lineStyle(2, INK, 1)
    g.strokeCircle(elbowX, elbowY, 8.5)

    g.fillStyle(PALETTE.steelMid, 1)
    g.fillCircle(elbowX, elbowY, 6)
    g.fillStyle(PALETTE.brass, 1)
    g.fillCircle(elbowX, elbowY, 4.5)
    g.fillStyle(PALETTE.brassLight, 1)
    g.fillCircle(elbowX - 1, elbowY - 1, 1.8)
    g.lineStyle(1.5, INK, 1)
    g.strokeCircle(elbowX, elbowY, 4.5)
  }

  /**
   * Forearm & Gripper Claw: Pivots at Elbow (0, 0).
   * Sweeps curved articulated plate hugging the ball, ending in heavy mechanical claw pads
   * with high-friction notched pincer teeth.
   */
  private drawForearm(g: Phaser.GameObjects.Graphics, r: number, tipX: number, tipY: number): void {
    g.clear()

    // Forearm sweeps from (0, 0) outward around the ball shoulder then down to the tip (tipX, tipY)
    const cpx = r * 0.55
    const cpy = tipY * 0.45

    const pts: Array<{ x: number; y: number }> = []
    const numSegments = 12
    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments
      const ax = 0 + (cpx - 0) * t
      const ay = 0 + (cpy - 0) * t
      const bx = cpx + (tipX - cpx) * t
      const byPoint = cpy + (tipY - cpy) * t
      pts.push({ x: ax + (bx - ax) * t, y: ay + (byPoint - ay) * t })
    }

    const v2 = pts.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // Heavy segmented beam casing
    g.lineStyle(10, INK, 1)
    g.strokePoints(v2, false, false)
    g.lineStyle(7, PALETTE.steelMid, 1)
    g.strokePoints(v2, false, false)
    g.lineStyle(3, PALETTE.steelLight, 0.8)
    g.strokePoints(v2, false, false)

    // Mid-forearm hydraulic piston rod & reinforcement bracket
    const midIdx = Math.floor(pts.length * 0.5)
    const midPt = pts[midIdx] ?? { x: cpx, y: cpy }
    g.fillStyle(PALETTE.brass, 1)
    g.fillCircle(midPt.x, midPt.y, 3)
    g.lineStyle(1, INK, 1)
    g.strokeCircle(midPt.x, midPt.y, 3)
    // Wrist pivot housing at tip
    g.fillStyle(PALETTE.steelDark, 1)
    g.fillCircle(tipX, tipY, 6)
    g.lineStyle(2, INK, 1)
    g.strokeCircle(tipX, tipY, 6)
    g.fillStyle(PALETTE.brass, 1)
    g.fillCircle(tipX, tipY, 3)

    // Articulated 2-Prong Mechanical Gripper Clamp with Pincer Pads
    // Outer claw prong
    const p1x = tipX - r * 0.28
    const p1y = tipY + r * 0.2
    g.lineStyle(7, INK, 1)
    g.lineBetween(tipX, tipY, p1x, p1y)
    g.lineStyle(4.5, PALETTE.steelDark, 1)
    g.lineBetween(tipX, tipY, p1x, p1y)

    // Inner claw prong (angled inward to cradle ball lower quadrant)
    const p2x = tipX - r * 0.16
    const p2y = tipY + r * 0.26
    g.lineStyle(6, INK, 1)
    g.lineBetween(tipX, tipY, p2x, p2y)
    g.lineStyle(3.5, PALETTE.brass, 1)
    g.lineBetween(tipX, tipY, p2x, p2y)

    // High-friction rubber/brass gripper pads on the tips
    g.fillStyle(PALETTE.steelLight, 1)
    g.fillCircle(p1x, p1y, 2.5)
    g.lineStyle(1, INK, 1)
    g.strokeCircle(p1x, p1y, 2.5)

    g.fillStyle(PALETTE.brassLight, 1)
    g.fillCircle(p2x, p2y, 2.5)
    g.lineStyle(1, INK, 1)
    g.strokeCircle(p2x, p2y, 2.5)
  }

  private redraw(): void {
    if (!this.holder) {
      this.holder = this.scene.add.container(0, 0)
      this.holder.setDepth(this.g.depth)
      this.holder.add(this.g)

      // Chassis graphics (cable, head, gauge, bolts)
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

    // 1. Draw Chassis
    this.drawChassis(this.chassisG!, headY)

    // 2. Compute 2-Joint Kinematics tailored to ball radius r
    // Shoulder positions on chassis mounts
    const shoulderMountX = 20
    const shoulderMountY = headY + 5

    this.armL!.setPosition(-shoulderMountX, shoulderMountY)
    this.armR!.setPosition(shoulderMountX, shoulderMountY)

    // Kinematics for closed grip pose (relative to shoulder):
    // Elbow reaches diagonally outward and down:
    const elbowLocalX = r * 0.42 + 10
    const elbowLocalY = r * 0.45 + 12

    this.forearmL!.setPosition(elbowLocalX, elbowLocalY)
    this.forearmR!.setPosition(elbowLocalX, elbowLocalY)

    // Tip position relative to elbow:
    // Grips down to lower third of the ball
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
      this.armL!.rotation = -0.52
      this.armR!.rotation = 0.52
      this.forearmL!.rotation = 0.38
      this.forearmR!.rotation = -0.38
    }
  }
}
