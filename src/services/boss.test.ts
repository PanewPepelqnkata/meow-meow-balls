import { describe, expect, it } from 'vitest'
import {
  buildBossAnalytics,
  type BossGuestProfileRow,
  type BossGuestScoreRow,
  type BossProfileRow,
  type BossScoreRow,
  type BossUserProgressRow,
} from './boss'

describe('buildBossAnalytics', () => {
  const nowIso = '2026-11-02T21:00:00.000Z'

  const profiles: BossProfileRow[] = [
    {
      id: 'u1',
      username: 'paneww',
      display_name: 'Paneww',
      email: 'paneww@example.com',
      avatar_url: null,
      created_at: '2026-11-02T15:30:00.000Z',
      updated_at: '2026-11-02T15:30:00.000Z',
      last_sign_in_at: '2026-11-02T20:00:00.000Z',
    },
    {
      id: 'u2',
      username: 'gopeto',
      display_name: 'Gopeto',
      email: 'gopeto@example.com',
      avatar_url: null,
      created_at: '2026-10-20T12:00:00.000Z',
      updated_at: '2026-10-20T12:00:00.000Z',
      last_sign_in_at: '2026-11-02T19:00:00.000Z',
    },
  ]

  const scores: BossScoreRow[] = [
    {
      id: 1,
      user_id: 'u1',
      score: 20512,
      tier_reached: 9,
      balls_merged: 450,
      duration_ms: 120000,
      interruption_reason: null,
      created_at: '2026-11-02T19:30:00.000Z',
    },
    {
      id: 2,
      user_id: 'u1',
      score: 1772,
      tier_reached: 7,
      balls_merged: 31,
      duration_ms: 60000,
      interruption_reason: null,
      created_at: '2026-11-02T16:40:00.000Z',
    },
    {
      id: 3,
      user_id: 'u2',
      score: 17444,
      tier_reached: 9,
      balls_merged: 2866,
      duration_ms: 240000,
      interruption_reason: null,
      created_at: '2026-11-02T20:09:00.000Z',
    },
  ]

  const progressRows: BossUserProgressRow[] = [
    {
      user_id: 'u1',
      best_score: 20512,
      coins: 12.5,
      discovered: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1 },
      variants: { '9:1': 1 },
      stats: { runs: 2, merges: 481, bestTier: 9 },
      leaderboard: [],
      settings: { theme: 'auto' },
      updated_at: '2026-11-02T19:30:00.000Z',
    },
    {
      user_id: 'u2',
      best_score: 17444,
      discovered: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1 },
      variants: { '9:2': 1 },
      stats: { runs: 1, merges: 2866, bestTier: 9 },
      leaderboard: [],
      settings: { theme: 'space' },
      updated_at: '2026-11-02T20:09:00.000Z',
    },
  ]

  it('computes accurate KPIs, tier funnel, and player summaries', () => {
    const summary = buildBossAnalytics(profiles, scores, progressRows, nowIso)

    expect(summary.totalPlayers).toBe(2)
    expect(summary.newPlayers24h).toBe(1)
    expect(summary.totalRecordedRuns).toBe(3)
    expect(summary.totalCareerRuns).toBe(3)
    expect(summary.runs24h).toBe(3)
    expect(summary.allTimeHighScore).toBe(20512)
    expect(summary.allTimeHighHolder).toBe('Paneww')
    expect(summary.totalBallsMerged).toBe(481 + 2866)
    expect(summary.peakTierOverall).toBe(9)
    expect(summary.collectibleReachPct).toBe(100)

    const tier9Stat = summary.tierStats.find((t) => t.tier === 9)
    expect(tier9Stat?.playersUnlocked).toBe(2)
    expect(tier9Stat?.playerUnlockPct).toBe(100)

    const tier10Stat = summary.tierStats.find((t) => t.tier === 10)
    expect(tier10Stat?.playersUnlocked).toBe(0)

    expect(summary.players[0]?.username).toBe('paneww')
    expect(summary.players[0]?.coins).toBe(12.5)
    expect(summary.players[0]?.bestScore).toBe(20512)
    expect(summary.players[1]?.username).toBe('gopeto')
    expect(summary.players[1]?.bestScore).toBe(17444)

    expect(summary.variantBreakdown).toEqual([
      { key: '9:1', count: 1 },
      { key: '9:2', count: 1 },
    ])
  })

  it('retains per-run collectible identities through registered and guest enrichments', () => {
    const collectibles: NonNullable<BossScoreRow['collectibles']> = [
      { tier: 9, theme: 'pig', variant: 2, discoveredAt: Date.parse('2026-11-02T19:00:00.000Z') },
      { tier: 10, theme: 'crab', variant: 5, discoveredAt: Date.parse('2026-11-02T19:05:00.000Z') },
    ]
    const guestCollectibles = collectibles.map((item) =>
      item.tier === 9 ? { ...item, theme: 'shark' } : item,
    )
    const registeredScore: BossScoreRow = {
      ...scores[0]!,
      tier_reached: 10,
      interruption_reason: 'restart',
      collectibles,
    }
    const guestScore: BossGuestScoreRow = {
      id: 101,
      guest_id: '11111111-1111-4111-8111-111111111111',
      score: 9000,
      tier_reached: 10,
      balls_merged: 300,
      duration_ms: 120000,
      interruption_reason: 'tab-hidden',
      collectibles: guestCollectibles,
      created_at: nowIso,
    }

    const summary = buildBossAnalytics(
      profiles, [registeredScore], progressRows, nowIso, [], [guestScore],
    )

    expect(summary.runs[0]).toMatchObject({
      username: 'paneww',
      displayName: 'Paneww',
      email: 'paneww@example.com',
      isGuest: false,
      scorePerMerge: 45.6,
      mergesPerMinute: 225,
      interruption_reason: 'restart',
      collectibles,
    })
    expect(summary.guestRuns[0]).toMatchObject({
      user_id: guestScore.guest_id,
      username: 'guest_111111',
      displayName: 'Guest #111111',
      email: 'Anonymous Guest',
      isGuest: true,
      scorePerMerge: 30,
      mergesPerMinute: 150,
      interruption_reason: 'tab-hidden',
      collectibles: guestCollectibles,
    })
    expect(summary.players.find((player) => player.id === 'u1')?.runs[0]?.collectibles).toEqual(collectibles)
    expect(summary.guests[0]?.runs[0]?.collectibles).toEqual(guestCollectibles)
    expect(summary.allRuns.find((run) => !run.isGuest)?.collectibles).toEqual(collectibles)
    expect(summary.allRuns.find((run) => run.isGuest)?.collectibles).toEqual(guestCollectibles)
  })

  it('keeps absent, null, and empty snapshots distinct without inferring identities from progress', () => {
    const runStates: BossScoreRow[] = [
      { ...scores[0]!, tier_reached: 12 },
      { ...scores[1]!, tier_reached: 12, collectibles: null },
      { ...scores[2]!, tier_reached: 12, collectibles: [] },
    ]
    const guestStates: BossGuestScoreRow[] = runStates.map(({ user_id, ...run }) => ({
      ...run,
      guest_id: user_id,
    }))
    const knownProgress = progressRows.map((progress) => ({
      ...progress,
      variants: { '9:pig:7': 1, '10:crab:3': 2 },
    }))
    const summary = buildBossAnalytics(profiles, runStates, knownProgress, nowIso, [], guestStates)

    for (const runs of [summary.runs, summary.guestRuns]) {
      expect(runs.find((run) => run.id === 1)?.collectibles).toBeUndefined()
      expect(runs.find((run) => run.id === 2)?.collectibles).toBeNull()
      expect(runs.find((run) => run.id === 3)?.collectibles).toEqual([])
    }
  })

  it('computes guest session telemetry, guest runs, and conversion rate', () => {
    const guestProfiles: BossGuestProfileRow[] = [
      {
        guest_id: '11111111-1111-4111-8111-111111111111',
        best_score: 4200,
        discovered: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1 },
        variants: {},
        stats: { runs: 3, merges: 95, bestTier: 6 },
        leaderboard: [],
        settings: { theme: 'auto' },
        converted_user_id: 'u1',
        converted_at: '2026-11-02T16:00:00.000Z',
        created_at: '2026-11-02T15:00:00.000Z',
        updated_at: '2026-11-02T16:00:00.000Z',
        last_seen_at: '2026-11-02T16:00:00.000Z',
      },
      {
        guest_id: '22222222-2222-4222-8222-222222222222',
        best_score: 1850,
        discovered: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1 },
        variants: {},
        stats: { runs: 1, merges: 40, bestTier: 5 },
        leaderboard: [],
        settings: { theme: 'auto' },
        converted_user_id: null,
        converted_at: null,
        created_at: '2026-11-02T18:00:00.000Z',
        updated_at: '2026-11-02T18:10:00.000Z',
        last_seen_at: '2026-11-02T18:10:00.000Z',
      },
    ]

    const guestScores: BossGuestScoreRow[] = [
      {
        id: 101,
        guest_id: '11111111-1111-4111-8111-111111111111',
        score: 4200,
        tier_reached: 6,
        balls_merged: 60,
        duration_ms: 90000,
        interruption_reason: null,
        created_at: '2026-11-02T15:20:00.000Z',
      },
      {
        id: 102,
        guest_id: '22222222-2222-4222-8222-222222222222',
        score: 1850,
        tier_reached: 5,
        balls_merged: 40,
        duration_ms: 45000,
        interruption_reason: null,
        created_at: '2026-11-02T18:05:00.000Z',
      },
    ]

    const summary = buildBossAnalytics(
      profiles,
      scores,
      progressRows,
      nowIso,
      guestProfiles,
      guestScores,
    )

    expect(summary.totalGuests).toBe(2)
    expect(summary.activeGuests).toBe(2)
    expect(summary.convertedGuests).toBe(1)
    expect(summary.guestConversionPct).toBe(50)
    expect(summary.totalGuestRecordedRuns).toBe(2)
    expect(summary.totalGuestCareerRuns).toBe(4)
    expect(summary.allRuns.length).toBe(5)
    expect(summary.guests[0]?.convertedUsername).toBe('paneww')
    expect(summary.guests[0]?.isGuest).toBe(true)
  })

  it('synthesizes guest runs from guest_profiles leaderboard when guest_scores is empty and includes them in overview metrics', () => {
    const guestProfiles: BossGuestProfileRow[] = [
      {
        guest_id: '33333333-3333-4333-8333-333333333333',
        best_score: 6400,
        discovered: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1 },
        variants: {},
        stats: { runs: 2, merges: 85, bestTier: 7 },
        leaderboard: [
          { score: 6400, bestTier: 7, at: 1762110000000 },
          { score: 3100, bestTier: 5, at: 1762100000000 },
        ],
        settings: { theme: 'auto' },
        converted_user_id: null,
        converted_at: null,
        created_at: '2026-11-02T18:00:00.000Z',
        updated_at: '2026-11-02T19:00:00.000Z',
        last_seen_at: '2026-11-02T19:00:00.000Z',
      },
    ]

    const summary = buildBossAnalytics(
      profiles,
      scores,
      progressRows,
      nowIso,
      guestProfiles,
      [],
    )

    expect(summary.guestRuns.length).toBe(2)
    expect(summary.allRuns.length).toBe(5)
    expect(summary.totalRecordedRuns).toBe(5)
    expect(summary.totalCareerRuns).toBe(3 + 2)
    expect(summary.guestRuns.every((run) => run.collectibles === undefined)).toBe(true)
    expect(summary.guests[0]?.runs.every((run) => run.collectibles === undefined)).toBe(true)
    expect(summary.allRuns.filter((run) => run.isGuest).every((run) => run.collectibles === undefined)).toBe(true)
  })

  it('leaves guest runs synthesized from career stats unrecorded even with known lifetime characters', () => {
    const guestProfile: BossGuestProfileRow = {
      guest_id: '33333333-3333-4333-8333-333333333333',
      best_score: 6400,
      discovered: { '9': 1, '10': 2 },
      variants: { '9:pig:2': 1, '10:crab:5': 2 },
      stats: { runs: 2, merges: 85, bestTier: 10 },
      leaderboard: [],
      settings: { theme: 'space' },
      converted_user_id: null,
      converted_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      last_seen_at: nowIso,
    }

    const summary = buildBossAnalytics([], [], [], nowIso, [guestProfile], [])

    expect(summary.guestRuns).toHaveLength(1)
    expect(summary.guestRuns[0]?.collectibles).toBeUndefined()
    expect(summary.guests[0]?.runs[0]?.collectibles).toBeUndefined()
    expect(summary.allRuns[0]?.collectibles).toBeUndefined()
  })

  it('excludes empty unconverted bounce guest profiles and deduplicates converted guest runs from allRuns and career totals', () => {
    const emptyGuest: BossGuestProfileRow = {
      guest_id: '44444444-4444-4444-8444-444444444444',
      best_score: 0,
      discovered: { '1': 1, '2': 1, '3': 1 },
      variants: {},
      stats: { runs: 0, merges: 0, bestTier: 0 },
      leaderboard: [],
      settings: { theme: 'auto' },
      converted_user_id: null,
      converted_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      last_seen_at: nowIso,
    }
    const convertedGuest: BossGuestProfileRow = {
      guest_id: '55555555-5555-4555-8555-555555555555',
      best_score: 2196,
      discovered: { '1': 1, '2': 1, '3': 1, '8': 2 },
      variants: {},
      stats: { runs: 1, merges: 282, bestTier: 8 },
      leaderboard: [{ score: 2196, bestTier: 8, at: Date.parse('2026-11-02T18:00:00.000Z') }],
      settings: { theme: 'auto' },
      converted_user_id: 'u1',
      converted_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
      last_seen_at: nowIso,
    }
    const linkedUserScore: BossScoreRow = {
      id: 99,
      user_id: 'u1',
      score: 2196,
      tier_reached: 8,
      balls_merged: 282,
      duration_ms: 735000,
      interruption_reason: 'completed',
      created_at: '2026-11-02T18:00:00.000Z',
    }
    const linkedGuestScore: BossGuestScoreRow = {
      id: 199,
      guest_id: '55555555-5555-4555-8555-555555555555',
      score: 2196,
      tier_reached: 8,
      balls_merged: 282,
      duration_ms: 735000,
      interruption_reason: 'completed',
      created_at: '2026-11-02T18:00:00.000Z',
    }

    const summary = buildBossAnalytics(
      [profiles[0]!],
      [linkedUserScore],
      [],
      nowIso,
      [emptyGuest, convertedGuest],
      [linkedGuestScore],
    )

    expect(summary.totalGuests).toBe(1)
    expect(summary.allRuns).toHaveLength(1)
    expect(summary.totalRecordedRuns).toBe(1)
    expect(summary.totalCareerRuns).toBe(1)
    expect(summary.totalBallsMerged).toBe(282)
  })
})
