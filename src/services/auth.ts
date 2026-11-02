import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

import {
  cloneSave,
  freshSave,
  getSaveOwnerId,
  loadSave,
  normalizeSave,
  resetSave,
  setCloudSyncHandler,
  setSaveOwnerId,
  writeSave,
  type LeaderboardEntry,
  type SaveDataV1,
} from '../game/state/save'

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  email?: string
  created_at: string
  updated_at: string
}

export interface Score {
  id: number
  user_id: string
  score: number
  tier_reached: number
  balls_merged: number
  duration_ms: number
  created_at: string
  profiles?: Profile
}

/** Resolve a profile's display name: prefer display_name, fall back to username, then 'Anonymous'. */
export function resolveDisplayName(profile: Profile | null | undefined): string {
  return profile?.display_name || profile?.username || 'Anonymous'
}

function mergeSavesForSameUser(
  a: Partial<SaveDataV1> | null | undefined,
  b: Partial<SaveDataV1> | null | undefined,
): SaveDataV1 {
  const sa = normalizeSave(a)
  const sb = normalizeSave(b)

  const discovered: Record<string, number> = { ...sa.discovered }
  for (const [k, v] of Object.entries(sb.discovered)) {
    if (discovered[k] == null || v < discovered[k]!) {
      discovered[k] = v
    }
  }

  const variants: Record<string, number> = { ...sa.variants }
  for (const [k, v] of Object.entries(sb.variants)) {
    if (variants[k] == null || v < variants[k]!) {
      variants[k] = v
    }
  }

  const seenLb = new Set<string>()
  const leaderboard: LeaderboardEntry[] = []
  for (const entry of [...sa.leaderboard, ...sb.leaderboard]) {
    const key = `${entry.score}:${entry.bestTier}:${Math.floor(entry.at / 1000)}`
    if (!seenLb.has(key)) {
      seenLb.add(key)
      leaderboard.push({ ...entry })
    }
  }
  leaderboard.sort((x, y) => y.score - x.score || y.at - x.at)

  return normalizeSave({
    version: 1,
    best: Math.max(sa.best, sb.best),
    leaderboard: leaderboard.slice(0, 10),
    discovered,
    variants,
    settings: {
      theme: sb.settings.theme !== 'auto' ? sb.settings.theme : sa.settings.theme,
    },
    stats: {
      runs: Math.max(sa.stats.runs, sb.stats.runs),
      merges: Math.max(sa.stats.merges, sb.stats.merges),
      bestTier: Math.max(sa.stats.bestTier, sb.stats.bestTier),
    },
  })
}

function reconcileSaveWithUserScores(
  base: SaveDataV1,
  scores: Score[],
): { save: SaveDataV1; changed: boolean } {
  if (!scores.length) return { save: base, changed: false }

  const next = cloneSave(base)
  let changed = false

  const maxScore = Math.max(0, ...scores.map((s) => s.score || 0))
  const maxTier = Math.max(0, ...scores.map((s) => s.tier_reached || 0))
  const totalRuns = scores.length
  const totalMerges = scores.reduce((sum, s) => sum + (s.balls_merged || 0), 0)

  if (maxScore > next.best) {
    next.best = maxScore
    changed = true
  }
  if (totalRuns > next.stats.runs) {
    next.stats.runs = totalRuns
    changed = true
  }
  if (totalMerges > next.stats.merges) {
    next.stats.merges = totalMerges
    changed = true
  }
  if (maxTier > next.stats.bestTier) {
    next.stats.bestTier = maxTier
    changed = true
  }

  for (const s of scores) {
    const ts = Date.parse(s.created_at) || Date.now()
    const tierCap = Math.min(12, Math.max(1, s.tier_reached || 1))
    for (let t = 1; t <= tierCap; t++) {
      if (next.discovered[String(t)] == null) {
        next.discovered[String(t)] = ts
        changed = true
      }
    }
    for (const collectibleTier of [8, 9, 10, 11, 12]) {
      if (collectibleTier <= tierCap) {
        const prefix = `${collectibleTier}:`
        const hasAnyVariant = Object.keys(next.variants).some((k) => k.startsWith(prefix))
        if (!hasAnyVariant) {
          next.variants[`${collectibleTier}:0`] = ts
          changed = true
        }
      }
    }
  }

  const scoreEntries: LeaderboardEntry[] = scores.slice(0, 10).map((s) => ({
    score: s.score || 0,
    bestTier: Math.max(1, Math.min(12, s.tier_reached || 1)),
    at: Date.parse(s.created_at) || Date.now(),
  }))
  if (next.leaderboard.length < scoreEntries.length || (scoreEntries[0]?.score ?? 0) > (next.leaderboard[0]?.score ?? 0)) {
    const combined = mergeSavesForSameUser(next, { version: 1, leaderboard: scoreEntries })
    next.leaderboard = combined.leaderboard
    changed = true
  }

  return { save: normalizeSave(next), changed }
}

