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
 *   - `variants`       — `${tier}:${theme}:${variantId}` → first-seen timestamp
 *                         for tier 9–12 characters and their discovery palette.
 *                         Legacy `${tier}:${variantId}` keys remain supported.
 *   - `settings.theme`  — 'auto' (follow run progression) or a fixed theme.
 *   - `stats`           — lifetime runs / merges / best tier.
 *
 * Robustness: every localStorage access is guarded (private mode, blocked
 * storage, corrupted JSON) — the game must be fully playable with a dead or
 * missing save. The cache is write-through; failures degrade to in-memory.
 */

import { collectibleDiscoveryKey } from '../../config/collectibleCollection'
import { gameBus } from '../events/gameBus'

const KEY = 'ballrush.save.v1'
const OWNER_KEY = 'ballrush.save.owner'
const GUEST_ID_KEY = 'ballrush.guest.id'
const MAX_LEADERBOARD = 10

const VALID_THEMES = new Set<ThemeSetting>(['auto', 'light', 'space', 'jungle', 'fantasy'])
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
  /** Character/palette keys (`tier:theme:variantId`), or legacy numeric keys → first-collected-at (ms epoch). */
  variants: Record<string, number>
  settings: { theme: ThemeSetting }
  stats: { runs: number; merges: number; bestTier: number }
}

export function freshSave(): SaveDataV1 {
  const now = Date.now()
  return {
    version: 1,
    best: 0,
    leaderboard: [],
    // Tiers 1–3 are known from the first run — pre-seeded as discovered.
    // Tier 4+ unlock PROGRESSIVELY (each fires its discovery: the card
    // the first time, the wind banner afterwards).
    discovered: { 1: now, 2: now, 3: now },
    variants: {},
    settings: { theme: 'auto' },
    stats: { runs: 0, merges: 0, bestTier: 0 },
  }
}

export function normalizeSave(raw: Partial<SaveDataV1> | null | undefined): SaveDataV1 {
  const base = freshSave()
  if (!raw || typeof raw !== 'object') return base

  const now = Date.now()
  const discovered: Record<string, number> = { 1: now, 2: now, 3: now }
  let maxDiscoveredTier = 0
  if (raw.discovered && typeof raw.discovered === 'object') {
    for (const [k, v] of Object.entries(raw.discovered)) {
      const tier = Number(k)
      if (Number.isInteger(tier) && tier >= 1 && tier <= 12 && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        discovered[String(tier)] = v
        if (tier > 3 && tier > maxDiscoveredTier) maxDiscoveredTier = tier
      }
    }
  }

  const variants: Record<string, number> = {}
  if (raw.variants && typeof raw.variants === 'object') {
    for (const [k, v] of Object.entries(raw.variants)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        variants[k] = v
      }
    }
  }

  const leaderboard: LeaderboardEntry[] = []
  if (Array.isArray(raw.leaderboard)) {
    for (const entry of raw.leaderboard) {
      if (
        entry &&
        typeof entry.score === 'number' &&
        Number.isFinite(entry.score) &&
        entry.score >= 0 &&
        typeof entry.bestTier === 'number' &&
        Number.isFinite(entry.bestTier)
      ) {
        leaderboard.push({
          score: Math.floor(entry.score),
          bestTier: Math.max(1, Math.min(12, Math.floor(entry.bestTier))),
          at: typeof entry.at === 'number' && Number.isFinite(entry.at) && entry.at > 0 ? entry.at : now,
        })
      }
    }
    leaderboard.sort((a, b) => b.score - a.score || b.at - a.at)
  }

  const rawBest = typeof raw.best === 'number' && Number.isFinite(raw.best) && raw.best >= 0 ? Math.floor(raw.best) : 0
  const topLbScore = leaderboard[0]?.score ?? 0
  const best = Math.max(rawBest, topLbScore)

  const rawStats = raw.stats && typeof raw.stats === 'object' ? raw.stats : { runs: 0, merges: 0, bestTier: 0 }
  const runs =
    typeof rawStats.runs === 'number' && Number.isFinite(rawStats.runs) && rawStats.runs >= 0
      ? Math.floor(rawStats.runs)
      : 0
  const merges =
    typeof rawStats.merges === 'number' && Number.isFinite(rawStats.merges) && rawStats.merges >= 0
      ? Math.floor(rawStats.merges)
      : 0
  const rawBestTier =
    typeof rawStats.bestTier === 'number' && Number.isFinite(rawStats.bestTier) && rawStats.bestTier >= 0
      ? Math.floor(rawStats.bestTier)
      : 0
  const topLbTier = leaderboard.reduce((m, e) => Math.max(m, e.bestTier), 0)
  const bestTier = Math.max(rawBestTier, maxDiscoveredTier, topLbTier)

  for (let t = 1; t <= Math.min(12, bestTier); t++) {
    if (discovered[String(t)] == null) discovered[String(t)] = now
  }

  const rawTheme = raw.settings?.theme
  const theme: ThemeSetting = rawTheme && VALID_THEMES.has(rawTheme) ? rawTheme : 'auto'

  return {
    version: 1,
    best,
    leaderboard: leaderboard.slice(0, MAX_LEADERBOARD),
    discovered,
    variants,
    settings: { theme },
    stats: {
      runs: Math.max(runs, leaderboard.length),
      merges,
      bestTier,
    },
  }
}

