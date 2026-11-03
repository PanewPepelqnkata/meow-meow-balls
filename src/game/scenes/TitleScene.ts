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
import { AuthModal } from '../../ui/AuthModal'
import { authService, resolveDisplayName, scoreService } from '../../services/auth'
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
 * · LEADERBOARD / COLLECTION / SETTINGS as chunky outlined Uiverse buttons
 *   balanced cleanly below PLAY.
 * · A compact stats chip: lifetime best score + discovered tiers.
 *
 * The composition adapts intentionally: portrait (vw ≤ vh or narrow) is a
 * centered flow (logo → machine → PLAY → grid → stats chip); landscape
 * spreads the same elements across the wide viewport with the nav as a
 * bottom row and the chip under the logo. Every element is laid out from
 * measured sizes with safe-area margins — nothing clips at 320×568 …
 * 1728×864.
 *
 *   PLAY         → reveal gameplay + fade-out, input unlocks ('ui:start').
 * LEADERBOARD -> lifetime top runs (persisted save).
 * COLLECTION -> physical book album with core tiers, variants, stamps & dates.
 * SETTINGS -> theme (auto/fixed) + reset progress.
 * Restarts do not re-show home. Pause can launch Settings directly, keeping
 * the current run paused until BACK returns to PauseScene.
 * `?fastboot=1` (dev-only) never launches this scene.
 */

