import Phaser from 'phaser'
import { GAME_OVER_SEQUENCE as CFG } from '../../config/gameOverSequence'
import { softBallCentroid } from '../systems/SoftBall'
import type { SoftBallEntity } from '../systems/SoftBallManager'
import { getTier } from '../../config/ballTiers'

/**
 * GAME OVER SEQUENCE — panic → shatter chain → done.
 *
 * Flow (all timings from src/config/gameOverSequence.ts):
 *  1. PANIC: every live ball's face is forced to full panic (the renderer
 *     reads `panicOverride`), camera shakes once — the pile realizes it is
 *     doomed.
 *  2. SHATTER CHAIN: each ball pops at its own deterministic offset inside
 *     the stagger window — inflate/crack tween, then the ball SHATTERS
 *     into small irregular rounded shards (pooled, one Graphics layer) +
 *     a small camera kick. Bigger balls burst into more/larger pieces.
 *  3. DONE: after the last shatter + a short pause, `onComplete` fires
 *     (the UI scene shows the redesigned panel).
 *
 * PERFORMANCE: exactly ONE Graphics layer and ONE fixed-size particle pool
 * (plain object array, reused every pop, zero allocation during the
 * chain). Shards are rounded polygons rendered as transformed circles +
 * rotation — no physics bodies, no textures. A full container costs the
 * same as a short one. Ball removal reuses SoftBallManager.removeBall.
 */

interface PooledShard {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  /** Remaining life (ms). */
  life: number
  /** Total life for the fade curve. */
  total: number
  /** Half-extent (px) of the shard body. */
  radius: number
  /** Aspect squash (0.6..1) — irregular pieces. */
  aspect: number
  /** Spin (rad/s) and current rotation. */
  spin: number
  rot: number
  /** How rounded the shard is (0.4..0.9 — chunk of the enclosing circle). */
  round: number
  color: number
  /** True = tiny white highlight chip. */
  shine: boolean
}

/** A per-ball "popping" record: scale proxy tweened, then removed. */
interface PoppingBall {
  entity: SoftBallEntity
  /** The proxy object the tween drives (holds `scale`). */
  proxy: { scale: number }
}

export class GameOverSequence {
  private scene: Phaser.Scene
  /** The single pooled-shard Graphics layer (above balls, below UI). */
  private fx: Phaser.GameObjects.Graphics
  /** Fixed shard pool — reused forever, never reallocated. */
  private pool: PooledShard[] = []
  /** The renderer consults this: > 0 forces full-panic faces on every ball
   * still alive (the "doomed" realization), while pop-scaled bodies read
   * their per-ball scale. */
  panicOverride = 0
  /** Per-ball visual scale override (0 = fully popped/gone). */
  scaleOverrides = new Map<number, number>()
  /** Scene-provided removal (SoftBallManager.removeBall) — called at the
   * crack peak so the physics body disappears exactly when the ball
   * shatters. */
  private removeBall: (id: number) => void
  /** Balls currently playing their crack tween. */
  private popping = new Map<number, PoppingBall>()
  private running = false
  private timer: Phaser.Time.TimerEvent | null = null

  constructor(scene: Phaser.Scene, removeBall: (id: number) => void) {
    this.scene = scene
    this.removeBall = removeBall
    this.fx = scene.add.graphics().setDepth(30)
    for (let i = 0; i < CFG.particlePoolSize; i++) {
      this.pool.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, total: 1, radius: 5, aspect: 1, spin: 0, rot: 0,
        round: 0.7, color: 0xffffff, shine: false,
      })
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  /**
   * Start the sequence over the given live balls. `onDone` fires after the
   * last shatter + the panel pause. Idempotent: a second call while
   * running is ignored (the scene gates it, but this also guards tests).
   */
  start(balls: readonly SoftBallEntity[], onDone: () => void): void {
    if (this.running) return
    this.running = true
    // 1. PANIC: force full-panic faces on every survivor.
    this.panicOverride = 1
    this.scene.cameras.main.shake(CFG.panicMs, CFG.shakeStrength / 900)

    // 2. SHATTER CHAIN: deterministic stagger (seeded) over the window.
    const rng = Phaser.Math.RND
    const count = balls.length
    const stagger = count <= 1 ? CFG.staggerMs * 0.3 : CFG.staggerMs
    const delays = balls
      .map((_, i) => (i === count - 1 ? stagger : rng.frac() * stagger))
      .sort((a, b) => a - b)
    let lastPop = 0
    balls.forEach((ball, i) => {
      const at = delays[i]!
      lastPop = Math.max(lastPop, at)
      this.scene.time.delayedCall(CFG.panicMs + at, () => this.popOne(ball))
    })

    // 3. DONE: last shatter + its squash + the panel pause.
    this.scene.time.delayedCall(
      CFG.panicMs + lastPop + CFG.popSquashMs + CFG.panelDelayMs,
      () => {
        this.running = false
        this.panicOverride = 0
        onDone()
      },
    )
  }

