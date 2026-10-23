/**
 * Phase 2.14.0 (spec §2) — persistent player save (localStorage).
 *
 * What lives here and WHY:
 *   - `best`            — best score ever (was session-only via the Phaser
 *                         registry; now survives reloads).
 *   - `leaderboard`    — top runs (score, best tier reached, timestamp) for
 *                         the LEADERBOARD menu screen.
 *   - `discovered`     — tier → first-seen timestamp (ever), powering the
 *                         JOURNAL and COLLECTION screens. Per-run discovery
 *                         (discovery modal) stays in PlaygroundScene; this
 *                         is the lifetime record.
 *   - `variants`        — `${tier}:${variantId}` → first-seen timestamp.
 *                         Tiers 8–9 randomize their look EVERY RUN, so the
 *                         journal accumulates the distinct variants a
 *                         player has collected over time.
 *   - `settings.theme`  — 'auto' (follow run progression) or a fixed theme.
 *   - `stats`           — lifetime runs / merges / best tier.
 *
 * Robustness: every localStorage access is guarded (private mode, blocked
 * storage, corrupted JSON) — the game must be fully playable with a dead or
 * missing save. The cache is write-through; failures degrade to in-memory.
 */

const KEY = 'ballrush.save.v1'
const MAX_LEADERBOARD = 10

export type ThemeSetting = 'auto' | 'light' | 'space' | 'jungle' | 'fantasy'

export interface LeaderboardEntry {
  score: number
  bestTier: number
  at: number
}

export interface SaveDataV1 {
  version: 1
  best: number
  leaderboard: LeaderboardEntry[]
  /** tier → first-discovered-at (ms epoch). */
  discovered: Record<string, number>
  /** `${tier}:${variantId}` → first-collected-at (ms epoch) — tiers 8/9. */
  variants: Record<string, number>
  settings: { theme: ThemeSetting }
  stats: { runs: number; merges: number; bestTier: number }
}

function freshSave(): SaveDataV1 {
  return {
    version: 1,
    best: 0,
    leaderboard: [],
    // Tiers 1–3 are known from the first run — pre-seeded as discovered.
    // Tier 4+ unlock PROGRESSIVELY (each fires its discovery: the card
    // the first time, the wind banner afterwards).
    discovered: { 1: Date.now(), 2: Date.now(), 3: Date.now() },
    variants: {},
    settings: { theme: 'auto' },
    stats: { runs: 0, merges: 0, bestTier: 0 },
  }
}

let cache: SaveDataV1 | null = null

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    // Probe access once (Safari private mode throws on the property itself).
    const probe = '__br_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

function write(): void {
  const s = storage()
  if (!s || !cache) return
  try {
    s.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded / blocked — in-memory save continues to work.
  }
}

/**
 * PERF: merges fire recordMerge up to several times inside ONE frame (deep
 * chains). localStorage.setItem is a synchronous IPC round-trip on iOS
 * (5-20 ms each) — a 4-merge chain stalled frames by 60 ms+. writeNow()
 * flushes immediately (run end, settings change, tab hide); high-frequency
 * callers use writeSoon() which coalesces to one store write per second.
 * The in-memory cache is ALWAYS current — only the disk copy may lag ≤1 s.
 *
 * PERF (iOS, 2026-10-22): the deferred write is scheduled on the IDLE
 * callback, not a bare setTimeout. A setTimeout fires between frames and
 * its synchronous IPC lands in the middle of the frame budget — a 5-20 ms
 * hitch on the device, on a frame the player did not cause. requestIdle-
 * Callback runs the write when the main thread has slack (and with a
 * timeout, so it still happens promptly if the game goes idle).
 */
let writeTimer: ReturnType<typeof setTimeout> | null = null
let idleHandle: number | null = null
function writeSoon(): void {
  if (writeTimer || idleHandle !== null) return
  const flushSoon = (): void => {
    idleHandle = null
    writeTimer = null
    write()
  }
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(flushSoon, { timeout: 1000 })
  } else {
    // No requestIdleCallback (older Safari): fall back to the timer.
    writeTimer = setTimeout(flushSoon, 1000)
  }
}
function writeNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  // A pending idle write must be cancelled too, or it would fire a
  // SECOND write right after this one (the idle callback would still run).
  if (idleHandle !== null && typeof window !== 'undefined' && window.cancelIdleCallback) {
    window.cancelIdleCallback(idleHandle)
    idleHandle = null
  }
  write()
}
if (typeof window !== 'undefined') {
  const flush = (): void => writeNow()
  window.addEventListener('visibilitychange', flush)
  window.addEventListener('pagehide', flush)
}

export function loadSave(): SaveDataV1 {
  if (cache) return cache
  const s = storage()
  if (s) {
    try {
      const raw = s.getItem(KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveDataV1>
        if (parsed && parsed.version === 1) {
          cache = { ...freshSave(), ...parsed } as SaveDataV1
          cache.settings = { theme: 'auto', ...parsed.settings }
          return cache
        }
      }
    } catch {
      // Corrupted save — fall through to a fresh one.
    }
  }
  cache = freshSave()
  return cache
}

/** Test/QA hook: wipe the save completely (Settings → Reset progress). */
export function resetSave(): void {
  cache = freshSave()
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  const s = storage()
  if (s) {
    try {
      s.removeItem(KEY)
    } catch {
      /* blocked — fresh in-memory save still returned */
    }
  }
}

/** Lifetime discovery record (JOURNAL + COLLECTION). Returns the variant id. */
export function recordDiscovery(tier: number, variantId: number | null): void {
  const save = loadSave()
  const now = Date.now()
  if (save.discovered[String(tier)] == null) save.discovered[String(tier)] = now
  if (variantId != null) {
    const k = `${tier}:${variantId}`
    if (save.variants[k] == null) save.variants[k] = now
  }
  if (tier > save.stats.bestTier) save.stats.bestTier = tier
  writeSoon()
}

/** Has this tier EVER been discovered in any run (lifetime record)? The
 * repeat-discovery banner keys off this: a tier seen before gets the
 * non-blocking corner animation instead of the screen-stealing modal. */
export function hasDiscoveredTier(tier: number): boolean {
  return loadSave().discovered[String(tier)] != null
}

/** One merge happened (lifetime stat). */
export function recordMerge(tier: number): void {
  const save = loadSave()
  save.stats.merges++
  if (tier > save.stats.bestTier) save.stats.bestTier = tier
  writeSoon()
}

/** A run ended (game over): leaderboard entry + best-score bookkeeping. */
export function recordRunEnd(score: number, bestTier: number): number {
  const save = loadSave()
  save.stats.runs++
  if (score > save.best) save.best = score
  save.leaderboard.push({ score, bestTier, at: Date.now() })
  save.leaderboard.sort((a, b) => b.score - a.score || a.at - b.at)
  save.leaderboard = save.leaderboard.slice(0, MAX_LEADERBOARD)
  writeNow()
  return save.best
}

/** Persisted best score (the gameplay HUD 'BEST' reads this at boot). */
export function savedBest(): number {
  return loadSave().best
}

export function setThemeSetting(theme: ThemeSetting): void {
  loadSave().settings.theme = theme
  writeNow()
}

export function themeSetting(): ThemeSetting {
  return loadSave().settings.theme
}
