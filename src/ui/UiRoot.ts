import Phaser from 'phaser'
import { resolveLayout, readSafeArea, WORLD_GEOM } from './ResponsiveLayout'
import type { UiLayout } from './ResponsiveLayout'
import { ScoreDisplay } from './ScoreDisplay'
import { NextBall } from './NextBall'
import { TierProgression } from './TierProgression'
import { AbilityBar } from './AbilityBar'
import type { AbilityHandlers } from './AbilityBar'
import { ChunkyButton, UI_COLORS } from './DesignSystem'
import { drawLucide } from './LucideIcon'

/**
 * Phase 2.11.0 — UI root (spec §2, §14): owns every HUD component, applies
 * the central `ResponsiveLayout` on every resize, and exposes the same
 * facade the old HudView had so the scene wiring stays minimal. Physics and
 * game state remain in the game systems; this layer only displays state and
 * forwards player actions through `handlers`.
 *
 * (Used inside UIScene, which owns the UI camera — world gameplay lives in
 * PlaygroundScene with its own camera.)
 */
export interface UiHandlers extends AbilityHandlers {
  onPause: () => void
}

export class UiRoot {
  private readonly scene: Phaser.Scene
  private readonly scores: ScoreDisplay
  private readonly nextBall: NextBall
  private readonly tiers: TierProgression
  private readonly abilities: AbilityBar
  private readonly pauseButton: ChunkyButton
  private hudVisible = true
  private l: UiLayout | null = null

