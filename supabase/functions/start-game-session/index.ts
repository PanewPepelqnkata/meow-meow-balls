import { corsHeaders, createUserSupabaseClient, jsonResponse } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const client = createUserSupabaseClient(req)
    const { data, error } = await client.rpc('start_game_session', {
      p_guest_id: typeof body.guest_id === 'string' ? body.guest_id : null,
      p_seed: typeof body.seed === 'string' ? body.seed : null,
      p_theme: typeof body.theme === 'string' ? body.theme : 'classic',
    })
    if (error) return jsonResponse({ error: error.message }, 400)
    return jsonResponse(data)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})
