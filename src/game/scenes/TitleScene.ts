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
import { loadSave, resetProgress, setThemeSetting } from '../state/save'
import { tier9Theme, variantIdFor } from '../state/runVariant'
import { session } from '../state/session'
import { bakeCanvas } from '../rendering/RoughArt'
import { drawChampionMedal, drawChampionPlaque, drawChampionPodium } from '../rendering/ChampionPodiumArt'
import { drawOlympusHall, drawOlympusTablet } from '../rendering/OlympusHallArt'
import { playGoldenScreenTransition } from '../rendering/GoldenScreenTransition'
import { playLeaderboardEntrance, type ChampionEntranceParts } from '../rendering/LeaderboardEntrance'
import { cycleColor } from '../rendering/rgbCycle'
import { KingdomMenuView } from '../rendering/KingdomMenuView'
import { StartIntroScene } from './StartIntroScene'
import { readSafeArea } from '../../ui/ResponsiveLayout'
import { UI_COLORS, buildScreenHeader, ChunkyButton } from '../../ui/DesignSystem'
import { CollectionBookView } from '../rendering/CollectionBookView'
import { KingsWardrobeView, renderWardrobeBallCharacter } from '../rendering/KingsWardrobeView'
import { StoreView } from '../rendering/StoreView'
import { AuthModal } from '../../ui/AuthModal'
import { getTitleNameById, isValidWardrobeCharacterId } from '../../config/kingsWardrobe'
import { authService, resolveDisplayName, scoreService } from '../../services/auth'
import { kingdomMenuBridge, kingdomStatsFromSave } from '../../react/kingdomMenuBridge'
import type { KingdomNavAction } from '../../ui/KingdomMenuLayout'
/**
 * Home navigation and panel owner. KingdomMenuView renders the animated Throne
 * Vault Hall and Round Table; this scene owns auth, save bindings and existing
 * panel routes. Gameplay stays hidden until PLAY.
 */