export class AuthService {
  private static instance: AuthService
  private user: User | null = null
  private session: Session | null = null
  private profile: Profile | null = null
  private authStateListeners: Set<(authenticated: boolean) => void> = new Set()
  private authFlowInProgress: 'login' | 'signup' | 'logout' | null = null
  private isUpdatingProgressMeta = false
  private userProgressTableAvailable: boolean | null = null
  private cloudSyncTimer: ReturnType<typeof setTimeout> | null = null
  private pendingCloudSave: SaveDataV1 | null = null

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService()
    }
    return AuthService.instance
  }

  /** Subscribe to auth state changes. Returns unsubscribe function. */
  onAuthStateChange(callback: (authenticated: boolean) => void): () => void {
    this.authStateListeners.add(callback)
    return () => this.authStateListeners.delete(callback)
  }

  private notifyAuthStateChange(): void {
    const authenticated = this.user !== null
    this.authStateListeners.forEach((cb) => cb(authenticated))
  }

  private cancelScheduledCloudSync(): void {
    if (this.cloudSyncTimer) {
      clearTimeout(this.cloudSyncTimer)
      this.cloudSyncTimer = null
    }
    this.pendingCloudSave = null
  }

  private scheduleCloudSync(save: SaveDataV1, immediate: boolean): void {
    const user = this.user
    if (!user || this.authFlowInProgress === 'logout') return
    if (getSaveOwnerId() !== user.id) return

    this.pendingCloudSave = cloneSave(save)
    if (immediate) {
      if (this.cloudSyncTimer) {
        clearTimeout(this.cloudSyncTimer)
        this.cloudSyncTimer = null
      }
      const toFlush = this.pendingCloudSave
      this.pendingCloudSave = null
      void this.persistSaveToCloud(toFlush, user.id)
      return
    }

    if (this.cloudSyncTimer) return
    const targetUid = user.id
    this.cloudSyncTimer = setTimeout(() => {
      this.cloudSyncTimer = null
      const toFlush = this.pendingCloudSave
      this.pendingCloudSave = null
      if (toFlush && this.user?.id === targetUid && getSaveOwnerId() === targetUid) {
        void this.persistSaveToCloud(toFlush, targetUid)
      }
    }, 1500)
  }

  async initialize(): Promise<void> {
    setCloudSyncHandler((save, immediate) => this.scheduleCloudSync(save, immediate))

    const {
      data: { session },
    } = await supabase.auth.getSession()
    this.session = session
    this.user = session?.user ?? null

    if (this.user) {
      const prevOwner = getSaveOwnerId()
      if (prevOwner !== this.user.id) {
        resetSave({ syncCloud: false, clearOwner: false })
        setSaveOwnerId(this.user.id)
      }
      await Promise.all([this.fetchProfile(), this.restoreAccountProgress(this.user)])
      this.notifyAuthStateChange()
    } else if (getSaveOwnerId() !== null) {
      // Booted signed-out, but localStorage still held a save from a previous account: clear it.
      resetSave({ syncCloud: false, clearOwner: true })
    }

    supabase.auth.onAuthStateChange(async (event, nextSession) => {
      this.session = nextSession
      this.user = nextSession?.user ?? null

      // Ignore background user_metadata progress updates or flows already managed inline.
      if (event === 'USER_UPDATED' && this.isUpdatingProgressMeta) {
        return
      }
      if (this.authFlowInProgress !== null) {
        return
      }

      if (event === 'SIGNED_IN' && this.user) {
        const prevOwner = getSaveOwnerId()
        if (prevOwner !== this.user.id) {
          resetSave({ syncCloud: false, clearOwner: false })
          setSaveOwnerId(this.user.id)
        }
        await Promise.all([this.fetchProfile(), this.restoreAccountProgress(this.user)])
        this.notifyAuthStateChange()
      } else if (event === 'SIGNED_OUT') {
        this.cancelScheduledCloudSync()
        this.profile = null
        resetSave({ syncCloud: false, clearOwner: true })
        this.notifyAuthStateChange()
      }
    })
  }

  async signInWithEmail(email: string, password: string): Promise<{ error: Error | null }> {
    this.cancelScheduledCloudSync()
    this.authFlowInProgress = 'login'
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error || !data.user) {
        return { error: error ?? new Error('Failed to sign in') }
      }

      this.session = data.session
      this.user = data.user

      // Never carry guest or previous account local progress into an existing account on login.
      if (getSaveOwnerId() !== data.user.id) {
        resetSave({ syncCloud: false, clearOwner: false })
        setSaveOwnerId(data.user.id)
      }

      await Promise.all([this.fetchProfile(), this.restoreAccountProgress(data.user)])
      this.notifyAuthStateChange()
      return { error: null }
    } finally {
      this.authFlowInProgress = null
    }
  }

  async signUpWithEmail(email: string, password: string, username: string): Promise<{ error: Error | null }> {
    const guestSave = getSaveOwnerId() === null ? cloneSave(loadSave()) : freshSave()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          ballrush_progress: guestSave,
        },
      },
    })
    return { error }
  }

  /**
   * Sign in with username + password. Looks up the user's email from their
   * profile (populated by the handle_new_user trigger), then delegates to
   * Supabase email auth.
   */
  async signInWithUsername(username: string, password: string): Promise<{ error: Error | null }> {
    const { data: profile, error: lookupError } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', username)
      .maybeSingle()

    if (lookupError || !profile?.email) {
      return { error: new Error('Invalid username or password') }
    }

    return this.signInWithEmail(profile.email, password)
  }

  /**
   * Sign up with username + password. Email is optional for password recovery.
   * If the player was playing as a guest (not logged in), their guest
   * progression transfers to the newly created account.
   */
  async signUpWithUsername(username: string, password: string, email?: string): Promise<{ error: Error | null }> {
    const { data: existing, error: lookupError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (lookupError) {
      return { error: new Error('Failed to check username availability') }
    }

    if (existing) {
      return { error: new Error('Username is already taken') }
    }

    // Capture genuine guest progress BEFORE signing up so we can transfer it to the new account.
    const hadGuestProgress = getSaveOwnerId() === null
    const guestSave = hadGuestProgress ? cloneSave(loadSave()) : freshSave()

    const authEmail = email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@ballrush.local`

    this.cancelScheduledCloudSync()
    this.authFlowInProgress = 'signup'
    try {
      const { error } = await supabase.auth.signUp({
        email: authEmail,
        password,
        options: {
          data: {
            username,
            ballrush_progress: guestSave,
          },
        },
      })

      if (error) {
        return { error }
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      })

      if (signInError || !signInData.user) {
        return { error: signInError ?? new Error('Failed to establish session after sign up') }
      }

      this.session = signInData.session
      this.user = signInData.user

      // Bind transferred guest progression to the newly created account.
      writeSave(guestSave, { syncCloud: false, ownerId: signInData.user.id })
      await Promise.all([
        this.fetchProfile(),
        this.persistSaveToCloud(guestSave, signInData.user.id),
      ])

      // If the guest already had a best score, also record their top run in public.scores
      // so the global leaderboard reflects their transferred progression immediately.
      if (hadGuestProgress && guestSave.best > 0) {
        const topEntry = guestSave.leaderboard[0]
        const bestTier = Math.max(1, topEntry?.bestTier ?? guestSave.stats.bestTier ?? 1)
        await ScoreService.getInstance().submitScore(
          guestSave.best,
          bestTier,
          guestSave.stats.merges,
          0,
        )
      }

      this.notifyAuthStateChange()
      return { error: null }
    } finally {
      this.authFlowInProgress = null
    }
  }

  /**
   * Send password reset email.
   */
  async resetPassword(email: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error }
  }

  async signInWithOAuth(provider: 'google' | 'github' | 'discord'): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    })
    return { error }
  }

  async signOut(): Promise<void> {
    this.cancelScheduledCloudSync()
    this.authFlowInProgress = 'logout'
    try {
      // Flush the active account's current progress to cloud BEFORE signing out.
      if (this.user && getSaveOwnerId() === this.user.id) {
        await this.persistSaveToCloud(cloneSave(loadSave()), this.user.id)
      }
      await supabase.auth.signOut()
      this.user = null
      this.session = null
      this.profile = null
      // Once logged out of an account, local progression resets to 0.
      resetSave({ syncCloud: false, clearOwner: true })
      this.notifyAuthStateChange()
    } finally {
      this.authFlowInProgress = null
    }
  }

  /**
   * Restore the authenticated account's progress from cloud sources
   * (`public.user_progress`, `user.user_metadata.ballrush_progress`, and `public.scores`).
   */
  async restoreAccountProgress(targetUser?: User): Promise<void> {
    const user = targetUser ?? this.user
    if (!user) return
    const userId = user.id

    const localSameOwnerSave = getSaveOwnerId() === userId ? cloneSave(loadSave()) : null

    const [freshUserRes, scoresRes, tableRes] = await Promise.all([
      supabase.auth.getUser().catch(() => ({ data: { user: null } })),
      supabase
        .from('scores')
        .select('*')
        .eq('user_id', userId)
        .order('score', { ascending: false })
        .limit(100),
      this.userProgressTableAvailable === false
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from('user_progress')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
    ])

    if (this.user?.id !== userId) return

    if (tableRes.error) {
      const code = tableRes.error.code ?? ''
      const msg = tableRes.error.message ?? ''
      if (code === 'PGRST205' || code === '42P01' || msg.includes('user_progress')) {
        this.userProgressTableAvailable = false
      }
    } else if (this.userProgressTableAvailable === null) {
      this.userProgressTableAvailable = true
    }

    const latestUser = freshUserRes.data?.user ?? user
    const rawMetaProgress = latestUser?.user_metadata?.ballrush_progress as Partial<SaveDataV1> | undefined
    const metaSave =
      rawMetaProgress && typeof rawMetaProgress === 'object' ? normalizeSave(rawMetaProgress) : null

    const row = tableRes.data as {
      best_score?: number
      discovered?: Record<string, number>
      variants?: Record<string, number>
      stats?: { runs: number; merges: number; bestTier: number }
      leaderboard?: LeaderboardEntry[]
      settings?: { theme: SaveDataV1['settings']['theme'] }
    } | null
    const tableSave = row
      ? normalizeSave({
          version: 1,
          best: row.best_score ?? 0,
          discovered: row.discovered ?? {},
          variants: row.variants ?? {},
          stats: row.stats ?? { runs: 0, merges: 0, bestTier: 0 },
          leaderboard: Array.isArray(row.leaderboard) ? row.leaderboard : [],
          settings: row.settings ?? { theme: 'auto' },
        })
      : null

    let combined = freshSave()
    if (tableSave) combined = mergeSavesForSameUser(combined, tableSave)
    if (metaSave) combined = mergeSavesForSameUser(combined, metaSave)
    if (localSameOwnerSave) combined = mergeSavesForSameUser(combined, localSameOwnerSave)

    const userScores = Array.isArray(scoresRes.data) ? (scoresRes.data as Score[]) : []
    const { save: finalSave, changed: healedFromScores } = reconcileSaveWithUserScores(combined, userScores)

    if (this.user?.id !== userId) return

    writeSave(finalSave, { syncCloud: false, ownerId: userId })

    // If scores or same-owner local data healed missing cloud metadata, persist back to cloud.
    const hadCloudRecord = Boolean(metaSave || tableSave)
    const hasProgress =
      finalSave.best > 0 ||
      finalSave.stats.runs > 0 ||
      finalSave.stats.merges > 0 ||
      Object.keys(finalSave.discovered).length > 3
    if (healedFromScores || (!hadCloudRecord && hasProgress)) {
      void this.persistSaveToCloud(finalSave, userId)
    }
  }

  /**
   * Save account progress to Supabase Auth metadata (`ballrush_progress`)
   * and `public.user_progress` (when present).
   */
  async persistSaveToCloud(saveData?: Partial<SaveDataV1>, expectedUserId?: string): Promise<void> {
    const user = this.user
    if (!user) return
    const uid = expectedUserId ?? user.id
    if (user.id !== uid) return
    if (getSaveOwnerId() !== uid) return

    const save = normalizeSave(saveData ?? loadSave())

    // 1. Always persist in the user's Supabase Auth metadata (works without schema migrations).
    this.isUpdatingProgressMeta = true
    try {
      const { data } = await supabase.auth.updateUser({
        data: {
          ballrush_progress: save,
        },
      })
      if (data?.user && this.user?.id === uid) {
        this.user = data.user
      }
    } catch (err) {
      console.error('Failed to update user progress metadata:', err)
    } finally {
      this.isUpdatingProgressMeta = false
    }

    // 2. Also upsert into public.user_progress if the table exists on the project.
    if (this.userProgressTableAvailable !== false && this.user?.id === uid) {
      try {
        const nowIso = new Date().toISOString()
        const fullRow = {
          user_id: uid,
          best_score: save.best,
          discovered: save.discovered,
          variants: save.variants,
          stats: save.stats,
          leaderboard: save.leaderboard,
          settings: save.settings,
          updated_at: nowIso,
        }
        const { error } = await supabase.from('user_progress').upsert(fullRow, { onConflict: 'user_id' })
        if (error) {
          const code = error.code ?? ''
          const msg = error.message ?? ''
          if (code === 'PGRST205' || code === '42P01' || msg.includes('user_progress')) {
            this.userProgressTableAvailable = false
          } else if (code === 'PGRST204') {
            // Fallback if leaderboard/settings columns were not migrated yet.
            await supabase.from('user_progress').upsert(
              {
                user_id: uid,
                best_score: save.best,
                discovered: save.discovered,
                variants: save.variants,
                stats: save.stats,
                updated_at: nowIso,
              },
              { onConflict: 'user_id' },
            )
          }
        } else {
          this.userProgressTableAvailable = true
        }
      } catch {
        // Metadata persistence above already succeeded.
      }
    }
  }
  async fetchProfile(): Promise<Profile | null> {
    if (!this.user) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', this.user.id)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      return null
    }

    this.profile = data
    return data
  }

  async updateProfile(updates: Partial<Profile>): Promise<{ error: Error | null }> {
    if (!this.user) return { error: new Error('Not authenticated') }

    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', this.user.id)

    if (!error) {
      await this.fetchProfile()
    }

    return { error }
  }

  /**
   * Update the user's display name (nickname shown on leaderboard).
   */
  async updateDisplayName(displayName: string): Promise<{ error: Error | null }> {
    if (!this.user) return { error: new Error('Not authenticated') }

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('id', this.user.id)

    if (!error) {
      await this.fetchProfile()
    }

    return { error }
  }

  getUser(): User | null {
    return this.user
  }

  getSession(): Session | null {
    return this.session
  }

  getProfile(): Profile | null {
    return this.profile
  }

  isAuthenticated(): boolean {
    return this.user !== null
  }
}

export class ScoreService {
  private static instance: ScoreService
  private lastSubmitted: {
    userId: string
    score: number
    tierReached: number
    at: number
  } | null = null

  static getInstance(): ScoreService {
    if (!ScoreService.instance) {
      ScoreService.instance = new ScoreService()
    }
    return ScoreService.instance
  }

  async submitScore(
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<{ error: Error | null }> {
    const auth = AuthService.getInstance()
    const user = auth.getUser()

    if (!user) {
      return { error: new Error('Not authenticated') }
    }

    const now = Date.now()
    if (
      this.lastSubmitted &&
      this.lastSubmitted.userId === user.id &&
      this.lastSubmitted.score === score &&
      this.lastSubmitted.tierReached === tierReached &&
      now - this.lastSubmitted.at < 30_000
    ) {
      return { error: null }
    }
    this.lastSubmitted = { userId: user.id, score, tierReached, at: now }

    const { error } = await supabase.from('scores').insert({
      user_id: user.id,
      score,
      tier_reached: tierReached,
      balls_merged: ballsMerged,
      duration_ms: durationMs,
    })

    if (error) {
      this.lastSubmitted = null
    }

    return { error }
  }

  async getLeaderboard(limit = 100): Promise<Score[]> {
    // Fetch all scores, then dedupe to keep only each user's highest score
    const { data, error } = await supabase
      .from('scores')
      .select(`
        *,
        profiles:user_id (
          id,
          username,
          display_name,
          avatar_url
        )
      `)
      .order('score', { ascending: false })

    if (error) {
      console.error('Error fetching leaderboard:', error)
      return []
    }

    // Keep only the highest score per user
    const seenUsers = new Set<string>()
    const uniqueScores: Score[] = []
    for (const score of data as Score[]) {
      if (!seenUsers.has(score.user_id)) {
        seenUsers.add(score.user_id)
        uniqueScores.push(score)
        if (uniqueScores.length >= limit) break
      }
    }

    return uniqueScores
  }

  async getUserBestScore(): Promise<Score | null> {
    const auth = AuthService.getInstance()
    const user = auth.getUser()

    if (!user) return null

    const { data, error } = await supabase
      .from('scores')
      .select('*')
      .eq('user_id', user.id)
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return null
    }

    return data
  }

  async getUserScores(limit = 10): Promise<Score[]> {
    const auth = AuthService.getInstance()
    const user = auth.getUser()

    if (!user) return []

    const { data, error } = await supabase
      .from('scores')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Error fetching user scores:', error)
      return []
    }

    return data
  }
}

/**
 * Load account progress from cloud to local storage.
 */
export async function loadCloudProgressToLocal(): Promise<void> {
  await AuthService.getInstance().restoreAccountProgress()
}

/**
 * Save current progress to cloud.
 */
export async function saveProgressToCloud(saveData?: Partial<SaveDataV1>): Promise<void> {
  await AuthService.getInstance().persistSaveToCloud(saveData)
}
export const authService = AuthService.getInstance()
export const scoreService = ScoreService.getInstance()
