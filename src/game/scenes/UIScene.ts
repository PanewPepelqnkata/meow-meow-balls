import Phaser from 'phaser'
import { UiRoot } from '../../ui/UiRoot'
import { getTier } from '../../config/ballTiers'
import { ballLookFor, ballOutlineWidth, drawBallFace, restContour, INK } from '../rendering/BallAppearance'
import { GameOverView } from '../rendering/GameOverView'
import { DiscoveryOverlay } from '../rendering/DiscoveryOverlay'
import { DiscoveryBanner } from '../rendering/DiscoveryBanner'
import { AuthModal } from '../../ui/AuthModal'
import { FloatingTextNotification } from '../../ui/FloatingTextNotification'
import { authService, scoreService } from '../../services/auth'
import { gameBus } from '../events/gameBus'
import { isDrunkoTestRoute } from '../state/runVariant'
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
  private achievementNotification: FloatingTextNotification | null = null
  private lastBest = 0
  private lastScore = 0
  /** Last completed run's leaderboard payload (for the post-login SAVE
   * YOUR SCORE submission). Null once the score has been saved. */
  private lastRunStats: { score: number; tierReached: number; ballsMerged: number; durationMs: number } | null = null
  private rankRequestSeq = 0
  private rankRefreshEnabled = false
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
      () => gameBus.emit('ui:revive', {}),
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
    this.rankRefreshEnabled = true
    // HiDPI camera setup; reapplied on resize.
    this.applyDprCamera()
    this.pauseAllowed = true
    this.game.events.on('br:dpr', this.applyDprCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('br:dpr', this.applyDprCamera, this)
    })
    this.uiRoot = new UiRoot(this, {
      onSwap: () => gameBus.emit('ui:swap', {}),
      onShake: () => gameBus.emit('ui:shake', {}),
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
    this.discoveryBanner = new DiscoveryBanner(this, () => this.uiRoot.layout_)

    this.achievementNotification = new FloatingTextNotification(this, 88)
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
      gameBus.on('shake:countdown', ({ remainingMs }) => this.uiRoot.updateShakeCountdown(remainingMs)),
      gameBus.on('ability:shakeUsed', () => this.uiRoot.markShakeUsed()),
      gameBus.on('ability:swapUsed', () => this.uiRoot.markSwapUsed()),
      gameBus.on('ability:raiseUsed', () => this.uiRoot.markRaiseUsed()),
      gameBus.on('ability:enabled', ({ enabled }) => {
        this.pauseAllowed = enabled
        this.uiRoot.setAbilitiesEnabled(enabled)
      }),
      gameBus.on('run:gameover', ({ score, best, tierReached, ballsMerged, durationMs, revivesUsed, reviveCost }) => {
        const drunkoTestRoute = isDrunkoTestRoute()
        this.lastBest = best
        this.uiRoot.setScore(score, best)
        this.lastRunStats = drunkoTestRoute ? null : { score, tierReached, ballsMerged, durationMs }

        // The /drunko sandbox is a real game run, but it must never create a
        // Score submission is triggered immediately by PlaygroundScene.triggerGameOver();
        // refresh the player's rank when the Game Over overlay opens.
        if (!drunkoTestRoute && authService.isAuthenticated()) {
          this.refreshRank()
        }
        // a score worth saving; post-login the modal submits lastRunStats.
        const saveScore =
          !drunkoTestRoute && !authService.isAuthenticated() && score > 0
            ? { onSave: () => this.openAuthForScoreSave() }
            : undefined
        this.gameOverlay.show(
          score,
          best,
          !drunkoTestRoute && score >= best && score > 0,
          saveScore,
          { tierReached, ballsMerged, durationMs },
          {
            cost: reviveCost ?? 25 * Math.pow(2, Math.max(0, revivesUsed ?? 0)),
            revivesUsed: revivesUsed ?? 0,
            onRevive: () => gameBus.emit('ui:revive', {}),
          },
        )
      }),
      gameBus.on('run:revived', () => {
        this.gameOverlay.hide()
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
      gameBus.on('discovery:show', ({ tier, seed, theme, variant }) => this.discoveryOverlay.show(tier, seed, theme, variant)),
      // Repeat discovery (seen in an earlier run): the small non-blocking
      // banner — gameplay never pauses for it.
      gameBus.on('discovery:banner', ({ tier, seed, theme, variant }) => {
        this.discoveryBanner.show(tier, seed, theme, variant)
        this.flyToCollection(tier, seed)
      }),
      gameBus.on('hint:merge', () => {
        if (localStorage.getItem('br-merge-hint') === 'seen') return
        localStorage.setItem('br-merge-hint', 'seen')
        this.time.delayedCall(1600, () => {
          this.achievementNotification?.show('Matching balls merge', this.scale.width / (this.game.scale.displayScale.x || 1) / 2)
        })
      }),
      gameBus.on('achievement:unlocked', ({ name, rewardTitleName }) => {
        const msg = rewardTitleName
          ? `🏆 ACHIEVEMENT: ${name.toUpperCase()} (+TITLE: ${rewardTitleName.toUpperCase()})`
          : `🏆 ACHIEVEMENT UNLOCKED: ${name.toUpperCase()}`
        this.achievementNotification?.show(msg, this.scale.width / (this.game.scale.displayScale.x || 1) / 2)
      }),
    )
    this.offs.push(authService.onAuthStateChange(() => {
      this.uiRoot.refreshAbilityAuth()
      this.refreshRank()
    }))
    this.uiRoot.refreshAbilityAuth()
    // Auth subscriptions are not immediate, so pull the current account on boot.
    this.refreshRank()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.rankRefreshEnabled = false
      this.rankRequestSeq++
      for (const off of this.offs) off()
      this.offs = []
      this.discoveryOverlay.reset()
      this.discoveryBanner.destroy()
      this.achievementNotification?.clear()
    })
  }

  /** A new ball flies from the merge to the FOUND counter, then the count bumps. */
  private flyToCollection(tier: number, seed: number): void {
    const z = this.game.scale.displayScale.x || 1
    const w = this.scale.width / z
    const h = this.scale.height / z
    const ball = this.add.graphics().setDepth(90)
    const look = ballLookFor(tier, seed)
    const r = 26
    const poly = restContour(look, r, 0, 0, 32)
    const tierDef = getTier(tier)
    if (tierDef) {
      ball.fillStyle(tierDef.color, 1)
      ball.fillPoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true)
      ball.lineStyle(ballOutlineWidth(r), INK, 1)
      ball.strokePoints(poly.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true, true)
      drawBallFace(ball, look, { x: 0, y: 0 }, r, 1)
    }
    ball.setPosition(w / 2, h * 0.45)
    this.uiRoot.unlockTier(tier)
    const target = this.uiRoot.tierNodeAt(tier) ?? { x: w * 0.5, y: h * 0.86 }
    this.tweens.add({
      targets: ball,
      x: target.x,
      y: target.y,
      scale: 0.35,
      duration: 700,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        ball.destroy()
      },
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

  /** SAVE YOUR SCORE flow: open the auth modal over the game-over panel;
   * on successful login/signup submit the finished run to the leaderboard
   * and swap the panel's CTA for the SCORE SAVED! confirmation. */
  private openAuthForScoreSave(): void {
    if (isDrunkoTestRoute()) return
    const stats = this.lastRunStats
    if (!stats) return
    const modal = new AuthModal(document.body)
    modal.onSuccess((mode) => {
      if (isDrunkoTestRoute()) return
      // Guest progression only transfers when creating a new account (signup).
      // Logging into an existing account uses that account's own progression.
      if (mode !== 'signup') {
        this.lastRunStats = null
        return
      }
      void scoreService
        .submitScore(stats.score, stats.tierReached, stats.ballsMerged, stats.durationMs)
        .then(({ error }) => {
          if (error) {
            console.error('Score submission failed:', error)
            return
          }
          this.lastRunStats = null
          this.gameOverlay.markScoreSaved()
          this.refreshRank()
        })
    })
    modal.open('signup')
  }

  /** Refresh the authenticated player's global ordinal without allowing a
   * stale account, failed request, or stopped scene to paint a rank. */
  private refreshRank(): void {
    if (!this.rankRefreshEnabled) return
    const requestSeq = ++this.rankRequestSeq
    const userId = authService.getUser()?.id ?? null
    this.uiRoot.setRank(null)
    if (!userId) return

    void scoreService.getUserRank().then((rank) => {
      if (!this.rankRefreshEnabled || requestSeq !== this.rankRequestSeq) return
      if (authService.getUser()?.id !== userId) return
      this.uiRoot.setRank(rank)
    }).catch(() => {
      if (!this.rankRefreshEnabled || requestSeq !== this.rankRequestSeq) return
      if (authService.getUser()?.id !== userId) return
      this.uiRoot.setRank(null)
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

  /** QA hook: REVIVE button center in viewport px. */
  reviveButtonCenter(): { x: number; y: number } {
    return this.gameOverlay.reviveButtonCenter
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
