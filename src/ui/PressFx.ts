import Phaser from 'phaser'

/**
 * Phase 2.11.0 button press feedback (spec §9): brief physical press —
 * scale to 0.95 and back, 90ms each way. Short and responsive; the helper
 * is shared by every cartoon button so the whole game feels consistent.
 */
export function pressFx(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & { scale: number }, onDone?: () => void): void {
  scene.tweens.add({
    targets: target,
    scale: target.scale * 0.95,
    duration: 90,
    yoyo: true,
    ease: 'Quad.easeOut',
    onYoyo: () => onDone?.(),
  })
}
