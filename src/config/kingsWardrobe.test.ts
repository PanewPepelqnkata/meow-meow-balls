import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import {
  ACHIEVEMENT_CATALOG,
  WARDROBE_CHARACTERS,
  buildFallbackOverviewFromSave,
  formatPlaytime,
  getTitleNameById,
  getUnlockedCharacterIdsFromSave,
  getWardrobeCharacter,
  isCharacterUnlockedInSave,
  isValidWardrobeCharacterId,
  validateFavoriteBallIds,
  validateRoyalUsername,
} from '../config/kingsWardrobe'
import { freshSave, loadSave, resetSave, setSaveOwnerId, writeSave } from '../game/state/save'
import { gameBus } from '../game/events/gameBus'
import { AuthService } from '../services/auth'

const sdk = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(),
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    rpc: sdk.rpc,
    from: sdk.from,
    auth: sdk.auth,
  }),
}))

describe("The King's Wardrobe — Catalog, Validation & AuthService Security", () => {
  beforeEach(() => {
    sdk.rpc.mockReset()
    sdk.from.mockReset()
    sdk.auth.getUser.mockReset()
    sdk.auth.signOut.mockReset()
    resetSave()
  })

  describe('Royal Username Validation & Normalization', () => {
    it('accepts valid royal usernames with letters, numbers, and single internal underscores', () => {
      expect(validateRoyalUsername('Sir_Bounce_99')).toEqual({
        valid: true,
        normalized: 'Sir_Bounce_99',
        error: null,
      })
      expect(validateRoyalUsername('  CrownKnight  ')).toEqual({
        valid: true,
        normalized: 'CrownKnight',
        error: null,
      })
    })

    it('rejects empty, too short (<3), or too long (>20) usernames', () => {
      expect(validateRoyalUsername('')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('ab')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('a'.repeat(21))).toMatchObject({ valid: false })
    })

    it('rejects invalid characters, leading/trailing underscores, and double underscores', () => {
      expect(validateRoyalUsername('bad name')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('bad-name!')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('_leading')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('trailing_')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('double__under')).toMatchObject({ valid: false })
    })

    it('rejects reserved system names and profanity/slurs including leetspeak', () => {
      expect(validateRoyalUsername('admin')).toMatchObject({ valid: false })
      expect(validateRoyalUsername(' BALL_RUSH ')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('king')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('f_u_c_k')).toMatchObject({ valid: true }) // discrete letters allowed, contiguous profanity blocked
      expect(validateRoyalUsername('superfuck99')).toMatchObject({ valid: false })
      expect(validateRoyalUsername('sh1thead')).toMatchObject({ valid: false })
    })
  })

  describe('Canonical Ball Character & Favorite Showcase Validation', () => {
    it('recognizes all 14 canonical Ball Rush characters and rejects arbitrary IDs', () => {
      expect(WARDROBE_CHARACTERS).toHaveLength(14)
      for (const char of WARDROBE_CHARACTERS) {
        expect(isValidWardrobeCharacterId(char.id)).toBe(true)
        expect(getWardrobeCharacter(char.id).name).toBe(char.name)
      }
      expect(isValidWardrobeCharacterId('core:99')).toBe(false)
      expect(isValidWardrobeCharacterId('collectible:9:dragon')).toBe(false)
      expect(isValidWardrobeCharacterId('')).toBe(false)
      expect(getWardrobeCharacter('nonexistent').id).toBe('core:1')
    })

    it('determines unlocked characters accurately from SaveDataV1', () => {
      const save = freshSave()
      // Starter trio (core:1..3) is always unlocked
      expect(isCharacterUnlockedInSave(save, 'core:1')).toBe(true)
      expect(isCharacterUnlockedInSave(save, 'core:2')).toBe(true)
      expect(isCharacterUnlockedInSave(save, 'core:3')).toBe(true)
      expect(isCharacterUnlockedInSave(save, 'core:4')).toBe(false)
      expect(isCharacterUnlockedInSave(save, 'collectible:9:shark')).toBe(false)

      save.discovered['6'] = 1700000000000
      save.variants['9:shark:2'] = 1700000000000
      expect(isCharacterUnlockedInSave(save, 'core:6')).toBe(true)
      expect(isCharacterUnlockedInSave(save, 'collectible:9:shark')).toBe(true)
      expect(getUnlockedCharacterIdsFromSave(save)).toEqual([
        'core:1',
        'core:2',
        'core:3',
        'core:6',
        'collectible:9:shark',
      ])
    })

    it('enforces max 3 favorite balls, no duplicates, valid IDs, and unlock membership', () => {
      const unlocked = new Set(['core:1', 'core:2', 'core:3', 'collectible:9:shark'])
      expect(validateFavoriteBallIds(['core:1', 'collectible:9:shark'], unlocked)).toEqual({
        valid: true,
        normalized: ['core:1', 'collectible:9:shark'],
        error: null,
      })
      // More than 3
      expect(
        validateFavoriteBallIds(['core:1', 'core:2', 'core:3', 'collectible:9:shark'], unlocked),
      ).toMatchObject({ valid: false })
      // Duplicate
      expect(validateFavoriteBallIds(['core:1', 'core:1'], unlocked)).toMatchObject({ valid: false })
      // Locked ball
      expect(validateFavoriteBallIds(['core:8'], unlocked)).toMatchObject({ valid: false })
      // Invalid ball ID
      expect(validateFavoriteBallIds(['invalid:ball'], unlocked)).toMatchObject({ valid: false })
    })
  })

  describe('Achievements, Titles & Fallback Overview', () => {
    it('includes all 18 achievements across 5 categories and resolves title names', () => {
      expect(ACHIEVEMENT_CATALOG).toHaveLength(18)
      expect(getTitleNameById('royal_initiate')).toBe('Royal Initiate')
      expect(getTitleNameById('grand_curator')).toBe('Grand Curator')
      expect(getTitleNameById('legendary_adventurer')).toBe('Legendary Adventurer')
      expect(getTitleNameById(null)).toBeNull()
      expect(formatPlaytime(0)).toBe('0m')
      expect(formatPlaytime(125_000)).toBe('2m 5s')
      expect(formatPlaytime(7_380_000)).toBe('2h 3m')
    })

    it('builds a complete fallback overview from local save data when offline or guest', () => {
      const save = freshSave()
      save.best = 12_500
      save.stats.runs = 55
      save.stats.merges = 120
      save.stats.bestTier = 6
      save.discovered['4'] = 1000
      save.discovered['5'] = 1000
      save.discovered['6'] = 1000

      const overview = buildFallbackOverviewFromSave(save, null)
      expect(overview.statistics.best_score).toBe(12_500)
      expect(overview.statistics.games_played).toBe(55)
      expect(overview.unlocked_ball_ids).toContain('core:6')

      const unlockedIds = overview.achievements.filter((a) => a.unlocked).map((a) => a.id)
      expect(unlockedIds).toEqual(
        expect.arrayContaining([
          'first_run',
          'regular_player',
          'first_merge',
          'merge_apprentice',
          'first_discovery',
          'first_record',
          'high_scorer',
          'tier_climber',
        ]),
      )
    })
  })

  describe('AuthService RPC Integration & Newly Unlocked Achievement Notifications', () => {
    it('calls RPCs for username change, avatar, favorites, title, and account deletion with client pre-validation', async () => {
      const auth = new AuthService()
      const uid = 'aaaa1111-1111-4111-8111-111111111111'
      ;(auth as unknown as { user: User }).user = {
        id: uid,
        app_metadata: { provider: 'email' },
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      }
      vi.spyOn(auth, 'fetchProfile').mockResolvedValue(null)
      vi.spyOn(auth, 'signOut').mockResolvedValue()

      // Invalid username rejected before RPC
      const badName = await auth.changeUsernameOnce('admin')
      expect(badName.error).toBeTruthy()
      expect(sdk.rpc).not.toHaveBeenCalled()

      // Valid username calls change_username_once RPC
      sdk.rpc.mockResolvedValueOnce({ data: { username: 'SirLancelot' }, error: null })
      const okName = await auth.changeUsernameOnce('SirLancelot')
      expect(okName.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('change_username_once', { p_new_username: 'SirLancelot' })

      // Avatar selection calls set_selected_avatar RPC
      sdk.rpc.mockResolvedValueOnce({ data: { selected_avatar_id: 'core:3' }, error: null })
      const okAvatar = await auth.setSelectedAvatar('core:3')
      expect(okAvatar.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('set_selected_avatar', { p_avatar_id: 'core:3' })

      // Favorite balls calls save_favorite_balls RPC
      sdk.rpc.mockResolvedValueOnce({ data: { favorite_ball_ids: ['core:1', 'core:2'] }, error: null })
      const okFavs = await auth.saveFavoriteBalls(['core:1', 'core:2'])
      expect(okFavs.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('save_favorite_balls', {
        p_favorite_ball_ids: ['core:1', 'core:2'],
      })

      // Active title calls set_active_title RPC
      sdk.rpc.mockResolvedValueOnce({ data: { active_title_id: 'royal_initiate' }, error: null })
      const okTitle = await auth.setActiveTitle('royal_initiate')
      expect(okTitle.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('set_active_title', { p_title_id: 'royal_initiate' })

      // Delete account requires exact 'DELETE' confirmation
      const badDel = await auth.deleteOwnAccount('delete')
      expect(badDel.error).toBeTruthy()

      sdk.rpc.mockResolvedValueOnce({ data: { deleted_user_id: uid }, error: null })
      const okDel = await auth.deleteOwnAccount('DELETE')
      expect(okDel.error).toBeNull()
      expect(sdk.rpc).toHaveBeenCalledWith('delete_own_account', { p_confirmation: 'DELETE' })
      expect(auth.signOut).toHaveBeenCalled()
    })

    it('emits achievement:unlocked on gameBus when sync_user_progress returns newly unlocked achievements', async () => {
      const auth = new AuthService()
      const uid = 'aaaa1111-1111-4111-8111-111111111111'
      ;(auth as unknown as { user: User }).user = {
        id: uid,
        app_metadata: { provider: 'email' },
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      }
      setSaveOwnerId(uid)
      writeSave({ ...loadSave(), best: 1500, coinRevision: 2 }, { syncCloud: false, ownerId: uid })

      const unlockedEvents: Array<{ id: string; name: string; rewardTitleName: string | null }> = []
      const off = gameBus.on('achievement:unlocked', (ev) => {
        unlockedEvents.push({ id: ev.id, name: ev.name, rewardTitleName: ev.rewardTitleName })
      })

      sdk.rpc.mockResolvedValueOnce({
        data: {
          coins: 12.5,
          coin_revision: 3,
          upgrades: { wallDuration: 1, shakeDuration: 0, shakeIntensity: 0 },
          newly_unlocked_achievements: [
            {
              id: 'first_run',
              name: 'First Run',
              reward_title_id: 'royal_initiate',
              reward_title_name: 'Royal Initiate',
            },
          ],
        },
        error: null,
      })

      await auth.persistSaveToCloud(undefined, uid)
      off()

      expect(unlockedEvents).toEqual([
        {
          id: 'first_run',
          name: 'First Run',
          rewardTitleName: 'Royal Initiate',
        },
      ])
    })
  })
})
