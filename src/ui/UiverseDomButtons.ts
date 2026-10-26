import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import {
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  restContour,
  INK,
  drawCollectibleBall,
  expressionAt,
  type BallExpression,
} from '../game/rendering/BallAppearance'
import { cycleColor } from '../game/rendering/rgbCycle'
import { variantIdFor } from '../game/state/runVariant'

/**
 * The uiverse "big-moose-69" button as a REAL DOM element — 1:1 with the
 * original CSS (yellow pill, 2px black border, radius 50px, hover
 * text-swap, character zoom, :active squash) — overlaid above the Phaser
 * canvas, positioned to track the menu's layout rects.
 *
 * The Among-Us character slot is a small <canvas> that the game draws its
 * OWN ball character into every frame (shared BallAppearance pipeline):
 * pupils track the pointer, blink cycles, wink/grin/tongue flashes —
 * ALL the easter eggs, same look as gameplay.
 *
 * The DOM layer is click-transparent (`pointer-events: none`): the
 * Phaser-side hit rects remain the authoritative input surface.
 */

interface DomButton {
  root: HTMLButtonElement
  charCanvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  labelPlay: HTMLSpanElement
  labelNow: HTMLSpanElement
  cx: number
  cy: number
  r: number
  tier: number
  seed: number
  look: ReturnType<typeof ballLookFor>
  blinkClosed: boolean
  blinkT: number
}

export interface UiverseSpec {
  x: number
  y: number
  w: number
  h: number
  label: string
  hoverLabel: string
  tier: number
  seed: number
}

/**
 * Canvas-2D adapter implementing the Phaser-Graphics subset that
 * `drawBallFace` (and the contour painter) use — the same trick the
 * background theme's G2D adapter uses to bake theme art. The adapter
 * converts Phaser semantics (fillEllipse takes w/h, strokePoints walk a
 * point list, colours are 0xRRGGBB ints) to canvas 2D calls.
 */
