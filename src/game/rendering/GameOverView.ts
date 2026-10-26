import Phaser from 'phaser'
import { drawLucide } from '../../ui/LucideIcon'
import { FONT_FAMILY } from '../../ui/Typography'
import { doodleSilhouette, darkenFill } from '../../ui/CartoonButton'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK } from '../rendering/BallAppearance'
import { pressFx } from '../../ui/PressFx'
import { GAME_OVER_SEQUENCE as SEQ } from '../../config/gameOverSequence'

/**
 * GAME OVER PANEL — a chunky cartoon card in the Ball Rush visual
 * language: a wobbly doodle silhouette panel (the same hand-drawn recipe
 * as the menu's doodle buttons — fat ink outline, solid darker extrusion
 * slab, top-left glint, soft drop shadow), a doomed-looking slime
 * character on top, big animated score count-up, NEW BEST! celebration,
 * and two equal-size doodle buttons (GO AGAIN / MAIN MENU) laid out as a
 * symmetric side-by-side pair. The gameplay stays visible behind a soft
 * dim.
 *
 * SYMMETRY CONTRACT: the panel is a container centered on the viewport
 * centerline, and EVERY row inside it is centered as a UNIT about the
 * panel's local x=0 — icon+text rows compute their total unit width
 * (icon + gap + text) and position from the centre; the button pair
 * places two equal-width buttons at ±(button + gap)/2. Nothing is
 * anchored by fixed left offsets.
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
    // Height is DERIVED from the stacked content (see the row stack below):
    // title 74 + ball 2·46+38 + score 112 + best 56 + banner 42 + buttons
    // 58 + top/bottom breathing room. No fixed guess — no dead space.
    const panel = scene.add.container(cx, cy).setDepth(61)
    this.objs.push(panel)
    const pw = 470 * scale
    const ph = 520 * scale
    const pr = 34 * scale

    // DOODLE PLATE (menu button recipe, scaled up to a card): wobbly
    // rounded-rect silhouette with a fat ink outline, a solid darker
    // extrusion slab offset down, a soft drop shadow and a top-left glint.
    // Deterministic seed so rebuilds never redraw the wobble.
    const seed = 20260213
    const amp = Math.min(6, Math.max(3, 40 * scale * 0.09))
    const pts = doodleSilhouette(pw, ph, pr, seed, amp).map((p) => new Phaser.Math.Vector2(p.x, p.y))
    const drop = Math.max(6, 12 * scale)
    const extrude = Math.max(4, 9 * scale)
    const inkW = Math.max(6, Math.min(10, 9 * scale))
    const v = (dy: number): Phaser.Math.Vector2[] => pts.map((p) => new Phaser.Math.Vector2(p.x, p.y + dy))

    const shadowG = scene.add.graphics()
    shadowG.fillStyle(0x000000, 0.28)
    shadowG.fillPoints(v(drop + 3), true)
    panel.add(shadowG)
    // Extrusion slab: darker body color, offset down — the card's "side".
    const sideG = scene.add.graphics()
    sideG.fillStyle(darkenFill(PANEL_FILL, 0.62), 1)
    sideG.fillPoints(v(extrude), true)
    sideG.lineStyle(inkW, PANEL_INK, 1)
    sideG.strokePoints(v(extrude), true, true)
    panel.add(sideG)
    const bodyG = scene.add.graphics()
    bodyG.fillStyle(PANEL_FILL, 1)
    bodyG.fillPoints(pts, true)
    bodyG.lineStyle(inkW, PANEL_INK, 1)
    bodyG.strokePoints(pts, true, true)
    // Glint: white oval on the top-left (the ball/menu-button shine).
    bodyG.fillStyle(0xffffff, 0.3)
    bodyG.fillEllipse(-pw * 0.26, -ph * 0.28, pw * 0.32, ph * 0.2)
    panel.add(bodyG)

    // ---- LAYOUT: a single top-down row stack inside the panel. Every row
    // is centered as a UNIT about the panel's local x=0 and placed by
    // accumulating its height + gap, so nothing can overlap at any scale.
    //
    // GAME OVER (title)
    // ↓ terrified ball
    // ↓ trophy + SCORE label / big score / NEW BEST! banner
    // ↓ medal + BEST
    // ↓ GO AGAIN | MAIN MENU (equal-size symmetric pair)
    const titleY = -ph / 2 + 64 * scale

    // Title with chunky two-tone lettering.
    const title = scene.add
      .text(0, titleY, 'GAME OVER', {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(54 * scale)}px`,
        color: TITLE_COLOR,
        stroke: '#111111',
        strokeThickness: Math.round(9 * scale),
      resolution: Math.min(window.devicePixelRatio || 1, 2),
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

    // SCORE block: trophy icon + label as one centered unit, then the big
    // counting number (origin 0.5 → always centered on the panel line).
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
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0, 0.5)
    scoreLabelC.add(scoreLabelT)
    // Center the icon+text unit: icon (24px) + gap (8px) + text width.
    // drawLucide CENTRES its glyph box on (cx, cy), so the graphics sits at
    // the icon's box centre: -unitW/2 + iconSize/2.
    const scoreUnitW = 24 * scale + 8 * scale + scoreLabelT.width
    scoreIcon.setPosition(-scoreUnitW / 2 + 24 * scale / 2, 0)
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
      resolution: Math.min(window.devicePixelRatio || 1, 2),
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
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .setOrigin(0, 0.5)
    bestRowC.add(bestText)
    const bestUnitW = 26 * scale + 8 * scale + bestText.width
    bestIcon.setPosition(-bestUnitW / 2 + 26 * scale / 2, 0)
    bestText.setPosition(-bestUnitW / 2 + 26 * scale + 8 * scale, 0)

    if (isNewBest) {
      const banner = scene.add
        .text(0, bestY - 44 * scale, '★ NEW BEST! ★', {
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(32 * scale)}px`,
          color: NEW_BEST_COLOR,
          stroke: '#111111',
          strokeThickness: Math.round(6 * scale),
          resolution: Math.min(window.devicePixelRatio || 1, 2),
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

    // ---- Buttons: GO AGAIN + MAIN MENU — equal-size doodle plates drawn
    // in-panel, laid out as a SYMMETRIC SIDE-BY-SIDE PAIR: the pair's
    // total width is 2·bw + gap, so each button sits exactly
    // ±(bw + gap)/2 from the panel centreline. Inside each button the
    // icon+label unit is centered as a whole (icon + gap + text measured,
    // then positioned from the centre) — no fixed left offsets.
    const bh = SEQ.buttons.height * scale
    const bw = SEQ.buttons.width * scale
    const btnGap = SEQ.buttons.gap * scale
    const buttonsY = bestY + 58 * scale + bh / 2
    this.lastButtonCenter = { x: cx - (bw + btnGap) / 2, y: cy + buttonsY }
    const mkDoodleButton = (
      localX: number,
      fill: number,
      label: string,
      icon: (g: Phaser.GameObjects.Graphics, s: number) => void,
      onPress: () => void,
    ): void => {
      const c = scene.add.container(localX, buttonsY)
      panel.add(c)
      // Doodle plate: wobbly silhouette + fat ink outline + darker
      // extrusion slab + soft drop shadow + top-left glint — the exact
      // menu-button recipe (CartoonButton doodle plate).
      const bSeed = 7 + localX
      const bAmp = Math.min(4.2, Math.max(2, bh * 0.055))
      const bPts = doodleSilhouette(bw, bh, SEQ.buttons.radius * scale, bSeed, bAmp).map(
        (p) => new Phaser.Math.Vector2(p.x, p.y),
      )
      const bDrop = Math.max(5, bh * 0.08)
      const bExtrude = Math.max(3, bh * 0.05)
      const bInk = Math.max(3.5, Math.min(7, bw * 0.05))
      const bv = (dy: number): Phaser.Math.Vector2[] => bPts.map((p) => new Phaser.Math.Vector2(p.x, p.y + dy))

      const shadow = scene.add.graphics()
      shadow.fillStyle(0x000000, 0.28)
      shadow.fillPoints(bv(bDrop + 3), true)
      c.add(shadow)
      const side = scene.add.graphics()
      side.fillStyle(darkenFill(fill, 0.62), 1)
      side.fillPoints(bv(bExtrude), true)
      side.lineStyle(bInk, PANEL_INK, 1)
      side.strokePoints(bv(bExtrude), true, true)
      c.add(side)
      const body = scene.add.graphics()
      body.fillStyle(fill, 1)
      body.fillPoints(bPts, true)
      body.lineStyle(bInk, PANEL_INK, 1)
      body.strokePoints(bPts, true, true)
      body.fillStyle(0xffffff, 0.3)
      body.fillEllipse(-bw * 0.26, -bh * 0.28, bw * 0.32, bh * 0.2)
      c.add(body)

      // Icon + label centered as ONE unit: total = icon + gap + text.
      const iconS = SEQ.buttons.iconSize * scale
      const iconG = scene.add.graphics()
      icon(iconG, iconS)
      c.add(iconG)
      const labelT = scene.add
        .text(0, 0, label, {
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(23 * scale)}px`,
          color: '#ffffff',
          stroke: '#111111',
          strokeThickness: Math.round(4 * scale),
        })
        .setOrigin(0, 0.5)
      c.add(labelT)
      const unitGap = 9 * scale
      const unitW = iconS + unitGap + labelT.width
      // drawLucide CENTRES its glyph box on the graphics position, so the
      // box's centre goes at -unitW/2 + iconS/2 (box left = -unitW/2).
      iconG.setPosition(-unitW / 2 + iconS / 2, 0)
      labelT.setPosition(-unitW / 2 + iconS + unitGap, 0)

      // Interactive hit area + hover lift + press squash.
      const hit = scene.add
        .rectangle(0, 0, bw, bh, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true })
      c.add(hit)
      hit.on('pointerover', () => {
        scene.tweens.add({ targets: c, scale: 1.04, duration: 110, ease: 'Quad.easeOut' })
      })
      hit.on('pointerout', () => {
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
          delay: SEQ.panelSpringMs * 0.6 + (localX > 0 ? 90 : 0),
          duration: 320,
          ease: 'Back.easeOut',
        }),
      )
    }
    mkDoodleButton(
      -(bw + btnGap) / 2,
      0x2d74c9,
      'GO AGAIN',
      (g, s) => drawLucide(g, 'rotate-ccw', 0, 0, s),
      this.onRestart,
    )
    mkDoodleButton(
      (bw + btnGap) / 2,
      0x43a047,
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
