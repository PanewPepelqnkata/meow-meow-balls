/**
 * THE CARD'S VOICE — every WORD that appears on a collectible card.
 *
 * The data module (ballCard.ts) DERIVES the numbers; this module holds
 * the WORDS. Splitting them keeps the maths free of prose and lets the
 * voice be edited without touching the derivation.
 *
 * Every table here is indexed deterministically from (tier, seed): the
 * same ball always gets the same words, and two balls of the same tier
 * get different ones.
 */

/** A deterministic 32-bit hash of a ball's seed (FNV-style mix). */
function hash(seed: number, salt: number): number {
  let h = Math.imul(Math.abs(Math.floor(seed)) ^ salt, 2654435761) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822519) >>> 0
  h ^= h >>> 13
  return h >>> 0
}

/** The species NAME — a head and a tail, glued together. */
export const NAME_HEADS = [
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

export const NAME_TAILS = [
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

/** The flavour lines — the card's small print, one per ball. */
export const FLAVOURS = [
  'Its whole body is a nervous wobble. It is not worried. It is just like that.',
  'Bounces off the floor so hard it forgets where it was going.',
  'Says hello by squeezing. Very loud. Sorry.',
  'Holds more water than looks reasonable. Do not squeeze.',
  'Has been sunbathing. It is extremely proud of this.',
  'Sleeps on the pile. Everyone else sleeps on it.',
  'The oldest one. Remembers when the container was taller.',
  'Says it is nearly done. It is not nearly done.',
  'Has a favourite corner. Will not explain which one.',
  'Waves at strangers. All strangers. Wave back.',
]

/**
 * The STRENGTH / WEAKNESS lines — one short line per ball, in the same
 * voice as the flavour lines. Each names a real-sounding strength and a
 * real-sounding weakness, so the card reads like a field guide.
 */
export const STRENGTHS = [
  'Bounces off everything. Including you.',
  'Cannot be hurried. Cannot be stopped.',
  'Strong against gravity. Briefly.',
  'Weakness: a firm handshake.',
  'Weakness: compliments. It absorbs them.',
  'Squeezes back. Twice, for good measure.',
  'Immune to gravity after the third bounce.',
  'Weakness: Mondays. Tuesdays, slightly less.',
  'Will befriend you. Will not let go.',
  'Eats nothing. Chews everything.',
  'Holds grudges. Holds very little else.',
  'Bounces back before you finish pushing it.',
  'Weakness: being photographed. It hides.',
  'Runs from nothing, at considerable speed.',
  'Hears a drop of water from three rooms away.',
  'Trusts you completely. This is a mistake.',
]

/** The rarity ladder, rarest last. */
export const RARITY_NAMES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const

/** The rarity name of a ball's card. */
export type RarityName = (typeof RARITY_NAMES)[number]

/**
 * The FILLED STARS for each rarity — one for a common card, five for a
 * legendary one. The renderer draws a star row (or a badge) from this.
 */
export const RARITY_STARS: readonly number[] = [1, 2, 3, 4, 5]

/**
 * The TYPE LINE, per tier: the ball's family plus a second word, so it
 * reads like a card ("OOZE / GOOPER") instead of a bare family name.
 * The first word is the family — the card's type, kept short.
 */
const TYPE_LINES: Record<number, string> = {
  1: 'SLIME / PEEBLER',
  2: 'SLIME / DRIBBLER',
  3: 'JELLY / WOBBLER',
  4: 'JELLY / SQUISHER',
  5: 'OOZE / GOOPER',
  6: 'OOZE / LUMPER',
  7: 'LEGEND / BOUNCER',
  8: 'LEGEND / TWINKLER',
  9: 'LEGEND / DREAMER',
  10: 'LEGEND / MYTH',
  11: 'LEGEND / ETERNAL',
  12: 'LEGEND / ORIGINAL',
}

/** The card's TYPE LINE for a tier — deterministic per tier. */
export function voiceTypeLine(tier: number): string {
  return TYPE_LINES[tier] ?? TYPE_LINES[1]!
}

/** The TYPE FAMILY on its own — the first word of the type line. */
export function voiceFamily(tier: number): string {
  return voiceTypeLine(tier).split(' / ')[0]!
}

/** The card name for a ball (deterministic per tier + seed). */
export function voiceName(tier: number, seed: number): string {
  const h = (Math.abs(Math.floor(seed)) + tier * 7) % NAME_HEADS.length
  const t = (Math.abs(Math.floor(seed * 1.7)) + tier * 3) % NAME_TAILS.length
  return NAME_HEADS[h]! + NAME_TAILS[t]!
}

/** The flavour line for a ball (deterministic per tier + seed). */
export function voiceFlavour(tier: number, seed: number): string {
  const i = (Math.abs(Math.floor(seed)) + tier) % FLAVOURS.length
  return FLAVOURS[i]!
}

/** The strength / weakness line for a ball (deterministic per tier + seed). */
export function voiceStrength(tier: number, seed: number): string {
  const i = hash(seed, 0x5f3a91 + tier * 7919) % STRENGTHS.length
  return STRENGTHS[i]!
}

/**
 * The card's SERIAL NUMBER — the collectible-card serial, as a number
 * (1..999) plus the "No. 042" form the renderer prints.
 */
export function voiceSerial(tier: number, seed: number): { value: number; text: string } {
  const value = (hash(seed, 0x2b7f15 + tier * 104729) % 999) + 1
  return { value, text: `No. ${String(value).padStart(3, '0')}` }
}
