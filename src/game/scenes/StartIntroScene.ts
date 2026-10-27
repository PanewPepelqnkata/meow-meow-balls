import Phaser from 'phaser'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK } from '../rendering/BallAppearance'
import {
  MACHINE_DRAW_ORDER,
  MACHINE_UNIT_PATHS,
  drawMachineFills,
  pathLength,
  strokeProgressive,
  totalDrawLength,
} from '../rendering/MachineArt'
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
export class StartIntroScene extends Phaser.Scene {
  /** Guards the outro early-exit (one-shot per transition). */
  private transitionLive = true
  /** Runs on EVERY viewport now — the machine intro is the start
   * experience on desktop too (the machine scales with the viewport).
   * Kept as a method for the TitleScene gate + QA parity. */
  static shouldRun(): boolean {
    return true
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
    const innerR = 12 // closed-beat hole: near-zero, seal bridges it (user: close fully to center)
    const dur = 620


    // ---- 1. Ring sweep: screen covered by a scaled iris annulus --------
    // The iris is a per-tick Graphics annulus — a texture scaled 60x+
    // during the open magnifies its baked edge into pixel steps; live
    // geometry stays crisp at every radius (two arcs + a fill, ~no cost).
    const cover = this.add.graphics().setDepth(-1)
    const drawCover = (holeR: number): void => {
      cover.clear()
      // Fully open: draw nothing — a zero-width annulus renders as a
      // 1px GPU seam ring. Fully closed: a plain disc. The hole tween
      // overshoots past the corners (outerR * 1.1), so the corners
      // clear mid-open — no second-circle read at the end.
      if (holeR >= outerR) return
      cover.fillStyle(0x0e0f1c, 1)
      if (holeR <= 0.01) {
        cover.fillCircle(cx, cy, outerR * 1.3)
        return
      }
      cover.beginPath()
      cover.arc(cx, cy, outerR * 1.3, 0, Math.PI * 2)
      cover.arc(cx, cy, holeR, 0, Math.PI * 2, true)
      cover.fillPath()
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

    /** Machine phase + outro. Runs from sweep-in completion OR directly on a
     * startClosed boot (sweep already played in TitleScene). */
    const runBallPhase = (): void => {
      // ---- the cover is now FULLY CLOSED --------------------------------
      setPhase('machine')
      // ---- gameplay boots UNDER the closed ring (heavy frame hidden) --
      this.startGameplay()
      // Stop the menu AFTER the gameplay scenes are revealed: both render
      // targets swap in the same frame — no paint gap at the handoff.
      // (TitleScene normally already stopped itself post-handoff; this
      // guard covers the legacy open-launch path.)
      if (this.scene.isActive('TitleScene')) this.scene.stop('TitleScene')

      // ---- the gumball machine draws itself -----------------------------
      // The menu machine's unit-space outlines redraw progressively
      // (uiverse giant-bird-69 read: lines sweep on, then color pops).
      // ONE Graphics layer for the progressive strokes + ONE for fills;
      // both redraw only from tweens/timers (the iOS per-frame-viewport-
      // redraw class stays out; the whole art is a ~300px element).
      const h = Math.min(vh * 0.62, vw * 0.8) // machine display height
      const mw = h / 1.3 // machine display width (design box 100 × 130)
      const u = mw / 100 // unit scale
      const mx = cx - mw / 2 // machine box top-left
      const my = cy - vh * 0.02 - h / 2
      const machineC = this.add.container(mx, my).setDepth(2)

      const fillG = this.add.graphics() // fills + bulbs (color layer)
      const lineG = this.add.graphics() // the progressive ink strokes
      machineC.add(fillG)
      machineC.add(lineG)
      lineG.setScale(u) // strokes drawn in UNIT space, scaled by u

      // Fills fade in per group ~200ms after that group's outline lands.
      const alphaMap: Record<string, number> = {}
      const drawFills = (): void => {
        fillG.clear()
        drawMachineFills(fillG, u, alphaMap)
      }
      // Outline groups → fill-layer group keys (band/pinstripe/flap handle
      // are strokes only; they inherit their part's fill).
      const fillGroupOf: Record<string, string> = {
        base: 'base',
        band: 'base',
        collar: 'collar',
        glass: 'glass',
        chute: 'chute',
        flap: 'chute',
        flapHandle: 'chute',
        coinSlot: 'coinSlot',
        knob: 'knob',
        knobInner: 'knob',
        footL: 'feet',
        footR: 'feet',
        pinstripe: '',
        sheen1: '',
        sheen2: '',
        sheen3: '',
        sticker: 'sticker',
        sparkle1: 'sparkle',
        sparkle2: 'sparkle',
      }
      // When `key`'s outline segment completes, tween its fill group in.
      const scheduleFill = (key: string): void => {
        const grp = fillGroupOf[key]
        if (!grp || alphaMap[grp] !== undefined) return
        alphaMap[grp] = 0
        const target: Record<string, number> = {}
        target[grp] = 1
        this.tweens.add({
          targets: alphaMap,
          props: target,
          duration: 200,
          ease: 'Quad.easeOut',
          onUpdate: drawFills,
        })
      }

      // The draw-on tween: t 0→1 over the whole outline length.
      const totalLen = totalDrawLength(MACHINE_DRAW_ORDER, MACHINE_UNIT_PATHS)
      // Fire each group's fill-in the first time the draw passes it.
      const fillPassed = (t: number): void => {
        let acc = 0
        for (const k of MACHINE_DRAW_ORDER) {
          const len = pathLength(MACHINE_UNIT_PATHS[k] ?? { pts: [], closed: false })
          if (acc + len >= t * totalLen) return
          acc += len
          scheduleFill(k)
        }
      }
      const drawState = { t: 0 }
      const drawLines = (): void => {
        lineG.clear()
        strokeProgressive(
          lineG,
          MACHINE_UNIT_PATHS,
          MACHINE_DRAW_ORDER,
          drawState.t * totalLen,
          INK,
          Math.max(2.2, u * 0.55) / u, // width in unit space (Graphics is u-scaled)
        )
      }
      drawLines()
      this.tweens.add({
        targets: drawState,
        t: 1,
        duration: 3200,
        ease: 'Cubic.easeInOut',
        onUpdate: () => {
          drawLines()
          fillPassed(drawState.t)
        },
        onComplete: () => {
          drawLines()
          MACHINE_DRAW_ORDER.forEach(scheduleFill)
          // The marquee bulbs flash in LAST, with their candy colors.
          alphaMap.bulbs = 0
          this.tweens.add({
            targets: alphaMap,
            bulbs: 1,
            duration: 220,
            ease: 'Quad.easeOut',
            onUpdate: drawFills,
          })
          setPhase('balls') // the draw-on is done; the cast pops next
        },
      })

      // ---- the gumball cast pops in after the draw-on -------------------
      // Shared appearance pipeline — the SAME characters as the menu pile
      // (menu seeds: 4242 + tier·7), same unit coords, drawn at rest with
      // a mild panic wobble (they've been shaken around in there).
      const castG = this.add.graphics()
      machineC.add(castG)
      const pile: Array<{ tier: number; ux: number; uy: number; ur: number; blink?: boolean }> = [
        { tier: 4, ux: 40, uy: 50, ur: 8.5 },
        { tier: 5, ux: 60, uy: 50, ur: 8 },
        { tier: 2, ux: 41, uy: 43, ur: 7.5 },
        { tier: 3, ux: 55, uy: 43, ur: 8.5 },
        { tier: 1, ux: 34, uy: 33, ur: 6.5 },
        { tier: 6, ux: 50, uy: 33, ur: 9.5, blink: true },
        { tier: 2, ux: 65, uy: 34, ur: 7 },
        { tier: 3, ux: 44, uy: 21, ur: 6.5 },
        { tier: 4, ux: 57, uy: 22, ur: 6.5 },
        { tier: 7, ux: 51, uy: 13, ur: 5.5 },
      ]
      const cast = pile.map((p) => {
        const r = p.ur * u
        return {
          tier: p.tier,
          cx: p.ux * u,
          cy: p.uy * u,
          r,
          blink: p.blink === true,
          look: ballLookFor(p.tier, 4242 + p.tier * 7),
          contour: restContour(ballLookFor(p.tier, 4242 + p.tier * 7), r, p.ux * u, p.uy * u, 40),
          scale: 0,
          // Menu-pile bob params (assigned right after this map).
          phase: 0,
          speed: 0.8,
          amp: 0,
          drawX: undefined as number | undefined,
          drawY: undefined as number | undefined,
        }
      })
      // Ball painter: tier fill + rest contour + ink outline + face. All
      // balls share ONE Graphics (redrawn only from the pop tweens and the
      // 33ms timer while the machine is on screen). The tier-6 star's
      // `blink` closes its eyes every ~2.4s for 140ms (menu cast behavior).
      // NOTE: `drawCast` is a function declaration — hoisted so the pop
      // tweens below can reference it before its lexical position.
      let starClosed = false
      function drawCast(): void {
        castG.clear()
        for (const b of cast) {
          if (b.scale <= 0) continue
          const t = getTier(b.tier)
          if (!t) continue
          const s = b.scale
          // Bob offset (drawX/drawY set by the 33ms timer once popped).
          const dx = (b.drawX ?? b.cx) - b.cx
          const dy = (b.drawY ?? b.cy) - b.cy
          const ccx = b.cx + dx
          const ccy = b.cy + dy
          const pts = b.contour.map((p) => new Phaser.Math.Vector2(
            ccx + (p.x - b.cx) * s,
            ccy + (p.y - b.cy) * s,
          ))
          castG.fillStyle(t.color, 1)
          castG.fillPoints(pts, true)
          castG.lineStyle(ballOutlineWidth(b.r) * s, INK, 1)
          castG.strokePoints(pts, true, true)
          // The star's blink: closed eyes via a squashed look (the menu's
          // drawBallIcon trick), slight panic for the just-shaken look.
          const faceLook = b.blink && starClosed
            ? { ...b.look, eyeH: b.look.eyeH * 0.12 }
            : b.look
          drawBallFace(castG, faceLook, { x: ccx, y: ccy }, b.r * s, s, {
            panic: 0.25,
          })
        }
      }
      cast.forEach((b, i) => {
        this.tweens.add({
          targets: b,
          scale: 1,
          delay: 3350 + i * 80,
          duration: 320,
          ease: 'Back.easeOut.config(0.6)',
          onUpdate: () => drawCast(),
          onComplete: () => drawCast(),
        })
      })
      // Idle animation: the cast bobs exactly like the menu pile (per-ball
      // phase/speed/amp from the same recipe), redrawn on the shared 33ms
      // timer. drawX/drawY hold the bobbed position; pop scale respected.
      cast.forEach((b, i) => {
        b.phase = i * 1.7
        b.speed = 0.8 + (i % 3) * 0.25
        b.amp = Math.max(1.2, b.r * 0.055)
      })
      const blinkTimer = this.time.addEvent({
        delay: 33,
        loop: true,
        callback: () => {
          const cycle = this.time.now % 2400
          const closed = cycle < 140
          const t = this.time.now / 1000
          let moved = false
          for (const b of cast) {
            if (b.scale <= 0) continue
            const bx = b.cx + Math.sin(t * b.speed * 0.7 + b.phase * 1.7) * b.amp * 0.4
            const by = b.cy + Math.sin(t * b.speed + b.phase) * b.amp
            if (Math.abs(bx - b.cx) > 0.01 || Math.abs(by - b.cy) > 0.01) {
              b.drawX = bx
              b.drawY = by
              moved = true
            } else if (b.drawX !== undefined) {
              b.drawX = bx
              b.drawY = by
              moved = true
            }
          }
          if (moved || closed !== starClosed) drawCast()
          starClosed = closed
        },
      })

      // Legacy open path: seal in the remaining hole so the closed beat
      // ends on solid ink (startClosed boots with the seal already on).
      this.tweens.add({
        targets: seal,
        alpha: 1,
        duration: 120,
        ease: 'Quad.easeIn',
      })

      // ---- hold, then the OUTRO: the machine scales down into the void
      // WHILE the ring reopens — the machine un-draws itself (bottom-up:
      // shadow/base first, last-drawn details last) and the balls pop out
      // top-first, all while the hole grows --------------------------
      this.time.delayedCall(3200 + cast.length * 80 + 320 + 700, () => {
        blinkTimer.remove()
        setPhase('outro')
        this.transitionLive = true
        // The seal dissolves in overlap so the hole that reappears as the
        // ring pulls back is pre-filled with ink — no sudden hole pop.
        this.tweens.add({
          targets: seal,
          alpha: 0,
          duration: 300,
          delay: 200,
          ease: 'Quad.easeOut',
        })
        // UN-DRAW: the erase stroke walks the same bottom-up order as the
        // draw-on — shadow/base/band vanish first, glass/chute next, the
        // top details (sheens/sparkles) last. 1.4s, started with the iris.
        const undrawState = { t: 0 }
        const eraseLines = (): void => {
          lineG.clear()
          strokeProgressive(
            lineG,
            MACHINE_UNIT_PATHS,
            MACHINE_DRAW_ORDER,
            undrawState.t * totalLen,
            INK,
            Math.max(2.2, u * 0.55) / u,
            1,
            true, // erase mode
          )
        }
        this.tweens.add({
          targets: undrawState,
          t: 1,
          duration: 1300,
          ease: 'Cubic.easeInOut',
          onUpdate: () => {
            eraseLines()
            // Fills fade in the SAME bottom-up order as the line erase:
            // each group's alpha is 1 until the erase front reaches it,
            // then ramps down across its own length.
            const front = undrawState.t * totalLen
            let acc = 0
            for (const k of MACHINE_DRAW_ORDER) {
              const grp = fillGroupOf[k]
              if (!grp || !grp.length) {
                acc += pathLength(MACHINE_UNIT_PATHS[k] ?? { pts: [], closed: false })
                continue
              }
              const len = Math.max(1, pathLength(MACHINE_UNIT_PATHS[k] ?? { pts: [], closed: false }))
              const vis = Math.max(0, Math.min(1, 1 - (front - acc) / len))
              const targetA = Math.ceil(vis * 8) / 8
              if (alphaMap[grp] !== undefined && alphaMap[grp] > targetA) {
                alphaMap[grp] = targetA
              }
              acc += len
            }
            drawFills()
          },
          onComplete: () => {
            lineG.clear()
            fillG.clear()
            machineC.destroy()
          },
        })
        // The balls pop OUT top-first (reverse pop order), starting after
        // the erase has cleared the base — "lastly the balls".
        ;[...cast].reverse().forEach((b, i) => {
          this.tweens.add({
            targets: b,
            scale: 0,
            delay: 500 + i * 60,
            duration: 200,
            ease: 'Quad.easeIn',
            onUpdate: () => drawCast(),
            onComplete: () => drawCast(),
          })
        })
        // ...while the cover reopens outward SLOWER than the undraw — the
        // machine vanishes inside the growing hole (the iris outlives the
        // undraw, or the scene stop would cut the erase short).
        this.tweens.add({
          targets: sweepState,
          // End at outerR exactly (corner clear): the onUpdate early-
          // exit fires the tick the corners clear — no lingering cover
          // tail, no second-circle read.
          r: outerR,
          duration: 600,
          ease: 'Cubic.easeOut',
          onUpdate: () => {
            drawCover(sweepState.r)
            if (sweepState.r >= outerR && this.transitionLive) {
              this.transitionLive = false
              cover.destroy()
              seal.destroy()
              this.scene.stop()
            }
          },
          onComplete: () => {
            cover.destroy()
            seal.destroy()
            this.scene.stop()
          },
        })
      })
    }

    // Seal: fills the 55px hole under the closed annulus — the closed
    // beat is SOLID ink. Depth -2 (under cover -1) so the cream ring
    // stays visible on top; the outro dissolves it in overlap.
    const seal = this.add
      .rectangle(cx, cy, vw, vh, 0x0e0f1c)
      .setDepth(-2)
      .setAlpha(startClosed ? 1 : 0)
    // startClosed boots under full ink: draw the CLOSED cover so the first
    // frame of this scene is identical to TitleScene's last frame (zero
    // flicker at the handoff), and skip straight to the ball phase.
    if (startClosed) {
      sweepState = { r: innerR }
      drawCover(sweepState.r)
      runBallPhase()
      return
    }

    this.tweens.add({
      targets: sweepState,
      r: innerR,
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
