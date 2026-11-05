import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BossRunCollectibles } from './BossDashboard'
import type { RunCollectibles } from '../game/state/collectibleMetadata'

vi.mock('../services/auth', () => ({ authService: {} }))
vi.mock('../services/boss', () => ({ bossService: {} }))

describe('BossRunCollectibles', () => {
  it('shows each recorded character with its stored palette and discovery date', () => {
    const collectibles: RunCollectibles = [
      { tier: 9, theme: 'pig', variant: 2, discoveredAt: Date.parse('2026-11-02T19:00:00.000Z') },
      { tier: 10, theme: 'crab', variant: 5, discoveredAt: Date.parse('2026-11-02T19:05:00.000Z') },
    ]
    const markup = renderToStaticMarkup(<BossRunCollectibles collectibles={collectibles} />)

    expect(markup).toContain('T9 — PIG')
    expect(markup).toContain('T10 — CRAB')
    expect(markup).toContain('Palette 2')
    expect(markup).toContain('Palette 5')
    expect(markup).toContain('Palette 2 (0-based)')
    expect(markup).toContain(new Date(collectibles[0]!.discoveredAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }))
    expect(markup).toContain('Collectibles discovered in this run')
    expect(markup).not.toContain('SHARK')
    expect(markup).not.toContain('None discovered')
    expect(markup).not.toContain('Not recorded')
  })

  it('distinguishes a recorded empty run from legacy unrecorded runs', () => {
    const markup = renderToStaticMarkup(<BossRunCollectibles collectibles={[]} />)

    expect(markup).toContain('None discovered')
    expect(markup).not.toContain('Not recorded')
    expect(markup).not.toContain('T9')
    expect(markup).not.toContain('T10')
  })

  it.each([null, undefined])('labels %s legacy metadata as not recorded', (collectibles) => {
    const markup = renderToStaticMarkup(<BossRunCollectibles collectibles={collectibles} />)

    expect(markup).toContain('Not recorded')
    expect(markup).not.toContain('None discovered')
    expect(markup).not.toContain('PIG')
    expect(markup).not.toContain('CRAB')
  })
})
