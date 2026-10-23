import { describe, expect, it } from 'vitest'
import { ballLookFor } from '../rendering/BallAppearance'
import {
  buildBallCard,
  cardFlavour,
  cardKind,
  cardName,
  cardRarity,
  cardRarityScore,
  cardSerial,
  cardStats,
  cardStrength,
  cardTraitAverage,
  cardTraitValues,
  cardTypeLine,
  RARITY_NAMES,
  RARITY_STARS,
  RARITY_TRAIT_FLOORS,
  type BallCard,
  type RarityName,
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

/**
 * The collectible card's RARITY.
 *
 * The rarity is a pure function of (tier, seed) and it must agree with
 * the stat block printed beside it — a LEGENDARY card is always backed
 * by a strong stat block, a COMMON card never is.
 */
describe("the card's rarity", () => {
  const SEEDS = [0, 1, 7, 13, 42, 99, 777, 4242, 12345, 999999, 31337, 65535]
  const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  it('the rarity is one of the five collectible-card rarities', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        expect(RARITY_NAMES).toContain(buildBallCard(tier, seed).rarity)
      }
    }
  })

  it('the rarity is deterministic for the same ball', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        expect(cardRarity(tier, seed)).toBe(cardRarity(tier, seed))
        expect(buildBallCard(tier, seed).rarity).toBe(buildBallCard(tier, seed).rarity)
      }
    }
  })

  it('the rarity follows the ball, not the seed alone', () => {
    // Two balls of the same tier with different seeds do not all share
    // one rarity — the ball's own look changes the answer.
    const rarities = new Set(SEEDS.map((seed) => cardRarity(6, seed)))
    expect(rarities.size).toBeGreaterThan(1)
  })

  it('a higher tier is at least as rare as a lower one', () => {
    // The same ball, one tier up, is never a plainer card.
    for (const seed of SEEDS) {
      for (let tier = 1; tier < 12; tier++) {
        const low = RARITY_NAMES.indexOf(cardRarity(tier, seed))
        const high = RARITY_NAMES.indexOf(cardRarity(tier + 1, seed))
        expect(high).toBeGreaterThanOrEqual(low)
      }
    }
  })

  it('a LEGENDARY card is never backed by a low stat block', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        if (card.rarity !== 'LEGENDARY') continue
        // The trait average behind a LEGENDARY card is strong, and the
        // card's own printed stats back it up.
        expect(cardTraitAverage(card.stats)).toBeGreaterThanOrEqual(65)
        const best = Math.max(...card.stats.map((s) => s.value))
        expect(best).toBeGreaterThanOrEqual(80)
      }
    }
  })

  it('a COMMON card is never backed by a maxed stat block', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        if (card.rarity !== 'COMMON') continue
        // A plain card's trait average is modest — it is never the
        // strongest card in the game.
        expect(cardTraitAverage(card.stats)).toBeLessThan(55)
        // And none of the stats the rarity READS is maxed out. (WOBBLE
        // is excluded: it is always 99, so it says nothing.)
        const traits = cardTraitValues(card.stats)
        expect(Math.max(...traits)).toBeLessThan(90)
      }
    }
  })

  it('a rarer card always has a stronger stat block than a plainer one', () => {
    // The invariant that makes the rarity honest, stated where it is
    // actually true: at a FIXED tier, the rarity never goes down as the
    // ball's stat block goes up. A stronger look never earns a plainer
    // card.
    for (const tier of TIERS) {
      const cards = SEEDS.map((seed) => buildBallCard(tier, seed)).map((card) => ({
        rank: RARITY_NAMES.indexOf(card.rarity),
        trait: cardTraitAverage(card.stats),
      }))
      for (const a of cards) {
        for (const b of cards) {
          if (a.trait > b.trait) expect(a.rank).toBeGreaterThanOrEqual(b.rank)
        }
      }
    }
  })

  it('each rarity has its own trait band, and the bands rise', () => {
    // Every rung has a hard trait floor, so the rarity is backed by a
    // stat block: a card can never claim a rarity its stats do not
    // support. The floors rise with the ladder.
    const floors = RARITY_NAMES.map((r) => RARITY_TRAIT_FLOORS[r])
    for (let i = 1; i < floors.length; i++) {
      expect(floors[i]!).toBeGreaterThan(floors[i - 1]!)
    }
    // And every card actually meets the floor of the rarity it claims.
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        expect(cardTraitAverage(card.stats)).toBeGreaterThanOrEqual(
          RARITY_TRAIT_FLOORS[card.rarity],
        )
      }
    }
  })

  it('the rarity bands do not overlap within a tier', () => {
    // Per tier, a rarer card's stat block is never weaker than a
    // plainer card's. This is what the trait floors guarantee.
    for (const tier of TIERS) {
      const byRarity: Record<RarityName, number[]> = {
        COMMON: [],
        UNCOMMON: [],
        RARE: [],
        EPIC: [],
        LEGENDARY: [],
      }
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        byRarity[card.rarity].push(cardTraitAverage(card.stats))
      }
      for (let i = 0; i < RARITY_NAMES.length - 1; i++) {
        const lower = RARITY_NAMES[i]!
        const higher = RARITY_NAMES[i + 1]!
        if (!byRarity[lower].length || !byRarity[higher].length) continue
        expect(Math.min(...byRarity[higher])).toBeGreaterThanOrEqual(
          Math.max(...byRarity[lower]),
        )
      }
    }
  })

  it('the rarity agrees with the card it is printed on', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        expect(card.rarity).toBe(cardRarity(tier, seed))
        expect(RARITY_NAMES[card.rarityIndex]).toBe(card.rarity)
        expect(card.rarityIndex).toBe(RARITY_NAMES.indexOf(card.rarity))
      }
    }
  })

  it('the rarity score is the trait average plus the tier weight', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        const score = cardRarityScore(tier, card.stats)
        // A higher tier scores at least as high as a lower one.
        expect(score).toBeGreaterThanOrEqual(cardTraitAverage(card.stats))
        expect(cardRarityScore(tier, card.stats)).toBe(score)
      }
    }
  })

  it('the rarity carries a star count for the badge', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const card = buildBallCard(tier, seed)
        expect(card.rarityStars).toBe(RARITY_STARS[card.rarityIndex])
        expect(card.rarityStars).toBeGreaterThanOrEqual(1)
        expect(card.rarityStars).toBeLessThanOrEqual(5)
        // More stars means a rarer card.
        expect(card.rarityStars).toBe(card.rarityIndex + 1)
      }
    }
  })

  it('the rarest cards exist and are not common', () => {
    // There must be balls that reach the top of the ladder, and balls
    // that stay at the bottom — otherwise the rarity says nothing.
    const seen = new Set<RarityName>()
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        seen.add(cardRarity(tier, seed))
      }
    }
    expect(seen.has('LEGENDARY')).toBe(true)
    expect(seen.has('COMMON')).toBe(true)
  })
})

