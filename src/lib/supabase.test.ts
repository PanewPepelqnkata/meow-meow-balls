import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function instrumentBrowserStorage() {
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }
  vi.stubGlobal('window', {
    location: { pathname: '/', search: '', href: 'https://game.example/' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('localStorage', storage)
  return storage
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.example')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Supabase client loading', () => {
  it('does not probe browser storage while loading the /drunko client module', async () => {
    const storage = instrumentBrowserStorage()
    window.location.pathname = '/drunko'
    window.location.href = 'https://game.example/drunko'

    const { getSupabase } = await import('./supabase')

    expect(() => getSupabase()).toThrow('/drunko sandbox route')
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('preserves the missing configuration error before client creation', async () => {
    const storage = instrumentBrowserStorage()
    vi.stubEnv('VITE_SUPABASE_URL', '')

    await expect(import('./supabase')).rejects.toThrow('Missing Supabase environment variables')

    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