export function cloneSave(save: SaveDataV1 = loadSave()): SaveDataV1 {
  return normalizeSave({
    version: 1,
    best: save.best,
    leaderboard: save.leaderboard.map((e) => ({ ...e })),
    discovered: { ...save.discovered },
    variants: { ...save.variants },
    settings: { ...save.settings },
    stats: { ...save.stats },
  })
}

let cache: SaveDataV1 | null = null
let ownerCache: string | null | undefined = undefined
let guestIdCache: string | null = null
let cloudSyncHandler: ((save: SaveDataV1, immediate: boolean) => void) | null = null

export function setCloudSyncHandler(handler: ((save: SaveDataV1, immediate: boolean) => void) | null): void {
  cloudSyncHandler = handler
}
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

export function getSaveOwnerId(): string | null {
  if (ownerCache !== undefined) return ownerCache
  const s = storage()
  if (!s) {
    ownerCache = null
    return null
  }
  try {
    const val = s.getItem(OWNER_KEY)
    ownerCache = val && val.trim().length > 0 ? val.trim() : null
    return ownerCache
  } catch {
    ownerCache = null
    return null
  }
}

export function setSaveOwnerId(userId: string | null): void {
  ownerCache = userId && userId.trim().length > 0 ? userId.trim() : null
  const s = storage()
  if (!s) return
  try {
    if (ownerCache) {
      s.setItem(OWNER_KEY, ownerCache)
    } else {
      s.removeItem(OWNER_KEY)
    }
  } catch {
    // Blocked storage — in-memory ownerCache still tracks ownership.
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getOrCreateGuestId(): string {
  if (guestIdCache && UUID_RE.test(guestIdCache)) return guestIdCache
  const s = storage()
  if (s) {
    try {
      const existing = s.getItem(GUEST_ID_KEY)?.trim()
      if (existing && UUID_RE.test(existing)) {
        guestIdCache = existing
        return existing
      }
    } catch {
      // Ignore blocked storage
    }
  }
  const next = generateUuidV4()
  guestIdCache = next
  if (s) {
    try {
      s.setItem(GUEST_ID_KEY, next)
    } catch {
      // Ignore blocked storage
    }
  }
  return next
}

export function resetGuestId(): string {
  const next = generateUuidV4()
  guestIdCache = next
  const s = storage()
  if (s) {
    try {
      s.setItem(GUEST_ID_KEY, next)
    } catch {
      // Ignore blocked storage
    }
  }
  return next
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

function cancelScheduledWrites(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (idleHandle !== null && typeof window !== 'undefined' && window.cancelIdleCallback) {
    window.cancelIdleCallback(idleHandle)
    idleHandle = null
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
    if (cache) cloudSyncHandler?.(cloneSave(cache), false)
  }
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(flushSoon, { timeout: 1000 })
  } else {
    // No requestIdleCallback (older Safari): fall back to the timer.
    writeTimer = setTimeout(flushSoon, 1000)
  }
}
function writeNow(syncCloud = true): void {
  cancelScheduledWrites()
  write()
  if (syncCloud && cache) cloudSyncHandler?.(cloneSave(cache), true)
}
if (typeof window !== 'undefined') {
  const flush = (): void => {
    if (writeTimer || idleHandle !== null) writeNow(true)
  }
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
          cache = normalizeSave(parsed)
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

function assignCache(next: SaveDataV1): SaveDataV1 {
  if (cache) {
    Object.assign(cache, next)
    return cache
  }
  cache = next
  return cache
}

/** Write a complete save object (used for cloud progress restoration). */
export function writeSave(
  save: Partial<SaveDataV1>,
  options?: { syncCloud?: boolean; ownerId?: string | null },
): SaveDataV1 {
  const normalized = normalizeSave(save)
  const current = assignCache(normalized)
  if (options && 'ownerId' in options) {
    setSaveOwnerId(options.ownerId ?? null)
  }
  writeNow(options?.syncCloud ?? false)
  gameBus.emit('state:best', { best: current.best })
  gameBus.emit('state:save', { best: current.best })
  return current
}

/** Test/QA hook & logout reset: wipe the save completely (Settings → Reset progress or logout). */
export function resetSave(options?: { syncCloud?: boolean; clearOwner?: boolean }): SaveDataV1 {
  cancelScheduledWrites()
  const current = assignCache(freshSave())
  if (options?.clearOwner !== false) {
    setSaveOwnerId(null)
  }
  const s = storage()
  if (s) {
    try {
      s.removeItem(KEY)
    } catch {
      /* blocked — fresh in-memory save still returned */
    }
  }
  if (options?.syncCloud === true) {
    cloudSyncHandler?.(cloneSave(current), true)
  }
  gameBus.emit('state:best', { best: 0 })
  gameBus.emit('state:save', { best: 0 })
  return current
}

/** Record lifetime discovery; collectible themes identify characters, variant ids their palettes.
 * Without a theme, preserve the legacy numeric variant key. */
export function recordDiscovery(tier: number, variantId: number | null, theme?: string | null): void {
  const save = loadSave()
  const now = Date.now()
  if (save.discovered[String(tier)] == null) save.discovered[String(tier)] = now
  if (variantId != null) {
    const k = tier >= 9 && tier <= 12 && theme != null
      ? collectibleDiscoveryKey(tier, theme, variantId)
      : `${tier}:${variantId}`
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

/** A run genuinely started (first ball dropped): increment lifetime runs count and flush immediately. */
export function recordRunStart(): void {
  const save = loadSave()
  save.stats.runs++
  if (save.stats.bestTier < 1) save.stats.bestTier = 1
  writeNow(true)
}

/** One merge happened (lifetime stat). */
export function recordMerge(tier: number, currentRunScore = 0): void {
  const save = loadSave()
  save.stats.merges++
  if (tier > save.stats.bestTier) save.stats.bestTier = tier
  if (currentRunScore > save.best) save.best = currentRunScore
  writeSoon()
}

/** A run ended (game over or restart/leave): leaderboard entry + best-score bookkeeping. */
export function recordRunEnd(
  score: number,
  bestTier: number,
  alreadyCountedRun = false,
): number {
  const save = loadSave()
  const now = Date.now()
  if (!alreadyCountedRun) save.stats.runs++
  if (score > save.best) save.best = score
  if (bestTier > save.stats.bestTier) save.stats.bestTier = bestTier
  for (let t = 1; t <= Math.min(12, bestTier); t++) {
    if (save.discovered[String(t)] == null) save.discovered[String(t)] = now
  }
  if (score > 0 || save.leaderboard.length === 0) {
    save.leaderboard.push({ score, bestTier, at: now })
    save.leaderboard.sort((a, b) => b.score - a.score || b.at - a.at)
    save.leaderboard = save.leaderboard.slice(0, MAX_LEADERBOARD)
  }
  writeNow(true)
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
