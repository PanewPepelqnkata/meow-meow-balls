import Phaser from 'phaser'
import type { UiLayout } from './ResponsiveLayout'
import { CartoonButton, Icons } from './CartoonButton'
import { UI_COLORS } from './DesignSystem'
import { hudText } from './Typography'

/**
 * Phase 2.11.0 ability bar (spec §5): a row of chunky blue cartoon buttons
 * — desktop lower-right, portrait bottom-center. Honest ability states:
 * Swap and Raise Walls are functional; Shake and the fourth slot are
 * visibly unavailable ("SOON"), never fake-interactive.
 *
 * Hotkey badges are REAL bindings: Q → swap, E → raise walls. "R" stays
 * reserved for restart (existing binding) and is therefore not used as a
 * badge; the fourth (locked) slot has no badge.
 */
export interface AbilityHandlers {
  onSwap: () => void
  onRaise: () => void
}

export class AbilityBar {
  private buttons: CartoonButton[] = []
  private countdownText: Phaser.GameObjects.Text | null = null
  private swapUsed = false
  private raiseUsed = false
  private abilitiesEnabled = true
  private readonly scene: Phaser.Scene
  private readonly handlers: AbilityHandlers
  private l: UiLayout | null = null
  /** Hide the ability bar (the collectible card owns the screen). */
  setVisible(visible: boolean): void {
    for (const b of this.buttons) b.containerObj?.setVisible(visible)
    this.countdownText?.setVisible(visible)
  }

  constructor(scene: Phaser.Scene, handlers: AbilityHandlers) {
    this.scene = scene
    this.handlers = handlers
  }

  layout(l: UiLayout): void {
    this.l = l
    for (const b of this.buttons) b.objects().forEach((o) => o.destroy())
    this.buttons = []
    const n = 4
    const rowW = n * l.abilities.size + (n - 1) * l.abilities.gap
    const startX = l.abilities.centerX ? (l.vw - rowW) / 2 : l.abilities.startX
    const defs: Array<{ fill: number; icon: typeof Icons.raise; hotkey?: string; qty?: string; disabled?: boolean; label?: string; press?: () => void }> = [
      {
        fill: UI_COLORS.BTN_BLUE,
        icon: Icons.swap,
        hotkey: 'Q',
        qty: '1',
        disabled: this.swapUsed || !this.abilitiesEnabled,
        label: this.swapUsed ? 'USED' : 'SWAP',
        press: () => this.handlers.onSwap(),
      },
      // No hotkey badge — 'W' is not a real binding (honest SOON state).
      { fill: UI_COLORS.BTN_BLUE, icon: Icons.shake, disabled: true, label: 'SOON' },
      {
        fill: UI_COLORS.BTN_BLUE,
        icon: Icons.raise,
        hotkey: 'E',
        // Phase 2.13.1: one-use — the button flips to USED/disabled the
        // moment activation succeeds and stays that way for the whole run.
        qty: this.raiseUsed ? undefined : '1',
        disabled: this.raiseUsed || !this.abilitiesEnabled,
        label: this.raiseUsed ? 'USED' : 'RAISE',
        press: () => this.handlers.onRaise(),
      },
      { fill: UI_COLORS.BTN_BLUE, icon: Icons.soon, disabled: true, label: 'SOON' },
    ]
    defs.forEach((d, i) => {
      this.buttons.push(
        new CartoonButton(this.scene, {
          x: startX + i * (l.abilities.size + l.abilities.gap) + l.abilities.size / 2,
          y: l.abilities.startY,
          w: l.abilities.size,
          h: l.abilities.size,
          fill: d.fill,
          icon: d.icon,
          hotkey: d.hotkey,
          quantity: d.qty,
          disabled: d.disabled,
          label: d.label,
          labelSize: Math.max(10, l.abilities.size * 0.16),
          onPress: d.press,
        }),
      )
    })
    // Keep an existing countdown label anchored to the (possibly moved) raise button.
    if (this.countdownText) {
      const c = this.raiseCenter()
      this.countdownText.setPosition(c.x, c.y - l.abilities.size * 0.75)
    }
  }

  /** Center of the Raise button (countdown anchor). */
  private raiseCenter(): { x: number; y: number } {
    const b = this.buttons[2]
    return b?.center ?? { x: 0, y: 0 }
  }

  /** Centers of the four buttons (pointer gating + QA). */
  centers(): Array<{ x: number; y: number }> {
    return this.buttons.map((b) => b.center)
  }

  /**
   * Per-frame countdown refresh driven by 'walls:countdown'. The label is
   * created lazily on the first tick (activation may fail — no countdown),
   * anchored above the RAISE button.
   */
  updateRaiseCountdown(remainingMs: number): void {
    if (remainingMs <= 0) {
      this.countdownText?.setText('')
      return
    }
    if (!this.countdownText) {
      const c = this.raiseCenter()
      this.countdownText = hudText(this.scene, c.x, c.y - (this.l?.abilities.size ?? 60) * 0.75, '', 1, {
        color: '#ffffff',
        size: Math.max(12, (this.l?.abilities.size ?? 60) * 0.18),
        stroke: 3,
        origin: [0.5, 0.5],
        shadow: false,
      })
      this.countdownText.setDepth(60)
    }
    this.countdownText.setText(`WALLS ${Math.ceil(remainingMs / 1000)}s`)
  }

  markSwapUsed(): void {
    this.swapUsed = true
    this.layout(this.l!)
  }

  /** Phase 2.13.1: the one-use Raise Walls charge is consumed — the button
   * immediately re-renders as USED and disabled (no further activation). */
  markRaiseUsed(): void {
    this.raiseUsed = true
    this.layout(this.l!)
  }

  /** Phase 2.13.1 QA hook (read-only): the Raise Walls button's lifecycle
   * state — true once its one use is consumed for this run. */
  get raiseUsedState(): boolean {
    return this.raiseUsed
  }

  setAbilitiesEnabled(enabled: boolean): void {
    if (this.abilitiesEnabled === enabled) return
    this.abilitiesEnabled = enabled
    if (this.l) this.layout(this.l)
  }

  resetForNewRun(): void {
    this.swapUsed = false
    this.raiseUsed = false
    this.abilitiesEnabled = true
    this.countdownText?.destroy()
    this.countdownText = null
    if (this.l) this.layout(this.l)
  }
}
