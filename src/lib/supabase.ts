import type { SupabaseClient } from '@supabase/supabase-js'
import { isDrunkoTestRoute } from '../game/state/runVariant'

const isSandbox = isDrunkoTestRoute()

const supabasePromise: Promise<SupabaseClient | null> = isSandbox
  ? Promise.resolve(null)
  : (async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing Supabase environment variables')
      }

      // Runtime loading keeps supabase-js unevaluated on the isolated /drunko route.
      const { createClient } = await import('@supabase/supabase-js')
      return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    })()

const supabaseClient = await supabasePromise

export function getSupabase(): SupabaseClient {
  if (isDrunkoTestRoute()) {
    throw new Error('Supabase is unavailable on the /drunko sandbox route')
  }
  if (!supabaseClient) {
    throw new Error('Supabase client is unavailable')
  }
  return supabaseClient
}
