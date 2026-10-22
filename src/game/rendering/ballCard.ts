import { getTier } from '../../config/ballTiers'
import { ballLookFor } from './BallAppearance'

/**
 * THE COLLECTIBLE CARD — a Pokédex-style entry for a discovered ball.
 *
 * The card is drawn in the game's own hand-drawn style, but it borrows the
 * collectible-card language: a framed portrait, a name plate, a stat block
 * and a flavour line. Every number on it is REAL — derived from the ball's
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
 */

/** A card entry for one discovered ball. */
export interface BallCard {
  /** The card's NAME — a species name in the game's voice. */
  name: string
  /** The short type line, e.g. "SLIME". */
  kind: string
  /** The flavour line. */
  flavour: string
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

/** The species NAME — deterministic per (tier, seed), in the game's voice. */
const NAME_HEADS = [
  'Blob',
  'Wobble',
  'Squish',
  'Nib',
  'Puff',
  'Gloop',
  'Munch',
  'Jelly',
  'Boing',
  'Wump',
  'Drip',
  'Snack',
  'Bloop',
  'Squishy',
  'Tumbl',
  'Fizzo',
]
const NAME_TAILS = [
  'er',
  'ling',
  'bert',
  'ington',
  'ook',
  'ump',
  'ozz',
  'ella',
  'ino',
  'y',
  'kins',
  'bo',
]

/** The flavour lines — one per tier family, chosen deterministically. */
const FLAVOURS = [
  'Its whole body is a nervous wobble. It is not worried. It is just like that.',
  'Bounces off the floor so hard it forgets where it was going.',
  'Says hello by squeezing. Very loud. Sorry.',
  'Holds more water than looks reasonable. Do not squeeze.',
  'Has been sunbathing. It is extremely proud of this.',
  'Sleeps on the pile. Everyone else sleeps on it.',
  'The oldest one. Remembers when the container was taller.',
]

/** The card name for a ball (deterministic per tier + seed). */
export function cardName(tier: number, seed: number): string {
  const h = (Math.abs(Math.floor(seed)) + tier * 7) % NAME_HEADS.length
  const t = (Math.abs(Math.floor(seed * 1.7)) + tier * 3) % NAME_TAILS.length
  return NAME_HEADS[h]! + NAME_TAILS[t]!
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

/** The flavour line for a ball. */
export function cardFlavour(tier: number, seed: number): string {
  const i = (Math.abs(Math.floor(seed)) + tier) % FLAVOURS.length
  return FLAVOURS[i]!
}

/** The type line — the ball's family, by tier. */
export function cardKind(tier: number): string {
  if (tier <= 2) return 'SLIME'
  if (tier <= 4) return 'JELLY'
  if (tier <= 6) return 'OOZE'
  return 'LEGEND'
}

/** Build the whole card for a ball. */
export function buildBallCard(tier: number, seed: number): BallCard {
  const t = getTier(tier)
  return {
    name: cardName(tier, seed),
    kind: cardKind(tier),
    flavour: cardFlavour(tier, seed),
    stats: cardStats(tier, seed),
    tier,
    color: t?.color ?? 0xffffff,
    shade: t?.shade ?? 0x888888,
  }
}