  constructor(scene: Phaser.Scene, handlers: UiHandlers) {
    this.scene = scene
    this.scores = new ScoreDisplay(scene)
    this.nextBall = new NextBall(scene)
    this.tiers = new TierProgression(scene)
    this.abilities = new AbilityBar(scene, handlers)
    this.pauseButton = new ChunkyButton({
      scene, x: 0, y: 0, w: 48, h: 48, pill: true,
      fill: UI_COLORS.BTN_BLUE,
      shadowColor: UI_COLORS.BTN_BLUE_SHADOW,
      highlightColor: UI_COLORS.BTN_BLUE_HIGHLIGHT,
      icon: (g, x, y, size) => drawLucide(g, 'pause', x, y, size, 0xffffff, 2.5),
      iconSize: 24,
      onClick: handlers.onPause,
    })
    this.pauseButton.container.setName('hud-pause').setDepth(30)
    this.layout()
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    })
  }

  /**
   * Show or hide the WHOLE HUD.
   *
   * The collectible-card presentation owns the screen: the score, the
   * best, the next-ball preview, the tier track and the ability bar all
   * sat AROUND the card and made it look broken. The HUD is hidden for the
   * card's duration and restored afterwards.
   *
   * Each HUD component hides its own objects (they are spread across the
   * scene and some have no depth of their own, so a depth band was not
   * reliable).
   */
  setHudVisible(visible: boolean): void {
    this.hudVisible = visible
    this.scores.setVisible(visible)
    this.nextBall.setVisible(visible)
    this.tiers.setVisible(visible)
    this.abilities.setVisible(visible)
    this.pauseButton.container.setVisible(visible)
  }

  layout(): void {
    // HiDPI: the camera frames the CSS-px region — normalize the buffer size
    // before layout (prod has no __brGame global; explicit division is the
    // single source of truth, matching the resolveLayout contract).
    const z = this.scene.game.scale.displayScale.x || 1
    this.l = resolveLayout(this.scene.scale.width / z, this.scene.scale.height / z, readSafeArea())
    this.scores.layout(this.l)
    this.nextBall.layout(this.l)
    this.tiers.layout(this.l)
    this.abilities.layout(this.l)
    const safe = readSafeArea()
    const scoreCenterY = this.l.score.y + Math.round(this.l.scoreSize * this.l.fontScale) * WORLD_GEOM.SCORE_LINE / 2
    this.pauseButton.container.setPosition(
      this.l.vw - Math.max(12, safe.right + 8) - 24,
      Math.max(safe.top + 26, scoreCenterY),
    )
    this.setHudVisible(this.hudVisible)
    this.refreshHitRects()
  }

  /** Interactive control rects for pointer gating (viewport px). */
  private refreshHitRects(): void {
    this.hitRects = []
    for (const c of this.abilities.centers()) {
      this.hitRects.push({ x: c.x - this.l!.abilities.size / 2, y: c.y - this.l!.abilities.size / 2, w: this.l!.abilities.size, h: this.l!.abilities.size })
    }
    const pause = this.pauseButton.container
    this.hitRects.push({ x: pause.x - 24, y: pause.y - 24, w: 48, h: 48 })
    // Portrait: the top HUD block also gates pointer drops.
    if (this.l!.composition === 'portrait') {
      this.hitRects.push({ x: 0, y: 0, w: this.l!.vw, h: this.l!.stack.hudBottom })
    }
  }

  private hitRects: Array<{ x: number; y: number; w: number; h: number }> = []

  get layout_(): UiLayout {
    if (!this.l) this.layout()
    return this.l!
  }

  // ---- facade used by PlaygroundScene (mirrors the old HudView API) ----

  setScore(score: number, best: number): void {
    this.scores.setScore(score, best)
  }

  setNextTier(tier: number, seed: number): void {
    this.nextBall.setNext(tier, seed)
  }

  /** Drop-cooldown state: while false the Next Ball preview hides. */
  setNextHolding(holding: boolean): void {
    this.nextBall.setHolding(holding)
  }

  markSwapUsed(): void {
    this.abilities.markSwapUsed()
  }

  /** Phase 2.13.1: one-use Raise Walls consumed — button → USED/disabled. */
  markRaiseUsed(): void {
    this.abilities.markRaiseUsed()
  }
  markShakeUsed(): void {
    this.abilities.markShakeUsed()
  }

  updateShakeCountdown(remainingMs: number): void {
    this.abilities.updateShakeCountdown(remainingMs)
  }


  updateRaiseCountdown(remainingMs: number): void {
    this.abilities.updateRaiseCountdown(remainingMs)
  }

  setAbilitiesEnabled(enabled: boolean): void {
    this.abilities.setAbilitiesEnabled(enabled)
    this.pauseButton.setDisabled(!enabled)
  }

  resetForNewRun(): void {
    this.abilities.resetForNewRun()
    // Phase 2.13.0: progression returns to "only tier 1 known" on restart.
    this.tiers.reset()
  }

  /** Phase 2.13.0 (spec §9): a tier was discovered for the first time this
   * run — the progression node unlocks with a pop. */
  unlockTier(tier: number): void {
    this.tiers.unlockTier(tier)
  }

  /** Phase 2.13.0 QA hook (read-only): tiers the progression shows unlocked. */
  progressionUnlocked(): number[] {
    return this.tiers.unlocked
  }

  /** Phase 2.13.1 QA hook (read-only): the Raise Walls button lifecycle. */
  abilityRaiseUsed(): boolean {
    return this.abilities.raiseUsedState
  }

  /** True when the viewport point lies on an interactive control (buttons).
   * The world scene gates aim/drop input on this — both scenes receive the
   * same pointer events, and a button press must never drop a ball. */
  isPointerOverUi(x: number, y: number): boolean {
    for (const r of this.hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true
    }
    return false
  }

  /** QA hook: viewport-px centers of interactive controls + the preview ball
   * + the top of the tier progression (region clamps for pixel QA). */
  uiPositions(): {
    abilities: Array<{ x: number; y: number }>
    nextBall: { x: number; y: number; diameter: number }
    tiersTop: number
  } {
    const t = this.l!.tiers
    const tiersTop =
      t.kind === 'row' ? (t.rowY ?? 0) - (t.nodeR ?? 0) - 2 : (t.cy ?? 0) - (t.r ?? 0) - (t.nodeR ?? 0)
    return {
      abilities: this.abilities.centers(),
      nextBall: this.nextBall.center(),
      tiersTop,
    }
  }
}
