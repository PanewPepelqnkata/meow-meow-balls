import Phaser from 'phaser'
import { UiRoot } from '../../ui/UiRoot'
import { GameOverView } from '../rendering/GameOverView'
import { DiscoveryOverlay } from '../rendering/DiscoveryOverlay'
import { DiscoveryBanner } from '../rendering/DiscoveryBanner'
import { gameBus } from '../events/gameBus'
import { session } from '../state/session'

/**
 * Phase 2.11.0 — UI scene (spec §2, §14): owns every HUD component on its
 * own camera at 1:1 viewport scale, positioned exclusively by the central
 * `ResponsiveLayout`. Renders AFTER (on top of) PlaygroundScene, which owns
 * the world camera — separate scenes mean no per-object camera-ignore
 * bookkeeping.
 *
 * Data flow: PlaygroundScene publishes game state through gameBus
 * ('state:score', 'state:next', 'walls:countdown', 'run:gameover', …);
 * player actions flow back as 'ui:swap' / 'ui:raise' / 'ui:restart'.
 * Boot-time initial state is pulled from the game registry (the world
 * scene emits before this scene starts listening).
 */
export class UIScene extends Phaser.Scene {
  private uiRoot!: UiRoot
  private readonly gameOverlay: GameOverView
  private discoveryOverlay!: DiscoveryOverlay
  /** The NON-BLOCKING repeat-discovery banner (already-seen tiers). */
  private discoveryBanner!: DiscoveryBanner
  private lastBest = 0
  private lastScore = 0
  private offs: Array<() => void> = []
  private pauseAllowed = true
  private readonly pointerWorld = new Phaser.Math.Vector2()

  constructor() {
    super('UIScene')
    // GO AGAIN restarts the run (gameplay reset lives in PlaygroundScene);
    // MAIN MENU re-shows the start screen (TitleScene restarts + takes over).
    this.gameOverlay = new GameOverView(
      this,
      () => gameBus.emit('ui:restart', {}),
      () => this.returnToMenu(),
    )
  }

  /** HiDPI camera: zoom = display scale, centered on the CSS midpoint
   * (zoom pivots on the camera center — physical/2 — so the CSS mid must
   * be set explicitly). Called on create and on every resize. */
  private applyDprCamera(): void {
    const z = this.game.scale.displayScale.x
    const cssW = this.scale.width / z
    const cssH = this.scale.height / z
    this.cameras.main.setZoom(z)
    this.cameras.main.centerOn(cssW / 2, cssH / 2)
  }

  create(): void {
    // HiDPI camera setup; reapplied on resize.
    this.applyDprCamera()
    this.pauseAllowed = true
    this.game.events.on('br:dpr', this.applyDprCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('br:dpr', this.applyDprCamera, this)
    })
    this.uiRoot = new UiRoot(this, {
      onSwap: () => gameBus.emit('ui:swap', {}),
      onRaise: () => gameBus.emit('ui:raise', {}),
      onPause: () => this.pauseRun(),
    })
    // Phase 2.19: the discovery modal centers in the GAMEPLAY SLOT on
    // portrait (below the HUD block, above the controls) — never inside
    // the top HUD. Desktop keeps its full-screen centering.
    this.discoveryOverlay = new DiscoveryOverlay(this, () => {
      const l = this.uiRoot.layout_
      return l.composition === 'portrait'
        ? { top: l.stack.hudBottom, bottom: l.stack.controlsTop }
        : null
    })
    // The collectible card owns the screen: the HUD is hidden while it is
    // up (the score, the next-ball preview, the tier track and the ability
    // bar all sat around the card and made it look broken).
    this.discoveryOverlay.onHudVisibility((visible) => {
      this.uiRoot.setHudVisible(visible)
    })
    // The repeat-discovery banner: non-blocking, owns its own lifecycle.
    this.discoveryBanner = new DiscoveryBanner(this)

    // Boot-time sync (PlaygroundScene.create ran first and populated these).
    this.lastBest = Number(this.registry.get('best') ?? 0)
    const next = this.registry.get('next') as { tier: number; seed: number } | undefined
    if (next) this.uiRoot.setNextTier(next.tier, next.seed)
    this.uiRoot.setScore(0, this.lastBest)

