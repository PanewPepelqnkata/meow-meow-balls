/**
 * Phase 2.13.0 (spec §1, §6, §7) — centralized presentation thresholds.
 * Single source of truth for discovery gating/timing and background-theme
 * milestone progression, so tuning never touches scene code.
 */

/** Full-screen anime discovery presentation (first-time tiers only). */
export const DISCOVERY = {
  /** First tier that earns the discovery presentation (tiers 1–4 merge
   * silently — 4 is discovered by default). */
  minTier: 5,
  /** Total presentation time before the fade-out begins (spec: 1.4–2.0s).
   *  The collectible card is LONGER: its reveal has a beat before the
   *  card arrives (the "?" holds on the black stage), then the card is
   *  on screen for the player to read it. */
  showMs: 1800,
  /** The moment the card has LANDED, measured from the start of the
   *  presentation (ms). Everything in the card's choreography is timed
   *  backwards FROM this number, so the animation and the dismiss timer
   *  (cardRevealMs + cardShowMs) can never drift apart.
   *
   *  The reveal is: black stage → the "?" pops in and holds → the "?"
   *  dissolves as the card opens out of it → the card thunks down. */
  cardRevealMs: 1400,
  /** How long the card's ARRIVAL takes (ms) — the flip, the landing
   *  punch and the character's pop. It is contained INSIDE cardRevealMs
   *  (the arrival starts at cardRevealMs - cardArriveMs), so the card is
   *  on screen for the FULL cardShowMs once it has landed. */
  cardArriveMs: 480,
  /** The card's FLIP (ms) — the edge-on swing that opens the card out of
   *  the "?". The card lands when the flip ends. */
  cardFlipMs: 240,
  /** The "?"'s DISSOLVE (ms) — it is sucked up into the light as the card
   *  opens, so the two read as one continuous moment. */
  cardCollapseMs: 200,
  /** How long the card itself stays on screen after it arrives (ms) —
   *  long enough to read the name, the stats and the flavour. */
  cardShowMs: 3600,
  /** Fade-out duration. */
  fadeMs: 300,
} as const

/**
 * Background theme progression order. `advanceOnTier` maps a first-time
 * DISCOVERED tier to the theme index it advances TO (theme index into
 * `order`, clamped) — the primary trigger. `comboTier` is the chain depth
 * that advances the theme as the secondary (exceptional-combo) trigger;
 * the combo path advances at most one step and only when the next theme is
 * still locked by its tier gate.
 */
export const THEME_PROGRESS = {
  order: ['light', 'space', 'jungle', 'fantasy'] as const,
  /** First-time discovery of this tier advances the background to the
   * NEXT theme in `order` (tier → steps taken). */
  advanceOnTier: { 4: 1, 6: 2, 8: 3 } as Record<number, number>,
  /** An exceptional chain of this depth advances one step (secondary). */
  comboDepth: 6,
  /** Crossfade duration (spec: 600–1000ms). */
  fadeMs: 800,
} as const

/** Combo grade ladder — index derives from the REAL chain depth. */
export const COMBO_GRADES = [
  { minDepth: 1, grade: 'Good!', color: '#00bcd4' },
  { minDepth: 2, grade: 'Great!', color: '#4caf50' },
  { minDepth: 3, grade: 'Supreme!', color: '#ff9800' },
  { minDepth: 5, grade: 'Awesome!', color: '#e91e63' },
  { minDepth: 7, grade: 'Unbelievable!', color: '#9c27b0' },
] as const

/** Grade for a chain depth (highest threshold ≤ depth; depth ≥ 1). */
export function gradeForChain(depth: number): { grade: string; color: string } {
  let out: { grade: string; color: string } = COMBO_GRADES[0]
  for (const g of COMBO_GRADES) if (depth >= g.minDepth) out = { grade: g.grade, color: g.color }
  return out
}
