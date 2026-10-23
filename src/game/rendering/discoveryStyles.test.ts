import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// discoveryStyles imports Phaser at module scope, and Phaser's ESM build
// touches `window` on load — but the vitest suite runs in plain node.
// The functions under test never use Phaser, so a stub module is enough.
// vi.mock is hoisted above the static import, so this is safe statically.
vi.mock('phaser', () => ({ default: {} }))

import { DISCOVERY_STYLES, selectedDiscoveryStyle } from './discoveryStyles'

type DiscoveryStyle = (typeof DISCOVERY_STYLES)[number]

/**
 * The ?discovery=gib QA style — the collectible card with every piece of
 * text replaced by doodle scribbles. It must be a selectable style, or
 * the URL silently falls back to 'band' and the test stage shows nothing
 * (which is exactly the bug this pins).
 */
describe('the gib discovery style (?discovery=gib)', () => {
  let originalWindow: typeof window | undefined

  beforeEach(() => {
    originalWindow = globalThis.window
  })

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: typeof window }).window
    else (globalThis as { window?: typeof window }).window = originalWindow
  })

  /** Install a minimal window stub whose URL carries ?discovery=<v>. */
  function withDiscoveryParam(value: string | null): void {
    const params = new URLSearchParams()
    if (value !== null) params.set('discovery', value)
    const url = `https://game.local/${params.size ? `?${params}` : ''}`
    ;(globalThis as { window?: unknown }).window = {
      location: new URL(url),
    }
  }

  it('is a listed discovery style', () => {
    expect(DISCOVERY_STYLES).toContain('gib')
  })

  it('is selected from ?discovery=gib — not silently dropped to the card default', () => {
    withDiscoveryParam('gib')
    expect(selectedDiscoveryStyle()).toBe<DiscoveryStyle>('gib')
  })

  it('still falls back to the card default for genuinely unknown styles', () => {
    withDiscoveryParam('nope')
    expect(selectedDiscoveryStyle()).toBe('card')
  })

  it('falls back to the card default when no param is present', () => {
    withDiscoveryParam(null)
    expect(selectedDiscoveryStyle()).toBe('card')
  })
})
