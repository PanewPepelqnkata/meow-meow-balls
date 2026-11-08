import { UPGRADE_CATALOG, freshUpgradeLevels, normalizeUpgradeLevels, upgradeCost, type UpgradeId, type UpgradeLevels } from '../config/abilityUpgrades'
import { getSupabase } from '../lib/supabase'
import { isDrunkoTestRoute } from '../game/state/runVariant'
import { normalizeRunCollectibles, type RunCollectibles } from '../game/state/collectibleMetadata'
import type { AuthChangeEvent, User, Session } from '@supabase/supabase-js'

import {
  cloneSave,
  freshSave,
  getOrCreateGuestId,
  getSaveOwnerId,
  getSaveReplacementRevision,
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
  collectibles?: RunCollectibles | null
  profiles?: Profile
}

/** Resolve a profile's display name: prefer display_name, fall back to username, then 'Anonymous'. */
export function resolveDisplayName(profile: Profile | null | undefined): string {
  return profile?.display_name || profile?.username || 'Anonymous'
}
type CloudCoinState = { coins: number; coinRevision: number }
type UpgradePurchaseState = CloudCoinState & { upgrades: UpgradeLevels }

function roundedCoins(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10
}


function parseCoinRevision(value: unknown): number | null {
  const revision = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}


function parseUpgradePurchaseState(value: unknown): UpgradePurchaseState | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { coins?: unknown; coin_revision?: unknown; upgrades?: unknown }
  const coins = Number(row.coins)
  const coinRevision = parseCoinRevision(row.coin_revision)
  if (!Number.isFinite(coins) || coins < 0 || coinRevision === null || !row.upgrades || typeof row.upgrades !== 'object') {
    return null
  }
  return { coins: roundedCoins(coins), coinRevision, upgrades: normalizeUpgradeLevels(row.upgrades) }
}