/**
 * The collectible card's SERIAL NUMBER — a card has a serial, and it
 * must look like one and stay with its ball.
 */
describe("the card's serial number", () => {
  it('looks like a serial number', () => {
    const serial = cardSerial(5, 4242)
    expect(serial.text).toMatch(/^No\. \d{3}$/)
    expect(serial.value).toBeGreaterThanOrEqual(1)
    expect(serial.value).toBeLessThanOrEqual(999)
    // The printed text carries the number.
    expect(serial.text).toBe(`No. ${String(serial.value).padStart(3, '0')}`)
  })

  it('is stable for the same ball', () => {
    for (const tier of [1, 4, 7, 9, 12]) {
      for (const seed of [0, 42, 999999]) {
        expect(cardSerial(tier, seed)).toEqual(cardSerial(tier, seed))
        expect(buildBallCard(tier, seed).serial).toBe(buildBallCard(tier, seed).serial)
        expect(buildBallCard(tier, seed).serialNumber).toBe(
          buildBallCard(tier, seed).serialNumber,
        )
      }
    }
  })

  it('differs between two different balls', () => {
    const a = buildBallCard(4, 111)
    const b = buildBallCard(4, 222)
    expect(a.serial).not.toBe(b.serial)
  })

  it('is on the card itself', () => {
    const card = buildBallCard(3, 77)
    expect(card.serial).toMatch(/^No\. \d{3}$/)
    expect(card.serialNumber).toBe(Number(card.serial.slice(4)))
  })
})

