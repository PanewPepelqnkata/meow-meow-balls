import Phaser from 'phaser'
import { clampDropX, canDrop } from './inputMath'
import type { Interior } from './inputMath'

export interface DropTarget {
  /** Clamped stage-space x for the drop. The spawn Y is owned by
   * config/spawn.ts (raised-wall-anchored, per-tier radius) — the scene's
   * drop path uses the same helpers, so aim, ghost and spawn always agree. */
  x: number
}

export interface InputControllerOptions {
  stageWidth: number
  stageHeight: number
  /** Horizontal aim band — the scene passes the EXTRAPOLATED interior at the
   * spawn height (see config/spawn.ts), so aim, ghost and spawn agree. */
  interior: Interior
  /** Largest spawnable radius — guarantees any variant clears the walls. */
  maxRadius: number
  cooldownMs: number
  /** Viewport → stage mapping. Phase 2.11.0: the world is framed by a zoomed
   * camera inside a full-window canvas, so the SCENE supplies the mapping
   * (worldCam.getWorldPoint) instead of the old FIT-canvas rect math. */
  toStage: (pointer: Phaser.Input.Pointer) => { x: number; y: number } | null
  onDrop: (target: DropTarget) => void
}

/**
 * Scene-facing input: pointer move aims, pointer up drops, cooldown gates
 * double drops. Listeners attach to the scene's input plugin (owned and
 * cleaned up by the scene lifecycle) and are ignored while disabled.
 */
export class InputController {
  /** Clamped aim position in stage units (maxRadius clamping). */
  aimX: number

  private readonly opts: InputControllerOptions
  private lastDropAtMs = -Infinity
  private enabled = true
  private attached = false

  constructor(opts: InputControllerOptions) {
    this.opts = opts
    this.aimX = opts.interior.x + opts.interior.width / 2
  }

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return
    this.updateAim(pointer)
  }

  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return
    this.updateAim(pointer)
    this.tryDrop(performance.now())
  }

  private updateAim(pointer: Phaser.Input.Pointer): void {
    const stage = this.opts.toStage(pointer)
    if (!stage) return
    this.aimX = clampDropX(stage.x, this.opts.maxRadius, this.opts.interior)
  }

  /** Returns the drop target if the cooldown allowed a drop, else null. */
  tryDrop(nowMs: number): DropTarget | null {
    if (!this.enabled) return null
    if (!canDrop(this.lastDropAtMs, nowMs, this.opts.cooldownMs)) return null
    this.lastDropAtMs = nowMs
    const x = clampDropX(this.aimX, this.opts.maxRadius, this.opts.interior)
    // The spawn Y is owned by config/spawn.ts (raised-wall-anchored, per-tier
    // radius, Phase 2.10.1) — the scene's dropBall() applies it, so the aim
    // clamp, ghost preview and actual spawn always agree.
    const target = { x }
    this.opts.onDrop(target)
    return target
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  attach(scene: Phaser.Scene): void {
    if (this.attached) return
    this.attached = true
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove)
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.handlePointerUp)
    // Touch reliability: on phones the pointer-up can land outside the
    // canvas (finger drift past the edge, browser UI overlay) — Phaser
    // still dispatches it to the scene input. Treat it exactly like an
    // in-canvas release so drops never get swallowed.
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp)
  }

  detach(scene: Phaser.Scene): void {
    if (!this.attached) return
    this.attached = false
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove)
    scene.input.off(Phaser.Input.Events.POINTER_UP, this.handlePointerUp)
    scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp)
  }
}
