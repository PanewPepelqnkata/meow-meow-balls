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
   * Phase 2.13.2 (spec §1): guaranteed resolution for a deferred replacement.
   * A pending replacement whose local space never clears (a jammed pile that
   * cannot relax) is spawned at the LEAST-PENETRATING position within the
   * local ring bound after this much simulated time — the soft-body contact
   * solver then separates the (touching) balls gently over a few frames.
   * This bounds the worst-case "sources gone, replacement absent" window to
   * this value; without it a jammed pile could defer forever, which is the
   * reported merge-loss defect.
   */
  pendingEmergencyMs: 900,
} as const
