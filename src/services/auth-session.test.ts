import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import type { AuthService } from './auth'
import type * as SaveState from '../game/state/save'

interface QueryResult {
  data: unknown
  error: null
}

interface SessionResult {
  data: { session: Session | null }
  error: null
}

interface SignInResult {
  data: { user: User | null; session: Session | null }
  error: null
}

type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>

const sdk = vi.hoisted(() => {
  const state = {
    session: null as Session | null,
    listener: null as AuthCallback | null,
    sessionResponse: null as Promise<SessionResult> | null,
    signInResponse: null as Promise<SignInResult> | null,
    signInSession: null as Session | null,
    signUpSession: null as Session | null,
    lockDepth: 0,
    nestedCalls: [] as string[],
    callbackResults: [] as unknown[],
  }
  const assertUnlocked = (method: string) => {
    if (state.lockDepth > 0) {
      state.nestedCalls.push(method)
      throw new Error(`Nested Supabase lock call: ${method}`)
    }
  }
  const emit = async (event: AuthChangeEvent, session: Session | null) => {
    state.session = session
    state.lockDepth++
    try {
      const result = state.listener?.(event, session)
      state.callbackResults.push(result)
      await result
    } finally {
      state.lockDepth--
    }
  }
  const defaultQuery = (table: string, _column: string | undefined, value: string | undefined, operation: string): Promise<QueryResult> => {
    const data = table === 'profiles' && operation === 'single'
      ? { id: value, username: value, display_name: value, avatar_url: null, created_at: '', updated_at: '' }
      : table === 'user_progress' && operation === 'maybeSingle'
        ? { best_score: 0 }
        : table === 'scores' ? [] : null
    return Promise.resolve({ data, error: null })
  }
  const queryResult = vi.fn(defaultQuery)
  const from = vi.fn((table: string) => {
    let column: string | undefined
    let value: string | undefined
    const finish = (operation: string) => {
      assertUnlocked(`${table}.${operation}`)
      return queryResult(table, column, value, operation)
    }
    const query = {
      select: () => query,
      eq: (nextColumn: string, nextValue: string) => {
        column = nextColumn
        value = nextValue
        return query
      },
      ilike: (nextColumn: string, nextValue: string) => {
        column = nextColumn
        value = nextValue
        return query
      },
      order: () => query,
      limit: () => finish('limit'),
      single: () => finish('single'),
      maybeSingle: () => finish('maybeSingle'),
      upsert: () => finish('upsert'),
    }
    return query
  })
  const auth = {
    onAuthStateChange: vi.fn((callback: AuthCallback) => {
      state.listener = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    getSession: vi.fn(async () => {
      assertUnlocked('getSession')
      return state.sessionResponse ?? { data: { session: state.session }, error: null }
    }),
    getUser: vi.fn(async () => {
      assertUnlocked('getUser')
      return { data: { user: state.session?.user ?? null }, error: null }
    }),
    signInWithPassword: vi.fn(async (): Promise<SignInResult> => {
      assertUnlocked('signInWithPassword')
      if (state.signInResponse) return state.signInResponse
      const session = state.signInSession
      await emit('SIGNED_IN', session)
      return { data: { user: session?.user ?? null, session }, error: null }
    }),
    signUp: vi.fn(async (): Promise<SignInResult> => {
      assertUnlocked('signUp')
      const session = state.signUpSession
      if (session) await emit('SIGNED_IN', session)
      return { data: { user: session?.user ?? null, session }, error: null }
    }),
    updateUser: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      assertUnlocked('updateUser')
      const session = state.session
      if (!session) return { data: { user: null }, error: null }
      const user = { ...session.user, user_metadata: { ...session.user.user_metadata, ...data } }
      await emit('USER_UPDATED', { ...session, user })
      return { data: { user }, error: null }
    }),
    signOut: vi.fn(async (): Promise<{ error: Error | null }> => {
      assertUnlocked('signOut')
      await emit('SIGNED_OUT', null)
      return { error: null }
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rpc = vi.fn(async (..._args: unknown[]) => {
    assertUnlocked('rpc')
    return { data: null as unknown, error: null }
  })
  const client = { auth, from, rpc }
  const getSupabase = vi.fn(() => client)
  return { state, auth, from, rpc, getSupabase, queryResult, defaultQuery, emit }
})

vi.mock('../lib/supabase', () => ({ getSupabase: sdk.getSupabase }))
vi.mock('phaser', () => ({ default: {} }))

function deferred<T>() {
  // The project's ES2022 libraries do not expose Promise.withResolvers.
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function sessionFor(id: string, token = `${id}-token`): Session {
  return {
    access_token: token,
    refresh_token: `${token}-refresh`,
    token_type: 'bearer',
    expires_in: 3600,
    user: { id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  }
}

let auth: AuthService
let saves: typeof SaveState

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.clearAllMocks()
  sdk.queryResult.mockImplementation(sdk.defaultQuery)
  Object.assign(sdk.state, {
    session: null,
    listener: null,
    sessionResponse: null,
    signInResponse: null,
    signInSession: null,
    signUpSession: null,
    lockDepth: 0,
    nestedCalls: [],
    callbackResults: [],
  })
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  })
  // Reload modules per test so AuthService's singleton and save-state caches are isolated.
  ;({ authService: auth } = await import('./auth'))
  saves = await import('../game/state/save')
  saves.setCloudSyncHandler(null)
  saves.resetSave({ syncCloud: false })
})

afterEach(() => {
  saves.setCloudSyncHandler(null)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('persistent browser auth lifecycle', () => {
  it('shares one initialization promise and subscribes before reading storage', async () => {
    const stored = deferred<SessionResult>()
    sdk.state.sessionResponse = stored.promise
    const first = auth.initialize()
    expect(auth.initialize()).toBe(first)
    expect(sdk.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(sdk.auth.getSession).toHaveBeenCalledTimes(1)
    expect(sdk.auth.onAuthStateChange.mock.invocationCallOrder[0]).toBeLessThan(sdk.auth.getSession.mock.invocationCallOrder[0]!)

    sdk.state.session = sessionFor('account-a')
    stored.resolve({ data: { session: sdk.state.session }, error: null })
    await first
    expect(auth.initialize()).toBe(first)
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getUser()?.id).toBe('account-a')
    expect(sdk.auth.getUser).toHaveBeenCalledTimes(1)
    expect(sdk.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('skips the Supabase client on the isolated sandbox route', async () => {
    vi.stubGlobal('window', { location: { pathname: '/drunko', search: '' } })

    await expect(auth.initialize()).resolves.toBeUndefined()

    expect(sdk.getSupabase).not.toHaveBeenCalled()
    expect(sdk.auth.onAuthStateChange).not.toHaveBeenCalled()
    expect(sdk.auth.getSession).not.toHaveBeenCalled()
  })

  it('announces the restored user before profile and progress requests finish', async () => {
    const profile = deferred<QueryResult>()
    const progress = deferred<QueryResult>()
    sdk.state.session = sessionFor('account-a')
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'profiles') return profile.promise
      if (table === 'user_progress') return progress.promise
      return sdk.defaultQuery(table, column, value, operation)
    })
    const notifications = vi.fn(() => {
      expect(auth.getUser()?.id).toBe('account-a')
      expect(saves.getSaveOwnerId()).toBe('account-a')
    })
    auth.onAuthStateChange(notifications)
    await auth.initialize()
    expect(auth.isAuthenticated()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(notifications).toHaveBeenCalledTimes(1)
    expect(notifications).toHaveBeenCalledWith(true)
    expect(auth.getProfile()).toBeNull()

    profile.resolve({ data: { id: 'account-a', username: 'Restored' }, error: null })
    progress.resolve({ data: { best_score: 42 }, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getProfile()?.username).toBe('Restored')
    expect(saves.savedBest()).toBe(42)
    expect(notifications).toHaveBeenCalledTimes(2)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('restores canonical coins and sends earned deltas through the guarded sync RPC', async () => {
    sdk.state.session = sessionFor('account-coins')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'user_progress' && operation === 'maybeSingle') {
        return Promise.resolve({ data: { best_score: 42, coins: '123.5', coin_revision: 4 }, error: null })
      }
      return sdk.defaultQuery(table, column, value, operation)
    })

    await auth.restoreAccountProgress()

    expect(saves.loadSave().coins).toBe(123.5)
    sdk.rpc.mockResolvedValue({ data: { coins: 124.5, coin_revision: 4 }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await auth.persistSaveToCloud()

    const firstSync = sdk.rpc.mock.calls.find((call) => call[0] === 'sync_user_progress') as
      | [string, { p_save?: Record<string, unknown>; p_coins_earned?: number; p_coin_revision?: number }]
      | undefined
    expect(firstSync?.[1]).toEqual(expect.objectContaining({
      p_coins_earned: 1,
      p_coin_revision: 4,
    }))
    expect(firstSync?.[1]?.p_save).not.toHaveProperty('coins')
    expect(firstSync?.[1]?.p_save).not.toHaveProperty('coinRevision')
  })

  it('does not send a stale pre-admin balance and preserves a later earned delta', async () => {
    sdk.state.session = sessionFor('account-coins')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'user_progress' && operation === 'maybeSingle') {
        return Promise.resolve({ data: { coins: 50, coin_revision: 7 }, error: null })
      }
      return sdk.defaultQuery(table, column, value, operation)
    })
    await auth.restoreAccountProgress()
    expect(saves.loadSave().coins).toBe(50)

    sdk.rpc.mockResolvedValue({ data: { coins: 50, coin_revision: 7 }, error: null })
    await auth.persistSaveToCloud({ coins: 100 }, 'account-coins')
    const staleSync = sdk.rpc.mock.calls.at(-1) as
      | [string, { p_save?: Record<string, unknown>; p_coins_earned?: number; p_coin_revision?: number }]
      | undefined
    expect(staleSync?.[0]).toBe('sync_user_progress')
    expect(staleSync?.[1]).toEqual(expect.objectContaining({
      p_coins_earned: 0,
      p_coin_revision: 7,
    }))
    expect(staleSync?.[1]?.p_save).not.toHaveProperty('coins')
    expect(staleSync?.[1]?.p_save).not.toHaveProperty('coinRevision')

    sdk.rpc.mockResolvedValue({ data: { coins: 51, coin_revision: 7 }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await auth.persistSaveToCloud()
    expect(sdk.rpc).toHaveBeenCalledWith('sync_user_progress', expect.objectContaining({
      p_coins_earned: 1,
      p_coin_revision: 7,
    }))
  })

  it('keeps finds earned during hydration without resurrecting its stale local baseline', async () => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    saves.writeSave({ variants: { '9:shark:2': 100 } }, { syncCloud: false, ownerId: 'account-a' })
    sdk.state.session!.user.user_metadata.ballrush_progress = { variants: { '9:shark:2': 100 } }

    const progress = deferred<QueryResult>()
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'user_progress' && operation === 'maybeSingle') return progress.promise
      return sdk.defaultQuery(table, column, value, operation)
    })
    const restoring = auth.restoreAccountProgress()
    saves.recordDiscovery(9, 2, 'drunko')
    saves.recordDiscovery(9, 2, 'robo')
    // Queue an upload from the pre-hydration save; it must not later erase the table's pig.
    await vi.advanceTimersByTimeAsync(1000)
    expect(sdk.rpc).not.toHaveBeenCalled()

    progress.resolve({ data: { best_score: 42, variants: { '9:pig:2': 50 } }, error: null })
    await restoring
    await vi.advanceTimersByTimeAsync(3000)

    expect(saves.loadSave().variants).toEqual({
      '9:pig:2': 50,
      '9:drunko:2': expect.any(Number),
      '9:robo:2': expect.any(Number),
    })
    expect(saves.hasDiscoveredCollectible(9, 'pig')).toBe(true)
    expect(saves.hasDiscoveredCollectible(9, 'drunko')).toBe(true)
    expect(saves.hasDiscoveredCollectible(9, 'robo')).toBe(true)
    expect(saves.hasDiscoveredCollectible(9, 'shark')).toBe(false)
    expect(sdk.rpc).toHaveBeenCalledWith('sync_user_progress', expect.objectContaining({
      p_coins_earned: 0,
      p_save: expect.objectContaining({ variants: saves.loadSave().variants }),
    }))
  })

  it('does not restore a cloud collection snapshot over an explicit reset made while it was pending', async () => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    const progress = deferred<QueryResult>()
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'user_progress' && operation === 'maybeSingle') return progress.promise
      return sdk.defaultQuery(table, column, value, operation)
    })
    const restoring = auth.restoreAccountProgress()
    saves.recordDiscovery(9, 1, 'pig')
    saves.resetSave({ syncCloud: true, clearOwner: false })
    progress.resolve({ data: { best_score: 999, variants: { '9:shark:2': 100 } }, error: null })
    await restoring
    await vi.advanceTimersByTimeAsync(3000)

    expect(saves.getSaveOwnerId()).toBe('account-a')
    expect(saves.savedBest()).toBe(0)
    expect(saves.loadSave().variants).toEqual({})
  })

  it('does not resurrect collection unlocks from historical run metadata after a collection reset', async () => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    for (const theme of ['pig', 'shark', 'drunko', 'robo']) saves.recordDiscovery(9, 2, theme)
    saves.resetSave({ syncCloud: true, clearOwner: false })
    await vi.advanceTimersByTimeAsync(0)
    const score = { user_id: 'account-a', score: 42, tier_reached: 10, balls_merged: 10,
      duration_ms: 1000, created_at: '2026-11-01T00:00:00Z' }
    const scores = [
      { ...score, id: 1, collectibles: null },
      { ...score, id: 2, collectibles: [] },
      { ...score, id: 3, collectibles: [
        { tier: 9, theme: 'pig', variant: 2, discoveredAt: 200 },
        { tier: 9, theme: 'shark', variant: 2, discoveredAt: 300 },
        { tier: 9, theme: 'drunko', variant: 2, discoveredAt: 400 },
        { tier: 9, theme: 'robo', variant: 2, discoveredAt: 500 },
      ] },
    ]
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'scores') return Promise.resolve({ data: scores, error: null })
      if (table === 'user_progress' && operation === 'maybeSingle') {
        return Promise.resolve({ data: { variants: {} }, error: null })
      }
      return sdk.defaultQuery(table, column, value, operation)
    })

    await auth.restoreAccountProgress()

    expect(saves.loadSave().variants).toEqual({})
    for (const theme of ['pig', 'shark', 'drunko', 'robo']) {
      expect(saves.hasDiscoveredCollectible(9, theme)).toBe(false)
    }
    expect(saves.hasDiscoveredCollectible(10, 'crab')).toBe(false)
    saves.recordDiscovery(9, 3, 'pig')
    expect(saves.hasDiscoveredCollectible(9, 'pig')).toBe(true)
  })

  it('keeps an authoritative empty reset instead of importing older explicit local and auth metadata finds', async () => {
    const previous = { variants: { '9:pig:0': 100, '9:shark:0': 200, '9:drunko:0': 300, '9:robo:0': 400 } }
    saves.writeSave(previous, { syncCloud: false, ownerId: 'account-a' })
    sdk.state.session = sessionFor('account-a')
    sdk.state.session.user.user_metadata.ballrush_progress = previous

    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(saves.loadSave().variants).toEqual({})
    expect(sdk.rpc).not.toHaveBeenCalled()
  })

  it('handles INITIAL_SESSION without nested SDK calls and ignores an older getSession result', async () => {
    const stored = deferred<SessionResult>()
    sdk.state.sessionResponse = stored.promise
    const initialized = auth.initialize()
    const restored = sessionFor('account-a')
    await sdk.emit('INITIAL_SESSION', restored)
    expect(auth.getSession()).toBe(restored)
    expect(sdk.auth.getUser).not.toHaveBeenCalled()
    expect(sdk.state.callbackResults).toEqual([undefined])
    await vi.advanceTimersByTimeAsync(0)
    stored.resolve({ data: { session: null }, error: null })
    await initialized
    await sdk.emit('INITIAL_SESSION', null)
    expect(auth.getSession()).toBe(restored)
    expect(sdk.auth.getUser).toHaveBeenCalledTimes(1)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('captures refresh during getSession and keeps later refreshed session and user synchronously', async () => {
    const stored = deferred<SessionResult>()
    sdk.state.sessionResponse = stored.promise
    const initialized = auth.initialize()
    const refreshed = sessionFor('account-a', 'refreshed')
    await sdk.emit('TOKEN_REFRESHED', refreshed)
    stored.resolve({ data: { session: sessionFor('account-a', 'old') }, error: null })
    await initialized
    expect(auth.getSession()).toBe(refreshed)
    await vi.advanceTimersByTimeAsync(0)

    const newest = sessionFor('account-a', 'newest')
    newest.user.user_metadata = { nickname: 'Updated user' }
    await sdk.emit('TOKEN_REFRESHED', newest)
    expect(auth.getSession()).toBe(newest)
    expect(auth.getUser()).toBe(newest.user)
    await vi.advanceTimersByTimeAsync(0)
    expect(sdk.auth.getUser).toHaveBeenCalledTimes(1)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('restores a background sign-in outside the lock without importing guest progress', async () => {
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    saves.writeSave({ ...saves.freshSave(), best: 999 }, { syncCloud: false, ownerId: null })
    const notifications = vi.fn()
    auth.onAuthStateChange(notifications)
    await sdk.emit('SIGNED_IN', sessionFor('account-a'))
    expect(auth.getUser()?.id).toBe('account-a')
    expect(saves.getSaveOwnerId()).toBe('account-a')
    expect(saves.savedBest()).toBe(0)
    expect(notifications).not.toHaveBeenCalled()
    expect(sdk.auth.getUser).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(notifications).toHaveBeenCalledWith(true)
    expect(sdk.auth.getUser).toHaveBeenCalledTimes(1)
    expect(sdk.state.callbackResults).toEqual([undefined])
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('cancels queued restoration on SIGNED_OUT and rejects late initial/refresh snapshots', async () => {
    const previous = sessionFor('account-a')
    sdk.state.session = previous
    const notifications = vi.fn()
    auth.onAuthStateChange(notifications)
    await auth.initialize()
    await sdk.emit('SIGNED_OUT', null)
    await sdk.emit('INITIAL_SESSION', previous)
    await sdk.emit('TOKEN_REFRESHED', previous)
    expect(auth.getUser()).toBeNull()
    expect(auth.getSession()).toBeNull()
    expect(saves.getSaveOwnerId()).toBeNull()
    await vi.advanceTimersByTimeAsync(0)
    expect(notifications).toHaveBeenCalledTimes(1)
    expect(notifications).toHaveBeenCalledWith(false)
    expect(sdk.auth.getUser).not.toHaveBeenCalled()
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('flushes and explicitly logs out without running a previously queued restore', async () => {
    sdk.state.session = sessionFor('account-a')
    const notifications = vi.fn()
    auth.onAuthStateChange(notifications)
    await auth.initialize()
    await auth.signOut()
    await vi.advanceTimersByTimeAsync(0)
    expect(sdk.rpc).toHaveBeenCalledWith('sync_user_progress', expect.anything())
    expect(sdk.auth.signOut).toHaveBeenCalledTimes(1)
    expect(sdk.auth.getUser).not.toHaveBeenCalled()
    expect(auth.getSession()).toBeNull()
    expect(auth.getProfile()).toBeNull()
    expect(saves.getSaveOwnerId()).toBeNull()
    expect(notifications).toHaveBeenCalledTimes(1)
    expect(notifications).toHaveBeenCalledWith(false)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('preserves local account state when signOut fails', async () => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getUser()?.id).toBe('account-a')
    expect(saves.getSaveOwnerId()).toBe('account-a')

    sdk.auth.signOut.mockResolvedValueOnce({ error: new Error('Network unreachable') })
    await auth.signOut()
    await vi.advanceTimersByTimeAsync(0)

    expect(auth.getUser()?.id).toBe('account-a')
    expect(auth.getSession()).not.toBeNull()
    expect(saves.getSaveOwnerId()).toBe('account-a')
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('does not restore a pending storage snapshot after explicit logout', async () => {
    const stored = deferred<SessionResult>()
    sdk.state.sessionResponse = stored.promise
    const initialized = auth.initialize()
    await auth.signOut()
    stored.resolve({ data: { session: sessionFor('account-a') }, error: null })
    await initialized
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getSession()).toBeNull()
    expect(auth.getUser()).toBeNull()
    expect(saves.getSaveOwnerId()).toBeNull()
    expect(sdk.auth.getUser).not.toHaveBeenCalled()
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('does not accept a sign-in response that completes after logout', async () => {
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    const response = deferred<SignInResult>()
    sdk.state.signInResponse = response.promise
    const signingIn = auth.signInWithEmail('a@example.com', 'password')
    await auth.signOut()
    const stale = sessionFor('account-a')
    response.resolve({ data: { user: stale.user, session: stale }, error: null })
    expect((await signingIn).error).toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getSession()).toBeNull()
    expect(auth.getUser()).toBeNull()
    expect(saves.getSaveOwnerId()).toBeNull()
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('does not let a stale boot snapshot overwrite an owned login', async () => {
    const stored = deferred<SessionResult>()
    sdk.state.sessionResponse = stored.promise
    const initialized = auth.initialize()
    sdk.state.signInSession = sessionFor('account-b')
    expect(await auth.signInWithEmail('b@example.com', 'password')).toEqual({ error: null })
    stored.resolve({ data: { session: sessionFor('account-a') }, error: null })
    await initialized
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getUser()?.id).toBe('account-b')
    expect(auth.getSession()?.access_token).toBe('account-b-token')
    expect(auth.getProfile()?.id).toBe('account-b')
    expect(saves.getSaveOwnerId()).toBe('account-b')
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('lets a newer background sign-in supersede an owned login still fetching cloud data', async () => {
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    const oldProfile = deferred<QueryResult>()
    const oldProgress = deferred<QueryResult>()
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (value === 'account-a' && table === 'profiles') return oldProfile.promise
      if (value === 'account-a' && table === 'user_progress') return oldProgress.promise
      return sdk.defaultQuery(table, column, value, operation)
    })
    sdk.state.signInSession = sessionFor('account-a')
    const signingIn = auth.signInWithEmail('a@example.com', 'password')
    await vi.advanceTimersByTimeAsync(0)
    await sdk.emit('SIGNED_IN', sessionFor('account-b'))
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getUser()?.id).toBe('account-b')
    expect(auth.getProfile()?.id).toBe('account-b')
    expect(saves.getSaveOwnerId()).toBe('account-b')

    oldProfile.resolve({ data: { id: 'account-a', username: 'Stale' }, error: null })
    oldProgress.resolve({ data: { best_score: 999 }, error: null })
    expect((await signingIn).error).toBeInstanceOf(Error)
    expect(auth.getUser()?.id).toBe('account-b')
    expect(auth.getProfile()?.id).toBe('account-b')
    expect(saves.savedBest()).toBe(0)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it.each(['account-a', 'account-b'])('discards old profile/progress responses after logging into %s', async (nextId) => {
    const oldProfile = deferred<QueryResult>()
    const oldProgress = deferred<QueryResult>()
    let holdOldQueries = true
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (holdOldQueries && table === 'profiles') return oldProfile.promise
      if (holdOldQueries && table === 'user_progress' && operation === 'maybeSingle') return oldProgress.promise
      if (table === 'user_progress' && operation === 'maybeSingle') return Promise.resolve({ data: {
        best_score: 7,
        coins: 3,
        coin_revision: 2,
        variants: { '9:robo:1': 100 },
      }, error: null })
      return sdk.defaultQuery(table, column, value, operation)
    })
    sdk.state.session = sessionFor('account-a')
    const notifications = vi.fn()
    auth.onAuthStateChange(notifications)
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    await auth.signOut()
    holdOldQueries = false
    sdk.state.signInSession = sessionFor(nextId, 'new-login')
    expect(await auth.signInWithEmail('next@example.com', 'password')).toEqual({ error: null })
    const notificationCount = notifications.mock.calls.length
    oldProfile.resolve({ data: { id: 'account-a', username: 'Stale profile' }, error: null })
    oldProgress.resolve({ data: { best_score: 999, coins: 80, coin_revision: 1, variants: { '9:pig:1': 50 } }, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getUser()?.id).toBe(nextId)
    expect(auth.getSession()?.access_token).toBe('new-login')
    expect(auth.getProfile()?.username).toBe(nextId)
    expect(saves.getSaveOwnerId()).toBe(nextId)
    expect(saves.savedBest()).toBe(7)
    expect(saves.loadSave().coins).toBe(3)
    expect(saves.hasDiscoveredCollectible(9, 'pig')).toBe(false)
    expect(notifications).toHaveBeenCalledTimes(notificationCount)
    expect(sdk.state.nestedCalls).toEqual([])
  })

  it('keeps the owned signup guest transfer instead of resetting it in the SDK listener', async () => {
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    const guestSave = saves.freshSave()
    guestSave.stats.merges = 8
    saves.writeSave(guestSave, { syncCloud: false, ownerId: null })
    sdk.state.signUpSession = sessionFor('new-account', 'signup')
    sdk.state.signInSession = sessionFor('new-account', 'signup-login')
    expect(await auth.signUpWithUsername('newplayer', 'password')).toEqual({ error: null })
    expect(auth.getUser()?.id).toBe('new-account')
    expect(saves.getSaveOwnerId()).toBe('new-account')
    expect(saves.loadSave().stats.merges).toBe(8)
    expect(sdk.rpc).toHaveBeenCalledWith('link_guest_to_user', expect.any(Object))
    expect(sdk.auth.getUser).not.toHaveBeenCalled()
    expect(sdk.state.callbackResults.every((result) => result === undefined)).toBe(true)
    expect(sdk.state.nestedCalls).toEqual([])
  })
})
