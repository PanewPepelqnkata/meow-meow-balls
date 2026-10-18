import Phaser from 'phaser'
import { STAGE } from '../config/stage'
import { BackgroundScene } from './scenes/BackgroundScene'
import { PlaygroundScene } from './scenes/PlaygroundScene'
import { UIScene } from './scenes/UIScene'
import { SoftBallScene } from './scenes/SoftBallScene'
import { TitleScene } from './scenes/TitleScene'

/**
 * The single approved boundary between React and the game engine
 * (ARCHITECTURE.md §1): React calls createGame/destroyGame with a container
 * element and owns nothing else inside the game.
 *
 * Lifecycle: exactly one Phaser.Game per container. createGame must only be
 * called once per mount; the mount cleanup must call destroyGame exactly once.
 * This makes React Strict Mode double-mounting safe (create -> destroy ->
 * create) with no duplicate instances or leaked listeners.
 */
export function createGame(parent: HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: STAGE.width,
    height: STAGE.height,
    backgroundColor: '#f3f1eb',
    // Phase 2.11.0: the canvas fills the window (RESIZE); the world scene
    // frames the fixed 720×1280 gameplay stage with a zoomed camera, and
    // UIScene renders the responsive HUD at 1:1 viewport scale on top.
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    // Phase 2.12.1: BackgroundScene renders FIRST (bottom of the scene list)
    // with a never-zoomed camera, so the themed background always covers the
    // full viewport 1:1 regardless of the gameplay camera's zoom/pan.
    // Phase 2.14.0: TitleScene is LAST — the start screen renders on top of
    // everything. It is only STARTED on demand (PlaygroundScene launches it
    // at boot unless dev-fastboot skipped it); being in the list just
    // registers its key.
    scene: [BackgroundScene, PlaygroundScene, UIScene, TitleScene],
  })
  // Phase 2.7 DEV-ONLY: soft-body prototype behind ?softbody=1
  if (import.meta.env.DEV && typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('softbody') === '1') {
    game.scene.add('softball', SoftBallScene, true)
  }
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__brGame = game
  }
  return game
}

export function destroyGame(game: Phaser.Game | null): void {
  game?.destroy(true)
}
