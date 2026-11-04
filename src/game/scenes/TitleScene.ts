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
import { MAX_RENDER_DPR } from '../../config/stage'
import type { BackgroundScene } from './BackgroundScene'
import type { ThemeName } from '../rendering/BackgroundTheme'
import { loadSave, resetSave, setThemeSetting } from '../state/save'
import { tier9Theme, variantIdFor } from '../state/runVariant'
import { session } from '../state/session'
import { bakeCanvas, roundedRectPath } from '../rendering/RoughArt'
import { drawChampionMedal, drawChampionPlaque, drawChampionPodium } from '../rendering/ChampionPodiumArt'
import { drawOlympusHall, drawOlympusTablet } from '../rendering/OlympusHallArt'
import { playGoldenScreenTransition } from '../rendering/GoldenScreenTransition'
import { playLeaderboardEntrance, type ChampionEntranceParts } from '../rendering/LeaderboardEntrance'
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
const LEADERBOARD_TEXT = '#25283a'
const LEADERBOARD_SECONDARY = '#555467'
const LEADERBOARD_FONT = 'Nunito, ui-rounded, system-ui, sans-serif'
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
    maskFilter: Phaser.Filters.Mask | null
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
    renderRows: (offset: number) => void
    wheelBlocker: (event: WheelEvent) => void
    dragStartY: number
    dragStartOffset: number
  } | null = null
  /** Leaderboard tweens (entrance, crown shimmer, cloud drift) — killed on teardown. */
  private lbTweens: Phaser.Tweens.Tween[] = []
  /** Monotonic build token — a stale async leaderboard fetch detects a
   * resize/navigation rebuild by comparing its captured token. */
  private lbBuildSeq = 0
  private leaderboardTransitionCleanup: (() => void) | null = null
  private lbModalOpen = false
  private lbCachedScores: Awaited<ReturnType<typeof scoreService.getLeaderboard>> | null = null
  private lbEntrancePending = false
  private lbModalLayer: Phaser.GameObjects.Container | null = null
  private lbModalPopup: Phaser.GameObjects.Container | null = null
  private lbModalDim: Phaser.GameObjects.Rectangle | null = null
  private lbModalBusy = false
  private lbModalClose: ChunkyButton | null = null
  private lbModalCenter = { x: 0, y: 0 }
  private lbModalReturnRects: typeof this.panelRects = []
  private lbModalTweens: Phaser.Tweens.Tween[] = []
  private lbModalCleanup: (() => void) | null = null
  private lbEntranceCleanup: (() => void) | null = null
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
      this.leaderboardTransitionCleanup?.()
      this.leaderboardTransitionCleanup = null
      this.lbModalCleanup?.()
      this.lbModalCleanup = null
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
    const enteringLeaderboard = screen === 'leaderboard' && this.screen !== 'leaderboard'
    this.lbEntrancePending = enteringLeaderboard && !this.reducedMotion
    if (enteringLeaderboard) {
      const z = this.game.scale.displayScale.x || 1
      const vw = this.scale.width / z
      const vh = this.scale.height / z
      this.leaderboardTransitionCleanup?.()
      this.leaderboardTransitionCleanup = playGoldenScreenTransition(this, this.panelLayer, vw, vh, this.reducedMotion)
    }
    if (screen !== this.screen) this.disarmReset()
    if (screen !== this.screen) {
      this.lbModalOpen = false
      this.lbCachedScores = null
    }
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
    if (vw > vh) this.lbModalOpen = false

    const subs: Partial<Record<ScreenName, string>> = {
      collection: 'COLLECTION ALBUM & DISCOVERY LOG',
      settings: 'BACKGROUND THEME & SAVED PROGRESS',
    }

    const titles: Partial<Record<ScreenName, string>> = {
      collection: 'COLLECTION BOOK',
      leaderboard: 'LEADERBOARD',
      settings: 'SETTINGS',
    }

    const { contentTopY } = this.screen === 'leaderboard'
      ? this.buildLeaderboardHeader(vw, vh)
      : buildScreenHeader(this, this.panelContent, {
        vw, vh,
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

  private buildLeaderboardHeader(vw: number, vh: number): { contentTopY: number } {
    const safe = readSafeArea()
    const margin = vw < 600 || vh < 500 ? 16 : 28
    const x = Math.max(margin, safe.left + 12)
    const right = Math.max(margin, safe.right + 12)
    const y = Math.max(12, safe.top + 8)
    const height = vh < 500 ? 68 : 80
    const backW = vw < 600 ? 84 : 104
    const backH = 40
    const backX = x + 12 + backW / 2
    const cy = y + height / 2 - 3
    const back = new ChunkyButton({ scene: this, x: backX, y: cy, w: backW, h: backH,
      label: 'BACK', fontSize: 13,
      fill: 0xe8cc8b, shadowColor: 0xa77a32,
      highlightColor: 0xfff8e9, onClick: () => this.openScreen('menu') })
    this.panelContent.add(back.container)
    this.panelRects.push({ label: 'BACK', x: backX - backW / 2, y: cy - backH / 2,
      w: backW, h: backH, screen: 'panel' })
    const titleLeft = x + backW + 36
    const titleRight = vw - right - 16
    const title = hudText(this, (titleLeft + titleRight) / 2, cy, 'LEADERBOARD', 1,
      { color: '#ffe19a', size: vw < 600 ? 28 : 38, stroke: 3, origin: [0.5, 0.5], shadow: false })
    title.setScale(Math.min(1, (titleRight - titleLeft) / title.width))
    this.panelContent.add(title)
    return { contentTopY: y + height + 16 }
  }

  private setLeaderboardModal(open: boolean): void {
    const layer = this.lbModalLayer
    const popup = this.lbModalPopup
    const dim = this.lbModalDim
    const scroll = this.lbScroll
    if (this.closed || this.screen !== 'leaderboard' || !layer || !popup || !dim || !scroll || this.lbModalBusy || this.lbModalOpen === open) return
    this.lbModalOpen = open
    this.lbModalBusy = !this.reducedMotion
    scroll.dragPointerId = null
    scroll.zone.disableInteractive()
    scroll.rowsC.setAlpha(open ? 0 : 1)
    for (const tween of this.lbModalTweens) tween.stop()
    this.lbModalTweens.length = 0
    const positionPopup = () => {
      popup.setPosition(this.lbModalCenter.x * (1 - popup.scaleX), this.lbModalCenter.y * (1 - popup.scaleY))
    }
    const finish = () => {
      this.lbModalBusy = false
      if (open) {
        popup.setScale(1).setPosition(0, 0).setAlpha(1)
        scroll.rowsC.setAlpha(1)
        scroll.zone.setInteractive()
      } else {
        layer.setVisible(false)
        this.lbModalCleanup?.()
        this.lbModalCleanup = null
        this.panelRects = this.lbModalReturnRects.map((rect) => ({ ...rect }))
      }
    }
    if (open) {
      layer.setVisible(true)
      this.panelContent.bringToTop(layer)
      dim.setAlpha(0)
      popup.setScale(this.reducedMotion ? 1 : 0.9).setAlpha(0)
      positionPopup()
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      const escape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') this.setLeaderboardModal(false)
      }
      window.addEventListener('keydown', escape)
      this.lbModalCleanup = () => {
        window.removeEventListener('keydown', escape)
        document.body.style.overflow = previousOverflow
      }
      const close = this.lbModalClose!.container
      this.panelRects = [{ label: 'CLOSE', x: close.x - 32, y: close.y - 20, w: 64, h: 40, screen: 'panel' }]
    }
    if (this.reducedMotion) {
      dim.setAlpha(open ? 0.65 : 0)
      popup.setAlpha(open ? 1 : 0)
      finish()
      return
    }
    const duration = open ? 280 : 190
    this.lbModalTweens.push(this.tweens.add({ targets: dim, alpha: open ? 0.65 : 0, duration, ease: 'Quad.easeOut' }))
    this.lbModalTweens.push(this.tweens.add({ targets: scroll.rowsC, alpha: open ? 1 : 0, duration: open ? 120 : 70, delay: open ? 190 : 0 }))
    this.lbModalTweens.push(this.tweens.add({ targets: popup, scaleX: open ? 1 : 0.94, scaleY: open ? 1 : 0.94,
      alpha: open ? 1 : 0, duration, ease: open ? 'Cubic.easeOut' : 'Quad.easeIn', onUpdate: positionPopup, onComplete: finish }))
  }

  private destroyCollectionBook(): void {
    this.collectionBook?.destroy()
    this.collectionBook = null
  }

  private clearPanelContent(): void {
    this.lbModalCleanup?.()
    this.lbModalCleanup = null
    this.destroyCollectionBook()
    this.teardownLeaderboardScroll()
    this.panelContent.removeAll(true)
    this.panelRects.length = 0
  }

  /** Remove leaderboard scroll listeners/masks/tweens; GameObjects die with panelContent. */
  private teardownLeaderboardScroll(): void {
    this.lbBuildSeq++
    this.lbEntranceCleanup?.()
    this.lbEntranceCleanup = null
    for (const tw of this.lbTweens) tw.stop()
    this.lbTweens.length = 0
    for (const tween of this.lbModalTweens) tween.stop()
    this.lbModalTweens.length = 0
    this.lbModalBusy = false
    this.lbModalOpen = false
    this.lbModalLayer = null
    this.lbModalPopup = null
    this.lbModalDim = null
    this.lbModalClose = null
    const s = this.lbScroll
    if (!s) return
    this.lbScroll = null
    this.input.off('wheel', this.lbWheel, this)
    this.input.off('pointermove', this.lbPointerMove, this)
    this.input.off('pointerup', this.lbPointerUp, this)
    this.input.off('pointerupoutside', this.lbPointerUp, this)
    if (s.maskFilter) s.rowsC.filters!.external.remove(s.maskFilter)
    else s.rowsC.clearMask(true)
    s.maskG.destroy()
    s.zone.destroy()
    this.game.canvas.removeEventListener('wheel', s.wheelBlocker)
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
    if (!s || s.maxOffset <= 0 || !s.zone.input?.enabled || this.lbModalBusy) return
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
    s.renderRows(s.offset)
    s.thumbG.clear()
    if (s.maxOffset <= 0) return
    s.thumbG.fillStyle(0xd8cdb7, 1)
    s.thumbG.fillRoundedRect(s.trackX, s.trackY, s.trackW, s.trackH, s.trackW / 2)
    const thumbY = s.trackY + (s.offset / s.maxOffset) * (s.trackH - s.thumbH)
    s.thumbG.fillStyle(0xa77a32, 1)
    s.thumbG.fillRoundedRect(s.trackX + 1, thumbY, s.trackW - 2, s.thumbH, (s.trackW - 2) / 2)
  }

  private async buildLeaderboard(vw: number, vh: number, topY: number): Promise<void> {
    // Build token: bumped by teardown/shutdown, so a fetch that resolves
    // after a resize or navigation away is discarded instead of painting
    // stale layout into a rebuilt panel.
    const buildSeq = ++this.lbBuildSeq
    const safe = readSafeArea()
    const margin = vw < 600 || vh < 500 ? 16 : 28
    const left = Math.max(margin, safe.left + 12)
    const right = Math.max(margin, safe.right + 12)
    const centerX = (left + vw - right) / 2
    const bodyY = topY
    const availableH = vh - Math.max(margin, safe.bottom + 12) - bodyY

    const bgKey = 'br-olympus-hall'
    bakeCanvas(this, bgKey, Math.ceil(vw), Math.ceil(vh), (ctx) => {
      drawOlympusHall(ctx, vw, vh)
    }, window.devicePixelRatio || 1)

    const bgImg = this.add.image(0, 0, bgKey).setOrigin(0, 0).setDisplaySize(Math.ceil(vw), Math.ceil(vh))
    this.panelContent.addAt(bgImg, 0)
    if (this.lbEntrancePending && !this.reducedMotion) bgImg.setAlpha(0.15)
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
      const scores = this.lbCachedScores ?? await scoreService.getLeaderboard(Number.POSITIVE_INFINITY)
      if (buildSeq === this.lbBuildSeq) this.lbCachedScores = scores
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

    const isDesktop = (vw >= 1100 && vw > vh) || (vw >= 600 && vw > vh && vh < 600)
    const portrait = vw <= vh
    const modal = portrait
    const maxTotalW = Math.min(isDesktop ? 1560 : 820, vw - left - right)
    const totalX = centerX - maxTotalW / 2

    // Error state
    if (fetchError) {
      bgImg.setAlpha(1)
      this.lbEntrancePending = false
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
      bgImg.setAlpha(1)
      this.lbEntrancePending = false
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

    // One measured grid owns both the art and text anchors.
    const panelGap = isDesktop && vh >= 500 ? 32 : 20
    const podiumW = isDesktop ? Math.round((maxTotalW - panelGap) * 0.46) : maxTotalW
    const tableW = isDesktop ? maxTotalW - panelGap - podiumW : maxTotalW
    const podiumX = totalX
    const tableX = isDesktop ? totalX + podiumW + panelGap : totalX
    const columnGap = isDesktop ? 16 : 10
    const columnW = Math.floor((podiumW - 16 - columnGap * 2) / 3)
    const plateW = columnW - 2
    const nameSize = podiumW >= 500 ? 23 : 16
    const scoreSize = podiumW >= 500 ? 28 : 21
    let deckH = podiumW >= 500 ? 24 : 18
    let medalR = podiumW >= 500 ? 21 : 14
    let plinthH = podiumW >= 500 ? 30 : 22
    let heightStep = podiumW >= 500 ? 30 : 16
    const podiumLabels = top3.map((entry) => {
      const name = leaderboardTextStyle(hudText(this, 0, 0, entry.displayName, 1, {
        color: LEADERBOARD_TEXT, size: nameSize, stroke: 0, pad: 1,
        origin: [0.5, 0.5], shadow: false,
      })).setWordWrapWidth(plateW - 16, true).setAlign('center').setLineSpacing(2)
      const score = leaderboardTextStyle(hudText(this, 0, 0, entry.score.toLocaleString('en-US'), 1, {
        color: LEADERBOARD_TEXT, size: scoreSize, stroke: 0, pad: 1,
        origin: [0.5, 0.5], shadow: false,
      }))
      return { name, score }
    })
    const plateTextH = Math.max(nameSize * 1.5, ...podiumLabels.map((label) => label.name.height))
    const podiumScoreH = Math.max(...podiumLabels.map((label) => label.score.height))
    let ballR = Math.min(columnW * 0.33, isDesktop ? 72 : 42)

    // Keep type readable: measure full names at the intended font size, then
    // give every row the same height based on the tallest wrapped name.
    const rowFontSize = tableW >= 520 ? 26 : 21
    const narrowTablet = tableW < 340
    const wellPad = tableW >= 520 ? 20 : narrowTablet ? 12 : 14
    const padX = tableW >= 520 ? 10 : narrowTablet ? 2 : 4
    const headerH = tableW >= 520 ? 48 : narrowTablet ? 36 : 40
    const rowGap = 6
    const scrollW = 8
    const wellW = tableW - wellPad * 2
    const rowW = wellW - padX * 2 - scrollW - 8
    const rankW = tableW >= 520 ? 44 : narrowTablet ? 32 : 36
    const avatarW = tableW >= 520 ? 52 : narrowTablet ? 38 : 42
    const cellGap = tableW >= 520 ? 14 : narrowTablet ? 6 : 8
    // Measure with one reusable text object, not one canvas per player.
    const measure = leaderboardTextStyle(hudText(this, 0, 0, '', 1, {
      color: LEADERBOARD_TEXT, size: rowFontSize, stroke: 0, pad: 1, shadow: false,
    })).setLineSpacing(2)
    const scoreStrings = entries.map((entry) => entry.score.toLocaleString('en-US'))
    let scoreW = 64
    for (const score of scoreStrings) scoreW = Math.max(scoreW, measure.setText(score).width)
    const nameW = rowW - rankW - avatarW - scoreW - cellGap * 2 - 12
    measure.setWordWrapWidth(nameW, true)
    let rowH = tableW >= 520 ? 68 : 60
    for (const entry of entries) rowH = Math.max(rowH, measure.setText(entry.displayName).height + 20)
    rowH = Math.ceil(rowH)
    measure.destroy()
    const slotCount = entries.length
    const totalRowsH = slotCount * (rowH + rowGap) - rowGap
    const desiredTableH = wellPad * 2 + headerH + 12 + (isDesktop ? 6 : 4) * (rowH + rowGap) - rowGap
    // Reserve the full measured row, header and insets before sizing podium art.
    // Text keeps its measured size; only capitals, medals, balls and gaps compact.
    const minTableH = wellPad * 2 + headerH + 12 + rowH
    const podiumBudget = isDesktop || portrait ? availableH - (portrait ? 124 : 0) : availableH - minTableH - panelGap
    const naturalArtH = deckH + 8 + medalR * 2 + 10 + 16 + 10 + 16 + 18
      + heightStep * 2 + ballR * 2.8 + plinthH + 8
    const compactArtH = 6 + 3 + 16 + 3 + 6 + 3 + 4 + 8 + 10 * 2.8 + 8 + 8 + 10
    const artScale = Phaser.Math.Clamp(
      (podiumBudget - plateTextH - podiumScoreH - compactArtH) / (naturalArtH - compactArtH), 0, 1,
    )
    const compact = (minimum: number, normal: number) => minimum + (normal - minimum) * artScale
    deckH = compact(6, deckH)
    medalR = compact(8, medalR)
    plinthH = compact(8, plinthH)
    heightStep = compact(4, heightStep)
    ballR = compact(10, ballR)
    const medalGap = compact(3, 8)
    const plateGap = compact(3, 10)
    const scoreGap = compact(3, 10)
    const footGap = compact(4, 16)
    const plaqueScoreH = podiumScoreH + compact(10, 18)
    const plateH = plateTextH + compact(6, 16)
    const componentH = deckH + medalGap + medalR * 2 + plateGap + plateH + scoreGap + plaqueScoreH + footGap
    const firstH = componentH + heightStep * 2
    const podiumH = firstH + ballR * 2.8 + plinthH + 8
    const tableMaxH = isDesktop ? availableH : availableH - podiumH - panelGap
    const tableH = modal ? availableH : Math.min(desiredTableH, tableMaxH)
    const compositionH = portrait ? podiumH + 124 : isDesktop ? Math.max(podiumH, tableH) : podiumH + panelGap + tableH
    const podiumY = bodyY + Math.max(0, (availableH - compositionH) / 2)
    const tableY = modal ? bodyY : isDesktop ? podiumY : podiumY + podiumH + panelGap
    const plinthY = podiumY + podiumH - plinthH - 3
    const baseY = plinthY + 3
    const firstX = podiumX + (podiumW - columnW) / 2
    const podiumSlots = [
      { rank: 2, tier: 1, x: firstX - columnW - columnGap, h: componentH + heightStep, index: 1 },
      { rank: 3, tier: 5, x: firstX + columnW + columnGap, h: componentH, index: 2 },
      { rank: 1, tier: 6, x: firstX, h: firstH, index: 0 },
    ].map((slot) => {
      const y = baseY - slot.h
      const medalY = y + deckH + medalGap + medalR
      const plateY = medalY + medalR + plateGap
      return { ...slot, y, w: columnW, visualCX: slot.x + columnW / 2,
        medalY, medalR, plateY, plateW, plateH, entry: top3[slot.index] }
    })
    // Plate height depends on measured names, so its geometry is part of the bake key.
    const podiumKey = `br-olympus-podium:${top3.length}:${plateH}:${componentH}:${artScale}`
    bakeCanvas(this, podiumKey, Math.ceil(podiumW), Math.ceil(podiumH), (ctx) => {
      const columns = podiumSlots.filter((slot) => slot.entry).map((slot) => ({
        ...slot, x: slot.x - podiumX, y: slot.y - podiumY,
        visualCX: slot.visualCX - podiumX, medalY: slot.medalY - podiumY, plateY: slot.plateY - podiumY,
      }))
      drawChampionPodium(ctx, podiumW, podiumH, columns, plinthY - podiumY, plinthH, deckH)
    }, window.devicePixelRatio || 1)
    const podiumGroup = this.add.container(0, 0)
    this.panelContent.addAt(podiumGroup, 1)
    const baseImage = this.add.image(podiumX, podiumY, podiumKey).setOrigin(0, 0).setDisplaySize(podiumW, podiumH)
    podiumGroup.add(baseImage)
    const champions: ChampionEntranceParts[] = []
    for (const slot of podiumSlots) {
      if (!slot.entry) continue
      const cx = slot.visualCX
      const seatY = slot.y + deckH * 0.58 + 1
      const ball = this.add.container(cx, seatY)
      const ballG = this.add.graphics()
      ball.add(ballG)
      drawBallIcon(this, ballG, slot.tier, 0, -ballR, ballR, {
        seed: slot.rank * 777 + slot.tier * 31, layer: ball,
      })
      if (slot.rank === 1) addCrownImage(this, ball, -ballR * 0.07,
        -ballR * 1.98, ballR * 1.24, ballR * 0.9, -0.12)
      const medalW = Math.ceil(medalR * 3.8 + 4)
      const medalH = Math.ceil(medalR * 2.4 + 4)
      const medalKey = `br-champion-medal:${slot.rank}:${medalW}:${medalH}`
      bakeCanvas(this, medalKey, medalW, medalH, (ctx) => drawChampionMedal(ctx, medalW, medalH, slot.rank), window.devicePixelRatio || 1)
      const medal = this.add.container(cx, slot.medalY, [
        this.add.image(0, 0, medalKey).setDisplaySize(medalW, medalH),
      ])
      const labels = podiumLabels[slot.index]!
      const nameKey = `br-champion-name:${plateW}:${plateH}`
      bakeCanvas(this, nameKey, Math.ceil(plateW), Math.ceil(plateH), (ctx) => drawChampionPlaque(ctx, plateW, plateH, 'name'), window.devicePixelRatio || 1)
      labels.name.setPosition(0, 0)
      const name = this.add.container(cx, slot.plateY + plateH / 2, [
        this.add.image(0, 0, nameKey).setDisplaySize(plateW, plateH), labels.name,
      ])
      const scoreKey = `br-champion-score:${plateW}:${plaqueScoreH}`
      bakeCanvas(this, scoreKey, Math.ceil(plateW), Math.ceil(plaqueScoreH), (ctx) => drawChampionPlaque(ctx, plateW, plaqueScoreH, 'score'), window.devicePixelRatio || 1)
      labels.score.setPosition(0, 0).setColor(LEADERBOARD_TEXT).setStroke(LEADERBOARD_TEXT, 0.65)
      const score = this.add.container(cx, slot.plateY + plateH + scoreGap + plaqueScoreH / 2, [
        this.add.image(0, 0, scoreKey).setDisplaySize(plateW, plaqueScoreH), labels.score,
      ])
      podiumGroup.add([ball, medal, name, score])
      champions.push({ ball, medal, name, score, scoreText: labels.score, value: slot.entry.score })
    }

    let portraitAction: Phaser.GameObjects.Container | null = null
    if (portrait) {
      portraitAction = this.add.container(0, 0)
      this.panelContent.add(portraitAction)
      const buttonW = Math.min(350, podiumW - 24)
      const buttonH = 64
      const buttonX = podiumX + podiumW / 2
      const buttonY = podiumY + podiumH + 24 + buttonH / 2
      const show = new ChunkyButton({ scene: this, x: buttonX, y: buttonY,
        w: buttonW, h: buttonH, label: 'SHOW ALL PLAYERS', fontSize: 22, pill: true,
        fill: 0xe8cc8b, shadowColor: 0xa77a32, highlightColor: 0xfff8e9,
        textColor: '#ffe19a', onClick: () => this.setLeaderboardModal(true) })
      portraitAction.add(show.container)
      this.panelRects.push({ label: 'SHOW ALL PLAYERS', x: buttonX - buttonW / 2,
        y: buttonY - buttonH / 2, w: buttonW, h: buttonH, screen: 'panel' })
      const count = leaderboardTextStyle(hudText(this, buttonX, buttonY + buttonH / 2 + 20,
        `${entries.length.toLocaleString('en-US')} PLAYERS`, 1, {
          color: LEADERBOARD_SECONDARY, size: 14, stroke: 0, pad: 1,
          origin: [0.5, 0.5], shadow: false,
        }), LEADERBOARD_SECONDARY)
      portraitAction.add(count)
    }

    const tableLayer = this.add.container(0, 0)
    if (portrait) {
      const layer = this.add.container(0, 0).setVisible(false)
      const dim = this.add.rectangle(vw / 2, vh / 2, vw, vh, 0x000000, 1).setAlpha(0).setInteractive()
      layer.add([dim, tableLayer])
      this.panelContent.add(layer)
      this.lbModalLayer = layer
      this.lbModalPopup = tableLayer
      this.lbModalDim = dim
      this.lbModalCenter = { x: vw / 2, y: vh / 2 }
      const headerY = Math.max(12, safe.top + 8)
      const headerFrame = this.add.graphics()
      headerFrame.fillStyle(0xfff8e9).fillRoundedRect(left, headerY, vw - left - right, 80, 14)
      headerFrame.lineStyle(2, 0xc6a35e).strokeRoundedRect(left, headerY, vw - left - right, 80, 14)
      tableLayer.add(headerFrame)
      const closeX = vw - right - 44
      const closeY = headerY + 40
      const close = new ChunkyButton({ scene: this, x: closeX, y: closeY, w: 64, h: 40,
        label: 'CLOSE', fontSize: 13, fill: 0xe8cc8b, shadowColor: 0xa77a32,
        highlightColor: 0xfff8e9, onClick: () => this.setLeaderboardModal(false) })
      tableLayer.add(close.container)
      this.lbModalClose = close
      const title = hudText(this, left + 16, closeY, 'LEADERBOARD', 1, {
        color: '#ffe19a', size: 30, stroke: 3, origin: [0, 0.5], shadow: false,
      })
      title.setScale(Math.min(1, (closeX - 32 - left - 28) / title.width))
      tableLayer.add(title)
      this.lbModalReturnRects = this.panelRects.map((rect) => ({ ...rect }))
    } else {
      this.panelContent.add(tableLayer)
    }


    // Marble tablet art stays behind the existing masked data and input zone.
    const tabletKey = 'br-olympus-tablet'
    bakeCanvas(this, tabletKey, Math.ceil(tableW), Math.ceil(tableH), (ctx) => {
      drawOlympusTablet(ctx, tableW, tableH)
    }, window.devicePixelRatio || 1)
    tableLayer.add(this.add.image(tableX, tableY, tabletKey)
      .setOrigin(0, 0).setDisplaySize(tableW, tableH))
    const wellX = tableX + wellPad
    const wellY = tableY + wellPad
    const wellH = tableH - wellPad * 2
    const headerCY = wellY + headerH / 2
    const rowX = wellX + padX
    const rankColX = rowX + 6 + rankW / 2
    const iconColX = rowX + 6 + rankW + avatarW / 2
    const playerColX = rowX + 6 + rankW + avatarW + cellGap
    const scoreColX = rowX + rowW - 6

    const hdrSize = tableW >= 520 ? 19 : 15
    const hRank = hudText(this, rankColX, headerCY, '#', 1, {
      color: '#65533e',
      size: hdrSize,
      stroke: 0,
      origin: [0.5, 0.5],
      shadow: false,
    })
    const hPlayer = hudText(this, playerColX, headerCY, 'PLAYER', 1, {
      color: '#65533e',
      size: hdrSize,
      stroke: 0,
      origin: [0, 0.5],
      shadow: false,
    })
    const hScore = hudText(this, scoreColX, headerCY, 'SCORE', 1, {
      color: '#65533e',
      size: hdrSize,
      stroke: 0,
      origin: [1, 0.5],
      shadow: false,
    })
    tableLayer.add([hRank, hPlayer, hScore])
    for (const heading of [hRank, hPlayer, hScore]) leaderboardTextStyle(heading, LEADERBOARD_SECONDARY)
    const tableLines = this.add.graphics()
    tableLines.lineStyle(1.5, 0xa77a32, 0.8).lineBetween(rowX, wellY + headerH, rowX + rowW, wellY + headerH)
    tableLayer.add(tableLines)

    // --- SCROLLABLE ROWS AREA ---
    const rowsTopY = wellY + headerH + 6
    const rowsAvailH = wellH - headerH - 12
    const needsScroll = totalRowsH > rowsAvailH

    // Scroll state
    const maxScroll = Math.max(0, totalRowsH - rowsAvailH)

    // Rows container (masked, scrollable)
    const rowsContainer = this.add.container(0, 0)
    tableLayer.add(rowsContainer)

    // Mask: clip rows to the visible area below the header
    const maskG = this.add.graphics()
    maskG.fillStyle(0xffffff)
    maskG.fillRect(wellX, rowsTopY - 1, wellW, rowsAvailH + 2)
    let maskFilter: Phaser.Filters.Mask | null = null
    if (this.game.renderer.type === Phaser.WEBGL) {
      rowsContainer.enableFilters()
      maskFilter = rowsContainer.filters!.external.addMask(maskG, false, this.cameras.main, 'world')
      maskFilter.autoUpdate = false
    } else {
      rowsContainer.setMask(new Phaser.Display.Masks.GeometryMask(this, maskG))
    }
    maskG.setVisible(false)

    // Scrollbar track + thumb (only when needed)
    const sbX = wellX + wellW - padX - scrollW
    const sbY = rowsTopY
    const sbH = rowsAvailH
    const thumbH = needsScroll ? Math.max(28, (rowsAvailH / totalRowsH) * sbH) : 0
    const thumbG = this.add.graphics()
    if (needsScroll) {
      thumbG.fillStyle(0xc9bb9f, 1)
      thumbG.fillRoundedRect(sbX, sbY, scrollW, sbH, scrollW / 2)
      thumbG.fillStyle(0xd4af37, 1)
      thumbG.fillRoundedRect(sbX + 1, sbY, scrollW - 2, thumbH, (scrollW - 2) / 2)
    }
    tableLayer.add(thumbG)

    // Scroll input zone (rows + thumb)
    const scrollZone = this.add.zone(wellX, wellY, wellW, wellH).setOrigin(0, 0).setInteractive()
    if (portrait) scrollZone.disableInteractive()

    const avatarSize = tableW >= 520 ? 40 : 36
    const fallbackTiers = [6, 1, 5, 3, 2, 4, 1, 4, 6, 2]
    const poolSize = Math.min(slotCount, Math.ceil(rowsAvailH / (rowH + rowGap)) + 2)
    const pool = Array.from({ length: poolSize }, () => {
      const background = this.add.graphics()
      const rank = leaderboardTextStyle(hudText(this, rankColX, 0, '', 1, {
        color: LEADERBOARD_TEXT, size: rowFontSize, stroke: 0, pad: 1, origin: [0.5, 0.5], shadow: false,
      }))
      const name = leaderboardTextStyle(hudText(this, playerColX, 0, '', 1, {
        color: LEADERBOARD_TEXT, size: rowFontSize, stroke: 0, pad: 1, origin: [0, 0.5], shadow: false,
      })).setWordWrapWidth(nameW, true).setLineSpacing(2)
      const score = leaderboardTextStyle(hudText(this, scoreColX, 0, '', 1, {
        color: LEADERBOARD_TEXT, size: rowFontSize, stroke: 0, pad: 1, origin: [1, 0.5], shadow: false,
      }))
      const avatar = this.add.image(iconColX, 0, leaderboardAvatarKey(this, 1, 777, avatarSize))
        .setDisplaySize(avatarSize, avatarSize)
      const container = this.add.container(0, 0, [background, rank, avatar, name, score])
      rowsContainer.add(container)
      return { container, background, rank, name, score, avatar, index: -1 }
    })
    let previousFirst = -1
    const renderRows = (offset: number) => {
      const first = Math.max(0, Math.floor(offset / (rowH + rowGap)) - 1)
      if (previousFirst === first) return
      previousFirst = first
      for (let p = 0; p < pool.length; p++) {
        const view = pool[p]!
        const i = first + p
        const entry = entries[i]
        view.container.setVisible(!!entry)
        if (!entry) continue
        view.index = i
        view.container.setY(rowsTopY + i * (rowH + rowGap))
        view.background.clear().fillStyle(
          i === 0 ? 0xf5d78b : i === 1 ? 0xf0f1ed : i === 2 ? 0xf3e5d5 : i % 2 === 0 ? 0xf0e7d5 : 0xfff8e9,
          1,
        ).fillRoundedRect(rowX, 0, rowW, rowH, 10)
        const rankInk = i === 0 ? '#a77a32' : i === 1 ? '#647176' : i === 2 ? '#9b633f' : LEADERBOARD_TEXT
        view.rank.setColor(rankInk)
        if (i === 0 || i === 1 || i === 2 || entry.isCurrentUser) {
          view.background.lineStyle(1.5, i === 0 || entry.isCurrentUser ? 0xa77a32 : i === 1 ? 0x98a5a7 : 0xb47b53, 1)
            .strokeRoundedRect(rowX, 0, rowW, rowH, 10)
        }
        const cy = rowH / 2
        view.rank.setText(`${i + 1}`).setY(cy)
        view.name.setText(entry.displayName).setY(cy)
        view.score.setText(scoreStrings[i]!).setY(cy)
        const tier = i < 3 ? [6, 1, 5][i]! : entry.tierReached > 1
          ? Math.min(BALL_TIERS.length, entry.tierReached) : fallbackTiers[i % fallbackTiers.length]!
        const seed = (i % 8 + 1) * 777 + tier * 31
        view.avatar.setTexture(leaderboardAvatarKey(this, tier, seed, avatarSize))
          .setY(cy).setDisplaySize(avatarSize, avatarSize)
      }
    }
    renderRows(0)
    const wheelBlocker = (event: WheelEvent) => {
      if (portrait && !this.lbModalOpen) return
      const rect = this.game.canvas.getBoundingClientRect()
      const x = (event.clientX - rect.left) * vw / rect.width
      const y = (event.clientY - rect.top) * vh / rect.height
      if (x >= wellX && x <= wellX + wellW && y >= rowsTopY && y <= rowsTopY + rowsAvailH) event.preventDefault()
    }
    this.game.canvas.addEventListener('wheel', wheelBlocker, { passive: false })

    // Store scroll state for the scene-level handlers
    this.lbScroll = {
      rowsC: rowsContainer,
      maskG,
      maskFilter,
      thumbG,
      zone: scrollZone,
      renderRows,
      wheelBlocker,
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
        { x: vw * 0.2, y: vh * 0.17, s: 1.0, a: 0.3, drift: 26, dur: 9000 },
        { x: vw * 0.68, y: vh * 0.2, s: 0.72, a: 0.24, drift: 34, dur: 12000 },
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

    }
    const animateEntrance = this.lbEntrancePending && !this.reducedMotion
    this.lbEntrancePending = false
    if (animateEntrance) {
      this.lbEntranceCleanup = playLeaderboardEntrance(this, this.panelContent, bgImg, baseImage,
        champions, portrait ? portraitAction : tableLayer, vw, vh, this.reducedMotion)
    } else {
      bgImg.setAlpha(1)
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
    detail?: number
    character?: boolean
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
  const poly = restContour(look, r, cx, cy, opts.detail ?? 32)
  const pts = poly.map((p) => new Phaser.Math.Vector2(p.x, p.y))

  if (opts.silhouette || (tier >= 11 && !opts.character)) {
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

  if (opts.silhouette || (tier >= 11 && !opts.character)) {
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

function leaderboardTextStyle(text: Phaser.GameObjects.Text, color = LEADERBOARD_TEXT): Phaser.GameObjects.Text {
  // The bundled Nunito face is 700-only. Optical emboldening retains the same
  // rounded glyphs while giving the requested extra-bold weight without a new font.
  return text.setFontFamily(LEADERBOARD_FONT).setFontStyle('800').setColor(color).setStroke(color, 0.65)
}

function leaderboardAvatarKey(
  scene: Phaser.Scene,
  tier: number,
  seed: number,
  displaySize: number,
): string {
  const dpr = Math.max(2, Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR))
  const textureSize = Math.ceil(displaySize * dpr)
  const theme = tier === 9 ? tier9Theme() : ''
  const variant = tier === 9 || tier === 10 ? variantIdFor(tier) : 0
  const key = `br-leaderboard-avatar:${tier}:${theme}:${variant}:${seed}:${textureSize}`
  if (scene.textures.exists(key)) return key

  const graphics = scene.add.graphics()
  const center = textureSize / 2
  const radius = displaySize * dpr / 2 - 2 * dpr
  drawBallIcon(scene, graphics, tier, center, center, radius, { seed, detail: 64, character: true })
  graphics.generateTexture(key, textureSize, textureSize)
  graphics.destroy()
  return key
}

