import { useEffect, useState } from 'react'
import { GameCanvas } from './react/GameCanvas'
import { gameBus } from './game/events/gameBus'
import { authService } from './services/auth'

export default function App() {
  const [sceneReady, setSceneReady] = useState(false)

  useEffect(() => gameBus.on('dev:ready', () => setSceneReady(true)), [])

  // Restore any persisted Supabase session so the game-over SAVE YOUR
  // SCORE CTA only shows for genuinely signed-out players.
  useEffect(() => {
    void authService.initialize()
  }, [])

  // The scene-ready signal only drives the (now removed) boot text; keep the
  // subscription for dev tooling but render pure game UI (Phase 2.11.1: the
  // status paragraph overlapped the Check Out button in every screenshot).
  void sceneReady

  return (
    <main className="app">
      <GameCanvas />
    </main>
  )
}
