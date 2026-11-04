import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Score } from './auth'

const transport = vi.hoisted(() => ({ rows: [] as Score[], failFrom: Infinity }))
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const orders: Array<{ column: string; ascending: boolean }> = []
      const query = {
        select: () => query,
        order: (column: string, options: { ascending: boolean }) => {
          orders.push({ column, ascending: options.ascending })
          return query
        },
        range: async (from: number, to: number) => {
          if (from >= transport.failFrom) return { data: null, error: new Error('Page unavailable') }
          const sorted = [...transport.rows].sort((a, b) => {
            for (const order of orders) {
              const delta = Number(a[order.column as keyof Score]) - Number(b[order.column as keyof Score])
              if (delta !== 0) return order.ascending ? delta : -delta
            }
            return 0
          })
          return { data: sorted.slice(from, to + 1), error: null }
        },
      }
      return query
    },
  }),
}))

import { scoreService } from './auth'

function score(id: number, user: string, points: number): Score {
  return { id, user_id: user, score: points, tier_reached: 6, balls_merged: 20,
    duration_ms: 60000, created_at: '2026-11-01T00:00:00Z' }
}

beforeEach(() => {
  transport.rows = []
  transport.failFrom = Infinity
})

describe('leaderboard pagination', () => {
  it('keeps each player’s best score and reaches players beyond the API default row cap', async () => {
    transport.rows = [
      ...Array.from({ length: 1100 }, (_, i) => score(i + 1, 'repeat-player', 100000 - i)),
      ...Array.from({ length: 130 }, (_, i) => score(i + 1101, `player-${i}`, 50000 - i)),
    ]
    const entries = await scoreService.getLeaderboard(Infinity)
    expect(entries.map((entry) => entry.user_id)).toEqual([
      'repeat-player', ...Array.from({ length: 130 }, (_, i) => `player-${i}`),
    ])
    expect(entries[0]?.score).toBe(100000)
    expect(entries.at(-1)?.score).toBe(49871)
  })

  it('returns the requested number of distinct players even when duplicates span pages', async () => {
    transport.rows = [
      ...Array.from({ length: 260 }, (_, i) => score(i + 1, 'leader', 1000 - i)),
      score(261, 'second', 500), score(262, 'third', 400),
    ]
    expect((await scoreService.getLeaderboard(2)).map((entry) => entry.user_id)).toEqual(['leader', 'second'])
  })

  it('does not expose an incomplete ranking when a later page fails', async () => {
    transport.rows = Array.from({ length: 300 }, (_, i) => score(i + 1, `player-${i}`, 1000 - i))
    transport.failFrom = 250
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await scoreService.getLeaderboard(Infinity)).toEqual([])
    } finally {
      error.mockRestore()
    }
  })
})
