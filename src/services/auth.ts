import { getSupabase } from '../lib/supabase'
import { isDrunkoTestRoute } from '../game/state/runVariant'
import type { AuthChangeEvent, User, Session } from '@supabase/supabase-js'

import {
  cloneSave,
  freshSave,
  getOrCreateGuestId,
  getSaveOwnerId,
  loadSave,
  normalizeSave,
  resetGuestId,
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

/** Restore score/tier progress only: scores contain no character or palette identity. */
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
  private initializationPromise: Promise<void> | null = null
  private awaitingInitialSession = true
  private sessionEnded = false
  private authStateRevision = 0
  private accountRevision = 0
  private authFlowRevision = 0
  private pendingAuthEvent = false
  private authFlowHasSession = false
  private authUpdateTimer: ReturnType<typeof setTimeout> | null = null
  private pendingAccountRestore = false
  private profileRequestRevision = 0

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
    // The /drunko run is deliberately ephemeral: even delayed save handlers
    // must not enqueue a guest or account progression write for this route.
    if (isDrunkoTestRoute()) {
      this.cancelScheduledCloudSync()
      return
    }
    if (this.authFlowInProgress === 'logout') return
    const user = this.user

    if (!user) {
      if (getSaveOwnerId() !== null) return
      this.pendingCloudSave = cloneSave(save)
      if (immediate) {
        if (this.cloudSyncTimer) {
          clearTimeout(this.cloudSyncTimer)
          this.cloudSyncTimer = null
        }
        const toFlush = this.pendingCloudSave
        this.pendingCloudSave = null
        void this.persistGuestSaveToCloud(toFlush)
        return
      }

      if (this.cloudSyncTimer) return
      this.cloudSyncTimer = setTimeout(() => {
        this.cloudSyncTimer = null
        const toFlush = this.pendingCloudSave
        this.pendingCloudSave = null
        if (toFlush && !this.user && getSaveOwnerId() === null) {
          void this.persistGuestSaveToCloud(toFlush)
        }
      }, 1500)
      return
    }

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

  private invalidateAccountWork(cancelCloudSync = true): void {
    this.accountRevision++
    if (cancelCloudSync) this.cancelScheduledCloudSync()
    if (this.authUpdateTimer !== null) {
      clearTimeout(this.authUpdateTimer)
      this.authUpdateTimer = null
    }
    this.pendingAccountRestore = false
  }

  private replaceSession(nextSession: Session | null, newAccountContext = false): boolean {
    const accountChanged = (this.user?.id ?? null) !== (nextSession?.user.id ?? null)
    if (accountChanged || newAccountContext) this.invalidateAccountWork(accountChanged || nextSession === null)
    if (accountChanged) this.profile = null
    this.session = nextSession
    this.user = nextSession?.user ?? null
    return accountChanged
  }

  private bindAccountSave(user: User): void {
    if (getSaveOwnerId() !== user.id) {
      resetSave({ syncCloud: false, clearOwner: false })
      setSaveOwnerId(user.id)
    }
  }

  private clearSignedOutAccount(): void {
    this.replaceSession(null, true)
    this.profile = null
    resetSave({ syncCloud: false, clearOwner: true })
    resetGuestId()
  }

  private queueAuthUpdate(restoreAccount: boolean): void {
    this.pendingAccountRestore ||= restoreAccount
    if (this.authUpdateTimer !== null) return
    const revision = this.accountRevision

    // Supabase awaits auth callbacks under its session/refresh lifecycle. Even UI
    // listeners may call the SDK, so notify and hydrate only after that callback exits.
    this.authUpdateTimer = setTimeout(() => {
      this.authUpdateTimer = null
      const shouldRestore = this.pendingAccountRestore
      this.pendingAccountRestore = false
      if (revision !== this.accountRevision || this.authFlowInProgress !== null) return

      this.notifyAuthStateChange()
      if (revision !== this.accountRevision || this.authFlowInProgress !== null) return
      const user = this.user
      if (shouldRestore && user) {
        void this.restoreBrowserAccount(user, revision)
      } else if (shouldRestore && !user) {
        // Register existing guest progress on boot without running SDK work in a callback.
        void this.persistGuestSaveToCloud(loadSave())
      }
    }, 0)
  }

  private async restoreBrowserAccount(user: User, revision: number): Promise<void> {
    try {
      await Promise.all([this.fetchProfile(), this.restoreAccountProgress(user)])
      if (revision === this.accountRevision && this.user?.id === user.id && this.authFlowInProgress === null) {
        this.notifyAuthStateChange()
      }
    } catch (error) {
      console.error('Failed to restore account data:', error)
    }
  }

  private handleSdkAuthStateChange(event: AuthChangeEvent, nextSession: Session | null): void {
    // INITIAL_SESSION is a snapshot, not a new sign-in. A later snapshot must not
    // overwrite an explicit auth flow, a refresh, or a sign-out already observed.
    if (event === 'INITIAL_SESSION' && !this.awaitingInitialSession) return
    this.awaitingInitialSession = false
    this.authStateRevision++

    if (this.authFlowInProgress === 'logout') {
      if (event === 'SIGNED_OUT') this.replaceSession(null)
      return
    }

    if (event === 'SIGNED_OUT') {
      this.sessionEnded = true
      this.authFlowRevision++
      this.authFlowInProgress = null
      this.pendingAuthEvent = false
      this.authFlowHasSession = false
      this.clearSignedOutAccount()
      this.queueAuthUpdate(false)
      return
    }

    // An in-flight metadata update/refresh from the ended session cannot log the
    // player back in. A real new sign-in (including OAuth recovery) can.
    if (this.sessionEnded && event !== 'SIGNED_IN' && event !== 'PASSWORD_RECOVERY') return
    if (nextSession) this.sessionEnded = false

    if (event === 'SIGNED_IN' && this.authFlowHasSession) {
      // The owned SDK sign-in already completed. This is a newer sign-in while
      // its cloud hydration was pending, so it owns the account from now on.
      this.authFlowRevision++
      this.authFlowInProgress = null
      this.authFlowHasSession = false
      this.pendingAuthEvent = false
    }

    const accountChanged = this.replaceSession(nextSession, event === 'SIGNED_IN')
    if (this.authFlowInProgress !== null) {
      this.pendingAuthEvent = true
      return
    }
    if (event === 'USER_UPDATED' && this.isUpdatingProgressMeta && !accountChanged) return

    if (this.user) {
      this.bindAccountSave(this.user)
    } else if (getSaveOwnerId() !== null) {
      resetSave({ syncCloud: false, clearOwner: true })
    }
    this.queueAuthUpdate(accountChanged || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
  }

  initialize(): Promise<void> {
    if (isDrunkoTestRoute()) return Promise.resolve()
    if (this.initializationPromise) return this.initializationPromise
    setCloudSyncHandler((save, immediate) => this.scheduleCloudSync(save, immediate))
    const revision = this.authStateRevision

    this.initializationPromise = (async () => {
      // Subscribe before getSession: it can itself refresh the persisted session.
      getSupabase().auth.onAuthStateChange((event, nextSession) => {
        this.handleSdkAuthStateChange(event, nextSession)
      })
      const { data: { session } } = await getSupabase().auth.getSession()
      if (revision !== this.authStateRevision || !this.awaitingInitialSession || this.authFlowInProgress !== null) return

      this.awaitingInitialSession = false
      this.authStateRevision++
      this.replaceSession(session)
      if (this.user) {
        this.bindAccountSave(this.user)
      } else if (getSaveOwnerId() !== null) {
        // Never expose a previous account's local save to a signed-out browser.
        resetSave({ syncCloud: false, clearOwner: true })
      }
      this.queueAuthUpdate(true)
    })()
    return this.initializationPromise
  }

  private beginAuthFlow(flow: 'login' | 'signup' | 'logout'): number {
    this.invalidateAccountWork()
    this.awaitingInitialSession = false
    this.authStateRevision++
    this.authFlowInProgress = flow
    this.pendingAuthEvent = false
    this.authFlowHasSession = false
    if (flow === 'logout') this.sessionEnded = true
    return ++this.authFlowRevision
  }

  private acceptAuthResult(flowRevision: number, stateRevision: number, user: User, session: Session | null): boolean {
    if (flowRevision !== this.authFlowRevision || this.authFlowInProgress === null) return false
    if (stateRevision !== this.authStateRevision) {
      // Keep the newest event's session/token, not an older SDK response snapshot.
      if (this.user?.id !== user.id) return false
    } else {
      this.replaceSession(session)
      this.user = user
      this.sessionEnded = false
    }
    this.authFlowHasSession = true
    return true
  }

  private finishAuthFlow(flowRevision: number, handledEvent: boolean): void {
    if (flowRevision !== this.authFlowRevision) return
    this.authFlowInProgress = null
    this.authFlowHasSession = false
    const pendingEvent = this.pendingAuthEvent
    this.pendingAuthEvent = false
    if (!handledEvent && pendingEvent) {
      if (this.user) this.bindAccountSave(this.user)
      this.queueAuthUpdate(true)
    }
  }

  async signInWithEmail(email: string, password: string): Promise<{ error: Error | null }> {
    const client = getSupabase()
    const flowRevision = this.beginAuthFlow('login')
    const stateRevision = this.authStateRevision
    let handledEvent = false
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error || !data.user) {
        return { error: error ?? new Error('Failed to sign in') }
      }

      if (!this.acceptAuthResult(flowRevision, stateRevision, data.user, data.session)) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }
      const accountRevision = this.accountRevision

      // Never carry guest or previous account local progress into an existing account on login.
      this.bindAccountSave(data.user)
      await Promise.all([this.fetchProfile(), this.restoreAccountProgress(this.user ?? data.user)])
      if (flowRevision !== this.authFlowRevision || accountRevision !== this.accountRevision) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }
      handledEvent = true
      this.notifyAuthStateChange()
      return { error: null }
    } finally {
      this.finishAuthFlow(flowRevision, handledEvent)
    }
  }

  async signUpWithEmail(email: string, password: string, username: string): Promise<{ error: Error | null }> {
    const client = getSupabase()
    const guestSave = getSaveOwnerId() === null ? cloneSave(loadSave()) : freshSave()
    const signupProgress = { ballrush_progress: guestSave }
    const flowRevision = this.beginAuthFlow('signup')
    try {
      const { error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            ...signupProgress,
          },
        },
      })
      return { error }
    } finally {
      // Email confirmation may yield no session. If it did sign in, restore the
      // guest progress saved in signup metadata outside the SDK callback.
      this.finishAuthFlow(flowRevision, false)
    }
  }

  /**
   * Sign in with username + password. Looks up the user's email from their
   * profile (populated by the handle_new_user trigger), then delegates to
   * Supabase email auth.
   */
  async signInWithUsername(username: string, password: string): Promise<{ error: Error | null }> {
    const trimmed = username.trim()
    if (trimmed.includes('@')) {
      return this.signInWithEmail(trimmed, password)
    }

    const lookupRevision = this.accountRevision
    const { data: profile, error: lookupError } = await getSupabase()
      .from('profiles')
      .select('email')
      .ilike('username', trimmed)
      .maybeSingle()

    if (lookupRevision !== this.accountRevision) {
      return { error: new Error('Authentication state changed. Please try again.') }
    }

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
    const lookupRevision = this.accountRevision
    const { data: existing, error: lookupError } = await getSupabase()
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (lookupRevision !== this.accountRevision) {
      return { error: new Error('Authentication state changed. Please try again.') }
    }

    if (lookupError) {
      return { error: new Error('Failed to check username availability') }
    }

    if (existing) {
      return { error: new Error('Username is already taken') }
    }

    const hadGuestProgress = getSaveOwnerId() === null
    const guestIdBeforeSignup = hadGuestProgress ? getOrCreateGuestId() : null
    const guestSave = hadGuestProgress ? cloneSave(loadSave()) : freshSave()
    const authEmail = email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@ballrush.local`

    const flowRevision = this.beginAuthFlow('signup')
    let handledEvent = false
    try {
      const signupProgress = { ballrush_progress: guestSave }
      const { error } = await getSupabase().auth.signUp({
        email: authEmail,
        password,
        options: {
          data: {
            username,
            ...signupProgress,
          },
        },
      })

      if (error) {
        return { error }
      }

      if (flowRevision !== this.authFlowRevision) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }
      const stateRevision = this.authStateRevision
      const { data: signInData, error: signInError } = await getSupabase().auth.signInWithPassword({
        email: authEmail,
        password,
      })

      if (signInError || !signInData.user) {
        return { error: signInError ?? new Error('Failed to establish session after sign up') }
      }

      if (!this.acceptAuthResult(flowRevision, stateRevision, signInData.user, signInData.session)) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }
      const accountRevision = this.accountRevision

      // Bind transferred guest progression to the newly created account.
      writeSave(guestSave, { syncCloud: false, ownerId: signInData.user.id })
      await Promise.all([
        this.fetchProfile(),
        this.persistSaveToCloud(guestSave, signInData.user.id),
      ])
      if (flowRevision !== this.authFlowRevision || accountRevision !== this.accountRevision) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }

      // Link anonymous guest profile & copy any prior guest runs into public.scores
      if (hadGuestProgress && guestIdBeforeSignup) {
        try {
          await getSupabase().rpc('link_guest_to_user', { p_guest_id: guestIdBeforeSignup })
        } catch {
          // Ignore if RPC is unavailable
        }
      }
      if (flowRevision !== this.authFlowRevision || accountRevision !== this.accountRevision) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }

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

      if (flowRevision !== this.authFlowRevision || accountRevision !== this.accountRevision) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }
      handledEvent = true
      this.notifyAuthStateChange()
      return { error: null }
    } finally {
      this.finishAuthFlow(flowRevision, handledEvent)
    }
  }

  /**
   * Send password reset email.
   */
  async resetPassword(email: string): Promise<{ error: Error | null }> {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error }
  }

  async signInWithOAuth(provider: 'google' | 'github' | 'discord'): Promise<{ error: Error | null }> {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    })
    return { error }
  }

  async signOut(): Promise<void> {
    const client = getSupabase()
    const flowRevision = this.beginAuthFlow('logout')
    try {
      // Flush the active account's current progress to cloud BEFORE signing out.
      if (this.user && getSaveOwnerId() === this.user.id) {
        await this.persistSaveToCloud(cloneSave(loadSave()), this.user.id)
      }
      if (flowRevision !== this.authFlowRevision) return
      const { error } = await client.auth.signOut()
      if (error) return
      if (flowRevision !== this.authFlowRevision) return
      // Once logged out, reset progression and guest identity without queued restores.
      this.clearSignedOutAccount()
      this.notifyAuthStateChange()
    } finally {
      this.finishAuthFlow(flowRevision, true)
    }
  }

  /**
   * Restore the authenticated account's progress from cloud sources
   * (`public.user_progress`, `user.user_metadata.ballrush_progress`, and `public.scores`).
   */
  async restoreAccountProgress(targetUser?: User): Promise<void> {
    const user = targetUser ?? this.user
    if (!user || this.user?.id !== user.id || getSaveOwnerId() !== user.id) return
    const userId = user.id
    const revision = this.accountRevision

    const localSameOwnerSave = getSaveOwnerId() === userId ? cloneSave(loadSave()) : null

    const [freshUserRes, scoresRes, tableRes] = await Promise.all([
      getSupabase().auth.getUser().catch(() => ({ data: { user: null } })),
      getSupabase()
        .from('scores')
        .select('*')
        .eq('user_id', userId)
        .order('score', { ascending: false })
        .limit(100),
      this.userProgressTableAvailable === false
        ? Promise.resolve({ data: null, error: null })
        : getSupabase()
            .from('user_progress')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
    ])

    if (revision !== this.accountRevision || this.user?.id !== userId || getSaveOwnerId() !== userId) return

    if (tableRes.error) {
      const code = tableRes.error.code ?? ''
      const msg = tableRes.error.message ?? ''
      if (code === 'PGRST205' || code === '42P01' || msg.includes('user_progress')) {
        this.userProgressTableAvailable = false
      }
    } else if (this.userProgressTableAvailable === null) {
      this.userProgressTableAvailable = true
    }

    const freshUser = freshUserRes.data?.user
    const latestUser = freshUser?.id === userId ? freshUser : user
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
    if (tableSave) {
      // When public.user_progress exists, treat it as the authoritative cloud save
      // so admin edits/resets in /boss take effect immediately even if local storage
      // or older auth metadata had higher numbers.
      combined = tableSave
    } else {
      if (metaSave) combined = mergeSavesForSameUser(combined, metaSave)
      if (localSameOwnerSave) combined = mergeSavesForSameUser(combined, localSameOwnerSave)
    }

    const userScores = Array.isArray(scoresRes.data) ? (scoresRes.data as Score[]) : []
    const { save: finalSave, changed: healedFromScores } = reconcileSaveWithUserScores(combined, userScores)

    if (revision !== this.accountRevision || this.user?.id !== userId || getSaveOwnerId() !== userId) return

    writeSave(finalSave, { syncCloud: false, ownerId: userId })

    // If scores or same-owner local data healed missing cloud metadata, persist back to cloud.
    const hadCloudRecord = Boolean(tableSave)
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
    if (isDrunkoTestRoute()) return
    const user = this.user
    if (!user) return
    const uid = expectedUserId ?? user.id
    if (user.id !== uid) return
    if (getSaveOwnerId() !== uid) return
    const revision = this.accountRevision

    const save = normalizeSave(saveData ?? loadSave())

    // 1. Always persist in the user's Supabase Auth metadata (works without schema migrations).
    this.isUpdatingProgressMeta = true
    try {
      const { data } = await getSupabase().auth.updateUser({
        data: {
          ballrush_progress: save,
        },
      })
      if (data?.user?.id === uid && revision === this.accountRevision && this.user?.id === uid) {
        this.user = data.user
      }
    } catch (err) {
      console.error('Failed to update user progress metadata:', err)
    } finally {
      this.isUpdatingProgressMeta = false
    }

    // 2. Also upsert into public.user_progress if the table exists on the project.
    if (revision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid) return
    if (this.userProgressTableAvailable !== false) {
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
        const { error } = await getSupabase().from('user_progress').upsert(fullRow, { onConflict: 'user_id' })
        if (revision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid) return
        if (error) {
          const code = error.code ?? ''
          const msg = error.message ?? ''
          if (code === 'PGRST205' || code === '42P01' || msg.includes('user_progress')) {
            this.userProgressTableAvailable = false
          } else if (code === 'PGRST204') {
            // Fallback if leaderboard/settings columns were not migrated yet.
            await getSupabase().from('user_progress').upsert(
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

  /**
   * Persist anonymous guest progression to `public.guest_profiles` via RPC.
   */
  async persistGuestSaveToCloud(saveData?: Partial<SaveDataV1>): Promise<void> {
    if (isDrunkoTestRoute()) return
    if (this.user || getSaveOwnerId() !== null) return
    const guestId = getOrCreateGuestId()
    const save = normalizeSave(saveData ?? loadSave())
    try {
      await getSupabase().rpc('upsert_guest_progress', {
        p_guest_id: guestId,
        p_best_score: save.best,
        p_discovered: save.discovered,
        p_variants: save.variants,
        p_stats: save.stats,
        p_leaderboard: save.leaderboard,
        p_settings: save.settings,
      })
    } catch {
      // Offline or unmigrated — local guest save continues to work.
    }
  }
  async fetchProfile(): Promise<Profile | null> {
    const userId = this.user?.id
    if (!userId) return null
    const revision = this.accountRevision
    const requestRevision = ++this.profileRequestRevision

    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (revision !== this.accountRevision || requestRevision !== this.profileRequestRevision || this.user?.id !== userId) return null

    if (error) {
      console.error('Error fetching profile:', error)
      return null
    }

    this.profile = data
    return data
  }

  async updateProfile(updates: Partial<Profile>): Promise<{ error: Error | null }> {
    if (!this.user) return { error: new Error('Not authenticated') }

    const { error } = await getSupabase()
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

    const { error } = await getSupabase()
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
  private activeRunKey: string | null = null
  private activeScoreId: number | null = null
  private activeRunCreatePromise: Promise<number | null> | null = null
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

  /** Reset active run tracking when a fresh run begins. */
  startNewRun(runKey?: string): void {
    this.activeRunKey = runKey ?? `${Date.now()}-${Math.random()}`
    this.activeScoreId = null
    this.activeRunCreatePromise = null
  }

  /**
   * Create or update the current run's row in `guest_scores` (anonymous) or `scores` (signed-in).
   * Safe to call on first drop, during merges, on restart/menu leave, and at game over.
   */
  async syncActiveRun(
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<{ scoreId: number | null; error: Error | null }> {
    // /drunko is a real gameplay sandbox, but its run rows must never reach
    // guest_scores or scores, including when a caller bypasses scene guards.
    if (isDrunkoTestRoute()) return { scoreId: null, error: null }
    const auth = AuthService.getInstance()
    const user = auth.getUser()
    const cleanScore = Math.max(0, Math.round(score))
    const cleanTier = Math.max(1, Math.min(12, Math.round(tierReached)))
    const cleanMerges = Math.max(0, Math.round(ballsMerged))
    const cleanDuration = Math.max(0, Math.round(durationMs))

    if (!this.activeRunKey) {
      this.startNewRun()
    }
    const runKeyAtCall = this.activeRunKey

    // If a row creation is already in flight for this run, wait for it so we update instead of duplicating
    if (this.activeScoreId === null && this.activeRunCreatePromise) {
      try {
        await this.activeRunCreatePromise
      } catch {
        // ignore
      }
    }

    const performRpc = async (scoreIdToUpdate: number | null): Promise<number | null> => {
      if (!user) {
        const guestId = getOrCreateGuestId()
        const { data, error } = await getSupabase().rpc('record_guest_score', {
          p_guest_id: guestId,
          p_score: cleanScore,
          p_tier_reached: cleanTier,
          p_balls_merged: cleanMerges,
          p_duration_ms: cleanDuration,
          p_score_id: scoreIdToUpdate,
        })
        if (error) throw new Error(error.message)
        return typeof data === 'number' ? data : data != null ? Number(data) : scoreIdToUpdate
      } else {
        const { data, error } = await getSupabase().rpc('record_user_score', {
          p_score: cleanScore,
          p_tier_reached: cleanTier,
          p_balls_merged: cleanMerges,
          p_duration_ms: cleanDuration,
          p_score_id: scoreIdToUpdate,
        })
        if (error) throw new Error(error.message)
        return typeof data === 'number' ? data : data != null ? Number(data) : scoreIdToUpdate
      }
    }

    try {
      if (this.activeScoreId === null) {
        this.activeRunCreatePromise = performRpc(null)
        const createdId = await this.activeRunCreatePromise
        if (this.activeRunKey === runKeyAtCall && createdId != null && Number.isFinite(createdId)) {
          this.activeScoreId = createdId
        }
        this.activeRunCreatePromise = null
        return { scoreId: this.activeScoreId, error: null }
      } else {
        const updatedId = await performRpc(this.activeScoreId)
        if (this.activeRunKey === runKeyAtCall && updatedId != null && Number.isFinite(updatedId)) {
          this.activeScoreId = updatedId
        }
        return { scoreId: this.activeScoreId, error: null }
      }
    } catch (err) {
      this.activeRunCreatePromise = null
      return {
        scoreId: this.activeScoreId,
        error: err instanceof Error ? err : new Error('Failed to sync run'),
      }
    }
  }

  async submitScore(
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
  ): Promise<{ error: Error | null }> {
    // Keep direct post-game callers harmless on the isolated test route.
    if (isDrunkoTestRoute()) return { error: null }
    const auth = AuthService.getInstance()
    const user = auth.getUser()
    const actorId = user ? user.id : `guest:${getOrCreateGuestId()}`

    const now = Date.now()
    if (
      this.lastSubmitted &&
      this.lastSubmitted.userId === actorId &&
      this.lastSubmitted.score === score &&
      this.lastSubmitted.tierReached === tierReached &&
      now - this.lastSubmitted.at < 5_000 &&
      this.activeScoreId !== null
    ) {
      const res = await this.syncActiveRun(score, tierReached, ballsMerged, durationMs)
      return { error: res.error }
    }
    this.lastSubmitted = { userId: actorId, score, tierReached, at: now }

    const res = await this.syncActiveRun(score, tierReached, ballsMerged, durationMs)
    if (res.error) {
      this.lastSubmitted = null
      return { error: res.error }
    }
    if (!user) {
      void auth.persistGuestSaveToCloud()
    }
    return { error: null }
  }

  async getLeaderboard(limit = 100): Promise<Score[]> {
    if (limit <= 0) return []

    const pageSize = 250
    const seenUsers = new Set<string>()
    const uniqueScores: Score[] = []
    let offset = 0

    while (uniqueScores.length < limit) {
      const { data, error } = await getSupabase()
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
        .order('id', { ascending: true })
        .range(offset, offset + 249)

      if (error) {
        console.error('Error fetching leaderboard:', error)
        return []
      }

      const page = data as Score[]
      for (const score of page) {
        if (!seenUsers.has(score.user_id)) {
          seenUsers.add(score.user_id)
          uniqueScores.push(score)
          if (uniqueScores.length >= limit) break
        }
      }

      if (page.length < pageSize || uniqueScores.length >= limit) break
      offset += pageSize
    }

    return uniqueScores
  }

  async getUserBestScore(): Promise<Score | null> {
    const auth = AuthService.getInstance()
    const user = auth.getUser()

    if (!user) return null

    const { data, error } = await getSupabase()
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

    const { data, error } = await getSupabase()
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
