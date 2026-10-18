import Phaser from 'phaser'
import Matter from 'matter-js'
import {
  createSoftBall,
  applyPressure,
  clampSoftBallSpeed,
  softBallArea,
  softBallSpeed,
  softBallCentroid,
  renderContour,
  SOFT,
} from '../systems/SoftBall'
import type { SoftBall } from '../systems/SoftBall'


const COLORS = { bg: 0xf4f4f2, floor: 0x1a1a1a, ball: 0x4fc3f7, presser: 0xf44336, spoke: 0x000000 }

/**
 * Phase 2.7 DEV-ONLY prototype scene (registered behind ?softbody=1).
 * One Matter-native soft-body ball + one rigid presser ball.
 *
 * Controls:
 *  - S: drop the rigid presser onto the soft ball (sustained pressure)
 *  - A: shove the soft ball sideways against the wall
 *  - R: reset
 *
 * Renders the ACTUAL particle polygon (smoothed) + spokes — the outline and
 * face are generated from the simulated shape, never from a hidden circle.
 */
export class SoftBallScene extends Phaser.Scene {
  private ball!: SoftBall
  private presser: Matter.Body | null = null
  private layer!: Phaser.GameObjects.Graphics
  private status!: Phaser.GameObjects.Text
  private floorY = 1000
  private accumulatorMs = 0
  private engine!: Matter.Engine

  constructor() {
    super('softball')
  }

