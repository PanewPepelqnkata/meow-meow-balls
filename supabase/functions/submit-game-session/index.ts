import { corsHeaders, createUserSupabaseClient, jsonResponse } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const client = createUserSupabaseClient(req)
    const { data, error } = await client.rpc('submit_game_session', {
      p_session_id: body.session_id,
      p_score: Math.max(0, Math.round(Number(body.score ?? 0))),
      p_tier_reached: Math.max(1, Math.min(12, Math.round(Number(body.tier_reached ?? 1)))),
      p_balls_merged: Math.max(0, Math.round(Number(body.balls_merged ?? 0))),
      p_duration_ms: Math.max(0, Math.round(Number(body.duration_ms ?? 0))),
      p_interruption_reason: typeof body.interruption_reason === 'string' ? body.interruption_reason : 'completed',
      p_collectibles: Array.isArray(body.collectibles) ? body.collectibles : null,
      p_guest_id: typeof body.guest_id === 'string' ? body.guest_id : null,
      p_nonce: typeof body.nonce === 'string' ? body.nonce : null,
    })
    if (error) return jsonResponse({ error: error.message }, 400)
    return jsonResponse(data)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})
