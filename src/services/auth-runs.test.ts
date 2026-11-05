import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { AuthService, ScoreService } from './auth'
import type { RunCollectibles } from '../game/state/collectibleMetadata'

const sdk = vi.hoisted(() => ({
  nextId: 10,
  rpc: vi.fn<(name: string, params: Record<string, unknown>) => Promise<{ data: number | null; error: { message: string } | null }>>(),
}))
vi.mock('../lib/supabase', () => ({ getSupabase: () => ({ rpc: sdk.rpc }) }))
vi.mock('phaser', () => ({ default: {} }))

function deferred<T>() {
  // The project's ES2022 libraries do not expose Promise.withResolvers.
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const pig = { tier: 9, theme: 'pig', variant: 3, discoveredAt: 1800000000100 }
const crab = { tier: 10, theme: 'crab', variant: 5, discoveredAt: 1800000000200 }
let service: ScoreService

beforeEach(() => {
  sdk.nextId = 10
  sdk.rpc.mockReset()
  sdk.rpc.mockImplementation(async (_name, params) => ({
    data: typeof params.p_score_id === 'number' ? params.p_score_id : ++sdk.nextId,
    error: null,
  }))
  vi.spyOn(AuthService.getInstance(), 'getUser').mockReturnValue(null)
  vi.spyOn(AuthService.getInstance(), 'persistGuestSaveToCloud').mockResolvedValue()
  service = new ScoreService()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('run metadata score persistence', () => {
  it('persists guest live snapshots and final interruption metadata on the same run row', async () => {
    service.startNewRun()
    await service.syncActiveRun(0, 3, 0, 0, undefined, [])
    await service.syncActiveRun(500, 9, 4, 1000, undefined, [pig])
    await service.submitScore(800, 10, 8, 2000, 'completed', [pig, crab])
    expect(sdk.rpc.mock.calls.map(([name]) => name)).toEqual([
      'record_guest_score', 'record_guest_score', 'record_guest_score',
    ])
    const params = sdk.rpc.mock.calls.map(([, value]) => value)
    expect(params.map((value) => value.p_score_id)).toEqual([null, 11, 11])
    expect(params.map((value) => value.p_collectibles)).toEqual([[], [pig], [pig, crab]])
    expect(params[2]!.p_interruption_reason).toBe('completed')
  })

  it('sends authenticated metadata without a guest identity', async () => {
    vi.mocked(AuthService.getInstance().getUser).mockReturnValue({ id: 'account-a' } as User)
    await service.syncActiveRun(500, 9, 4, 1000, undefined, [pig])
    expect(sdk.rpc).toHaveBeenCalledWith('record_user_score', expect.objectContaining({ p_collectibles: [pig] }))
    expect(sdk.rpc.mock.calls[0]![1]).not.toHaveProperty('p_guest_id')
  })

  it('does not manufacture metadata for an imported legacy score', async () => {
    await service.submitScore(500, 9, 4, 1000)
    expect(sdk.rpc.mock.calls[0]![1].p_collectibles).toBeNull()
  })

  it('resets metadata on a new run and records lifetime repeats with their own run time', async () => {
    await service.syncActiveRun(500, 9, 4, 1000, undefined, [pig])
    service.startNewRun()
    await service.syncActiveRun(0, 3, 0, 0, undefined, [])
    const repeated = { ...pig, discoveredAt: 1800000000300 }
    await service.submitScore(500, 9, 4, 1000, 'completed', [repeated])
    const params = sdk.rpc.mock.calls.map(([, value]) => value)
    expect(params.map((value) => value.p_score_id)).toEqual([null, null, 12])
    expect(params.map((value) => value.p_collectibles)).toEqual([[pig], [], [repeated]])
  })

  it('captures a snapshot before awaiting creation and keeps old final writes on the old row after restart', async () => {
    const gate = deferred<{ data: number; error: null }>()
    sdk.rpc.mockImplementationOnce(() => gate.promise)
    const initial = service.syncActiveRun(0, 3, 0, 0, undefined, [])
    const original: RunCollectibles = [{ ...pig }]
    const final = service.submitScore(500, 9, 4, 1000, 'page_hidden', original)
    original[0]!.theme = 'shark'
    original.push(crab)
    service.startNewRun()
    const fresh = service.syncActiveRun(0, 3, 0, 0, undefined, [])
    await fresh
    gate.resolve({ data: 99, error: null })
    await Promise.all([initial, final])
    expect(sdk.rpc.mock.calls.map(([, params]) => params.p_score_id)).toEqual([null, null, 99])
    expect(sdk.rpc.mock.calls[2]![1].p_collectibles).toEqual([pig])
    await service.syncActiveRun(10, 4, 1, 100, undefined, [])
    expect(sdk.rpc.mock.calls[3]![1].p_score_id).toBe(11)
  })

  it('keeps sandbox run metadata isolated from every score RPC', async () => {
    vi.stubGlobal('window', { location: { pathname: '/drunko', search: '' } })
    await service.syncActiveRun(500, 9, 4, 1000, undefined, [pig])
    await service.submitScore(500, 9, 4, 1000, 'completed', [pig])
    expect(sdk.rpc).not.toHaveBeenCalled()
  })
})
