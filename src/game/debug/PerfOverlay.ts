import Phaser from 'phaser'
import type { SoftBallRenderer } from '../rendering/SoftBallRenderer'
import type { SoftBallManager } from '../systems/SoftBallManager'

/**
 * Phase 2.20 — DEV-ONLY performance overlay (?perf=1).
 *
 * Renders a small stats block top-left: FPS, frame time (avg + max over a
 * ~1s window), physics step time, render time, live ball count, particle
 * count, devicePixelRatio, canvas backing resolution. Mounted by
 * PlaygroundScene when the URL flag is present; never in production paths
 * (the flag check requires import.meta.env.DEV).
 *
 * Instrumentation: PlaygroundScene wraps its physics step and render work
 * in performance.now() pairs and pushes samples here each frame.
 */
export class PerfOverlay {
  private readonly text: Phaser.GameObjects.Text
  private readonly scene: Phaser.Scene
  private readonly softBalls: SoftBallRenderer | null
  private readonly manager: SoftBallManager | null
  /** Rolling window of frame durations (ms) since the last readout. */
  private frameSamples: number[] = []
  private physicsMs = 0
  private renderMs = 0
  private dpr = 0

  constructor(scene: Phaser.Scene, softBalls: SoftBallRenderer | null, manager: SoftBallManager | null) {
    this.scene = scene
    this.softBalls = softBalls
    this.manager = manager
    this.text = scene.add
      .text(8, 8, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#00ff88',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 4, y: 3 },
      })
      .setOrigin(0, 0)
      .setDepth(200)
      .setScrollFactor(0)
  }

  /** Per-frame sample from the scene (called after physics + render work). */
  sample(frameStart: number, physicsMs: number, renderMs: number): void {
    this.frameSamples.push(performance.now() - frameStart)
    this.physicsMs = physicsMs
    this.renderMs = renderMs
    this.dpr = window.devicePixelRatio || 1
  }

  /** Called by the scene's update — refreshes the readout at ~4 Hz. */
  tick(): void {
    const now = this.scene.time.now
    const elapsed = now - this.lastReadout
    if (elapsed < 250) return

    const samples = this.frameSamples
    const n = samples.length
    let max = 0
    let total = 0
    for (const s of samples) {
      total += s
      if (s > max) max = s
    }
    // FPS from wall-clock (rAF cadence is uncapped in headless; the device
    // rAF caps at the display rate, so this reports true on-device FPS).
    const fps = elapsed > 0 ? Math.round((n * 1000) / elapsed) : 0
    const avg = n ? total / n : 0
    this.frameSamples = []
    this.lastReadout = now

    let particles = 0
    if (this.manager) {
      for (const b of this.manager.snapshot()) {
        particles += b.soft.particles.length + 1
      }
    }

    const c = this.scene.game.canvas
    this.text.setText(
      [
        `FPS ${fps}  frame ${avg.toFixed(1)}ms (max ${max.toFixed(1)})`,
        `physics ${this.physicsMs.toFixed(1)}ms  render ${this.renderMs.toFixed(1)}ms`,
        `balls ${this.softBalls?.size ?? 0}  particles ${particles}`,
        `dpr ${this.dpr}  canvas ${c.width}x${c.height}`,
      ].join('\n'),
    )
  }

  private lastReadout = -250
}
