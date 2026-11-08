import { corsHeaders, createUserSupabaseClient, jsonResponse } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Authentication required' }, 401)

    const body = await req.json()
    const client = createUserSupabaseClient(req)
    const { data: userRes, error: authErr } = await client.auth.getUser()
    if (authErr || !userRes?.user) return jsonResponse({ error: 'Invalid authentication token' }, 401)

    const { data, error } = await client.rpc('activate_session_ability', {
      p_session_id: String(body.session_id ?? ''),
      p_ability: String(body.ability ?? ''),
    })
    if (error) return jsonResponse({ error: error.message }, 400)
    return jsonResponse(data)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})
