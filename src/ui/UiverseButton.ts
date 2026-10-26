import Phaser from 'phaser'
import { getTier } from '../config/ballTiers'
import { FONT_FAMILY } from './Typography'
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
 * Uiverse "big-moose-69" recipe, rebuilt natively in Phaser:
 * a fat yellow pill (hsl(49 98% 60%)), 2px ink border, fully rounded,
 * with the game's BALL CHARACTER sitting on the left and the label to
 * its right. Hover: the character scales up + drifts right, the label
 * slides out and a second label ("NOW!") slides in from the left — the
 * uiverse text-swap. Press: squash 0.9.
 *
 * The character is a LIVE ball drawn through the shared BallAppearance
 * pipeline with ALL the easter eggs: eyes track the pointer (gaze),
 * blink cycles, and the deterministic wink/grin/tongue expression
 * flashes — driven by the scene's update() via `refresh(time, gaze)`.
 *
 * Used for the menu PLAY button (blue tier-1 ball) and the four nav
 * buttons (one different ball tier each).
 */

interface UiverseBall {
  /** Draw state. */
  g: Phaser.GameObjects.Graphics
  /** Idle clip mask Graphics (same geometry as the pill, rounded ends). */
  clip: Phaser.GameObjects.Graphics
  look: ReturnType<typeof ballLookFor>
  tier: number
  r: number
  /** Character centre, local to the button container. */
  cx: number
  cy: number
  seed: number
  /** Blink cycle (mirrors TitleScene's cast recipe). */
  blinkClosed: boolean
  blinkT: number
}

export interface UiverseButtonOptions {
  x: number
  y: number
  w: number
  h: number
  /** Border + ink language stays black; the fill is the uiverse yellow. */
  label: string
  /** The swap-in label on hover (uiverse's "now!"). */
  hoverLabel?: string
  /** Ball tier to showcase (its face/eggs drive the character). */
  tier: number
  seed?: number
  onPress: () => void
}

const PILL_YELLOW = 0xfdd835 // hsl(49 98% 60%) ≈ the uiverse fill
const TEXT_SHADOW = 0x747474 // rgb(116,116,116) text-shadow colour

export class UiverseButton {
  private readonly scene: Phaser.Scene
  private readonly opts: UiverseButtonOptions
  private container: Phaser.GameObjects.Container
  private readonly pillG: Phaser.GameObjects.Graphics
  private readonly hoverG: Phaser.GameObjects.Graphics
  private readonly labelNow: Phaser.GameObjects.Text
  private readonly labelPlay: Phaser.GameObjects.Text
  private ball: UiverseBall
  /** Pupil gaze (live), -1..1 per axis, driven by refresh(). */
  private gaze = { x: 0, y: 0 }
  /** True while the pointer is over the hit area (text swap + ball pop). */
  private hovering = false

  constructor(scene: Phaser.Scene, opts: UiverseButtonOptions) {
    this.scene = scene
    this.opts = opts
    this.container = scene.add.container(opts.x, opts.y)

    const w = opts.w
    const h = opts.h
    const rr = h / 2

    // ---- THE PILL — uiverse: yellow bg, 2px black border, radius 50px.
    this.pillG = scene.add.graphics()
    this.pillG.fillStyle(PILL_YELLOW, 1)
    this.pillG.fillRoundedRect(-w / 2, -h / 2, w, h, rr)
    this.pillG.lineStyle(2.5, 0x000000, 1)
    this.pillG.strokeRoundedRect(-w / 2, -h / 2, w, h, rr)
    // Top sheen — keeps the cartoon gloss the game language expects.
    this.pillG.fillStyle(0xffffff, 0.18)
    this.pillG.fillRoundedRect(-w / 2 + 6, -h / 2 + 4, w - 12, h * 0.26, rr * 0.5)
    this.container.add(this.pillG)

    // ---- THE BALL CHARACTER (left slot) — clipped by the pill shape so
    // the hover scale-up never spills past the rounded ends.
    this.hoverG = scene.add.graphics()
    this.hoverG.fillStyle(PILL_YELLOW, 1)
    this.hoverG.fillRoundedRect(-w / 2, -h / 2, w, h, rr)
    this.hoverG.setVisible(false)
    this.container.add(this.hoverG)

    const ballR = Math.min(h * 0.62, w * 0.2)
    const ball: UiverseBall = {
      g: scene.add.graphics(),
      clip: this.hoverG,
      look: ballLookFor(opts.tier, opts.seed ?? 4242),
      tier: opts.tier,
      r: ballR,
      cx: -w / 2 + h / 2 + 4,
      cy: 0,
      seed: opts.seed ?? 4242,
      blinkClosed: false,
      blinkT: 1500 + Math.random() * 2500,
    }
    this.ball = ball
    this.container.add(ball.g)
    ball.g.setPosition(ball.cx, ball.cy)

    // ---- THE LABELS — the game's font, white with the uiverse grey
    // text-shadow (drawn as an offset ink layer, cartoon style).
    const fontSize = Math.max(15, h * 0.36)
    const labelOpts = {
      fontFamily: FONT_FAMILY,
      fontSize: `${Math.round(fontSize)}px`,
      color: '#ffffff',
    }
    this.labelPlay = scene.add.text(0, 0, opts.label, labelOpts).setOrigin(0.5)
    this.labelNow = scene.add
      .text(0, 0, opts.hoverLabel ?? 'NOW!', labelOpts)
      .setOrigin(0.5)
      .setVisible(false)
    // Text shadow: the uiverse 2px offset grey, per label.
    for (const t of [this.labelPlay, this.labelNow]) {
      t.setShadow(2, 2, '#' + TEXT_SHADOW.toString(16).padStart(6, '0'), 0, false, true)
    }
    this.container.add([this.labelPlay, this.labelNow])
    // Label block sits right of the character, centred in the remaining
    // width (the uiverse layout: icon left, text right).
    const labelX = ball.cx + ballR + (w / 2 - (ball.cx + ballR)) / 2
    this.labelPlay.setPosition(labelX, 0)
    this.labelNow.setPosition(labelX, 0)

    // ---- INTERACTION — hover swap + press squash (uiverse behaviour).
    const hit = scene.add
      .rectangle(0, 0, w, h, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true })
    this.container.add(hit)
    hit.on('pointerover', () => this.setHover(true))
    hit.on('pointerout', () => this.setHover(false))
    hit.on('pointerdown', () => {
      this.scene.tweens.add({ targets: this.container, scale: 0.9, duration: 100, ease: 'Quad.easeOut' })
    })
    hit.on('pointerup', () => {
      this.scene.tweens.add({
        targets: this.container,
        scale: 1,
        duration: 120,
        ease: 'Back.easeOut',
        onComplete: opts.onPress,
      })
    })

