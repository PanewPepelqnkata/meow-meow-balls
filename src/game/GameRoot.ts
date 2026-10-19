import Phaser from 'phaser'
import { STAGE } from '../config/stage'
import { resolveViewportContainer } from '../config/container'
import { BackgroundScene } from './scenes/BackgroundScene'
import { StartIntroScene } from './scenes/StartIntroScene'
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
  // Phase 2.19: pick the container proportion for THIS viewport before any
  // geometry consumer constructs (colliders, ContainerView texture, spawn
  // anchors, WallAnimator's captured height). Portrait phones get the tall
  // narrow funnel; desktop/landscape keeps the reference geometry.
  const parentRect = parent.getBoundingClientRect()
  const bootW = parentRect.width || window.innerWidth
  const bootH = parentRect.height || window.innerHeight
  resolveViewportContainer(bootW, bootH)
  // Phase 2.19: portrait phones are space-themed — the canvas clear color
  // must match the space base so no frame ever flashes cream before the
  // BackgroundScene paints (it covers every pixel, but first-frame flashes
  // and resize gaps still read against the clear color).
  const portraitPhone = bootH > bootW
  const clearColor = portraitPhone ? '#0a1628' : '#f3f1eb'
  // HiDPI RENDERING: the game runs in Scale.NONE — we own the canvas
  // buffer entirely. The buffer is sized to PHYSICAL pixels (CSS × full
  // devicePixelRatio — NO cap: iPhone DPR 3 renders a 1170×2532 buffer)
  // and the canvas element is CSS-styled back to the viewport size, so
  // the game renders at the device's native density (crisp text, vector
  // art and outlines on phones). All scenes operate in CSS-px
  // coordinates: every camera zooms by dpr and centers on the CSS
  // midpoint (see each scene's applyDprCamera), and pointer coordinates
  // are auto-normalized by Phaser's displayScale. Desktop DPR-1 displays
  // are unaffected (buffer == CSS px, zoom 1).
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: STAGE.width,
    height: STAGE.height,
    backgroundColor: clearColor,
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
    scene: [BackgroundScene, PlaygroundScene, UIScene, TitleScene, StartIntroScene],
  })
  const cssSize = (): { w: number; h: number } => ({
    w: parent.clientWidth || window.innerWidth,
    h: parent.clientHeight || window.innerHeight,
  })
  // Full-device pixel ratio: iPhones (DPR 3) were capped at 2, so the
  // 390×3 physical buffer was rendered from a 390×2 canvas and stretched —
  // the pixelated look on Retina. Vector/ink art scales cleanly; the
  // perf cost is bounded by the soft-body particle count, not fill rate.
  const dpr = (): number => window.devicePixelRatio || 1
  let lastAppliedW = 0
  let lastAppliedH = 0
  let lastAppliedDpr = 0
  const applyDprResize = (): void => {
    const { w, h } = cssSize()
    const d = dpr()
    // Same-size guard: multiple listeners fire per real viewport change —
    // skip duplicate full re-layouts.
    if (w === lastAppliedW && h === lastAppliedH && d === lastAppliedDpr) return
    lastAppliedW = w
    lastAppliedH = h
    lastAppliedDpr = d
    const bufW = Math.round(w * d)
    const bufH = Math.round(h * d)
    // NONE mode honors explicit sizes: buffer = physical, display = CSS.
    // ORDERING MATTERS (Phase 2.21): style the canvas element FIRST so
    // ScaleManager.refresh() (fired inside setGameSize) measures the NEW
    // CSS bounds and computes a correct displayScale before the RESIZE
    // event reaches BackgroundScene/UiRoot handlers — the previous order
    // (setGameSize → setParentSize → style) let resize handlers read a
    // STALE displayScale and paint the background at wrong dimensions
    // (the 'background shown wrong' bug on real devices).
    game.canvas.style.width = `${w}px`
    game.canvas.style.height = `${h}px`
    game.scale.setGameSize(bufW, bufH)
    game.scale.setParentSize(w, h) // displayScale = physical / CSS = dpr
    game.scale.displaySize.setSize(w, h)
    game.events.emit('br:dpr', d)
  }
  // Keep the buffer in sync with the viewport (rotate, window resize,
  // standalone install, Safari dynamic-viewport collapse). ResizeObserver
  // catches container changes; visualViewport resize catches iOS URL-bar
  // collapse that window.resize misses.
  const ro = new ResizeObserver(() => applyDprResize())
  ro.observe(parent)
  window.visualViewport?.addEventListener('resize', applyDprResize)
  window.addEventListener('orientationchange', applyDprResize)
  game.events.once(Phaser.Core.Events.READY, () => applyDprResize())
  // Phase 2.7 DEV-ONLY: soft-body prototype behind ?softbody=1
  if (import.meta.env.DEV && typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('softbody') === '1') {
    game.scene.add('softball', SoftBallScene, true)
  }
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__brGame = game
  }
  // Listeners must not outlive the game (React Strict Mode mounts twice).
  const cleanup = (): void => {
    ro.disconnect()
    window.visualViewport?.removeEventListener('resize', applyDprResize)
    window.removeEventListener('orientationchange', applyDprResize)
  }
  game.events.once(Phaser.Core.Events.DESTROY, cleanup)
  return game
}

export function destroyGame(game: Phaser.Game | null): void {
  game?.destroy(true)
}
