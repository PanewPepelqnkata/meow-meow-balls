/**
 * Typed React <-> Phaser event bus (ARCHITECTURE.md §6).
 * Phase 0: minimal scaffold proof — gameplay events are added in later phases.
 * The bus itself must never import Phaser, Matter, or React.
 */

export interface GameEventMap {
  /** Emitted by the scene once the game scene is live (scaffold smoke signal). */
  'dev:ready': { at: number }
  /** Score changed during a run (ScoreSystem → future React HUD). */
  'state:score': { score: number; lastAward: number; chainDepth: number }
  /** A new run started; score reset to 0. */
  'run:started': { at: number }
  /** Merged pair produced `tier` (phase 2: tiers 2–7 only). */
  'fx:merge': { tier: number; x: number; y: number; chainDepth: number }
  /** Game over triggered (Phase 2.10.0): score/best at the moment of overflow.
   * Auth leaderboard: tier/balls/duration ride along so the UIScene's
   * SAVE YOUR SCORE flow can submit the full run record post-login. */
  'run:gameover': {
    score: number
    best: number
    tierReached: number
    ballsMerged: number
    durationMs: number
    revivesUsed?: number
    reviveCost?: number
  }
  /** World → UI: run was revived after game over (fallen-out balls cleared, overlay dismissed). */
  'run:revived': { revivesUsed: number; nextReviveCost: number; removedBalls: number }
  /** World → UI: a blessed run survived its first overflow — the ball
   * exploded, the run continues, and the UI announces the save. */
  'run:developerSave': { removedBalls: number }
  // ---- Phase 2.11.0: PlaygroundScene (world) ↔ UIScene (HUD) wiring ----
  /** The upcoming ball changed (tier + the appearance seed the preview,
   * crane and the eventual spawn all share). */
  'state:next': { tier: number; seed: number }
  /** Persisted save state replaced (login, logout, cloud sync, reset). */
  'state:save': { best: number }
  /** Best score changed (run end or sync). */
  'state:best': { best: number }
  /** Raise Walls countdown tick (per frame; 0 = inactive). */
  'walls:countdown': { remainingMs: number }
  /** Shake ability countdown tick (per frame; 0 = inactive). */
  'shake:countdown': { remainingMs: number }
  /** Shake ability consumed this run. */
  'ability:shakeUsed': Record<string, never>
  /** The swap power-up was consumed this run. */
  'ability:swapUsed': Record<string, never>
  /** Phase 2.13.1: the one-use Raise Walls power-up was consumed this run —
   * the button immediately shows USED/disabled for the rest of the run. */
  'ability:raiseUsed': Record<string, never>
  /** Ability buttons enabled/disabled (game over / restart). */
  'ability:enabled': { enabled: boolean }
  /** UI → game: player pressed an ability / restart in the UIScene. */
  'ui:swap': Record<string, never>
  'ui:raise': Record<string, never>
  'ui:shake': Record<string, never>
  'ui:restart': Record<string, never>
  'ui:revive': Record<string, never>
  /** Pause menu opened; the world must ignore all pointer releases. */
  'ui:pause': Record<string, never>
  /** Pause menu → world: swallow the Resume release before enabling gameplay. */
  'ui:resume': Record<string, never>
  /** Phase 2.14.0: UI → game. The player pressed START on the title
   * screen — gameplay input unlocks, the start scene is fading out. */
  'ui:start': Record<string, never>
  /** A core tier or collectible character was encountered for this run. */
  'discovery:book': {
    tier: number
    seed: number
    theme: string | null
    variant: number | null
    firstTime: boolean
  }
  /** QA/legacy repeat discovery route. */
  'discovery:banner': { tier: number; seed: number; theme: string | null; variant: number | null }
  /** First drop of a run: one line telling the player what to do. */
  'hint:merge': Record<string, never>
  /** Phase 2.13.0: world → UI. A tier was discovered for the first time this
   * run (any tier ≥ 2) — the progression path unlocks its node. */
  'state:discovered': { tier: number }
  /** World → UI. Drop cooldown gate flipped; false hides held ball. */
  'state:dropHolding': { holding: boolean }
  /** Persisted Music/SFX mixer settings changed in Settings. */
  'audio:settings': {
    musicVolume: number
    effectsVolume: number
    musicMuted: boolean
    effectsMuted: boolean
  }
  /** A player successfully dropped a ball; never emitted for rejected input. */
  'fx:drop': { tier: number }
  /** A ball made a meaningful hard landing against the floor or container. */
  'fx:landing': { tier: number; impact: number }
  /** Server-evaluated achievement newly unlocked on this sync. */
  'achievement:unlocked': {
    id: string
    name: string
    rewardTitleId: string | null
    rewardTitleName: string | null
  }
}

type Handler<K extends keyof GameEventMap> = (payload: GameEventMap[K]) => void

class GameBus {
  private handlers = new Map<keyof GameEventMap, Set<Handler<never>>>()

  on<K extends keyof GameEventMap>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as Handler<never>)
    return () => {
      set.delete(handler as Handler<never>)
    }
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const handler of set) {
      ;(handler as Handler<K>)(payload)
    }
  }
}

export const gameBus = new GameBus()