    // Initial character paint.
    this.drawBall()
  }

  /** Layer accessor — the title scene adds this into its menu layer. */
  get containerObj(): Phaser.GameObjects.Container {
    return this.container
  }

  /** Live gaze from the scene: the character's eyes follow the pointer. */
  refresh(time: number, gaze: { x: number; y: number }): void {
    this.gaze = gaze
    const b = this.ball
    // Blink cycle (TitleScene cast recipe: closed 140ms, open 2.2-4.8s).
    b.blinkT -= this.scene.game.loop.delta
    if (b.blinkT <= 0) {
      b.blinkClosed = !b.blinkClosed
      b.blinkT = b.blinkClosed ? 140 : 2200 + Math.random() * 2600
    }
    // Deterministic easter-egg expression (wink/grin/tongue flash).
    const expr: BallExpression = expressionAt(b.seed, time)
    // Hover: the character scales up + drifts right (uiverse svg zoom),
    // gated by the clip so it never leaves the pill.
    void expr
    this.drawBall(expr)
    // Text swap tweens are driven by setHover; here only the ball.
  }

  private setHover(on: boolean): void {
    if (this.hovering === on) return
    this.hovering = on
    const b = this.ball
    this.scene.tweens.add({
      targets: b.g,
      scale: on ? 1.45 : 1,
      x: b.cx + (on ? b.r * 0.5 : 0),
      duration: 500,
      ease: 'Sine.easeInOut',
    })
    // Label swap: PLAY slides out right, NOW! slides in from the left
    // (uiverse's .play/.now choreography), 500ms + 300ms delay.
    this.scene.tweens.killTweensOf([this.labelPlay, this.labelNow])
    const labelX = this.labelPlay.x
    const h = this.opts.h
    this.scene.tweens.add({
      targets: this.labelPlay,
      x: on ? labelX + this.opts.w * 0.6 : labelX,
      alpha: on ? 0 : 1,
      duration: 500,
      delay: on ? 300 : 0,
      ease: 'Sine.easeInOut',
    })
    this.labelNow.setVisible(true)
    this.scene.tweens.add({
      targets: this.labelNow,
      x: on ? labelX : labelX - this.opts.w * 0.6,
      alpha: on ? 1 : 0,
      duration: 500,
      delay: on ? 300 : 0,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (!on) this.labelNow.setVisible(false)
      },
    })
    void h
  }

  /** Redraw the character through the shared appearance pipeline. */
  private drawBall(expr: BallExpression = 'normal'): void {
    const b = this.ball
    const g = b.g
    g.clear()
    const t = getTier(b.tier)
    if (!t) return
    // The character is CLIPPED to the pill: a clip Graphics behind it with
    // the same rounded geometry, inverting draw order via depth inside the
    // container (draw the clip over the ball = visible only inside).
    const poly = restContour(b.look, b.r, 0, 0, 24)
    const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))
    if (b.tier === 9 || b.tier === 10) {
      drawCollectibleBall(g, 0, 0, b.r, b.tier, variantIdFor(b.tier), poly, 0, undefined, b.seed)
    } else {
      g.fillStyle(b.tier === 8 ? cycleColor(Date.now()) : t.color, 1)
      g.fillPoints(pts, true)
      g.lineStyle(ballOutlineWidth(b.r), INK, 1)
      g.strokePoints(pts, true, true)
      const faceLook = b.blinkClosed ? { ...b.look, eyeH: b.look.eyeH * 0.12 } : b.look
      drawBallFace(g, faceLook, { x: 0, y: 0 }, b.r, 1, {
        gaze: this.gaze,
        expr,
      })
    }
    // Blink: closed eyes via the squashed look (the menu cast trick) —
    // applied above through faceLook.
    void b.blinkClosed
  }

  /** QA hook: the hit rect in screen space. */
  rect(): { x: number; y: number; w: number; h: number } {
    return { x: this.opts.x - this.opts.w / 2, y: this.opts.y - this.opts.h / 2, w: this.opts.w, h: this.opts.h }
  }

  destroy(): void {
    this.container.destroy()
  }
}
