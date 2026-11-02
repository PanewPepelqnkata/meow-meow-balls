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
      created_at: '2026-11-02T19:30:00.000Z',
    },
    {
      id: 2,
      user_id: 'u1',
      score: 1772,
      tier_reached: 7,
      balls_merged: 31,
      duration_ms: 60000,
      created_at: '2026-11-02T16:40:00.000Z',
    },
    {
      id: 3,
      user_id: 'u2',
      score: 17444,
      tier_reached: 9,
      balls_merged: 2866,
      duration_ms: 240000,
      created_at: '2026-11-02T20:09:00.000Z',
    },
  ]

  const progressRows: BossUserProgressRow[] = [
    {
      user_id: 'u1',
      best_score: 20512,
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
    expect(summary.players[0]?.bestScore).toBe(20512)
    expect(summary.players[1]?.username).toBe('gopeto')
    expect(summary.players[1]?.bestScore).toBe(17444)

    expect(summary.variantBreakdown).toEqual([
      { key: '9:1', count: 1 },
      { key: '9:2', count: 1 },
    ])
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
        created_at: '2026-11-02T15:20:00.000Z',
      },
      {
        id: 102,
        guest_id: '22222222-2222-4222-8222-222222222222',
        score: 1850,
        tier_reached: 5,
        balls_merged: 40,
        duration_ms: 45000,
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
  })
})
