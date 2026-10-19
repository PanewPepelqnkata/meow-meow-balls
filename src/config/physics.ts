/**
 * Centralized Matter.js tunables (ARCHITECTURE.md §4).
 * No physics numbers may be hardcoded in systems or scenes.
 */
export const PHYSICS = {
  /**
   * Fixed simulation rate. Rendering frame times are accumulated into these
   * steps. Phase 2.9.8: 60Hz → 120Hz. Measured reason: the constraint/contact
   * solver war in a settled pile produces per-substep position corrections
   * whose amplitude scales with the per-step strain accumulation — at 60Hz
   * the rendered contour wobbled 2-7px/frame (the visible resting jitter);
   * at 120Hz every per-step displacement halves and the whole-ball rest
   * gate becomes reachable. All per-step constants elsewhere (SOFT.*,
   * MAX_PARTICLE_SPEED) are defined at this rate.
   */
  stepHz: 120,
  stepMs: 1000 / 120,
  /** Max substeps per rendered frame; excess time is dropped to avoid spiral of death. */
  maxSubSteps: 10,
  /** Frame-time inputs larger than this are clamped before accumulation. */
  maxFrameDeltaMs: 250,

  /**
   * Phase 2.10.0 NOTE: the fall profile is NOT gravity-limited — measurement
   * (free-fall.test.ts) shows the soft-ball particle speed clamp
   * (SOFT.maxParticleSpeed) dominates the drop, so the fall feel is tuned
   * THERE. Scale stays at the 2.9.9-measured value to avoid shifting the
   * settled-pile load equilibrium.
   */
  gravity: { x: 0, y: 1, scale: 0.0016 },

  engine: {
    // Phase 2.9.9: 4 → 8. Measured with substep-stage instrumentation: at 4
    // iterations the constraint network YIELDS under sustained pile load —
    // Engine.update re-crushed settled cross-ball contacts by ~8px EVERY
    // substep, so the separation backstop was in a permanent war (±4px churn,
    // piles never quiet enough to sleep, standing constraint error 2-9px).
    // At 8 the rings hold their shape under load and the pile reaches a true
    // static equilibrium (the backstop converges and stays converged).
    // Per-second constraint work at 120Hz/8 ≈ 60Hz/4.
    // PERF AUDIT (2026): a retune to 8/8/2 (−46% engine time measured)
    // and 10/10/3 (−33%) BOTH fail the settled-pile battery
    // (softBallMaxSpeed 4.6 and 6.7 vs the <2 stillness gate) — the
    // iteration budget is LOAD-BEARING for rest quality at this world
    // shape. Do not retune without an adaptive-iterations design
    // (14 while any ball is awake-and-settling, 8 when settled) gated
    // by the full stabilization battery.
    positionIterations: 14,
    velocityIterations: 12,
    constraintIterations: 4,
    enableSleeping: true, // soft particles opt out via sleepThreshold=Infinity
  },

  ball: {
    restitution: 0.2,
    friction: 0.08,
    frictionStatic: 0.2,
    frictionAir: 0.004,
    slop: 0.02,
    density: 0.001,
  },

  wall: {
    // Low friction so balls slide down the trapezoid's sloped walls toward
    // the center (slope ≈ 6°; higher friction makes balls stick on the wall).
    friction: 0.02,
    restitution: 0.15,
  },

  /** Max |velocity| per step (px/step) applied to dynamic bodies to prevent tunneling. */
  maxSpeed: 24,
} as const
