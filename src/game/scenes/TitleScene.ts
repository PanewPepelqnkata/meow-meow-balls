import Phaser from 'phaser'
import { gameBus } from '../events/gameBus'
import { hudText } from '../../ui/Typography'
import {
  INK,
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  drawCollectibleBall,
  restContour,
} from '../rendering/BallAppearance'
import { BALL_TIERS, getTier } from '../../config/ballTiers'
import type { BackgroundScene } from './BackgroundScene'
import type { ThemeName } from '../rendering/BackgroundTheme'
import { loadSave, resetSave, setThemeSetting } from '../state/save'
import { variantIdFor } from '../state/runVariant'
import { session } from '../state/session'
import { bakeCanvas, roundedRectPath } from '../rendering/RoughArt'
import { cycleColor } from '../rendering/rgbCycle'
import { UiverseDomButtons } from '../../ui/UiverseDomButtons'
import { StartIntroScene } from './StartIntroScene'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { UI_COLORS, buildScreenHeader, ChunkyButton } from '../../ui/DesignSystem'
import { CollectionBookView } from '../rendering/CollectionBookView'
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
 *                  randomized tier 9 variant hunt.
 *   SETTINGS     → theme (auto/fixed) + reset progress.
 *
 * Restarts never re-show the menu: this scene launches once per game boot
 * and stops itself for good when PLAY is pressed.
 * `?fastboot=1` (dev-only) never launches this scene.
 */

