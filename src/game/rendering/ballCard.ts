import { getTier } from '../../config/ballTiers'
import { ballLookFor } from './BallAppearance'
import {
  RARITY_NAMES,
  RARITY_STARS,
  voiceFamily,
  voiceFlavour,
  voiceName,
  voiceSerial,
  voiceStrength,
  voiceTypeLine,
  type RarityName,
} from './cardVoice'

/**
 * THE COLLECTIBLE CARD — a Pokédex-style entry for a discovered ball.
 *
 * The card is drawn in the game's own hand-drawn style, but it borrows the
 * collectible-card language: a framed portrait, a name plate, a rarity,
 * a serial number, a type line, a stat block, a strength line and a
 * flavour line. Every number on it is REAL — derived from the ball's
 * own deterministic look and its tier — so a card is a genuine record of
 * that ball, not decoration.
 *
 * The stats are scaled to the same 0-99 range a collectible card uses, so
 * they read as a stat block:
 *
 * - TINY / HEFTY: the ball's radius (small balls are light, big ones
 *   heavy).
 * - BOUNCY: the contour's wobble amplitude (a wobbly ball bounces more).
 * - WOBBLE: the contour's lobe count (how many humps it has).
 * - EYES: the eye size.
 * - GRIN: the mouth's curve (a wide grin is a high grin).
 * - SILLY: a deterministic per-seed quirk score.
 *
 * The WORDS live in cardVoice.ts (name, flavour, strength, type line);
 * this module only derives the NUMBERS.
 */

// The card's words, re-exported under the names the rest of the game uses.
export {
  voiceName as cardName,
  voiceFlavour as cardFlavour,
  voiceFamily as cardKind,
  voiceTypeLine as cardTypeLine,
  voiceStrength as cardStrength,
  voiceSerial as cardSerial,
  RARITY_NAMES,
  RARITY_STARS,
  type RarityName,
} from './cardVoice'

/** A card entry for one discovered ball. */
export interface BallCard {
  /** The card's NAME — a species name in the game's voice. */
  name: string
  /** The type FAMILY on its own ("SLIME", "JELLY", "OOZE", "LEGEND"). */
  kind: string
  /** The full TYPE LINE, family + second word ("OOZE / GOOPER"). */
  typeLine: string
  /** The flavour line. */
  flavour: string
  /** The strength / weakness line. */
  strength: string
  /** The card's RARITY, e.g. "RARE". */
  rarity: RarityName
  /** The rarity's rung on the ladder, 0 (COMMON) .. 4 (LEGENDARY). */
  rarityIndex: number
  /** How many stars the rarity is worth (1..5) — for a badge/star row. */
  rarityStars: number
  /** The serial number as printed, e.g. "No. 042". */
  serial: string
  /** The serial number on its own (1..999). */
  serialNumber: number
  /** The stat block: label → value (0-99). */
  stats: { label: string; value: number }[]
  /** The tier this card is for. */
  tier: number
  /** The ball's colour, and its darker shade. */
  color: number
  shade: number
}

/** Scale a 0..1 value to the 0..99 stat range, biased so mid values read
 * as "decent" rather than everything landing at 50. */
function stat(v: number): number {
  return Math.max(1, Math.min(99, Math.round(v * 99)))
}

/**
 * The stats the rarity reads — the ones that actually VARY from ball to
 * ball, and so say something about how unusual a ball is.
 *
 * TINY and HEFTY are left out: they are one size fact split in two, and
 * a ball's SIZE is already spoken for by its tier (see TIER_WEIGHT).
 * WOBBLE is left out too: it saturates (every ball has 8+ lobes, so it
 * is always 99) and would tell the rarity nothing.
 */
const TRAIT_LABELS = ['BOUNCY', 'EYES', 'GRIN', 'SILLY'] as const

/**
 * The rarity WEIGHT of each tier — how rare the tier itself is.
 *
 * The weights rise with the tier: a tier-1 pebble is the most common
 * thing in the container, a tier-12 is the rarest thing in it. This is
 * the tier's own contribution to the rarity, and it is what lets a high
 * tier earn a high rarity with a less extreme look — while the trait
 * floor (below) still stops it buying one with a poor stat block.
 *
 * The ladder is tuned so the mix lands on roughly COMMON 7% / UNCOMMON
 * 22% / RARE 36% / EPIC 27% / LEGENDARY 8% across all twelve tiers.
 */
const TIER_WEIGHT: readonly number[] = [
  0, // tier 1
  2, // tier 2
  5, // tier 3
  8, // tier 4
  11, // tier 5
  15, // tier 6
  18, // tier 7
  21, // tier 8
  23, // tier 9
  25, // tier 10
  27, // tier 11
  28, // tier 12
]

/**
 * The RARITY LADDER.
 *
 * A ball's rarity is the highest rung it reaches, and a rung needs BOTH:
 *
 * - `score` — the ball's rarity SCORE (its trait average plus its tier
 *   weight) must reach the floor. The score's trait half is read
 *   straight off the card's OWN stat block, so the rarity can never
 *   disagree with the numbers printed beside it.
 * - `trait` — the ball's trait average must reach the floor too. This
 *   is what makes the rarity HONEST: a high tier earns its rarity with
 *   a less extreme look, but it can never earn a high rarity with a
 *   poor stat block.
 *
 * The trait floors rise with the ladder, so a rarer card always has a
 * stronger stat block behind it: a LEGENDARY card is always backed by a
 * genuinely strong stat block, and a COMMON card never is.
 */
