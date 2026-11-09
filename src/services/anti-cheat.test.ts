import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { WallAnimator } from '../game/systems/WallAnimator'
import { ShakeManager } from '../game/systems/ShakeManager'
import { ScoreSystem } from '../game/systems/ScoreSystem'
import { normalizeUpgradeLevels, upgradeCost, wallDurationMs, shakeDurationMs, shakeImpulseMultiplier } from '../config/abilityUpgrades'
import { loadSave, recordRunEnd, resetSave, setSaveOwnerId, spendCoins, writeSave } from '../game/state/save'
import { reviveCostForCount } from '../config/gameOver'
import { AuthService, ScoreService } from './auth'

const sdk = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(),
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
  },
}))

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    rpc: sdk.rpc,
    from: sdk.from,
    auth: sdk.auth,
  }),
}))
vi.mock('phaser', () => ({ default: {} }))
function deferred<T>() {
  // The project's ES2022 libraries do not expose Promise.withResolvers.
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}


describe('Attacker-Style Security & Anti-Cheat Suite', () => {
  beforeEach(() => {
    sdk.rpc.mockReset()
    sdk.from.mockReset()
    sdk.auth.getUser.mockReset()
    sdk.auth.signInWithPassword.mockReset()
    resetSave()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Ability Cooldown & Duration Tampering', () => {
    it('clamps extreme numeric or Infinity durations in WallAnimator and refuses re-activation while active', () => {
      let now = 1000
      const walls = new WallAnimator()
      walls.setClock(() => now)

      // Attacker attempts to pass 999,999,999 ms hold duration
      expect(walls.activate(999_999_999)).toBe(true)
      // Must be clamped to max 25,000 ms hold + 1,800 ms raise/lower animation = 26,800 ms
      expect(walls.animationDurationMs()).toBe(26_800)

      // Attacker attempts to re-trigger while raising/raised
      expect(walls.activate(999_999_999)).toBe(false)

      // Advance past raise animation (900ms) into raised phase
      now += 950
      walls.update(now)
      expect(walls.phaseNow).toBe('raised')
      expect(walls.remainingMs).toBeLessThanOrEqual(25_000)

      // Advance past 25,000ms hold into lowering phase
      now += 25_050
      walls.update(now)
      expect(walls.phaseNow).toBe('lowering')

      // Advance past 900ms lower animation into normal phase
      now += 950
      walls.update(now)
      expect(walls.isActive).toBe(false)
    })

    it('clamps forged upgrade levels in WallAnimator and ShakeManager to hard maximums', () => {
      let now = 5000
      const walls = new WallAnimator()
      walls.setClock(() => now)
      const forgedUpgrades = {
        wallDuration: 999999,
        shakeDuration: 999999,
        shakeIntensity: 999999,
      }

      expect(walls.activate(forgedUpgrades)).toBe(true)
      expect(walls.animationDurationMs()).toBe(26_800)

      const shake = new ShakeManager()
      shake.setClock(() => now)
      expect(shake.activate(forgedUpgrades)).toBe(true)
      expect(shake.remainingMs).toBe(10_000)
      // Second activation while active is rejected
      expect(shake.activate(forgedUpgrades)).toBe(false)

      // After 10,000ms max duration, shake expires
      now += 10_001
      shake.update(now, 16)
      expect(shake.isActive).toBe(false)
      expect(shake.remainingMs).toBe(0)
    })

    it('normalizes malformed, negative, NaN, or oversized upgrade levels in config helpers', () => {
      const normalized = normalizeUpgradeLevels({
        wallDuration: Infinity,
        shakeDuration: -50,
        shakeIntensity: 999,
        extraHackKey: 100,
      })
      expect(normalized).toEqual({
        wallDuration: 0,
        shakeDuration: 0,
        shakeIntensity: 5,
      })
      expect(wallDurationMs({ wallDuration: 999, shakeDuration: 0, shakeIntensity: 0 })).toBe(25_000)
      expect(shakeDurationMs({ wallDuration: 0, shakeDuration: 999, shakeIntensity: 0 })).toBe(10_000)
      expect(shakeImpulseMultiplier({ wallDuration: 0, shakeDuration: 0, shakeIntensity: 999 })).toBeCloseTo(1.5)
      expect(upgradeCost('wallDuration', 10)).toBe(0)
      expect(upgradeCost('shakeIntensity', 5)).toBe(0)
    })

    it('blocks session ability activation for anonymous guests and forwards authenticated activations to RPC', async () => {
      const scoreSvc = new ScoreService()
      scoreSvc.startNewRun()
      const auth = AuthService.getInstance()

      vi.spyOn(auth, 'isRegisteredAccount').mockReturnValue(false)
      const guestAttempt = await scoreSvc.activateSessionAbility('shake')
      expect(guestAttempt.error?.message).toBe('Registered account required')
      expect(sdk.rpc).not.toHaveBeenCalled()

      vi.spyOn(auth, 'isRegisteredAccount').mockReturnValue(true)
      sdk.rpc.mockResolvedValueOnce({
        data: { session_id: scoreSvc.getActiveRunId(), ability: 'shake' },
        error: null,
      })
      const userAttempt = await scoreSvc.activateSessionAbility('shake')
      expect(userAttempt.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('activate_session_ability', {
        p_session_id: scoreSvc.getActiveRunId(),
        p_ability: 'shake',
      })
    })
  })

  describe('Coin & Upgrade LocalStorage Tampering', () => {
    it('overwrites tampered localStorage coins and upgrades with authoritative server values during sync', async () => {
      const auth = AuthService.getInstance()
      const fakeUser = { id: 'user-123', app_metadata: { provider: 'email' } } as unknown as User
      vi.spyOn(auth, 'getUser').mockReturnValue(fakeUser)
      Reflect.set(auth, 'user', fakeUser)
      setSaveOwnerId('user-123')

      // Attacker edits localStorage save to 1,000,000 coins and max upgrades
      writeSave(
        {
          ...loadSave(),
          coins: 1_000_000,
          coinRevision: 999,
          upgrades: { wallDuration: 10, shakeDuration: 10, shakeIntensity: 5 },
        },
        { syncCloud: false, ownerId: 'user-123' },
      )

      // Server returns authoritative balance (12.5 coins, level 0 upgrades)
      sdk.rpc.mockResolvedValueOnce({
        data: {
          coins: 12.5,
          coin_revision: 3,
          upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
        },
        error: null,
      })

      await auth.persistSaveToCloud(undefined, 'user-123')

      const reconciled = loadSave()
      expect(reconciled.coins).toBe(12.5)
      expect(reconciled.coinRevision).toBe(3)
      expect(reconciled.upgrades).toEqual({
        wallDuration: 0,
        shakeDuration: 0,
        shakeIntensity: 0,
      })
    })

    it('computes doubling revive costs (25 -> 50 -> 100 -> 200...) and deducts coins without double-crediting continued runs', async () => {
      expect(reviveCostForCount(0)).toBe(25)
      expect(reviveCostForCount(1)).toBe(50)
      expect(reviveCostForCount(2)).toBe(100)
      expect(reviveCostForCount(3)).toBe(200)

      resetSave()
      writeSave({ ...loadSave(), coins: 80 }, { syncCloud: false })
      expect(spendCoins(25)).toBe(true)
      expect(loadSave().coins).toBe(55)
      expect(spendCoins(50)).toBe(true)
      expect(loadSave().coins).toBe(5)
      expect(spendCoins(100)).toBe(false)
      expect(loadSave().coins).toBe(5)

      // Guest run continuation does not double-count runs or coins
      const runAt = 1_700_000_000_000
      recordRunEnd(1000, 5, 10, { runAt })
      expect(loadSave().stats.runs).toBe(1)
      expect(loadSave().coins).toBe(6) // 5 + 1.0 coin from 1000 score

      // Revived and reached 2500 score in the same run -> +1.5 incremental coins
      recordRunEnd(2500, 6, 18, { previousScore: 1000, runAt })
      expect(loadSave().stats.runs).toBe(1)
      expect(loadSave().coins).toBe(7.5)
      expect(loadSave().leaderboard).toHaveLength(1)
      expect(loadSave().leaderboard[0]?.score).toBe(2500)
    })

    it('preserves immediate revive coin deduction while an earlier sync_user_progress is still in flight', async () => {
      const auth = AuthService.getInstance()
      const fakeUser = { id: 'user-revive', app_metadata: { provider: 'email' } } as unknown as User
      ;(auth as unknown as { user: User | null }).user = fakeUser
      setSaveOwnerId('user-revive')
      writeSave(
        { ...loadSave(), coins: 100, coinRevision: 4 },
        { syncCloud: false, ownerId: 'user-revive' },
      )

      ;(auth as unknown as { cloudSaveChain: Promise<void> }).cloudSaveChain = Promise.resolve()
      const { promise: syncRpcPromise, resolve: resolveSync } =
        deferred<{ data: unknown; error: null }>()
      sdk.rpc.mockImplementationOnce(() => syncRpcPromise)
      sdk.rpc.mockResolvedValueOnce({
        data: {
          coins: 75,
          coin_revision: 5,
          upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
        },
        error: null,
      })

      // Game over starts a sync_user_progress call in the background
      const syncPromise = auth.persistSaveToCloud(undefined, 'user-revive')

      // Player clicks REVIVE (25 coins) while sync is still awaiting server
      const revivePromise = auth.purchaseRevive(0, '00000000-0000-4000-8000-000000000001')

      // Immediate local deduction must show 75 right away
      expect(loadSave().coins).toBe(75)

      // Earlier sync resolves with pre-revive server balance (100) — must NOT overwrite 75 back to 100
      resolveSync({
        data: {
          coins: 100,
          coin_revision: 4,
          upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
        },
        error: null,
      })
      await syncPromise
      expect(loadSave().coins).toBe(75)

      await revivePromise
      expect(loadSave().coins).toBe(75)
      expect(loadSave().coinRevision).toBe(5)
    })
  })

  describe('Score Calculation & Privacy Hardening', () => {
    it('ignores invalid tiers and caps chain multiplier at 8x in ScoreSystem', () => {
      const score = new ScoreSystem()
      expect(score.award(999, 1)).toBe(0)
      expect(score.award(-1, 5)).toBe(0)
      expect(score.score).toBe(0)

      // Tier 1 base score is 2; chainDepth 100 must cap at 8x = 16 points
      expect(score.award(1, 100)).toBe(16)
      expect(score.score).toBe(16)
    })

    it('uses resolve_username_email RPC for username login without exposing profiles.email table reads', async () => {
      const auth = AuthService.getInstance()
      sdk.rpc.mockResolvedValueOnce({ data: 'player@ballrush.local', error: null })
      const signInSpy = vi.spyOn(auth, 'signInWithEmail').mockResolvedValue({ error: null })

      const res = await auth.signInWithUsername('PlayerOne', 'secret123')
      expect(res.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('resolve_username_email', { p_username: 'PlayerOne' })
      expect(signInSpy).toHaveBeenCalledWith('player@ballrush.local', 'secret123')
      expect(sdk.from).not.toHaveBeenCalled()
    })
  })
})
