import { SPAWN } from '../../config/spawn'

export interface CanvasRect {
  left: number
  top: number
  width: number
  height: number
}

export interface Interior {
  x: number
  width: number
}

/**
 * Map a client (browser) coordinate to logical stage coordinates.
 * Works at any viewport size because Scale.FIT letterboxes the canvas:
 * the mapping only depends on the canvas's on-screen rect vs stage size.
 */
export function clientToStage(
  clientX: number,
  clientY: number,
  rect: CanvasRect,
  stageWidth: number,
  stageHeight: number,
): { x: number; y: number } {
  const scaleX = stageWidth / rect.width
  const scaleY = stageHeight / rect.height
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  }
}

/**
 * Clamp a drop x so a ball of `radius` fits fully inside the container
 * interior (with the configured safety margin).
 */
export function clampDropX(x: number, radius: number, interior: Interior): number {
  const min = interior.x + radius + SPAWN.clampMargin
  const max = interior.x + interior.width - radius - SPAWN.clampMargin
  return Math.min(Math.max(x, min), Math.max(min, max))
}

/** Pure cooldown gate used by InputController (headless-testable). */
export function canDrop(lastDropAtMs: number, nowMs: number, cooldownMs: number): boolean {
  return nowMs - lastDropAtMs >= cooldownMs
}
