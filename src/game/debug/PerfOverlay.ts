import Phaser from 'phaser'
import type { SoftBallRenderer } from '../rendering/SoftBallRenderer'
import type { SoftBallManager } from '../systems/SoftBallManager'

/**
 * Phase 2.21 — DEV-ONLY performance + rendering diagnostic overlay
 * (?perf=1). Mounted by PlaygroundScene when the URL flag is present.
 *
 * Reports the FULL coordinate chain so any mismatch is visible at a glance:
 * window viewport (layout + visual), documentElement client size, canvas
 * CSS size, canvas backing size, WebGL drawing buffer size, Phaser scale
 * dims, camera zoom, renderer type, DPR — plus measured RAF cadence (an
 * independent rAF loop, so a Phaser-side stall can't hide a Safari cap),
 * game FPS, avg/1%-low/worst frame, physics/render split, ball and
 * particle counts.
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
  /** Worst frame duration inside the current bucket. */
  private worstBucketMax = 0
  /** Bucket boundary for the worst-frame collection. */
  private worstBucket = 0
  private physicsMs = 0
  private renderMs = 0
  private dpr = 0
  /** Independent RAF cadence measurement (not Phaser's step). */
  private rafCount = 0
  private rafWindowStart = 0
  private rafFps = 0
  private rafActive = true

  constructor(scene: Phaser.Scene, softBalls: SoftBallRenderer | null, manager: SoftBallManager | null) {
    this.scene = scene
    this.softBalls = softBalls
    this.manager = manager
    this.text = scene.add
      .text(8, 8, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#00ff88',
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: { x: 4, y: 3 },
      })
      .setOrigin(0, 0)
      .setDepth(200)
      .setScrollFactor(0)
    // Independent RAF loop: measures the display's actual callback rate.
    const raf = (t: number): void => {
      if (!this.rafActive) return
      if (this.rafWindowStart === 0) this.rafWindowStart = t
      this.rafCount++
      const elapsed = t - this.rafWindowStart
      if (elapsed >= 1000) {
        this.rafFps = Math.round((this.rafCount * 1000) / elapsed)
        this.rafCount = 0
        this.rafWindowStart = t
      }
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)
  }

  /** Per-frame sample from the scene (called after physics + render work). */
  sample(frameStart: number, physicsMs: number, renderMs: number): void {
    const dur = performance.now() - frameStart
    this.frameSamples.push(dur)
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

  /** Called by the scene's update — refreshes the readout at ~2 Hz. */
  tick(): void {
    const now = this.scene.time.now
    const elapsed = now - this.lastReadout
    if (elapsed < 500) return

    const samples = this.frameSamples
    const n = samples.length
    let max = 0
    let total = 0
    for (const s of samples) {
      total += s
      if (s > max) max = s
    }
    const avg = n ? total / n : 0
    const gameFps = elapsed > 0 ? Math.round((n * 1000) / elapsed) : 0
    // 1% low: mean of the slowest 1% of frames in the window.
    const sortedWorst = [...this.frameWorst].sort((a, b) => b - a)
    const k = Math.max(1, Math.ceil(sortedWorst.length * 0.25))
    const low1 = sortedWorst.length
      ? sortedWorst.slice(0, k).reduce((a, b) => a + b, 0) / k
      : 0
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
    const renderer = this.scene.game.renderer
    let drawBuf = 'n/a'
    if (renderer.type === Phaser.WEBGL && 'gl' in renderer) {
      // WebGLRenderer guarantees .gl when its type is WEBGL.
      const gl = (renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl
      drawBuf = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`
    }
    const vv = window.visualViewport
    const cam = this.scene.cameras.main
    this.text.setText(
      [
        `gameFPS ${gameFps}  RAF FPS ${this.rafFps || '…'}`,
        `avg ${avg.toFixed(1)}ms  1%low ${low1.toFixed(1)}ms  worst ${max.toFixed(1)}ms`,
        `physics ${this.physicsMs.toFixed(1)}ms  render ${this.renderMs.toFixed(1)}ms`,
        `balls ${this.softBalls?.size ?? 0}  particles ${particles}`,
        `dpr ${this.dpr}`,
        `win ${window.innerWidth}x${window.innerHeight}  vv ${vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : 'n/a'}`,
        `doc ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
        `canvas.css ${c.clientWidth}x${c.clientHeight}`,
        `canvas.buf ${c.width}x${c.height}  gl ${drawBuf}`,
        `phaser ${this.scene.scale.width}x${this.scene.scale.height}  zoom ${cam.zoom.toFixed(3)}`,
        `renderer ${renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas'}`,
      ].join('\n'),
    )
  }

  private lastReadout = -500

  /** Stop the independent RAF loop (scene shutdown). */
  destroy(): void {
    this.rafActive = false
    this.text.destroy()
  }
}
