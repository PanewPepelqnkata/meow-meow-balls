import Phaser from 'phaser'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK } from '../rendering/BallAppearance'
import { getTier } from '../../config/ballTiers'

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
    // ?diag=1 device readout: sweep progress + cover geometry, sampled by
    // the diag panel per frame. r/outerR: 1 = ring at screen edge (open),
    // 0 = fully closed.
    ;(this.scene.settings.data as unknown as { introDiag?: unknown }).introDiag = {
      get r() {
        return sweepState.r
      },
      outerR,
      innerR,
      get phase() {
        return (window as unknown as { __brIntroPhase?: string }).__brIntroPhase ?? 'sweep-in'
      },
    }
    ;(window as unknown as { __brIntroPhase?: string }).__brIntroPhase = 'sweep-in'
    this.tweens.add({
      targets: sweepState,
      r: innerR,
      duration: dur,
      ease: 'Quad.easeInOut',
      onUpdate: () => {
        drawCover(sweepState.r)
      },
      onComplete: () => {
        // ---- the cover is now FULLY CLOSED --------------------------------
        // The menu (launched under us, still visible) is completely hidden
        // by the ink — stop it now so the outro reveals the GAME, not a
        // second menu layer behind the ring.
        this.scene.stop('TitleScene')
        ;(window as unknown as { __brIntroPhase?: string }).__brIntroPhase = 'ball'
        // ---- gameplay boots UNDER the closed ring (heavy frame hidden) --
        this.startGameplay()
        // ---- scared ball pops in the middle ------------------------------
        const tier1 = getTier(1)
        const ballR = Math.max(innerR * 0.55, (tier1?.radius ?? 44) * 0.62)
        const ball = this.add.graphics().setDepth(2)
        // The AUTHENTIC max-scared slime: shared look pipeline (ballLookFor)
        // + restContour silhouette + drawBallFace at panic 1 (critical:
        // eyes x1.62, dilated-shrunk pupils, trembling jitter boosted
        // criticalShakeBoost). Deterministic seed — same character every
        // intro.
        const look = ballLookFor(1, 20260222)
        const contour = restContour(look, ballR, cx, cy, 40)
        const face = (): void => {
          ball.clear()
          ball.fillStyle(tier1?.color ?? 0x4fc3f7, 1)
          ball.fillPoints(contour.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
          ball.lineStyle(ballOutlineWidth(ballR), INK, 1)
          ball.strokePoints(contour.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
          drawBallFace(ball, look, { x: cx, y: cy }, ballR, 1, {
            gaze: { x: 0, y: -1 },
            panic: 1, // MAX scared — the whole point of this ball
          })
          // sweat drops (two, alternating alpha) — drawn by the intro, the
          // in-game face system doesn't have them.
          const sweatA = 0.55 + Math.sin(this.time.now * 0.014) * 0.35
          ball.fillStyle(0x9edbff, sweatA)
          ball.fillCircle(cx - ballR * 0.98, cy - ballR * 0.5, ballR * 0.13)
          ball.fillCircle(cx + ballR * 1.02, cy - ballR * 0.28, ballR * 0.11)
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

        // ---- hold, then the OUTRO: ball drops under the screen, ring
        // reopens outward to reveal the running game -----------------------
        this.time.delayedCall(900, () => {
          wobbleTimer.remove()
          ;(window as unknown as { __brIntroPhase?: string }).__brIntroPhase = 'outro'
          // 1. The scared ball falls out of the ring (gravity-ish accelerate
          //    downward, slightly squashed — panic drop).
          this.tweens.add({
            targets: ball,
            y: vh + ballR * 1.4,
            scaleY: 1.12,
            scaleX: 0.9,
            duration: 520,
            ease: 'Quad.easeIn',
          })
          // 2. The dark cover + ring edge RE-OPEN outward (reverse of the
          //    intro sweep) while the ball falls — the game is revealed
          //    through the growing hole.
          this.tweens.add({
            targets: sweepState,
            r: outerR,
            duration: 560,
            delay: 120,
            ease: 'Cubic.easeIn',
            onUpdate: () => {
              drawCover(sweepState.r)
            },
            onComplete: () => {
              cover.clear()
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
