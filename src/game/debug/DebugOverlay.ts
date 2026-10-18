import Phaser from 'phaser'
import { interiorPolygon } from '../../config/container'
import type { PhysicsWorld } from '../systems/PhysicsWorld'
import type { SoftBallManager } from '../systems/SoftBallManager'

/**
 * Development-only debug overlay. Instantiated exclusively behind
 * `import.meta.env.DEV`, so Vite dead-code-eliminates it from production
 * builds. Toggled with the D key; shows collider outlines, container bounds,
 * per-ball position/velocity text for hovered... (kept simple: stats panel).
 */
export class DebugOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics
  private readonly statsText: Phaser.GameObjects.Text
  private visible = false

  private stepsWindowCount = 0
  private stepsWindowMs = 0
  private stepsPerSecond = 0

  constructor(
    scene: Phaser.Scene,
    private readonly physicsWorld: PhysicsWorld,
    private readonly balls: SoftBallManager,
  ) {
    this.graphics = scene.add.graphics().setDepth(100)
    this.statsText = scene.add
      .text(12, 12, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#00ff88',
        backgroundColor: '#000000aa',
      })
      .setDepth(101)

    this.redrawContainerBounds()
    this.setAllVisible(false)

    scene.input.keyboard?.on('keydown-D', () => {
      this.visible = !this.visible
      this.setAllVisible(this.visible)
    })
  }

  private setAllVisible(v: boolean): void {
    this.graphics.setVisible(v)
    this.statsText.setVisible(v)
  }

  private redrawContainerBounds(): void {
    const poly = interiorPolygon()
    this.graphics.lineStyle(1, 0x00ff88, 0.9)
    this.graphics.beginPath()
    this.graphics.moveTo(poly[0]!.x, poly[0]!.y)
    for (let i = 1; i < poly.length; i++) this.graphics.lineTo(poly[i]!.x, poly[i]!.y)
    this.graphics.closePath()
    this.graphics.strokePath()
  }

  /** Called once per rendered frame. */
  update(deltaMs: number): void {
    this.stepsWindowMs += deltaMs
    this.stepsWindowCount = this.physicsWorld.stepCount - this.lastStepCount
    this.lastStepCount = this.physicsWorld.stepCount
    if (this.stepsWindowMs >= 1000) {
      this.stepsPerSecond = (this.stepsWindowCount * 1000) / this.stepsWindowMs
      this.stepsWindowMs = 0
    }

    if (!this.visible) return

    this.graphics.clear()
    this.redrawContainerBounds()

    for (const body of this.physicsWorld.getAllBodies()) {
      const color = body.isStatic ? 0x00aaff : body.isSleeping ? 0x888888 : 0x00ff88
      this.graphics.lineStyle(1, color, 0.9)
      if (body.circleRadius != null) {
        this.graphics.strokeCircle(body.position.x, body.position.y, body.circleRadius)
      } else {
        const bounds = body.bounds
        this.graphics.strokeRect(bounds.min.x, bounds.min.y, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y)
      }
    }

    const lines: string[] = [
      `bodies: ${this.physicsWorld.bodyCount} (balls: ${this.balls.count})`,
      `steps: ${this.physicsWorld.stepCount}`,
      `sim time: ${(this.physicsWorld.simTimeMs / 1000).toFixed(2)}s`,
      `steps/s: ${this.stepsPerSecond.toFixed(1)}`,
    ]
    let i = 0
    for (const ball of this.balls.getBalls()) {
      if (i >= 8) {
        lines.push(`… +${this.balls.count - 8} more`)
        break
      }
      const v = ball.body.velocity
      const c = this.balls.centroid(ball.id)
      lines.push(`#${ball.id} t${ball.tier} p(${c.x.toFixed(0)}, ${c.y.toFixed(0)}) v(${v.x.toFixed(1)}, ${v.y.toFixed(1)})`)
      i += 1
    }
    this.statsText.setText(lines.join('\n'))
  }

  private lastStepCount = 0
}
