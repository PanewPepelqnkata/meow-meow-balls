import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService, scoreService, type Score } from './auth'
import type { User } from '@supabase/supabase-js'

const transport = vi.hoisted(() => ({
  rows: [] as Score[],
  failFrom: Infinity,
  rangeGate: null as Promise<{ data: Score[]; error: Error | null }> | null,
}))
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
          if (transport.rangeGate) return transport.rangeGate
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function score(id: number, user: string, points: number): Score {
  return { id, user_id: user, score: points, tier_reached: 6, balls_merged: 20,
    duration_ms: 60000, created_at: '2026-11-01T00:00:00Z' }
}

beforeEach(() => {
  transport.rows = []
  transport.failFrom = Infinity
  transport.rangeGate = null
})

afterEach(() => {
  vi.restoreAllMocks()
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
  it('returns authenticated placement past the first page using distinct-player ordering', async () => {
    const auth = AuthService.getInstance()
    const user = { id: 'target-player' } as User
    vi.spyOn(auth, 'getUser').mockReturnValue(user)
    transport.rows = [
      ...Array.from({ length: 260 }, (_, i) => score(i + 1, 'repeat-player', 1000 - i)),
      score(261, 'target-player', 500),
      score(262, 'later-player', 400),
    ]

    await expect(scoreService.getUserRank()).resolves.toBe(2)
  })

  it('discards a rank response when the authenticated account changes in flight', async () => {
    const auth = AuthService.getInstance()
    let currentUser: User | null = { id: 'account-a' } as User
    vi.spyOn(auth, 'getUser').mockImplementation(() => currentUser)
    const gate = deferred<{ data: Score[]; error: Error | null }>()
    transport.rangeGate = gate.promise

    const pending = scoreService.getUserRank()
    currentUser = { id: 'account-b' } as User
    gate.resolve({ data: [score(1, 'account-a', 1000)], error: null })

    await expect(pending).resolves.toBeNull()
  })

})