class Gfx2D {
  constructor(private ctx: CanvasRenderingContext2D) {}
  clear(): void {
    // Caller clears the canvas explicitly (dpr transform handled outside).
  }
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
  strokePoints(pts: Array<{ x: number; y: number }>, closeShape: boolean, closePath: boolean): void {
    void closePath
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

export class UiverseDomButtons {
  private layer: HTMLDivElement
  private buttons: DomButton[] = []
  private readonly scene: Phaser.Scene
  private visible = false
  private specs: UiverseSpec[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.layer = document.createElement('div')
    this.layer.className = 'uiverse-btn-layer'
    this.layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;'
    const parent = scene.game.canvas.parentElement ?? document.body
    parent.appendChild(this.layer)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  /** (Re)build the DOM buttons from the menu layout. Idempotent. */
  build(specs: UiverseSpec[]): void {
    this.clear()
    this.specs = specs
    for (const s of specs) {
      const root = document.createElement('button')
      root.type = 'button'
      root.className = 'uiverse-mooses'

      // The character canvas — a small icon slot at the pill's left edge:
      // 72% of the pill height (capped at 30% of its width), with the ball
      // radius at 72% of the slot so wobble spikes + ink outline stay inside.
      const slotPad = Math.round(s.h * 0.12)
      const charSize = Math.round(Math.min(s.h * 0.72, s.w * 0.3))

      root.style.cssText = `position:absolute;left:${s.x - s.w / 2}px;top:${s.y - s.h / 2}px;width:${s.w}px;height:${s.h}px;padding-left:${slotPad}px;--ball-slot:${slotPad + charSize + 10}px;--char-size:${charSize}px;`

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const charCanvas = document.createElement('canvas')
      charCanvas.width = charSize * dpr
      charCanvas.height = charSize * dpr
      charCanvas.style.width = charSize + 'px'
      charCanvas.style.height = charSize + 'px'
      const ctx = charCanvas.getContext('2d')!
      ctx.scale(dpr, dpr)

      const labelPlay = document.createElement('span')
      labelPlay.className = 'uiverse-play'
      labelPlay.textContent = s.label

      const labelNow = document.createElement('span')
      labelNow.className = 'uiverse-now'
      labelNow.textContent = s.hoverLabel

      // Auto-fit the label into the region right of the ball slot (the
      // uiverse 17px base, shrinking only when a long label would
      // otherwise overflow the pill). Re-fitted once webfonts load, since
      // the first measurement may fall back to Arial Black.
      const labelW = s.w - 24 - slotPad - charSize
      const fit = (): void => {
        const w17 = UiverseDomButtons.textWidth(s.label, 17)
        const fs = w17 <= labelW ? 17 : Math.max(12, Math.floor((17 * labelW) / w17))
        labelPlay.style.fontSize = fs + 'px'
        labelNow.style.fontSize = fs + 'px'
      }
      fit()
      if (document.fonts) void document.fonts.ready.then(fit)

      // Labels first (under), canvas last (over) — the icon slot never
      // occludes the text.
      root.appendChild(labelNow)
      root.appendChild(labelPlay)
      root.appendChild(charCanvas)
      this.layer.appendChild(root)

      this.buttons.push({
        root,
        charCanvas,
        ctx,
        labelPlay,
        labelNow,
        cx: s.x,
        cy: s.y,
        r: (charSize / 2) * 0.72,
        tier: s.tier,
        seed: s.seed,
        look: ballLookFor(s.tier, s.seed),
        blinkClosed: false,
        blinkT: 1200 + Math.random() * 2400,
      })
    }
  }

  /** Show/hide with the menu (the layer is inert when hidden). */
  setVisible(v: boolean): void {
    this.visible = v
    this.layer.style.display = v ? 'block' : 'none'
  }

  /** Hover choreography driver — the Phaser hit rects call this (the DOM
   * layer is click-transparent, so CSS :hover never fires). */
  setHover(index: number, on: boolean): void {
    this.buttons[index]?.root.classList.toggle('uiverse-hover', on)
  }

  /**
   * Per-frame: track the Phaser layout rects, animate blink + easter-egg
   * expressions, repaint each character canvas.
   */
  refresh(time: number, specs: UiverseSpec[], gaze: { x: number; y: number }): void {
    if (!this.visible || !this.buttons.length) return
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i]!
      const s = specs[i]
      if (s) {
        b.root.style.left = s.x - s.w / 2 + 'px'
        b.root.style.top = s.y - s.h / 2 + 'px'
      }
      // Blink cycle (the menu cast recipe).
      b.blinkT -= this.scene.game.loop.delta
      if (b.blinkT <= 0) {
        b.blinkClosed = !b.blinkClosed
        b.blinkT = b.blinkClosed ? 140 : 2200 + Math.random() * 2600
      }
      this.drawChar(b, time, gaze)
    }
  }

  currentSpecs(): UiverseSpec[] {
    return this.specs
  }

  /** Measured text width at the uiverse label style (letter-spacing 1px
   * included) — used to auto-fit labels into the region right of the
   * ball slot. */
  private static measureCtx: CanvasRenderingContext2D | null = null
  private static textWidth(text: string, px: number): number {
    if (!UiverseDomButtons.measureCtx) {
      UiverseDomButtons.measureCtx = document.createElement('canvas').getContext('2d')!
    }
    const ctx = UiverseDomButtons.measureCtx!
    ctx.font = `600 ${px}px "Lilita One", "Arial Black", sans-serif`
    return ctx.measureText(text).width + text.length
  }

  /** Paint one character canvas: body, ink outline, face — 1:1 gameplay. */
  private drawChar(b: DomButton, time: number, gaze: { x: number; y: number }): void {
    const ctx = b.ctx
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, b.charCanvas.width / dpr, b.charCanvas.height / dpr)
    const g = new Gfx2D(ctx)
    const cx = b.charCanvas.width / dpr / 2
    const cy = b.charCanvas.height / dpr / 2
    const poly = restContour(b.look, b.r, cx, cy, 24)
    const pts = poly.map((p) => ({ x: p.x, y: p.y }))
    const t = getTier(b.tier)
    if (!t) return
    // Body (tier 8 cycles white-cycle; others the tier colour).
    const color = b.tier === 8 ? cycleColor(Date.now()) : t.color
    g.fillStyle(color, 1)
    g.fillPoints(pts, true)
    g.lineStyle(ballOutlineWidth(b.r), INK, 1)
    g.strokePoints(pts, true, true)
    if (b.tier === 9 || b.tier === 10) {
      // Theme balls paint their own face (part of the design).
      drawCollectibleBall(g as unknown as Phaser.GameObjects.Graphics, cx, cy, b.r, b.tier, variantIdFor(b.tier), poly, 0, undefined, b.seed)
    } else {
      const faceLook = b.blinkClosed ? { ...b.look, eyeH: b.look.eyeH * 0.12 } : b.look
      const expr: BallExpression = expressionAt(b.seed, time)
      drawBallFace(g as unknown as Phaser.GameObjects.Graphics, faceLook, { x: cx, y: cy }, b.r, 1, { gaze, expr })
    }
  }

  /** Remove all buttons + the layer. */
  destroy(): void {
    this.clear()
    this.layer.remove()
  }

  private clear(): void {
    this.buttons = []
    this.layer.replaceChildren()
  }
}
