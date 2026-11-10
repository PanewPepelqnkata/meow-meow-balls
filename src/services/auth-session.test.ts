import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import type { AuthService } from './auth'
import type * as SaveState from '../game/state/save'
import type { UpgradeLevels } from '../config/abilityUpgrades'

interface QueryResult {
  data: unknown
  error: { message: string; code?: string } | null
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
  const defaultRpc = async (...args: [string, Record<string, unknown>?]): Promise<QueryResult> => {
    assertUnlocked('rpc')
    return {
      data: args[0] === 'sync_user_progress'
        ? { coins: 0, coin_revision: 0, upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 } }
        : null,
      error: null,
    }
  }
  const rpc = vi.fn(defaultRpc)
  const client = { auth, from, rpc }
  const getSupabase = vi.fn(() => client)
  return { state, auth, from, rpc, getSupabase, queryResult, defaultQuery, defaultRpc, emit }
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
  sdk.rpc.mockReset()
  sdk.rpc.mockImplementation(sdk.defaultRpc)
  sdk.queryResult.mockReset()
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

async function restoreWallet(
  coins = 100,
  coinRevision = 4,
  upgrades: UpgradeLevels = { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
  id = 'account-coins',
): Promise<void> {
  sdk.state.session = sessionFor(id)
  sdk.queryResult.mockImplementation((table, column, value, operation) => {
    if (table === 'user_progress' && operation === 'maybeSingle') {
      return Promise.resolve({ data: { coins, coin_revision: coinRevision, upgrades }, error: null })
    }
    return sdk.defaultQuery(table, column, value, operation)
  })
  await auth.initialize()
  await vi.advanceTimersByTimeAsync(0)
}

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

  it('restores canonical coins and refreshes score-derived rewards without sending a client earning amount', async () => {
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
    sdk.rpc.mockResolvedValue({ data: { coins: 124.5, coin_revision: 5, upgrades: saves.loadSave().upgrades }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await auth.persistSaveToCloud()

    const firstSync = sdk.rpc.mock.calls.find((call) => call[0] === 'sync_user_progress')
    expect(firstSync?.[1]).toEqual({ p_save: expect.any(Object), p_coin_revision: 4 })
    expect(firstSync?.[1]?.p_save).not.toHaveProperty('coins')
    expect(firstSync?.[1]?.p_save).not.toHaveProperty('coinRevision')
    expect(firstSync?.[1]?.p_save).not.toHaveProperty('upgrades')
    expect(saves.loadSave().coins).toBe(124.5)
  })

  it('never uploads stale client balances before or after server-settled earnings', async () => {
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

    sdk.rpc.mockResolvedValue({ data: { coins: 50, coin_revision: 7, upgrades: saves.loadSave().upgrades }, error: null })
    await auth.persistSaveToCloud({ coins: 100 }, 'account-coins')
    const staleSync = sdk.rpc.mock.calls.at(-1)
    expect(staleSync?.[0]).toBe('sync_user_progress')
    expect(staleSync?.[1]).toEqual({ p_save: expect.any(Object), p_coin_revision: 7 })
    expect(staleSync?.[1]?.p_save).not.toHaveProperty('coins')
    expect(staleSync?.[1]?.p_save).not.toHaveProperty('coinRevision')

    sdk.rpc.mockResolvedValue({ data: { coins: 51, coin_revision: 8, upgrades: saves.loadSave().upgrades }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await auth.persistSaveToCloud()
    expect(sdk.rpc).toHaveBeenCalledWith('sync_user_progress', { p_save: expect.any(Object), p_coin_revision: 7 })
    expect(saves.loadSave().coins).toBe(51)
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

  it.each([
    { data: null, error: null, message: 'The Account overview RPC returned no data.' },
    { data: { profile: { id: 'account-a' } }, error: null, message: 'The Account overview RPC returned an incomplete response.' },
  ])('returns a diagnostic error rather than treating invalid overview data as success', async ({ data, error, message }) => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    sdk.rpc.mockResolvedValueOnce({ data, error })

    const result = await auth.getKingsWardrobeOverview()

    expect(result.data.profile.id).toBe('account-a')
    expect(result.error?.message).toBe(message)
    expect(sdk.rpc).toHaveBeenCalledWith('get_kings_wardrobe_overview')
  })

  it('preserves the backend RPC error while returning fallback account data', async () => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    sdk.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied', code: '42501' } })

    const result = await auth.getKingsWardrobeOverview()

    expect(result.data.profile.id).toBe('account-a')
    expect(result.error?.message).toBe('permission denied')
  })

  it('hydrates the profile from the authorized overview if direct profile hydration failed', async () => {
    sdk.state.session = sessionFor('account-a')
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'profiles') return Promise.resolve({ data: null, error: { message: 'direct profile read denied' } })
      return sdk.defaultQuery(table, column, value, operation)
    })
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.getProfile()).toBeNull()

    const overview = {
      profile: {
        id: 'account-a', username: 'RoyalPlayer', display_name: 'RoyalPlayer',
        selected_avatar_id: 'core:1', active_title_id: null, favorite_ball_ids: [],
        equipped_container_skin: 'royal_keep', owned_container_skins: ['royal_keep'],
        username_changed_at: null, created_at: '2026-11-09T00:00:00.000Z', updated_at: '2026-11-09T00:00:00.000Z',
      },
      auth_providers: ['email'], unlocked_ball_ids: ['core:1', 'core:2', 'core:3'], total_available_balls: 14,
      achievements: [], titles: [], newly_unlocked_achievements: [],
      statistics: {
        games_played: 2, total_merges: 3, highest_tier: 4, total_playtime_ms: 1000,
        total_coins_earned: 25, current_coins: 10, average_score: 42, best_score: 84, verified_runs_count: 2,
      },
    }
    sdk.rpc.mockResolvedValueOnce({ data: overview, error: null })

    const result = await auth.getKingsWardrobeOverview()

    expect(result.error).toBeNull()
    expect(auth.getProfile()).toEqual(expect.objectContaining({
      id: 'account-a', username: 'RoyalPlayer', selected_avatar_id: 'core:1', owned_container_skins: ['royal_keep'],
    }))
  })

  it('returns rejected Account mutation requests through the error contract', async () => {
    sdk.state.session = sessionFor('account-a')
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    sdk.rpc.mockRejectedValueOnce(new Error('network unavailable'))

    const result = await auth.setSelectedAvatar('core:1')

    expect(result.error?.message).toBe('network unavailable')
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

describe('account wallet and ability upgrade persistence', () => {
  it('blocks signed-out, anonymous-auth and sandbox players before any purchase RPC', async () => {
    expect(auth.isRegisteredAccount()).toBe(false)
    expect((await auth.purchaseUpgrade('wallDuration')).error).toBeInstanceOf(Error)
    expect(sdk.rpc).not.toHaveBeenCalled()

    sdk.state.session = sessionFor('anonymous-player')
    sdk.state.session.user.is_anonymous = true
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.isAuthenticated()).toBe(true)
    expect(auth.isRegisteredAccount()).toBe(false)
    expect((await auth.purchaseUpgrade('shakeDuration')).error).toBeInstanceOf(Error)
    expect(sdk.rpc.mock.calls.filter(([name]) => name === 'purchase_ability_upgrade')).toEqual([])

    await sdk.emit('SIGNED_IN', sessionFor('registered-player'))
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.isRegisteredAccount()).toBe(true)
    vi.stubGlobal('window', { location: { pathname: '/drunko', search: '' } })
    expect((await auth.purchaseUpgrade('shakeIntensity')).error).toBeInstanceOf(Error)
    expect(sdk.rpc.mock.calls.filter(([name]) => name === 'purchase_ability_upgrade')).toEqual([])
  })

  it('hydrates upgrades and coins only from the canonical progress row, never editable metadata or cached levels', async () => {
    saves.writeSave({
      coins: 999,
      coinRevision: 1,
      upgrades: { wallDuration: 10, shakeDuration: 10, shakeIntensity: 5 },
    }, { syncCloud: false, ownerId: 'account-coins' })
    sdk.state.session = sessionFor('account-coins')
    sdk.state.session.user.user_metadata.ballrush_progress = {
      coins: 9999, coinRevision: 99, upgrades: { wallDuration: 10, shakeDuration: 10, shakeIntensity: 5 },
    }
    sdk.queryResult.mockImplementation((table, column, value, operation) => {
      if (table === 'user_progress') return Promise.resolve({ data: {
        coins: '12.5', coin_revision: '8', upgrades: { wallDuration: 2, shakeDuration: 1, shakeIntensity: 0 },
      }, error: null })
      return sdk.defaultQuery(table, column, value, operation)
    })

    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(saves.loadSave()).toEqual(expect.objectContaining({
      coins: 12.5, coinRevision: 8,
      upgrades: { wallDuration: 2, shakeDuration: 1, shakeIntensity: 0 },
    }))
  })

  it('does not fall back to editable metadata balances or upgrades when the canonical row is missing', async () => {
    saves.writeSave({ coins: 999, upgrades: { wallDuration: 10, shakeDuration: 10, shakeIntensity: 5 } }, {
      syncCloud: false, ownerId: 'account-coins',
    })
    sdk.state.session = sessionFor('account-coins')
    sdk.state.session.user.user_metadata.ballrush_progress = {
      coins: 9999, coinRevision: 99, upgrades: { wallDuration: 10, shakeDuration: 10, shakeIntensity: 5 },
    }
    sdk.queryResult.mockImplementation((table, column, value, operation) => table === 'user_progress'
      ? Promise.resolve({ data: null, error: null })
      : sdk.defaultQuery(table, column, value, operation))

    await auth.initialize()
    await vi.advanceTimersByTimeAsync(0)

    expect(saves.loadSave()).toEqual(expect.objectContaining({
      coins: 0, coinRevision: 0,
      upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
    }))
    expect(sdk.rpc).not.toHaveBeenCalled()
  })

  it('applies a canonical decrease/reset without treating an older cached balance as newly earned coins', async () => {
    await restoreWallet(50, 7, { wallDuration: 2, shakeDuration: 3, shakeIntensity: 1 })
    saves.writeSave({ ...saves.loadSave(), coins: 100 }, { syncCloud: false, ownerId: 'account-coins' })
    sdk.queryResult.mockImplementation((table, column, value, operation) => table === 'user_progress'
      ? Promise.resolve({ data: { coins: 0, coin_revision: 8, upgrades: {} }, error: null })
      : sdk.defaultQuery(table, column, value, operation))

    await auth.restoreAccountProgress()

    expect(saves.loadSave()).toEqual(expect.objectContaining({
      coins: 0, coinRevision: 8,
      upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
    }))
    expect(sdk.rpc).not.toHaveBeenCalled()
  })

  it('restores a server-accepted reward after a lost response and browser-module reload', async () => {
    await restoreWallet(50, 7)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sdk.rpc.mockRejectedValueOnce(new Error('Response lost after server commit'))
    await auth.persistSaveToCloud()
    expect(saves.loadSave().coins).toBe(50)
    saves.setCloudSyncHandler(null)
    // Intentionally exercise a reload: only the server receipt, not a mutable
    // in-memory baseline or client coin delta, survives the missing response.
    vi.resetModules()
    ;({ authService: auth } = await import('./auth'))
    saves = await import('../game/state/save')
    await restoreWallet(51, 8)
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 51, coinRevision: 8 }))
    expect(sdk.rpc.mock.calls.every(([, params]) => params && !('p_coins_earned' in params))).toBe(true)
    logged.mockRestore()
  })

  it('persists the server revision even when the displayed total is unchanged', async () => {
    await restoreWallet(50, 7)
    sdk.rpc.mockResolvedValue({ data: { coins: 50, coin_revision: 8, upgrades: saves.loadSave().upgrades }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    expect(saves.loadSave().coins).toBe(50)
    await auth.persistSaveToCloud()
    for (const [, params] of sdk.rpc.mock.calls) {
      expect(params).not.toHaveProperty('p_coins_earned')
      expect(params?.p_save).not.toHaveProperty('coins')
      expect(params?.p_save).not.toHaveProperty('coinRevision')
      expect(params?.p_save).not.toHaveProperty('upgrades')
    }
    expect(JSON.parse(localStorage.getItem('ballrush.save.v1')!)).toEqual(expect.objectContaining({ coins: 50, coinRevision: 8 }))
  })

  it('merges authoritative coin responses without dropping run progress earned during an in-flight sync', async () => {
    await restoreWallet(50, 7)
    const firstSync = deferred<QueryResult>()
    sdk.rpc.mockImplementationOnce(() => firstSync.promise)
    sdk.rpc.mockResolvedValue({ data: { coins: 53, coin_revision: 9, upgrades: saves.loadSave().upgrades }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await vi.advanceTimersByTimeAsync(0)
    saves.recordRunEnd(2000, 3, 1)
    const flushed = auth.persistSaveToCloud()
    firstSync.resolve({ data: { coins: 51, coin_revision: 8, upgrades: saves.loadSave().upgrades }, error: null })
    await flushed

    const requests = sdk.rpc.mock.calls.filter(([name]) => name === 'sync_user_progress')
    expect(requests).toHaveLength(3)
    expect(requests[0]![1]?.p_save).toEqual(expect.objectContaining({ best: 1000 }))
    expect(requests.every(([, params]) => params && !('p_coins_earned' in params))).toBe(true)
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 53, coinRevision: 9, best: 2000 }))
  })

  it('holds sync behind hydration so an overlapping final run cannot replace canonical wallet state with a stale snapshot', async () => {
    await restoreWallet(50, 7)
    const progress = deferred<QueryResult>()
    sdk.queryResult.mockImplementation((table, column, value, operation) => table === 'user_progress'
      ? progress.promise
      : sdk.defaultQuery(table, column, value, operation))
    const restoring = auth.restoreAccountProgress()
    await vi.advanceTimersByTimeAsync(0)
    sdk.rpc.mockResolvedValue({ data: { coins: 51, coin_revision: 8, upgrades: saves.loadSave().upgrades }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(sdk.rpc).not.toHaveBeenCalled()
    progress.resolve({ data: { coins: 50, coin_revision: 7, upgrades: saves.loadSave().upgrades }, error: null })
    await restoring
    await auth.persistSaveToCloud()

    expect(sdk.rpc.mock.calls.every(([, params]) => params && !('p_coins_earned' in params))).toBe(true)
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 51, coinRevision: 8, best: 1000 }))
  })

  it('keeps the wallet and later earnings when Settings resets progress while a sync is in flight', async () => {
    const upgrades = { wallDuration: 1, shakeDuration: 2, shakeIntensity: 3 }
    await restoreWallet(50, 7, upgrades)
    const firstSync = deferred<QueryResult>()
    sdk.rpc.mockImplementationOnce(() => firstSync.promise)
    sdk.rpc.mockResolvedValue({ data: { coins: 53, coin_revision: 9, upgrades }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    await vi.advanceTimersByTimeAsync(0)
    saves.resetProgress()
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 50, upgrades, best: 0 }))
    saves.recordRunEnd(2000, 3, 1)
    const flushed = auth.persistSaveToCloud()
    firstSync.resolve({ data: { coins: 51, coin_revision: 8, upgrades }, error: null })
    await flushed

    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 53, upgrades, best: 2000 }))
    expect(sdk.rpc.mock.calls.every(([, params]) => params && !('p_coins_earned' in params))).toBe(true)
  })

  it('leaves the cached account state intact on a progress-table error instead of replacing coins with zero', async () => {
    await restoreWallet(50, 7, { wallDuration: 1, shakeDuration: 2, shakeIntensity: 3 })
    sdk.queryResult.mockImplementation((table, column, value, operation) => table === 'user_progress'
      ? Promise.resolve({ data: null, error: { message: 'Network unreachable' } })
      : sdk.defaultQuery(table, column, value, operation))
    await auth.restoreAccountProgress()
    expect(saves.loadSave()).toEqual(expect.objectContaining({
      coins: 50, coinRevision: 7, upgrades: { wallDuration: 1, shakeDuration: 2, shakeIntensity: 3 },
    }))
  })

  it('serializes rapid purchases and uses the accepted level and coin revision for each next purchase', async () => {
    await restoreWallet()
    const firstPurchase = deferred<QueryResult>()
    const firstLevels = { wallDuration: 1, shakeDuration: 0, shakeIntensity: 0 }
    const secondLevels = { wallDuration: 2, shakeDuration: 0, shakeIntensity: 0 }
    sdk.rpc.mockResolvedValueOnce({ data: { coins: 100, coin_revision: 4, upgrades: saves.loadSave().upgrades }, error: null })
      .mockImplementationOnce(() => firstPurchase.promise)
      .mockResolvedValueOnce({ data: { coins: 90, coin_revision: 5, upgrades: firstLevels }, error: null })
      .mockResolvedValueOnce({ data: { coins: 70, coin_revision: 6, upgrades: secondLevels }, error: null })
    // vi.resetModules replaces this singleton too; a static import would observe the old bus.
    const { gameBus } = await import('../game/events/gameBus')
    const changed = vi.fn()
    const off = gameBus.on('state:save', changed)
    const first = auth.purchaseUpgrade('wallDuration')
    const second = auth.purchaseUpgrade('wallDuration')
    await vi.advanceTimersByTimeAsync(0)
    expect(sdk.rpc.mock.calls.filter(([name]) => name === 'purchase_ability_upgrade')).toHaveLength(1)
    firstPurchase.resolve({ data: [{ coins: 90, coin_revision: 5, upgrades: firstLevels }], error: null })
    expect(await Promise.all([first, second])).toEqual([{ error: null }, { error: null }])

    expect(sdk.rpc.mock.calls.filter(([name]) => name === 'purchase_ability_upgrade')).toEqual([
      ['purchase_ability_upgrade', { p_upgrade: 'wallDuration', p_expected_level: 0, p_coin_revision: 4 }],
      ['purchase_ability_upgrade', { p_upgrade: 'wallDuration', p_expected_level: 1, p_coin_revision: 5 }],
    ])
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 70, coinRevision: 6, upgrades: secondLevels }))
    expect(changed).toHaveBeenCalled()
    off()
  })

  it('refreshes a server-settled balance before spending it on an upgrade', async () => {
    await restoreWallet(9, 4)
    const levels = { wallDuration: 1, shakeDuration: 0, shakeIntensity: 0 }
    sdk.rpc.mockResolvedValueOnce({ data: { coins: 10, coin_revision: 5, upgrades: saves.loadSave().upgrades }, error: null })
      .mockResolvedValueOnce({ data: { coins: 10, coin_revision: 5, upgrades: saves.loadSave().upgrades }, error: null })
      .mockResolvedValueOnce({ data: { coins: 0, coin_revision: 6, upgrades: levels }, error: null })
    saves.recordRunEnd(1000, 3, 1)
    expect(await auth.purchaseUpgrade('wallDuration')).toEqual({ error: null })
    expect(sdk.rpc.mock.calls.map(([name]) => name)).toEqual([
      'sync_user_progress', 'sync_user_progress', 'purchase_ability_upgrade',
    ])
    expect(sdk.rpc.mock.calls[0]![1]).not.toHaveProperty('p_coins_earned')
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 0, coinRevision: 6, upgrades: levels }))
  })

  it('refreshes server-settled earnings after an in-flight purchase without inventing a local earning delta', async () => {
    await restoreWallet()
    const purchaseResponse = deferred<QueryResult>()
    const earningSync = deferred<QueryResult>()
    const levels = { wallDuration: 1, shakeDuration: 0, shakeIntensity: 0 }
    sdk.rpc.mockResolvedValueOnce({ data: { coins: 100, coin_revision: 4, upgrades: saves.loadSave().upgrades }, error: null })
      .mockImplementationOnce(() => purchaseResponse.promise)
      .mockImplementationOnce(() => earningSync.promise)
      .mockResolvedValue({ data: { coins: 92, coin_revision: 6, upgrades: levels }, error: null })
    const buying = auth.purchaseUpgrade('wallDuration')
    await vi.advanceTimersByTimeAsync(0)
    saves.recordRunEnd(2000, 3, 1)
    purchaseResponse.resolve({ data: { coins: 90, coin_revision: 5, upgrades: levels }, error: null })
    expect(await buying).toEqual({ error: null })
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 90, coinRevision: 5, upgrades: levels, best: 2000 }))
    earningSync.resolve({ data: { coins: 92, coin_revision: 6, upgrades: levels }, error: null })
    await auth.persistSaveToCloud()
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 92, coinRevision: 6, upgrades: levels }))
  })

  it.each([
    { coins: 9, levels: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 }, message: 'Not enough coins.' },
    { coins: 1000, levels: { wallDuration: 10, shakeDuration: 0, shakeIntensity: 0 }, message: 'This upgrade is already at its maximum level.' },
  ])('rejects unavailable purchases without a debit ($message)', async ({ coins, levels, message }) => {
    await restoreWallet(coins, 4, levels)
    sdk.rpc.mockResolvedValue({ data: { coins, coin_revision: 4, upgrades: levels }, error: null })
    expect((await auth.purchaseUpgrade('wallDuration')).error?.message).toBe(message)
    expect(sdk.rpc.mock.calls.filter(([name]) => name === 'purchase_ability_upgrade')).toEqual([])
    expect(saves.loadSave().coins).toBe(coins)
    expect(saves.loadSave().upgrades).toEqual(levels)
  })

  it('keeps balances and levels when the database rejects a stale purchase', async () => {
    await restoreWallet()
    sdk.rpc.mockResolvedValueOnce({ data: { coins: 100, coin_revision: 4, upgrades: saves.loadSave().upgrades }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Coin balance changed; refresh before purchasing' } })
    expect((await auth.purchaseUpgrade('shakeIntensity')).error?.message).toBe('Coin balance changed; refresh before purchasing')
    expect(saves.loadSave()).toEqual(expect.objectContaining({
      coins: 100, coinRevision: 4, upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
    }))
  })

  it.each(['account-coins', 'account-b'])('discards an in-flight purchase and queued duplicate after a new %s login', async (nextId) => {
    await restoreWallet()
    const purchaseResponse = deferred<QueryResult>()
    sdk.rpc.mockResolvedValueOnce({ data: { coins: 100, coin_revision: 4, upgrades: saves.loadSave().upgrades }, error: null })
      .mockImplementationOnce(() => purchaseResponse.promise)
    const first = auth.purchaseUpgrade('wallDuration')
    const queued = auth.purchaseUpgrade('wallDuration')
    await vi.advanceTimersByTimeAsync(0)
    const nextLevels = { wallDuration: 0, shakeDuration: 2, shakeIntensity: 1 }
    sdk.queryResult.mockImplementation((table, column, value, operation) => table === 'user_progress'
      ? Promise.resolve({ data: { coins: 7, coin_revision: 8, upgrades: nextLevels }, error: null })
      : sdk.defaultQuery(table, column, value, operation))
    await sdk.emit('SIGNED_IN', sessionFor(nextId, 'new-login'))
    await vi.advanceTimersByTimeAsync(0)
    purchaseResponse.resolve({ data: { coins: 90, coin_revision: 5, upgrades: { wallDuration: 1, shakeDuration: 0, shakeIntensity: 0 } }, error: null })
    const results = await Promise.all([first, queued])
    expect(results.every(({ error }) => error instanceof Error)).toBe(true)
    expect(sdk.rpc.mock.calls.filter(([name]) => name === 'purchase_ability_upgrade')).toHaveLength(1)
    expect(saves.getSaveOwnerId()).toBe(nextId)
    expect(saves.loadSave()).toEqual(expect.objectContaining({ coins: 7, coinRevision: 8, upgrades: nextLevels }))
  })
})
