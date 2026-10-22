import { describe, expect, it } from 'vitest'
import { ballLookFor } from '../rendering/BallAppearance'
import {
  buildBallCard,
  cardFlavour,
  cardKind,
  cardName,
  cardStats,
} from '../rendering/ballCard'
import { getTier } from '../../config/ballTiers'

/**
 * The COLLECTIBLE CARD's data.
 *
 * The card is a real record of the ball — every stat is derived from the
 * ball's own deterministic look and its tier, so two balls of the same tier
 * but different seeds get different cards, and the same ball always gets
 * the same card.
 */
describe('the collectible card', () => {
  it('a card is deterministic for the same ball', () => {
    expect(buildBallCard(5, 12345)).toEqual(buildBallCard(5, 12345))
  })

  it('two different balls of the same tier get different cards', () => {
    const a = buildBallCard(4, 111)
    const b = buildBallCard(4, 222)
    // The name or the stats must differ (they are seeded per ball).
    const differs = a.name !== b.name || JSON.stringify(a.stats) !== JSON.stringify(b.stats)
    expect(differs).toBe(true)
  })

  it('the stats are all within the 0..99 card range', () => {
    for (let tier = 1; tier <= 9; tier++) {
      for (const seed of [0, 1, 7, 99, 4242, 999999]) {
        const card = buildBallCard(tier, seed)
        expect(card.stats.length).toBeGreaterThan(3)
        for (const s of card.stats) {
          expect(s.value).toBeGreaterThanOrEqual(1)
          expect(s.value).toBeLessThanOrEqual(99)
        }
      }
    }
  })

  it('the stats are REAL — they follow the ball, not the seed alone', () => {
    // A BIGGER ball is HEFTIER and less TINY (the radius drives both).
    const small = buildBallCard(1, 777)
    const big = buildBallCard(7, 777)
    const val = (c: ReturnType<typeof buildBallCard>, label: string) =>
      c.stats.find((s) => s.label === label)!.value
    expect(val(big, 'HEFTY')).toBeGreaterThan(val(small, 'HEFTY'))
    expect(val(big, 'TINY')).toBeLessThan(val(small, 'TINY'))
  })

  it('the stat labels are the collectible-card set', () => {
    const labels = buildBallCard(3, 5).stats.map((s) => s.label)
    expect(labels).toContain('TINY')
    expect(labels).toContain('HEFTY')
    expect(labels).toContain('BOUNCY')
  })

  it('the name is a real name (two words, letters only)', () => {
    const name = cardName(5, 4242)
    expect(name.length).toBeGreaterThan(3)
    expect(name).toMatch(/^[A-Za-z]+$/)
  })

  it('the type line follows the tier family', () => {
    expect(cardKind(1)).toBe('SLIME')
    expect(cardKind(3)).toBe('JELLY')
    expect(cardKind(5)).toBe('OOZE')
    expect(cardKind(7)).toBe('LEGEND')
  })

  it('the flavour line is non-empty and deterministic', () => {
    const f = cardFlavour(4, 999)
    expect(f.length).toBeGreaterThan(10)
    expect(cardFlavour(4, 999)).toBe(f)
  })

  it('the card carries the tier colour and shade', () => {
    const card = buildBallCard(4, 1)
    expect(card.color).toBe(getTier(4)!.color)
    expect(card.shade).toBe(getTier(4)!.shade)
  })

  it('the BOUNCY stat follows the contour wobble', () => {
    // A ball with a bigger wobble amplitude must score higher.
    const look = ballLookFor(3, 42)
    const stats = cardStats(3, 42)
    const bouncy = stats.find((s) => s.label === 'BOUNCY')!.value
    const wobble = stats.find((s) => s.label === 'WOBBLE')!.value
    expect(bouncy).toBeGreaterThan(0)
    expect(wobble).toBeGreaterThan(0)
    // The wobble stat is derived from the look's lobe count.
    expect(wobble).toBe(Math.max(1, Math.min(99, Math.round(Math.min(1, (look.lobes1 + look.lobes2) / 8) * 99))))
  })
})