  create(): void {
    // Dedicated engine, identical to the validated headless rig: sleeping
    // DISABLED (particles jammed under load must never sleep mid-penetration)
    // and higher solver iterations for the constraint-heavy composite.
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 1, scale: 0.0016 },
      positionIterations: 10,
      velocityIterations: 8,
      constraintIterations: 4,
      enableSleeping: false,
    })
    const wall = (x: number, y: number, w: number, h: number) => {
      Matter.Composite.add(this.engine.world, Matter.Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.02, frictionStatic: 0.02 }))
    }
    this.floorY = 1000
    // Thick floor: with the 14px/step particle clamp, a particle can never
    // cross 80px of slab within the solver's correction window.
    wall(360, this.floorY + 40, 720, 80)
    wall(-14, 600, 28, 1200)
    wall(734, 600, 28, 1200)

    this.ball = createSoftBall(360, 300, 90, 1)
    Matter.Composite.add(this.engine.world, this.ball.composite)

    this.layer = this.add.graphics().setDepth(10)
    this.status = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '14px', color: '#1a1a1a', backgroundColor: '#ffffffcc' })
      .setDepth(20)

    this.input.keyboard?.on('keydown-S', () => this.spawnPresser())
    this.input.keyboard?.on('keydown-A', () => this.shoveWall())
    this.input.keyboard?.on('keydown-R', () => this.scene.restart())
    // Headless-capture hooks
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__sbScene = {
        press: () => this.spawnPresser(),
        shove: () => this.shoveWall(),
        dropAt: (x: number) => this.spawnPresser(x),
      }
      ;(window as unknown as Record<string, unknown>).__sbState = () => this.snapshot()
    }
  }

  private spawnPresser(x = 360): void {
    if (this.presser) return
    // Wide heavy rectangle (same rig as the passing headless tests): lands on
    // top of the soft ball and presses straight down — sustained pressure.
    const body = Matter.Bodies.rectangle(x, 120, 300, 60, {
      label: 'presser',
      friction: 0.02,
      frictionStatic: 0.02,
      density: 0.003,
    })
    Matter.Composite.add(this.engine.world, body)
    this.presser = body
  }

  private shoveWall(): void {
    for (const p of this.ball.particles) {
      p.force.x -= 0.02 * p.mass
    }
  }

  private snapshot(): string {
    const area = softBallArea(this.ball)
    const ratio = area / this.ball.restArea
    const c = softBallCentroid(this.ball)
    return JSON.stringify({
      areaRatio: +ratio.toFixed(3),
      speed: +softBallSpeed(this.ball).toFixed(3),
      centroid: { x: +c.x.toFixed(0), y: +c.y.toFixed(0) },
      spreadX: +(
        Math.max(...this.ball.particles.map((p) => p.position.x)) -
        Math.min(...this.ball.particles.map((p) => p.position.x))
      ).toFixed(1),
      spreadY: +(
        Math.max(...this.ball.particles.map((p) => p.position.y)) -
        Math.min(...this.ball.particles.map((p) => p.position.y))
      ).toFixed(1),
      minY: +Math.min(...this.ball.particles.map((p) => p.position.y)).toFixed(1),
      maxY: +Math.max(...this.ball.particles.map((p) => p.position.y)).toFixed(1),
      presser: this.presser ? { x: +this.presser.position.x.toFixed(0), y: +this.presser.position.y.toFixed(0) } : null,
    })
  }

  override update(_time: number, delta: number): void {
    // Fixed 60Hz stepping with per-substep soft-body passes — identical to the
    // validated headless rig. (PhysicsWorld's frame-level accumulator would
    // let particles move >1 substep between clamps and tunnel through the
    // floor on frame spikes.)
    this.accumulatorMs += Math.min(delta, 100)
    while (this.accumulatorMs >= 1000 / 60) {
      Matter.Engine.update(this.engine, 1000 / 60)
      clampSoftBallSpeed(this.ball)
      applyPressure(this.ball)
      this.accumulatorMs -= 1000 / 60
    }

    // ---- Render the ACTUAL simulated shape (smooth closed contour) ----
    const g = this.layer
    g.clear()
    const pr = this.ball.radius * SOFT.particleRadiusFactor
    // Catmull–Rom through the particle ring, outset to the particles' outer
    // edge; fill and outline share this one polygon.
    const contour = renderContour(this.ball, 6, pr)
    const poly = contour.map((p) => new Phaser.Math.Vector2(p.x, p.y))

    // Faint constraint web (dev visualization of the bracing)
    g.lineStyle(1, COLORS.spoke, 0.12)
    for (const p of this.ball.particles) {
      g.lineBetween(this.ball.center.position.x, this.ball.center.position.y, p.position.x, p.position.y)
    }

    g.fillStyle(COLORS.ball, 1)
    g.fillPoints(poly, true)
    g.lineStyle(5, 0x1a1a1a, 1)
    g.strokePoints(poly, true, true)
    // Presser (rotated rect drawn via its world vertices)
    if (this.presser) {
      const b = this.presser
      g.fillStyle(COLORS.presser, 1)
      g.fillPoints(b.vertices.map((v) => new Phaser.Math.Vector2(v.x, v.y)), true)
      g.lineStyle(5, 0x1a1a1a, 1)
      g.strokePoints(b.vertices.map((v) => new Phaser.Math.Vector2(v.x, v.y)), true, true)
    }
    // Face: anchored to the centroid, squashed with the ball's live aspect
    // ratio so it reads as part of the deforming body (not a rigid overlay).
    const c = softBallCentroid(this.ball)
    const ys = this.ball.particles.map((p) => p.position.y)
    const xs = this.ball.particles.map((p) => p.position.x)
    const sy = Math.max(...ys) - Math.min(...ys)
    const sx = Math.max(...xs) - Math.min(...xs)
    const aspect = Math.max(0.6, Math.min(1.0, sy / sx)) // <1 when flattened
    const ratio = softBallArea(this.ball) / this.ball.restArea
    const sizeK = Math.max(0.55, Math.min(1.05, ratio))
    const r = this.ball.radius * 0.2 * sizeK
    const eyeDx = r * 1.8
    const eyeY = c.y - r * 0.2 * aspect
    for (const dx of [-eyeDx, eyeDx]) {
      g.fillStyle(0xffffff, 1)
      g.fillCircle(c.x + dx, eyeY, r * Math.max(0.75, aspect))
      g.fillStyle(0x1a1a1a, 1)
      g.fillCircle(c.x + dx, eyeY, r * 0.55 * Math.max(0.75, aspect))
      g.fillStyle(0xffffff, 1)
      g.fillCircle(c.x + dx - r * 0.16, eyeY - r * 0.36, r * 0.3)
    }
    // Mouth squashes with the aspect too
    // Mouth: an arc squashed by drawing sampled points along an ellipse
    g.lineStyle(Math.max(2, r * 0.3), 0x1a1a1a, 1)
    g.beginPath()
    const my = c.y + r * 1.5 * aspect
    const mr = r * 0.6
    const mpts: Phaser.Math.Vector2[] = []
    for (let a = 25; a <= 155; a += 13) {
      const rad = Phaser.Math.DegToRad(a)
      mpts.push(new Phaser.Math.Vector2(c.x + Math.cos(rad) * mr / aspect, my + Math.sin(rad) * mr * aspect))
    }
    g.strokePoints(mpts, false, false)

    this.status.setText(
      `SOFT-BODY PROTOTYPE (dev)\narea ratio: ${ratio.toFixed(2)}  speed: ${softBallSpeed(this.ball).toFixed(2)}\nS=press  A=shove→wall  R=reset`,
    )
  }
}
