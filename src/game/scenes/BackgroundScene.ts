import Phaser from 'phaser'
import { BackgroundTheme } from '../rendering/BackgroundTheme'
import type { ThemeName } from '../rendering/BackgroundTheme'
import { THEME_PROGRESS } from '../../config/presentation'
import { themeSetting } from '../state/save'

/**
 * Phase 2.12.1 — dedicated full-screen background scene.
 *
 * WHY A SEPARATE SCENE (root-cause fix for the incomplete background):
 * the gameplay world camera is zoomed/centered to frame the fixed 720×1280
 * stage. Graphics drawn in the gameplay scene at screen-pixel sizes get
 * scaled and displaced by that zoom — `setScrollFactor(0)` exempts an object
 * from camera scroll but NOT from camera zoom, which is exactly how the
 * background ended up as a misplaced rectangle. This scene runs BELOW the
 * gameplay scene (Phaser renders scenes in registration order) with a
 * default camera that is never zoomed or scrolled, so screen-space drawing
 * here is 1:1 with the viewport at every size, on every theme, through
 * every resize/transition.
 */
export class BackgroundScene extends Phaser.Scene {
  private background!: BackgroundTheme

  constructor() {
    super('BackgroundScene')
  }

  create(): void {
    // Explicit transparent clear — the theme layer paints every pixel.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)')
    // HiDPI: the canvas buffer is dpr× CSS px — zoom every camera by the
    // display scale AND center on the CSS midpoint (zoom pivots on the
    // camera center, which is physical/2 — the CSS mid is half that).
    this.applyDprCamera()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyDprCamera, this)
    })
  // Phase 2.19: the PORTRAIT composition is space-themed by design — the
  // dark blue/purple sky reads as a native mobile game and the phone funnel
  // was tuned against it. Space is set at CONSTRUCTION (no light→space
  // flash on the first frames). Desktop/landscape keeps the save-driven
  // opening theme.
  // NOTE: this.scale.width/height are still the CONFIG stage dims
  // (720×1280 — portrait!) when create() runs; the real viewport arrives
  // via applyDprResize on READY. Use the actual window viewport here.
  const pinned = themeSetting()
  // PORTRAIT AUTO (user spec): start LIGHT — the first ball discovery
  // transitions to space (see themeMilestone). A pinned theme still
  // applies immediately on portrait; 'auto' on desktop keeps light.
  const bootTheme = pinned !== 'auto' ? pinned : 'light'
  this.background = new BackgroundTheme(this, bootTheme)
    // Phaser auto-starts only the FIRST configured scene — this one. The
    // gameplay scene (which in turn launches UIScene) must be launched here.
    this.scene.launch('playground')
  }

  override update(_time: number, delta: number): void {
    // Star twinkle + cloud drift for themed backgrounds.
    this.background?.update(delta)
  }

  /** HiDPI camera: zoom = display scale, centered on the CSS midpoint.
   * Called on create and on every resize. */
  private applyDprCamera(): void {
    const z = this.game.scale.displayScale.x
    const cssW = this.scale.width / z
    const cssH = this.scale.height / z
    this.cameras.main.setZoom(z)
    this.cameras.main.centerOn(cssW / 2, cssH / 2)
  }

  /** Theme switching entry point (gameplay events + DEV QA hook). */
  setTheme(theme: ThemeName, durationMs?: number): void {
    this.background?.setTheme(theme, durationMs)
  }

  /**
   * Phase 2.13.0 (spec §6): milestone-driven progression through
   * THEME_PROGRESS.order. `steps` advances that many themes; `comboOnly`
   * (secondary trigger) advances at most one step and is ignored while the
   * progression has run past the cap for this run — exceptional combos can
   * never cycle themes endlessly.
   */
  advanceTheme(steps: number, comboOnly = false): void {
    if (!this.background) return
    const order = THEME_PROGRESS.order
    const idx = order.indexOf(this.background.themeName)
    const take = comboOnly ? Math.min(1, steps) : steps
    const next = order[Math.min(order.length - 1, Math.max(0, idx + take))]
    if (next && next !== this.background.themeName) {
      this.background.setTheme(next, THEME_PROGRESS.fadeMs)
    }
  }

  /** Restart: back to the opening theme, progression state cleared.
   * Portrait viewports stay pinned to space (their composition theme). */
  resetTheme(): void {
    if (window.innerWidth < window.innerHeight) return
    this.background?.setTheme(THEME_PROGRESS.order[0], THEME_PROGRESS.fadeMs)
  }
}
