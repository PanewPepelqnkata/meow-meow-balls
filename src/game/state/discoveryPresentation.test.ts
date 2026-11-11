import { describe, expect, it } from 'vitest'
import { discoveryPresentationFor } from './discoveryPresentation'

describe('discovery presentation routing', () => {
  it('keeps tiers 1-4 silent', () => {
    for (let tier = 1; tier <= 4; tier++) {
      expect(discoveryPresentationFor(tier, false, true, false)).toBeNull()
      expect(discoveryPresentationFor(tier, false, false, false)).toBeNull()
    }
  })

  it('shows the full book for a first lifetime tier 5+ discovery', () => {
    expect(discoveryPresentationFor(5, false, true, false)).toBe('first')
    expect(discoveryPresentationFor(11, false, true, false)).toBe('first')
  })

  it('shows the compact page for a known tier 5+ discovery', () => {
    expect(discoveryPresentationFor(5, false, false, false)).toBe('repeat')
    expect(discoveryPresentationFor(11, false, false, false)).toBe('repeat')
  })

  it('presents an identity only once per run and never in sandboxes', () => {
    expect(discoveryPresentationFor(7, true, true, false)).toBeNull()
    expect(discoveryPresentationFor(7, true, false, false)).toBeNull()
    expect(discoveryPresentationFor(7, false, true, true)).toBeNull()
  })
})
