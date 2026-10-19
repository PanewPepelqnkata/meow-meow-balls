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

/**
 * Bake the intro cover ONCE as an annulus texture: solid ink from the
 * hole edge (cream ring) out past the screen corners, transparent hole
 * inside. Animated by pure GPU scale (Image.setScale) — zero per-frame
 * Graphics buffer streaming or canvas repaints, the iOS failure class
 * behind the blanking menu (WebKit canvas-pool exhaustion + Phaser
 * #6051/#6914 per-frame Graphics). Hole radius at scale s = innerR·s.
 */
export function bakeIrisCover(
  scene: Phaser.Scene,
  outerR: number,
  innerR: number,
  vw: number,
  vh: number,
): HTMLCanvasElement {
  const key = 'br-intro-cover'
  const size = Math.ceil(outerR * 2)
  const existing = scene.textures.exists(key)
    ? (scene.textures.get(key).getSourceImage() as HTMLCanvasElement | null)
    : null
  if (existing && existing.width >= size) return existing
  if (scene.textures.exists(key)) scene.textures.remove(key)
  // dpr 1: the texture is 2·outerR square; at dpr 2+ it would exceed
  // the iOS canvas pool for negligible sharpness gain on a moving
  // ring. Ring width formula matches the old hand-drawn cover.
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  const ringW = Math.max(3, Math.min(vw, vh) * 0.014)
  ctx.fillStyle = '#0e0f1c'
  ctx.beginPath()
  ctx.arc(c, c, outerR, 0, Math.PI * 2)
  ctx.arc(c, c, innerR, 0, Math.PI * 2, true)
  ctx.fill()
  ctx.strokeStyle = '#f3f1eb'
  ctx.lineWidth = ringW
  ctx.beginPath()
  ctx.arc(c, c, innerR + ringW / 2, 0, Math.PI * 2)
  ctx.stroke()
  scene.textures.addCanvas(key, canvas)
  return canvas
}

export class StartIntroScene extends Phaser.Scene {
  /** Skipped (non-phone viewport): flag for the menu to fast-path. */
  static shouldRun(vw: number, vh: number): boolean {
    return vh > vw && vw <= 500
  }

  constructor() {
    super({ key: 'StartIntroScene' })
  }

  create(data: { startClosed?: boolean } = {}): void {
    // startClosed: the sweep-in already ran in TitleScene (in-process
    // overlay — no scene-boot churn over the visible menu). This scene
    // boots UNDER a fully-closed cover and resumes at the ball phase.
    const startClosed = data?.startClosed === true
    ;(window as unknown as { __brIntroPhase?: string }).__brIntroPhase = startClosed ? 'ball' : 'sweep-in'
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


    // ---- 1. Ring sweep: screen covered by a scaled iris annulus --------
    // Baked ONCE (bakeIrisCover): ink annulus + cream ring at the hole
    // edge; hole radius = innerR at scale 1. Animating = pure GPU scale
    // (hole radius = innerR * scale). NO per-frame Graphics redraws —
    // the iOS blanking class (canvas-pool exhaustion + Phaser #6051/
    // #6914) is eliminated from the transition entirely.
    bakeIrisCover(this, outerR, innerR, vw, vh)
    const cover = this.add
      .image(cx, cy, 'br-intro-cover')
      .setOrigin(0.5, 0.5)
      .setDepth(-1)
    const drawCover = (holeR: number): void => {
      cover.setScale(Math.max(1e-4, holeR / innerR))
    }
    // startClosed boots FULLY closed (2px hairline) to match
    // TitleScene's last frame; the legacy open path starts wide open.
    cover.setScale(startClosed ? (2 / innerR) * 0.5 : outerR / innerR)

    // ---- 2. Timeline ------------------------------------------------------
    let sweepState = { r: outerR }
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
    const setPhase = (p: string): void => {
      ;(window as unknown as { __brIntroPhase?: string }).__brIntroPhase = p
    }

    /** Ball phase + outro. Runs from sweep-in completion OR directly on a
     * startClosed boot (sweep already played in TitleScene). */
    const runBallPhase = (): void => {
      // ---- the cover is now FULLY CLOSED --------------------------------
      setPhase('ball')
      // ---- gameplay boots UNDER the closed ring (heavy frame hidden) --
      this.startGameplay()
      // Stop the menu AFTER the gameplay scenes are revealed: both render
      // targets swap in the same frame — no paint gap at the handoff.
      // (TitleScene normally already stopped itself post-handoff; this
      // guard covers the legacy open-launch path.)
      if (this.scene.isActive('TitleScene')) this.scene.stop('TitleScene')
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
        setPhase('outro')
        // 1. The scared ball falls out of the ring (gravity-ish accelerate
        //    downward, slightly squashed — panic drop) and fully leaves
        //    the screen BEFORE the ring opens.
        this.tweens.add({
          targets: ball,
          y: vh + ballR * 1.4,
          scaleY: 1.12,
          scaleX: 0.9,
          duration: 520,
          ease: 'Quad.easeIn',
          onComplete: () => {
            ball.destroy()
            // 2. ONLY THEN the cover + ring edge RE-OPEN outward (reverse
            //    of the intro sweep) — the game is revealed through the
            //    growing hole.
            this.tweens.add({
              targets: sweepState,
              r: outerR,
              duration: 560,
              ease: 'Cubic.easeIn',
              onUpdate: () => {
                drawCover(sweepState.r)
              },
              onComplete: () => {
                cover.destroy()
                this.scene.stop()
              },
            })
          },
        })
      })
    }

    // startClosed boots under full ink: draw the CLOSED cover so the first
    // frame of this scene is identical to TitleScene's last frame (zero
    // flicker at the handoff), and skip straight to the ball phase.
    if (startClosed) {
      sweepState = { r: 2 }
      drawCover(sweepState.r)
      runBallPhase()
      return
    }

    this.tweens.add({
      targets: sweepState,
      r: 2,
      duration: dur,
      ease: 'Quad.easeInOut',
      onUpdate: () => {
        drawCover(sweepState.r)
      },
      onComplete: () => {
        runBallPhase()
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
