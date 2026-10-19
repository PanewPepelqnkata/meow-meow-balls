import Phaser from 'phaser'
import { gameBus } from '../events/gameBus'
import { CartoonButton } from '../../ui/CartoonButton'
import { hudText } from '../../ui/Typography'
import {
  INK,
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  drawFantasyBall,
  drawRainbowBall,
  restContour,
} from '../rendering/BallAppearance'
import { BALL_TIERS, getTier } from '../../config/ballTiers'
import type { BackgroundScene } from './BackgroundScene'
import type { ThemeName } from '../rendering/BackgroundTheme'
import { loadSave, resetSave, setThemeSetting } from '../state/save'
import { runVariantFor, variantIdFor, VARIANT_COUNT } from '../state/runVariant'
import { session } from '../state/session'
import { bakeCanvas, roundedRectPath } from '../rendering/RoughArt'
import { bakeIrisCover } from './StartIntroScene'
import { StartIntroScene } from './StartIntroScene'

/**
 * Phase 2.14.0 (spec §2) — the START SCREEN.
 * Phase 2.15.0 (spec §2) — redesigned as a full cartoon game HOME SCREEN.
 * Phase 2.16.0 — GUMBALL MACHINE edition + dedicated menu background.
 *
 * A Phaser scene (not HTML) rendered ABOVE every other scene. While the
 * menu is up the gameplay scenes (PlaygroundScene + UIScene HUD) are
 * COMPLETELY HIDDEN — no double-container on screen — and this scene owns
 * its own backdrop (painted ink gradient over the themed background sky).
 * On PLAY the gameplay scenes are revealed under the menu's fade-out.
 *
 * The home screen is a real game front-end, not a button stack:
 *
 *   · A per-letter cartoon wordmark — every "BALL RUSH" letter is its own
 *     bouncy tilted text in a cycling tier palette, gently bobbing.
 *   · A large cartoon GUMBALL VENDING MACHINE — a transparent glass globe
 *     packed with colorful ball characters (the shared look pipeline), a
 *     red dispenser base with coin slot, knob and chute, thick black
 *     hand-drawn (RoughJS) outlines — gently bobbing; the star gumball
 *     blinks.
 *   · A large, pulsing PLAY button below the machine (the primary action).
 *   · LEADERBOARD / JOURNAL / COLLECTION / SETTINGS as chunky outlined
 *     CartoonButtons — a 2×2 grid in portrait, a bottom row in landscape.
 *   · A compact stats chip: lifetime best score + discovered tiers.
 *
 * The composition adapts intentionally: portrait (vw ≤ vh or narrow) is a
 * centered flow (logo → machine → PLAY → grid → stats chip); landscape
 * spreads the same elements across the wide viewport with the nav as a
 * bottom row and the chip under the logo. Every element is laid out from
 * measured sizes with safe-area margins — nothing clips at 320×568 …
 * 1728×864.
 *
 *   PLAY         → reveal gameplay + fade-out, input unlocks ('ui:start').
 *   LEADERBOARD  → lifetime top runs (persisted save).
 *   JOURNAL      → the DISCOVERY LOG: every ball look met, with dates.
 *   COLLECTION   → the COLLECTED gallery: tier cards + the rare
 *                  randomized tier 8–9 variant hunt.
 *   SETTINGS     → theme (auto/fixed) + reset progress.
 *
 * Restarts never re-show the menu: this scene launches once per game boot
 * and stops itself for good when PLAY is pressed.
 * `?fastboot=1` (dev-only) never launches this scene.
 */

const CREAM = '#fff6e0'
const YELLOW = '#ffeb3b'
const DIM = '#8b90a3'

type ScreenName = 'menu' | 'journal' | 'leaderboard' | 'settings' | 'collection'

interface CastBall {
  c: Phaser.GameObjects.Container
  g: Phaser.GameObjects.Graphics
  tier: number
  r: number
  baseX: number
  baseY: number
  phase: number
  speed: number
  amp: number
  sway: number
  blink: boolean
  blinkClosed: boolean
}

