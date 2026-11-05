import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BossService } from './boss'

const transport = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: null })),
  restoreAccountProgress: vi.fn(async () => {}),
}))

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ rpc: transport.rpc }),
}))
vi.mock('./auth', () => ({
  authService: {
    getUser: () => ({ id: 'u1' }),
    restoreAccountProgress: transport.restoreAccountProgress,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BossService run editing', () => {
  it('preserves the registered edit payload without replacing collectible metadata', async () => {
    await new BossService().updateScore(1, 20512, 10, 450, 120000)

    expect(transport.rpc).toHaveBeenCalledExactlyOnceWith('boss_update_score', {
      target_score_id: 1,
      new_score: 20512,
      new_tier: 10,
      new_merges: 450,
      new_duration_ms: 120000,
    })
    expect(transport.restoreAccountProgress).toHaveBeenCalledOnce()
  })

  it('preserves the guest edit payload without replacing collectible metadata', async () => {
    await new BossService().updateGuestScore(101, 9000, 10, 300, 120000)

    expect(transport.rpc).toHaveBeenCalledExactlyOnceWith('boss_update_guest_score', {
      target_score_id: 101,
      new_score: 9000,
      new_tier: 10,
      new_merges: 300,
      new_duration_ms: 120000,
    })
    expect(transport.restoreAccountProgress).not.toHaveBeenCalled()
  })

})
