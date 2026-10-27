import { useEffect, useRef, useState } from 'react'
import { createGame, destroyGame } from '../game/GameRoot'
import { FONT_FAMILY } from '../ui/Typography'

/**
 * Mounts the single Phaser game instance. The engine is created inside the
 * effect and destroyed in the cleanup, so Strict Mode's mount -> unmount ->
 * mount cycle yields exactly one live instance at any time.
 *
 * Phase 2.11.0: game creation is gated on the display font being loaded
 * (with a 1.5s fallback timeout) so the first rendered frame already uses
 * Lilita One — canvas text cannot re-render retroactively after a late
 * font swap.
 */
export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fontReady, setFontReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => setFontReady(true), 1500)
    void document.fonts.load(`16px ${FONT_FAMILY}`).then(() => {
      if (!cancelled) setFontReady(true)
    })
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    if (!fontReady) return
    const container = containerRef.current
    if (!container) return

    // Intercept native mobile gestures (pinch-zoom, pull-to-refresh, edge swipe)
    // directly on the canvas mount container with non-passive listeners.
    const preventNativeGestures = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault()
    }
    container.addEventListener('touchstart', preventNativeGestures, { passive: false })
    container.addEventListener('touchmove', preventNativeGestures, { passive: false })

    const game = createGame(container)
    return () => {
      container.removeEventListener('touchstart', preventNativeGestures)
      container.removeEventListener('touchmove', preventNativeGestures)
      destroyGame(game)
    }
  }, [fontReady])
  return <div ref={containerRef} className="game-container" />
}
