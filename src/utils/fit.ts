export interface FitResult {
  scale: number
  /** Rendered canvas width in CSS px. */
  width: number
  /** Rendered canvas height in CSS px. */
  height: number
  /** Horizontal letterbox total (split evenly left/right by CENTER_BOTH). */
  letterboxX: number
  /** Vertical letterbox total (split evenly top/bottom by CENTER_BOTH). */
  letterboxY: number
}

/**
 * Mirrors Phaser.Scale.FIT with CENTER_BOTH: uniform scale, no cropping.
 * Pure function so HUD band math and tests can use it without a Phaser instance.
 */
export function computeFitScale(
  stageWidth: number,
  stageHeight: number,
  viewWidth: number,
  viewHeight: number,
): FitResult {
  const scale = Math.min(viewWidth / stageWidth, viewHeight / stageHeight)
  const width = stageWidth * scale
  const height = stageHeight * scale
  return {
    scale,
    width,
    height,
    letterboxX: viewWidth - width,
    letterboxY: viewHeight - height,
  }
}
