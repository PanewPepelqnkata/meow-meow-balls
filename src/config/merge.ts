/** Merge tuning (gameplay config, not physics). */
export const MERGE = {
  /** Simulated-time window (ms) in which consecutive merges count as a chain. */
  chainWindowMs: 400,
  /**
   * Phase 2.10.2: per-replacement merge cooldown (simulated ms). A freshly
   * merged ball cannot participate in ANOTHER merge until this sim-time has
   * elapsed — top-of-pile chain merges stop firing within the same physics
   * step, which caused abrupt transitions, stale-event races and bad
   * replacement placements. Applied to the REPLACEMENT only (unrelated
   * pairs merge normally during the window), and physical collisions are
   * unaffected. Contact revalidation (active-pair scan) merges the pair as
   * soon as the cooldown expires — no new collisionStart required.
   */
  mergeCooldownMs: 120,
  /**
   * Micro-delay ceiling (simulated ms) for extreme-crush merges where a
   * neighbor's center is inside the merge pocket past the collapse limit.
   * Normal crowded merges commit immediately in place with soft pocket
   * conformation; deeply crushed pockets wait at most 120ms for the woken
   * pile to relax before committing in place.
   */
  pendingEmergencyMs: 120,
} as const
