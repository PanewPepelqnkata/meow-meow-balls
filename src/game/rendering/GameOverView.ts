import Phaser from 'phaser'
import { drawLucide } from '../../ui/LucideIcon'
import { FONT_FAMILY } from '../../ui/Typography'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK } from '../rendering/BallAppearance'
import { pressFx } from '../../ui/PressFx'
import { GAME_OVER_SEQUENCE as SEQ } from '../../config/gameOverSequence'

/**
 * GAME OVER PANEL (redesigned) — a chunky cartoon card in the Ball Rush
 * visual language: rounded cream panel with thick ink outline and playful
 * shadow, a doomed-looking slime character on top, big animated score
 * count-up, NEW BEST! celebration, and two chunky buttons (GO AGAIN /
 * MAIN MENU). The gameplay stays visible behind a soft dim.
 *
 * Presentation only — all wiring (restart/menu) comes in through the
 * constructor callbacks from UIScene; timings from gameOverSequence.ts.
 */

/** Colors shared with the container/ball palette. */
const PANEL_FILL = 0xfff8ec
const PANEL_INK = 0x111111
const TITLE_COLOR = '#f44336'
const SCORE_COLOR = '#2d74c9'
const NEW_BEST_COLOR = '#ffb300'


export class GameOverView {
  private objs: Phaser.GameObjects.GameObject[] = []
  /** The score count-up tween — stopped in hide() so it never pokes a
   * destroyed text. */
  private countTween: Phaser.Tweens.Tween | null = null
  /** The character's blink/eye tween — same lifecycle. */
  private charTweens: Phaser.Tweens.Tween[] = []
  /** Viewport-space center of the GO AGAIN button (QA hook). */
  private lastButtonCenter = { x: 0, y: 0 }
  private readonly scene: Phaser.Scene
  private readonly onRestart: () => void
  private readonly onMenu: () => void

  constructor(scene: Phaser.Scene, onRestart: () => void, onMenu: () => void) {
    this.scene = scene
    this.onRestart = onRestart
    this.onMenu = onMenu
  }

  get visible(): boolean {
    return this.objs.length > 0
  }

  /** Viewport-space center of the GO AGAIN button (QA/automation hook). */
  get buttonCenter(): { x: number; y: number } {
    return this.lastButtonCenter
  }

  /**
   * Show the panel. `score` counts up; `isNewBest` switches on the
   * NEW BEST! celebration (banner + glow + confetti).
   */
  show(score: number, best: number, isNewBest: boolean): void {
    this.hide()
    const scene = this.scene
    // HiDPI: the UIScene camera zooms by displayScale and frames the CSS-px
    // region, so the panel must be laid out in CSS px (buffer / scale).
    const z = scene.game.scale.displayScale.x || 1
    const vw = scene.scale.width / z
    const vh = scene.scale.height / z
    const cx = vw / 2
    const cy = vh / 2
    // Responsive scale: the panel must fit BOTH axes with margin — on short
    // viewports (mobile landscape / squat windows) the scale shrinks so the
    // stacked layout never clips or overlaps.
    const scale = Math.max(0.5, Math.min(1.2, Math.min(vw / 760, (vh - 60) / 900)))

    // Soft dim — gameplay stays visible behind it.
    const dim = scene.add.rectangle(cx, vh / 2, vw, vh, 0x1a1a2e, 0.55).setDepth(60)
    dim.setAlpha(0)
    this.objs.push(dim)
    scene.tweens.add({ targets: dim, alpha: 1, duration: 240, ease: 'Quad.easeOut' })

    // ---- Panel: one container so the spring entrance scales everything.
    // Height = the stacked content (title 74 + ball 2·52+18 + score 124 +
    // best 64 + buttons 2·58+22+34 pad ≈ 640) + top/bottom breathing room.
    const panel = scene.add.container(cx, cy).setDepth(61)
    this.objs.push(panel)
    const pw = 470 * scale
    const ph = 660 * scale
    const radius = 34 * scale

    // Playful drop shadow (offset ink slab behind the panel).
    const shadowG = scene.add.graphics()
    shadowG.fillStyle(PANEL_INK, 0.35)
    shadowG.fillRoundedRect(-pw / 2 + 10 * scale, -ph / 2 + 16 * scale, pw, ph, radius)
    panel.add(shadowG)

    // Body + outline + inner rim highlight.
    const bodyG = scene.add.graphics()
    bodyG.fillStyle(PANEL_FILL, 1)
    bodyG.fillRoundedRect(-pw / 2, -ph / 2, pw, ph, radius)
    bodyG.lineStyle(9 * scale, PANEL_INK, 1)
    bodyG.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, radius)
    // Inner top highlight (a soft white rounded band — candy sheen).
    bodyG.fillStyle(0xffffff, 0.5)
    bodyG.fillRoundedRect(-pw / 2 + 14 * scale, -ph / 2 + 12 * scale, pw - 28 * scale, 18 * scale, 9 * scale)
    panel.add(bodyG)