/** Progress payload excludes server-owned wallet and upgrade fields. */
function cloudSavePayload(save: SaveDataV1): Omit<SaveDataV1, 'coins' | 'coinRevision' | 'upgrades'> {
  return {
    version: save.version,
    best: save.best,
    leaderboard: save.leaderboard.map((entry) => ({ ...entry })),
    discovered: { ...save.discovered },
    variants: { ...save.variants },
    settings: { ...save.settings },
    stats: { ...save.stats },
  }
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

  const coins = b && typeof b === 'object' && 'coins' in b ? sb.coins : sa.coins
  const upgrades = b && typeof b === 'object' && 'upgrades' in b && b.upgrades != null
    ? normalizeUpgradeLevels(sb.upgrades)
    : normalizeUpgradeLevels(sa.upgrades)

  return normalizeSave({
    version: 1,
    best: Math.max(sa.best, sb.best),
    coins,
    upgrades,
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

/** Keep only discoveries earned while hydration was pending, never an older reset baseline. */
function retainDiscoveriesSinceRestore(base: SaveDataV1, before: SaveDataV1, current: SaveDataV1): boolean {
  let changed = false
  for (const [tier, at] of Object.entries(current.discovered)) {
    if (before.discovered[tier] != null) continue
    if (base.discovered[tier] == null || at < base.discovered[tier]!) {
      base.discovered[tier] = at
      changed = true
    }
  }
  for (const [key, at] of Object.entries(current.variants)) {
    if (before.variants[key] != null) continue
    if (base.variants[key] == null || at < base.variants[key]!) {
      base.variants[key] = at
      changed = true
    }
    const tier = Number(key.split(':', 1)[0])
    if (Number.isInteger(tier) && tier >= 1 && tier <= 12 && base.discovered[String(tier)] == null) {
      base.discovered[String(tier)] = at
      changed = true
    }
  }
  return changed
}

/** Restore score/tier progress only. Run metadata audits history, not lifetime collection resets. */
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
  private progressRequestRevision = 0
  private cloudSaveChain: Promise<void> = Promise.resolve()

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
    // Old account requests may still finish, but never hold up a new account's work.
    this.cloudSaveChain = Promise.resolve()
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

    // An in-flight refresh from the ended session cannot log the player back in.
    // A real new sign-in (including OAuth recovery) can.
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
        if (error && /invalid login credentials/i.test(error.message)) {
          return { error: new Error('Username or password is incorrect') }
        }
        return { error: error ?? new Error('Username or password is incorrect') }
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
    const signupProgress = { ballrush_progress: cloudSavePayload(guestSave) }
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
      // account from user_progress in the deferred auth update.
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
    let resolvedEmail: string | null = null
    try {
      const { data: rpcEmail, error: rpcError } = await getSupabase().rpc('resolve_username_email', {
        p_username: trimmed,
      })
      if (!rpcError && typeof rpcEmail === 'string' && rpcEmail.length > 0) {
        resolvedEmail = rpcEmail
      }
    } catch {
      // Fall back to direct profile lookup if RPC is not yet deployed
    }

    if (!resolvedEmail) {
      const { data: profile, error: lookupError } = await getSupabase()
        .from('profiles')
        .select('email')
        .ilike('username', trimmed)
        .maybeSingle()
      if (!lookupError && profile?.email) {
        resolvedEmail = profile.email
      }
    }

    if (lookupRevision !== this.accountRevision) {
      return { error: new Error('Authentication state changed. Please try again.') }
    }

    if (!resolvedEmail) {
      return { error: new Error('Username or password is incorrect') }
    }

    return this.signInWithEmail(resolvedEmail, password)
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
      const signupProgress = { ballrush_progress: cloudSavePayload(guestSave) }
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

      // Transfer non-currency progress locally; rewards come only from the
      // accepted guest score rows linked to this newly registered account.
      guestSave.coins = 0
      guestSave.coinRevision = 0
      guestSave.upgrades = freshUpgradeLevels()
      writeSave(guestSave, { syncCloud: false, ownerId: signInData.user.id })
      await this.fetchProfile()
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

      // Do not manufacture a second top-score row after linking guest runs:
      // their stable score identities are the server's settlement receipts.
      await this.persistSaveToCloud(undefined, signInData.user.id)

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
   * Restore authenticated account progress from the authoritative
   * `public.user_progress` row and score audit rows. Auth user metadata is
   * intentionally never used as a progress source because it is editable.
   */
  async restoreAccountProgress(targetUser?: User): Promise<void> {
    const user = targetUser ?? this.user
    if (!user || this.user?.id !== user.id || getSaveOwnerId() !== user.id) return
    const revision = this.accountRevision
    const saveRevision = getSaveReplacementRevision()
    // Capture before queueing: gameplay can earn discoveries while an older
    // sync occupies the account queue, and those must be retained as pending.
    const localSameOwnerSave = cloneSave(loadSave())
    const task = this.cloudSaveChain.then(async () => {
      if (revision !== this.accountRevision || this.user?.id !== user.id || getSaveOwnerId() !== user.id) return
      await this.restoreAccountProgressNow(user, localSameOwnerSave, saveRevision)
    })
    this.cloudSaveChain = task.catch(() => undefined)
    return task
  }


  private async restoreAccountProgressNow(
    user: User,
    localSameOwnerSave: SaveDataV1,
    saveRevision: number,
  ): Promise<void> {
    if (this.userProgressTableAvailable === false) return
    const userId = user.id
    const revision = this.accountRevision
    const requestRevision = ++this.progressRequestRevision

    const [freshUserRes, scoresRes, tableRes] = await Promise.all([
      // Fetching the current user keeps the auth/session freshness check, but
      // never use its editable metadata as an account-progress source.
      getSupabase().auth.getUser().catch(() => ({ data: { user: null } })),
      getSupabase()
        .from('scores')
        .select('*')
        .eq('user_id', userId)
        .order('score', { ascending: false })
        .limit(100),
      getSupabase()
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    if (revision !== this.accountRevision || requestRevision !== this.progressRequestRevision ||
        saveRevision !== getSaveReplacementRevision() || this.user?.id !== userId || getSaveOwnerId() !== userId) return

    if (tableRes.error) {
      const code = tableRes.error.code ?? ''
      const msg = tableRes.error.message ?? ''
      if (code === 'PGRST205' || code === '42P01' || msg.includes('user_progress')) {
        this.userProgressTableAvailable = false
      }
      return
    } else if (this.userProgressTableAvailable === null) {
      this.userProgressTableAvailable = true
    }

    const freshUser = freshUserRes.data?.user
    if (freshUser && freshUser.id !== userId) return

    const row = tableRes.data as {
      best_score?: number
      coins?: number | string
      coin_revision?: number | string
      upgrades?: unknown
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
          coins: Number(row.coins ?? 0),
          coinRevision: parseCoinRevision(row.coin_revision) ?? 0,
          upgrades: normalizeUpgradeLevels(row.upgrades),
          discovered: row.discovered ?? {},
          variants: row.variants ?? {},
          stats: row.stats ?? { runs: 0, merges: 0, bestTier: 0 },
          leaderboard: Array.isArray(row.leaderboard) ? row.leaderboard : [],
          settings: row.settings ?? { theme: 'auto' },
        })
      : null
    // Only the table supplies wallet balances and purchased upgrades. Final
    // score settlement is durable on the server, including across reloads.
    let combined = tableSave ?? freshSave()
    const liveSaveBeforeWrite = cloneSave(loadSave())
    const canonicalCoins = combined.coins
    const canonicalRevision = combined.coinRevision
    const canonicalUpgrades = { ...combined.upgrades }

    // Preserve local score/stat progress, but only discoveries earned after
    // hydration began; a server reset must not re-import old collection keys.
    const pendingOnlyLocal = cloneSave(liveSaveBeforeWrite)
    pendingOnlyLocal.coins = 0
    pendingOnlyLocal.upgrades = canonicalUpgrades
    pendingOnlyLocal.variants = {}
    pendingOnlyLocal.discovered = {}
    combined = mergeSavesForSameUser(combined, pendingOnlyLocal)
    combined.coins = canonicalCoins
    combined.coinRevision = canonicalRevision
    combined.upgrades = canonicalUpgrades

    const discoveredDuringRestore = retainDiscoveriesSinceRestore(combined, localSameOwnerSave, liveSaveBeforeWrite)

    const userScores = Array.isArray(scoresRes.data) ? (scoresRes.data as Score[]) : []
    const { save: reconciledSave, changed: healedFromScores } = reconcileSaveWithUserScores(combined, userScores)
    const finalSave = normalizeSave(reconciledSave)

    if (revision !== this.accountRevision || requestRevision !== this.progressRequestRevision ||
        saveRevision !== getSaveReplacementRevision() || this.user?.id !== userId || getSaveOwnerId() !== userId) return

    const hadCloudRecord = Boolean(tableSave)
    const hasProgress = finalSave.best > 0 || finalSave.stats.runs > 0 || finalSave.stats.merges > 0 ||
      Object.keys(finalSave.discovered).length > 3
    const shouldSettle = userScores.length > 0 || healedFromScores || discoveredDuringRestore ||
      (!hadCloudRecord && hasProgress)
    this.cancelScheduledCloudSync()
    writeSave(finalSave, { syncCloud: false, ownerId: userId })

    if (shouldSettle) {
      // Run the authoritative settlement scan after hydration. This recovers
      // a final score whose previous response was lost before reload.
      void this.persistSaveToCloud(finalSave, userId)
    }
  }

  /**
   * Save account progress through the guarded `sync_user_progress` RPC.
   * Account hydration, earning syncs, and purchases share one serial queue.
   */
  async persistSaveToCloud(saveData?: Partial<SaveDataV1>, expectedUserId?: string): Promise<void> {
    const uid = expectedUserId ?? this.user?.id
    if (!uid || this.user?.id !== uid || getSaveOwnerId() !== uid) return
    const accountRevision = this.accountRevision
    const saveRevision = getSaveReplacementRevision()
    const requestedSave = saveData ? normalizeSave(saveData) : undefined
    const task = this.cloudSaveChain.then(async () => {
      if (accountRevision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid) return
      // A preceding hydrate/purchase/reset supersedes queued pre-replacement snapshots.
      await this.persistSaveToCloudNow(saveRevision === getSaveReplacementRevision() ? requestedSave : undefined, uid)
    })
    this.cloudSaveChain = task.catch(() => undefined)
    return task
  }

  private async persistSaveToCloudNow(saveData?: Partial<SaveDataV1>, expectedUserId?: string): Promise<boolean> {
    if (isDrunkoTestRoute()) return false
    const user = this.user
    if (!user) return false
    const uid = expectedUserId ?? user.id
    if (user.id !== uid || getSaveOwnerId() !== uid) return false
    const accountRevision = this.accountRevision
    // loadSave is a stable mutable reference. Snapshot the outbound payload
    // before awaiting, then merge only the authoritative wallet into live state.
    const liveSaveAtStart = cloneSave(loadSave())
    const save = cloudSavePayload(normalizeSave(saveData ?? liveSaveAtStart))

    if (this.userProgressTableAvailable === false) {
      console.error('Failed to sync user progress: user_progress table unavailable')
      return false
    }
    try {
      const { data, error } = await getSupabase().rpc('sync_user_progress', {
        p_save: save,
        p_coin_revision: liveSaveAtStart.coinRevision,
      })
      if (error) {
        console.error('Failed to sync user progress:', error)
        return false
      }
      if (accountRevision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid) return false

      const wallet = parseUpgradePurchaseState(data)
      if (!wallet) {
        console.error('Failed to sync user progress: invalid authoritative wallet response')
        return false
      }

      // Always persist the server revision even if the displayed total is
      // unchanged. Never infer an earning amount from an older local balance.
      writeSave({
        ...loadSave(),
        coins: wallet.coins,
        coinRevision: wallet.coinRevision,
        upgrades: wallet.upgrades,
      }, { syncCloud: false, ownerId: uid })
      return true
    } catch (error) {
      console.error('Failed to sync user progress:', error)
      return false
    }
  }

  /** Buy one level after refreshing the authoritative account wallet. */
  async purchaseUpgrade(id: UpgradeId): Promise<{ error: Error | null }> {
    if (isDrunkoTestRoute() || !this.isRegisteredAccount() || this.authFlowInProgress === 'logout') {
      return { error: new Error('Ability upgrades are only for players with accounts.') }
    }
    const uid = this.user!.id
    if (getSaveOwnerId() !== uid) return { error: new Error('Account progress is not ready.') }
    const accountRevision = this.accountRevision
    const task = this.cloudSaveChain.then(async (): Promise<{ error: Error | null }> => {
      if (accountRevision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid || !this.isRegisteredAccount()) {
        return { error: new Error('Authentication state changed. Please try again.') }
      }
      try {
        // This also refreshes authoritative levels and balances before checking
        // affordability, and never applies a client-supplied absolute balance.
        const synced = await this.persistSaveToCloudNow(undefined, uid)
        if (accountRevision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid) {
          return { error: new Error('Authentication state changed. Please try again.') }
        }
        if (!synced) return { error: new Error('Could not sync account progress. Please try again.') }

        const beforePurchase = cloneSave(loadSave())
        const definition = UPGRADE_CATALOG[id]
        if (!definition) return { error: new Error('Unknown ability upgrade.') }
        const currentLevel = beforePurchase.upgrades[id]
        const cost = upgradeCost(id, currentLevel)
        if (currentLevel >= definition.maxLevel) return { error: new Error('This upgrade is already at its maximum level.') }
        if (beforePurchase.coins < cost) return { error: new Error('Not enough coins.') }

        const { data, error } = await getSupabase().rpc('purchase_ability_upgrade', {
          p_upgrade: id,
          p_expected_level: currentLevel,
          p_coin_revision: beforePurchase.coinRevision,
        })
        if (accountRevision !== this.accountRevision || this.user?.id !== uid || getSaveOwnerId() !== uid || !this.isRegisteredAccount()) {
          return { error: new Error('Authentication state changed. Please try again.') }
        }
        if (error) return { error: new Error(error.message) }
        const purchased = parseUpgradePurchaseState(data)
        if (!purchased || purchased.upgrades[id] !== currentLevel + 1) {
          return { error: new Error('Invalid authoritative upgrade response.') }
        }

        const liveSave = loadSave()
        writeSave({
          ...liveSave,
          coins: purchased.coins,
          coinRevision: purchased.coinRevision,
          upgrades: purchased.upgrades,
        }, { syncCloud: false, ownerId: uid })
        return { error: null }
      } catch (error) {
        return { error: error instanceof Error ? error : new Error('Could not purchase this upgrade.') }
      }
    })
    this.cloudSaveChain = task.then(() => undefined, () => undefined)
    return task
  }

  /**
   * Persist anonymous guest progression to `public.guest_profiles` via RPC.
   */
  async persistGuestSaveToCloud(saveData?: Partial<SaveDataV1>): Promise<void> {
    if (isDrunkoTestRoute()) return
    if (this.user || getSaveOwnerId() !== null) return
    const save = normalizeSave(saveData ?? loadSave())
    const hasProgress =
      save.best > 0 ||
      save.stats.runs > 0 ||
      save.stats.merges > 0 ||
      save.leaderboard.length > 0 ||
      Object.keys(save.variants).length > 0 ||
      Object.keys(save.discovered).some((k) => Number(k) > 3)
    if (!hasProgress) return
    const guestId = getOrCreateGuestId()
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
      .select('id, username, display_name, avatar_url, created_at, updated_at')
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

  isRegisteredAccount(): boolean {
    const user = this.user as (User & { is_anonymous?: boolean }) | null
    return user !== null && user.is_anonymous !== true && user.app_metadata?.provider !== 'anonymous'
  }
}

export class ScoreService {
  private static instance: ScoreService
  private activeRun: {
    actorId: string | null
    runId: string
    scoreId: number | null
    createPromise: Promise<number | null> | null
  } | null = null

  static getInstance(): ScoreService {
    if (!ScoreService.instance) {
      ScoreService.instance = new ScoreService()
    }
    return ScoreService.instance
  }

  /** Reset active run tracking when a fresh run begins. */
  startNewRun(): void {
    const runId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const random = (Math.random() * 16) | 0
          return (c === 'x' ? random : (random & 0x3) | 0x8).toString(16)
        })
    this.activeRun = { actorId: null, runId, scoreId: null, createPromise: null }
  }

  getActiveRunId(): string | null {
    return this.activeRun?.runId ?? null
  }

  async activateSessionAbility(ability: 'swap' | 'shake' | 'raise'): Promise<{ error: Error | null }> {
    if (isDrunkoTestRoute()) return { error: null }
    const auth = AuthService.getInstance()
    if (!auth.isRegisteredAccount()) {
      return { error: new Error('Registered account required') }
    }
    const runId = this.activeRun?.runId
    if (!runId) return { error: null }
    try {
      const { error } = await getSupabase().rpc('activate_session_ability', {
        p_session_id: runId,
        p_ability: ability,
      })
      return { error: error ? new Error(error.message) : null }
    } catch {
      return { error: null }
    }
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
    interruptionReason?: string,
    collectibles: Readonly<RunCollectibles> | null = null,
  ): Promise<{ scoreId: number | null; error: Error | null }> {
    // /drunko is a real gameplay sandbox, but its run rows must never reach
    // guest_scores or scores, including when a caller bypasses scene guards.
    if (isDrunkoTestRoute()) return { scoreId: null, error: null }
    const auth = AuthService.getInstance()
    const user = auth.getUser()
    const guestId = user ? null : getOrCreateGuestId()
    const actorId = user?.id ?? `guest:${guestId}`
    // Capture before any await: restart/discovery may replace or extend the
    // scene's list while a previous row creation is still in flight.
    const collectibleSnapshot = normalizeRunCollectibles(collectibles)
    const cleanScore = Math.max(0, Math.round(score))
    const cleanTier = Math.max(1, Math.min(12, Math.round(tierReached)))
    const cleanMerges = Math.max(0, Math.round(ballsMerged))
    const cleanDuration = Math.max(0, Math.round(durationMs))

    if (!this.activeRun) {
      this.startNewRun()
    } else if (this.activeRun.actorId !== null && this.activeRun.actorId !== actorId) {
      // A signed-up guest may submit the same completed run after its row was
      // linked. Keep its receipt key, but never reuse a guest table's score id.
      const adoptedRunId = this.activeRun.actorId.startsWith('guest:') && user ? this.activeRun.runId : null
      if (adoptedRunId) {
        this.activeRun = { actorId: null, runId: adoptedRunId, scoreId: null, createPromise: null }
      } else {
        this.startNewRun()
      }
    }
    const run = this.activeRun!
    run.actorId = actorId

    const performRpc = async (scoreIdToUpdate: number | null): Promise<number | null> => {
      if (!user) {
        const { data, error } = await getSupabase().rpc('record_guest_score', {
          p_guest_id: guestId,
          p_run_id: run.runId,
          p_score: cleanScore,
          p_tier_reached: cleanTier,
          p_balls_merged: cleanMerges,
          p_duration_ms: cleanDuration,
          p_score_id: scoreIdToUpdate,
          p_interruption_reason: interruptionReason ?? null,
          p_collectibles: collectibleSnapshot,
        })
        if (error) throw new Error(error.message)
        return typeof data === 'number' ? data : data != null ? Number(data) : scoreIdToUpdate
      } else {
        const { data, error } = await getSupabase().rpc('record_user_score', {
          p_run_id: run.runId,
          p_score: cleanScore,
          p_tier_reached: cleanTier,
          p_balls_merged: cleanMerges,
          p_duration_ms: cleanDuration,
          p_score_id: scoreIdToUpdate,
          p_interruption_reason: interruptionReason ?? null,
          p_collectibles: collectibleSnapshot,
        })
        if (error) throw new Error(error.message)
        return typeof data === 'number' ? data : data != null ? Number(data) : scoreIdToUpdate
      }
    }

    try {
      // Keep the run context, not mutable service-wide ids, across waits. An
      // old run finishing after restart must never adopt the new run's row.
      if (run.scoreId === null && run.createPromise) {
        await run.createPromise.catch(() => null)
      }
      if (AuthService.getInstance().getUser()?.id !== user?.id) {
        return { scoreId: run.scoreId, error: null }
      }
      if (run.scoreId === null) {
        const creation = performRpc(null)
        run.createPromise = creation
        try {
          const createdId = await creation
          if (createdId != null && Number.isFinite(createdId)) run.scoreId = createdId
        } finally {
          if (run.createPromise === creation) run.createPromise = null
        }
      } else {
        const updatedId = await performRpc(run.scoreId)
        if (updatedId != null && Number.isFinite(updatedId)) run.scoreId = updatedId
      }
      return { scoreId: run.scoreId, error: null }
    } catch (err) {
      return {
        scoreId: run.scoreId,
        error: err instanceof Error ? err : new Error('Failed to sync run'),
      }
    }
  }

  async submitScore(
    score: number,
    tierReached: number,
    ballsMerged: number,
    durationMs: number,
    interruptionReason?: string,
    collectibles: Readonly<RunCollectibles> | null = null,
  ): Promise<{ error: Error | null }> {
    // Keep direct post-game callers harmless on the isolated test route.
    if (isDrunkoTestRoute()) return { error: null }
    const auth = AuthService.getInstance()
    const user = auth.getUser()
    const res = await this.syncActiveRun(score, tierReached, ballsMerged, durationMs, interruptionReason ?? 'completed', collectibles)
    if (res.error) return { error: res.error }
    if (user) {
      if (auth.getUser()?.id !== user.id) return { error: new Error('Authentication state changed. Please try again.') }
      // Settlement derives the award from the accepted score row and is idempotent by score identity.
      await auth.persistSaveToCloud(undefined, user.id)
    } else {
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

  /** Return the authenticated player's rank without depending on profile embeds. */
  async getUserRank(): Promise<number | null> {
    const auth = AuthService.getInstance()
    const userId = auth.getUser()?.id
    if (!userId) return null

    const pageSize = 250
    const seenUsers = new Set<string>()
    let rank = 0
    let offset = 0

    while (true) {
      const { data, error } = await getSupabase()
        .from('scores')
        .select('user_id, score, id')
        .order('score', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)

      if (error) {
        console.error('Error fetching user rank:', error)
        return null
      }

      const page = data as Pick<Score, 'user_id'>[]
      for (const row of page) {
        if (seenUsers.has(row.user_id)) continue
        seenUsers.add(row.user_id)
        rank++
        if (row.user_id === userId) {
          return AuthService.getInstance().getUser()?.id === userId ? rank : null
        }
      }

      if (page.length < pageSize) break
      offset += pageSize
    }

    if (AuthService.getInstance().getUser()?.id !== userId) return null
    return null
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