  /** Shatter one ball: crack tween → shard explosion + remove. */
  private popOne(ball: SoftBallEntity): void {
    if (ball.state === 'removed') return
    const c = softBallCentroid(ball.soft)
    const r = ball.soft.radius
    const color = getTier(ball.tier)?.color ?? 0x4fc3f7
    // Camera kick: short, per-pop, strength scaled by ball size (only the
    // bigger pops shake — see popShakeMinRadius).
    if (r >= CFG.popShakeMinRadius) {
      const big = Math.min(1, r / 90)
      this.scene.cameras.main.shake(
        CFG.shakeDurationMs,
        (CFG.shakeStrength * (0.5 + big * 0.5)) / 2600,
      )
    }
    // CRACK: inflate tween (the ball swells until it bursts) on a scale
    // proxy; the renderer shrinks/scales the body (visual only). Matter
    // ownership transfers to removeBall at the burst. Physics was ALREADY
    // paused for game over, so no gameplay impact.
    const proxy = { scale: 1 }
    this.popping.set(ball.id, { entity: ball, proxy })
    this.scaleOverrides.set(ball.id, 1)
    this.scene.tweens.add({
      targets: proxy,
      scale: 1.3, // inflate to bursting
      duration: CFG.popSquashMs * 0.55,
      ease: 'Quad.easeOut',
      onYoyo: undefined,
      onComplete: () => {
        // BURST: shatter into irregular rounded shards + remove the body.
        this.shatter(c.x, c.y, r, color)
        this.scaleOverrides.set(ball.id, 0.001)
        this.removeBall(ball.id)
        this.scene.tweens.add({
          targets: proxy,
          scale: 0,
          duration: CFG.popSquashMs * 0.3,
          ease: 'Quad.easeIn',
          onComplete: () => {
            this.scaleOverrides.delete(ball.id)
            this.popping.delete(ball.id)
          },
        })
      },
      onUpdate: () => {
        this.scaleOverrides.set(ball.id, proxy.scale)
      },
    })
  }

  /**
   * Spawn the shatter: irregular rounded shards flying outward, plus a few
   * white highlight chips. Never allocates — everything comes from the
   * fixed pool.
   */
  private shatter(x: number, y: number, ballRadius: number, color: number): void {
    const sizeScale = CFG.burstScaleMin + Math.min(1, ballRadius / 90) * CFG.burstScaleRange
    const want = Math.round(CFG.piecesPerBall * (0.75 + sizeScale * 0.5))
    // Two colors: the ball's body + a darker shade for depth variety.
    const base = color
    const shaded = Phaser.Display.Color.IntegerToColor(color).darken(24).color
    let spawned = 0
    for (const p of this.pool) {
      if (spawned >= want) break
      if (p.active) continue
      p.active = true
      const ang = Math.random() * Math.PI * 2
      const speed = CFG.pieceSpeedMin + Math.random() * (CFG.pieceSpeedMax - CFG.pieceSpeedMin)
      p.x = x + Math.cos(ang) * ballRadius * 0.35
      p.y = y + Math.sin(ang) * ballRadius * 0.35
      p.vx = Math.cos(ang) * speed
      p.vy = Math.sin(ang) * speed - CFG.pieceUpBias
      p.total = CFG.pieceLifeMs * (0.7 + Math.random() * 0.6)
      p.life = p.total
      p.radius = (CFG.pieceSizeMin + Math.random() * (CFG.pieceSizeMax - CFG.pieceSizeMin)) * sizeScale
      p.aspect = 0.6 + Math.random() * 0.4
      p.spin = (Math.random() - 0.5) * CFG.pieceSpin
      p.rot = Math.random() * Math.PI
      p.round = 0.4 + Math.random() * 0.5
      // ~1 in 6 pieces is a white highlight chip.
      const isShine = Math.random() < CFG.shineFraction
      p.shine = isShine
      p.color = isShine ? 0xffffff : Math.random() < 0.5 ? base : shaded
      spawned++
    }
  }

  /** Per-frame: advance pool shards + draw the fx layer. Call from the
   * scene update while the sequence is running (safe to call always). */
  update(delta: number): void {
    const g = this.fx
    g.clear()
    if (!this.running && this.pool.every((p) => !p.active)) return
    const dt = Math.min(48, delta) / 1000
    for (const p of this.pool) {
      if (!p.active) continue
      p.life -= delta
      if (p.life <= 0) {
        p.active = false
        continue
      }
      p.vy += CFG.pieceGravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.spin * dt
      const k = p.life / p.total
      // Fast outward + fade: alpha eases out over the last 60% of life.
      const alpha = Math.min(1, k / 0.6)
      const s = p.radius * (0.7 + k * 0.5)
      g.save()
      g.translateCanvas(p.x, p.y)
      g.rotateCanvas(p.rot)
      if (p.shine) {
        // Tiny white highlight chip: a small rounded diamond.
        g.fillStyle(0xffffff, alpha)
        g.fillRoundedRect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4, s * 0.55)
      } else {
        // Irregular rounded shard: a squashed circle clipped to a chunk —
        // approximated by a rounded rect with one long side (pie-slice-ish
        // chunk of the ball surface).
        g.fillStyle(p.color, alpha)
        g.fillRoundedRect(-s, -s * p.aspect, s * 2, s * 2 * p.aspect, s * p.round * p.aspect)
        // Inner shading edge for depth (darker on one side).
        g.fillStyle(0x000000, alpha * 0.18)
        g.fillRoundedRect(s * 0.15, -s * p.aspect, s * 0.85, s * 2 * p.aspect, s * p.round * p.aspect)
      }
      g.restore()
    }
  }

  /** Destroy the layer (scene shutdown). */
  destroy(): void {
    if (this.timer != null) this.scene.time.removeEvent(this.timer)
    this.fx.destroy()
  }
}