const CREAM = '#fff6e0'
const YELLOW = '#ffeb3b'
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
  /** The uiverse DOM button layer (PLAY + nav) — built on menu rebuild. */
  private uiverseDom: UiverseDomButtons | null = null
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

    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.buildAll, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
      this.scale.off(Phaser.Scale.Events.RESIZE, this.buildAll, this)
      for (const off of this.offs) off()
      this.offs.length = 0
      this.uiverseDom?.destroy()
      this.uiverseDom = null
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
        open: (name: ScreenName) => this.openScreen(name),
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
    // Uiverse buttons: the ball characters live (gaze at the pointer,
    // blink, egg expressions) — pointer in CSS px for the gaze.
    if (this.uiverseDom) {
      const p = this.input.activePointer
      const z = this.game.scale.displayScale.x || 1
      const cw = this.scale.width / z
      const ch = this.scale.height / z
      const gaze = { x: (p.x - cw / 2) / (cw / 2), y: (p.y - ch / 2) / (ch / 2) }
      this.uiverseDom.refresh(time, this.uiverseDom.currentSpecs(), gaze)
    }
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
      // Deep warm stone — the buttons' --stone-800 world, darkened for
      // contrast so the yellow accents pop.
      const grad = ctx.createLinearGradient(0, 0, 0, vh)
      grad.addColorStop(0, '#161a2e')
      grad.addColorStop(0.55, '#121528')
      grad.addColorStop(1, '#0c0e1d')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, vw, vh)
      // A soft warm glow where the machine will sit (center, slightly low)
      // — the buttons' yellow-400 as atmosphere.
      const glow = ctx.createRadialGradient(
        vw / 2,
        vh * 0.55,
        10,
        vw / 2,
        vh * 0.55,
        Math.max(vw, vh) * 0.55,
      )
      glow.addColorStop(0, 'rgba(79,195,247,0.13)')
      glow.addColorStop(1, 'rgba(79,195,247,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, vw, vh)
      // Sprinkled warm dots — subtle depth, not noise.
      ctx.fillStyle = 'rgba(200,220,255,0.10)'
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
    const safe = readSafeArea()
    const portrait = vh >= vw || vw < 700
    const m = Math.round(Math.max(12, Math.min(22, Math.min(vw, vh) * 0.025)))
    const topInset = Math.max(m, safe.top)
    const bottomInset = Math.max(m, safe.bottom)

    // --- the wordmark (its own container, bobbed in update) ---
    this.logoC = this.add.container(0, 0)
    this.menuLayer.add(this.logoC)
    const logoH = this.buildLogoInto(vw, vh)
    const logoCY = topInset + 8 + logoH / 2
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
      const chipY = vh - bottomInset - chipH / 2
      const nav2Y = chipY - chipH / 2 - 18 - navH / 2
      const nav1Y = nav2Y - navH - 18
      const playY = nav1Y - navH / 2 - 18 - playH / 2
      const bandTop = logoCY + logoH / 2 + 10
      const bandBottom = playY - playH / 2 - 10
      this.buildMachine(
        vw / 2,
        (bandTop + bandBottom) / 2,
        bandBottom - bandTop,
        Math.min(vw * 0.6, 340),
      )
      this.buildPlayAndNav(vw, playY, playW, playH, navW, navH, [
        { x: vw / 2 - (navW + 18) / 2, y: nav1Y },
        { x: vw / 2 + (navW + 18) / 2, y: nav1Y },
        { x: vw / 2 - (navW + 18) / 2, y: nav2Y },
        { x: vw / 2 + (navW + 18) / 2, y: nav2Y },
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
        { x: vw / 2 - 1.5 * (navW + 18), y: navY },
        { x: vw / 2 - 0.5 * (navW + 18), y: navY },
        { x: vw / 2 + 0.5 * (navW + 18), y: navY },
        { x: vw / 2 + 1.5 * (navW + 18), y: navY },
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
    const palette = ['#4fc3f7', '#fafaf9', '#e94040', '#ffffff', '#4fc3f7']
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
    return cH
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

  /** Machine BACK layer: glass interior, red base body, rich cartoon shading & highlights. */
  private buildMachineBack(key: string, w: number, h: number, u: number): Phaser.GameObjects.Image {
    bakeCanvas(this, `br-gumball-back:${key}`, Math.ceil(w), Math.ceil(h), (ctx) => {
      // Glass interior: near-transparent fill + subtle pile shading at the bottom.
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.beginPath()
      ctx.arc(50 * u, 33 * u, 30 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.beginPath()
      ctx.ellipse(50 * u, 52 * u, 23 * u, 10 * u, 0, 0, Math.PI * 2)
      ctx.fill()

      // Feet: dark rich cherry red under the base.
      ctx.fillStyle = '#9e1b22'
      rrPath(ctx, 23 * u, 122 * u, 11 * u, 5 * u, 2 * u)
      ctx.fill()
      rrPath(ctx, 66 * u, 122 * u, 11 * u, 5 * u, 2 * u)
      ctx.fill()

      // Red collar between globe and base — vibrant rich red with warm highlight top.
      const collarGrad = ctx.createLinearGradient(0, 60 * u, 0, 70 * u)
      collarGrad.addColorStop(0, '#ff4747')
      collarGrad.addColorStop(1, '#e02828')
      ctx.fillStyle = collarGrad
      ctx.beginPath()
      ctx.moveTo(39 * u, 60 * u)
      ctx.lineTo(61 * u, 60 * u)
      ctx.lineTo(65 * u, 70 * u)
      ctx.lineTo(35 * u, 70 * u)
      ctx.closePath()
      ctx.fill()

      // Red dispenser base (stout body, slightly rounded) — vibrant candy red with subtle lateral form gradient.
      const baseGrad = ctx.createLinearGradient(25 * u, 68 * u, 75 * u, 122 * u)
      baseGrad.addColorStop(0, '#ff4747')
      baseGrad.addColorStop(0.45, '#e52c2c')
      baseGrad.addColorStop(1, '#cb1e1e')
      ctx.fillStyle = baseGrad
      ctx.beginPath()
      ctx.moveTo(35 * u, 68 * u)
      ctx.lineTo(65 * u, 68 * u)
      ctx.lineTo(76 * u, 114 * u)
      ctx.quadraticCurveTo(78 * u, 122 * u, 70 * u, 122 * u)
      ctx.lineTo(30 * u, 122 * u)
      ctx.quadraticCurveTo(22 * u, 122 * u, 24 * u, 114 * u)
      ctx.closePath()
      ctx.fill()

      // Darker bottom band — deep rich cartoon depth.
      const bandGrad = ctx.createLinearGradient(0, 108 * u, 0, 122 * u)
      bandGrad.addColorStop(0, '#aa1923')
      bandGrad.addColorStop(1, '#831018')
      ctx.fillStyle = bandGrad
      ctx.beginPath()
      ctx.moveTo(74 * u, 108 * u)
      ctx.lineTo(76 * u, 114 * u)
      ctx.quadraticCurveTo(78 * u, 122 * u, 70 * u, 122 * u)
      ctx.lineTo(30 * u, 122 * u)
      ctx.quadraticCurveTo(22 * u, 122 * u, 24 * u, 114 * u)
      ctx.lineTo(26 * u, 108 * u)
      ctx.closePath()
      ctx.fill()

      // Dispenser chute (the gumballs roll out here) — crisp dark navy/charcoal cavity.
      ctx.fillStyle = '#141722'
      rrPath(ctx, 38 * u, 101 * u, 24 * u, 15 * u, [1 * u, 1 * u, 5 * u, 5 * u])
      ctx.fill()

      // Chute flap: bright cream door over lower chute with subtle 3D rim.
      ctx.fillStyle = '#fffdfa'
      rrPath(ctx, 40 * u, 106 * u, 20 * u, 8 * u, 2 * u)
      ctx.fill()

      // Marquee bulbs: candy dots across collar matching game palette.
      const bulbs = ['#ffd93b', '#4fc3f7', '#ff8a3d', '#4fc3f7', '#ffd93b']
      bulbs.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc((41 + i * 4.5) * u, 65 * u, 1.7 * u, 0, Math.PI * 2)
        ctx.fill()
      })

      // Star sticker on the base's left cheek — golden yellow.
      ctx.fillStyle = '#ffd93b'
      starPath(ctx, 31.5 * u, 96 * u, 2.8 * u)
      ctx.fill()

      // Coin slot — metallic silver-blue tone.
      ctx.fillStyle = '#7a8ba3'
      rrPath(ctx, 63.5 * u, 78 * u, 4.5 * u, 14 * u, 2.2 * u)
      ctx.fill()
      // Coin insert slot line (darker inside).
      ctx.fillStyle = '#141722'
      rrPath(ctx, 64.7 * u, 80 * u, 2.1 * u, 10 * u, 1 * u)
      ctx.fill()

      // Knob — metallic silver dial with inner accent.
      ctx.fillStyle = '#b0c2de'
      ctx.beginPath()
      ctx.arc(37 * u, 85 * u, 5 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e2ecfc'
      ctx.beginPath()
      ctx.arc(36 * u, 84 * u, 2.4 * u, 0, Math.PI * 2)
      ctx.fill()
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
      const ink = '#1a1a1a'
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
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 1.4 * u
      ctx.beginPath()
      ctx.moveTo(33.8 * u, 73 * u)
      ctx.lineTo(66.2 * u, 73 * u)
      ctx.stroke()
      // Cartoon glint on top-left edge of the red body
      ctx.strokeStyle = 'rgba(255,255,255,0.38)'
      ctx.lineWidth = 1.5 * u
      ctx.beginPath()
      ctx.moveTo(36 * u, 76 * u)
      ctx.lineTo(31.5 * u, 91 * u)
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
      ctx.lineWidth = Math.max(1.2, 1.2 * u)
      starPath(ctx, 31.5 * u, 96 * u, 2.8 * u)
      ctx.stroke()
      // Star center white glint dot
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(31.2 * u, 95.7 * u, 0.8 * u, 0, Math.PI * 2)
      ctx.fill()
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
    // ---- PLAY + nav: uiverse big-moose-69 buttons as a DOM layer
    // (1:1 CSS from the source), each showcasing a live ball character
    // (gaze/blink/egg expressions) drawn into a small canvas per frame.
    // The Phaser-side hit rects stay the authoritative input surface.
    const specs: Array<{ x: number; y: number; w: number; h: number; label: string; tier: number; seed: number; screen: ScreenName }> = [
      { x: vw / 2, y: playY, w: playW, h: playH, label: 'PLAY', tier: 1, seed: 4242, screen: 'menu' },
      { x: navPos[0]!.x, y: navPos[0]!.y, w: navW, h: navH, label: 'LEADERBOARD', tier: 2, seed: 4242 + 2 * 7, screen: 'leaderboard' },
      { x: navPos[1]!.x, y: navPos[1]!.y, w: navW, h: navH, label: 'COLLECTION', tier: 3, seed: 4242 + 3 * 7, screen: 'collection' },
      { x: navPos[2]!.x, y: navPos[2]!.y, w: navW, h: navH, label: 'SETTINGS', tier: 4, seed: 4242 + 4 * 7, screen: 'settings' },
      { x: navPos[3]!.x, y: navPos[3]!.y, w: navW, h: navH, label: 'JOURNAL', tier: 6, seed: 4242 + 6 * 7, screen: 'collection' },
    ]
    this.uiverseDom = new UiverseDomButtons(this)
    this.uiverseDom.build(specs)
    this.uiverseDom.setVisible(!this.closed && this.screen === 'menu')
    // Invisible hit rects (above the canvas) drive press + hover — the DOM
    // layer is click-transparent, CSS :hover can't fire on its own.
    specs.forEach((s, i) => {
      const hit = this.add
        .rectangle(s.x, s.y, s.w, s.h, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true })
      this.menuLayer.add(hit)
      hit.on('pointerover', () => this.uiverseDom?.setHover(i, true))
      hit.on('pointerout', () => {
        this.uiverseDom?.setHover(i, false)
        this.uiverseDom?.setPressed(i, false)
      })
      hit.on('pointerdown', () => this.uiverseDom?.setPressed(i, true))
      hit.on('pointerup', () => {
        this.uiverseDom?.setPressed(i, false)
        if (i === 0) this.pressStart()
        else this.openScreen(specs[i]!.screen)
      })
      this.menuRects.push({
        label: s.label,
        x: s.x - s.w / 2,
        y: s.y - s.h / 2,
        w: s.w,
        h: s.h,
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
    g.fillStyle(0x292524, 0.92)
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
    this.panelBackdrop.fillStyle(UI_COLORS.BACKDROP_DIM, UI_COLORS.BACKDROP_ALPHA)
    this.panelBackdrop.fillRect(0, 0, vw, vh)
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
    // The uiverse DOM layer mirrors the menu (hidden under any panel).
    this.uiverseDom?.setVisible(isMenu && !this.closed)
    if (isMenu) return
    // Rebuild the open panel's CONTENT fresh (data may have changed). Only
    // the persistent BACK rect survives; screen-specific buttons (theme
    // pickers, reset) re-register as they are created.
    this.panelContent.removeAll(true)
    this.panelRects.length = 0
    // HiDPI: CSS-px layout, matching buildAll (camera frames the CSS region).
    const z = this.game.scale.displayScale.x || 1
    const vw = this.scale.width / z
    const vh = this.scale.height / z

    const subs: Partial<Record<ScreenName, string>> = {
      journal: 'COLLECTION ALBUM & DISCOVERY LOG',
      collection: 'COLLECTION ALBUM & DISCOVERY LOG',
      leaderboard: 'YOUR TEN BEST RUNS & ACHIEVEMENTS',
      settings: 'THEME, SOUND & SYSTEM PREFERENCES',
    }

    const titles: Partial<Record<ScreenName, string>> = {
      journal: 'COLLECTION BOOK',
      collection: 'COLLECTION BOOK',
      leaderboard: 'LEADERBOARD',
      settings: 'SETTINGS',
    }

    const { contentTopY } = buildScreenHeader(this, this.panelContent, {
      vw,
      vh,
      title: titles[this.screen] ?? this.screen.toUpperCase(),
      subtitle: subs[this.screen],
      onBack: () => this.openScreen('menu'),
      rectsCollector: this.panelRects,
    })

    switch (this.screen) {
      case 'journal':
      case 'collection':
        this.buildCollection(vw, vh, contentTopY)
        break
      case 'leaderboard':
        this.buildLeaderboard(vw, vh, contentTopY)
        break
      case 'settings':
        this.buildSettings(vw, vh, contentTopY)
        break
    }
  }

// Removed buildJournal: integrated into CollectionBookView.

  private buildLeaderboard(vw: number, vh: number, topY: number): void {
    const save = loadSave()
    const rows = save.leaderboard.slice(0, 10)
    const cardW = Math.min(480, vw * 0.92)
    const cardX = vw / 2 - cardW / 2

    if (rows.length === 0) {
      const emptyCard = this.add.graphics()
      this.panelContent.add(emptyCard)
      const emptyH = 120
      const emptyY = topY + 40
      emptyCard.fillStyle(UI_COLORS.CARD_BG, 1)
      emptyCard.fillRoundedRect(cardX, emptyY, cardW, emptyH, 14)
      emptyCard.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
      emptyCard.strokeRoundedRect(cardX, emptyY, cardW, emptyH, 14)

      const empty = hudText(this, vw / 2, emptyY + 44, 'NO RUNS RECORDED YET', 1, {
        color: UI_COLORS.TEXT_GOLD,
        size: 16,
        stroke: 3,
        origin: [0.5, 0.5],
      })
      this.panelContent.add(empty)

      const emptySub = hudText(this, vw / 2, emptyY + 74, 'Play a game and merge balls to place on the leaderboard!', 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: 12,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      this.panelContent.add(emptySub)
      return
    }

    const availableH = vh - topY - 24
    const rowH = Math.min(56, Math.max(42, availableH / Math.max(rows.length, 6)))
    const g = this.add.graphics()
    this.panelContent.add(g)

    rows.forEach((e, i) => {
      const y = topY + 10 + i * (rowH + 6)
      const rank = i + 1

      // Rank colors & medals
      const isTop3 = rank <= 3
      const rankBg = rank === 1 ? 0xffd93b : rank === 2 ? 0xc9d1e3 : rank === 3 ? 0xd08a4e : UI_COLORS.CARD_BG
      const rankBorder = isTop3 ? UI_COLORS.INK : UI_COLORS.CARD_BORDER

      // Row background
      g.fillStyle(rankBg, isTop3 ? 1 : 0.9)
      g.fillRoundedRect(cardX, y, cardW, rowH, 10)
      g.lineStyle(2, rankBorder, 1)
      g.strokeRoundedRect(cardX, y, cardW, rowH, 10)

      // Rank text
      const rankT = hudText(this, cardX + 32, y + rowH / 2, `#${rank}`, 1, {
        color: isTop3 ? '#1a1a1a' : '#aeb4c9',
        size: Math.round(rowH * 0.44),
        stroke: isTop3 ? 0 : 2,
        origin: [0.5, 0.5],
        shadow: false,
      })
      this.panelContent.add(rankT)

      // Signature Ball
      const ballR = Math.min(18, rowH * 0.32)
      drawBallIcon(this, g, Math.max(1, Math.min(12, e.bestTier)), cardX + 76, y + rowH / 2, ballR, {
        seed: e.bestTier * 991,
        layer: this.panelContent,
      })

      // Score
      const scoreT = hudText(this, cardX + 104, y + rowH / 2 - (rowH > 48 ? 6 : 0), `${e.score.toLocaleString()}`, 1, {
        color: isTop3 ? '#1a1a1a' : '#ffffff',
        size: Math.round(rowH * 0.44),
        stroke: isTop3 ? 0 : 3,
        origin: [0, 0.5],
      })
      this.panelContent.add(scoreT)

      // Date / Timestamp
      const whenStr = fmtDate(e.at)
      const whenT = hudText(this, cardX + cardW - 16, y + rowH / 2, whenStr, 1, {
        color: isTop3 ? '#2c2514' : '#8e9bb5',
        size: 11,
        stroke: 0,
        origin: [1, 0.5],
        shadow: false,
      })
      this.panelContent.add(whenT)
    })
  }

  private buildSettings(vw: number, _vh: number, topY: number): void {
    const save = loadSave()
    const cardW = Math.min(480, vw * 0.92)
    const cardX = vw / 2 - cardW / 2
    let curY = topY + 10

    const g = this.add.graphics()
    this.panelContent.add(g)

    // 1. Theme Selection Card
    const themeCardH = 148
    g.fillStyle(UI_COLORS.CARD_BG, 1)
    g.fillRoundedRect(cardX, curY, cardW, themeCardH, 12)
    g.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
    g.strokeRoundedRect(cardX, curY, cardW, themeCardH, 12)

    const themeHead = hudText(this, vw / 2, curY + 22, 'BACKGROUND THEME', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 15,
      stroke: 3,
      origin: [0.5, 0.5],
    })
    this.panelContent.add(themeHead)

    const themes: Array<{ key: 'auto' | ThemeName; label: string }> = [
      { key: 'auto', label: 'AUTO' },
      { key: 'light', label: 'LIGHT' },
      { key: 'space', label: 'SPACE' },
      { key: 'jungle', label: 'JUNGLE' },
      { key: 'fantasy', label: 'FANTASY' },
    ]

    const btnSpacing = 8
    const totalBtnW = cardW - 24
    const bw = Math.floor((totalBtnW - (themes.length - 1) * btnSpacing) / themes.length)
    const btnStartX = cardX + 12 + bw / 2
    const btnY = curY + 68

    themes.forEach((t, ti) => {
      const selected = save.settings.theme === t.key
      const bx = btnStartX + ti * (bw + btnSpacing)

      const btn = new ChunkyButton({
        scene: this,
        x: bx,
        y: btnY,
        w: bw,
        h: 40,
        fill: selected ? UI_COLORS.BTN_BLUE : UI_COLORS.CARD_BG,
        shadowColor: selected ? UI_COLORS.BTN_BLUE_SHADOW : 0x0f1422,
        label: t.label,
        fontSize: Math.max(10, Math.min(13, bw * 0.28)),
        onClick: () => {
          setThemeSetting(t.key)
          const bg = this.scene.get('BackgroundScene') as BackgroundScene | undefined
          if (bg) {
            if (t.key === 'auto') bg.resetTheme()
            else bg.setTheme(t.key as ThemeName, 400)
          }
          this.applyScreenVisibility()
        },
      })
      this.panelContent.add(btn.container)

      this.panelRects.push({
        label: `THEME_${t.key.toUpperCase()}`,
        x: bx - bw / 2,
        y: btnY - 20,
        w: bw,
        h: 40,
        screen: 'settings',
      })
    })

    const note = hudText(this, vw / 2, curY + 118, 'AUTO changes theme automatically as you reach higher tiers', 1, {
      color: UI_COLORS.TEXT_MUTED,
      size: 11,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    this.panelContent.add(note)
    curY += themeCardH + 16

    // 2. Lifetime Stats Card
    const statsCardH = 100
    g.fillStyle(UI_COLORS.CARD_BG, 1)
    g.fillRoundedRect(cardX, curY, cardW, statsCardH, 12)
    g.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
    g.strokeRoundedRect(cardX, curY, cardW, statsCardH, 12)

    const statsHead = hudText(this, vw / 2, curY + 22, 'CAREER HIGHLIGHTS', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 15,
      stroke: 3,
      origin: [0.5, 0.5],
    })
    this.panelContent.add(statsHead)

    const stats = save.stats
    const statCols = [
      { label: 'TOTAL RUNS', val: `${stats.runs}` },
      { label: 'TOTAL MERGES', val: `${stats.merges}` },
      { label: 'BEST TIER', val: `T${stats.bestTier || 1}` },
    ]
    const colW = cardW / 3
    statCols.forEach((col, ci) => {
      const cx = cardX + colW * (ci + 0.5)
      const valT = hudText(this, cx, curY + 54, col.val, 1, {
        color: UI_COLORS.TEXT_WHITE,
        size: 18,
        stroke: 3,
        origin: [0.5, 0.5],
      })
      this.panelContent.add(valT)

      const lblT = hudText(this, cx, curY + 76, col.label, 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: 10,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      this.panelContent.add(lblT)
    })
    curY += statsCardH + 18

    // 3. Danger Zone / Reset
    const resetBtnW = Math.min(280, cardW - 32)
    const resetBtnH = 46
    const resetBtn = new ChunkyButton({
      scene: this,
      x: vw / 2,
      y: curY + resetBtnH / 2,
      w: resetBtnW,
      h: resetBtnH,
      fill: this.resetArmed > 0 ? UI_COLORS.BTN_RED : UI_COLORS.CARD_BG,
      shadowColor: this.resetArmed > 0 ? UI_COLORS.BTN_RED_SHADOW : 0x0f1422,
      label: this.resetArmed > 0 ? 'TAP AGAIN TO CONFIRM' : 'RESET PROGRESS',
      fontSize: 13,
      onClick: () => {
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
    this.panelContent.add(resetBtn.container)

    this.panelRects.push({
      label: 'RESET',
      x: vw / 2 - resetBtnW / 2,
      y: curY,
      w: resetBtnW,
      h: resetBtnH,
      screen: 'settings',
    })

    const wipe = hudText(
      this,
      vw / 2,
      curY + resetBtnH + 16,
      'Clears best score, collection, leaderboard and stats.',
      1,
      {
        color: '#6b7896',
        size: 11,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      },
    )
    this.panelContent.add(wipe)
  }

  private buildCollection(vw: number, vh: number, topY: number): void {
    new CollectionBookView(this, this.panelContent, vw, vh, topY)
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
    const innerR = 12 // closed-beat hole: near-zero, seal bridges it (user: close fully to center)
    // IRIS OVERLAY (iOS-proof): the cover is a BAKED annulus texture
    // (solid ink from the hole edge out past the corners + cream ring
    // at the hole edge), animated by pure GPU scale — zero per-frame
    // Graphics buffer streaming, zero canvas repaints. Per-frame
    // viewport Graphics redraws are a known iOS blank/black trigger
    // (Phaser #6051/#6914) and the app already lost two features to
    // The iris is a per-tick Graphics annulus (crisp at every radius —
    // a scaled texture magnifies its baked edge into pixel steps).
    const iris = this.add.graphics().setDepth(5000)
    const drawIris = (holeR: number): void => {
      iris.clear()
      // Endpoint guards (zero-width annulus = GPU seam; fully closed =
      // plain disc). The sweep-in shrinks to innerR; no feather — one
      // clean hard edge, the classic iris read.
      if (holeR >= outerR) return
      iris.fillStyle(0x0e0f1c, 1)
      if (holeR <= 0.01) {
        iris.fillCircle(cx, cy, outerR * 1.3)
        return
      }
      iris.beginPath()
      iris.arc(cx, cy, outerR * 1.3, 0, Math.PI * 2)
      iris.arc(cx, cy, holeR, 0, Math.PI * 2, true)
      iris.fillPath()
    }
    drawIris(innerR)
    // SEAL: a full-screen ink quad UNDER the iris that fades in during
    // the final third of the sweep, filling the 55px hole. The ring
    // never closes past innerR — scaling below 1 pulled the baked
    // outer edge on-screen (the 'loops' the user saw: a second huge
    // arc crossing the frame + a collapsing donut + the menu re-exposed
    // through 99.97% transparent coverage). With the seal, the sweep
    // reads exactly like the praised version, and the closed beat is
    // SOLID ink + cream ring at r=innerR.
    const sweepProgress = { hole: outerR }
    const seal = this.add
      .rectangle(cx, cy, vw, vh, 0x0e0f1c)
      .setDepth(4999)
      .setAlpha(0)
    this.tweens.add({
      targets: seal,
      alpha: 1,
      duration: 260,
      delay: 360,
      ease: 'Quad.easeIn',
    })
    this.tweens.add({
      targets: sweepProgress,
      hole: innerR,
      duration: 620,
      ease: 'Quad.easeInOut',
      onUpdate: () => drawIris(sweepProgress.hole),
      onComplete: () => {
        // Full ink now covers the menu (annulus at scale 1 + seal under
        // it). Hand off WITHOUT destroying either: they stay painted
        // until this scene stops (part of scene.start), and
        // StartIntroScene's create() draws its identical closed pair in
        // the same frame — no coverless frame, no flicker.
        this.scene.start('StartIntroScene', { startClosed: true })
      },
    })
  }

  private pressStart(): void {
    if (this.closed) return
    this.closed = true
    this.uiverseDom?.setVisible(false)
    session.menuActive = false
    // Phase 2.22: portrait phones route through the start-intro scene —
    // the comic ring + scared ball covers the gameplay scenes' expensive
    // first frame (the "lag on start" on physical iPhones). Desktop keeps
    // the instant cross-dissolve.
    if (StartIntroScene.shouldRun()) {
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
export function drawBallIcon(
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
  } else if (tier === 9) {
    // The theme ball paints its own face — part of the design. The run's
    // theme roll (shark/pig) picks the renderer; the variant picks the
    // palette within the theme.
    drawCollectibleBall(g, cx, cy, r, tier, variant ?? variantIdFor(tier), poly, 0, undefined, 9)
    return
  } else {
    // Tier 8 is a plain ball whose colour cycles; the body fills the
    // CONTOUR (so it matches its ink outline) in the current cycle colour.
    g.fillStyle(tier === 8 ? cycleColor(Date.now()) : t.color, 1)
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