const RARITY_LADDER: { name: RarityName; score: number; trait: number }[] = [
  { name: 'COMMON', score: 0, trait: 0 },
  { name: 'UNCOMMON', score: 50, trait: 50 },
  { name: 'RARE', score: 62, trait: 55 },
  { name: 'EPIC', score: 78, trait: 60 },
  { name: 'LEGENDARY', score: 92, trait: 68 },
]

/**
 * The TRAIT FLOOR of each rarity — the minimum trait average a card's
 * stat block must have to carry that rarity.
 *
 * These are what make the rarity honest: the floors rise with the
 * ladder, so a rarer card is always backed by a stronger stat block.
 * A card can never claim a rarity its own numbers do not support.
 */
export const RARITY_TRAIT_FLOORS: Record<RarityName, number> = {
  COMMON: RARITY_LADDER[0]!.trait,
  UNCOMMON: RARITY_LADDER[1]!.trait,
  RARE: RARITY_LADDER[2]!.trait,
  EPIC: RARITY_LADDER[3]!.trait,
  LEGENDARY: RARITY_LADDER[4]!.trait,
}

/** The card's stat block, derived from the ball's REAL look + tier. */
export function cardStats(tier: number, seed: number): { label: string; value: number }[] {
  const t = getTier(tier)
  const look = ballLookFor(tier, seed)
  const maxRadius = 130 // tier 7's radius — the top of the scale
  const r = t?.radius ?? 44
  return [
    { label: 'TINY', value: stat(1 - (r - 44) / (maxRadius - 44)) },
    { label: 'HEFTY', value: stat((r - 44) / (maxRadius - 44)) },
    { label: 'BOUNCY', value: stat(Math.min(1, (look.amp1 + look.amp2) / 0.05)) },
    { label: 'WOBBLE', value: stat(Math.min(1, (look.lobes1 + look.lobes2) / 8)) },
    { label: 'EYES', value: stat((look.eyeW + look.eyeH) / 1.6) },
    { label: 'GRIN', value: stat(Math.min(1, look.mouthW / 0.3)) },
    { label: 'SILLY', value: stat(((Math.abs(Math.floor(seed * 3.7)) % 100) / 100)) },
  ]
}

/**
 * The ball's TRAIT STATS — the stats the rarity reads, in the order they
 * are read. These are the only stats that say anything about how
 * unusual a ball is (see TRAIT_LABELS).
 */
export function cardTraitValues(stats: { label: string; value: number }[]): number[] {
  return TRAIT_LABELS.map((label) => stats.find((s) => s.label === label)?.value ?? 0)
}

/**
 * The ball's TRAIT AVERAGE — the mean of the stats that describe how
 * unusual its look is, on the same 0-99 scale as the stats themselves.
 *
 * This is the number the rarity is built on, and it is read straight
 * off the card's own stat block, so the rarity can never disagree with
 * the stats printed beside it.
 */
export function cardTraitAverage(stats: { label: string; value: number }[]): number {
  const values = cardTraitValues(stats)
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * The card's RARITY SCORE — the ball's trait average plus the weight of
 * its tier (a higher tier is rarer, so it needs a less extreme look to
 * earn the same rarity). This is the single number the ladder reads.
 */
export function cardRarityScore(tier: number, stats: { label: string; value: number }[]): number {
  return cardTraitAverage(stats) + (TIER_WEIGHT[tier - 1] ?? 0)
}

/**
 * The card's RARITY — a pure function of (tier, seed), and CONSISTENT
 * with the card's own stat block.
 *
 * The rarity is the highest rung whose score AND trait floors the ball
 * reaches. The score's trait half is read straight off the card's own
 * stat block, so the rarity can never disagree with the numbers printed
 * beside it; the trait floor stops a rare tier from buying a high
 * rarity with a poor stat block.
 */
export function cardRarity(tier: number, seed: number): RarityName {
  const stats = cardStats(tier, seed)
  const score = cardRarityScore(tier, stats)
  const trait = cardTraitAverage(stats)
  let rung = RARITY_LADDER[0]!
  for (const candidate of RARITY_LADDER) {
    if (score >= candidate.score && trait >= candidate.trait) rung = candidate
  }
  return rung.name
}

/** Build the whole card for a ball. */
export function buildBallCard(tier: number, seed: number): BallCard {
  const t = getTier(tier)
  const stats = cardStats(tier, seed)
  const score = cardRarityScore(tier, stats)
  const trait = cardTraitAverage(stats)
  let rung = RARITY_LADDER[0]!
  for (const candidate of RARITY_LADDER) {
    if (score >= candidate.score && trait >= candidate.trait) rung = candidate
  }
  const rarityIndex = RARITY_NAMES.indexOf(rung.name)
  const serial = voiceSerial(tier, seed)
  return {
    name: voiceName(tier, seed),
    kind: voiceFamily(tier),
    typeLine: voiceTypeLine(tier),
    flavour: voiceFlavour(tier, seed),
    strength: voiceStrength(tier, seed),
    rarity: rung.name,
    rarityIndex,
    rarityStars: RARITY_STARS[rarityIndex] ?? 1,
    serial: serial.text,
    serialNumber: serial.value,
    stats,
    tier,
    color: t?.color ?? 0xffffff,
    shade: t?.shade ?? 0x888888,
  }
}