export class TitleScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container
  private menuLayer!: Phaser.GameObjects.Container
  /** The menu's OWN background: an ink gradient baked per viewport size. */
  private backdropImg: Phaser.GameObjects.Image | null = null
  private panelLayer!: Phaser.GameObjects.Container
  private panelBackdrop!: Phaser.GameObjects.Graphics
  /** Persistent panel chrome: backdrop + BACK button (never wiped). */
  private panelContent!: Phaser.GameObjects.Container
  /** Panel content rebuilt on every open (data may have changed). */
  private cast: CastBall[] = []
  private logoC!: Phaser.GameObjects.Container
  private logoBaseY = 0
  private logoImg: Phaser.GameObjects.Image | null = null
  private chipRect: { x: number; y: number; w: number; h: number } | null = null
  /** The PLAY button's container — pulsed gently every frame. */
  private playC: Phaser.GameObjects.Container | null = null
  /** The gumball machine (bobbed gently every frame). */
  private machineC: Phaser.GameObjects.Container | null = null
  private machineBaseY = 0
  private blinkT = 1800
  private menuRects: Array<{
    label: string
    x: number
    y: number
    w: number
    h: number
    screen: 'menu' | 'panel' | 'settings'
  }> = []
  private panelRects: Array<{
    label: string
    x: number
    y: number
    w: number
    h: number
    screen: 'menu' | 'panel' | 'settings'
  }> = []
  private screen: ScreenName = 'menu'
  private closed = false
  private resetArmed = 0
  private offs: Array<() => void> = []

  constructor() {
    super('TitleScene')
  }

  /** HiDPI camera: zoom = display scale, centered on the CSS midpoint. */
  private applyDprCamera(): void {
    const z = this.game.scale.displayScale.x
    const cssW = this.scale.width / z
    const cssH = this.scale.height / z
    this.cameras.main.setZoom(z)
    this.cameras.main.centerOn(cssW / 2, cssH / 2)
  }

  create(): void {
    this.closed = false
    this.screen = 'menu'
    // HiDPI camera setup; reapplied on resize (buildAll relayouts in CSS
    // coordinates — the camera handles the buffer scaling).
    this.applyDprCamera()
    this.resetArmed = 0
    // Phase 2.16.0: the menu owns the screen — the gameplay scenes are
    // COMPLETELY HIDDEN (not merely dimmed), so no second container / HUD
    // can ever show through. They keep running (input-gated), and are
    // revealed again under the fade-out when PLAY is pressed.
    // (PlaygroundScene registers under the key 'playground'.)
    this.scene.setVisible(false, 'playground')
    this.scene.setVisible(false, 'UIScene')
    this.root = this.add.container(0, 0)
    this.menuLayer = this.add.container(0, 0)
    this.root.add(this.menuLayer)
    this.panelLayer = this.add.container(0, 0)
    this.panelLayer.setVisible(false)
    this.root.add(this.panelLayer)
    this.panelBackdrop = this.add.graphics()
    this.panelLayer.add(this.panelBackdrop)
    this.panelContent = this.add.container(0, 0)
    this.panelLayer.add(this.panelContent)

    this.buildAll()
    this.cameras.main.fadeIn(260, 8, 10, 20)

    this.scale.on(Phaser.Scale.Events.RESIZE, this.buildAll, this)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.buildAll, this)
      for (const off of this.offs) off()
      this.offs.length = 0
      // NOTE: the DEV __brMenu hook deliberately SURVIVES the scene stop
      // (visible() reports false via `closed`) so QA can assert the menu
      // never returns; a reload re-registers it anyway.
    })

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__brMenu = {
        visible: () => !this.closed,
        screen: () => this.screen,
        buttons: () => [...this.menuRects, ...this.panelRects].map((b) => ({ ...b })),
        start: () => this.pressStart(),
        // Phase 2.15.0 QA: dump the wordmark letter objects (text, layout,
        // canvas texture size) so visual oddities can be diagnosed from the
        // browser tests without a game instance handle.
        letters: () =>
          (this.logoC.list as Array<Phaser.GameObjects.Text & Phaser.GameObjects.Image>).map(
            (t) => ({
              text: t.text ?? t.texture?.key,
              x: Math.round(t.x),
              y: Math.round(t.y),
              width: Math.round(t.width),
              height: Math.round(t.height),
              displayW: Math.round(t.displayWidth),
              displayH: Math.round(t.displayHeight),
              scale: Math.round(1000 * t.scale) / 1000,
              rotation: Math.round(1000 * t.rotation) / 1000,
            }),
          ),
        // Phase 2.15.0 QA: live home-screen presentation probes (read-only).
        pulse: () => Math.round(1000 * (this.playC?.scale ?? -1)) / 1000,
        cast: () =>
          this.cast.map((b) => ({ x: Math.round(b.c.x), y: Math.round(b.c.y), tier: b.tier })),
        chip: () => (this.chipRect ? { ...this.chipRect } : null),
        logoBox: () =>
          this.logoImg && this.logoImg.texture.key === 'br-wordmark'
            ? {
                w: Math.round(this.logoImg.displayWidth),
                h: Math.round(this.logoImg.displayHeight),
                y: Math.round(this.logoC.y),
              }
            : null,
      }
    }
  }

  override update(time: number): void {
    if (this.closed) return
    const t = time / 1000
    // The machine breathes as one piece — a heavy vending machine sway.
    if (this.machineC) {
      this.machineC.y = this.machineBaseY + Math.sin(t * 0.9) * 4.5
      this.machineC.rotation = Math.sin(t * 0.7) * 0.006
    }
    // The wordmark breathes as one piece (a living logo, not a static line).
    if (this.logoC) {
      this.logoC.y = this.logoBaseY + Math.sin(t * 1.1) * 3.5
      this.logoC.rotation = Math.sin(t * 0.8) * 0.008
    }
    // The showcase cast: each ball bobs in place inside the container art.
    for (const b of this.cast) {
      b.c.x = b.baseX + Math.sin(t * b.speed * 0.7 + b.phase * 1.7) * b.amp * 0.4
      b.c.y = b.baseY + Math.sin(t * b.speed + b.phase) * b.amp
      b.c.rotation = Math.sin(t * b.speed * 0.9 + b.phase) * b.sway
    }
    // The star ball (top of the pile) blinks like the old mascot did.
    const star = this.cast.find((b) => b.blink)
    if (star) {
      this.blinkT -= this.game.loop.delta
      if (this.blinkT <= 0) {
        star.blinkClosed = !star.blinkClosed
        this.blinkT = star.blinkClosed ? 140 : 2200 + Math.random() * 2600
        this.drawCastBall(star)
      }
    }
    // PLAY invites: a slow, gentle pulse (scale 1 → 1.044).
    if (this.playC) this.playC.setScale(1 + Math.sin(t * 2.6) * 0.022 + 0.022)
  }

  // -------------------------------------------------------------------------
  // Build / layout (full rebuild on resize — rare, keeps layout trivial)
  // -------------------------------------------------------------------------

  private buildAll(): void {
    // HiDPI: the camera zooms by displayScale and frames the CSS-px region
    // (0,0)-(cssW,cssH), so the layout must be built in CSS px — the buffer
    // size divided by the display scale. At DPR 1 the two are identical.
    const z = this.game.scale.displayScale.x || 1
    const vw = this.scale.width / z
    const vh = this.scale.height / z

    // Phase 2.16.0: the menu's OWN background — a deep ink gradient with a
    // soft center glow and a hand-sprinkled dust of cream dots, baked once
    // per viewport size. The themed sky glows faintly through (alpha 0.9),
    // so Settings theme picks still read, but the gameplay world never does.
    this.backdropImg?.destroy()
    this.backdropImg = null

    // Rebuild menu + panels from scratch (resize handler). The persistent
    // panel chrome (backdrop, content container, BACK button) is detached —
    // never destroyed — and re-added after the wipe.
    this.panelLayer.remove(this.panelBackdrop)
    this.panelLayer.remove(this.panelContent)
    this.menuLayer.removeAll(true)
    this.panelLayer.removeAll(true)
    this.panelLayer.add(this.panelBackdrop)
    this.panelLayer.add(this.panelContent)
    this.backdropImg = this.buildBackdrop(vw, vh)
    this.menuLayer.addAt(this.backdropImg, 0)
    this.cast.length = 0
    this.menuRects.length = 0
    this.panelRects.length = 0
    this.playC = null
    this.machineC = null
    this.logoImg = null
    this.chipRect = null

    this.buildHome(vw, vh)
    this.buildPanelChrome(vw, vh)
    this.applyScreenVisibility()
  }

  /** The baked ink-gradient backdrop (see buildAll). */
  private buildBackdrop(vw: number, vh: number): Phaser.GameObjects.Image {
    const key = 'br-menu-bg'
    bakeCanvas(this, key, Math.ceil(vw), Math.ceil(vh), (ctx, seed) => {
      const grad = ctx.createLinearGradient(0, 0, 0, vh)
      grad.addColorStop(0, '#1b1d30')
      grad.addColorStop(0.55, '#15162a')
      grad.addColorStop(1, '#0e0f1c')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, vw, vh)
      // A soft warm glow where the machine will sit (center, slightly low).
      const glow = ctx.createRadialGradient(
        vw / 2,
        vh * 0.55,
        10,
        vw / 2,
        vh * 0.55,
        Math.max(vw, vh) * 0.55,
      )
      glow.addColorStop(0, 'rgba(255,190,120,0.10)')
      glow.addColorStop(1, 'rgba(255,190,120,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, vw, vh)
      // Sprinkled cream dots — subtle depth, not noise.
      ctx.fillStyle = 'rgba(255,246,224,0.14)'
      const dots = Math.round((vw * vh) / 26000)
      for (let i = 0; i < dots; i++) {
        const x = (((seed * (i + 7) * 9301 + 49297) % 233280) / 233280) * vw
        const y = (((seed * (i + 13) * 4523 + 7919) % 233280) / 233280) * vh
        const r = 0.8 + ((i * 31) % 5) * 0.35
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }, window.devicePixelRatio || 1)
    const img = this.add.image(0, 0, key).setOrigin(0, 0)
    // The texture is baked at dpr× resolution; display at LOGICAL size —
    // dpr changes bitmap resolution only, never world coordinates.
    img.setDisplaySize(Math.ceil(vw), Math.ceil(vh))
    img.setAlpha(0.9)
    return img
  }

  // -------------------------------------------------------------------------
  // The HOME SCREEN (Phase 2.15.0): wordmark → container showcase → PLAY →
  // nav → stats chip. One intentional composition per orientation.
  // -------------------------------------------------------------------------

  private buildHome(vw: number, vh: number): void {
    const portrait = vh >= vw || vw < 700
    const m = Math.round(Math.max(12, Math.min(22, Math.min(vw, vh) * 0.025)))

    // --- the wordmark (its own container, bobbed in update) ---
    this.logoC = this.add.container(0, 0)
    this.menuLayer.add(this.logoC)
    const logoH = this.buildLogoInto(vw, vh)
    const logoCY = m + 8 + logoH / 2
    this.logoC.setPosition(vw / 2, logoCY)
    this.logoBaseY = logoCY

    // --- measured element sizes ---
    const chipH = Math.round(Math.max(30, Math.min(44, vh * 0.052)))
    const chipW = Math.round(Math.max(170, Math.min(310, Math.min(vw * 0.86, chipH * 7.2))))
    const playH = Math.round(Math.max(52, Math.min(76, vh * 0.085)))
    const playW = portrait
      ? Math.round(Math.max(200, Math.min(340, vw * 0.72)))
      : Math.round(Math.max(220, Math.min(380, vw * 0.3)))
    const navH = portrait
      ? Math.round(Math.max(40, Math.min(56, vh * 0.058)))
      : Math.round(Math.max(44, Math.min(58, vh * 0.062)))
    const navW = portrait
      ? Math.round(Math.max(122, Math.min(215, (vw - 3 * m) / 2)))
      : Math.round(Math.max(150, Math.min(232, (vw - 2 * m - 3 * 12) / 4)))

    if (portrait) {
      // Centered flow, bottom-anchored so the stats chip always sits in the
      // safe area: chip → nav grid (2×2) → PLAY → machine → logo.
      const chipY = vh - m - chipH / 2
      const nav2Y = chipY - chipH / 2 - 12 - navH / 2
      const nav1Y = nav2Y - navH - 10
      const playY = nav1Y - navH / 2 - 12 - playH / 2
      const bandTop = logoCY + logoH / 2 + 10
      const bandBottom = playY - playH / 2 - 10
      this.buildMachine(
        vw / 2,
        (bandTop + bandBottom) / 2,
        bandBottom - bandTop,
        Math.min(vw * 0.6, 340),
      )
      this.buildPlayAndNav(vw, playY, playW, playH, navW, navH, [
        { x: vw / 2 - (navW + 12) / 2, y: nav1Y },
        { x: vw / 2 + (navW + 12) / 2, y: nav1Y },
        { x: vw / 2 - (navW + 12) / 2, y: nav2Y },
        { x: vw / 2 + (navW + 12) / 2, y: nav2Y },
      ])
      this.buildStatsChip(vw / 2, chipY, chipW, chipH)
    } else {
      // Landscape: the wordmark leads, the chip nests under it, the
      // machine fills the middle, PLAY sits above the bottom nav row.
      const navY = vh - m - navH / 2
      const playY = navY - navH / 2 - 14 - playH / 2
      const chipY = logoCY + logoH / 2 + 8 + chipH / 2
      const bandTop = chipY + chipH / 2 + 10
      const bandBottom = playY - playH / 2 - 12
      this.buildMachine(
        vw / 2,
        (bandTop + bandBottom) / 2,
        bandBottom - bandTop,
        Math.min(vw * 0.45, 420),
      )
      this.buildPlayAndNav(vw, playY, playW, playH, navW, navH, [
        { x: vw / 2 - 1.5 * (navW + 12), y: navY },
        { x: vw / 2 - 0.5 * (navW + 12), y: navY },
        { x: vw / 2 + 0.5 * (navW + 12), y: navY },
        { x: vw / 2 + 1.5 * (navW + 12), y: navY },
      ])
      this.buildStatsChip(vw / 2, chipY, chipW, chipH)
    }
  }

  /**
   * Builds the whole cartoon wordmark as ONE managed canvas texture (into
   * an Image inside `logoC`, positioned by the caller) and returns the
   * layout height. Per-letter color cycling, bouncy baselines and
   * alternating tilts are BAKED into the paint — a logo, not a text line.
   * The texture is repainted (same key, replaced under the same key) on
   * every resize rebuild; a single texture also survives every viewport,
   * down to 320px.
   *
   * WHY ONE OWNED CANVAS: Phaser.Text measured-canvas rendering mangled
   * several 72px Lilita glyphs into chunks/blobs (measured advances don't
   * cover every glyph's ink/stroke spill), no matter the stroke, shadow or
   * padding. Painting straight into a managed canvas with exact ink-box
   * sizing reproduces the identical style pixel-perfect at every size —
   * verified in-browser against the same font (qa/_probe font test).
   */
  private buildLogoInto(vw: number, vh: number): number {
    const palette = ['#ffeb3b', '#ff8a3d', '#4fc3f7', '#43d64f', '#ff6fa5']
    const size = Math.max(30, Math.min(72, Math.min(vw * 0.115, vh * 0.1)))
    const stroke = Math.max(4, Math.min(6, size * 0.11))
    const m = Math.ceil(stroke / 2) + 2 // ink margin around every glyph ink box
    const font = `${Math.round(size)}px "Lilita One", "Arial Black", sans-serif`
    // Pass 1 — measure: advances (stepping), tallest ink ascent/descent,
    // total ink width (advances + gaps + the wide gap between the words).
    const paint = document.createElement('canvas').getContext('2d')!
    paint.font = font
    const advances: number[] = []
    let maxAsc = 0
    let maxDesc = 0
    for (const ch of 'BALLRUSH') {
      const met = paint.measureText(ch)
      advances.push(met.width)
      maxAsc = Math.max(maxAsc, Math.ceil(met.actualBoundingBoxAscent))
      maxDesc = Math.max(maxDesc, Math.ceil(met.actualBoundingBoxDescent))
    }
    const gap = size * 0.13
    const wordGap = size * 0.4
    const total = advances.reduce((s, w) => s + w, 0) + gap * (advances.length - 1) + wordGap
    const wave = size * 0.08 // bouncy-baseline amplitude + tilt swing margin
    const cW = Math.ceil(total) + 2 * m
    const cH = maxAsc + maxDesc + 2 * m + Math.ceil(2 * wave)
    const baselineY = m + wave + maxAsc // sane resting baseline within the canvas
    // Pass 2 — paint: one glyph at a time with its cycle color, a bouncy
    // baseline and an alternating tilt (the pen pivot = typographic base).
    const dpr = window.devicePixelRatio || 1
    paint.canvas.width = cW * dpr
    paint.canvas.height = cH * dpr
    paint.scale(dpr, dpr)
    paint.font = font
    paint.lineJoin = 'round'
    paint.lineCap = 'round'
    paint.textBaseline = 'alphabetic'
    let x = m
    for (let i = 0; i < advances.length; i++) {
      const penY = baselineY + Math.sin(i * 1.05) * size * 0.06
      // The single word gap: between "BALL" and "RUSH" (index 4).
      if (i === 4) x += wordGap
      paint.save()
      paint.translate(x + advances[i]! / 2, penY)
      paint.rotate((i % 2 === 0 ? 1 : -1) * 0.055)
      paint.strokeStyle = '#111111'
      paint.lineWidth = stroke
      paint.strokeText('BALLRUSH'[i]!, -advances[i]! / 2, 0)
      paint.fillStyle = palette[i % palette.length]!
      paint.fillText('BALLRUSH'[i]!, -advances[i]! / 2, 0)
      paint.restore()
      x += advances[i]! + gap
    }
    const key = 'br-wordmark'
    if (this.textures.exists(key)) this.textures.remove(key)
    this.textures.addCanvas(key, paint.canvas)
    const image = this.add.image(0, 0, key)
    // Baked at dpr× — display at logical size.
    image.setDisplaySize(cW, cH)
    this.logoImg = image
    this.logoC.add(image)
    const sub = hudText(this, 0, 0, 'soft-body merge rush', 1, {
      color: CREAM,
      size: Math.max(12, Math.min(20, vw * 0.021)),
      stroke: 3,
      origin: [0.5, 0.5],
      shadow: false,
    })
    sub.setAlpha(0.9)
    sub.setPosition(0, cH / 2 + 12)
    this.logoC.add(sub)
    return cH + 26
  }

  /**
   * Phase 2.16.0 — THE GUMBALL MACHINE (the heart of the home screen).
   * A large cartoon vending machine: transparent glass globe packed with
   * colorful ball characters (the shared look pipeline — the same faces as
   * gameplay), a red dispenser base with coin slot, knob and chute, and
   * thick black hand-drawn (RoughJS) outlines. The static machine body is
   * baked into two canvas textures (back: fills; front: glass rim, sheen,
   * chrome outlines) — regenerated only on resize; the gumballs are live
   * objects bobbing inside a circular mask; the star gumball blinks.
   *
   * `maxH`/`maxW` bound the available layout band; the machine keeps its
   * 100:130 aspect (wide glass globe on a stout base) and centers on
   * (cx, cy).
   */
  private buildMachine(cx: number, cy: number, maxH: number, maxW: number): void {
    // The 150px readability floor must yield to the band: on wide-short
    // viewports a forced 150px machine overflowed into the PLAY button.
    const h = Math.min(maxH, Math.max(150, maxW * 1.3))
    const w = h / 1.3
    const u = w / 100 // logical design unit: machine box is 100 × 130 units
    const key = `${Math.round(w)}x${Math.round(h)}`

    const backImg = this.buildMachineBack(key, w, h, u)
    const frontImg = this.buildMachineFront(key, w, h, u)

    this.machineC = this.add.container(Math.round(cx - w / 2), Math.round(cy - h / 2))
    this.machineBaseY = this.machineC.y
    this.menuLayer.add(this.machineC)

    // --- the gumball cast: colorful characters bobbing inside the globe ---
    // Phaser 4 dropped WebGL geometry masks, so the pile is simply
    // choreographed to stay inside the glass: every ball's reach
    // (position + radius + bob amplitude) is kept within the globe's
    // interior radius — no clipping object needed.
    const ballsC = this.add.container(0, 0)
    this.machineC.add(backImg)
    this.machineC.add(ballsC)
    this.machineC.add(frontImg)

    // The cast (unit coords; globe center (50, 33), interior r ≈ 28;
    // every entry keeps dist-from-center + radius ≤ 29).
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
    pile.forEach((p, i) => {
      const r = p.ur * u
      const gg = this.add.graphics()
      const cc = this.add.container(p.ux * u, p.uy * u, [gg])
      ballsC.add(cc)
      const ball: CastBall = {
        c: cc,
        g: gg,
        tier: p.tier,
        r,
        baseX: p.ux * u,
        baseY: p.uy * u,
        phase: i * 1.7,
        speed: 0.8 + (i % 3) * 0.25,
        amp: Math.max(1.2, r * 0.055),
        sway: 0.035,
        blink: p.blink === true,
        blinkClosed: false,
      }
      this.drawCastBall(ball)
      this.cast.push(ball)
    })
  }

  /** Machine BACK layer: ground shadow, glass interior, red base body. */
  private buildMachineBack(key: string, w: number, h: number, u: number): Phaser.GameObjects.Image {
    bakeCanvas(this, `br-gumball-back:${key}`, Math.ceil(w), Math.ceil(h), (ctx) => {
      // Soft ground shadow — the machine stands IN the scene, not on it.
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.ellipse(50 * u, 126 * u, 30 * u, 5 * u, 0, 0, Math.PI * 2)
      ctx.fill()
      // Glass interior: near-transparent fill + pile shading at the bottom.
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.beginPath()
      ctx.arc(50 * u, 33 * u, 30 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.10)'
      ctx.beginPath()
      ctx.ellipse(50 * u, 52 * u, 23 * u, 10 * u, 0, 0, Math.PI * 2)
      ctx.fill()
      // Red collar between globe and base.
      ctx.fillStyle = '#e23b3b'
      ctx.beginPath()
      ctx.moveTo(39 * u, 60 * u)
      ctx.lineTo(61 * u, 60 * u)
      ctx.lineTo(65 * u, 70 * u)
      ctx.lineTo(35 * u, 70 * u)
      ctx.closePath()
      ctx.fill()
      // Red dispenser base (stout body, slightly rounded).
      ctx.beginPath()
      ctx.moveTo(35 * u, 68 * u)
      ctx.lineTo(65 * u, 68 * u)
      ctx.lineTo(76 * u, 114 * u)
      ctx.quadraticCurveTo(78 * u, 122 * u, 70 * u, 122 * u)
      ctx.lineTo(30 * u, 122 * u)
      ctx.quadraticCurveTo(22 * u, 122 * u, 24 * u, 114 * u)
      ctx.closePath()
      ctx.fill()
      // Darker bottom band — cartoon depth.
      ctx.fillStyle = '#b32626'
      ctx.beginPath()
      ctx.moveTo(74 * u, 108 * u)
      ctx.lineTo(76 * u, 114 * u)
      ctx.quadraticCurveTo(78 * u, 122 * u, 70 * u, 122 * u)
      ctx.lineTo(30 * u, 122 * u)
      ctx.quadraticCurveTo(22 * u, 122 * u, 24 * u, 114 * u)
      ctx.lineTo(26 * u, 108 * u)
      ctx.closePath()
      ctx.fill()
      // Dispenser chute (the gumballs roll out here).
      ctx.fillStyle = '#191919'
      rrPath(ctx, 38 * u, 101 * u, 24 * u, 15 * u, [1 * u, 1 * u, 5 * u, 5 * u])
      ctx.fill()
      // Chute flap: cream door over the lower chute (balls push it open).
      ctx.fillStyle = '#f2eee2'
      rrPath(ctx, 40 * u, 106 * u, 20 * u, 8 * u, 2 * u)
      ctx.fill()
      // Marquee bulbs: candy dots across the red collar.
      const bulbs = ['#ffd93b', '#4fc3f7', '#ff8a3d', '#a98bd8', '#43d64f']
      bulbs.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc((41 + i * 4.5) * u, 65 * u, 1.7 * u, 0, Math.PI * 2)
        ctx.fill()
      })
      // Star sticker on the base's left cheek.
      ctx.fillStyle = '#ffe08a'
      starPath(ctx, 31.5 * u, 96 * u, 2.8 * u)
      ctx.fill()
      // Coin slot.
      rrPath(ctx, 63.5 * u, 78 * u, 4.5 * u, 14 * u, 2.2 * u)
      ctx.fill()
      // Knob.
      ctx.beginPath()
      ctx.arc(37 * u, 85 * u, 5 * u, 0, Math.PI * 2)
      ctx.fill()
      // Feet.
      rrPath(ctx, 23 * u, 122 * u, 11 * u, 5 * u, 2 * u)
      ctx.fill()
      rrPath(ctx, 66 * u, 122 * u, 11 * u, 5 * u, 2 * u)
      ctx.fill()
      // rc/seed unused: the back layer is fully deterministic shapes.
    }, window.devicePixelRatio || 1)
    // Baked at dpr× — display at the LOGICAL w×h (dpr = bitmap res only).
    const backImg = this.add.image(0, 0, `br-gumball-back:${key}`).setOrigin(0, 0)
    backImg.setDisplaySize(Math.ceil(w), Math.ceil(h))
    return backImg
  }

  /** Machine FRONT layer: glass rim, sheen arcs and chrome outlines — clean
   * vector strokes (RoughJS is reserved for the gameplay container). */
  private buildMachineFront(
    key: string,
    w: number,
    h: number,
    u: number,
  ): Phaser.GameObjects.Image {
    bakeCanvas(this, `br-gumball-front:${key}`, Math.ceil(w), Math.ceil(h), (ctx) => {
      const ink = '#111111'
      // Stroke widths clamp to a 3–6px band regardless of machine size — an
      // unclamped u-scale made the big desktop machine's base outline ~15px
      // thick (a dark wedge at every corner).
      const rimW = Math.max(3.2, Math.min(6, u * 1.0))
      const bodyW = Math.max(3, Math.min(5.5, u * 0.85))
      const smallW = Math.max(2.2, Math.min(3.6, u * 0.55))
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = ink
      // Glass rim — the thick circle (center 50u,33u, radius 30.25u).
      ctx.lineWidth = rimW
      ctx.beginPath()
      ctx.arc(50 * u, 33 * u, 30.25 * u, 0, Math.PI * 2)
      ctx.stroke()
      // Glass sheen — two confident strokes top-left, a glint bottom-right.
      const sheen = (rx: number, from: number, to: number, alpha: string, width: number): void => {
        ctx.strokeStyle = alpha
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.ellipse(50 * u, 33 * u, rx, rx, 0, from, to)
        ctx.stroke()
      }
      sheen(
        25 * u,
        Math.PI * 1.02,
        Math.PI * 1.32,
        'rgba(255,255,255,0.55)',
        Math.max(2.6, Math.min(3.5, u * 0.6)),
      )
      sheen(
        21.5 * u,
        Math.PI * 1.08,
        Math.PI * 1.22,
        'rgba(255,255,255,0.4)',
        Math.max(2.2, Math.min(3, u * 0.5)),
      )
      sheen(
        26 * u,
        Math.PI * 0.28,
        Math.PI * 0.4,
        'rgba(255,255,255,0.30)',
        Math.max(2, Math.min(2.8, u * 0.45)),
      )
      // Collar outline.
      ctx.strokeStyle = ink
      ctx.lineWidth = bodyW
      ctx.beginPath()
      ctx.moveTo(39 * u, 60 * u)
      ctx.lineTo(61 * u, 60 * u)
      ctx.lineTo(65 * u, 70 * u)
      ctx.lineTo(35 * u, 70 * u)
      ctx.closePath()
      ctx.stroke()
      // Base outline (rounded body) + chute lip + coin slot — the same SVG
      // paths, stroked directly via Path2D.
      ctx.lineWidth = bodyW
      ctx.stroke(
        new Path2D(
          `M ${35 * u} ${68 * u} L ${65 * u} ${68 * u} L ${76 * u} ${114 * u} Q ${78 * u} ${122 * u} ${70 * u} ${122 * u} L ${30 * u} ${122 * u} Q ${22 * u} ${122 * u} ${24 * u} ${114 * u} Z`,
        ),
      )
      ctx.lineWidth = smallW
      ctx.stroke(
        new Path2D(
          `M ${38 * u} ${101 * u} L ${38 * u} ${110 * u} Q ${38 * u} ${116 * u} ${44 * u} ${116 * u} L ${56 * u} ${116 * u} Q ${62 * u} ${116 * u} ${62 * u} ${110 * u} L ${62 * u} ${101 * u}`,
        ),
      )
      ctx.stroke(new Path2D(roundedRectPath(62.5 * u, 78 * u, 4.5 * u, 14 * u, 2.2 * u)))
      ctx.beginPath()
      ctx.arc(37 * u, 85 * u, 5 * u, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = Math.max(1.8, Math.min(2.6, u * 0.4))
      ctx.beginPath()
      ctx.arc(37 * u, 85 * u, 2.2 * u, 0, Math.PI * 2)
      ctx.stroke()
      // Cream pinstripe where the collar meets the base.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 1.4 * u
      ctx.beginPath()
      ctx.moveTo(33.8 * u, 73 * u)
      ctx.lineTo(66.2 * u, 73 * u)
      ctx.stroke()
      // Chute flap: ink outline + handle bar.
      ctx.strokeStyle = ink
      ctx.lineWidth = smallW * 0.85
      rrPath(ctx, 40 * u, 106 * u, 20 * u, 8 * u, 2 * u)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(46 * u, 110 * u)
      ctx.lineTo(54 * u, 110 * u)
      ctx.stroke()
      // Feet ink outlines.
      ctx.lineWidth = smallW * 0.8
      rrPath(ctx, 23 * u, 122 * u, 11 * u, 5 * u, 2 * u)
      ctx.stroke()
      rrPath(ctx, 66 * u, 122 * u, 11 * u, 5 * u, 2 * u)
      ctx.stroke()
      // Glass sparkles: two four-point stars on the globe.
      const sparkle = (cx: number, cy: number, s: number, alpha: number): void => {
        ctx.fillStyle = `rgba(255,255,255,${alpha})`
        ctx.beginPath()
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 4
          const rad = i % 2 === 0 ? s : s * 0.28
          const x = cx + Math.cos(a) * rad
          const y = cy + Math.sin(a) * rad
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fill()
      }
      sparkle(66 * u, 17 * u, 3.2 * u, 0.55)
      sparkle(31 * u, 13 * u, 2 * u, 0.45)
      // Star sticker outline.
      ctx.strokeStyle = ink
      ctx.lineWidth = Math.max(1, 1.1 * u)
      starPath(ctx, 31.5 * u, 96 * u, 2.8 * u)
      ctx.stroke()
    }, window.devicePixelRatio || 1)
    // Baked at dpr× — display at the LOGICAL w×h (dpr = bitmap res only).
    const frontImg = this.add.image(0, 0, `br-gumball-front:${key}`).setOrigin(0, 0)
    frontImg.setDisplaySize(Math.ceil(w), Math.ceil(h))
    return frontImg
  }

  private drawCastBall(ball: CastBall): void {
    ball.g.clear()
    drawBallIcon(this, ball.g, ball.tier, 0, 0, ball.r, {
      seed: 4242 + ball.tier * 7,
      blink: ball.blinkClosed,
    })
  }

  /** PLAY (primary, pulsing) + the four nav buttons at explicit positions. */
  private buildPlayAndNav(
    vw: number,
    playY: number,
    playW: number,
    playH: number,
    navW: number,
    navH: number,
    navPos: Array<{ x: number; y: number }>,
  ): void {
    const play = new CartoonButton(this, {
      x: vw / 2,
      y: playY,
      w: playW,
      h: playH,
      fill: 0x43d64f,
      label: 'PLAY',
      labelSize: Math.max(17, playH * 0.34),
      style: 'doodle',
      onPress: () => this.pressStart(),
    })
    if (play.containerObj) {
      this.menuLayer.add(play.containerObj)
      this.playC = play.containerObj
    }
    this.menuRects.push({
      label: 'PLAY',
      x: vw / 2 - playW / 2,
      y: playY - playH / 2,
      w: playW,
      h: playH,
      screen: 'menu',
    })

    const defs: Array<{ label: string; fill: number; screen: ScreenName }> = [
      { label: 'LEADERBOARD', fill: 0xffd93b, screen: 'leaderboard' },
      { label: 'JOURNAL', fill: 0x4fc3f7, screen: 'journal' },
      { label: 'COLLECTION', fill: 0xff8a3d, screen: 'collection' },
      { label: 'SETTINGS', fill: 0xa98bd8, screen: 'settings' },
    ]
    defs.forEach((d, i) => {
      const pos = navPos[i]!
      const btn = new CartoonButton(this, {
        x: pos.x,
        y: pos.y,
        w: navW,
        h: navH,
        fill: d.fill,
        label: d.label,
        labelSize: Math.max(10, navH * (navW < 150 ? 0.2 : 0.24)),
        style: 'doodle',
        onPress: () => this.openScreen(d.screen),
      })
      if (btn.containerObj) this.menuLayer.add(btn.containerObj)
      this.menuRects.push({
        label: d.label,
        x: pos.x - navW / 2,
        y: pos.y - navH / 2,
        w: navW,
        h: navH,
        screen: 'menu',
      })
    })
  }

  /** Compact lifetime stats: best score + discovered tiers (a progress
   * pill with the highest discovered ball as its icon). */
  private buildStatsChip(cx: number, cy: number, w: number, h: number): void {
    const save = loadSave()
    const TOTAL_TIERS = BALL_TIERS.length
    const discovered = Object.keys(save.discovered)
      .map(Number)
      .filter((t) => t >= 1 && t <= TOTAL_TIERS)
    const got = discovered.length
    const bestTier = discovered.length ? Math.max(...discovered) : 1
    this.chipRect = { x: cx - w / 2, y: cy - h / 2, w, h }
    const g = this.add.graphics()
    this.menuLayer.add(g)
    g.fillStyle(0x181a28, 0.92)
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2)
    // Clean vector ink outline.
    g.lineStyle(3, 0x111111, 1)
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2)

    const label = hudText(this, 0, 0, 'BEST', 1, {
      color: YELLOW,
      size: Math.max(10, h * 0.34),
      stroke: 2,
      origin: [1, 0.5],
      shadow: false,
    })
    label.setPosition(cx - w * 0.24, cy)
    this.menuLayer.add(label)
    const score = hudText(this, 0, 0, `${save.best}`, 1, {
      color: '#ffffff',
      size: Math.max(13, h * 0.5),
      stroke: 3,
      origin: [0, 0.5],
      shadow: false,
    })
    score.setPosition(cx - w * 0.2, cy)
    this.menuLayer.add(score)

    const dot = hudText(this, 0, 0, '·', 1, {
      color: '#565a72',
      size: h * 0.55,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    dot.setPosition(cx + w * 0.02, cy)
    this.menuLayer.add(dot)

    drawBallIcon(this, g, bestTier, cx + w * 0.13, cy, h * 0.3, { seed: 991 * bestTier })
    const tiers = hudText(this, 0, 0, `${got}/${TOTAL_TIERS}`, 1, {
      color: CREAM,
      size: Math.max(13, h * 0.5),
      stroke: 3,
      origin: [0, 0.5],
      shadow: false,
    })
    tiers.setPosition(cx + w * 0.2, cy)
    this.menuLayer.add(tiers)
  }

  // -------------------------------------------------------------------------
  // Panels (Journal / Leaderboard / Settings / Collection)
  // -------------------------------------------------------------------------

  private buildPanelChrome(vw: number, vh: number): void {
    this.panelBackdrop.clear()
    this.panelBackdrop.fillStyle(0x0b0c16, 0.88)
    this.panelBackdrop.fillRect(0, 0, vw, vh)

    // BACK is PERSISTENT panel chrome — it lives in panelLayer (not the
    // content layer), so opening/reopening screens never destroys it.
    const backX = Math.max(64, vw * 0.085)
    const backY = Math.max(34, vh * 0.055)
    const back = new CartoonButton(this, {
      x: backX,
      y: backY,
      w: 118,
      h: 40,
      fill: 0x51566b,
      icon: Icons.back,
      label: 'BACK',
      labelSize: 14,
      onPress: () => this.openScreen('menu'),
    })
    if (back.containerObj) this.panelLayer.add(back.containerObj)
    this.panelRects.push({
      label: 'BACK',
      x: backX - 59,
      y: backY - 20,
      w: 118,
      h: 40,
      screen: 'panel',
    })
  }

  private openScreen(screen: ScreenName): void {
    if (this.closed) return
    this.screen = screen
    this.applyScreenVisibility()
  }

  private applyScreenVisibility(): void {
    const isMenu = this.screen === 'menu'
    this.panelLayer.setVisible(!isMenu)
    this.menuLayer.setVisible(isMenu)
    if (isMenu) return
    // Rebuild the open panel's CONTENT fresh (data may have changed). Only
    // the persistent BACK rect survives; screen-specific buttons (theme
    // pickers, reset) re-register as they are created.
    this.panelContent.removeAll(true)
    this.panelRects.length = 1
    // HiDPI: CSS-px layout, matching buildAll (camera frames the CSS region).
    const z = this.game.scale.displayScale.x || 1
    const vw = this.scale.width / z
    const vh = this.scale.height / z
    const headSize = Math.max(24, Math.min(44, vw * 0.045))
    const head = hudText(this, 0, 0, this.screen.toUpperCase(), 1, {
      color: YELLOW,
      size: headSize,
      stroke: 5,
      origin: [0.5, 0],
    })
    head.setPosition(vw / 2, vh * 0.045)
    this.panelContent.add(head)
    // Phase 2.15.0: a one-line purpose statement under each header, so
    // Journal (discovery log) and Collection (collected balls + the rare
    // variant hunt) read as distinct screens at a glance. (The menu screen
    // has no header — applyScreenVisibility returns early for it.)
    const subs: Partial<Record<ScreenName, string>> = {
      journal: 'every ball look you have discovered — variants included',
      leaderboard: 'your ten best runs',
      settings: 'theme, progress and data',
      collection: 'your collected balls — hunt the rare tier 8–9 variants',
    }
    const sub = hudText(this, 0, 0, subs[this.screen] ?? '', 1, {
      color: '#aeb4c9',
      size: Math.max(11, Math.min(16, vw * 0.019)),
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    sub.setAlpha(0.9)
    sub.setPosition(vw / 2, vh * 0.045 + headSize + 6)
    this.panelContent.add(sub)
    switch (this.screen) {
      case 'journal':
        this.buildJournal(vw, vh)
        break
      case 'leaderboard':
        this.buildLeaderboard(vw, vh)
        break
      case 'settings':
        this.buildSettings(vw, vh)
        break
      case 'collection':
        this.buildCollection(vw, vh)
        break
    }
  }

  private buildJournal(vw: number, vh: number): void {
    const save = loadSave()
    const TOTAL_TIERS = BALL_TIERS.length
    const wide = vw >= 700
    const cols = wide ? 2 : 1
    const perCol = Math.ceil(TOTAL_TIERS / cols)
    const rowH = Math.min(92, (vh * 0.8) / (perCol + 0.5))
    const colW = Math.min(430, (vw * 0.86) / cols)
    const startX = vw / 2 - (cols * colW + (cols - 1) * 24) / 2 + colW / 2
    const topY = vh * 0.165

    for (let tier = 1; tier <= TOTAL_TIERS; tier++) {
      const col = Math.floor((tier - 1) / perCol)
      const row = (tier - 1) % perCol
      const cx = startX + col * (colW + 24)
      const cy = topY + row * rowH + rowH / 2
      const discovered = save.discovered[String(tier)] != null
      const locked = tier >= 10
      const g = this.add.graphics()
      this.panelContent.add(g)

      // Card
      g.fillStyle(0x181a28, discovered ? 0.95 : 0.7)
      g.fillRoundedRect(cx - colW / 2 + 6, cy - rowH / 2 + 6, colW - 12, rowH - 12, 12)
      g.lineStyle(2.5, 0x2a2d42, 1)
      g.strokeRoundedRect(cx - colW / 2 + 6, cy - rowH / 2 + 6, colW - 12, rowH - 12, 12)

      const iconR = Math.min(30, rowH * 0.33)
      drawBallIcon(this, g, tier, cx - colW / 2 + 6 + iconR + 14, cy, iconR, {
        silhouette: !discovered || locked,
        variant: discovered && !locked ? runVariantFor(tier) : null,
        seed: tier * 7717,
        layer: this.panelContent,
      })

      const label = hudText(this, 0, 0, `TIER ${tier}`, 1, {
        color: discovered ? CREAM : DIM,
        size: Math.max(13, Math.min(19, colW * 0.05)),
        stroke: 3,
        origin: [0, 0.5],
        shadow: false,
      })
      label.setPosition(cx - colW / 2 + 6 + iconR * 2 + 26, cy - rowH * 0.22)
      this.panelContent.add(label)

      let status: string
      if (locked)
        status = tier === TOTAL_TIERS ? 'LOCKED — the final secret' : 'reserved — not yet made'
      else if (!discovered) status = 'not yet discovered'
      else status = `discovered ${fmtDate(save.discovered[String(tier)]!)}`
      const st = hudText(this, 0, 0, status, 1, {
        color: discovered && !locked ? '#aeb4c9' : DIM,
        size: Math.max(11, Math.min(15, colW * 0.038)),
        stroke: 2,
        origin: [0, 0.5],
        shadow: false,
      })
      st.setPosition(cx - colW / 2 + 6 + iconR * 2 + 26, cy + rowH * 0.18)
      this.panelContent.add(st)

      // Tiers 8–9: the collected per-run VARIANTS row.
      if (tier === 8 || tier === 9) {
        const chips: number[] = []
        for (let v = 0; v < VARIANT_COUNT; v++) {
          if (save.variants[`${tier}:${v}`] != null) chips.push(v)
        }
        const chipG = this.add.graphics()
        this.panelContent.add(chipG)
        const chipR = Math.max(9, rowH * 0.1)
        const chipY = cy + rowH * 0.26
        let hx = cx + colW / 2 - 14 - (VARIANT_COUNT * (chipR * 2 + 5) - 5)
        for (let v = 0; v < VARIANT_COUNT; v++) {
          const got = chips.includes(v)
          if (got) {
            drawBallIcon(this, chipG, tier, hx, chipY, chipR, {
              variant: v,
              seed: tier * 7717 + v,
              layer: this.panelContent,
            })
          } else {
            chipG.lineStyle(2, 0x3a3d55, 1)
            chipG.strokeCircle(hx, chipY, chipR)
            const q = hudText(this, 0, 0, '?', 1, {
              color: '#3a3d55',
              size: chipR * 1.5,
              stroke: 0,
              origin: [0.5, 0.5],
              shadow: false,
            })
            q.setPosition(hx, chipY + 1)
            this.panelContent.add(q)
          }
          hx += chipR * 2 + 5
        }
      }
    }
  }

  private buildLeaderboard(vw: number, vh: number): void {
    const save = loadSave()
    const rows = save.leaderboard.slice(0, 10)
    const w = Math.min(560, vw * 0.9)
    const topY = vh * 0.165
    const rowH = Math.min(58, (vh * 0.72) / Math.max(rows.length, 5))

    if (rows.length === 0) {
      const empty = hudText(this, 0, 0, 'No runs yet — go make a mess!', 1, {
        color: '#aeb4c9',
        size: Math.max(15, Math.min(24, vw * 0.03)),
        stroke: 3,
        origin: [0.5, 0.5],
        shadow: false,
      })
      empty.setPosition(vw / 2, vh * 0.42)
      this.panelContent.add(empty)
      return
    }

    rows.forEach((e, i) => {
      const y = topY + rowH * 0.4 + i * rowH
      const g = this.add.graphics()
      this.panelContent.add(g)
      const rank = i + 1
      const medal = rank === 1 ? 0xffd93b : rank === 2 ? 0xc9d1e3 : rank === 3 ? 0xd08a4e : 0x272a40
      g.fillStyle(medal, 1)
      g.fillRoundedRect(vw / 2 - w / 2, y - rowH / 2 + 5, w, rowH - 10, 10)
      g.lineStyle(2, rank <= 3 ? INK : 0x2a2d42, 1)
      g.strokeRoundedRect(vw / 2 - w / 2, y - rowH / 2 + 5, w, rowH - 10, 10)

      const rankT = hudText(this, 0, 0, `#${rank}`, 1, {
        color: rank <= 3 ? '#1a1a1a' : '#aeb4c9',
        size: rowH * 0.42,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      rankT.setPosition(vw / 2 - w / 2 + 34, y)
      this.panelContent.add(rankT)

      // Best tier badge — the run's signature ball.
      const badgeR = Math.min(17, rowH * 0.3)
      drawBallIcon(this, g, Math.max(1, Math.min(12, e.bestTier)), vw / 2 - w / 2 + 78, y, badgeR, {
        seed: e.bestTier * 991,
        layer: this.panelContent,
      })

      const scoreT = hudText(this, 0, 0, `${e.score}`, 1, {
        color: '#ffffff',
        size: rowH * 0.44,
        stroke: 3,
        origin: [0, 0.5],
        shadow: false,
      })
      scoreT.setPosition(vw / 2 - w / 2 + 106, y - rowH * 0.1)
      this.panelContent.add(scoreT)

      const when = hudText(this, 0, 0, fmtDate(e.at), 1, {
        color: rank <= 3 ? '#3a2f16' : '#aeb4c9',
        size: Math.max(11, rowH * 0.2),
        stroke: 0,
        origin: [1, 0.5],
        shadow: false,
      })
      when.setPosition(vw / 2 + w / 2 - 16, y + rowH * 0.18)
      this.panelContent.add(when)
    })
  }

  private buildSettings(vw: number, vh: number): void {
    const save = loadSave()
    const w = Math.min(560, vw * 0.9)
    const x = vw / 2
    let y = vh * 0.2

    const themeHead = hudText(this, 0, 0, 'BACKGROUND THEME', 1, {
      color: CREAM,
      size: Math.max(14, Math.min(20, vw * 0.026)),
      stroke: 3,
      origin: [0.5, 0.5],
      shadow: false,
    })
    themeHead.setPosition(x, y)
    this.panelContent.add(themeHead)
    y += 46

    const themes: Array<{ key: 'auto' | ThemeName; label: string }> = [
      { key: 'auto', label: 'AUTO' },
      { key: 'light', label: 'LIGHT' },
      { key: 'space', label: 'SPACE' },
      { key: 'jungle', label: 'JUNGLE' },
      { key: 'fantasy', label: 'FANTASY' },
    ]
    const bw = Math.min(112, (w - 4 * 10) / 5)
    themes.forEach((t, ti) => {
      const selected = save.settings.theme === t.key
      const bx = x - (5 * bw + 4 * 10) / 2 + bw / 2 + ti * (bw + 10)
      const btn = new CartoonButton(this, {
        x: bx,
        y,
        w: bw,
        h: 46,
        fill: selected ? 0x43d64f : 0x51566b,
        icon: Icons.palette,
        label: t.label,
        labelSize: Math.max(10, bw * 0.19),
        onPress: () => {
          setThemeSetting(t.key)
          const bg = this.scene.get('BackgroundScene') as BackgroundScene | undefined
          if (bg) {
            if (t.key === 'auto') bg.resetTheme()
            else bg.setTheme(t.key as ThemeName, 400)
          }
          this.applyScreenVisibility()
        },
      })
      if (btn.containerObj) this.panelContent.add(btn.containerObj)
      this.panelRects.push({
        label: `THEME_${t.key.toUpperCase()}`,
        x: bx - bw / 2,
        y: y - 23,
        w: bw,
        h: 46,
        screen: 'settings',
      })
    })
    const note = hudText(this, 0, 0, 'AUTO follows the run progression', 1, {
      color: '#8b90a3',
      size: Math.max(11, Math.min(15, vw * 0.02)),
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    note.setPosition(x, y + 30)
    this.panelContent.add(note)
    y += 96

    const stats = save.stats
    const statLine = hudText(
      this,
      0,
      0,
      `${stats.runs} runs   ·   ${stats.merges} merges   ·   best tier T${stats.bestTier || 1}`,
      1,
      {
        color: '#aeb4c9',
        size: Math.max(12, Math.min(18, vw * 0.024)),
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      },
    )
    statLine.setPosition(x, y)
    this.panelContent.add(statLine)
    y += 58

    // Reset progress — press once to arm (warning), twice to wipe.
    const resetBtn = new CartoonButton(this, {
      x,
      y,
      w: Math.min(300, w),
      h: 48,
      fill: this.resetArmed > 0 ? 0xe5484d : 0x51566b,
      icon: Icons.trash,
      label: this.resetArmed > 0 ? 'TAP AGAIN TO WIPE' : 'RESET PROGRESS',
      labelSize: 14,
      onPress: () => {
        const now = Date.now()
        if (this.resetArmed > 0 && now - this.resetArmed < 4000) {
          resetSave()
          this.resetArmed = 0
          const bg = this.scene.get('BackgroundScene') as BackgroundScene | undefined
          bg?.resetTheme()
          this.applyScreenVisibility()
        } else {
          this.resetArmed = now
          this.applyScreenVisibility()
        }
      },
    })
    if (resetBtn.containerObj) this.panelContent.add(resetBtn.containerObj)
    this.panelRects.push({
      label: 'RESET',
      x: x - Math.min(300, w) / 2,
      y: y - 24,
      w: Math.min(300, w),
      h: 48,
      screen: 'settings',
    })
    const wipe = hudText(
      this,
      0,
      0,
      'Clears best score, journal, leaderboard and stats (this browser).',
      1,
      {
        color: '#8b90a3',
        size: Math.max(10, Math.min(14, vw * 0.019)),
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      },
    )
    wipe.setPosition(x, y + 30)
    this.panelContent.add(wipe)
  }

  private buildCollection(vw: number, vh: number): void {
    const save = loadSave()
    const discovered = new Set(Object.keys(save.discovered).map(Number))
    const total = BALL_TIERS.length
    const got = [...discovered].filter((t) => t >= 1 && t <= total).length

    const progress = hudText(this, 0, 0, `${got} / ${total} DISCOVERED`, 1, {
      color: CREAM,
      size: Math.max(15, Math.min(24, vw * 0.03)),
      stroke: 4,
      origin: [0.5, 0],
    })
    progress.setPosition(vw / 2, vh * 0.135)
    this.panelContent.add(progress)

    // Progress bar.
    const barW = Math.min(460, vw * 0.76)
    const bar = this.add.graphics()
    this.panelContent.add(bar)
    bar.fillStyle(0x272a40, 1)
    bar.fillRoundedRect(vw / 2 - barW / 2, vh * 0.135 + 34, barW, 14, 7)
    if (got > 0) {
      bar.fillStyle(0x43d64f, 1)
      bar.fillRoundedRect(
        vw / 2 - barW / 2,
        vh * 0.135 + 34,
        Math.max(14, (barW * got) / total),
        14,
        7,
      )
    }

    const cols = vw >= 760 ? 5 : vw >= 480 ? 4 : 3
    const cardW = Math.min(140, (vw * 0.88) / cols)
    const rows = Math.ceil(total / cols)
    // Phase 2.15.0: the grid shares the panel with the tier 8–9 variant
    // showcase below it, so it gets a bounded share of the height.
    const cardH = Math.min(150, (vh * 0.42) / rows)
    const topY = vh * 0.205

    for (let tier = 1; tier <= total; tier++) {
      const i = tier - 1
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = vw / 2 + (col - (cols - 1) / 2) * (cardW + 12)
      const cy = topY + row * (cardH + 12) + cardH / 2
      const t = getTier(tier)!
      const has = discovered.has(tier)
      const locked = tier >= 10
      const g = this.add.graphics()
      this.panelContent.add(g)
      g.fillStyle(has && !locked ? 0x181a28 : 0x141622, has ? 0.95 : 0.75)
      g.fillRoundedRect(cx - cardW / 2 + 4, cy - cardH / 2 + 4, cardW - 8, cardH - 8, 12)
      g.lineStyle(
        2.5,
        has && !locked ? (tier === 8 || tier === 9 ? t.color : 0x2a2d42) : 0x23252f,
        1,
      )
      g.strokeRoundedRect(cx - cardW / 2 + 4, cy - cardH / 2 + 4, cardW - 8, cardH - 8, 12)

      const iconR = Math.min(cardH * 0.34, cardW * 0.3)
      drawBallIcon(this, g, tier, cx, cy - cardH * 0.06, iconR, {
        silhouette: !has || locked,
        variant: has && !locked ? runVariantFor(tier) : null,
        seed: tier * 7717,
        layer: this.panelContent,
      })

      const name = hudText(this, 0, 0, `T${tier}`, 1, {
        color: has ? CREAM : DIM,
        size: Math.max(12, Math.min(18, cardW * 0.13)),
        stroke: 3,
        origin: [0.5, 0],
        shadow: false,
      })
      name.setPosition(cx, cy + cardH * 0.2)
      this.panelContent.add(name)

      const status = hudText(
        this,
        0,
        0,
        locked ? (tier === total ? '???' : 'RESERVED') : has ? 'FOUND' : '?',
        1,
        {
          color: has && !locked ? '#7ddf8a' : DIM,
          size: Math.max(10, Math.min(14, cardW * 0.1)),
          stroke: 0,
          origin: [0.5, 0],
          shadow: false,
        },
      )
      status.setPosition(cx, cy + cardH * 0.2 + Math.max(16, cardW * 0.16))
      this.panelContent.add(status)
    }

    this.buildVariantShowcase(vw, vh, topY + rows * (cardH + 12) - 12)
  }

  /**
   * Phase 2.15.0: the heart of COLLECTION — the rare randomized tier 8–9
   * variants. Every run rolls a fresh look for tiers 8 and 9 (8 variants
   * each); the ones the player has COLLECTED render in full color, the rest
   * stay mystery chips. Tiers 10–12 stay reserved (12 is the final secret).
   */
  private buildVariantShowcase(vw: number, vh: number, gridBottom: number): void {
    const save = loadSave()
    const g = this.add.graphics()
    this.panelContent.add(g)
    const topY = gridBottom + 14
    const headH = Math.max(18, vh * 0.026)
    const capH = Math.max(13, vh * 0.021)
    const avail = vh - topY - 12
    const chipR = Math.max(8, Math.min(22, (avail - headH - capH - 24) / 4.2))
    const rowH = chipR * 2 + 10
    const spacing = chipR * 2 + 8

    const head = hudText(this, 0, 0, 'TIER 8–9 VARIANTS — a new look every run', 1, {
      color: CREAM,
      size: headH * 0.78,
      stroke: 3,
      origin: [0.5, 0],
      shadow: false,
    })
    head.setPosition(vw / 2, topY)
    this.panelContent.add(head)

    const tiers: Array<[number, string]> = [
      [8, 'T8'],
      [9, 'T9'],
    ]
    tiers.forEach(([tier, tag], r) => {
      const cy = topY + headH + rowH / 2 + r * rowH
      const totalW = VARIANT_COUNT * spacing - 8
      const startX = vw / 2 - totalW / 2 + chipR
      const tagT = hudText(this, 0, 0, tag, 1, {
        color: YELLOW,
        size: Math.max(11, chipR * 1.1),
        stroke: 2,
        origin: [1, 0.5],
        shadow: false,
      })
      tagT.setPosition(startX - chipR - 8, cy)
      this.panelContent.add(tagT)
      for (let v = 0; v < VARIANT_COUNT; v++) {
        const hx = startX + v * spacing
        const got = save.variants[`${tier}:${v}`] != null
        if (got) {
          drawBallIcon(this, g, tier, hx, cy, chipR, { variant: v, seed: tier * 7717 + v })
        } else {
          g.lineStyle(2, 0x3a3d55, 1)
          g.strokeCircle(hx, cy, chipR)
          const q = hudText(this, 0, 0, '?', 1, {
            color: '#3a3d55',
            size: chipR * 1.4,
            stroke: 0,
            origin: [0.5, 0.5],
            shadow: false,
          })
          q.setPosition(hx, cy + 1)
          this.panelContent.add(q)
        }
      }
    })

    const cap = hudText(this, 0, 0, 'Tiers 10–11 are reserved — tier 12 is the final secret', 1, {
      color: DIM,
      size: capH * 0.82,
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    cap.setPosition(vw / 2, topY + headH + 2 * rowH + 10)
    this.panelContent.add(cap)
  }

  // -------------------------------------------------------------------------
  // START
  // -------------------------------------------------------------------------

  /** The start-intro sweep-in, run as an overlay INSIDE this scene: the
   * menu stays fully painted under the closing ring. At full closure the
   * scene hands off to StartIntroScene (startClosed) which plays the ball
   * phase + outro over the game. */
  private runStartSweep(): void {
    const z = this.game.scale.displayScale.x || 1
    const vw = this.scale.width / z
    const vh = this.scale.height / z
    const cx = vw / 2
    const cy = vh / 2
    const outerR = Math.hypot(vw, vh) * 0.5
    const innerR = Math.min(vw, vh) * 0.14
    // IRIS OVERLAY (iOS-proof): the cover is a BAKED annulus texture
    // (solid ink from the hole edge out past the corners + cream ring
    // at the hole edge), animated by pure GPU scale — zero per-frame
    // Graphics buffer streaming, zero canvas repaints. Per-frame
    // viewport Graphics redraws are a known iOS blank/black trigger
    // (Phaser #6051/#6914) and the app already lost two features to
    // that class. See bakeIrisCover() in StartIntroScene (shared bake).
    const baked = bakeIrisCover(this, outerR, innerR, vw, vh)
    const iris = this.add
      .image(cx, cy, 'br-intro-cover')
      .setOrigin(0.5, 0.5)
      .setDepth(5000)
      .setScale(outerR / innerR)
    this.tweens.add({
      targets: iris,
      scale: 1,
      duration: 620,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        // Full ink now covers the menu. Hand off WITHOUT destroying the
        // iris: it stays painted until this scene stops (part of
        // scene.start), and StartIntroScene's create() draws its own
        // identical closed iris in the same frame — no coverless frame,
        // no flicker at the handoff.
        this.scene.start('StartIntroScene', { startClosed: true })
      },
    })
    void baked
  }

  private pressStart(): void {
    if (this.closed) return
    this.closed = true
    session.menuActive = false
    // Phase 2.22: portrait phones route through the start-intro scene —
    // the comic ring + scared ball covers the gameplay scenes' expensive
    // first frame (the "lag on start" on physical iPhones). Desktop keeps
    // the instant cross-dissolve.
    if (StartIntroScene.shouldRun(window.innerWidth, window.innerHeight)) {
      gameBus.emit('ui:start', {})
      this.scene.setVisible(false, 'playground')
      this.scene.setVisible(false, 'UIScene')
      // IN-MENU SWEEP: the closing ring runs INSIDE TitleScene as an
      // overlay — the menu stays fully painted underneath it (never a
      // bare background through the hole, and no scene-boot churn that
      // iOS can turn into a visible blank). When the cover is fully
      // closed, we stop this scene and hand off to StartIntroScene with
      // startClosed — it boots UNDER the full-ink frame (zero flicker)
      // and continues with the ball phase + outro over the game.
      this.runStartSweep()
      return
    }
    gameBus.emit('ui:start', {})
    // Phase 2.16.0: the gameplay scenes were completely HIDDEN while the
    // menu was up — reveal them now, under the menu's fade-out, so the
    // transition is one clean cross-dissolve into the live world.
    this.scene.setVisible(true, 'playground')
    this.scene.setVisible(true, 'UIScene')
    this.cameras.main.fadeOut(300, 8, 10, 20)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop()
    })
  }
}

// ---------------------------------------------------------------------------
// Shared drawing helpers
// ---------------------------------------------------------------------------

function fmtDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Rounded-rect path on a 2D canvas context (manual — ctx.roundRect is
 * missing on older iOS Safari). */
function rrPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rw: number,
  rh: number,
  r: number | number[],
): void {
  const radii = typeof r === 'number' ? [r, r, r, r] : [...r]
  ctx.beginPath()
  ctx.moveTo(x + radii[0]!, y)
  ctx.lineTo(x + rw - radii[1]!, y)
  ctx.arcTo(x + rw, y, x + rw, y + radii[1]!, radii[1]!)
  ctx.lineTo(x + rw, y + rh - radii[2]!)
  ctx.arcTo(x + rw, y + rh, x + rw - radii[2]!, y + rh, radii[2]!)
  ctx.lineTo(x + radii[3]!, y + rh)
  ctx.arcTo(x, y + rh, x, y + rh - radii[3]!, radii[3]!)
  ctx.lineTo(x, y + radii[0]!)
  ctx.arcTo(x, y, x + radii[0]!, y, radii[0]!)
  ctx.closePath()
}

/** Five-point star on a 2D canvas context (sticker + its ink outline). */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? r : r * 0.45
    const x = cx + Math.cos(a) * rad
    const y = cy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/**
 * Draws one ball character at (cx, cy) with radius r through the shared
 * appearance pipeline — the SAME look as gameplay (tier fill, wobble
 * contour, ink outline, face). `silhouette` renders the undiscovered state
 * (dark body + '?'); `variant` overrides the per-run variant for journal
 * chips (tiers 8–9); `blink` draws the eyes closed (the showcase star).
 */
function drawBallIcon(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  tier: number,
  cx: number,
  cy: number,
  r: number,
  opts: {
    silhouette?: boolean
    variant?: number | null
    seed?: number
    layer?: Phaser.GameObjects.Container
    blink?: boolean
  } = {},
): void {
  const t = getTier(tier)
  if (!t) return
  const look = ballLookFor(tier, opts.seed ?? 7)
  const poly = restContour(look, r, cx, cy, 32)
  const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))
  const variant = opts.variant != null ? opts.variant : null

  if (opts.silhouette || tier >= 10) {
    g.fillStyle(0x23242e, 1)
    g.fillPoints(pts, true)
  } else if (tier === 8) {
    drawRainbowBall(g, poly, cx, cy, r, 0, variant ?? variantIdFor(8))
  } else if (tier === 9) {
    drawFantasyBall(g, cx, cy, r, variant ?? variantIdFor(9))
  } else {
    g.fillStyle(t.color, 1)
    g.fillPoints(pts, true)
  }

  g.lineStyle(ballOutlineWidth(r), INK, 1)
  g.strokePoints(pts, true, true)

  if (opts.silhouette || tier >= 10) {
    // The undiscovered state: a '?' where the face would be. hudText adds
    // to the scene — reparent into the caller's layer so screen switches
    // destroy it with the rest of the panel content.
    const q = hudText(scene, 0, 0, '?', 1, {
      color: '#565a72',
      size: r * 1.15,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    q.setPosition(cx, cy + 1)
    if (opts.layer) opts.layer.add(q)
  } else {
    const faceLook = opts.blink ? { ...look, eyeH: look.eyeH * 0.12 } : look
    drawBallFace(g, faceLook, { x: cx, y: cy }, r, 1)
  }
}

/** Menu icon painters (white, same style language as the HUD Icons) — only
 * the flat panel buttons still use icons. */
const Icons = {
  back(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    const u = s / 100
    g.lineStyle(6 * u, 0xffffff, 1)
    g.beginPath()
    g.moveTo(8 * u + cx, -14 * u + cy)
    g.lineTo(-8 * u + cx, cy)
    g.lineTo(8 * u + cx, 14 * u + cy)
    g.strokePath()
  },
  palette(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    const u = s / 100
    g.fillStyle(0xffffff, 1)
    g.fillCircle(cx, cy, 12 * u)
    const holes: Array<[number, number, number]> = [
      [-5, -5, 3],
      [5, -3, 3],
      [0, 4, 3],
    ]
    for (const [ox, oy, r] of holes) {
      g.fillStyle(0x51566b, 1)
      g.fillCircle(ox * u + cx, oy * u + cy, r * u)
    }
  },
  trash(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    const u = s / 100
    g.lineStyle(5 * u, 0xffffff, 1)
    g.strokeRect(-12 * u + cx, -8 * u + cy, 24 * u, 24 * u)
    g.lineBetween(-16 * u + cx, -14 * u + cy, 16 * u + cx, -14 * u + cy)
    g.lineBetween(-6 * u + cx, -20 * u + cy, 6 * u + cx, -20 * u + cy)
    g.lineBetween(-6 * u + cx, -20 * u + cy, -6 * u + cx, -14 * u + cy)
    g.lineBetween(6 * u + cx, -20 * u + cy, 6 * u + cx, -14 * u + cy)
  },
}
