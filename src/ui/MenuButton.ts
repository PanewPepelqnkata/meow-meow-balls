import Phaser from 'phaser'
import { hudText } from './Typography'
import { darkenFill, doodleSilhouette } from './CartoonButton'
import { getTier } from '../config/ballTiers'
import {
  INK,
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  drawCollectibleBall,
  restContour,
  expressionAt,
  type BallLook,
  type BallExpression,
} from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/**
 * Phase 2.23 — THE MENU BUTTON, fully in-canvas (supersedes the uiverse
 * DOM layer). A chunky cartoon pill in the game's own language:
 *
 *   · wobbly hand-drawn silhouette body (doodleSilhouette) on a darker
 *     extrusion slab + soft drop shadow — physical depth;
 *   · a LIVE ball character (shared BallAppearance pipeline) standing on
 *     the pill's left: it blinks, glances, wears easter-egg expressions,
 *     watches the pointer and REACTS to hover (hops + grins);
 *   · AAA juice: hover = spring scale-up + warm under-glow + shine glint
 *     sweeping the pill; press = squash + an ink ring + confetti burst;
 *   · idle life: every pill breathes on its own phase, the label bobs a
 *     hair out of step, tier 8's ball cycles color;
 *   · entrance: pop-in with overshoot, staggered by the caller.
 *
 * The scene keeps its own hit rectangles as the authoritative input
 * surface (menuRects QA contract) and drives hover/press through
 * setHover/setPress; per-frame work is one refresh() call from the
 * scene's update() — transforms, alpha and one small character canvas
 * repaint per button. NO full-viewport bakes (iOS rule).
 */

export interface MenuButtonSpec {
  x: number
  y: number
  w: number
  h: number
  label: string
  tier: number
  seed: number
  /** PLAY gets the hero treatment (bigger pulse, warmer under-glow). */
  primary?: boolean
}

/** FNV-1a-style deterministic hash — stable per-button phase. */
function specSeed(label: string, w: number, h: number): number {
  let seed = 2166136261
  const text = `${label}:${w}:${h}`
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return seed >>> 0
}

export class MenuButton {
  private static measureCtx: CanvasRenderingContext2D | null = null

  readonly spec: MenuButtonSpec
  /** Root container — hover/press springs + the entrance tween drive it. */
  readonly c: Phaser.GameObjects.Container
  private hovered = false
  /** Hover spring 0..1 and press impulse 0..1, integrated per frame. */
  private hoverK = 0
  private pressK = 0
  /** Entrance: 0 until enter() runs; scale = springs × entrance scale. */
  private entered = false
  private entrance = 0
  private glow: Phaser.GameObjects.Ellipse
  private glint: Phaser.GameObjects.Rectangle
  private body: Phaser.GameObjects.Graphics
  private label: Phaser.GameObjects.Text
  private labelBaseY: number
  private charImg: Phaser.GameObjects.Image
  private charCtx: CanvasRenderingContext2D
  private charCanvas: HTMLCanvasElement
  private charKey: string
  private charSize: number
  private look: BallLook
  private blinkClosed = false
  private blinkT: number
  private hop = 0
  /** One-shot press FX (ink ring + confetti), parented INSIDE `c`. */
  private fxRing: Phaser.GameObjects.Arc | null = null
  private fxConfetti: Array<{ s: Phaser.GameObjects.Rectangle; vx: number; vy: number; vr: number }> = []
  private fxT = -1

