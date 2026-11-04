import { createClient } from '@supabase/supabase-js'
import { isDrunkoTestRoute } from '../game/state/runVariant'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// On the /drunko sandbox route, disable Supabase auth storage entirely so
// the SDK's localStorage probe (lswt-*) never fires and no session persists.
const isSandbox = isDrunkoTestRoute()

// No-op storage: the Supabase SDK probes storage on init; this swallows it.
const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: !isSandbox,
    autoRefreshToken: !isSandbox,
    detectSessionInUrl: !isSandbox,
    storage: isSandbox ? noopStorage : undefined,
  },
})
