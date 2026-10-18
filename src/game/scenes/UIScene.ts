import Phaser from 'phaser'
import { UiRoot } from '../../ui/UiRoot'
import { GameOverView } from '../rendering/GameOverView'
import { DiscoveryOverlay } from '../rendering/DiscoveryOverlay'
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
  private readonly discoveryOverlay: DiscoveryOverlay
  private lastBest = 0
  private lastScore = 0
  private offs: Array<() => void> = []

  constructor() {
    super('UIScene')
    // GO AGAIN restarts the run (gameplay reset lives in PlaygroundScene);
    // MAIN MENU re-shows the start screen (TitleScene restarts + takes over).
    this.gameOverlay = new GameOverView(
      this,
      () => gameBus.emit('ui:restart', {}),
      () => {
        const pg = this.scene.get('playground') as unknown as {
          scene: Phaser.Scenes.ScenePlugin
          ballRenderer?: { clear(): void; emotion: { clear(): void } }
          balls?: { clearBalls(): void }
        }
        // Reset gameplay to boot state, then hand control back to the menu.
        gameBus.emit('ui:restart', {})
        session.menuActive = true
        pg.scene.setVisible(false)
        this.scene.setVisible(false)
        const title = this.scene.get('TitleScene') as unknown as {
          scene: Phaser.Scenes.ScenePlugin
        }
        title.scene.start('TitleScene')
      },
    )
    // Phase 2.12.2: the discovery modal lives HERE — UIScene's camera is 1:1
    // with the viewport (no zoom/scroll), so the full-screen dim actually
    // covers the whole screen (the world scene's zoomed camera was turning
    // it into an inset rectangle).
    this.discoveryOverlay = new DiscoveryOverlay(this)
  }

  create(): void {
    this.uiRoot = new UiRoot(this, {
      onSwap: () => gameBus.emit('ui:swap', {}),
      onRaise: () => gameBus.emit('ui:raise', {}),
    })

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
      // Phase 2.13.0: real discovery state drives the progression path.
      gameBus.on('state:discovered', ({ tier }) => this.uiRoot.unlockTier(tier)),
      gameBus.on('walls:countdown', ({ remainingMs }) => this.uiRoot.updateRaiseCountdown(remainingMs)),
      gameBus.on('ability:swapUsed', () => this.uiRoot.markSwapUsed()),
      gameBus.on('ability:raiseUsed', () => this.uiRoot.markRaiseUsed()),
      gameBus.on('ability:enabled', ({ enabled }) => this.uiRoot.setAbilitiesEnabled(enabled)),
      gameBus.on('run:gameover', ({ score, best }) => {
        this.lastBest = best
        this.uiRoot.setScore(score, best)
        this.gameOverlay.show(score, best, score >= best && score > 0)
      }),
      gameBus.on('run:started', () => {
        this.gameOverlay.hide()
        this.discoveryOverlay.reset()
        this.uiRoot.resetForNewRun()
        this.lastScore = 0
        this.uiRoot.setScore(0, this.lastBest)
      }),
      // Phase 2.12.2: first-time tier → full-viewport discovery modal
      // (presented here in screen space; state owned by the world scene).
      gameBus.on('discovery:show', ({ tier, seed }) => this.discoveryOverlay.show(tier, seed)),
    )
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.offs) off()
      this.offs = []
      this.discoveryOverlay.reset()
    })
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
    return this.uiRoot?.isPointerOverUi(x, y) ?? false
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