  constructor(
    private scene: Phaser.Scene,
    spec: MenuButtonSpec,
    layer: Phaser.GameObjects.Container,
  ) {
    this.spec = spec
    const { w, h, tier, seed } = spec
    const fill = getTier(tier)!.color
    this.look = ballLookFor(tier, seed)
    this.blinkT = 900 + (seed % 2000)

    this.c = scene.add.container(spec.x, spec.y)
    layer.add(this.c)

    // Under-glow pool: a soft warm ellipse behind the pill (ADD blend),
    // alpha driven by hover + the PLAY pulse — stage light, not bloom.
    this.glow = scene.add.ellipse(0, h * 0.5, w * 1.16, h * 0.66, fill, 0)
    this.glow.setBlendMode(Phaser.BlendModes.ADD)
    this.c.add(this.glow)

    // Body + slab + shadow — one Graphics, painted once (state changes
    // are transforms/alpha on the container, never path repaints).
    this.body = scene.add.graphics()
    this.c.add(this.body)
    this.paintBody(fill)

    // Shine glint: a small white streak that sweeps the pill on hover.
    this.glint = scene.add.rectangle(0, -h * 0.26, Math.min(34, w * 0.16), 7, 0xffffff, 0.5)
    this.glint.setRotation(-0.3)
    this.glint.setAlpha(0)
    this.c.add(this.glint)

    // Character slot: a small dpr-scaled canvas texture repainted per
    // frame — one ~64px canvas per button, trivial on GPU and CPU.
    this.charSize = Math.round(Math.min(h * 1.02, w * 0.34))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.charCanvas = document.createElement('canvas')
    this.charCanvas.width = this.charSize * dpr
    this.charCanvas.height = this.charSize * dpr
    this.charKey = `br-mb-char-${spec.label}`
    if (scene.textures.exists(this.charKey)) scene.textures.remove(this.charKey)
    scene.textures.addCanvas(this.charKey, this.charCanvas)
    this.charCtx = this.charCanvas.getContext('2d')!
    this.charCtx.scale(dpr, dpr)
    this.charImg = scene.add.image(0, 0, this.charKey)
    this.charImg.setDisplaySize(this.charSize, this.charSize)
    this.charImg.setPosition(-w / 2 + this.charSize * 0.6, -h * 0.14)
    this.c.add(this.charImg)

    // Label — Lilita One with the game's ink outline, sized to fit the
    // region right of the character slot.
    const base = Math.floor(h * (spec.primary ? 0.4 : 0.33))
    const avail = w - this.charSize * 0.9 - 26
    if (!MenuButton.measureCtx) {
      MenuButton.measureCtx = document.createElement('canvas').getContext('2d')!
    }
    MenuButton.measureCtx.font = `${base}px "Lilita One", "Arial Black", sans-serif`
    const wpx = MenuButton.measureCtx.measureText(spec.label).width
    const labelSize = wpx <= avail ? base : Math.max(13, Math.floor((base * avail) / wpx))
    this.label = hudText(scene, 0, 0, spec.label, 1, {
      color: '#ffffff',
      size: labelSize,
      stroke: 3,
      origin: [0.5, 0.5],
      shadow: false,
    })
    this.labelBaseY = h * 0.1
    this.label.setPosition(w * 0.08 + this.charSize * 0.18, this.labelBaseY)
    this.c.add(this.label)
  }

  /** Body paint: shadow, darker extrusion slab, wobbly silhouette, sheen. */
  private paintBody(fill: number): void {
    const g = this.body
    const { w, h } = this.spec
    const seed = specSeed(this.spec.label, w, h)
    const r = Math.min(18, h * 0.32)
    const amp = Math.min(4.2, Math.max(2, h * 0.055))
    const pts = doodleSilhouette(w, h, r, seed, amp).map((p) => new Phaser.Math.Vector2(p.x, p.y))
    const drop = Math.max(5, h * 0.09)
    const extrude = Math.max(3.5, h * 0.06)
    const inkW = Math.max(3.2, Math.min(6.5, w * 0.045))
    const v = (dy: number): Phaser.Math.Vector2[] =>
      pts.map((p) => new Phaser.Math.Vector2(p.x, p.y + dy))
    g.clear()
    g.fillStyle(0x000000, 0.3)
    g.fillPoints(v(drop + 2.5), true)
    g.fillStyle(darkenFill(fill, 0.58), 1)
    g.fillPoints(v(extrude), true)
    g.lineStyle(inkW, 0x111111, 1)
    g.strokePoints(v(extrude), true, true)
    g.fillStyle(fill, 1)
    g.fillPoints(v(0), true)
    g.lineStyle(inkW, 0x111111, 1)
    g.strokePoints(v(0), true, true)
    // Top sheen — cartoon gloss.
    g.fillStyle(0xffffff, 0.18)
    g.fillEllipse(-w * 0.16, -h * 0.3, w * 0.46, h * 0.15)
  }

  /** Hover edge — called by the scene's hit rects. */
  setHover(on: boolean): void {
    if (on && !this.hovered) {
      this.hop = 1
      this.sweepGlint()
    }
    this.hovered = on
  }

  /** Shine sweep: the glint dashes across the pill once per hover. */
  private sweepGlint(): void {
    const w = this.spec.w
    this.glint.setAlpha(0)
    this.scene.tweens.killTweensOf(this.glint)
    this.glint.x = -w * 0.42
    this.scene.tweens.add({
      targets: this.glint,
      x: w * 0.42,
      alpha: { from: 0.55, to: 0 },
      duration: 420,
      ease: 'Cubic.easeOut',
    })
  }

  /** Press edge — squash impulse + one-shot ring/confetti FX. */
  setPress(on: boolean): void {
    if (on) {
      this.pressK = 1
      this.spawnPressFx()
    }
  }

