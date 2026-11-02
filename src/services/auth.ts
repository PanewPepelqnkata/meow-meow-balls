import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

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

export class AuthService {
  private static instance: AuthService
  private user: User | null = null
  private session: Session | null = null
  private profile: Profile | null = null

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService()
    }
    return AuthService.instance
  }

  async initialize(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession()
    this.session = session
    this.user = session?.user ?? null

    if (this.user) {
      await this.fetchProfile()
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      this.session = session
      this.user = session?.user ?? null

      if (event === 'SIGNED_IN' && this.user) {
        await this.fetchProfile()
      } else if (event === 'SIGNED_OUT') {
        this.profile = null
      }
    })
  }

  async signInWithEmail(email: string, password: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async signUpWithEmail(email: string, password: string, username: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    })
    return { error }
  }

  /**
   * Sign in with username + password. Looks up the user's email from their
   * profile (populated by the handle_new_user trigger), then delegates to
   * Supabase email auth.
   */
  async signInWithUsername(username: string, password: string): Promise<{ error: Error | null }> {
    // maybeSingle returns null data (not an error) when no row matches.
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
   * If no email provided, generates a placeholder email for Supabase auth.
   */
  async signUpWithUsername(username: string, password: string, email?: string): Promise<{ error: Error | null }> {
    // Check if username is already taken — maybeSingle returns null data
    // (not an error) when no row matches, unlike .single() which throws.
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

    // Use provided email or generate a placeholder
    const authEmail = email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@ballrush.local`

    const { error } = await supabase.auth.signUp({
      email: authEmail,
      password,
      options: {
        data: { username }
      }
    })

    if (error) {
      return { error }
    }

    // Auto-login: Supabase signUp() creates the auth user but does NOT
    // establish a session (email-confirm flows). Sign in explicitly so the
    // user lands in an authenticated state right after registration.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password
    })

    if (signInError) {
      return { error: signInError }
    }

    // The handle_new_user trigger copies auth.users.email into the profile
    // atomically at signup, so no client-side email update is needed here.

    return { error: null }
  }

  /**
   * Send password reset email.
   */
  async resetPassword(email: string): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    return { error }
  }

  async signInWithOAuth(provider: 'google' | 'github' | 'discord'): Promise<{ error: Error | null }> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin
      }
    })
    return { error }
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut()
    this.user = null
    this.session = null
    this.profile = null
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

  static getInstance(): ScoreService {
    if (!ScoreService.instance) {
      ScoreService.instance = new ScoreService()
    }
    return ScoreService.instance
  }

  async submitScore(score: number, tierReached: number, ballsMerged: number, durationMs: number): Promise<{ error: Error | null }> {
    const auth = AuthService.getInstance()
    const user = auth.getUser()

    if (!user) {
      return { error: new Error('Not authenticated') }
    }

    const { error } = await supabase
      .from('scores')
      .insert({
        user_id: user.id,
        score,
        tier_reached: tierReached,
        balls_merged: ballsMerged,
        duration_ms: durationMs
      })

    return { error }
  }

  async getLeaderboard(limit = 100): Promise<Score[]> {
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
      .limit(limit)

    if (error) {
      console.error('Error fetching leaderboard:', error)
      return []
    }

    return data as Score[]
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
      .single()

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

export const authService = AuthService.getInstance()
export const scoreService = ScoreService.getInstance()
