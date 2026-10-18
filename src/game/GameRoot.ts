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
  // HiDPI RENDERING: the game runs in Scale.NONE — we own the canvas
  // buffer entirely. The buffer is sized to PHYSICAL pixels (CSS × dpr,
  // capped at 2) and the canvas element is CSS-styled back to the viewport
  // size, so the game renders at the device's native density (crisp text,
  // vector art and outlines on phones). All scenes operate in CSS-px
  // coordinates: every camera zooms by dpr and centers on the CSS midpoint
  // (see each scene's applyDprCamera), and pointer coordinates are
  // auto-normalized by Phaser's displayScale. Desktop DPR-1 displays are
  // unaffected (buffer == CSS px, zoom 1).
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: STAGE.width,
    height: STAGE.height,
    backgroundColor: '#f3f1eb',
    scale: {
      mode: Phaser.Scale.NONE,
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
  const cssSize = (): { w: number; h: number } => ({
    w: parent.clientWidth || window.innerWidth,
    h: parent.clientHeight || window.innerHeight,
  })
  const dpr = (): number => Math.min(2, window.devicePixelRatio || 1)
  const applyDprResize = (): void => {
    const { w, h } = cssSize()
    const d = dpr()
    const bufW = Math.round(w * d)
    const bufH = Math.round(h * d)
    // NONE mode honors explicit sizes: buffer = physical, display = CSS.
    game.scale.setGameSize(bufW, bufH)
    game.scale.setParentSize(w, h) // displayScale = physical / CSS = dpr
    game.canvas.style.width = `${w}px`
    game.canvas.style.height = `${h}px`
    game.scale.displaySize.setSize(w, h)
    game.events.emit('br:dpr', d)
  }
  // Keep the buffer in sync with the viewport (rotate, window resize,
  // standalone install).
  const ro = new ResizeObserver(() => applyDprResize())
  ro.observe(parent)
  game.events.once(Phaser.Core.Events.READY, () => applyDprResize())
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