  /** Ink ring + tier-colored confetti burst, both inside the container so
   * a menu rebuild destroys them with the button. */
  private spawnPressFx(): void {
    const { w, h, tier } = this.spec
    const color = getTier(tier)!.color
    if (this.fxRing) this.fxRing.destroy()
    this.fxRing = this.scene.add.circle(0, 0, Math.max(w, h) * 0.4, 0xffffff, 0)
    this.fxRing.setStrokeStyle(4, 0x111111, 1)
    this.c.add(this.fxRing)
    this.scene.tweens.add({
      targets: this.fxRing,
      scale: 1.45,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.fxRing?.destroy()
        this.fxRing = null
      },
    })
    for (const f of this.fxConfetti) f.s.destroy()
    this.fxConfetti = []
    const n = 10
    for (let i = 0; i < n; i++) {
      const s = this.scene.add.rectangle(0, 0, 5, 8, i % 2 ? color : 0xffffff)
      this.c.add(s)
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6
      this.fxConfetti.push({
        s,
        vx: Math.cos(a) * (90 + Math.random() * 80),
        vy: Math.sin(a) * (70 + Math.random() * 60) - 140,
        vr: (Math.random() - 0.5) * 14,
      })
    }
    this.fxT = 0
  }

  /**
   * Per-frame integration — called from the scene's update().
   * `t` seconds since boot (idle phases), `timeMs` raw game time
   * (expressionAt's clock), `dtMs` frame delta.
   */
  refresh(t: number, timeMs: number, dtMs: number, gaze: { x: number; y: number }): void {
    const { h, seed, primary } = this.spec
    const k = Math.min(1, dtMs / 1000)

    // Springs: hover rises fast / eases back, press impulse decays.
    this.hoverK += ((this.hovered ? 1 : 0) - this.hoverK) * Math.min(1, k * 14)
    this.pressK = Math.max(0, this.pressK - k * 8)
    if (this.entered) this.entrance = Math.min(1, this.entrance + k * 3.2)

    // Composed scale: entrance overshoot × breath × PLAY pulse × hover × press.
    const phase = (seed % 628) / 100
    const breath = 1 + Math.sin(t * 1.7 + phase) * 0.012
    const pulse = primary ? 1 + Math.sin(t * 2.6) * 0.02 + 0.02 : 1
    const hoverS = 1 + this.hoverK * 0.055
    const pressS = 1 - this.pressK * 0.07
    const ent = this.entered
      ? 1 + Math.sin(Math.min(1, this.entrance) * Math.PI) * 0.18 * (1 - this.entrance)
      : 0.001
    this.c.setScale(breath * pulse * hoverS * pressS * ent)
    this.c.setY(this.spec.y - this.hoverK * 4)
    this.c.setAlpha(this.entered ? 1 : 0)

    // Character: hover hop (spring decay), tilt, blink cycle.
    this.hop = Math.max(0, this.hop - k * 2.1)
    const hopY = Math.sin((1 - this.hop) * Math.PI) * h * 0.16 * this.hop
    this.charImg.setY(-h * 0.14 - hopY)
    this.charImg.setScale((1 + this.hoverK * 0.12) * (1 + Math.sin(t * 3.1 + phase) * 0.015))
    this.charImg.setRotation(Math.sin(t * 1.3 + (seed % 7)) * 0.05)
    this.blinkT -= dtMs
    if (this.blinkT <= 0) {
      this.blinkClosed = !this.blinkClosed
      this.blinkT = this.blinkClosed ? 130 : 2000 + Math.random() * 2800
    }
    this.drawChar(timeMs, gaze)

    // Label bob, out of phase with the pill breath.
    this.label.setY(this.labelBaseY + Math.sin(t * 2.1 + phase * 0.7) * 1.2)

    // Under-glow tracks hover + the PLAY pulse.
    this.glow.setAlpha(
      Math.min(0.5, this.hoverK * 0.26 + (primary ? Math.sin(t * 2.6) * 0.06 + 0.08 : 0)),
    )

    // Confetti physics (one-shot).
    if (this.fxT >= 0) {
      this.fxT += k
      for (const f of this.fxConfetti) {
        f.vy += 640 * k
        f.s.x += f.vx * k
        f.s.y += f.vy * k
        f.s.rotation += f.vr * k
        f.s.setAlpha(Math.max(0, 1 - this.fxT * 1.6))
      }
      if (this.fxT > 0.7) {
        for (const f of this.fxConfetti) f.s.destroy()
        this.fxConfetti = []
        this.fxT = -1
      }
    }
  }

  /** Entrance pop with overshoot (the caller staggers the delays). */
  enter(delay: number): void {
    if (this.entered) return
    this.entered = true
    this.entrance = 0
    this.c.setAlpha(0)
    this.scene.tweens.add({
      targets: this.c,
      alpha: 1,
      duration: 120,
      delay,
    })
    this.scene.tweens.add({
      targets: this,
      entrance: 1,
      duration: 460,
      delay,
      ease: 'Back.easeOut',
      easeParams: [1.7],
    })
  }

  /** Skip the pop (resize rebuild mid-session): fully entered, no tween. */
  settle(): void {
    this.entered = true
    this.entrance = 1
    this.c.setAlpha(1)
    this.scene.tweens.killTweensOf(this)
  }

  /** Repaint the character canvas: the live ball, 1:1 gameplay pipeline. */
  private drawChar(timeMs: number, gaze: { x: number; y: number }): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cw = this.charCanvas.width / dpr
    const ch = this.charCanvas.height / dpr
    this.charCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.charCtx.clearRect(0, 0, cw, ch)
    const g = new G2D(this.charCtx)
    const r = (Math.min(cw, ch) / 2) * 0.8
    const cy = ch / 2 + 2
    const poly = restContour(this.look, r, cw / 2, cy, 24)
    const tier = getTier(this.spec.tier)
    if (!tier) return
    const color = this.spec.tier === 8 ? cycleColor(Date.now()) : tier.color
    g.fillStyle(color, 1)
    g.fillPoints(poly, true)
    g.lineStyle(ballOutlineWidth(r), INK, 1)
    g.strokePoints(poly, true, true)
    if (this.spec.tier === 9 || this.spec.tier === 10) {
      // Theme balls paint their own face (part of the design).
      drawCollectibleBall(
        g as unknown as Phaser.GameObjects.Graphics,
        cw / 2,
        cy,
        r,
        this.spec.tier,
        variantIdFor(this.spec.tier),
        poly,
        0,
        undefined,
        this.spec.seed,
      )
      return
    }
    const faceLook = this.blinkClosed ? { ...this.look, eyeH: this.look.eyeH * 0.12 } : this.look
    const expr: BallExpression =
      this.hoverK > 0.5 ? 'grin' : expressionAt(this.spec.seed, timeMs)
    drawBallFace(g as unknown as Phaser.GameObjects.Graphics, faceLook, { x: cw / 2, y: cy }, r, 1, {
      gaze,
      expr,
    })
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.c)
    this.scene.tweens.killTweensOf(this.glint)
    this.scene.tweens.killTweensOf(this)
    if (this.scene.textures.exists(this.charKey)) this.scene.textures.remove(this.charKey)
    this.c.destroy()
  }
}

