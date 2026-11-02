import { supabase } from '../lib/supabase'
import { authService } from './auth'
import type { SaveDataV1 } from '../game/state/save'
export interface BossProfileRow {
  id: string
  username: string | null
  display_name: string | null
  email: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  last_sign_in_at?: string | null
}

export interface BossScoreRow {
  id: number
  user_id: string
  score: number
  tier_reached: number
  balls_merged: number
  duration_ms: number
  created_at: string
}

export interface BossUserProgressRow {
  user_id: string
  best_score: number
  discovered: Record<string, number>
  variants: Record<string, number>
  stats: {
    runs: number
    merges: number
    bestTier: number
  }
  leaderboard: Array<{
    score: number
    bestTier: number
    at: number
  }>
  settings: {
    theme: SaveDataV1['settings']['theme']
  }
  updated_at: string
}

export interface BossGuestProfileRow {
  guest_id: string
  best_score: number
  discovered: Record<string, number>
  variants: Record<string, number>
  stats: {
    runs: number
    merges: number
    bestTier: number
  }
  leaderboard: Array<{
    score: number
    bestTier: number
    at: number
  }>
  settings: {
    theme: SaveDataV1['settings']['theme']
  }
  converted_user_id: string | null
  converted_at: string | null
  created_at: string
  updated_at: string
  last_seen_at: string
}

export interface BossGuestScoreRow {
  id: number
  guest_id: string
  score: number
  tier_reached: number
  balls_merged: number
  duration_ms: number
  created_at: string
}

export interface BossPlayerRecord {
  id: string
  username: string
  displayName: string
  email: string
  isGuest?: boolean
  convertedUserId?: string | null
  convertedUsername?: string | null
  convertedAt?: string | null
  createdAt: string
  updatedAt: string
  lastSignInAt: string | null
  bestScore: number
  careerRuns: number
  recordedRuns: number
  totalMerges: number
  bestTier: number
  avgScore: number
  avgMerges: number
  avgDurationMs: number
  totalDurationMs: number
  scorePerMerge: number
  discoveredTiers: number[]
  variantKeys: string[]
  theme: string
  runs: BossScoreRow[]
}

export interface BossRunEnriched extends BossScoreRow {
  username: string
  displayName: string
  email: string
  isGuest?: boolean
  scorePerMerge: number
  mergesPerMinute: number | null
}

export interface BossDailyBucket {
  dateKey: string
  label: string
  runs: number
  activePlayers: number
  peakScore: number
  avgScore: number
  totalMerges: number
}

export interface BossTierStat {
  tier: number
  runsEndedHere: number
  runsReachedAtLeast: number
  playersUnlocked: number
  runSharePct: number
  playerUnlockPct: number
}

export interface BossScoreBucket {
  label: string
  min: number
  max: number
  count: number
  pct: number
}

export interface BossAnalyticsSummary {
  generatedAt: string
  totalPlayers: number
  activePlayers: number
  newPlayers24h: number
  newPlayers7d: number
  totalGuests: number
  activeGuests: number
  newGuests24h: number
  newGuests7d: number
  convertedGuests: number
  guestConversionPct: number
  totalGuestRecordedRuns: number
  totalGuestCareerRuns: number
  guestRuns24h: number
  guestRuns7d: number
  totalRecordedRuns: number
  totalCareerRuns: number
  runs24h: number
  runs7d: number
  allTimeHighScore: number
  allTimeHighHolder: string
  avgRunScore: number
  medianRunScore: number
  p90RunScore: number
  totalBallsMerged: number
  avgMergesPerRun: number
  maxMergesSingleRun: number
  avgScorePerMerge: number
  peakTierOverall: number
  avgTierPerRun: number
  collectibleReachPlayers: number
  collectibleReachPct: number
  totalDurationMs: number
  avgDurationMs: number
  dailySeries: BossDailyBucket[]
  tierStats: BossTierStat[]
  scoreDistribution: BossScoreBucket[]
  themeBreakdown: Array<{ theme: string; count: number; pct: number }>
  variantBreakdown: Array<{ key: string; count: number }>
  players: BossPlayerRecord[]
  guests: BossPlayerRecord[]
  runs: BossRunEnriched[]
  guestRuns: BossRunEnriched[]
  allRuns: BossRunEnriched[]
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 !== 0) return sorted[mid] ?? 0
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx] ?? 0
}