    this.offs.push(
      gameBus.on('state:score', ({ score }) => {
        this.lastScore = score
        this.uiRoot.setScore(score, this.lastBest)
      }),
      gameBus.on('state:best', ({ best }) => {
        this.lastBest = best
        this.uiRoot.setScore(this.lastScore, best)
      }),
      gameBus.on('state:next', ({ tier, seed }) => this.uiRoot.setNextTier(tier, seed)),
      // Drop cooldown: the preview ball hides while the claw is empty.
      gameBus.on('state:dropHolding', ({ holding }) => this.uiRoot.setNextHolding(holding)),
      // Phase 2.13.0: real discovery state drives the progression path.
      gameBus.on('state:discovered', ({ tier }) => this.uiRoot.unlockTier(tier)),
      gameBus.on('walls:countdown', ({ remainingMs }) => this.uiRoot.updateRaiseCountdown(remainingMs)),
      gameBus.on('ability:swapUsed', () => this.uiRoot.markSwapUsed()),
      gameBus.on('ability:raiseUsed', () => this.uiRoot.markRaiseUsed()),
      gameBus.on('ability:enabled', ({ enabled }) => {
        this.pauseAllowed = enabled
        this.uiRoot.setAbilitiesEnabled(enabled)
      }),
      gameBus.on('run:gameover', ({ score, best }) => {
        this.lastBest = best
        this.uiRoot.setScore(score, best)
        this.gameOverlay.show(score, best, score >= best && score > 0)
      }),
      gameBus.on('run:started', () => {
        this.gameOverlay.hide()
        this.discoveryOverlay.reset()
        this.discoveryBanner.destroy()
        this.uiRoot.resetForNewRun()
        this.lastScore = 0
        this.uiRoot.setScore(0, this.lastBest)
      }),
      // Phase 2.12.2: first-time tier → full-viewport discovery modal
      // (presented here in screen space; state owned by the world scene).
      gameBus.on('discovery:show', ({ tier, seed }) => this.discoveryOverlay.show(tier, seed)),
      // Repeat discovery (seen in an earlier run): the small non-blocking
      // banner — gameplay never pauses for it.
      gameBus.on('discovery:banner', ({ tier, seed }) => this.discoveryBanner.show(tier, seed)),
    )
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.offs) off()
      this.offs = []
      this.discoveryOverlay.reset()
      this.discoveryBanner.destroy()
    })
  }

  private pauseRun(): void {
    if (session.menuActive || !this.pauseAllowed || !this.sys.isVisible() ||
        this.gameOverlay.visible || this.discoveryOverlay.isShowing() ||
        this.scene.isActive('StartIntroScene') || this.scene.isActive('TitleScene')) return
    gameBus.emit('ui:pause', {})
    this.scene.pause('playground')
    this.scene.pause()
    this.scene.launch('PauseScene', { score: this.lastScore })
  }

  /** Game over and pause use the same clean route back to the title screen. */
  returnToMenu(): void {
    session.menuActive = true
    gameBus.emit('ui:restart', {})
    this.scene.setVisible(false, 'playground')
    this.scene.setVisible(false)
    this.scene.get('playground').tweens.getDelta(true)
    this.tweens.getDelta(true)
    this.scene.resume('playground')
    this.scene.resume()
    this.scene.launch('TitleScene', {})
  }

  /** Phase 2.13.0: per-frame discovery burst animation (speed lines, flash).
   * Phase 2.15.0: while the start screen is up, the HUD recedes deep behind
   * the menu veil — gameplay state/physics stay fully alive, only the HUD's
   * presentation dim (the menu is the front of the product). */
  override update(): void {
    // Phase 2.16.0: this scene is completely hidden by TitleScene while the
    // start screen is up — no dimming needed. The discovery presentation is
    // static after its entrance tweens, so there is nothing to drive here.
  }

  /** True when the viewport point lies on an interactive UI control — the
   * world scene gates aim/drop input on this. The discovery modal blocks
   * the whole viewport (Phase 2.12.2): no accidental drops mid-reveal. */
  isPointerOverUi(x: number, y: number): boolean {
    if (this.discoveryOverlay.isShowing()) return true
    if (this.gameOverlay.visible) return true
    this.cameras.main.getWorldPoint(x, y, this.pointerWorld)
    return this.uiRoot?.isPointerOverUi(this.pointerWorld.x, this.pointerWorld.y) ?? false
  }

  /** QA hook (Phase 2.12.2): live discovery-modal state. */
  discoveryState(): { visible: boolean; tier: number | null } {
    return { visible: this.discoveryOverlay.isShowing(), tier: this.discoveryOverlay.currentTier }
  }

  /** QA hook: PLAY AGAIN button center in viewport px. */
  playAgainCenter(): { x: number; y: number } {
    return this.gameOverlay.buttonCenter
  }

  /** QA hook (Phase 2.13.0): tiers the progression path shows unlocked. */
  progressionUnlocked(): number[] {
    return this.uiRoot?.progressionUnlocked() ?? []
  }

  /** QA hook (Phase 2.13.1): the Raise Walls button's one-use lifecycle. */
  abilityRaiseUsed(): boolean {
    return this.uiRoot?.abilityRaiseUsed() ?? false
  }

  overlayVisible(): boolean {
    return this.gameOverlay.visible
  }

  /** QA hook: interactive control rects (viewport px). */
  uiPositions(): { abilities: Array<{ x: number; y: number }> } {
    return this.uiRoot.uiPositions()
  }
}