// ---------------------------------------------------------------------------
// Canvas-2D adapter — the same Phaser-Graphics subset trick the background
// theme painter and the old DOM layer used, so drawBallFace paints straight
// into a small canvas.
// ---------------------------------------------------------------------------

class G2D {
  constructor(private ctx: CanvasRenderingContext2D) {}
  clear(): void {}
  fillStyle(color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha
    this.ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  }
  lineStyle(width: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha
    this.ctx.lineWidth = width
    this.ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0')
    this.ctx.lineJoin = 'round'
    this.ctx.lineCap = 'round'
  }
  fillCircle(x: number, y: number, r: number): void {
    this.ctx.beginPath()
    this.ctx.arc(x, y, r, 0, Math.PI * 2)
    this.ctx.fill()
  }
  fillEllipse(x: number, y: number, w: number, h: number): void {
    this.ctx.beginPath()
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2)
    this.ctx.fill()
  }
  strokeEllipse(x: number, y: number, w: number, h: number): void {
    this.ctx.beginPath()
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2)
    this.ctx.stroke()
  }
  beginPath(): void {
    this.ctx.beginPath()
  }
  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y)
  }
  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y)
  }
  closePath(): void {
    this.ctx.closePath()
  }
  fillPath(): void {
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }
  strokePath(): void {
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }
  lineBetween(x1: number, y1: number, x2: number, y2: number): void {
    this.ctx.beginPath()
    this.ctx.moveTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }
  strokePoints(pts: Array<{ x: number; y: number }>, closeShape: boolean, _closePath: boolean): void {
    void _closePath
    if (pts.length < 2) return
    this.ctx.beginPath()
    this.ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i]!.x, pts[i]!.y)
    if (closeShape) this.ctx.closePath()
    this.ctx.stroke()
    this.ctx.globalAlpha = 1
  }
  fillPoints(pts: Array<{ x: number; y: number }>, closeShape: boolean): void {
    if (pts.length < 2) return
    this.ctx.beginPath()
    this.ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i]!.x, pts[i]!.y)
    if (closeShape) this.ctx.closePath()
    this.ctx.fill()
    this.ctx.globalAlpha = 1
  }
}