const LEADERBOARD_TEXT = '#25283a'
const LEADERBOARD_SECONDARY = '#555467'
const LEADERBOARD_FONT = 'Nunito, ui-rounded, system-ui, sans-serif'
type ScreenName = 'menu' | 'leaderboard' | 'settings' | 'collection' | 'store' | 'account'
export class TitleScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container
  private menuLayer!: Phaser.GameObjects.Container
  private kingdomMenu: KingdomMenuView | null = null
  private panelLayer!: Phaser.GameObjects.Container
  private panelBackdrop!: Phaser.GameObjects.Graphics
  /** Panel chrome survives viewport rebuilds; each screen owns fresh content. */
  private panelContent!: Phaser.GameObjects.Container
  private collectionBook: CollectionBookView | null = null
  private storeView: StoreView | null = null
  private wardrobeView: KingsWardrobeView | null = null
  private homeAuthModal: AuthModal | null = null
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
    // Home auth updates only the bridge; decorative artwork and local clocks survive.
    this.unsubscribeAuth = authService.onAuthStateChange(() => {
      if (this.closed) return
      if (this.screen === 'menu') this.publishHome()
      else this.buildAll()
    })
    this.offs.push(
      kingdomMenuBridge.connect((action) => this.navigateHome(action)),
      gameBus.on('state:save', () => {
        if (this.closed || this.screen === 'store') return
        if (this.screen === 'menu') this.publishHome()
        else this.buildAll()
      }),
    )
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.closed = true
      this.homeAuthModal?.close(true)
      this.homeAuthModal = null
      this.hideHome()
      this.returnToPause = false
      this.leaderboardTransitionCleanup?.()
      this.leaderboardTransitionCleanup = null
      this.lbModalCleanup?.()
      this.lbModalCleanup = null
      this.destroyCollectionBook()
      this.destroyStoreView()
      this.destroyWardrobeView()
      this.kingdomMenu?.destroy()
      this.kingdomMenu = null
      this.teardownLeaderboardScroll()
      this.disarmReset()
      this.game.events.off('br:dpr', this.onViewportResize, this)
      this.unsubscribeAuth?.()
      this.unsubscribeAuth = null
      for (const off of this.offs) off()
      this.offs.length = 0
      // The DEV hook survives scene stops (visible() reports false via
      // `closed`); a later launch replaces it with the new menu state.
    })

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__brMenu = {
        visible: () => !this.closed,
        screen: () => this.screen,
        openScreen: (s: ScreenName) => this.openScreen(s),
        wardrobeTab: (t?: 'mirror' | 'avatars' | 'trophies' | 'ledger') => {
          if (t) this.wardrobeView?.setTab(t)
          return this.wardrobeView?.getActiveTab() ?? null
        },
        buttons: () => [...(this.screen === 'menu' && !this.closed ? kingdomMenuBridge.getButtonRects() : []), ...this.panelRects].map((b) => ({ ...b })),
        // Phase 2.15.0 QA: dump the wordmark letter objects (text, layout,
        // canvas texture size) so visual oddities can be diagnosed from the
        // browser tests without a game instance handle.
        letters: () => {
          const box = this.kingdomMenu?.getLogoBox()
          return box
            ? [
                {
                  text: 'br-kingdom-logo',
                  x: 0,
                  y: box.y,
                  width: box.w,
                  height: box.h,
                  displayW: box.w,
                  displayH: box.h,
                  scale: 1,
                  rotation: 0,
                },
              ]
            : []
        },
        // Phase 2.15.0 QA: live home-screen presentation probes (read-only).
        pulse: () => {
          const button = document.querySelector<HTMLButtonElement>('[data-kingdom-action="play"]')
          const rect = this.kingdomMenu?.getLayout()?.buttons.find((item) => item.action === 'play')
          return button && rect ? button.getBoundingClientRect().width / rect.w : -1
        },
        cast: () => this.kingdomMenu?.getCastInfo() ?? [],
        chip: () => this.kingdomMenu?.getChipRect() ?? null,
        coins: () => this.kingdomMenu?.getChipRect() ?? null,
        logoBox: () => this.kingdomMenu?.getLogoBox() ?? null,
        animations: () => this.kingdomMenu?.getAnimationState() ?? null,
        presentation: () => {
          const layout = this.kingdomMenu?.getLayout()
          return {
            renderer: 'phaser', controls: 'react', width: layout?.width, height: layout?.height, desktop: layout?.desktop,
            logo: layout ? { ...layout.logo } : null,
            stats: layout ? { ...layout.stats } : null,
            carousel: layout ? { ...layout.carousel } : null,
            hall: layout ? { ...layout.hall } : null,
            buttons: layout?.buttons.map((button) => ({ ...button })) ?? [],
          }
        }
      }
    }
  }

  override update(time: number, delta: number): void {
    if (this.closed || this.returnToPause) return
    if (this.screen === 'menu') {
      this.kingdomMenu?.update(time, delta)
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

    // Detach the persistent panel backdrop and content container before rebuilding their siblings.
    this.panelLayer.remove(this.panelBackdrop)
    this.panelLayer.remove(this.panelContent)
    this.panelLayer.removeAll(true)
    this.panelLayer.add(this.panelBackdrop)
    this.panelLayer.add(this.panelContent)
    // Home button rectangles come from the actual native controls, not Phaser zones.
    this.panelRects.length = 0

    if (!this.returnToPause) {
      if (!this.kingdomMenu) {
        this.kingdomMenu = new KingdomMenuView(this, this.menuLayer, this.reducedMotion)
      }
      this.kingdomMenu.build(vw, vh)
    }
    this.buildPanelChrome(vw, vh)
    this.applyScreenVisibility()
  }

  private navigateHome(action: KingdomNavAction): void {
    if (this.closed || this.screen !== 'menu' || this.homeAuthModal) return
    if (action === 'play') {
      this.pressStart()
    } else if (action === 'login') {
      const modal = new AuthModal(document.body)
      this.homeAuthModal = modal
      const finish = () => {
        if (this.homeAuthModal !== modal) return
        this.homeAuthModal = null
        this.publishHome()
        queueMicrotask(() => {
          if (!this.closed && this.screen === 'menu') {
            document.querySelector<HTMLButtonElement>('[data-kingdom-action="login"], [data-kingdom-action="account"]')?.focus()
          }
        })
      }
      modal.onSuccess(finish)
      modal.onCancel(finish)
      this.publishHome()
      modal.open('login')
    } else {
      // Account opens The King's Wardrobe royal chambers.
      this.openScreen(action)
    }
  }

  private publishHome(): void {
    const view = this.kingdomMenu
    const z = this.game.scale.displayScale.x || 1
    if (view && !this.closed && this.screen === 'menu') view.build(this.scale.width / z, this.scale.height / z)
    kingdomMenuBridge.publish({
      visible: !this.closed && !this.returnToPause && this.screen === 'menu' && !this.homeAuthModal,
      layout: view?.getLayout() ?? null,
      artwork: view?.getArtwork() ?? null,
      stats: kingdomStatsFromSave(loadSave()),
      accountName: authService.isAuthenticated() ? resolveDisplayName(authService.getProfile()) : null,
    })
  }

  private hideHome(): void {
    const current = kingdomMenuBridge.getSnapshot()
    if (current.visible) kingdomMenuBridge.publish({ ...current, visible: false })
  }


  // -------------------------------------------------------------------------
  // Panels (Journal / Leaderboard / Settings / Collection / Store)
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
    const previousScreen = this.screen
    this.screen = screen
    if (screen === 'menu' && previousScreen === 'store') {
      this.buildAll()
      return
    }
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
    this.kingdomMenu?.setVisible(isMenu && !this.closed)
    this.publishHome()
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
      account: 'ROYAL IDENTITY, WARDROBE, TROPHIES & LEDGER',
    }

    const titles: Partial<Record<ScreenName, string>> = {
      collection: 'COLLECTION BOOK',
      leaderboard: 'LEADERBOARD',
      settings: 'SETTINGS',
      account: "THE KING'S WARDROBE",
    }
    const { contentTopY } = this.screen === 'leaderboard'
      ? this.buildLeaderboardHeader(vw, vh)
      : this.screen === 'store'
        ? this.buildStoreHeader(vw)
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
      case 'store':
        this.buildStore(vw, vh, contentTopY)
        break
      case 'account':
        this.buildWardrobe(vw, vh, contentTopY)
        break
    }
  }

  private buildStoreHeader(vw: number): { contentTopY: number } {
    const safe = readSafeArea()
    const x = Math.max(14, safe.left + 10)
    const y = Math.max(10, safe.top + 8)
    const w = vw < 600 ? 82 : 100
    const h = 36
    // The store panel owns its sign; only Back lives in the scene chrome.
    const back = new ChunkyButton({
      scene: this, x: x + w / 2, y: y + h / 2, w, h,
      label: 'BACK', fontSize: 14,
      fill: 0xb0652a, shadowColor: 0x4e230f, highlightColor: 0xd9934e,
      textColor: '#fff5d7', onClick: () => this.openScreen('menu'),
    })
    back.container.setName('merchant-back')
    this.panelContent.add(back.container)
    this.panelRects.push({ label: 'BACK', x, y, w, h, screen: 'panel' })
    return { contentTopY: y + h + 7 }
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

  private destroyStoreView(): void {
    this.storeView?.destroy()
    this.storeView = null
  }

  private destroyWardrobeView(): void {
    this.wardrobeView?.destroy()
    this.wardrobeView = null
  }

  private clearPanelContent(): void {
    this.lbModalCleanup?.()
    this.lbModalCleanup = null
    this.destroyCollectionBook()
    this.destroyStoreView()
    this.destroyWardrobeView()
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
      selectedAvatarId: string | null
      activeTitleId: string | null
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
        displayName: s.profiles?.display_name || s.profiles?.username || 'Anonymous',
        selectedAvatarId: s.profiles?.selected_avatar_id ?? null,
        activeTitleId: s.profiles?.active_title_id ?? null,
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
      if (slot.entry.selectedAvatarId && isValidWardrobeCharacterId(slot.entry.selectedAvatarId)) {
        renderWardrobeBallCharacter(this, ballG, slot.entry.selectedAvatarId, 0, -ballR, ballR, { layer: ball })
      } else {
        drawBallIcon(this, ballG, slot.tier, 0, -ballR, ballR, {
          seed: slot.rank * 777 + slot.tier * 31, layer: ball,
        })
      }
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
        const titleName = getTitleNameById(entry.activeTitleId)
        view.name.setText(titleName ? `${entry.displayName} • ${titleName}` : entry.displayName).setY(cy)
        view.score.setText(scoreStrings[i]!).setY(cy)
        const tier = i < 3 ? [6, 1, 5][i]! : entry.tierReached > 1
          ? Math.min(BALL_TIERS.length, entry.tierReached) : fallbackTiers[i % fallbackTiers.length]!
        const seed = (i % 8 + 1) * 777 + tier * 31
        view.avatar.setTexture(leaderboardAvatarKey(this, tier, seed, avatarSize, entry.selectedAvatarId))
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
          resetProgress()
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

      const gap = 10
      const btnW = Math.min(180, Math.floor((cardW - 36 - gap) / 2))
      const btnH = compact ? 36 : 40
      const btnY = cardY + cardH - btnH / 2 - (compact ? 12 : 16)
      const wardrobeBtnX = centerX - btnW / 2 - gap / 2
      const logoutBtnX = centerX + btnW / 2 + gap / 2

      const wardrobeBtn = new ChunkyButton({
        scene: this,
        x: wardrobeBtnX,
        y: btnY,
        w: btnW,
        h: btnH,
        pill: true,
        fill: UI_COLORS.BTN_GOLD,
        shadowColor: UI_COLORS.BTN_GOLD_SHADOW,
        highlightColor: UI_COLORS.BTN_GOLD_HIGHLIGHT,
        label: 'WARDROBE',
        fontSize: 12,
        onClick: () => {
          this.openScreen('account')
        },
      })
      this.panelContent.add(wardrobeBtn.container)
      this.panelRects.push({
        label: 'WARDROBE',
        x: wardrobeBtnX - btnW / 2,
        y: btnY - btnH / 2,
        w: btnW,
        h: btnH,
        screen: 'settings',
      })

      const logoutBtn = new ChunkyButton({
        scene: this,
        x: logoutBtnX,
        y: btnY,
        w: btnW,
        h: btnH,
        pill: true,
        fill: UI_COLORS.BTN_RED,
        shadowColor: UI_COLORS.BTN_RED_SHADOW,
        highlightColor: UI_COLORS.BTN_RED_HIGHLIGHT,
        label: 'LOGOUT',
        fontSize: 12,
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
        x: logoutBtnX - btnW / 2,
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

  private buildStore(vw: number, vh: number, topY: number): void {
    this.storeView = new StoreView(this, this.panelContent, vw, vh, topY)
  }

  private buildWardrobe(vw: number, vh: number, topY: number): void {
    this.wardrobeView = new KingsWardrobeView(this, this.panelContent, vw, vh, topY, () => {
      this.publishHome()
    })
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
    this.hideHome()
    this.destroyCollectionBook()
    this.disarmReset()
    this.input.enabled = false
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
  selectedAvatarId?: string | null,
): string {
  const dpr = Math.max(2, Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR))
  const textureSize = Math.ceil(displaySize * dpr)
  if (selectedAvatarId && isValidWardrobeCharacterId(selectedAvatarId)) {
    const customKey = `br-leaderboard-wardrobe-avatar:${selectedAvatarId}:${textureSize}`
    if (scene.textures.exists(customKey)) return customKey
    const graphics = scene.add.graphics()
    const center = textureSize / 2
    const radius = displaySize * dpr / 2 - 2 * dpr
    renderWardrobeBallCharacter(scene, graphics, selectedAvatarId, center, center, radius)
    graphics.generateTexture(customKey, textureSize, textureSize)
    graphics.destroy()
    return customKey
  }
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

