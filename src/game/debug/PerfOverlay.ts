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
  /** Worst frame per ~100ms bucket — feeds the 1%-low stat. */
  private frameWorst: number[] = []
  /** Last bucket boundary for the worst-frame collection. */
  private worstBucket = 0
  /** Worst frame duration inside the current bucket. */
  private worstBucketMax = 0
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
    const dur = performance.now() - frameStart
    this.frameSamples.push(dur)
    // Worst-frame per ~100ms bucket: approximates the tail distribution
    // (a 1s window at 60fps = 10 buckets → 10% low ≈ close to 1% low when
    // spikes are rarer than that).
    const bucket = Math.floor(performance.now() / 100)
    if (bucket !== this.worstBucket) {
      this.frameWorst.push(this.worstBucketMax)
      if (this.frameWorst.length > 40) this.frameWorst.shift()
      this.worstBucket = bucket
      this.worstBucketMax = 0
    }
    if (dur > this.worstBucketMax) this.worstBucketMax = dur
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
    this.frameWorst = []
    this.lastReadout = now

    let particles = 0
    if (this.manager) {
      for (const b of this.manager.snapshot()) {
        particles += b.soft.particles.length + 1
      }
    }

    const c = this.scene.game.canvas
    // 1% low: mean of the slowest 1% of frames (approx: worst 4 frames of
    // the window, matching the ~250ms readout cadence at 60fps).
    const sorted = [...this.frameWorst].sort((a, b) => b - a)
    const low1 = sorted.length ? sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25))).reduce((a2, b2) => a2 + b2, 0) / Math.max(1, Math.ceil(sorted.length * 0.25)) : 0
    const renderer = this.scene.game.renderer
    let drawBuf: number[] | null = null
    if (renderer.type === Phaser.WEBGL && 'gl' in renderer) {
      // WebGLRenderer guarantees .gl when its type is WEBGL.
      const gl = (renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl
      drawBuf = [gl.drawingBufferWidth, gl.drawingBufferHeight]
    }
    const cam = this.scene.cameras.main
    this.text.setText(
      [
        `FPS ${fps} (raf)  avg ${avg.toFixed(1)}ms  1%low ${low1.toFixed(1)}ms  worst ${max.toFixed(1)}ms`,
        `physics ${this.physicsMs.toFixed(1)}ms  render ${this.renderMs.toFixed(1)}ms`,
        `balls ${this.softBalls?.size ?? 0}  particles ${particles}`,
        `dpr ${this.dpr}  css ${c.clientWidth}x${c.clientHeight}  canvas ${c.width}x${c.height}`,
        `gl buffer ${drawBuf ? drawBuf.join('x') : 'n/a'}  phaser ${this.scene.scale.width}x${this.scene.scale.height}  zoom ${cam.zoom.toFixed(3)}`,
        `renderer ${this.scene.game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas'}`,
      ].join('\n'),
    )
  }

  private lastReadout = -250
}
