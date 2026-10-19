import Phaser from 'phaser'

/**
 * Phase 2.22 — MOBILE START INTRO (?play intro, portrait phones only).
 *
 * A dedicated loading scene that sits BETWEEN the menu and gameplay on
 * portrait phones. Purpose: the first gameplay frame is the most expensive
 * frame in the app (world cameras, container texture bake, physics boot,
 * background star/gradient bake, first Matter steps). Running it while the
 * menu cross-dissolves is what produced the visible "lag on start" on
 * physical iPhones. This scene:
 *
 *   1. runs the comic intro — a ring that sweeps in from OUTSIDE the
 *      viewport toward the middle (two arcs closing on the screen center),
 *   2. when the ring closes, the gameplay scenes are STARTED underneath
 *      (their expensive first frame happens hidden behind the intro art),
 *   3. a scared ball pops in the middle of the closed ring,
 *   4. a short beat, then the intro fades and reveals the running game.
 *
 * Everything here is screen-space: one Graphics layer + one Text, no
 * physics, no textures (vector only — sharp at any DPR).
 */

export class StartIntroScene extends Phaser.Scene {
  /** Skipped (non-phone viewport): flag for the menu to fast-path. */
  static shouldRun(vw: number, vh: number): boolean {
    return vh > vw && vw <= 500
  }

  constructor() {
    super('StartIntroScene')
  }

  create(): void {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)')
    this.applyDprCamera()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
    })

    const z = this.game.scale.displayScale.x || 1
    const vw = this.scale.width / z
    const vh = this.scale.height / z
    const cx = vw / 2
    const cy = vh / 2
    // The ring outer radius starts past the screen corner (guarantees the
    // "from outside" sweep covers the whole viewport).
    // Start with the ring edge ON screen (~55% of the diagonal) so the
    // closing sweep is visible from frame one (a ring starting past the
    // corners reads as a plain fade).
    const outerR = Math.hypot(vw, vh) * 0.5
    const innerR = Math.min(vw, vh) * 0.14
    const dur = 620

    const g = this.add.graphics().setDepth(0)

    // ---- 1. Ring sweep: screen covered by two closing arcs ---------------
    // The viewport is painted with the MENU'S ink tone (the player just
    // left the dark-ink menu) except a shrinking center hole. A bright
    // cream ring edge marks the closing boundary so the sweep reads even
    // against the dark space sky.
    const cover = this.add.graphics().setDepth(-1)
    const drawCover = (holeR: number): void => {
      cover.clear()
      cover.fillStyle(0x0e0f1c, 1)
      // Dark cover: rect with a circular hole (nonzero winding cut).
      const side = outerR * 2
      cover.beginPath()
      cover.moveTo(cx - side, cy - side)
      cover.lineTo(cx + side, cy - side)
      cover.lineTo(cx + side, cy + side)
      cover.lineTo(cx - side, cy + side)
      cover.closePath()
      cover.arc(cx, cy, Math.max(1, holeR), 0, Math.PI * 2, true)
      cover.fillPath()
      // Bright comic ring edge at the hole boundary.
      cover.lineStyle(Math.max(3, Math.min(vw, vh) * 0.014), 0xf3f1eb, 1)
      cover.strokeCircle(cx, cy, Math.max(1, holeR))
    }
    drawCover(outerR)

    // ---- 2. Timeline ------------------------------------------------------
    const sweepState = { r: outerR }
    this.tweens.add({
      targets: sweepState,
      r: innerR,
      duration: dur,
      ease: 'Quad.easeInOut',
      onUpdate: () => {
        drawCover(sweepState.r)
      },
      onComplete: () => {
        // ---- gameplay boots UNDER the closed ring (heavy frame hidden) --
        this.startGameplay()
        // ---- scared ball pops in the middle ------------------------------
        const ballR = innerR * 0.52
        const ball = this.add.graphics().setDepth(2)
        const face = (): void => {
          ball.clear()
          const wobble = Math.sin(this.time.now * 0.012) * ballR * 0.03
          // body
          ball.fillStyle(0x4fc3f7, 1)
          ball.fillCircle(cx, cy, ballR + wobble)
          ball.lineStyle(Math.max(2, ballR * 0.09), 0x111111, 1)
          ball.strokeCircle(cx, cy, ballR + wobble)
          // eyes: wide (panic)
          const eyeW = ballR * 0.3
          const eyeH = ballR * 0.42
          const eyeDX = ballR * 0.3
          const eyeY = cy - ballR * 0.08
          ball.fillStyle(0xffffff, 1)
          ball.fillEllipse(cx - eyeDX, eyeY, eyeW * 2, eyeH * 2)
          ball.fillEllipse(cx + eyeDX, eyeY, eyeW * 2, eyeH * 2)
          // pupils: tiny, pinned up (scared)
          ball.fillStyle(0x111111, 1)
          ball.fillCircle(cx - eyeDX, eyeY - eyeH * 0.45, ballR * 0.09)
          ball.fillCircle(cx + eyeDX, eyeY - eyeH * 0.45, ballR * 0.09)
          // mouth: small open "o"
          ball.fillStyle(0x111111, 1)
          ball.fillEllipse(cx, cy + ballR * 0.42, ballR * 0.36, ballR * 0.46)
          // sweat drops (two, alternating alpha)
          const sweatA = 0.55 + Math.sin(this.time.now * 0.014) * 0.35
          ball.fillStyle(0x9edbff, sweatA)
          ball.fillCircle(cx - ballR * 0.92, cy - ballR * 0.55, ballR * 0.12)
          ball.fillCircle(cx + ballR * 0.95, cy - ballR * 0.32, ballR * 0.1)
        }
        face()

        // pop-in: scale from 0 with a back ease
        ball.setScale(0)
        this.tweens.add({
          targets: ball,
          scale: 1,
          duration: 380,
          ease: 'Back.easeOut',
        })

        // idle wobble redraw while the scared ball is on screen
        const wobbleTimer = this.time.addEvent({
          delay: 33,
          loop: true,
          callback: face,
        })

        // ---- hold, then hand over to the game ----------------------------
        this.time.delayedCall(900, () => {
          wobbleTimer.remove()
          this.tweens.add({
            targets: [ball, cover, g],
            alpha: 0,
            duration: 340,
            ease: 'Quad.easeIn',
            onComplete: () => {
              this.scene.stop()
            },
          })
        })
      },
    })
  }

  /** Reveal the gameplay scenes under the intro. The playground/UIScene
   * pair already exists and runs (BackgroundScene launches 'playground'
   * at boot; it was hidden behind the menu) — reveal only. TitleScene
   * stops itself after the intro hands off. */
  private startGameplay(): void {
    this.scene.setVisible(true, 'playground')
    this.scene.setVisible(true, 'UIScene')
  }

  private applyDprCamera(): void {
    const z = this.game.scale.displayScale.x || 1
    const cssW = this.scale.width / z
    const cssH = this.scale.height / z
    this.cameras.main.setZoom(z)
    this.cameras.main.centerOn(cssW / 2, cssH / 2)
  }
}