const CREAM = '#fff6e0'
const YELLOW = '#ffeb3b'
type ScreenName = 'menu' | 'leaderboard' | 'settings' | 'collection'

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
  /** Panel chrome survives viewport rebuilds; each screen owns fresh content. */
  private panelContent!: Phaser.GameObjects.Container
  private collectionBook: CollectionBookView | null = null
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
  private returnToPause = false
  private closed = false
  private resetArmed = 0
  private resetArmTimer: number | null = null
  private readonly pointerWorld = new Phaser.Math.Vector2()
  private offs: Array<() => void> = []
  private unsubscribeAuth: (() => void) | null = null
  /** Reduced-motion preference, read once per the DiscoveryOverlay convention. */
  private reducedMotion = false
  /** Leaderboard scroll state — torn down with the panel content. */
  private lbScroll: {
    rowsC: Phaser.GameObjects.Container
    maskG: Phaser.GameObjects.Graphics
    thumbG: Phaser.GameObjects.Graphics
    zone: Phaser.GameObjects.Zone
    offset: number
    maxOffset: number
    viewH: number
    contentH: number
    rowH: number
    rowGap: number
    trackX: number
    trackY: number
    trackW: number
    trackH: number
    thumbH: number
    tableX: number
    tableY: number
    tableW: number
    tableH: number
    dragPointerId: number | null
    dragMode: 'rows' | 'thumb' | null
    dragStartY: number
    dragStartOffset: number
  } | null = null
  /** Leaderboard tweens (entrance, crown shimmer, cloud drift) — killed on teardown. */
  private lbTweens: Phaser.Tweens.Tween[] = []
  /** Monotonic build token — a stale async leaderboard fetch detects a
   * resize/navigation rebuild by comparing its captured token. */
  private lbBuildSeq = 0
  constructor() {
    super('TitleScene')
  }

  /** HiDPI camera: zoom = display scale, centered on the CSS midpoint. */
  private applyDprCamera(): void {
    const z = this.game.scale.displayScale.x || 1
    const cssW = this.scale.width / z
    const cssH = this.scale.height / z
    this.cameras.main.setZoom(z)
    this.cameras.main.centerOn(cssW / 2, cssH / 2)
  }

  private onViewportResize(): void {
    this.applyDprCamera()
    this.buildAll()
  }

  create(data: { returnToPause?: boolean } = {}): void {
    this.closed = false
    this.returnToPause = data.returnToPause === true
    // Phaser retains launch data when a later launch omits it; consume this one-shot mode.
    this.sys.settings.data = {}
    this.screen = this.returnToPause ? 'settings' : 'menu'
    // HiDPI camera setup; reapplied on resize (buildAll relayouts in CSS
    // coordinates — the camera handles the buffer scaling).
    this.applyDprCamera()
    this.disarmReset()
    this.input.enabled = true
    try {
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      this.reducedMotion = false
    }
    this.scene.bringToTop()
    // Phase 2.16.0: the menu owns the screen — the gameplay scenes are
    // COMPLETELY HIDDEN (not merely dimmed), so no second container / HUD
    // can ever show through. Home leaves them running (input-gated);
    // Settings from PauseScene leaves their existing paused state untouched.
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

    // Native RESIZE can pair the old buffer with new CSS bounds; GameRoot emits this after both settle.
    this.game.events.on('br:dpr', this.onViewportResize, this)
    // Rebuild leaderboard when auth state changes (login/logout)
    this.unsubscribeAuth = authService.onAuthStateChange(() => {
      if (!this.closed) {
        this.buildAll()
      }
    })
    this.offs.push(
      gameBus.on('state:save', () => {
        if (!this.closed) {
          this.buildAll()
        }
      }),
    )
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.closed = true
      this.returnToPause = false
      this.lbBuildSeq++
      this.destroyCollectionBook()
      this.teardownLeaderboardScroll()
      this.disarmReset()
      this.game.events.off('br:dpr', this.onViewportResize, this)
      this.unsubscribeAuth?.()
      this.unsubscribeAuth = null
      for (const off of this.offs) off()
      this.offs.length = 0
      this.uiverseDom?.destroy()
      this.uiverseDom = null
      // The DEV hook survives scene stops (visible() reports false via
      // `closed`); a later launch replaces it with the new menu state.
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
          ((this.logoC?.list ?? []) as Array<Phaser.GameObjects.Text & Phaser.GameObjects.Image>).map(
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
    if (this.closed || this.returnToPause) return
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
    if (this.uiverseDom && this.screen === 'menu') {
      const p = this.input.activePointer
      const z = this.game.scale.displayScale.x || 1
      const cw = this.scale.width / z
      const ch = this.scale.height / z
      // Pointer x/y are buffer pixels. The camera converts them back to the CSS-px layout.
      const world = this.cameras.main.getWorldPoint(p.x, p.y, this.pointerWorld)
      const gaze = { x: (world.x - cw / 2) / (cw / 2), y: (world.y - ch / 2) / (ch / 2) }
      this.uiverseDom.refresh(time, this.uiverseDom.currentSpecs(), gaze)
    }
  }

  // -------------------------------------------------------------------------
  // Build / layout (full rebuild on resize — rare, keeps layout trivial)
  // -------------------------------------------------------------------------

  private buildAll(): void {
    if (this.closed) return
    this.disarmReset()
    this.clearPanelContent()
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

    // Detach the persistent panel backdrop and content container before rebuilding their siblings.
    this.panelLayer.remove(this.panelBackdrop)
    this.panelLayer.remove(this.panelContent)
    this.menuLayer.removeAll(true)
    this.panelLayer.removeAll(true)
    this.panelLayer.add(this.panelBackdrop)
    this.panelLayer.add(this.panelContent)
    if (!this.returnToPause) {
      this.backdropImg = this.buildBackdrop(vw, vh)
      this.menuLayer.addAt(this.backdropImg, 0)
    }
    this.cast.length = 0
    this.menuRects.length = 0
    this.panelRects.length = 0
    this.playC = null
    this.machineC = null
    this.logoImg = null
    this.chipRect = null

    if (!this.returnToPause) {
      const isDesktop = vw >= 768 && vw > vh
      if (isDesktop) {
        this.buildDesktopLayout(vw, vh)
      } else {
        this.buildMobileLayout(vw, vh)
      }
    }
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

  private buildLogo(
    x: number,
    topInset: number,
    vw: number,
    vh: number,
  ): { logoCY: number; logoH: number } {
    this.logoC = this.add.container(0, 0)
    this.menuLayer.add(this.logoC)
    const logoH = this.buildLogoInto(vw, vh)
    const logoCY = topInset + 8 + logoH / 2
    this.logoC.setPosition(x, logoCY)
    this.logoBaseY = logoCY
    return { logoCY, logoH }
  }

  private buildButtons(
    buttonX: number,
    buttonStartY: number,
    buttonSpacing: number,
    vw: number,
    playW: number,
    playH: number,
    navW: number,
    navH: number,
  ): void {
    const firstNavY = buttonStartY + playH / 2 + buttonSpacing + navH / 2
    const step = navH + buttonSpacing
    const navPos: Array<{ x: number; y: number; w?: number; h?: number }> = [
      { x: buttonX, y: firstNavY },
      { x: buttonX, y: firstNavY + step },
      { x: buttonX, y: firstNavY + 2 * step },
    ]
    if (!authService.isAuthenticated()) {
      const sideGap = 16
      const sideW = Math.floor((playW - sideGap) / 2)
      const leftX = buttonX - playW / 2 + sideW / 2
      const rightX = buttonX + playW / 2 - sideW / 2
      navPos.push({ x: rightX, y: buttonStartY, w: sideW, h: playH })
      this.buildPlayAndNav(vw, buttonStartY, sideW, playH, navW, navH, navPos, leftX)
    } else {
      this.buildPlayAndNav(vw, buttonStartY, playW, playH, navW, navH, navPos, buttonX)
    }
  }

  private buildDesktopLayout(vw: number, vh: number): void {
    const safe = readSafeArea()
    const m = Math.round(Math.max(12, Math.min(22, Math.min(vw, vh) * 0.025)))
    const topInset = Math.max(m, safe.top)
    const bottomInset = Math.max(m, safe.bottom)

    // Logo at top center
    const { logoCY, logoH } = this.buildLogo(vw / 2, topInset, vw, vh)

    const chipH = Math.round(Math.max(30, Math.min(44, vh * 0.052)))
    const chipW = Math.round(Math.max(170, Math.min(310, Math.min(vw * 0.86, chipH * 7.2))))
    const chipY = logoCY + logoH / 2 + 8 + chipH / 2

    // Buttons on left side (25% from left edge), arranged vertically
    const buttonX = vw * 0.25
    const playH = Math.round(Math.max(44, Math.min(64, vh * 0.075)))
    const playW = Math.round(Math.max(200, Math.min(320, vw * 0.26)))
    const navH = Math.round(Math.max(34, Math.min(48, vh * 0.055)))
    const navW = Math.round(Math.max(180, Math.min(280, playW * 0.9)))
    const bandTop = Math.max(logoCY + logoH / 2 + 14, chipY + chipH / 2 + 10)
    const bandBottom = vh - bottomInset - m
    const navCount = 3
    const availH = Math.max(1, bandBottom - bandTop - playH - navCount * navH)
    const buttonSpacing = Math.round(Math.max(16, Math.min(28, availH / navCount)))
    const stackH = playH + navCount * navH + navCount * buttonSpacing
    const minStartY = bandTop + playH / 2
    const maxStartY = Math.max(minStartY, bandBottom - stackH + playH / 2)
    const buttonStartY = Math.round(Math.max(minStartY, Math.min(maxStartY, vh * 0.38)))
    this.buildButtons(buttonX, buttonStartY, buttonSpacing, vw, playW, playH, navW, navH)

    // Vending machine on right side (75% from left edge), centered vertically
    const machineX = vw * 0.75
    const machineTop = Math.max(logoCY + logoH / 2 + 16, vh * 0.18)
    const machineBottom = vh - bottomInset - m
    const machineY = (machineTop + machineBottom) / 2
    this.buildMachine(
      machineX,
      machineY,
      machineBottom - machineTop,
      Math.min(vw * 0.38, 420),
    )

    this.buildStatsChip(vw / 2, chipY, chipW, chipH)
  }

  private buildMobileLayout(vw: number, vh: number): void {
    const safe = readSafeArea()
    const portrait = vh >= vw || vw < 700
    const m = Math.round(Math.max(12, Math.min(22, Math.min(vw, vh) * 0.025)))
    const topInset = Math.max(m, safe.top)
    const bottomInset = Math.max(m, safe.bottom)

    const { logoCY, logoH } = this.buildLogo(vw / 2, topInset, vw, vh)
    const chipH = Math.round(Math.max(30, Math.min(44, vh * 0.052)))
    const chipW = Math.round(Math.max(170, Math.min(310, Math.min(vw * 0.86, chipH * 7.2))))
    const playH = Math.round(Math.max(44, Math.min(64, vh * 0.075)))
    const playW = portrait
      ? Math.round(Math.max(180, Math.min(300, vw * 0.68)))
      : Math.round(Math.max(200, Math.min(340, vw * 0.28)))
    const navH = portrait
      ? Math.round(Math.max(32, Math.min(44, vh * 0.048)))
      : Math.round(Math.max(38, Math.min(52, vh * 0.055)))
    const navGap = portrait ? 12 : 16
    const navW = portrait
      ? Math.floor((vw - 2 * m - 2 * navGap) / 3)
      : Math.round(Math.max(120, Math.min(170, (vw - 2 * m - 2 * 16) / 3)))
    if (portrait) {
      // Centered flow, bottom-anchored so the stats chip always sits in the
      // safe area: chip -> balanced 3 nav buttons row -> PLAY + LOGIN side-by-side -> machine -> logo.
      const isAuthed = authService.isAuthenticated()
      const rowGap = 20
      const chipY = vh - bottomInset - chipH / 2
      const navY = chipY - chipH / 2 - rowGap - navH / 2
      const playY = navY - navH / 2 - rowGap - playH / 2
      const bandTop = logoCY + logoH / 2 + 10
      const bandBottom = playY - playH / 2 - 10
      this.buildMachine(
        vw / 2,
        (bandTop + bandBottom) / 2,
        bandBottom - bandTop,
        Math.min(vw * 0.6, 340),
      )
      const navPos: Array<{ x: number; y: number; w?: number; h?: number }> = [
        { x: vw / 2 - (navW + navGap), y: navY },
        { x: vw / 2, y: navY },
        { x: vw / 2 + (navW + navGap), y: navY },
      ]
      if (!isAuthed) {
        // PLAY + LOGIN share one row, splitting the full width evenly.
        const sideGap = 16
        const sideW = Math.floor((vw - 2 * m - sideGap) / 2)
        navPos.push({ x: vw - m - sideW / 2, y: playY, w: sideW, h: playH })
        this.buildPlayAndNav(vw, playY, sideW, playH, navW, navH, navPos, m + sideW / 2)
      } else {
        this.buildPlayAndNav(vw, playY, playW, playH, navW, navH, navPos)
      }
      this.buildStatsChip(vw / 2, chipY, chipW, chipH)
    } else {
      // Compact landscape layout for narrow (< 768px) viewports.
      const isAuthed = authService.isAuthenticated()
      const rowGap = 18
      const navY = vh - m - navH / 2
      const playY = navY - navH / 2 - rowGap - playH / 2
      const chipY = logoCY + logoH / 2 + 8 + chipH / 2
      const bandTop = chipY + chipH / 2 + 10
      const bandBottom = playY - playH / 2 - 12
      this.buildMachine(
        vw / 2,
        (bandTop + bandBottom) / 2,
        bandBottom - bandTop,
        Math.min(vw * 0.45, 420),
      )
      const gap = 20
      const navPos: Array<{ x: number; y: number; w?: number; h?: number }> = [
        { x: vw / 2 - (navW + gap), y: navY },
        { x: vw / 2, y: navY },
        { x: vw / 2 + (navW + gap), y: navY },
      ]
      if (!isAuthed) {
        // PLAY + LOGIN share one row, splitting the full width evenly.
        const sideGap = 16
        const sideW = Math.floor((vw - 2 * m - sideGap) / 2)
        navPos.push({ x: vw - m - sideW / 2, y: playY, w: sideW, h: playH })
        this.buildPlayAndNav(vw, playY, sideW, playH, navW, navH, navPos, m + sideW / 2)
      } else {
        this.buildPlayAndNav(vw, playY, playW, playH, navW, navH, navPos)
      }
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

    // Ground shadow + pedestal: the machine must sit ON a surface, not float.
    const groundG = this.add.graphics()
    groundG.fillStyle(0x000000, 0.42)
    groundG.fillEllipse(w / 2, h + 3 * u, w * 0.92, 11 * u)
    groundG.fillStyle(0x0a0c14, 0.9)
    groundG.fillEllipse(w / 2, h + 1.5 * u, w * 0.8, 8 * u)
    groundG.fillStyle(0x1a1a1a, 1)
    groundG.fillRoundedRect(w * 0.12, h - 1 * u, w * 0.76, 6 * u, 2 * u)
    groundG.fillStyle(0x2a3045, 1)
    groundG.fillRoundedRect(w * 0.14, h - 0.5 * u, w * 0.72, 3 * u, 1.5 * u)

    this.machineC = this.add.container(Math.round(cx - w / 2), Math.round(cy - h / 2))
    this.machineBaseY = this.machineC.y
    this.menuLayer.add(this.machineC)

    // --- the gumball cast: colorful characters bobbing inside the globe ---
    // Phaser 4 dropped WebGL geometry masks, so the pile is simply
    // choreographed to stay inside the glass: every ball's reach
    // (position + radius + bob amplitude) is kept within the globe's
    // interior radius — no clipping object needed.
    const ballsC = this.add.container(0, 0)
    this.machineC.add(groundG)
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

      // Collar right side (3D thickness).
      ctx.fillStyle = '#8f1a1e'
      ctx.beginPath()
      ctx.moveTo(61 * u, 60 * u)
      ctx.lineTo(65 * u, 60 * u)
      ctx.lineTo(69 * u, 70 * u)
      ctx.lineTo(65 * u, 70 * u)
      ctx.closePath()
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

      // Base right side (3D thickness).
      ctx.fillStyle = '#8f1a1e'
      ctx.beginPath()
      ctx.moveTo(65 * u, 68 * u)
      ctx.lineTo(69 * u, 68 * u)
      ctx.lineTo(80 * u, 114 * u)
      ctx.quadraticCurveTo(82 * u, 122 * u, 74 * u, 122 * u)
      ctx.lineTo(70 * u, 122 * u)
      ctx.quadraticCurveTo(78 * u, 122 * u, 76 * u, 114 * u)
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
      // Glass thickness band (right side) — sells the globe as a 3D sphere.
      ctx.strokeStyle = 'rgba(26,26,26,0.35)'
      ctx.lineWidth = 2.2 * u
      ctx.beginPath()
      ctx.arc(50 * u, 33 * u, 30.25 * u - 2.2 * u, -Math.PI * 0.35, Math.PI * 0.35)
      ctx.stroke()
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
      // Collar side depth outline.
      ctx.strokeStyle = ink
      ctx.lineWidth = bodyW
      ctx.beginPath()
      ctx.moveTo(61 * u, 60 * u)
      ctx.lineTo(65 * u, 60 * u)
      ctx.lineTo(69 * u, 70 * u)
      ctx.lineTo(65 * u, 70 * u)
      ctx.closePath()
      ctx.stroke()
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
      // Base side depth outline.
      ctx.strokeStyle = ink
      ctx.lineWidth = bodyW
      ctx.stroke(
        new Path2D(
          `M ${65 * u} ${68 * u} L ${69 * u} ${68 * u} L ${80 * u} ${114 * u} Q ${82 * u} ${122 * u} ${74 * u} ${122 * u} L ${70 * u} ${122 * u} Q ${78 * u} ${122 * u} ${76 * u} ${114 * u} Z`,
        ),
      )
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

  /** PLAY (primary) + the three nav buttons at explicit CSS-px positions. */
  private buildPlayAndNav(
    vw: number,
    playY: number,
    playW: number,
    playH: number,
    navW: number,
    navH: number,
    navPos: Array<{ x: number; y: number; w?: number; h?: number }>,
    playX = vw / 2,
  ): void {
    // ---- PLAY + nav: uiverse big-moose-69 buttons as a DOM layer
    // (1:1 CSS from the source), each showcasing a live ball character
    // (gaze/blink/egg expressions) drawn into a small canvas per frame.
    // The Phaser-side hit rects stay the authoritative input surface.
    const specs: Array<{ x: number; y: number; w: number; h: number; label: string; tier: number; seed: number; screen: ScreenName | 'login' }> = [
      { x: playX, y: playY, w: playW, h: playH, label: 'PLAY', tier: 1, seed: 4242, screen: 'menu' },
      { x: navPos[0]!.x, y: navPos[0]!.y, w: navW, h: navH, label: 'LEADERBOARD', tier: 2, seed: 4242 + 2 * 7, screen: 'leaderboard' },
      { x: navPos[1]!.x, y: navPos[1]!.y, w: navW, h: navH, label: 'COLLECTION', tier: 3, seed: 4242 + 3 * 7, screen: 'collection' },
      { x: navPos[2]!.x, y: navPos[2]!.y, w: navW, h: navH, label: 'SETTINGS', tier: 4, seed: 4242 + 4 * 7, screen: 'settings' },
    ]
    if (!authService.isAuthenticated() && navPos[3]) {
      const p = navPos[3]
      specs.push({ x: p.x, y: p.y, w: p.w ?? navW, h: p.h ?? navH, label: 'LOGIN', tier: 5, seed: 4242 + 5 * 7, screen: 'login' })
    }
    if (!this.uiverseDom) this.uiverseDom = new UiverseDomButtons(this)
    this.uiverseDom.build(specs)
    this.uiverseDom.setVisible(!this.closed && this.screen === 'menu')
    // Pointer-transparent DOM art mirrors these Phaser hit zones. No DOM click proxy is needed.
    specs.forEach((s, i) => {
      const hit = this.add.zone(s.x, s.y, s.w, s.h).setInteractive({ useHandCursor: true })
      this.menuLayer.add(hit)
      let pressPointerId: number | null = null
      hit.on('pointerover', () => this.uiverseDom?.setHover(i, true))
      hit.on('pointerout', (pointer: Phaser.Input.Pointer) => {
        this.uiverseDom?.setHover(i, false)
        if (pressPointerId !== null && pressPointerId !== pointer.id) return
        pressPointerId = null
        this.uiverseDom?.setPressed(i, false)
      })
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.closed || this.screen !== 'menu' || pressPointerId !== null) return
        pressPointerId = pointer.id
        this.uiverseDom?.setPressed(i, true)
      })
      hit.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pressPointerId !== pointer.id) return
        pressPointerId = null
        this.uiverseDom?.setPressed(i, false)
        if (this.closed || this.screen !== 'menu') return
        if (i === 0) this.pressStart()
        else if (s.screen === 'login') {
          const modal = new AuthModal(document.body)
          modal.onSuccess(() => {
            this.buildAll()
          })
          modal.open('login')
        } else this.openScreen(s.screen)
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
    score.setScale(Math.min(1, (w * 0.17) / Math.max(1, score.width)))
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

    drawBallIcon(this, g, bestTier, cx + w * 0.13, cy, h * 0.3, { seed: 991 * bestTier, layer: this.menuLayer })
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
    if (this.returnToPause) {
      if (screen === 'menu') this.returnToPausedGame()
      return
    }
    if (screen !== this.screen) this.disarmReset()
    this.screen = screen
    this.applyScreenVisibility()
  }
  private returnToPausedGame(): void {
    this.closed = true
    this.disarmReset()
    this.input.enabled = false
    // Visibility only: PauseScene remains active and owns resuming the run.
    this.scene.setVisible(true, 'playground')
    this.scene.setVisible(true, 'UIScene')
    this.scene.get('PauseScene').input.enabled = true
    this.scene.setVisible(true, 'PauseScene')
    this.scene.bringToTop('PauseScene')
    this.scene.stop()
  }

  private applyScreenVisibility(): void {
    const isMenu = this.screen === 'menu'
    this.panelLayer.setVisible(!isMenu)
    this.menuLayer.setVisible(isMenu)
    // The uiverse DOM layer mirrors the menu (hidden under any panel).
    this.uiverseDom?.setVisible(isMenu && !this.closed)
    this.clearPanelContent()
    if (isMenu) return
    // HiDPI: CSS-px layout, matching buildAll (camera frames the CSS region).
    const z = this.game.scale.displayScale.x || 1
    const vw = this.scale.width / z
    const vh = this.scale.height / z

    const subs: Partial<Record<ScreenName, string>> = {
      collection: 'COLLECTION ALBUM & DISCOVERY LOG',
      settings: 'BACKGROUND THEME & SAVED PROGRESS',
    }

    const titles: Partial<Record<ScreenName, string>> = {
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
      case 'collection':
        this.buildCollection(vw, vh, contentTopY)
        break
      case 'leaderboard':
        void this.buildLeaderboard(vw, vh, contentTopY)
        break
      case 'settings':
        this.buildSettings(vw, vh, contentTopY)
        break
    }
  }

  private destroyCollectionBook(): void {
    this.collectionBook?.destroy()
    this.collectionBook = null
  }

  private clearPanelContent(): void {
    this.destroyCollectionBook()
    this.teardownLeaderboardScroll()
    this.panelContent.removeAll(true)
    this.panelRects.length = 0
  }

  /** Remove leaderboard scroll listeners/masks/tweens; GameObjects die with panelContent. */
  private teardownLeaderboardScroll(): void {
    this.lbBuildSeq++
    for (const tw of this.lbTweens) tw.stop()
    this.lbTweens.length = 0
    const s = this.lbScroll
    if (!s) return
    this.lbScroll = null
    this.input.off('wheel', this.lbWheel, this)
    this.input.off('pointermove', this.lbPointerMove, this)
    this.input.off('pointerup', this.lbPointerUp, this)
    this.input.off('pointerupoutside', this.lbPointerUp, this)
    s.rowsC.clearMask()
    s.maskG.destroy()
  }

  private disarmReset(): void {
    this.resetArmed = 0
    if (this.resetArmTimer !== null) window.clearTimeout(this.resetArmTimer)
    this.resetArmTimer = null
  }
  /** Wheel scroll over the leaderboard rows area (ignored outside). */
  private lbWheel(
    pointer: Phaser.Input.Pointer,
    _currentlyOver: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void {
    const s = this.lbScroll
    if (!s || s.maxOffset <= 0) return
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorld)
    const wx = world.x
    const wy = world.y
    if (wx < s.tableX || wx > s.tableX + s.tableW) return
    if (wy < s.tableY || wy > s.tableY + s.tableH) return
    this.lbSetOffset(s.offset + dy * 0.5)
  }

  /** Pointer move during a leaderboard drag (rows or thumb). */
  private lbPointerMove(pointer: Phaser.Input.Pointer): void {
    const s = this.lbScroll
    if (!s || s.dragPointerId !== pointer.id) return
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y, this.pointerWorld)
    if (s.dragMode === 'rows') {
      const dy = world.y - s.dragStartY
      this.lbSetOffset(s.dragStartOffset - dy)
    } else if (s.dragMode === 'thumb') {
      const trackRange = s.trackH - s.thumbH
      if (trackRange <= 0) return
      const dy = world.y - s.dragStartY
      const fraction = (s.dragStartOffset / s.maxOffset) + dy / trackRange
      this.lbSetOffset(fraction * s.maxOffset)
    }
  }

  /** Pointer up ends any leaderboard drag. */
  private lbPointerUp(pointer: Phaser.Input.Pointer): void {
    const s = this.lbScroll
    if (!s || s.dragPointerId !== pointer.id) return
    s.dragPointerId = null
    s.dragMode = null
  }

  /** Clamp + apply a new scroll offset, updating rows and thumb. */
  private lbSetOffset(offset: number): void {
    const s = this.lbScroll
    if (!s) return
    s.offset = Phaser.Math.Clamp(offset, 0, s.maxOffset)
    s.rowsC.y = -s.offset
    s.thumbG.clear()
    if (s.maxOffset <= 0) return
    const thumbY = s.trackY + (s.offset / s.maxOffset) * (s.trackH - s.thumbH)
    s.thumbG.fillStyle(0xd4af37, 1)
    s.thumbG.fillRoundedRect(s.trackX + 1, thumbY, s.trackW - 2, s.thumbH, (s.trackW - 2) / 2)
  }

  private async buildLeaderboard(vw: number, vh: number, topY: number): Promise<void> {
    // Build token: bumped by teardown/shutdown, so a fetch that resolves
    // after a resize or navigation away is discarded instead of painting
    // stale layout into a rebuilt panel.
    const buildSeq = ++this.lbBuildSeq
    const safe = readSafeArea()
    const left = Math.max(12, safe.left + 8)
    const right = Math.max(12, safe.right + 8)
    const centerX = (left + vw - right) / 2
    const bodyY = topY + 8
    const availableH = vh - Math.max(16, safe.bottom + 8) - bodyY

    // Bake the Valhalla Hall of Glory background — marble pillars frame the entire scene
    const bgKey = `br-lb-bg:${Math.ceil(vw)}x${Math.ceil(vh)}`
    bakeCanvas(this, bgKey, Math.ceil(vw), Math.ceil(vh), (ctx) => {
      // Deep twilight sky with warm golden-hour glow
      const skyGrad = ctx.createLinearGradient(0, 0, 0, vh)
      skyGrad.addColorStop(0, '#0d1226')
      skyGrad.addColorStop(0.35, '#1b2348')
      skyGrad.addColorStop(0.7, '#2c3a6e')
      skyGrad.addColorStop(1, '#1a1f3a')
      ctx.fillStyle = skyGrad
      ctx.fillRect(0, 0, vw, vh)

      // Radiant golden glow emanating from the podium area (center-bottom)
      const glowCX = vw / 2
      const glowCY = vh * 0.75
      const glowR = Math.max(vw, vh) * 0.65
      const glow = ctx.createRadialGradient(glowCX, glowCY, glowR * 0.05, glowCX, glowCY, glowR)
      glow.addColorStop(0, 'rgba(255, 217, 59, 0.28)')
      glow.addColorStop(0.25, 'rgba(255, 200, 80, 0.15)')
      glow.addColorStop(0.5, 'rgba(212, 175, 55, 0.08)')
      glow.addColorStop(1, 'rgba(13, 18, 38, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, vw, vh)

      // Marble floor with reflective sheen
      const floorY = vh * 0.82
      const floorGrad = ctx.createLinearGradient(0, floorY, 0, vh)
      floorGrad.addColorStop(0, '#e8e2d6')
      floorGrad.addColorStop(0.15, '#d4cec2')
      floorGrad.addColorStop(0.5, '#c8c2b4')
      floorGrad.addColorStop(1, '#a8a294')
      ctx.fillStyle = floorGrad
      ctx.fillRect(0, floorY, vw, vh - floorY)
      // Floor edge highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.fillRect(0, floorY, vw, 3)
      // Subtle floor reflection of the glow
      const reflectGrad = ctx.createLinearGradient(0, floorY, 0, vh)
      reflectGrad.addColorStop(0, 'rgba(255, 217, 59, 0.12)')
      reflectGrad.addColorStop(0.3, 'rgba(255, 200, 80, 0.05)')
      reflectGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = reflectGrad
      ctx.fillRect(0, floorY, vw, vh - floorY)

      // Grand marble pillars framing the hall — these ARE the podium structure
      const pillarW = Math.max(42, Math.round(vw * 0.065))
      const pillarInset = Math.max(12, Math.round(vw * 0.025))
      const pillarTop = vh * 0.04
      const pillarBot = floorY + 6
      const pillarH = pillarBot - pillarTop

      // Draw pillars on both sides
      for (const side of [0, 1]) {
        const cx = side === 0 ? pillarInset + pillarW / 2 : vw - pillarInset - pillarW / 2
        const x = cx - pillarW / 2

        // Pillar shadow (soft, cast to the right)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
        ctx.fillRect(x + 5, pillarTop + 6, pillarW, pillarH)

        // Pillar body — warm Carrara marble gradient
        const colGrad = ctx.createLinearGradient(x, pillarTop, x + pillarW, pillarTop)
        colGrad.addColorStop(0, '#e8e2d6')
        colGrad.addColorStop(0.25, '#f5f0e8')
        colGrad.addColorStop(0.5, '#faf8f2')
        colGrad.addColorStop(0.75, '#f0ebe0')
        colGrad.addColorStop(1, '#d4cec2')
        ctx.fillStyle = colGrad
        ctx.fillRect(x, pillarTop, pillarW, pillarH)

        // Fluting (vertical grooves) — elegant Doric style
        const fluteCount = Math.max(4, Math.round(pillarW / 10))
        const fluteW = pillarW / (fluteCount * 2 + 1)
        for (let f = 0; f < fluteCount; f++) {
          const fx = x + fluteW * (f * 2 + 1)
          // Groove shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
          ctx.fillRect(fx, pillarTop + 12, fluteW * 0.5, pillarH - 24)
          // Groove highlight (subtle 3D effect)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
          ctx.fillRect(fx + fluteW * 0.5, pillarTop + 12, fluteW * 0.3, pillarH - 24)
        }

        // Capital (Doric-style: abacus + echinus with gold accent)
        const capH = Math.max(18, pillarW * 0.4)
        const capY = pillarTop
        // Abacus (square slab)
        ctx.fillStyle = '#f5f0e8'
        ctx.fillRect(x - 6, capY, pillarW + 12, capH * 0.35)
        // Echinus (curved cushion)
        ctx.beginPath()
        ctx.ellipse(cx, capY + capH * 0.55, pillarW * 0.6, capH * 0.4, 0, 0, Math.PI * 2)
        ctx.fill()
        // Gold accent band
        ctx.fillStyle = '#d4af37'
        ctx.fillRect(x - 4, capY + capH * 0.32, pillarW + 8, 4)
        // Capital shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
        ctx.fillRect(x - 6, capY + capH * 0.35, pillarW + 12, 3)

        // Base (plinth with torus molding)
        const baseH = Math.max(14, pillarW * 0.3)
        ctx.fillStyle = '#e0dacd'
        ctx.fillRect(x - 5, pillarBot - baseH, pillarW + 10, baseH)
        // Torus (rounded molding)
        ctx.beginPath()
        ctx.ellipse(cx, pillarBot - baseH * 0.3, pillarW * 0.55, baseH * 0.25, 0, 0, Math.PI * 2)
        ctx.fill()
        // Base shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
        ctx.fillRect(x - 5, pillarBot - 3, pillarW + 10, 3)

        // Ink outline for cartoon definition
        ctx.strokeStyle = '#1a1a1a'
        ctx.lineWidth = 2.5
        ctx.strokeRect(x, pillarTop, pillarW, pillarH)
      }

      // Decorative architrave (horizontal beam connecting the pillars)
      const archY = pillarTop - 8
      const archH = Math.max(16, pillarW * 0.35)
      const archGrad = ctx.createLinearGradient(0, archY, 0, archY + archH)
      archGrad.addColorStop(0, '#f5f0e8')
      archGrad.addColorStop(0.5, '#e8e2d6')
      archGrad.addColorStop(1, '#d4cec2')
      ctx.fillStyle = archGrad
      ctx.fillRect(pillarInset - 8, archY, vw - pillarInset * 2 + 16, archH)
      // Architrave gold trim
      ctx.fillStyle = '#d4af37'
      ctx.fillRect(pillarInset - 8, archY + archH - 4, vw - pillarInset * 2 + 16, 4)
      // Architrave shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.fillRect(pillarInset - 8, archY + archH, vw - pillarInset * 2 + 16, 4)
      // Architrave outline
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 2
      ctx.strokeRect(pillarInset - 8, archY, vw - pillarInset * 2 + 16, archH)
    }, window.devicePixelRatio || 1)

    const bgImg = this.add.image(0, 0, bgKey).setOrigin(0, 0).setDisplaySize(Math.ceil(vw), Math.ceil(vh))
    this.panelContent.addAt(bgImg, 0)
    const g = this.add.graphics()
    this.panelContent.add(g)

    // Show loading state
    const loadingT = hudText(this, centerX, bodyY + availableH / 2, 'LOADING LEADERBOARD...', 1, {
      color: UI_COLORS.TEXT_MUTED,
      size: 18,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    this.panelContent.add(loadingT)

    // Fetch leaderboard from Supabase
    interface LeaderboardEntry {
      rank: number
      displayName: string
      score: number
      tierReached: number
      createdAt: number
      isCurrentUser: boolean
    }

    let entries: LeaderboardEntry[] = []
    let fetchError: string | null = null

    try {
      const scores = await scoreService.getLeaderboard(50)
      const currentUserId = authService.getUser()?.id

      entries = scores.map((s, i) => ({
        rank: i + 1,
        displayName: s.profiles?.display_name || 'Anonymous',
        score: s.score,
        tierReached: s.tier_reached,
        createdAt: new Date(s.created_at).getTime(),
        isCurrentUser: s.user_id === currentUserId,
      }))
    } catch (err) {
      console.error('Leaderboard fetch failed:', err)
      fetchError = err instanceof Error ? err.message : 'Failed to load leaderboard'
    }

    // Clear loading indicator
    loadingT.destroy()
    // Stale fetch: the panel was rebuilt (resize/auth/navigation) or the
    // scene shut down while the request was in flight — discard.
    if (this.closed || this.screen !== 'leaderboard' || buildSeq !== this.lbBuildSeq) return

    const isDesktop = vw >= 720 && vw > vh
    const maxTotalW = isDesktop ? Math.min(1120, vw - left - right) : Math.min(500, vw - left - right)
    const totalX = centerX - maxTotalW / 2

    // Error state
    if (fetchError) {
      const errorW = Math.min(480, maxTotalW)
      const errorX = centerX - errorW / 2
      const errorH = Math.min(144, availableH)
      const errorY = bodyY + Math.min(40, Math.max(0, (availableH - errorH) / 3))
      g.fillStyle(UI_COLORS.CARD_BG, 1)
      g.fillRoundedRect(errorX, errorY, errorW, errorH, 14)
      g.lineStyle(2, 0xff6b6b, 1)
      g.strokeRoundedRect(errorX, errorY, errorW, errorH, 14)

      const errorT = hudText(this, centerX, errorY + 40, 'FAILED TO LOAD', 1, {
        color: '#ff6b6b',
        size: 18,
        stroke: 3,
        origin: [0.5, 0.5],
      })
      this.panelContent.add(errorT)

      const errorSub = hudText(this, centerX, errorY + 72, fetchError, 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: 13,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      })
      errorSub.setWordWrapWidth(errorW - 36, true).setAlign('center')
      this.panelContent.add(errorSub)
      return
    }

    // Empty state
    if (entries.length === 0) {
      const emptyW = Math.min(480, maxTotalW)
      const emptyX = centerX - emptyW / 2
      const emptyH = Math.min(144, availableH)
      const emptyY = bodyY + Math.min(40, Math.max(0, (availableH - emptyH) / 3))
      g.fillStyle(UI_COLORS.CARD_BG, 1)
      g.fillRoundedRect(emptyX, emptyY, emptyW, emptyH, 14)
      g.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
      g.strokeRoundedRect(emptyX, emptyY, emptyW, emptyH, 14)

      const empty = hudText(this, centerX, emptyY + 40, 'NO SCORES YET', 1, {
        color: UI_COLORS.TEXT_GOLD,
        size: 18,
        stroke: 3,
        origin: [0.5, 0.5],
      })
      this.panelContent.add(empty)

      const emptySub = hudText(this, centerX, emptyY + 72, 'Be the first to submit a score!', 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: 13,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      })
      emptySub.setWordWrapWidth(emptyW - 36, true).setAlign('center')
      this.panelContent.add(emptySub)
      return
    }

    const top3 = entries.slice(0, 3)

    // Layout geometry: side-by-side on desktop, stacked on mobile
    let podiumX: number
    let podiumY: number
    let podiumW: number
    let podiumH: number
    let tableX: number
    let tableY: number
    let tableW: number
    let tableH: number

    if (isDesktop) {
      const gap = Math.max(28, Math.round(maxTotalW * 0.038))
      podiumW = Math.round((maxTotalW - gap) * 0.47)
      tableW = maxTotalW - gap - podiumW
      podiumX = totalX
      tableX = totalX + podiumW + gap
      tableH = Math.min(484, availableH - 20)
      tableY = bodyY + Math.max(8, Math.round((availableH - tableH) / 2))
      podiumH = tableH
      podiumY = tableY
    } else {
      // Stacked mobile layout — must fit availableH even on short viewports:
      // shrink the podium before letting the table overflow the screen.
      const stackGap = 12
      const minTableH = 120
      podiumW = maxTotalW
      podiumX = totalX
      podiumH = Math.min(268, Math.max(150, Math.round(availableH * 0.36)))
      podiumH = Math.min(podiumH, Math.max(140, availableH - stackGap - 6 - minTableH))
      podiumY = bodyY + 4
      tableW = maxTotalW
      tableX = totalX
      tableY = podiumY + podiumH + stackGap
      tableH = Math.max(96, availableH - (tableY - bodyY) - 6)
    }

    // --- PODIUM (TOP 3) ---
    const plinthH = isDesktop ? 36 : 24
    const plinthY = podiumY + podiumH - plinthH
    const baseY = plinthY + Math.round(plinthH * 0.32)
    const usableH = baseY - podiumY

    // Connected 2-1-3 stepped monument with #1 overlapping #2 and #3 in front
    const overlap = isDesktop ? 10 : 7
    const blocksTotalW = Math.round(podiumW * (isDesktop ? 0.9 : 0.92))
    const firstW = Math.round(blocksTotalW * 0.38)
    const sideW = Math.round((blocksTotalW - firstW + overlap * 2) / 2)
    const firstH = Math.round(usableH * (isDesktop ? 0.5 : 0.52))
    const secondH = Math.round(firstH * (isDesktop ? 0.78 : 0.8))
    const thirdH = Math.round(firstH * (isDesktop ? 0.66 : 0.68))
    const deckH = isDesktop ? 24 : 16

    const firstX = Math.round(podiumX + (podiumW - firstW) / 2)
    const secondX = firstX - sideW + overlap
    const thirdX = firstX + firstW - overlap

    // Draw 2nd and 3rd first so 1st place sits heroically in front
    const podiumSlots = [
      {
        x: secondX,
        y: baseY - secondH,
        w: sideW,
        h: secondH,
        visualCX: secondX + (sideW - overlap * 0.45) / 2,
        rank: 2,
        entry: top3[1],
        tier: 1,
      },
      {
        x: thirdX,
        y: baseY - thirdH,
        w: sideW,
        h: thirdH,
        visualCX: thirdX + overlap * 0.45 + (sideW - overlap * 0.45) / 2,
        rank: 3,
        entry: top3[2],
        tier: 5,
      },
      {
        x: firstX,
        y: baseY - firstH,
        w: firstW,
        h: firstH,
        visualCX: firstX + firstW / 2,
        rank: 1,
        entry: top3[0],
        tier: 6,
      },
    ]

    // Bake the marble pillar podium — the pillars ARE the podium structure
    const podiumKey = `br-podium:${Math.ceil(podiumW)}x${Math.ceil(podiumH)}:${top3.map((e) => (e ? (e.isCurrentUser ? 'u' : '1') : '0')).join('')}`
    bakeCanvas(
      this,
      podiumKey,
      Math.ceil(podiumW),
      Math.ceil(podiumH),
      (ctx) => {
        const ink = '#1a1a1a'
        const strokeW = isDesktop ? 4 : 3.2

        // 1. Radiant golden spotlight behind the podium (emanating from #1)
        const glowCX = podiumW / 2
        const glowCY = (baseY - firstH - podiumY) * 0.9
        const glowR = podiumW * 0.55
        const glow = ctx.createRadialGradient(glowCX, glowCY, glowR * 0.05, glowCX, glowCY, glowR)
        glow.addColorStop(0, 'rgba(255, 217, 59, 0.35)')
        glow.addColorStop(0.4, 'rgba(255, 200, 80, 0.18)')
        glow.addColorStop(0.7, 'rgba(212, 175, 55, 0.08)')
        glow.addColorStop(1, 'rgba(17, 21, 39, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(glowCX, glowCY, glowR, 0, Math.PI * 2)
        ctx.fill()

        // 2. Marble pillar podium blocks (back-to-front: #2, #3, then #1 in front)
        for (const slot of podiumSlots) {
          if (!slot.entry) continue
          const lx = slot.x - podiumX
          const ly = slot.y - podiumY
          const { w, h, rank } = slot
          const vcx = slot.visualCX - podiumX
          const ballR = Math.min(
            (w - (rank === 1 ? 0 : overlap * 0.5)) * (rank === 1 ? 0.39 : 0.36),
            (baseY - firstH - podiumY) * (rank === 1 ? 0.38 : 0.34),
          )

          // Pillar dimensions
          const pillarTop = ly
          const pillarBot = ly + h + 10
          const pillarH = pillarBot - pillarTop
          const pillarCX = lx + w / 2

          // Pillar shadow (soft, cast to the right)
          ctx.fillStyle = rank === 1 ? 'rgba(6, 9, 20, 0.5)' : 'rgba(6, 9, 20, 0.32)'
          ctx.fillRect(lx + 4, pillarTop + 5, w, pillarH)

          // Pillar body — warm Carrara marble gradient
          const bodyGrad = ctx.createLinearGradient(lx, pillarTop, lx + w, pillarTop)
          if (rank === 1) {
            // Gold-tinted marble for #1
            bodyGrad.addColorStop(0, '#f5f0e8')
            bodyGrad.addColorStop(0.25, '#faf5e8')
            bodyGrad.addColorStop(0.5, '#fff9e8')
            bodyGrad.addColorStop(0.75, '#f5f0e0')
            bodyGrad.addColorStop(1, '#e0d5c0')
          } else if (rank === 2) {
            // Silver-tinted marble for #2
            bodyGrad.addColorStop(0, '#e8e8f0')
            bodyGrad.addColorStop(0.25, '#f0f0f5')
            bodyGrad.addColorStop(0.5, '#f5f5fa')
            bodyGrad.addColorStop(0.75, '#e8e8f0')
            bodyGrad.addColorStop(1, '#d0d0d8')
          } else {
            // Bronze-tinted marble for #3
            bodyGrad.addColorStop(0, '#f0e8e0')
            bodyGrad.addColorStop(0.25, '#f5f0e8')
            bodyGrad.addColorStop(0.5, '#faf5f0')
            bodyGrad.addColorStop(0.75, '#f0e8e0')
            bodyGrad.addColorStop(1, '#d8d0c8')
          }
          ctx.fillStyle = bodyGrad
          ctx.fillRect(lx, pillarTop, w, pillarH)

          // Fluting (vertical grooves) — elegant Doric style
          const fluteCount = Math.max(3, Math.round(w / 14))
          const fluteW = w / (fluteCount * 2 + 1)
          for (let f = 0; f < fluteCount; f++) {
            const fx = lx + fluteW * (f * 2 + 1)
            // Groove shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'
            ctx.fillRect(fx, pillarTop + 8, fluteW * 0.5, pillarH - 16)
            // Groove highlight (subtle 3D effect)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
            ctx.fillRect(fx + fluteW * 0.5, pillarTop + 8, fluteW * 0.3, pillarH - 16)
          }

          // Capital (Doric-style: abacus + echinus with gold accent)
          const capH = Math.max(14, w * 0.28)
          const capY = pillarTop
          // Abacus (square slab)
          ctx.fillStyle = rank === 1 ? '#fff9e8' : rank === 2 ? '#f5f5fa' : '#faf5f0'
          ctx.fillRect(lx - 4, capY, w + 8, capH * 0.35)
          // Echinus (curved cushion)
          ctx.beginPath()
          ctx.ellipse(pillarCX, capY + capH * 0.55, w * 0.55, capH * 0.4, 0, 0, Math.PI * 2)
          ctx.fill()
          // Gold accent band
          ctx.fillStyle = rank === 1 ? '#ffd83b' : rank === 2 ? '#c0c8e0' : '#e0a868'
          ctx.fillRect(lx - 2, capY + capH * 0.32, w + 4, 3)
          // Capital shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
          ctx.fillRect(lx - 4, capY + capH * 0.35, w + 8, 2)

          // Base (plinth with torus molding)
          const baseH = Math.max(10, w * 0.22)
          ctx.fillStyle = rank === 1 ? '#f0e8d8' : rank === 2 ? '#e0e0e8' : '#e8e0d8'
          ctx.fillRect(lx - 3, pillarBot - baseH, w + 6, baseH)
          // Torus (rounded molding)
          ctx.beginPath()
          ctx.ellipse(pillarCX, pillarBot - baseH * 0.3, w * 0.52, baseH * 0.25, 0, 0, Math.PI * 2)
          ctx.fill()
          // Base shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
          ctx.fillRect(lx - 3, pillarBot - 2, w + 6, 2)

          // Ink outline for cartoon definition
          ctx.strokeStyle = ink
          ctx.lineWidth = strokeW
          ctx.strokeRect(lx, pillarTop, w, pillarH)

          // Soft elliptical contact shadow on the capital top where the ball sits
          const seatY = pillarTop + capH * 0.5
          ctx.fillStyle = 'rgba(20, 16, 10, 0.25)'
          ctx.beginPath()
          ctx.ellipse(vcx, seatY + 2, ballR * 0.7, Math.max(4, capH * 0.2), 0, 0, Math.PI * 2)
          ctx.fill()

          // Rank medal badge + golden laurel leaves on #1
          const badgeR = Math.max(12, Math.min(20, Math.round(Math.min(w * 0.17, h * 0.155))))
          const badgeY = pillarTop + capH + badgeR + Math.max(5, Math.round(h * 0.045))

          if (rank === 1) {
            for (const dir of [-1, 1]) {
              for (let l = 0; l < 3; l++) {
                const leafX = vcx + dir * (badgeR + 5 + l * 2.5)
                const leafY = badgeY + (l - 1) * (badgeR * 0.36)
                const angle = dir * (0.35 + (1 - l) * 0.28)
                ctx.save()
                ctx.translate(leafX, leafY)
                ctx.rotate(angle)
                ctx.fillStyle = '#ffd93b'
                ctx.beginPath()
                ctx.ellipse(0, 0, Math.max(4.5, badgeR * 0.34), Math.max(2.6, badgeR * 0.19), 0, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = ink
                ctx.lineWidth = Math.max(2, strokeW * 0.6)
                ctx.stroke()
                ctx.restore()
              }
            }
          }

          // Medal drop shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
          ctx.beginPath()
          ctx.arc(vcx, badgeY + 2, badgeR, 0, Math.PI * 2)
          ctx.fill()

          // Medal circle fill
          const medalGrad = ctx.createLinearGradient(0, badgeY - badgeR, 0, badgeY + badgeR)
          if (rank === 1) {
            medalGrad.addColorStop(0, '#fff394')
            medalGrad.addColorStop(1, '#f59e0b')
          } else if (rank === 2) {
            medalGrad.addColorStop(0, '#f2f6ff')
            medalGrad.addColorStop(1, '#849cd6')
          } else {
            medalGrad.addColorStop(0, '#ffd8b3')
            medalGrad.addColorStop(1, '#cf651b')
          }
          ctx.fillStyle = medalGrad
          ctx.beginPath()
          ctx.arc(vcx, badgeY, badgeR, 0, Math.PI * 2)
          ctx.fill()

          // Medal inner top crescent highlight
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
          ctx.beginPath()
          ctx.ellipse(vcx, badgeY - badgeR * 0.38, badgeR * 0.6, badgeR * 0.28, 0, 0, Math.PI * 2)
          ctx.fill()

          // Medal ink outline
          ctx.strokeStyle = ink
          ctx.lineWidth = Math.max(2.4, strokeW * 0.78)
          ctx.beginPath()
          ctx.arc(vcx, badgeY, badgeR, 0, Math.PI * 2)
          ctx.stroke()

          // Golden celebration rays fanning out around the temples of the #1 ball
          if (rank === 1) {
            const ballCYLocal = seatY + 1 - ballR
            const rayAngles = [-2.88, -2.54, -2.2, -0.94, -0.6, -0.26]
            const rayInner = ballR * 1.16
            const rayOuter = ballR * 1.38
            ctx.lineCap = 'round'
            for (const ang of rayAngles) {
              const rx0 = vcx + Math.cos(ang) * rayInner
              const ry0 = ballCYLocal - ballR * 0.06 + Math.sin(ang) * rayInner
              const rx1 = vcx + Math.cos(ang) * rayOuter
              const ry1 = ballCYLocal - ballR * 0.06 + Math.sin(ang) * rayOuter
              ctx.strokeStyle = ink
              ctx.lineWidth = Math.max(6, ballR * 0.13)
              ctx.beginPath()
              ctx.moveTo(rx0, ry0)
              ctx.lineTo(rx1, ry1)
              ctx.stroke()

              ctx.strokeStyle = '#ffd93b'
              ctx.lineWidth = Math.max(3, ballR * 0.07)
              ctx.beginPath()
              ctx.moveTo(rx0, ry0)
              ctx.lineTo(rx1, ry1)
              ctx.stroke()
            }
          }
        }

        // 3. Stepped 2-tier cushioned royal-indigo stage plinth grounding all 3 blocks
        const py = plinthY - podiumY
        ctx.fillStyle = 'rgba(5, 8, 18, 0.6)'
        ctx.fill(new Path2D(roundedRectPath(2, py + 5, podiumW - 4, plinthH, plinthH / 2)))

        const plinthPath = new Path2D(roundedRectPath(4, py, podiumW - 8, plinthH, plinthH / 2))
        const plinthGrad = ctx.createLinearGradient(0, py, 0, py + plinthH)
        plinthGrad.addColorStop(0, '#524b91')
        plinthGrad.addColorStop(0.5, '#37326b')
        plinthGrad.addColorStop(1, '#231f47')
        ctx.fillStyle = plinthGrad
        ctx.fill(plinthPath)

        const plinthTopH = Math.round(plinthH * 0.48)
        ctx.fillStyle = '#655eb0'
        ctx.fill(new Path2D(roundedRectPath(8, py + 2, podiumW - 16, plinthTopH, plinthTopH / 2)))
        ctx.fillStyle = 'rgba(255, 255, 255, 0.32)'
        ctx.fill(new Path2D(roundedRectPath(20, py + 3.5, podiumW - 40, 2.5, 1.25)))

        ctx.strokeStyle = ink
        ctx.lineWidth = strokeW
        ctx.stroke(plinthPath)
      },
      window.devicePixelRatio || 1,
    )

    // Podium art + balls + labels animate as ONE group (entrance rise).
    const podiumGroup = this.add.container(0, 0)
    this.panelContent.addAt(podiumGroup, 1)
    const podiumImg = this.add.image(podiumX, podiumY, podiumKey).setOrigin(0, 0).setDisplaySize(podiumW, podiumH)
    podiumGroup.add(podiumImg)
    // Dedicated graphics for the ball characters so they move with the group.
    const podiumG = this.add.graphics()
    podiumGroup.add(podiumG)

    podiumSlots.forEach((slot) => {
      if (!slot.entry) return
      const { y, w, h, visualCX, rank, entry, tier } = slot
      const cx = visualCX

      // Ball character rests ON TOP of the 3D top cushion deck (never clipped behind the block)
      const effectiveW = w - (rank === 1 ? 0 : overlap * 0.5)
      const ballR = Math.min(
        effectiveW * (rank === 1 ? 0.39 : 0.36),
        (baseY - firstH - podiumY) * (rank === 1 ? 0.38 : 0.34),
      )
      const seatY = y + deckH * 0.58
      const ballCY = seatY + 1 - ballR

      drawBallIcon(this, podiumG, tier, cx, ballCY, ballR, {
        seed: rank * 777 + tier * 31,
        layer: podiumGroup,
      })

      // Plush soft-edged golden crown perched jauntily on the 1st-place ball
      if (rank === 1) {
        addCrownImage(
          this,
          podiumGroup,
          cx - ballR * 0.07,
          ballCY - ballR * 0.98,
          ballR * 1.24,
          ballR * 0.9,
          -0.12,
        )
      }

      const badgeR = Math.max(12, Math.min(20, Math.round(Math.min(w * 0.17, h * 0.155))))
      const badgeY = y + deckH + badgeR + Math.max(5, Math.round(h * 0.045))
      const rankT = hudText(this, cx, badgeY, `${rank}`, 1, {
        color: '#1a1a1a',
        size: Math.round(badgeR * 1.18),
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      podiumGroup.add(rankT)

      // Player name & score grouped cleanly on the block face
      const textTop = badgeY + badgeR + 4
      const textAvail = Math.max(28, plinthY - textTop - 4)
      const nameY = textTop + textAvail * 0.3
      const scoreY = textTop + textAvail * 0.74
      const maxTextW = effectiveW - 12

      const nameSize = Math.max(12, Math.min(18, Math.round(Math.min(effectiveW * 0.15, h * 0.155))))
      const nameT = hudText(this, cx, nameY, entry.displayName, 1, {
        color: '#ffffff',
        size: nameSize,
        stroke: 4,
        origin: [0.5, 0.5],
        shadow: false,
      })
      nameT.setScale(Math.min(1, maxTextW / Math.max(1, nameT.width)))
      podiumGroup.add(nameT)

      const scoreSize = Math.max(13, Math.min(21, Math.round(Math.min(effectiveW * 0.18, h * 0.18))))
      const scoreT = hudText(this, cx, scoreY, entry.score.toLocaleString('en-US'), 1, {
        color: rank === 1 ? '#ffe14d' : rank === 2 ? '#fff6b8' : '#ffd269',
        size: scoreSize,
        stroke: 4,
        origin: [0.5, 0.5],
        shadow: false,
      })
      scoreT.setScale(Math.min(1, (maxTextW + 4) / Math.max(1, scoreT.width)))
      podiumGroup.add(scoreT)
    })

    // --- FRAMED LEADERBOARD TABLE (TOP 10) ---
    // Drop shadow
    g.fillStyle(0x000000, 0.5)
    g.fillRoundedRect(tableX + 8, tableY + 10, tableW, tableH, 20)
    // Outer frame (soft indigo/purple-blue rim like reference)
    g.fillStyle(0x3b4880, 1)
    g.fillRoundedRect(tableX, tableY, tableW, tableH, 20)
    g.lineStyle(4, INK, 1)
    g.strokeRoundedRect(tableX, tableY, tableW, tableH, 20)
    // Inner dark recessed well
    const wellPad = 8
    const wellX = tableX + wellPad
    const wellY = tableY + wellPad
    const wellW = tableW - wellPad * 2
    const wellH = tableH - wellPad * 2
    g.fillStyle(0x13192e, 1)
    g.fillRoundedRect(wellX, wellY, wellW, wellH, 16)

    // Column headers: # | PLAYER | SCORE
    const headerH = isDesktop ? 36 : 30
    const headerCY = wellY + headerH / 2 + 4
    const padX = isDesktop ? 16 : 12
    const scrollW = 10
    const rowW = wellW - padX * 2 - scrollW - 12
    const rowX = wellX + padX
    const rankColX = rowX + (isDesktop ? 32 : 26)
    const iconColX = rowX + (isDesktop ? 76 : 62)
    const playerColX = rowX + (isDesktop ? 106 : 86)
    const scoreColX = rowX + rowW - (isDesktop ? 16 : 12)

    const hdrSize = isDesktop ? 14 : 12
    const hRank = hudText(this, rankColX, headerCY, '#', 1, {
      color: '#a3b3d9',
      size: hdrSize,
      stroke: 2,
      origin: [0.5, 0.5],
      shadow: false,
    })
    const hPlayer = hudText(this, playerColX, headerCY, 'PLAYER', 1, {
      color: '#a3b3d9',
      size: hdrSize,
      stroke: 2,
      origin: [0, 0.5],
      shadow: false,
    })
    const hScore = hudText(this, scoreColX, headerCY, 'SCORE', 1, {
      color: '#a3b3d9',
      size: hdrSize,
      stroke: 2,
      origin: [1, 0.5],
      shadow: false,
    })
    this.panelContent.add([hRank, hPlayer, hScore])

    // --- SCROLLABLE ROWS AREA ---
    const rowsTopY = wellY + headerH + 6
    const rowsAvailH = wellH - headerH - 16
    const slotCount = entries.length
    const rowGap = isDesktop ? 5 : 4
    const rowH = Math.max(20, Math.floor((rowsAvailH - (10 - 1) * rowGap) / 10))
    const totalRowsH = slotCount * (rowH + rowGap) - rowGap
    const needsScroll = totalRowsH > rowsAvailH

    // Scroll state
    const maxScroll = Math.max(0, totalRowsH - rowsAvailH)

    // Rows container (masked, scrollable)
    const rowsContainer = this.add.container(0, 0)
    this.panelContent.add(rowsContainer)

    // Mask: clip rows to the visible area below the header
    const maskG = this.add.graphics()
    maskG.fillStyle(0xffffff)
    maskG.fillRect(wellX, rowsTopY - 2, wellW, rowsAvailH + 4)
    const rowsMask = new Phaser.Display.Masks.GeometryMask(this, maskG)
    rowsContainer.setMask(rowsMask)
    maskG.setVisible(false)

    // Scrollbar track + thumb (only when needed)
    const sbX = wellX + wellW - padX - scrollW
    const sbY = rowsTopY
    const sbH = rowsAvailH
    const thumbH = needsScroll ? Math.max(28, (rowsAvailH / totalRowsH) * sbH) : 0
    const thumbG = this.add.graphics()
    if (needsScroll) {
      thumbG.fillStyle(0x0b0f1d, 0.9)
      thumbG.fillRoundedRect(sbX, sbY, scrollW, sbH, scrollW / 2)
      thumbG.fillStyle(0xd4af37, 1)
      thumbG.fillRoundedRect(sbX + 1, sbY, scrollW - 2, thumbH, (scrollW - 2) / 2)
    }
    this.panelContent.add(thumbG)

    // Scroll input zone (rows + thumb)
    const scrollZone = this.add.zone(wellX, wellY, wellW, wellH).setOrigin(0, 0).setInteractive()

    // Store scroll state for the scene-level handlers
    this.lbScroll = {
      rowsC: rowsContainer,
      maskG,
      thumbG,
      zone: scrollZone,
      offset: 0,
      maxOffset: maxScroll,
      viewH: rowsAvailH,
      contentH: totalRowsH,
      rowH,
      rowGap,
      trackX: sbX,
      trackY: sbY,
      trackW: scrollW,
      trackH: sbH,
      thumbH,
      tableX,
      tableY,
      tableW,
      tableH,
      dragPointerId: null,
      dragMode: null,
      dragStartY: 0,
      dragStartOffset: 0,
    }

    // Wire scene-level input handlers
    this.input.on('wheel', this.lbWheel, this)
    this.input.on('pointermove', this.lbPointerMove, this)
    this.input.on('pointerup', this.lbPointerUp, this)
    this.input.on('pointerupoutside', this.lbPointerUp, this)

    // Zone pointerdown starts a drag (rows or thumb)
    scrollZone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const s = this.lbScroll
      if (!s || s.maxOffset <= 0 || s.dragPointerId !== null) return
      const world = this.cameras.main.getWorldPoint(p.x, p.y, this.pointerWorld)
      const wx = world.x
      const wy = world.y
      if (wx >= s.trackX && wx <= s.trackX + s.trackW && wy >= s.trackY && wy <= s.trackY + s.trackH) {
        const thumbTop = s.trackY + (s.offset / s.maxOffset) * (s.trackH - s.thumbH)
        if (wy >= thumbTop && wy <= thumbTop + s.thumbH) {
          s.dragPointerId = p.id
          s.dragMode = 'thumb'
          s.dragStartY = wy
          s.dragStartOffset = s.offset
          return
        }
      }
      // Rows area hit test (exclude scrollbar track)
      if (wx >= wellX && wx <= wellX + wellW - scrollW - 4 && wy >= s.trackY && wy <= s.trackY + s.trackH) {
        s.dragPointerId = p.id
        s.dragMode = 'rows'
        s.dragStartY = wy
        s.dragStartOffset = s.offset
      }
    })

    const fallbackTiers = [6, 1, 5, 3, 2, 4, 1, 4, 6, 2]

    for (let i = 0; i < slotCount; i++) {
      const entry = entries[i]!
      const y = rowsTopY + i * (rowH + rowGap)
      const cy = y + rowH / 2
      const rank = i + 1
      const isFirst = rank === 1
      const isCurrentUser = entry.isCurrentUser

      // Row background drawn into rowsContainer via a local Graphics.
      // The current user keeps their cyan identity even at rank #1 (cyan
      // stroke over the gold fill) — the podium carries no user marker.
      const rowG = this.add.graphics()
      if (isFirst) {
        rowG.fillStyle(0xd99b16, 1)
        rowG.fillRoundedRect(rowX, y, rowW, rowH, 12)
        rowG.fillStyle(0xffdf6b, 0.3)
        rowG.fillRoundedRect(rowX + 2, y + 2, rowW - 4, rowH * 0.45, 10)
        rowG.lineStyle(2, isCurrentUser ? 0x4fc3f7 : 0xffeb75, 1)
        rowG.strokeRoundedRect(rowX, y, rowW, rowH, 12)
      } else if (isCurrentUser) {
        rowG.fillStyle(0x213d6b, 0.95)
        rowG.fillRoundedRect(rowX, y, rowW, rowH, 10)
        rowG.lineStyle(2, 0x4fc3f7, 1)
        rowG.strokeRoundedRect(rowX, y, rowW, rowH, 10)
      } else {
        rowG.fillStyle(i % 2 === 0 ? 0x1b2340 : 0x151c34, 0.9)
        rowG.fillRoundedRect(rowX, y, rowW, rowH, 10)
      }
      rowsContainer.add(rowG)

      if (isFirst) {
        // Crown center keeps the whole 24×18 image inside the rows mask
        // (mask top = rowsTopY - 2; crown top = y + 1 for the first row).
        addCrownImage(this, rowsContainer, rowX + 13, y + 10, 24, 18, -0.28)
      }

      const fontSize = Math.max(12, Math.min(18, Math.round(rowH * 0.48)))
      const rankT = hudText(this, rankColX, cy, `${rank}`, 1, {
        color: '#ffffff',
        size: fontSize,
        stroke: 3,
        origin: [0.5, 0.5],
        shadow: false,
      })
      rowsContainer.add(rankT)

      // Ball icon (top 3 match their podium character; 4+ use tierReached or vibrant fallback)
      const rowTier =
        rank === 1
          ? 6
          : rank === 2
            ? 1
            : rank === 3
              ? 5
              : entry.tierReached > 1
                ? Math.min(BALL_TIERS.length, entry.tierReached)
                : fallbackTiers[i % fallbackTiers.length]!
      const iconR = Math.max(10, Math.min(18, rowH * 0.38))
      drawBallIcon(this, rowG, rowTier, iconColX, cy, iconR, {
        seed: rank * 777 + rowTier * 31,
        layer: rowsContainer,
      })

      const scoreStr = entry.score.toLocaleString('en-US')
      const scoreT = hudText(this, scoreColX, cy, scoreStr, 1, {
        color: isFirst ? '#ffd93b' : isCurrentUser ? '#4fc3f7' : '#ffffff',
        size: fontSize,
        stroke: 3,
        origin: [1, 0.5],
        shadow: false,
      })
      rowsContainer.add(scoreT)

      const maxNameW = Math.max(40, scoreColX - scoreT.width - playerColX - 16)
      const nameT = hudText(this, playerColX, cy, entry.displayName, 1, {
        color: isCurrentUser ? '#4fc3f7' : '#ffffff',
        size: fontSize,
        stroke: 3,
        origin: [0, 0.5],
        shadow: false,
      })
      nameT.setScale(Math.min(1, maxNameW / Math.max(1, nameT.width)))
      rowsContainer.add(nameT)
    }
    // --- ENTRANCE ANIMATIONS ---
    // Restrained cloud drift: transform-only x motion on baked wisp images,
    // skipped entirely under prefers-reduced-motion. No per-frame bakes.
    if (!this.reducedMotion) {
      const cloudKey = 'br-lb-cloud'
      bakeCanvas(
        this,
        cloudKey,
        140,
        48,
        (ctx) => {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
          for (const [ex, ey, erx, ery] of [
            [42, 30, 34, 14],
            [78, 22, 40, 17],
            [110, 32, 26, 11],
          ] as const) {
            ctx.beginPath()
            ctx.ellipse(ex, ey, erx, ery, 0, 0, Math.PI * 2)
            ctx.fill()
          }
        },
        window.devicePixelRatio || 1,
      )
      const cloudSpecs = [
        { x: vw * 0.2, y: vh * 0.1, s: 1.0, a: 0.16, drift: 26, dur: 9000 },
        { x: vw * 0.68, y: vh * 0.16, s: 0.72, a: 0.11, drift: 34, dur: 12000 },
      ]
      for (const c of cloudSpecs) {
        const img = this.add.image(c.x, c.y, cloudKey).setOrigin(0.5, 0.5).setScale(c.s).setAlpha(c.a)
        this.panelContent.addAt(img, 1)
        this.lbTweens.push(
          this.tweens.add({
            targets: img,
            x: c.x + c.drift,
            duration: c.dur,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }),
        )
      }

      // Podium (art + balls + labels + crown) rises from below as one group
      podiumGroup.setY(30)
      podiumGroup.setAlpha(0)
      this.lbTweens.push(
        this.tweens.add({
          targets: podiumGroup,
          y: 0,
          alpha: 1,
          duration: 500,
          ease: 'Back.easeOut',
          delay: 100,
        }),
      )
      // Crown shimmer: gentle alpha pulse on the #1 crown
      const crownImg = podiumGroup.list.find(
        (o): o is Phaser.GameObjects.Image =>
          o instanceof Phaser.GameObjects.Image && o.texture.key === 'br-leaderboard-crown-v4',
      )
      if (crownImg) {
        this.lbTweens.push(
          this.tweens.add({
            targets: crownImg,
            alpha: { from: 1, to: 0.75 },
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }),
        )
      }
      // Row entrance cascade: staggered fade-in per row
      const rowTexts = rowsContainer.list.filter(
        (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text,
      )
      rowTexts.forEach((t, i) => {
        t.setAlpha(0)
        this.lbTweens.push(
          this.tweens.add({
            targets: t,
            alpha: 1,
            duration: 240,
            delay: 400 + i * 45,
            ease: 'Quad.easeOut',
          }),
        )
      })
    }
  }

  private buildSettings(vw: number, vh: number, topY: number): void {
    if (this.resetArmed > 0 && Date.now() >= this.resetArmed) this.disarmReset()
    const save = loadSave()
    const safe = readSafeArea()
    const left = Math.max(12, safe.left + 8)
    const right = Math.max(12, safe.right + 8)
    const sideBySide = vw >= 700 && vh < 550
    const compact = !sideBySide && vh < 740
    const contentW = Math.min(sideBySide ? 880 : 480, vw - left - right)
    const contentX = left + (vw - left - right - contentW) / 2
    const cardW = sideBySide ? (contentW - 16) / 2 : contentW
    const themeX = contentX
    const themeY = topY + (compact ? 4 : 6)
    const themeCenterX = themeX + cardW / 2
    const twoThemeRows = cardW < 420
    const themeCardH = twoThemeRows ? (compact ? 158 : 194) : (compact ? 124 : 142)
    const g = this.add.graphics()
    this.panelContent.add(g)

    g.fillStyle(UI_COLORS.CARD_BG, 1)
    g.fillRoundedRect(themeX, themeY, cardW, themeCardH, 12)
    g.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
    g.strokeRoundedRect(themeX, themeY, cardW, themeCardH, 12)
    const themeHead = hudText(this, themeCenterX, themeY + 22, 'BACKGROUND THEME', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 15,
      stroke: 3,
      origin: [0.5, 0.5],
    })
    themeHead.setScale(Math.min(1, (cardW - 24) / Math.max(1, themeHead.width)))
    this.panelContent.add(themeHead)

    const themes: Array<{ key: 'auto' | ThemeName; label: string }> = [
      { key: 'auto', label: 'AUTO' },
      { key: 'light', label: 'LIGHT' },
      { key: 'space', label: 'SPACE' },
      { key: 'jungle', label: 'JUNGLE' },
      { key: 'fantasy', label: 'FANTASY' },
    ]
    const columns = twoThemeRows ? 3 : themes.length
    const btnGap = compact ? 6 : 8
    const bw = Math.floor((cardW - 24 - (columns - 1) * btnGap) / columns)
    const bh = compact ? 36 : 44

    themes.forEach((theme, i) => {
      const row = twoThemeRows && i >= 3 ? 1 : 0
      const column = row === 1 ? i - 3 : i
      const rowCount = row === 1 ? 2 : columns
      const rowW = rowCount * bw + (rowCount - 1) * btnGap
      const bx = themeCenterX - rowW / 2 + bw / 2 + column * (bw + btnGap)
      const by = themeY + (compact ? 54 : 66) + row * (compact ? 42 : 52)
      const selected = save.settings.theme === theme.key
      const btn = new ChunkyButton({
        scene: this,
        x: bx,
        y: by,
        w: bw,
        h: bh,
        pill: true,
        fill: selected ? UI_COLORS.BTN_BLUE : UI_COLORS.CARD_BG,
        shadowColor: selected ? UI_COLORS.BTN_BLUE_SHADOW : 0x0f1422,
        highlightColor: selected ? UI_COLORS.BTN_BLUE_HIGHLIGHT : 0x2b3555,
        label: theme.label,
        fontSize: 13,
        onClick: () => {
          this.disarmReset()
          setThemeSetting(theme.key)
          const bg = this.scene.get('BackgroundScene') as BackgroundScene | undefined
          // AUTO starts at light, then follows discoveries; resetTheme intentionally leaves portrait unchanged.
          bg?.setTheme(theme.key === 'auto' ? 'light' : theme.key, 400)
          this.applyScreenVisibility()
        },
      })
      this.panelContent.add(btn.container)
      this.panelRects.push({
        label: `THEME_${theme.key.toUpperCase()}`,
        x: bx - bw / 2,
        y: by - bh / 2,
        w: bw,
        h: bh,
        screen: 'settings',
      })
    })

    const note = hudText(this, themeCenterX, themeY + (twoThemeRows ? (compact ? 124 : 156) : (compact ? 88 : 104)), 'AUTO follows discoveries during a run.\nFixed themes stay selected after reload.', 1, {
      color: UI_COLORS.TEXT_MUTED,
      size: compact ? 10 : 11,
      stroke: 0,
      origin: [0.5, 0],
      shadow: false,
    })
    note.setWordWrapWidth(cardW - 32, true).setAlign('center')
    this.panelContent.add(note)

    const statsX = sideBySide ? contentX + cardW + 16 : contentX
    const statsY = sideBySide ? themeY : themeY + themeCardH + (compact ? 8 : 14)
    const statsCenterX = statsX + cardW / 2
    const statsCardH = compact ? 76 : 94
    g.fillStyle(UI_COLORS.CARD_BG, 1)
    g.fillRoundedRect(statsX, statsY, cardW, statsCardH, 12)
    g.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
    g.strokeRoundedRect(statsX, statsY, cardW, statsCardH, 12)
    const statsHead = hudText(this, statsCenterX, statsY + 22, 'CAREER HIGHLIGHTS', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: 15,
      stroke: 3,
      origin: [0.5, 0.5],
    })
    statsHead.setScale(Math.min(1, (cardW - 24) / Math.max(1, statsHead.width)))
    this.panelContent.add(statsHead)

    const stats = save.stats
    const statCols = [
      { label: 'TOTAL RUNS', val: stats.runs.toLocaleString('en-US') },
      { label: 'TOTAL MERGES', val: stats.merges.toLocaleString('en-US') },
      { label: 'BEST TIER', val: stats.bestTier > 0 ? `T${stats.bestTier}` : '-' },
    ]
    const colW = cardW / statCols.length
    statCols.forEach((col, i) => {
      const cx = statsX + colW * (i + 0.5)
      const value = hudText(this, cx, statsY + (compact ? 44 : 52), col.val, 1, {
        color: UI_COLORS.TEXT_WHITE,
        size: compact ? 16 : 18,
        stroke: 3,
        origin: [0.5, 0.5],
      })
      value.setScale(Math.min(1, (colW - 12) / Math.max(1, value.width)))
      this.panelContent.add(value)
      const label = hudText(this, cx, statsY + (compact ? 64 : 76), col.label, 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: 10,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      label.setScale(Math.min(1, (colW - 12) / Math.max(1, label.width)))
      this.panelContent.add(label)
    })

    const resetY = statsY + statsCardH + (compact ? 10 : 18)
    const resetBtnW = Math.min(280, cardW - 32)
    const resetBtnH = compact ? 38 : 44
    const armed = this.resetArmed > Date.now()
    const resetBtn = new ChunkyButton({
      scene: this,
      x: statsCenterX,
      y: resetY + resetBtnH / 2,
      w: resetBtnW,
      h: resetBtnH,
      pill: true,
      fill: armed ? UI_COLORS.BTN_RED : UI_COLORS.CARD_BG,
      shadowColor: armed ? UI_COLORS.BTN_RED_SHADOW : 0x0f1422,
      highlightColor: armed ? UI_COLORS.BTN_RED_HIGHLIGHT : 0x2b3555,
      label: armed ? 'TAP AGAIN TO CONFIRM' : 'RESET PROGRESS',
      fontSize: 13,
      onClick: () => {
        if (this.resetArmed > Date.now()) {
          this.disarmReset()
          resetSave({ syncCloud: true, clearOwner: false })
          this.registry.set('best', 0)
          gameBus.emit('state:best', { best: 0 })
          const bg = this.scene.get('BackgroundScene') as BackgroundScene | undefined
          bg?.setTheme('light', 400)
          // Rebuild the hidden home stats as well as the visible Settings panel.
          this.buildAll()
        } else {
          this.disarmReset()
          this.resetArmed = Date.now() + 4000
          this.resetArmTimer = window.setTimeout(() => {
            this.resetArmTimer = null
            this.resetArmed = 0
            if (!this.closed && this.screen === 'settings') this.applyScreenVisibility()
          }, 4000)
          this.applyScreenVisibility()
        }
      },
    })
    this.panelContent.add(resetBtn.container)
    this.panelRects.push({
      label: 'RESET',
      x: statsCenterX - resetBtnW / 2,
      y: resetY,
      w: resetBtnW,
      h: resetBtnH,
      screen: 'settings',
    })

    const wipe = hudText(this, statsCenterX, resetY + resetBtnH + (compact ? 8 : 12),
      armed
        ? 'Tap again within 4 seconds to erase progress.\nLeaving this screen cancels confirmation.'
        : 'Clears scores, collection, run history and stats.\nRestores AUTO theme. This cannot be undone.', 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: compact ? 10 : 11,
        stroke: 0,
        origin: [0.5, 0],
        shadow: false,
      })
    wipe.setWordWrapWidth(cardW - 24, true).setAlign('center')
    this.panelContent.add(wipe)

    // Account section below the wipe notice (use measured wipe height so it never overlaps)
    const accountTopY = wipe.y + wipe.displayHeight + (compact ? 8 : 14)
    this.buildAccountSection(vw, vh, accountTopY)
  }

  private buildAccountSection(vw: number, vh: number, topY: number): void {
    const safe = readSafeArea()
    const left = Math.max(12, safe.left + 8)
    const right = Math.max(12, safe.right + 8)
    const sideBySide = vw >= 700 && vh < 550
    const compact = !sideBySide && vh < 740
    const contentW = Math.min(sideBySide ? 880 : 480, vw - left - right)
    const contentX = left + (vw - left - right - contentW) / 2
    const cardW = sideBySide ? (contentW - 16) / 2 : contentW
    const centerX = contentX + cardW / 2
    const g = this.add.graphics()
    this.panelContent.add(g)

    const isAuthed = authService.isAuthenticated()
    const profile = authService.getProfile()
    const displayName = resolveDisplayName(profile)

    const cardH = compact ? 102 : 118
    const cardY = topY + (compact ? 2 : 6)
    g.fillStyle(UI_COLORS.CARD_BG, 1)
    g.fillRoundedRect(contentX, cardY, cardW, cardH, 12)
    g.lineStyle(2, UI_COLORS.CARD_BORDER, 1)
    g.strokeRoundedRect(contentX, cardY, cardW, cardH, 12)

    const head = hudText(this, centerX, cardY + (compact ? 18 : 22), 'ACCOUNT', 1, {
      color: UI_COLORS.TEXT_GOLD,
      size: compact ? 14 : 15,
      stroke: 3,
      origin: [0.5, 0.5],
    })
    head.setScale(Math.min(1, (cardW - 24) / Math.max(1, head.width)))
    this.panelContent.add(head)

    if (isAuthed) {
      const info = hudText(this, centerX, cardY + (compact ? 40 : 48), `Logged in as ${displayName}`, 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: compact ? 11 : 12,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      info.setScale(Math.min(1, (cardW - 24) / Math.max(1, info.width)))
      this.panelContent.add(info)

      const btnW = Math.min(200, cardW - 48)
      const btnH = compact ? 36 : 40
      const btnY = cardY + cardH - btnH / 2 - (compact ? 12 : 16)
      const logoutBtn = new ChunkyButton({
        scene: this,
        x: centerX,
        y: btnY,
        w: btnW,
        h: btnH,
        pill: true,
        fill: UI_COLORS.BTN_RED,
        shadowColor: UI_COLORS.BTN_RED_SHADOW,
        highlightColor: UI_COLORS.BTN_RED_HIGHLIGHT,
        label: 'LOGOUT',
        fontSize: 13,
        onClick: () => {
          if (!window.confirm('Are you sure you want to log out?')) return
          void authService.signOut().then(() => {
            this.buildAll()
          })
        },
      })
      this.panelContent.add(logoutBtn.container)
      this.panelRects.push({
        label: 'LOGOUT',
        x: centerX - btnW / 2,
        y: btnY - btnH / 2,
        w: btnW,
        h: btnH,
        screen: 'settings',
      })
    } else {
      const info = hudText(this, centerX, cardY + (compact ? 40 : 48), 'Not logged in', 1, {
        color: UI_COLORS.TEXT_MUTED,
        size: compact ? 11 : 12,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      info.setScale(Math.min(1, (cardW - 24) / Math.max(1, info.width)))
      this.panelContent.add(info)

      const btnW = Math.min(200, cardW - 48)
      const btnH = compact ? 36 : 40
      const btnY = cardY + cardH - btnH / 2 - (compact ? 12 : 16)
      const loginBtn = new ChunkyButton({
        scene: this,
        x: centerX,
        y: btnY,
        w: btnW,
        h: btnH,
        pill: true,
        fill: UI_COLORS.BTN_BLUE,
        shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
        highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
        label: 'LOGIN',
        fontSize: 13,
        onClick: () => {
          const modal = new AuthModal(document.body)
          modal.onSuccess(() => {
            this.buildAll()
          })
          modal.open('login')
        },
      })
      this.panelContent.add(loginBtn.container)
      this.panelRects.push({
        label: 'LOGIN',
        x: centerX - btnW / 2,
        y: btnY - btnH / 2,
        w: btnW,
        h: btnH,
        screen: 'settings',
      })
    }
  }

  private buildCollection(vw: number, vh: number, topY: number): void {
    this.collectionBook = new CollectionBookView(this, this.panelContent, vw, vh, topY)
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
    if (this.closed || this.returnToPause) return
    this.closed = true
    this.destroyCollectionBook()
    this.disarmReset()
    this.input.enabled = false
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
 * Bakes a plush, soft-edged cartoon golden crown into a high-DPI Canvas2D
 * texture (smooth round joins, curved U-valleys, warm gold gradient, 3 pom-pom
 * pearls, zero tacky dots) and adds it to `container`.
 */
function addCrownImage(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotation = 0,
): Phaser.GameObjects.Image {
  const key = 'br-leaderboard-crown-v4'
  bakeCanvas(
    scene,
    key,
    160,
    140,
    (ctx) => {
      const ink = '#1a1a1a'
      const cx0 = 80
      const topY = 28
      const sidePeakY = 40
      const bottomY = 106
      const leftPeakX = 18
      const rightPeakX = 142
      const leftBaseX = 30
      const rightBaseX = 130

      // Single-parabola U-valleys between peaks for infinitely smooth cartoon curves
      const crownPath = new Path2D(
        [
          `M ${leftBaseX} ${bottomY}`,
          `Q ${leftBaseX - 8} ${(bottomY + sidePeakY) * 0.55} ${leftPeakX} ${sidePeakY}`,
          `Q 50 86 ${cx0} ${topY}`,
          `Q 110 86 ${rightPeakX} ${sidePeakY}`,
          `Q ${rightBaseX + 8} ${(bottomY + sidePeakY) * 0.55} ${rightBaseX} ${bottomY}`,
          `Q ${cx0} ${bottomY + 10} ${leftBaseX} ${bottomY}`,
          'Z',
        ].join(' '),
      )

      const bodyGrad = ctx.createLinearGradient(0, topY, 0, bottomY + 8)
      bodyGrad.addColorStop(0, '#fff68f')
      bodyGrad.addColorStop(0.55, '#ffd426')
      bodyGrad.addColorStop(1, '#f59e0b')
      ctx.fillStyle = bodyGrad
      ctx.fill(crownPath)

      // Glossy cartoon sheen + soft warm golden base cushion
      ctx.save()
      ctx.clip(crownPath)

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.beginPath()
      ctx.ellipse(cx0 - 20, 62, 24, 34, -0.2, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(255, 252, 212, 0.8)'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(leftBaseX + 8, bottomY - 9)
      ctx.quadraticCurveTo(cx0, bottomY - 2, rightBaseX - 8, bottomY - 9)
      ctx.stroke()

      ctx.restore()

      // Bold rounded cartoon ink outline around crown body
      ctx.strokeStyle = ink
      ctx.lineWidth = 9.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke(crownPath)

      // 3 plump golden pom-pom pearls on the peak tips
      const pearls = [
        { x: leftPeakX, y: sidePeakY },
        { x: cx0, y: topY },
        { x: rightPeakX, y: sidePeakY },
      ]
      const pearlR = 12
      for (const pk of pearls) {
        const pg = ctx.createRadialGradient(pk.x - 3, pk.y - 3, 2, pk.x, pk.y, pearlR)
        pg.addColorStop(0, '#fffab8')
        pg.addColorStop(0.55, '#ffd83b')
        pg.addColorStop(1, '#e5880b')
        ctx.fillStyle = pg
        ctx.beginPath()
        ctx.arc(pk.x, pk.y, pearlR, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = ink
        ctx.lineWidth = 8.5
        ctx.beginPath()
        ctx.arc(pk.x, pk.y, pearlR, 0, Math.PI * 2)
        ctx.stroke()

        // Specular dot on pearl
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
        ctx.beginPath()
        ctx.arc(pk.x - 3.2, pk.y - 3.2, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    },
    window.devicePixelRatio || 1,
  )

  const img = scene.add.image(cx, cy, key).setDisplaySize(w, h).setRotation(rotation)
  container.add(img)
  return img
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
  if (!opts.silhouette && (tier === 9 || tier === 10)) {
    // Claws and fins must fit the same icon slot as an ordinary ball.
    const iconR = r / (tier === 10 ? 2.6 : 1.5)
    drawCollectibleBall(g, cx, cy, iconR, tier, opts.variant ?? variantIdFor(tier), undefined, 0, undefined, opts.seed ?? tier)
    return
  }
  const look = ballLookFor(tier, opts.seed ?? 7)
  const poly = restContour(look, r, cx, cy, 32)
  const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))

  if (opts.silhouette || tier >= 11) {
    g.fillStyle(0x23242e, 1)
    g.fillPoints(pts, true)
  } else {
    // Tier 8 is a plain ball whose colour cycles; the body fills the
    // CONTOUR (so it matches its ink outline) in the current cycle colour.
    g.fillStyle(tier === 8 ? cycleColor(Date.now()) : t.color, 1)
    g.fillPoints(pts, true)
  }

  g.lineStyle(ballOutlineWidth(r), INK, 1)
  g.strokePoints(pts, true, true)

  if (opts.silhouette || tier >= 11) {
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