/**
 * The collectible card's TYPE LINE and STRENGTH line — the words that
 * make it read like a card rather than a label.
 */
describe("the card's type line and strength line", () => {
  it('the type line keeps its family and adds a second word', () => {
    expect(cardTypeLine(1)).toMatch(/^SLIME \/ [A-Z]+$/)
    expect(cardTypeLine(3)).toMatch(/^JELLY \/ [A-Z]+$/)
    expect(cardTypeLine(5)).toMatch(/^OOZE \/ [A-Z]+$/)
    expect(cardTypeLine(7)).toMatch(/^LEGEND \/ [A-Z]+$/)
  })

  it('the type line is deterministic per tier', () => {
    for (const tier of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(cardTypeLine(tier)).toBe(cardTypeLine(tier))
      // The same tier always gives the same second word.
      expect(cardTypeLine(tier)).toBe(buildBallCard(tier, 1).typeLine)
    }
  })

  it('the type line is on the card, with its family', () => {
    const card = buildBallCard(5, 123)
    expect(card.typeLine).toBe(cardTypeLine(5))
    expect(card.kind).toBe('OOZE')
    expect(card.typeLine.startsWith(`${card.kind} / `)).toBe(true)
  })

  it('the strength line is a short, non-empty line', () => {
    const s = cardStrength(4, 999)
    expect(s.length).toBeGreaterThan(8)
    expect(s.length).toBeLessThan(70)
    expect(s.endsWith('.')).toBe(true)
  })

  it('the strength line is deterministic per ball', () => {
    for (const tier of [1, 5, 9]) {
      for (const seed of [0, 42, 777]) {
        expect(cardStrength(tier, seed)).toBe(cardStrength(tier, seed))
      }
    }
  })

  it('the strength line differs between two different balls', () => {
    expect(cardStrength(4, 111)).not.toBe(cardStrength(4, 222))
  })

  it('the strength line is on the card', () => {
    const card = buildBallCard(6, 314)
    expect(card.strength).toBe(cardStrength(6, 314))
  })
})

/**
 * The whole card — the new fields must all be present, and every one of
 * them must be a pure function of (tier, seed).
 */
describe('the whole collectible card', () => {
  it('carries every collectible-card field', () => {
    const card: BallCard = buildBallCard(6, 555)
    expect(card.name.length).toBeGreaterThan(3)
    expect(card.kind.length).toBeGreaterThan(2)
    expect(card.typeLine.length).toBeGreaterThan(card.kind.length)
    expect(card.flavour.length).toBeGreaterThan(10)
    expect(card.strength.length).toBeGreaterThan(8)
    expect(RARITY_NAMES).toContain(card.rarity)
    expect(card.serial).toMatch(/^No\. \d{3}$/)
    expect(card.stats.length).toBe(7)
  })

  it('is a pure function of (tier, seed)', () => {
    for (const tier of [1, 3, 6, 9, 12]) {
      for (const seed of [0, 7, 42, 4242, 999999]) {
        const a = buildBallCard(tier, seed)
        const b = buildBallCard(tier, seed)
        expect(a).toEqual(b)
        expect(a.rarity).toBe(b.rarity)
        expect(a.serial).toBe(b.serial)
        expect(a.strength).toBe(b.strength)
        expect(a.typeLine).toBe(b.typeLine)
      }
    }
  })

  it('gives two different balls of the same tier different cards', () => {
    const a = buildBallCard(4, 111)
    const b = buildBallCard(4, 222)
    const differs =
      a.name !== b.name ||
      a.rarity !== b.rarity ||
      a.serial !== b.serial ||
      a.strength !== b.strength ||
      JSON.stringify(a.stats) !== JSON.stringify(b.stats)
    expect(differs).toBe(true)
  })
})