export function buildBossAnalytics(
  profiles: BossProfileRow[],
  scores: BossScoreRow[],
  progressRows: BossUserProgressRow[],
  generatedAt = new Date().toISOString(),
  guestProfiles: BossGuestProfileRow[] = [],
  guestScores: BossGuestScoreRow[] = [],
): BossAnalyticsSummary {
  const progressByUser = new Map<string, BossUserProgressRow>()
  for (const row of progressRows) {
    progressByUser.set(row.user_id, row)
  }

  const runsByUser = new Map<string, BossScoreRow[]>()
  for (const s of scores) {
    const list = runsByUser.get(s.user_id) ?? []
    list.push(s)
    runsByUser.set(s.user_id, list)
  }

  const profileMap = new Map<string, BossProfileRow>()
  for (const p of profiles) {
    profileMap.set(p.id, p)
  }

  // Ensure any user_id referenced in scores/progress without a profile row is still represented
  for (const s of scores) {
    if (!profileMap.has(s.user_id)) {
      profileMap.set(s.user_id, {
        id: s.user_id,
        username: s.user_id.slice(0, 8),
        display_name: `Player ${s.user_id.slice(0, 6)}`,
        email: null,
        avatar_url: null,
        created_at: s.created_at,
        updated_at: s.created_at,
        last_sign_in_at: null,
      })
    }
  }

  const players: BossPlayerRecord[] = []
  const themeCounts = new Map<string, number>()
  const variantCounts = new Map<string, number>()

  for (const profile of profileMap.values()) {
    const userRuns = (runsByUser.get(profile.id) ?? []).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )
    const prog = progressByUser.get(profile.id)

    const maxScoreFromRuns = userRuns.reduce((m, r) => Math.max(m, r.score), 0)
    const maxTierFromRuns = userRuns.reduce((m, r) => Math.max(m, r.tier_reached), 0)
    const mergesFromRuns = userRuns.reduce((sum, r) => sum + (r.balls_merged || 0), 0)
    const durationFromRuns = userRuns.reduce((sum, r) => sum + Math.max(0, r.duration_ms || 0), 0)
    const runsWithDuration = userRuns.filter((r) => (r.duration_ms || 0) > 0)

    const bestScore = Math.max(maxScoreFromRuns, prog?.best_score ?? 0)
    const careerRuns = Math.max(userRuns.length, prog?.stats?.runs ?? 0)
    const totalMerges = Math.max(mergesFromRuns, prog?.stats?.merges ?? 0)
    const bestTier = Math.max(maxTierFromRuns, prog?.stats?.bestTier ?? 0)

    const discoveredSet = new Set<number>([1, 2, 3])
    if (prog?.discovered) {
      for (const k of Object.keys(prog.discovered)) {
        const t = Number(k)
        if (Number.isInteger(t) && t >= 1 && t <= 12) discoveredSet.add(t)
      }
    }
    for (let t = 1; t <= Math.min(12, bestTier); t++) {
      discoveredSet.add(t)
    }
    const discoveredTiers = [...discoveredSet].sort((a, b) => a - b)

    const variantKeys = prog?.variants ? Object.keys(prog.variants).sort() : []
    for (const vk of variantKeys) {
      variantCounts.set(vk, (variantCounts.get(vk) ?? 0) + 1)
    }

    const theme = prog?.settings?.theme ?? 'auto'
    themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1)

    const totalRunScore = userRuns.reduce((sum, r) => sum + r.score, 0)
    const avgScore =
      userRuns.length > 0 ? Math.round(totalRunScore / userRuns.length) : bestScore
    const avgMerges =
      userRuns.length > 0
        ? Math.round(mergesFromRuns / userRuns.length)
        : careerRuns > 0
          ? Math.round(totalMerges / careerRuns)
          : 0
    const avgDurationMs =
      runsWithDuration.length > 0
        ? Math.round(durationFromRuns / runsWithDuration.length)
        : 0

    players.push({
      id: profile.id,
      username: profile.username || profile.display_name || 'anonymous',
      displayName: profile.display_name || profile.username || 'Anonymous',
      email: profile.email || '—',
      isGuest: false,
      createdAt: profile.created_at,
      updatedAt: prog?.updated_at || profile.updated_at,
      lastSignInAt: profile.last_sign_in_at ?? null,
      bestScore,
      careerRuns,
      recordedRuns: userRuns.length,
      totalMerges,
      bestTier,
      avgScore,
      avgMerges,
      avgDurationMs,
      totalDurationMs: durationFromRuns,
      scorePerMerge: totalMerges > 0 ? Math.round((bestScore / totalMerges) * 10) / 10 : 0,
      discoveredTiers,
      variantKeys,
      theme,
      runs: userRuns,
    })
  }

  players.sort((a, b) => b.bestScore - a.bestScore || b.careerRuns - a.careerRuns)

  const playerLookup = new Map<string, BossPlayerRecord>()
  for (const p of players) playerLookup.set(p.id, p)

  const runs: BossRunEnriched[] = scores
    .map((s) => {
      const p = playerLookup.get(s.user_id)
      const scorePerMerge =
        s.balls_merged > 0 ? Math.round((s.score / s.balls_merged) * 10) / 10 : 0
      const mergesPerMinute =
        s.duration_ms >= 5000
          ? Math.round((s.balls_merged / (s.duration_ms / 60000)) * 10) / 10
          : null
      return {
        ...s,
        username: p?.username ?? s.user_id.slice(0, 8),
        displayName: p?.displayName ?? 'Anonymous',
        email: p?.email ?? '—',
        isGuest: false,
        scorePerMerge,
        mergesPerMinute,
      }
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

  // Build Guest Players & Guest Runs
  const guestRunsByGuest = new Map<string, BossScoreRow[]>()
  for (const gs of guestScores) {
    const list = guestRunsByGuest.get(gs.guest_id) ?? []
    list.push({
      id: gs.id,
      user_id: gs.guest_id,
      score: gs.score,
      tier_reached: gs.tier_reached,
      balls_merged: gs.balls_merged,
      duration_ms: gs.duration_ms,
      created_at: gs.created_at,
    })
    guestRunsByGuest.set(gs.guest_id, list)
  }

  const guestProfileMap = new Map<string, BossGuestProfileRow>()
  for (const gp of guestProfiles) {
    guestProfileMap.set(gp.guest_id, gp)
  }
  for (const gs of guestScores) {
    if (!guestProfileMap.has(gs.guest_id)) {
      guestProfileMap.set(gs.guest_id, {
        guest_id: gs.guest_id,
        best_score: gs.score,
        discovered: {},
        variants: {},
        stats: { runs: 1, merges: gs.balls_merged, bestTier: gs.tier_reached },
        leaderboard: [],
        settings: { theme: 'auto' },
        converted_user_id: null,
        converted_at: null,
        created_at: gs.created_at,
        updated_at: gs.created_at,
        last_seen_at: gs.created_at,
      })
    }
  }

  const guests: BossPlayerRecord[] = []
  const synthesizedGuestScores: BossGuestScoreRow[] = [...guestScores]
  let syntheticIdCounter = -1

  for (const gp of guestProfileMap.values()) {
    let gRuns = (guestRunsByGuest.get(gp.guest_id) ?? []).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )

    // If a guest has recorded local leaderboard entries or career stats in guest_profiles
    // before individual guest_scores rows were logged, synthesize run entries so Runs tab & charts show them.
    if (gRuns.length === 0) {
      const lb = Array.isArray(gp.leaderboard) ? gp.leaderboard : []
      if (lb.length > 0) {
        for (const item of lb) {
          if (!item || typeof item.score !== 'number') continue
          const createdIso =
            typeof item.at === 'number' && item.at > 0
              ? new Date(item.at).toISOString()
              : gp.last_seen_at || gp.updated_at || gp.created_at
          const synRow: BossScoreRow = {
            id: syntheticIdCounter--,
            user_id: gp.guest_id,
            score: Math.max(0, Math.round(item.score)),
            tier_reached: Math.max(1, Math.min(12, Math.round(item.bestTier || gp.stats?.bestTier || 1))),
            balls_merged: lb.length === 1 ? Math.max(0, gp.stats?.merges ?? 0) : 0,
            duration_ms: 0,
            created_at: createdIso,
          }
          gRuns.push(synRow)
          synthesizedGuestScores.push({
            id: synRow.id,
            guest_id: gp.guest_id,
            score: synRow.score,
            tier_reached: synRow.tier_reached,
            balls_merged: synRow.balls_merged,
            duration_ms: synRow.duration_ms,
            created_at: synRow.created_at,
          })
        }
        gRuns = gRuns.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        guestRunsByGuest.set(gp.guest_id, gRuns)
      } else if ((gp.stats?.runs ?? 0) > 0 || (gp.best_score ?? 0) > 0) {
        const synRow: BossScoreRow = {
          id: syntheticIdCounter--,
          user_id: gp.guest_id,
          score: Math.max(0, gp.best_score ?? 0),
          tier_reached: Math.max(1, Math.min(12, gp.stats?.bestTier || 1)),
          balls_merged: Math.max(0, gp.stats?.merges ?? 0),
          duration_ms: 0,
          created_at: gp.last_seen_at || gp.updated_at || gp.created_at,
        }
        gRuns = [synRow]
        guestRunsByGuest.set(gp.guest_id, gRuns)
        synthesizedGuestScores.push({
          id: synRow.id,
          guest_id: gp.guest_id,
          score: synRow.score,
          tier_reached: synRow.tier_reached,
          balls_merged: synRow.balls_merged,
          duration_ms: synRow.duration_ms,
          created_at: synRow.created_at,
        })
      }
    }

    const maxScoreFromRuns = gRuns.reduce((m, r) => Math.max(m, r.score), 0)
    const maxTierFromRuns = gRuns.reduce((m, r) => Math.max(m, r.tier_reached), 0)
    const mergesFromRuns = gRuns.reduce((sum, r) => sum + (r.balls_merged || 0), 0)
    const durationFromRuns = gRuns.reduce((sum, r) => sum + Math.max(0, r.duration_ms || 0), 0)
    const runsWithDuration = gRuns.filter((r) => (r.duration_ms || 0) > 0)

    const bestScore = Math.max(maxScoreFromRuns, gp.best_score ?? 0)
    const careerRuns = Math.max(gRuns.length, gp.stats?.runs ?? 0)
    const totalMerges = Math.max(mergesFromRuns, gp.stats?.merges ?? 0)
    const bestTier = Math.max(maxTierFromRuns, gp.stats?.bestTier ?? 0)
    const discoveredSet = new Set<number>([1, 2, 3])
    if (gp.discovered) {
      for (const k of Object.keys(gp.discovered)) {
        const t = Number(k)
        if (Number.isInteger(t) && t >= 1 && t <= 12) discoveredSet.add(t)
      }
    }
    for (let t = 1; t <= Math.min(12, bestTier); t++) {
      discoveredSet.add(t)
    }
    const discoveredTiers = [...discoveredSet].sort((a, b) => a - b)
    const variantKeys = gp.variants ? Object.keys(gp.variants).sort() : []
    const theme = gp.settings?.theme ?? 'auto'

    const totalRunScore = gRuns.reduce((sum, r) => sum + r.score, 0)
    const avgScore = gRuns.length > 0 ? Math.round(totalRunScore / gRuns.length) : bestScore
    const avgMerges =
      gRuns.length > 0
        ? Math.round(mergesFromRuns / gRuns.length)
        : careerRuns > 0
          ? Math.round(totalMerges / careerRuns)
          : 0
    const avgDurationMs =
      runsWithDuration.length > 0
        ? Math.round(durationFromRuns / runsWithDuration.length)
        : 0

    const shortId = gp.guest_id.slice(0, 6)
    const convertedPlayer = gp.converted_user_id
      ? playerLookup.get(gp.converted_user_id)
      : undefined

    guests.push({
      id: gp.guest_id,
      username: `guest_${shortId}`,
      displayName: `Guest #${shortId}`,
      email: convertedPlayer ? `Converted → @${convertedPlayer.username}` : 'Anonymous Guest',
      isGuest: true,
      convertedUserId: gp.converted_user_id,
      convertedUsername: convertedPlayer?.username ?? null,
      convertedAt: gp.converted_at,
      createdAt: gp.created_at,
      updatedAt: gp.updated_at,
      lastSignInAt: gp.last_seen_at,
      bestScore,
      careerRuns,
      recordedRuns: gRuns.length,
      totalMerges,
      bestTier,
      avgScore,
      avgMerges,
      avgDurationMs,
      totalDurationMs: durationFromRuns,
      scorePerMerge: totalMerges > 0 ? Math.round((bestScore / totalMerges) * 10) / 10 : 0,
      discoveredTiers,
      variantKeys,
      theme,
      runs: gRuns,
    })
  }

  guests.sort((a, b) => b.bestScore - a.bestScore || b.careerRuns - a.careerRuns)

  const guestLookup = new Map<string, BossPlayerRecord>()
  for (const g of guests) guestLookup.set(g.id, g)

  const guestRuns: BossRunEnriched[] = synthesizedGuestScores
    .map((gs) => {
      const g = guestLookup.get(gs.guest_id)
      const scorePerMerge =
        gs.balls_merged > 0 ? Math.round((gs.score / gs.balls_merged) * 10) / 10 : 0
      const mergesPerMinute =
        gs.duration_ms >= 5000
          ? Math.round((gs.balls_merged / (gs.duration_ms / 60000)) * 10) / 10
          : null
      return {
        id: gs.id,
        user_id: gs.guest_id,
        score: gs.score,
        tier_reached: gs.tier_reached,
        balls_merged: gs.balls_merged,
        duration_ms: gs.duration_ms,
        created_at: gs.created_at,
        username: g?.username ?? `guest_${gs.guest_id.slice(0, 6)}`,
        displayName: g?.displayName ?? `Guest #${gs.guest_id.slice(0, 6)}`,
        email: g?.email ?? 'Anonymous Guest',
        isGuest: true,
        scorePerMerge,
        mergesPerMinute,
      }
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

  const allRuns: BossRunEnriched[] = [...runs, ...guestRuns].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )
  const nowMs = Date.now()
  const dayMs = 86_400_000
  const newPlayers24h = players.filter((p) => nowMs - Date.parse(p.createdAt) <= dayMs).length
  const newPlayers7d = players.filter((p) => nowMs - Date.parse(p.createdAt) <= 7 * dayMs).length
  const runs24h = allRuns.filter((r) => nowMs - Date.parse(r.created_at) <= dayMs).length
  const runs7d = allRuns.filter((r) => nowMs - Date.parse(r.created_at) <= 7 * dayMs).length

  const activePlayers = players.filter((p) => p.careerRuns > 0 || p.bestScore > 0).length
  const unlinkedGuests = guests.filter((g) => !g.convertedUserId)
  const totalCareerRuns =
    players.reduce((sum, p) => sum + p.careerRuns, 0) +
    unlinkedGuests.reduce((sum, g) => sum + g.careerRuns, 0)
  const totalBallsMerged =
    players.reduce((sum, p) => sum + p.totalMerges, 0) +
    unlinkedGuests.reduce((sum, g) => sum + g.totalMerges, 0)
  const totalGuests = guests.length
  const activeGuests = guests.filter((g) => g.careerRuns > 0 || g.bestScore > 0).length
  const newGuests24h = guests.filter((g) => nowMs - Date.parse(g.createdAt) <= dayMs).length
  const newGuests7d = guests.filter((g) => nowMs - Date.parse(g.createdAt) <= 7 * dayMs).length
  const convertedGuests = guests.filter((g) => Boolean(g.convertedUserId)).length
  const guestConversionPct =
    totalGuests > 0 ? Math.round((convertedGuests / totalGuests) * 100) : 0
  const totalGuestRecordedRuns = guestRuns.length
  const totalGuestCareerRuns = guests.reduce((sum, g) => sum + g.careerRuns, 0)
  const guestRuns24h = guestRuns.filter((r) => nowMs - Date.parse(r.created_at) <= dayMs).length
  const guestRuns7d = guestRuns.filter((r) => nowMs - Date.parse(r.created_at) <= 7 * dayMs).length

  const allCandidates = [...players, ...guests].sort(
    (a, b) => b.bestScore - a.bestScore || b.careerRuns - a.careerRuns,
  )
  const topPlayer = allCandidates[0]
  const allTimeHighScore = topPlayer?.bestScore ?? 0
  const allTimeHighHolder = topPlayer && topPlayer.bestScore > 0 ? topPlayer.displayName : '—'
  const runScores = allRuns.map((r) => r.score)
  const avgRunScore =
    runScores.length > 0
      ? Math.round(runScores.reduce((a, b) => a + b, 0) / runScores.length)
      : 0
  const medianRunScore = median(runScores)
  const p90RunScore = percentile(runScores, 90)

  const avgMergesPerRun =
    allRuns.length > 0
      ? Math.round(allRuns.reduce((s, r) => s + r.balls_merged, 0) / allRuns.length)
      : 0
  const maxMergesSingleRun = allRuns.reduce((m, r) => Math.max(m, r.balls_merged), 0)
  const totalRunScoreSum = allRuns.reduce((s, r) => s + r.score, 0)
  const totalRunMergeSum = allRuns.reduce((s, r) => s + r.balls_merged, 0)
  const avgScorePerMerge =
    totalRunMergeSum > 0 ? Math.round((totalRunScoreSum / totalRunMergeSum) * 10) / 10 : 0

  const peakTierOverall = allCandidates.reduce((m, p) => Math.max(m, p.bestTier), 0)
  const avgTierPerRun =
    allRuns.length > 0
      ? Math.round((allRuns.reduce((s, r) => s + r.tier_reached, 0) / allRuns.length) * 10) / 10
      : 0

  const collectibleReachPlayers = players.filter((p) => p.bestTier >= 9).length
  const collectibleReachPct =
    players.length > 0 ? Math.round((collectibleReachPlayers / players.length) * 100) : 0

  const validDurationRuns = allRuns.filter((r) => r.duration_ms > 0)
  const totalDurationMs = validDurationRuns.reduce((s, r) => s + r.duration_ms, 0)
  const avgDurationMs =
    validDurationRuns.length > 0 ? Math.round(totalDurationMs / validDurationRuns.length) : 0
  // 14-day daily activity series
  const dailySeries: BossDailyBucket[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(nowMs - i * dayMs)
    const dateKey = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const dayRuns = allRuns.filter((r) => r.created_at.slice(0, 10) === dateKey)
    const uniqueUsers = new Set(dayRuns.map((r) => r.user_id))
    const peakScore = dayRuns.reduce((m, r) => Math.max(m, r.score), 0)
    const avgScore =
      dayRuns.length > 0
        ? Math.round(dayRuns.reduce((s, r) => s + r.score, 0) / dayRuns.length)
        : 0
    const totalMerges = dayRuns.reduce((s, r) => s + r.balls_merged, 0)
    dailySeries.push({
      dateKey,
      label,
      runs: dayRuns.length,
      activePlayers: uniqueUsers.size,
      peakScore,
      avgScore,
      totalMerges,
    })
  }

  // Tier 1..12 stats
  const tierStats: BossTierStat[] = []
  for (let tier = 1; tier <= 12; tier++) {
    const runsEndedHere = allRuns.filter((r) => r.tier_reached === tier).length
    const runsReachedAtLeast = allRuns.filter((r) => r.tier_reached >= tier).length
    const playersUnlocked = players.filter((p) => p.discoveredTiers.includes(tier)).length
    tierStats.push({
      tier,
      runsEndedHere,
      runsReachedAtLeast,
      playersUnlocked,
      runSharePct: allRuns.length > 0 ? Math.round((runsEndedHere / allRuns.length) * 100) : 0,
      playerUnlockPct:
        players.length > 0 ? Math.round((playersUnlocked / players.length) * 100) : 0,
    })
  }

  // Score distribution buckets
  const bucketDefs = [
    { label: '0 – 999', min: 0, max: 999 },
    { label: '1k – 4.9k', min: 1000, max: 4999 },
    { label: '5k – 9.9k', min: 5000, max: 9999 },
    { label: '10k – 14.9k', min: 10000, max: 14999 },
    { label: '15k – 19.9k', min: 15000, max: 19999 },
    { label: '20k+', min: 20000, max: Number.POSITIVE_INFINITY },
  ]
  const scoreDistribution: BossScoreBucket[] = bucketDefs.map((b) => {
    const count = allRuns.filter((r) => r.score >= b.min && r.score <= b.max).length
    return {
      ...b,
      count,
      pct: allRuns.length > 0 ? Math.round((count / allRuns.length) * 100) : 0,
    }
  })

  const themeBreakdown = [...themeCounts.entries()]
    .map(([theme, count]) => ({
      theme,
      count,
      pct: players.length > 0 ? Math.round((count / players.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const variantBreakdown = [...variantCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

  return {
    generatedAt,
    totalPlayers: players.length,
    activePlayers,
    newPlayers24h,
    newPlayers7d,
    totalGuests,
    activeGuests,
    newGuests24h,
    newGuests7d,
    convertedGuests,
    guestConversionPct,
    totalGuestRecordedRuns,
    totalGuestCareerRuns,
    guestRuns24h,
    guestRuns7d,
    totalRecordedRuns: allRuns.length,
    totalCareerRuns,
    runs24h,
    runs7d,
    allTimeHighScore,
    allTimeHighHolder,
    avgRunScore,
    medianRunScore,
    p90RunScore,
    totalBallsMerged,
    avgMergesPerRun,
    maxMergesSingleRun,
    avgScorePerMerge,
    peakTierOverall,
    avgTierPerRun,
    collectibleReachPlayers,
    collectibleReachPct,
    totalDurationMs,
    avgDurationMs,
    dailySeries,
    tierStats,
    scoreDistribution,
    themeBreakdown,
    variantBreakdown,
    players,
    guests,
    runs,
    guestRuns,
    allRuns,
  }
}

export class BossService {
  async fetchDashboard(): Promise<BossAnalyticsSummary> {
    const { data, error } = await supabase.rpc('boss_get_dashboard_data')

    if (!error && data && typeof data === 'object') {
      const payload = data as {
        profiles?: BossProfileRow[]
        scores?: BossScoreRow[]
        progress?: BossUserProgressRow[]
        guest_profiles?: BossGuestProfileRow[]
        guest_scores?: BossGuestScoreRow[]
        generated_at?: string
      }
      return buildBossAnalytics(
        payload.profiles ?? [],
        payload.scores ?? [],
        payload.progress ?? [],
        payload.generated_at ?? new Date().toISOString(),
        payload.guest_profiles ?? [],
        payload.guest_scores ?? [],
      )
    }

    // Fallback to direct table queries if RPC is unavailable
    const [profilesRes, scoresRes, progressRes, guestProfilesRes, guestScoresRes] =
      await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('scores').select('*').order('created_at', { ascending: false }),
        supabase.from('user_progress').select('*'),
        supabase.from('guest_profiles').select('*').order('last_seen_at', { ascending: false }),
        supabase.from('guest_scores').select('*').order('created_at', { ascending: false }),
      ])

    if (profilesRes.error) throw new Error(profilesRes.error.message)
    if (scoresRes.error) throw new Error(scoresRes.error.message)

    return buildBossAnalytics(
      (profilesRes.data as BossProfileRow[]) ?? [],
      (scoresRes.data as BossScoreRow[]) ?? [],
      (progressRes.data as BossUserProgressRow[]) ?? [],
      new Date().toISOString(),
      (guestProfilesRes.data as BossGuestProfileRow[]) ?? [],
      (guestScoresRes.data as BossGuestScoreRow[]) ?? [],
    )
  }

  private async refreshLocalIfCurrentUser(targetUserId?: string): Promise<void> {
    const currentUser = authService.getUser()
    if (!currentUser) return
    if (!targetUserId || currentUser.id === targetUserId) {
      await authService.restoreAccountProgress()
    }
  }

  async updateScore(
    scoreId: number,
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<void> {
    const { error } = await supabase.rpc('boss_update_score', {
      target_score_id: scoreId,
      new_score: Math.max(0, Math.round(score)),
      new_tier: Math.max(1, Math.min(12, Math.round(tierReached))),
      new_merges: Math.max(0, Math.round(ballsMerged)),
      new_duration_ms: Math.max(0, Math.round(durationMs)),
    })
    if (error) throw new Error(error.message)
    await this.refreshLocalIfCurrentUser()
  }

  async createScore(
    userId: string,
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<number> {
    const { data, error } = await supabase.rpc('boss_create_score', {
      target_user_id: userId,
      new_score: Math.max(0, Math.round(score)),
      new_tier: Math.max(1, Math.min(12, Math.round(tierReached))),
      new_merges: Math.max(0, Math.round(ballsMerged)),
      new_duration_ms: Math.max(0, Math.round(durationMs)),
    })
    if (error) throw new Error(error.message)
    await this.refreshLocalIfCurrentUser(userId)
    return Number(data)
  }

  async deleteScore(scoreId: number): Promise<void> {
    const { error } = await supabase.rpc('boss_delete_score', {
      target_score_id: scoreId,
    })
    if (error) throw new Error(error.message)
    await this.refreshLocalIfCurrentUser()
  }

  async updateUser(params: {
    userId: string
    username: string
    displayName: string
    bestScore: number
    runs: number
    merges: number
    bestTier: number
  }): Promise<void> {
    const { error } = await supabase.rpc('boss_update_user', {
      target_user_id: params.userId,
      new_username: params.username.trim(),
      new_display_name: params.displayName.trim(),
      new_best_score: Math.max(0, Math.round(params.bestScore)),
      new_runs: Math.max(0, Math.round(params.runs)),
      new_merges: Math.max(0, Math.round(params.merges)),
      new_best_tier: Math.max(0, Math.min(12, Math.round(params.bestTier))),
    })
    if (error) throw new Error(error.message)
    await this.refreshLocalIfCurrentUser(params.userId)
  }

  async resetUserProgress(userId: string): Promise<void> {
    const { error } = await supabase.rpc('boss_reset_user_progress', {
      target_user_id: userId,
    })
    if (error) throw new Error(error.message)
    await this.refreshLocalIfCurrentUser(userId)
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await supabase.rpc('boss_delete_user', {
      target_user_id: userId,
    })
    if (error) throw new Error(error.message)
  }

  async updateGuestScore(
    scoreId: number,
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<void> {
    const { error } = await supabase.rpc('boss_update_guest_score', {
      target_score_id: scoreId,
      new_score: Math.max(0, Math.round(score)),
      new_tier: Math.max(1, Math.min(12, Math.round(tierReached))),
      new_merges: Math.max(0, Math.round(ballsMerged)),
      new_duration_ms: Math.max(0, Math.round(durationMs)),
    })
    if (error) throw new Error(error.message)
  }

  async createGuestScore(
    guestId: string,
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<number> {
    const { data, error } = await supabase.rpc('boss_create_guest_score', {
      target_guest_id: guestId,
      new_score: Math.max(0, Math.round(score)),
      new_tier: Math.max(1, Math.min(12, Math.round(tierReached))),
      new_merges: Math.max(0, Math.round(ballsMerged)),
      new_duration_ms: Math.max(0, Math.round(durationMs)),
    })
    if (error) throw new Error(error.message)
    return Number(data)
  }

  async deleteGuestScore(scoreId: number): Promise<void> {
    const { error } = await supabase.rpc('boss_delete_guest_score', {
      target_score_id: scoreId,
    })
    if (error) throw new Error(error.message)
  }

  async updateGuest(params: {
    guestId: string
    bestScore: number
    runs: number
    merges: number
    bestTier: number
  }): Promise<void> {
    const { error } = await supabase.rpc('boss_update_guest', {
      target_guest_id: params.guestId,
      new_best_score: Math.max(0, Math.round(params.bestScore)),
      new_runs: Math.max(0, Math.round(params.runs)),
      new_merges: Math.max(0, Math.round(params.merges)),
      new_best_tier: Math.max(0, Math.min(12, Math.round(params.bestTier))),
    })
    if (error) throw new Error(error.message)
  }

  async resetGuestProgress(guestId: string): Promise<void> {
    const { error } = await supabase.rpc('boss_reset_guest_progress', {
      target_guest_id: guestId,
    })
    if (error) throw new Error(error.message)
  }

  async deleteGuest(guestId: string): Promise<void> {
    const { error } = await supabase.rpc('boss_delete_guest', {
      target_guest_id: guestId,
    })
    if (error) throw new Error(error.message)
  }
}

export const bossService = new BossService()