    // ---- LAYOUT: a single top-down row stack inside the panel. Every row
    // is placed by accumulating its height + gap, so nothing can overlap
    // at any scale — the panel height is the SUM of the rows, not the other
    // way around.
    //
    // GAME OVER (title)
    // ↓ terrified ball
    // ↓ SCORE label / big score / BEST
    // ↓ GO AGAIN / MAIN MENU (anchored bottom)
    const titleY = -ph / 2 + 64 * scale

    // Title with chunky two-tone lettering.
    const title = scene.add
      .text(0, titleY, 'GAME OVER', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(54 * scale)}px`,
        color: TITLE_COLOR,
        stroke: '#111111',
        strokeThickness: Math.round(9 * scale),
      })
      .setOrigin(0.5)
    title.setShadow(0, 6 * scale, 'rgba(0,0,0,0.35)', 2, true, true)
    panel.add(title)
    // Title punch: drop in with a bounce.
    title.setScale(0)
    this.charTweens.push(
      scene.tweens.add({
        targets: title,
        scale: 1,
        duration: SEQ.panelSpringMs * 0.7,
        delay: SEQ.panelSpringMs * 0.35,
        ease: 'Back.easeOut',
      }),
    )

    // Terrified character: a real slime ball with a panicked face.
    const charSeed = 20260213
    const look = ballLookFor(1, charSeed)
    const charR = 46 * scale
    const charY = titleY + 38 * scale + charR
    const charG = scene.add.graphics()
    const drawChar = (): void => {
      charG.clear()
      const poly = restContour(look, charR, 0, 0, 40)
      charG.fillStyle(0x4fc3f7, 1)
      charG.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      charG.lineStyle(ballOutlineWidth(charR), INK, 1)
      charG.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(charG, look, { x: 0, y: 0 }, charR, 1, { panic: 0.85 })
    }
    drawChar()
    const charC = scene.add.container(0, charY, [charG])
    panel.add(charC)
    // Trembling: tiny position shake — the character never stopped panicking.
    this.charTweens.push(
      scene.tweens.add({
        targets: charC,
        x: { from: -2.2 * scale, to: 2.2 * scale },
        duration: 74,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    )

    // SCORE block: trophy icon + label, then the big counting number.
    // The label icon+text sit as one centered unit; the bright cyan color
    // replaces the old dark gray. Gaps are scale-relative and account for
    // the wobble contour (which bulges past charR at its widest) plus the
    // big score font's ascent — no ball/score collision at any scale.
    const scoreLabelY = charY + charR + 34 * scale
    const scoreLabelC = scene.add.container(0, scoreLabelY)
    panel.add(scoreLabelC)
    const scoreIcon = scene.add.graphics()
    drawLucide(scoreIcon, 'trophy', 0, 0, 24 * scale, 0x4fc3f7)
    scoreLabelC.add(scoreIcon)
    const scoreLabelT = scene.add
      .text(0, 0, 'SCORE', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(24 * scale)}px`,
        color: '#4fc3f7',
        stroke: '#111111',
        strokeThickness: Math.round(4 * scale),
      })
      .setOrigin(0, 0.5)
    scoreLabelC.add(scoreLabelT)
    // Center the icon+text unit: icon (24px) + gap (8px) + text width.
    const scoreUnitW = 24 * scale + 8 * scale + scoreLabelT.width
    scoreIcon.setPosition(-scoreUnitW / 2, 0)
    scoreLabelT.setPosition(-scoreUnitW / 2 + 24 * scale + 8 * scale, 0)
    // The number sits below its label by the label's half-height + half
    // the number's height (both scale-relative) — never a fixed offset.
    const scoreY = scoreLabelY + (18 + 38) * scale
    const scoreText = scene.add
      .text(0, scoreY, '0', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(58 * scale)}px`,
        color: SCORE_COLOR,
        stroke: '#111111',
        strokeThickness: Math.round(7 * scale),
      })
      .setOrigin(0.5)
    panel.add(scoreText)
    // A little number-pop pulse as the count runs.
    this.charTweens.push(
      scene.tweens.add({
        targets: scoreText,
        scale: { from: 1.06, to: 1 },
        duration: SEQ.scoreCountMs,
        ease: 'Cubic.easeOut',
      }),
    )

    // BEST row below the score — medal icon + bright gold text as one
    // centered unit. With NEW BEST!, the banner sits BETWEEN the score
    // and the BEST row — the row shifts down so the banner never collides
    // with the big score number (the stack reflows as a whole).
    const bannerSpace = isNewBest ? 42 * scale : 0
    const bestY = scoreY + 56 * scale + bannerSpace
    const bestRowC = scene.add.container(0, bestY)
    panel.add(bestRowC)
    const bestIcon = scene.add.graphics()
    drawLucide(bestIcon, 'medal', 0, 0, 26 * scale, 0xffb300)
    bestRowC.add(bestIcon)
    const bestText = scene.add
      .text(0, 0, `BEST  ${best.toLocaleString()}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(28 * scale)}px`,
        color: NEW_BEST_COLOR,
        stroke: '#111111',
        strokeThickness: Math.round(4 * scale),
      })
      .setOrigin(0, 0.5)
    bestRowC.add(bestText)
    const bestUnitW = 26 * scale + 8 * scale + bestText.width
    bestIcon.setPosition(-bestUnitW / 2, 0)
    bestText.setPosition(-bestUnitW / 2 + 26 * scale + 8 * scale, 0)

    if (isNewBest) {
      const banner = scene.add
        .text(0, bestY - 44 * scale, '★ NEW BEST! ★', {
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(32 * scale)}px`,
          color: NEW_BEST_COLOR,
          stroke: '#111111',
          strokeThickness: Math.round(6 * scale),
        })
        .setOrigin(0.5)
      banner.setShadow(0, 0, NEW_BEST_COLOR, 12 * scale, true, true)
      panel.add(banner)
      banner.setScale(0)
      this.charTweens.push(
        scene.tweens.add({
          targets: banner,
          scale: 1,
          delay: SEQ.scoreCountMs + SEQ.scoreCountDelayMs,
          duration: 380,
          ease: 'Back.easeOut',
        }),
      )
      // Glow pulse.
      this.charTweens.push(
        scene.tweens.add({
          targets: banner,
          alpha: { from: 1, to: 0.72 },
          duration: 340,
          yoyo: true,
          repeat: 3,
          delay: SEQ.scoreCountMs + SEQ.scoreCountDelayMs + 400,
        }),
      )
      this.newBestConfetti(cx, cy - ph * 0.08, scale)
    }

    // ---- Score count-up (starts once the panel has landed).
    const counter = { val: 0 }
    this.countTween = scene.tweens.add({
      targets: counter,
      val: score,
      duration: SEQ.scoreCountMs,
      delay: SEQ.scoreCountDelayMs,
      ease: 'Cubic.easeOut',
      onUpdate: () => scoreText.setText(Math.round(counter.val).toLocaleString()),
    })

    // ---- Buttons: GO AGAIN + MAIN MENU — compact game-UI controls drawn
    // in-panel (panel-local coords, small Lucide-style icon beside the
    // label, thick ink outline, hover lift + press squash). Anchored BELOW
    // the BEST row with a consistent gap — statistics and buttons can
    // never collide because both stacks derive from the same rows.
    const bh = SEQ.buttons.height * scale
    const bw = SEQ.buttons.width * scale
    const btnGap = SEQ.buttons.gap * scale
    const buttonsTop = bestY + 58 * scale
    const buttonsY1 = buttonsTop
    const buttonsY2 = buttonsTop + bh + btnGap
    this.lastButtonCenter = { x: cx, y: cy + buttonsY1 }
    const mkCompactButton = (
      localY: number,
      fill: number,
      fillHover: number,
      label: string,
      icon: (g: Phaser.GameObjects.Graphics, s: number) => void,
      onPress: () => void,
    ): void => {
      const c = scene.add.container(0, localY)
      panel.add(c)
      // Shadow slab (offset ink, soft).
      const shadow = scene.add.graphics()
      shadow.fillStyle(PANEL_INK, 0.3)
      shadow.fillRoundedRect(-bw / 2 + 3 * scale, -bh / 2 + 5 * scale, bw, bh, SEQ.buttons.radius * scale)
      c.add(shadow)
      // Body + slab base (darker bottom edge — chunky but slim).
      const body = scene.add.graphics()
      const drawBody = (f: number): void => {
        body.clear()
        body.fillStyle(f, 1)
        body.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, SEQ.buttons.radius * scale)
        // Slim bottom extrusion.
        body.fillStyle(Phaser.Display.Color.IntegerToColor(f).darken(22).color, 1)
        body.fillRoundedRect(-bw / 2, bh / 2 - 7 * scale, bw, 7 * scale, { tl: 0, tr: 0, bl: SEQ.buttons.radius * scale, br: SEQ.buttons.radius * scale })
        body.lineStyle(4 * scale, PANEL_INK, 1)
        body.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, SEQ.buttons.radius * scale)
        // Refined highlight: thin top sheen.
        body.fillStyle(0xffffff, 0.25)
        body.fillRoundedRect(-bw / 2 + 7 * scale, -bh / 2 + 5 * scale, bw - 14 * scale, bh * 0.26, 6 * scale)
      }
      drawBody(fill)
      c.add(body)
      // Small icon beside the label (Lucide-style line icon): painted at
      // unit scale, then the whole Graphics scaled by the panel scale.
      const iconG = scene.add.graphics()
      icon(iconG, SEQ.buttons.iconSize)
      iconG.setScale(scale)
      iconG.setPosition(-bw / 2 + 30 * scale, 0)
      c.add(iconG)
      // Label centered in the remaining width (slight right shift for the
      // icon).
      const labelC = scene.add
        .text(14 * scale, 0, label, {
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(23 * scale)}px`,
          color: '#ffffff',
          stroke: '#111111',
          strokeThickness: Math.round(4 * scale),
        })
        .setOrigin(0.5)
      c.add(labelC)
      // Interactive hit area + hover lift + press squash.
      const hit = scene.add
        .rectangle(0, 0, bw, bh, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true })
      c.add(hit)
      hit.on('pointerover', () => {
        drawBody(fillHover)
        scene.tweens.add({ targets: c, scale: 1.04, duration: 110, ease: 'Quad.easeOut' })
      })
      hit.on('pointerout', () => {
        drawBody(fill)
        scene.tweens.add({ targets: c, scale: 1, duration: 110, ease: 'Quad.easeOut' })
      })
      hit.on('pointerdown', () => {
        scene.tweens.add({ targets: c, scale: 0.96, duration: 80, yoyo: true, ease: 'Quad.easeOut' })
      })
      hit.on('pointerup', () => {
        pressFx(scene, c, onPress)
      })
      // Staggered pop-in.
      c.setScale(0)
      this.charTweens.push(
        scene.tweens.add({
          targets: c,
          scale: 1,
          delay: SEQ.panelSpringMs * 0.6 + (localY === buttonsY2 ? 90 : 0),
          duration: 320,
          ease: 'Back.easeOut',
        }),
      )
    }
    mkCompactButton(
      buttonsY1,
      0x2d74c9,
      0x3f86dd,
      'GO AGAIN',
      (g, s) => drawLucide(g, 'rotate-ccw', 0, 0, s),
      this.onRestart,
    )
    mkCompactButton(
      buttonsY2,
      0x43a047,
      0x55b659,
      'MAIN MENU',
      (g, s) => drawLucide(g, 'house', 0, 0, s),
      this.onMenu,
    )

    // ---- Panel spring entrance.
    panel.setScale(SEQ.panelScaleFrom)
    scene.tweens.add({
      targets: panel,
      scale: 1,
      duration: SEQ.panelSpringMs,
      ease: 'Back.easeOut',
    })
  }

  /** NEW BEST confetti: a single pooled-ish burst of simple dots from the
   * panel top (bounded count, self-destroying — same language as pops). */
  private newBestConfetti(cx: number, cy: number, scale: number): void {
    const scene = this.scene
    const colors = [0xff5252, 0xffd740, 0x69f0ae, 0x40c4ff, 0xff4081]
    const g = scene.add.graphics().setDepth(62)
    this.objs.push(g)
    const parts = Array.from({ length: SEQ.newBestConfetti }, () => ({
      x: cx + (Math.random() - 0.5) * 180 * scale,
      y: cy - 190 * scale,
      vx: (Math.random() - 0.5) * 420 * scale,
      vy: -(120 + Math.random() * 260) * scale,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      r: (3 + Math.random() * 4) * scale,
    }))
    const proxy = { t: 0 }
    scene.tweens.add({
      targets: proxy,
      t: 1,
      duration: 950,
      ease: 'Linear',
      onUpdate: () => {
        g.clear()
        for (const p of parts) {
          p.vy += 900 * scale * 0.016
          p.x += p.vx * 0.016
          p.y += p.vy * 0.016
          g.fillStyle(p.color, 1)
          g.fillCircle(p.x, p.y, p.r)
        }
      },
      onComplete: () => g.destroy(),
    })
  }

  /** Destroy every object this view created (restart/shutdown). */
  hide(): void {
    this.countTween?.stop()
    this.countTween = null
    for (const tw of this.charTweens) tw.stop()
    this.charTweens = []
    for (const o of this.objs) o.destroy()
    this.objs = []
  }
}
