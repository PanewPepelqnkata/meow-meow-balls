/**
 * COMBO REWARD FEEDBACK — all sizing, colors, animation timing.
 *
 * Single source of truth for how big/loud the merge reward popups get as
 * the combo (merge-chain depth) climbs. `tiers` are thresholds: the style
 * for a depth is the LAST tier whose `minDepth` ≤ depth, so adding a row
 * changes everything at that depth and above.
 *
 * Sizing caps: the largest tier's sizes are the hard maxima — popups never
 * grow past them, so even an 12x chain cannot cover the play field.
 */

export interface ComboTierStyle {
  /** Depth at which this style starts applying. */
  minDepth: number
  /** `+N` text. */
  scoreSize: number
  scoreStroke: number
  /** Grade label ("Great!", "Awesome!"…). */
  gradeSize: number
  gradeStroke: number
  /** "Nx Combo!" label. */
  comboSize: number
  comboStroke: number
  comboColor: string
  /** Drop shadow strength (px offsets; blur is offset × 2). */
  shadowOffset: number
  /** Entrance punch: overshoot scale + duration, then settle to 1. */
  punchScale: number
  punchMs: number
  settleMs: number
  /** Soft secondary bounce after the punch (0 = off). */
  bounceScale: number
  bounceMs: number
  /** Rotation wiggle during the punch (degrees, ±). */
  wiggleDeg: number
  /** Float-up distance (px) over the popup's life. */
  risePx: number
  /** Total on-screen time (ms). */
  durationMs: number
  /** Star-sparkle burst count around the text (0 = none). */
  sparkles: number
  /** Halo ring color behind the text (null = none). */
  haloColor: string | null
  haloAlpha: number
}

export const COMBO_FEEDBACK = {
  /** Depth thresholds — one row per visibly-distinct impact level. */
  tiers: [
    {
      minDepth: 1,
      scoreSize: 46,
      scoreStroke: 7,
      gradeSize: 24,
      gradeStroke: 5,
      comboSize: 22,
      comboStroke: 4,
      comboColor: '#ffffff',
      shadowOffset: 3,
      punchScale: 1.14,
      punchMs: 140,
      settleMs: 90,
      bounceScale: 0,
      bounceMs: 0,
      wiggleDeg: 0,
      risePx: 54,
      durationMs: 820,
      sparkles: 0,
      haloColor: null,
      haloAlpha: 0,
    },
    {
      minDepth: 2,
      scoreSize: 52,
      scoreStroke: 8,
      gradeSize: 28,
      gradeStroke: 6,
      comboSize: 25,
      comboStroke: 5,
      comboColor: '#aef35c',
      shadowOffset: 3,
      punchScale: 1.2,
      punchMs: 160,
      settleMs: 100,
      bounceScale: 0,
      bounceMs: 0,
      wiggleDeg: 1.5,
      risePx: 60,
      durationMs: 880,
      sparkles: 0,
      haloColor: null,
      haloAlpha: 0,
    },
    {
      minDepth: 3,
      scoreSize: 58,
      scoreStroke: 9,
      gradeSize: 32,
      gradeStroke: 7,
      comboSize: 28,
      comboStroke: 6,
      comboColor: '#ffd23e',
      shadowOffset: 4,
      punchScale: 1.26,
      punchMs: 180,
      settleMs: 110,
      bounceScale: 1.05,
      bounceMs: 160,
      wiggleDeg: 2.5,
      risePx: 66,
      durationMs: 950,
      sparkles: 4,
      haloColor: '#ffb300',
      haloAlpha: 0.16,
    },
    {
      minDepth: 5,
      scoreSize: 66,
      scoreStroke: 11,
      gradeSize: 36,
      gradeStroke: 8,
      comboSize: 32,
      comboStroke: 7,
      comboColor: '#ff5ea8',
      shadowOffset: 5,
      punchScale: 1.34,
      punchMs: 200,
      settleMs: 120,
      bounceScale: 1.07,
      bounceMs: 190,
      wiggleDeg: 3.5,
      risePx: 74,
      durationMs: 1050,
      sparkles: 7,
      haloColor: '#ff2e7e',
      haloAlpha: 0.2,
    },
    {
      minDepth: 7,
      scoreSize: 74,
      scoreStroke: 13,
      gradeSize: 40,
      gradeStroke: 9,
      comboSize: 36,
      comboStroke: 8,
      comboColor: '#c86bff',
      shadowOffset: 6,
      punchScale: 1.42,
      punchMs: 220,
      settleMs: 130,
      bounceScale: 1.09,
      bounceMs: 220,
      wiggleDeg: 4.5,
      risePx: 84,
      durationMs: 1150,
      sparkles: 11,
      haloColor: '#8f2bff',
      haloAlpha: 0.24,
    },
  ] as readonly ComboTierStyle[],

  /** Hard size ceilings (clamp even if a tier row exceeds them) — popups
   * must never cover the play field. */
  maxScoreSize: 74,
  maxGradeSize: 40,
  maxComboSize: 36,

  /** Lane stagger for overlapping popups. */
  laneOffsetsX: [0, -26, 26],
  laneOffsetY: 44,

  /** Max simultaneous popups (pathological mega-chains drop extras). */
  maxPopups: 10,
} as const

/** Style for a chain depth (last tier with minDepth ≤ depth; ≥ 1). */
export function comboStyleFor(depth: number): ComboTierStyle {
  const d = Math.max(1, Math.floor(depth))
  let out: ComboTierStyle = COMBO_FEEDBACK.tiers[0]!
  for (const t of COMBO_FEEDBACK.tiers) if (d >= t.minDepth) out = t
  return out
}
