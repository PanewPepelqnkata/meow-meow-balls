import * as Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { getTier } from '../../config/ballTiers'

/**
 * Phase 2.7 — single-ball soft-body prototype using NATIVE Matter.js:
 * a ring of particle circles joined by rim constraints, spokes to a center
 * particle, and a minimal gas-pressure area-preservation solver.
 *
 * CRITICAL REQUIREMENT MET: the particles are real Matter bodies — they
 * collide with the floor, container walls and other balls themselves. There
 * is no hidden rigid circle: the deformed shape IS the physical shape.
 *
 * The only custom code is the area-preservation pass (a few lines per step)
 * — native constraints alone cannot keep an airless ring from collapsing.
 */

export const SOFT = {
  /** Particles on the ring (Phase 2.8: chosen after a 12/16/20 comparison). */
  segments: 16,
  /** Particle radius as a fraction of the ball radius. 0.32 puts the
   * collision outer surface (ring radius + particle radius) at the nominal
   * radius. The RENDERED contour stays strictly INSIDE this collision
   * envelope (renderContour offsets inward from the particle outer edge),
   * so Matter's own contact solver — not a custom correction pass — owns
   * ball/ball and ball/wall separation. */
  particleRadiusFactor: 0.32,
  /**
   * Contact skin (px) baked into EVERY particle body's collision radius
   * (body radius = visual particle radius + skin). Matter's own contact
   * solver then natively holds a 2·skin clearance between different balls'
   * surfaces with proper impulse physics — no custom pass owns contact
   * separation. Chosen after measurement: skin 2 keeps worst-case transient
   * penetration small enough to be fully covered by the 7px ink stroke while
   * letting the pile pack tightly (the rendered contour sits INSIDE the
   * collision envelope, so the visible fill gap at contacts is the
   * contour's own wave dip, ≤ ~2px — always ink-covered).
   */
  contactSkin: 2,
  /** Particle density at `densityRefRadius` (Phase 2.9.9 mass normalization:
   * composite mass ∝ R², tier 6 reference — see createSoftBall). The
   * reference radius derives from the tier config (single source of truth
   * for ball sizes). */
  particleDensity: 0.0009,
  /** Reference radius for the per-radius density derivation (tier 6). */
  densityRefRadius: getTier(6)!.radius,
  /** Rim (neighbor-to-neighbor) stiffness — SLIME CONTROL (spec §4). Lower
   * = the perimeter yields more under load, so the ball flattens-and-widens
   * (thick slime) instead of carrying the load like a rigid hoop; the
   * pressure pass preserves the area. Sweep (2.10.1): 0.85 → 0.62 —
   * sustained-load compression 0.82 → 0.76 rest area, lateral bulge (aspect)
   * 1.44 → 1.65, with impact still bounded (~0.98) and piles fully stable.
   * 0.55 went further but left ~6px standing overlap in the wedge test —
   * 0.62 is the softest value that keeps the separation backstop ahead.
   * Phase 2.11.2 sweep (enabled by the war-surrender counter fix, which
   * decouples pile stillness from ring stiffness): 0.62 → 0.5 — measured
   * impact compression 3.5% → ~12%, sustained-load flattening 0.7% → ~9%
   * (targets §6); settled piles still sleep (standing wars now surrender
   * and the drift gate still vetoes real motion). Stability re-verified
   * by the full unit battery + QA scenarios. */
  rimStiffness: 0.5,
  /** Spoke (particle-to-center) stiffness. 0.18: yields for visible
   * flattening under load; the center-escape retention pass (Phase 2.9.2)
   * handles the fold-through failure mode that stiffer spokes were
   * attempting to brute-force. Phase 2.11.2: kept at 0.18 — 0.15 left a
   * settled-jam particle churning just above the 2px/step stillness bar;
   * the impact softness comes from the rim + braces instead. */
  spokeStiffness: 0.18,
  /** Rim/spoke damping — SLIME CONTROL (spec §4): constraint damping kills
   * ring oscillation. Sweep (2.10.1): 0.16 → 0.21 — impacts produce a few
   * visibly damped wobbles then settle (spec: "subtle, damped wobble
   * immediately after an impact, then settle completely"). Phase 2.11.2:
   * 0.21 → 0.26 — smoother, slower recovery (no snap-back), still settling. */
  damping: 0.26,
  /** Diameter-brace stiffness — SLIME CONTROL (spec §4): holds the ring's
   * overall size through hard impacts (1-frame point-collapse otherwise).
   * Sweep (2.10.1): 0.85 → 0.58 alongside the rim softening; 0.5 (with rim
   * 0.55) allowed the wedge-trap overlap to grow — 0.58 keeps the anti-fold
   * floor ahead of the load. Phase 2.11.2: 0.58 → 0.4 alongside the rim
   * 0.5 sweep — the diameter braces resist the VERTICAL crown load directly
   * (a static stack compresses along the brace axis), so they were the last
   * sustained-load rigidity source; 0.4 still holds the ring's size through
   * impacts (diameter braces + pressure + contact skin do that work). */
  diameterStiffness: 0.4,
  /** Area-restoration drive (px/step at FULL deficit). Measured pile physics:
   * bottom-layer balls under a sustained multi-ball load were equilibrating
   * at 0.3-0.5× rest area with the old ceiling (deficit capped at 0.5, accel
   * 4-6) — the gas was PEGGED and still losing. A real gas keeps rising as
   * it compresses; the cap is raised to 0.75 (drive 4 px/step at the 120Hz rate)
   * so a ball under a several-times-its-mass load holds ≥0.7 area. Stability is not
   * from the ceiling but from the derivative brake (pressureDamping), which
   * prevents the overshoot that the old unbraced controller exhibited. */
  pressureAcceleration: 6,
  /** Phase 2.9.9 STANDING-DRIVE CAP (× gravity). The gas drive is a per-particle
   * Δv applied EVERY substep; at a settled pile's typical deficit (~0.3) the
   * old drive was 1.8 px/step² ≈ 16× gravity (gravity at 120Hz ≈ 0.111
   * px/step²). Measured consequence: the standing drive re-created contact
   * overlap faster than Matter + the separation backstop could consume it —
   * the backstop ran pegged at its cap every substep, every ball churned at
   * 0.05-0.18 px/step centroid velocity (drift > restDrift over the rest
   * window → piles never slept), and constraint error stood at 2-9px.
   * Area restoration under sustained load is carried by the POSITIONAL
   * expandShape pass (equilibrium-safe); the velocity gas only needs enough
   * standing authority to hold shape against gravity-scale loads, with
   * transient unfolding handled by the anti-floor passes. Cap = 4× gravity.
   * Phase 2.11.2: KEPT at 4× gravity — the sustained-load flattening comes
   * from the softer rim/spokes/braces (the ring yields instead of carrying
   * load); lowering the cap to 2.5-3 left a standing area deficit whose gas
   * drive churned settled piles at the 8px/step travel cap (never at rest). */
  pressureGravityCap: 4,
  /** Deficit fraction at which the gas drive saturates. */
  pressureDeficitCap: 0.75,
  // --- positional area restoration (expandShape) ---
  /** Max per-particle radial expansion per substep (px). Position-level:
   * Matter's contact solver squeezes rings at the POSITION level, which a
   * velocity-level gas cannot counter (its Δv is cancelled by the contact
   * velocity solve every step) — measured bottom-layer equilibrium 0.3-0.5×
   * rest area in dense piles. The positional counterpart restores area
   * directly, neighbor-aware (never pushes a particle into another ball's
   * collision disc) and radius-capped (never inflates past rest). */
  expandMaxMove: 0.5,
  /** Radial move per substep = ringRadius × deficit × this. Phase 2.11.2:
   * KEPT at 0.5 — weakening it (0.15-0.4) did NOT deepen the deformation
   * equilibrium (the ring's Matter contacts, not the positional restore,
   * carry load) but DID let settled-pile overlap exceed the 2.5px bound.
   * Visible recovery comes from the softer rim/spokes/braces. */
  expandRate: 0.5,
  /** Area deficit below which no positional expansion runs (sub-visible). */
  expandMinDeficit: 0.004,
  /** Gas-controller damping coefficient (× √magnitude). The pressure pass is
   * a proportional position controller; without a derivative term it drives a
   * limit cycle (measured: pile-scale "breathing" — area oscillating 0.45 ↔
   * 0.5 on a ~0.7s period, and a standing 1.6-2.5px/step particle-speed
   * flip-flop at rest). The brake subtracts c·√magnitude × the particle's
   * velocity along the desired push direction, which makes the controller
   * behave like a critically damped spring: full static support, no overshoot.
   * Phase 2.11.2: kept at 1.6 — 1.3 (tried for a "smoother recovery") drove
   * a mild limit cycle in loaded piles (a particle churning at the 8px/step
   * travel cap in a settled pile). The visible recovery smoothness comes
   * from the softer rim/spokes + gentler positional restore instead. */
  pressureDamping: 1.6,
  /** Shape retention (anti-collapse) — SLIME CONTROL (spec §4): when a
   * particle's distance from the centroid falls below this fraction of its
   * rest ring radius it gets a small outward Δv (velocity-aware: no push
   * while recoiling). Sweep (2.10.1): 0.58 → 0.55 — lets the sides bulge
   * further out under load (thicker flatten) while the inner radius stays
   * ≥55% of the rest ring (no small ball disappears into a sliver; the
   * 0.52 sweep candidate produced a 2.9 aspect on the wedge-trapped ball). */
  minRadiusFraction: 0.55,
  minRadiusRecovery: 0.8,
  /** Max fraction of rest area the solver may try to correct per step. */
  maxPressureCorrection: 0.35,
  /** Rest area is computed at creation; area below this fraction triggers
   * max pressure (hard floor to prevent total collapse). */
  collapseGuard: 0.45,
  // --- contact backstop (separateContacts) ---
  /** Iterations of the backstop per substep. Each iteration corrects the
   * full remaining deficit toward the clearance target, capped per pair, so
   * corrections converge within a substep instead of leaving standing
   * overlap for the pile load to lock in (measured: a weak relaxed pass
   * equilibrated at 15-22px of standing cross-ball overlap in a settled
   * pile; a converging pass never lets the crumple form at all). */
  separationIterations: 8,
  separationRelaxation: 1,
  /** Max per-pair position correction per iteration (px). Bounded well below
   * the old 15px teleports; an impact transient resolves over a few
   * iterations within the same substep. */
  separationCap: 3,
  /** Corrections smaller than this neither move nor wake anything (prevents
   * sub-pixel churn from keeping a settled pile awake). */
  separationMinMove: 0.05,
  /** Phase 2.10.0 FALL-PROFILE TUNABLE (the measured dominant mechanism):
   * max particle speed in Matter velocity units (px per 16.67ms — Matter's
   * reporting base). MEASURED (free-fall.test.ts): the old hardcoded 7
   * capped every drop after ~0.23s of free fall at a terminal 420px/s —
   * drops felt slow because they were cap-limited, NOT gravity-limited.
   * 8 = +14% terminal fall speed at the old 7; 8 stays the PILE cap —
   * measured: any value > 8 lets separation/pressure solver energy ratchet
   * into permanent mid-pile churn (5-8 px/step for 20s+, stabilization
   * soak fails). The faster DROP lives in freeFallMaxParticleSpeed (applied
   * only to contact-free balls — see clampSoftBallSpeed). Tune here for
   * pile feel; raise only within the tunneling margin. */
  maxParticleSpeed: 8,
  /** FREE-FALL cap for balls with ZERO active contacts (see
   * clampSoftBallSpeed): +12.5% terminal drop speed with no pile-stability
   * cost — the pile always runs at maxParticleSpeed. Same tunneling margin
   * rationale: 9 units = 4.5px/step at 120Hz vs the 14px/step limit. */
  freeFallMaxParticleSpeed: 9,
  // --- whole-ball resting state (Phase 2.9.8) ---
  // --- whole-ball resting state (Phase 2.9.8) ---
  /** Max body speed (px/step) for the rest window to keep counting; anything
   * faster restarts it instantly (free fall, impacts, wall hits). */
  restSpeedFast: 4,
  /** Max NET centroid displacement (px) over the rest window. Separates the
   * standing solver churn (measured: a bounded ±4-5px wander around a fixed
   * point — never monotonic) from slow net motion (slides, compaction slump:
   * measured 30-45px per 5s = 12-18px per 2s window), which must keep the
   * ball awake until the rearrangement actually stops. Phase 2.9.9: 3 → 6
   * after drift instrumentation: the churn's excursion from any anchor
   * reaches ~4-5px within ~1.4s, which reset the old 3px gate forever. */
  restDrift: 6,
  /** Sustained net-stationary substeps (2s at 120Hz) before the whole logical
   * ball sleeps. Phase 2.9.9: 90 → 240. Measured: the settled pile's residual
   * solver churn is an OSCILLATION — the centroid wanders >restDrift within a
   * 0.75s window (resetting the old counter at 89/90 every time) while its
   * NET drift over 2s stays ≤3px. A window must be longer than the churn
   * period to separate churn (bounded, net ~0) from slump (monotonic
   * compaction, measured 30-45px per 5s — still ≫ restDrift over 2s). */
  restSteps: 240,
  /** Phase 2.10.0 WAR SURRENDER: a ball wedged in a dense pile can enter a
   * standing constraint/contact war — Matter's constraint solver re-creates
   * ~2px of contact overlap every substep (its position corrections become
   * velocity on the next Body.update), the separation backstop repairs it,
   * and the particle speeds pin at the travel cap (measured live: two
   * adjacent ring particles at 6-8 px/step, centroid drift ~0, area within
   * 1% of rest, rest window reset 'fast' forever — the pile never fully
   * sleeps). This is solver oscillation, NOT a real disturbance: the gate
   * therefore surrenders after this many CONSECUTIVE fast substeps and lets
   * the drift+area gates alone decide rest (net motion and real impacts —
   * which move the centroid or deform the ball — still reset the window).
   * 8s of *continuous* cap-level speed cannot occur in real play (the whole
   * spawn→floor fall is ~180 substeps; every impact/rebound deforms area and
   * moves the centroid), so the amnesty is unreachable outside such wars.
   * Phase 2.10.2: lowered 960 → 600 (5s still excludes every real
   * disturbance; wedged wall-contact wars now sleep in ~7s instead of ~10s)
   * and the area guard widened by restWarSurrenderAreaTolerance below — the
   * old 3% band left COMPRESSED wedges (wall + heavy neighbor, area deficit
   * 4-10%) vibrating at the cap FOREVER: never surrendering, never sleeping
   * (the wall-jitter defect). The drift gate (net centroid motion) remains
   * fully in force, so a ball genuinely sliding or rearranging still cannot
   * sleep. Phase 2.11.2: 600 → 300 — with the softer slime ring the jam
   * threshold (a floor-wedged ball under pile load) formed ~700 substeps
   * into the settle soak and the war counter never reached 600 before the
   * soak ended; measured impact/rebound fast phases are < 120 substeps and
   * real disturbances still trip the drift/area gates, so 300 (2.5s) keeps
   * a wide margin over every genuine transient. */
  restWarSurrenderSteps: 300,
  /** Max area deficit (fraction of rest area) a standing war may carry and
   * still surrender (Phase 2.10.2: 0.03 → 0.12 — compressed wall wedges
   * must also reach rest; real impacts deform area FAR beyond 12% within
   * the 5s window and keep it there only while the disturbance lasts). */
  restWarSurrenderAreaTolerance: 0.12,
  // --- container clamp ---
  // The clamp is an anti-tunneling backstop that only fires when a particle
  // CENTER crosses an inner surface line (see SoftBallManager.clampToContainer);
  // no clearance constant is needed.
} as const

export interface SoftBall {
  composite: Matter.Composite
  center: Matter.Body
  particles: Matter.Body[]
  /** Rest polygon area at creation (unsquished). */
  restArea: number
  /** Current polygon area of the particle ring. */
  area: number
  /** Nominal radius (visual + rest-area equivalent). */
  radius: number
  /** Deterministic per-ball seed for the hand-drawn contour (Phase 2.9.6). */
  seed: number
}

/** Current particle ring area of a soft ball. */
export function softBallArea(ball: SoftBall): number {
  // Zero-allocation shoelace — iterates the particle array directly
  // instead of mapping positions into a temporary array per call.
  const pts = ball.particles
  const n = pts.length
  let a = 0
  for (let i = 0; i < n; i++) {
    const p = pts[i]!.position
    const q = pts[(i + 1) % n]!.position
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

/**
 * Area-preservation pass — call once per physics step AFTER Engine.update.
 * If the ring is compressed, push particles outward along their radial
 * normals with a pressure ∝ area deficit. This is the minimal custom solver
 * native Matter needs to behave like a pressurized slime ball.
 */
/** Zero-allocation speed clamp for one body (see clampSoftBallSpeed). */
function clampBodySpeed(body: Matter.Body, cap: number): void {
  const v = body.velocity
  const speed = Math.hypot(v.x, v.y)
  if (speed > cap) {
    const k = cap / speed
    Matter.Body.setVelocity(body, { x: v.x * k, y: v.y * k })
  }
}

/** Clamp particle speeds (anti-tunneling). Call once per physics step.
 * Uses SOFT.maxParticleSpeed (config) — see its measured rationale.
 * `inContact` (the ball has active contacts) lowers the cap to
 * maxParticleSpeed: in a pile, separation/pressure inject solver energy
 * that a higher cap lets ratchet into permanent churn (measured: any cap
 * > 8 leaves mid-pile balls cycling at 5-8 px/step for 20s+). Balls in
 * FREE FALL have no contacts — nothing injects energy — so they use
 * freeFallMaxParticleSpeed for a faster drop with the same safety margin
 * (9 units = 4.5px/step vs the 14px/step tunneling limit). */
export function clampSoftBallSpeed(ball: SoftBall, inContact = true): void {
  const cap = inContact ? SOFT.maxParticleSpeed : SOFT.freeFallMaxParticleSpeed
  // Zero-allocation: clamp the center, then each particle directly (no
  // temporary array).
  clampBodySpeed(ball.center, cap)
  const pts = ball.particles
  for (let i = 0; i < pts.length; i++) {
    clampBodySpeed(pts[i]!, cap)
  }
}

export function applyPressure(ball: SoftBall): void {
  ball.area = softBallArea(ball)
  // SIGNED deficit: positive = compressed (restore outward), negative =
  // inflated (restore inward). The Phase 2.9 one-sided version never restored
  // inflated balls, letting collisions inflate them up to 4.3× rest area.
  const signed = (ball.restArea - ball.area) / ball.restArea
  if (Math.abs(signed) < 0.005) return
  // Full-deficit Δv ≈ 4× gravity acceleration — enough to hold the ball up
  // under a several-times-its-mass load and unfold it, while the linear
  // small-deficit response stays well below gravity (no jitter).
  const magnitude = Math.min(Math.abs(signed), SOFT.pressureDeficitCap) * SOFT.pressureAcceleration
  // Phase 2.9.9 STANDING-DRIVE CAP: this magnitude is a per-particle Δv
  // injected EVERY substep. Uncapped it reached ~16× gravity at typical pile
  // deficits (measured), which perpetually re-created the contact overlaps
  // the rest of the solver was consuming — the separation backstop ran pegged
  // at its cap, every ball churned at 0.05-0.18 px/step centroid velocity
  // (drift > restDrift across the rest window → piles never slept), and
  // standing constraint error was 2-9px. Sustained area restoration under
  // load is carried by the POSITIONAL expandShape pass (equilibrium-safe);
  // the velocity gas only needs gravity-scale standing authority.
  const gravityPerStep = PHYSICS.gravity.y * PHYSICS.gravity.scale * PHYSICS.stepMs * PHYSICS.stepMs
  const magnitudeCapped = Math.min(magnitude, SOFT.pressureGravityCap * gravityPerStep)

  // 2D gas pressure at VELOCITY level, applied RADIALLY (particle → centroid
  // direction). Bounded by construction — the per-step Δv can never exceed
  // `pressureAcceleration` — so the solver is energy-stable and cannot launch
  // the ball.
  //
  // DERIVATIVE ACTION (critically damped controller): the drive is reduced by
  // `pressureDamping·√magnitude` × the particle's velocity along the desired
  // push direction, clamped so the brake never reverses harder than the
  // drive. A proportional-only controller drives a limit cycle (measured:
  // pile-scale breathing, area 0.45↔0.5 on a ~0.7s period); with the brake
  // the gas reaches static equilibrium like a real damped spring: full
  // support under load, no overshoot, no standing oscillation.
  const n = ball.particles.length
  const centroid = ball.center.position
  const sgn = Math.sign(signed)
  const brakeCoef = SOFT.pressureDamping * Math.sqrt(magnitudeCapped)
  for (let i = 0; i < n; i++) {
    const p = ball.particles[i]!
    const rx = p.position.x - centroid.x
    const ry = p.position.y - centroid.y
    const rl = Math.hypot(rx, ry) || 1
    const dxn = (rx / rl) * sgn
    const dyn = (ry / rl) * sgn
    const vAlong = p.velocity.x * dxn + p.velocity.y * dyn
    const net = Math.max(-magnitudeCapped, Math.min(magnitudeCapped, magnitudeCapped - brakeCoef * vAlong))
    Matter.Body.setVelocity(p, {
      x: p.velocity.x + dxn * net,
      y: p.velocity.y + dyn * net,
    })
  }

  // Phase 2.9.2 SHAPE RETENTION (revised after tracing the collapse): the
  // ring folds into a wedge AND the center body pops out through the ring
  // (measured 21px separation), after which nothing holds the shape. Two
  // safeguards, both gradual velocity-level corrections:
  //  1. particles below minRadiusFraction of the rest ring radius (measured
  //     from the PARTICLE centroid — the center body may be outside the ring)
  //     get an outward Δv;
  //  2. if the center body has escaped the mean ring radius, it is pulled
  //     back toward the particle centroid (bounded, gradual).
  let pcx = 0
  let pcy = 0
  for (const p of ball.particles) {
    pcx += p.position.x
    pcy += p.position.y
  }
  pcx /= ball.particles.length
  pcy /= ball.particles.length
  const ringR = ball.radius * (1 - SOFT.particleRadiusFactor)
  const minR = ringR * SOFT.minRadiusFraction
  for (const p of ball.particles) {
    const dx = p.position.x - pcx
    const dy = p.position.y - pcy
    const len = Math.hypot(dx, dy) || 1
    const depth = minR - len
    if (depth > 0) {
      const k = Math.min(1, depth / (ringR * 0.3))
      const recover = k * SOFT.minRadiusRecovery
      // velocity-aware: no extra push when already recoiling outward
      const vOut = (p.velocity.x * dx + p.velocity.y * dy) / len
      const eff = recover * Math.max(0, 1 - vOut / recover)
      if (eff > 0) {
        Matter.Body.setVelocity(p, {
          x: p.velocity.x + (dx / len) * eff,
          y: p.velocity.y + (dy / len) * eff,
        })
      }
    }
  }
  // Center-body retention
  const cdx = pcx - ball.center.position.x
  const cdy = pcy - ball.center.position.y
  const cd = Math.hypot(cdx, cdy) || 1
  const escape = cd - ringR * 0.55
  if (escape > 0) {
    const k = Math.min(1, escape / (ringR * 0.4))
    const pull = k * SOFT.minRadiusRecovery
    Matter.Body.setVelocity(ball.center, {
      x: ball.center.velocity.x + (cdx / cd) * pull,
      y: ball.center.velocity.y + (cdy / cd) * pull,
    })
  }
}

/**
 * Create a soft-body ball at (x, y) with nominal radius `radius`.
 * Collision filter: particles of one ball never collide with each other or
 * their center (group −id), but collide normally with everything else.
 */
export function createSoftBall(
  x: number,
  y: number,
  radius: number,
  id: number,
  segments: number = SOFT.segments,
): SoftBall {
  const group = Matter.Body.nextGroup(true) // negative group: never self-collide
  const filter = { group }
  // Particle bodies carry the CONTACT SKIN in their collision radius: Matter's
  // own contact solver natively holds the inter-ball clearance (2·skin between
  // surfaces) with proper impulse physics. The ring geometry (constraints,
  // rendered contour) stays on the visual radius — the skin only thickens the
  // collision discs. (Same-group particles never collide with each other, so
  // the thicker discs cannot interfere with the ring's own structure.)
  const pr = radius * SOFT.particleRadiusFactor
  const bodyR = pr + SOFT.contactSkin
  const ringR = radius - pr

  // Phase 2.9.9 MASS NORMALIZATION: total composite mass ∝ R² (2D area) with
  // tier 6 as the reference. The fixed contact skin makes small particles
  // disproportionately heavy per unit area (measured: mass/area 1.99e-3 on
  // tier 1 vs 1.64e-3 on tier 6 — small balls ~21% over-weight), so the
  // particle density is derived per radius. The center keeps 1/3 of the
  // particle density (center share ≈ 2% of ball mass at every tier).
  const refBodyR = SOFT.densityRefRadius * SOFT.particleRadiusFactor + SOFT.contactSkin
  const density =
    (SOFT.particleDensity * (refBodyR * refBodyR) * (radius * radius)) /
    ((bodyR * bodyR) * SOFT.densityRefRadius * SOFT.densityRefRadius)

  const center = Matter.Bodies.circle(x, y, bodyR, {
    collisionFilter: filter,
    friction: 0.08,
    frictionStatic: 0.4,
    frictionAir: 0.012,
    restitution: 0.05,
    // Light center (Phase 2.9.6): the center's structural role is shape
    // memory via spokes; its weight (0.0012) pressed the ring flat whenever
    // the settle pass zeroed its velocity at rest (area settled 0.67-0.79).
    density: density / 3,
    // Whole-ball resting state: auto-sleep is disabled per-body; the manager
    // sleeps the ENTIRE logical ball coherently (SoftBallManager.stepAll) so
    // a ball can never freeze half-deformed.
    sleepThreshold: Infinity,
    label: `soft-${id}-center`,
  })

  const particles: Matter.Body[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    particles.push(
      Matter.Bodies.circle(x + Math.cos(a) * ringR, y + Math.sin(a) * ringR, bodyR, {
        collisionFilter: filter,
        friction: 0.08,
        frictionStatic: 0.4,
        frictionAir: 0.012,
        restitution: 0.05,
        density,
        sleepThreshold: Infinity,
        label: `soft-${id}-particle`,
      })
    )
  }

  const composite = Matter.Composite.create({ label: `soft-ball-${id}` })
  Matter.Composite.add(composite, [center, ...particles])

  // Rim constraints (adjacent ring particles) — hold the perimeter
  const rimLen = 2 * ringR * Math.sin(Math.PI / segments)
  for (let i = 0; i < segments; i++) {
    Matter.Composite.add(
      composite,
      Matter.Constraint.create({
        bodyA: particles[i]!,
        bodyB: particles[(i + 1) % segments]!,
        length: rimLen,
        stiffness: SOFT.rimStiffness,
        damping: SOFT.damping,
      }),
    )
  }
  // Spokes (particles ↔ center) — shape memory, resists folding
  for (const p of particles) {
    Matter.Composite.add(
      composite,
      Matter.Constraint.create({
        bodyA: center,
        bodyB: p,
        length: ringR,
        stiffness: SOFT.spokeStiffness,
        damping: SOFT.damping,
      }),
    )
  }
  // Second-ring braces (skip-one neighbors) — prevents local folding without
  // making the ball rigid; classic soft-body bracing.
  // Chord spanning TWO segments: central angle = 2·(2π/N), length = 2R·sin(angle/2).
  const braceLen = 2 * ringR * Math.sin(((2 * Math.PI) / segments) * 2 / 2)
  for (let i = 0; i < segments; i++) {
    Matter.Composite.add(
      composite,
      Matter.Constraint.create({
        bodyA: particles[i]!,
        bodyB: particles[(i + 2) % segments]!,
        length: braceLen,
        stiffness: SOFT.spokeStiffness * 0.5,
        damping: SOFT.damping,
      }),
    )
  }
  // Phase 2.9.2: DIAMETER braces (opposite pairs, high stiffness). Measured
  // at floor impact: the whole ring collapsed to a ~1px point for ~20 frames
  // (minR 0.1, area→0) because no constraint resisted uniform compression.
  // A stiff diameter network holds the ring's overall size through impacts
  // while spokes/rim still allow local squish. Even segment count required.
  if (segments % 2 === 0) {
    const diameterLen = 2 * ringR
    for (let i = 0; i < segments / 2; i++) {
      Matter.Composite.add(
        composite,
        Matter.Constraint.create({
          bodyA: particles[i]!,
          bodyB: particles[i + segments / 2]!,
          length: diameterLen,
          stiffness: SOFT.diameterStiffness,
          damping: SOFT.damping,
        }),
      )
    }
  }

  const ball: SoftBall = {
    composite,
    center,
    particles,
    restArea: 0,
    area: 0,
    radius,
    seed: Math.random() * Math.PI * 2,
  }
  ball.restArea = softBallArea(ball)
  ball.area = ball.restArea
  return ball
}

/** Add a soft ball into a physics world's composite root. */
export function addToWorld(world: Matter.World, ball: SoftBall): void {
  Matter.Composite.add(world, ball.composite)
}

/** Remove a soft ball from the world and clear its constraints. */
export function removeFromWorld(world: Matter.World, ball: SoftBall): void {
  Matter.Composite.remove(world, ball.composite, true)
}

/** Aggregate velocity (average particle speed) — for settle checks. */
export function softBallSpeed(ball: SoftBall): number {
  let sum = 0
  for (const p of [...ball.particles, ball.center]) {
    sum += Math.hypot(p.velocity.x, p.velocity.y)
  }
  return sum / (ball.particles.length + 1)
}

/** Max speed across every body of the logical ball — rest detection. */
export function softBallMaxSpeed(ball: SoftBall): number {
  let max = Math.hypot(ball.center.velocity.x, ball.center.velocity.y)
  for (const p of ball.particles) {
    const s = Math.hypot(p.velocity.x, p.velocity.y)
    if (s > max) max = s
  }
  return max
}

/** True when every body of the logical ball is sleeping (coherent rest). */
export function softBallSleeping(ball: SoftBall): boolean {
  return ball.center.isSleeping && ball.particles.every((p) => p.isSleeping)
}

/** Centroid of the particles (+center). */
export function softBallCentroid(ball: SoftBall, out?: Matter.Vector): Matter.Vector {
  // Zero-allocation: iterates particles + center directly (the old version
  // spread them into a temporary array per call). `out` reuses the caller's
  // vector when provided.
  let x = ball.center.position.x
  let y = ball.center.position.y
  const pts = ball.particles
  for (let i = 0; i < pts.length; i++) {
    x += pts[i]!.position.x
    y += pts[i]!.position.y
  }
  const inv = 1 / (pts.length + 1)
  if (out) {
    out.x = x * inv
    out.y = y * inv
    return out
  }
  return { x: x * inv, y: y * inv }
}

// ---------------------------------------------------------------------------
// Smooth rendering contour (Phase 2.8)
// ---------------------------------------------------------------------------

/** Catmull–Rom segment p1→p2 (controls p0, p3) at t ∈ [0,1].
 * Standard CR tangents with a chord-length clamp that guarantees the curve
 * stays within the neighborhood of its control points (no overshoot loops,
 * no self-intersections even when the ring is strongly compressed). */
function catmullRomPoint(
  p0: Matter.Vector,
  p1: Matter.Vector,
  p2: Matter.Vector,
  p3: Matter.Vector,
  t: number,
): Matter.Vector {
  const t2 = t * t
  const t3 = t2 * t
  // Tangents (CR): m1 = (p2−p0)/2, m2 = (p3−p1)/2
  let m1x = (p2.x - p0.x) / 2
  let m1y = (p2.y - p0.y) / 2
  let m2x = (p3.x - p1.x) / 2
  let m2y = (p3.y - p1.y) / 2
  // Overshoot guard: clamp each tangent's length to its own chord. At rest
  // the natural CR tangent (p2−p0)/2 is already ≈1× the chord on a circular
  // ring, so the clamp is inert at rest — it only engages under strong
  // deformation, where it keeps the curve inside the convex hull of its
  // control points and therefore inside the COLLISION envelope (the union of
  // the particle discs). Without this, the rendered contour could bulge up
  // to ~4px past the physics surface under load.
  const clampTangent = (mx: number, my: number, ax: Matter.Vector, bx: Matter.Vector) => {
    const ml = Math.hypot(mx, my)
    const cl = Math.hypot(bx.x - ax.x, bx.y - ax.y) || 1
    if (ml > cl) {
      const k = cl / ml
      return { x: mx * k, y: my * k }
    }
    return { x: mx, y: my }
  }
  const tm1 = clampTangent(m1x, m1y, p1, p2)
  const tm2 = clampTangent(m2x, m2y, p1, p2)
  m1x = tm1.x
  m1y = tm1.y
  m2x = tm2.x
  m2y = tm2.y
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return {
    x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
    y: h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
  }
}

/**
 * Smooth closed contour through the particle ring: centripetal Catmull–Rom
 * evaluated at `samplesPerSegment` points per ring segment, then offset
 * OUTWARD by `outset` px along local edge normals so the rendered surface
 * wraps the outer edge of the particle bodies (not their centerline).
 * Fill and outline use the SAME polygon — no fill/outline mismatch.
 */
export function renderContour(
  ball: SoftBall,
  samplesPerSegment = 6,
  outset: number,
): Matter.Vector[] {
  const pts = ball.particles.map((p) => p.position)
  const n = pts.length
  const raw: Matter.Vector[] = []
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!
    const p1 = pts[i]!
    const p2 = pts[(i + 1) % n]!
    const p3 = pts[(i + 2) % n]!
    for (let j = 0; j < samplesPerSegment; j++) {
      raw.push(catmullRomPoint(p0, p1, p2, p3, j / samplesPerSegment))
    }
  }
  // Offset outward along edge normals (dense sampling → smooth offset)
  const m = raw.length
  const out: Matter.Vector[] = []
  const cx = ball.center.position.x
  const cy = ball.center.position.y
  // Phase 2.9.7 hand-drawn contour: 2 low-frequency harmonics for a subtle,
  // organic asymmetry (Ball Guys style). Deterministic per-ball seed, stable
  // over time, rides the simulated deformation. Third harmonic removed
  // (it caused high-frequency bumps that read as polygon noise).
  //
  // Phase 2.9.8 ENVELOPE SAFETY: the offset is applied as an INWARD dip from
  // the particle outer edge, never outward — `outset` is the maximum. The
  // rendered fill/outline therefore can never extend past the collision
  // envelope (the particle discs), which is what makes "Matter owns contact
  // separation" sound: a ball's visible surface can never cut into a
  // neighbor's, no matter what the wave does.
  const h1 = Math.sin(ball.seed) * 0.008 + 0.007
  const h2 = Math.sin(ball.seed * 1.7 + 2.1) * 0.006
  // Per-ball harmonic ceiling (largest |wave| this seed can produce).
  const waveCap = Math.abs(h1) + Math.abs(h2)
  // Dip amplitude: ~0.7% of radius at the wave trough (≤ ~0.9px on tier 6),
  // so two largest-tier balls at the backstop's 4px clearance still stay
  // within the 7px ink stroke's coverage (4 + 2·0.9 < 7).
  const dipAmp = 0.007
  for (let i = 0; i < m; i++) {
    const prev = raw[(i - 1 + m) % m]!
    const cur = raw[i]!
    const next = raw[(i + 1) % m]!
    // Average edge normal around this sample (miter-free, stable)
    const e1x = cur.x - prev.x
    const e1y = cur.y - prev.y
    const e2x = next.x - cur.x
    const e2y = next.y - cur.y
    let nx = e1y + e2y
    let ny = -(e1x + e2x)
    const nl = Math.hypot(nx, ny) || 1
    nx /= nl
    ny /= nl
    // Ensure the normal points AWAY from the centroid
    const mx = cur.x - cx
    const my = cur.y - cy
    if (mx * nx + my * ny < 0) {
      nx = -nx
      ny = -ny
    }
    // Angular position of this sample around the centroid
    const ang = Math.atan2(cur.y - cy, cur.x - cx)
    const wave =
      Math.sin(ang * 3 + ball.seed) * h1 +
      Math.sin(ang * 5 + ball.seed * 2.2) * h2
    // wave/waveCap ∈ [−1, 1] → dip ∈ [0, 2·dipAmp·r] → offset ∈ [outset − 2·dipAmp·r, outset]
    const dip = (1 - wave / waveCap) * dipAmp * ball.radius
    // Phase 2.11.2 ENVELOPE SAFETY MARGIN: the catmull-rom through the
    // particle centers overshoots the local ring between particles under
    // deformation (overshoot grows with particle spacing ∝ radius), which
    // pushed the widest contour ~0.13px past the collision discs at the new
    // r 52. A small radius-proportional inward margin (≤1px at tier 10,
    // sub-pixel/invisible at every playable tier) restores the invariant
    // `contour ≤ particle collision discs` for ALL radii.
    const envelopeSafety = 0.2 + 0.006 * ball.radius
    out.push({ x: cur.x + nx * (outset - dip - envelopeSafety), y: cur.y + ny * (outset - dip - envelopeSafety) })
  }
  return out
}
