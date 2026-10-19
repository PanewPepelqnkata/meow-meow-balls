/**
 * Phase 2.11.0 — CENTRAL RESPONSIVE LAYOUT (spec §2, §5, §6).
 *
 * The ONLY place that computes UI positions, sizes, anchors and the world
 * camera framing. Every UI component reads its geometry from the
 * `UiLayout` produced by `resolveLayout(vw, vh, safe)`; nothing else in the
 * codebase may call window.innerWidth or scatter breakpoint checks.
 *
 * Composition rules
 * -----------------
 * DESKTOP / landscape (any landscape viewport):
 *   purpose-built landscape composition from the 1648×936 reference —
 *   Best/Global top-left, Score top-center, Next Ball upper-left of the
 *   gameplay, circular tier progression on the left,
 *   ability row lower-right. The 720×1280 gameplay stage is framed by the
 *   world camera on its RELEVANT BAND (spawn sky y≈170 → below the floor
 *   y≈1125) so the container stays the visual focal point, centered.
 *
 * PHONE / portrait (phone-first, Phase 2.17):
 *   a dedicated portrait composition — NOT a scaled-down desktop. Designed
 *   at 320–430 px widths (breakpoint classes: compact ≤360, phone 361–430,
 *   large portrait >430 up to tablets):
 *
 *     Score (hero, centered)
 *     Best + Global (top-left row)
 *     Next Ball preview (left, label beside the disc)
 *     ↓ large clean spawn sky (floating ball, no claw hook)
 *     centered U-container (outer ≈ 78% of viewport width)
 *     tier progression row (compact)
 *     ability bar (44–56 px touch targets, centered, above safe area)
 *
 *   The world camera frames the FULL relevant gameplay region — the
 *   floating spawn ball of the worst spawnable tier at the top through the
 *   floor visual band at the bottom — and pins the floor just above the
 *   tier row. Extra vertical space becomes clean spawn sky between the HUD
 *   and the floating ball, so there is never a giant dead zone and never a
 *   cropped wall/floor.
 *
 * Safe-area insets (from CSS env()) are added as margins so notches/home
 * bars never clip the UI.
 */

import { CONTAINER, wallTopYAt } from '../config/container'

export type LayoutMode = 'mobile' | 'tablet' | 'desktop'
export type Composition = 'portrait' | 'landscape'

export interface Pt {
  x: number
  y: number
}

export interface SafeArea {
  top: number
  right: number
  bottom: number
  left: number
}

export interface UiLayout {
  mode: LayoutMode
  composition: Composition
  vw: number
  vh: number
  /** Global font scale (multiplies Typography design px). */
  fontScale: number
  /** World camera framing: stage-space center + zoom. */
  world: { zoom: number; centerX: number; centerY: number }
  /** Background grid (viewport px). */
  grid: { cell: number; line: number }
  /** Top-left best / global. */
  best: Pt
  global: Pt
  /** Top-center score. `scoreSize` is the design-px font size. */
  score: Pt
  scoreSize: number
  /** Secondary HUD text sizes (design px) — Best and Global. */
  bestSize: number
  globalSize: number
  /** Next-ball preview (ball center + label anchor, diameter in px).
   * `labelAlign`: 'center' = label below the disc (desktop), 'left' = label
   * beside the disc (portrait, keeps the block compact). */
  nextBall: { pos: Pt; label: Pt; diameter: number; labelAlign: 'left' | 'center' }
  /** Tier progression: full circle ring (desktop, left side — Phase 2.16.2,
   * like the reference image) or a bottom row (portrait). */
  tiers: {
    nodeR: number
    kind: 'ring' | 'row'
    cx?: number
    cy?: number
    r?: number
    rowY?: number
    rowX0?: number
    rowX1?: number
  }
  /** Ability bar: horizontal row; `centerX` centers the row (portrait). */
  abilities: { size: number; gap: number; startX: number; startY: number; centerX: boolean }
  /** Portrait stack metrics in real viewport px: bottom edge of the top HUD
   * block and the top edge of the ability buttons. The world camera keeps
   * the whole gameplay region between them (never a dead zone, never a
   * cropped container). */
  stack: { hudBottom: number; controlsTop: number }
}

/** Stage geometry (stage px). STAGE_W mirrors config/stage.ts; the
 * container values are read LIVE from config/container.ts (GameRoot picks
 * the phone funnel for portrait phones before any layout runs). */
const STAGE_W = 720
/** Container BLOCK width incl. the striped side walls at the TOP (widest
 * point): interior top 495.9 + 2×74.6 band run ≈ 645 stage px (Phase 2.11.2
 * geometry, height 320, visual band thickness 74). */
const CONTAINER_OUTER_W = 645
/** Floor bottom edge (floor top 1085 + collider frame thickness 22) in
 * stage px — the PHYSICS floor. */
const FLOOR_BOTTOM = 1107
/** Floor TOP edge (interior floor line) in stage px. */
const FLOOR_TOP_STAGE = 1085
/**
 * Highest point the claw assembly can reach, stage px: the largest
 * spawnable ball (tier 3, r 62) hangs at spawnY = 425 − 62 − 50 = 313, its
 * top at 251, with the SIMPLIFIED claw head reaching ~21px above → 230.
 * Phase 2.11.1: the claw illustration was tightened exactly so the
 * score (top-center) and the claw never overlap (spec §4D).
 */
const CLAW_TOP_WORST = 230
/**
 * Portrait gameplay region (stage px) — everything that MUST be on screen
 * at once on a phone:
 *  - top: the floating spawn ball of the WORST spawnable tier (tier 4,
 *    r 76): spawnY = 425 − 76 − 50 = 299, top at 223, +8 px margin → 215.
 *    (Mobile has no claw hook — see DropClaw.setMobile.)
 *  - bottom: floor visual band bottom (1085 + 42 decor band + ink) → 1135.
 */
const REGION_TOP_STAGE = 215
const REGION_BOT_STAGE = 1135
/** Score text design values — MUST match ScoreDisplay (see its comment). */
const SCORE_DESIGN_SIZE = 36
const SCORE_DESIGN_Y = 48
/** Lilita One line-height factor used to estimate the rendered text box. */
const SCORE_LINE = 1.25
/** Reference desktop viewport (the supplied landscape design). */
const REF_W = 1648
const REF_H = 936

/** Stage-space geometry the framing formulas depend on (exported for tests
 * and for the claw/score separation regression). */
export const WORLD_GEOM = {
  BAND_TOP: 170,
  BAND_BOTTOM: 1125,
  BAND_CENTER: (170 + 1125) / 2,
  FLOOR_BOTTOM,
  CLAW_TOP_WORST,
  CONTAINER_OUTER_W,
  REGION_TOP_STAGE,
  REGION_BOT_STAGE,
  SCORE_DESIGN_SIZE,
  SCORE_DESIGN_SIZE_PORTRAIT: 26,
  SCORE_DESIGN_Y,
  SCORE_LINE,
} as const

export function resolveLayout(vw: number, vh: number, safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 }): UiLayout {
  // CONTRACT: vw/vh and `safe` are CSS px. Every scene camera zooms by the
  // display scale and frames the CSS-px region, so callers MUST divide the
  // canvas buffer size (scale.width/height) by `game.scale.displayScale.x`
  // before calling — see UiRoot.layout() and PlaygroundScene.applyWorldCamera().
  const mode: LayoutMode = vw < 600 ? 'mobile' : vw <= 1100 ? 'tablet' : 'desktop'
  const composition: Composition = vh > vw ? 'portrait' : 'landscape'
  const portrait = composition === 'portrait'

  // ---- PHONE-FIRST PORTRAIT COMPOSITION -----------------------------------
  // PHASE 2.19 — RESPONSIVE REFLOW, not uniform scaling. The blocks below
  // are authored in REAL viewport px with per-class sizes; the gameplay
  // slot flexes to absorb what remains. The container proportions come from
  // the live CONTAINER config (GameRoot picked the phone funnel at boot —
  // a taller, narrower funnel than desktop), so the zoom that fits it reads
  // as a designed phone object instead of a squeezed desktop one.
  //
  // Class map (viewport width):
  //   ≤359 compact phone  — 48px targets, tighter rows, compact type
  //   360–429 phone       — 54px targets, standard spacing
  //   ≥430 large phone    — 60px targets, more breathing room
  //   ≥600 portrait tablet — 64px targets, widest slot
  if (portrait) {
    const cls = vw <= 359 ? 'compact' : vw <= 429 ? 'phone' : vw <= 599 ? 'large' : 'tablet'
    const R = {
      compact: { font: 1.0, score: 27, best: 20, global: 15, ability: 48, gap: 8, nodeR: 8, nbD: 44, edge: 10 },
      phone: { font: 1.08, score: 30, best: 22, global: 16, ability: 54, gap: 10, nodeR: 9, nbD: 50, edge: 14 },
      large: { font: 1.16, score: 32, best: 23, global: 17, ability: 60, gap: 12, nodeR: 9.5, nbD: 54, edge: 16 },
      tablet: { font: 1.24, score: 34, best: 24, global: 18, ability: 64, gap: 14, nodeR: 10, nbD: 58, edge: 20 },
    }[cls]
    const fontScale = R.font

    // --- top HUD block (real px) ------------------------------------------
    const scoreSize = R.score
    const bestSize = R.best
    const globalSize = R.global
    const scoreY = safe.top + 6
    const row2Y = scoreY + scoreSize * fontScale * 1.3 + 5
    const bestH = bestSize * fontScale * 1.25
    const nbD = R.nbD
    const nbX = R.edge + safe.left + nbD / 2
    const nbY = row2Y + bestH + 8 + nbD / 2
    const hudBottom = nbY + nbD / 2 + 8
    const bestX = R.edge + safe.left

    // --- bottom control block (real px) ------------------------------------
    const abilitySize = R.ability
    const abilityGap = R.gap
    const abilitiesTop = vh - safe.bottom - 8 - abilitySize
    const nodeR = R.nodeR
    const tierRowY = abilitiesTop - 10 - nodeR
    const worldBottom = tierRowY - nodeR - 8

    // --- world camera -------------------------------------------------------
    // The live CONTAINER config (phone funnel on portrait phones): frame the
    // whole gameplay region — floating spawn ball (worst spawnable tier) at
    // top through the floor visual band — into the flexible slot.
    const phoneOuterW = CONTAINER.topWidth + 2 * CONTAINER.visual.bandThickness
    const regionTop = wallTopYAt(CONTAINER.raisedHeight) - 76 - 50 - 8 // worst ball top + margin
    const regionBot = CONTAINER.topY + CONTAINER.height + CONTAINER.visual.bandThickness + 10
    const usableH = Math.max(160, worldBottom - (hudBottom + 6))
    const zRegion = usableH / (regionBot - regionTop)
    // Walls stay inside the viewport with symmetric margins; on compact
    // phones the slot governs, on wide ones the width cap does.
    const zWidth = (0.8 * vw) / phoneOuterW
    const zoom = Math.min(zRegion, zWidth)
    // Pin the floor band bottom just above the tier row; leftover slot
    // height becomes spawn sky between the HUD and the floating ball.
    const centerY = regionBot - (worldBottom - vh / 2) / zoom
    const world = { zoom, centerX: STAGE_W / 2, centerY }

    const grid = { cell: Math.round(26 * fontScale), line: 1.25 }

    return {
      mode,
      composition,
      vw,
      vh,
      fontScale,
      world,
      grid,
      score: { x: vw / 2, y: scoreY },
      scoreSize,
      bestSize,
      globalSize,
      best: { x: bestX, y: row2Y },
      global: { x: bestX + 118 * fontScale, y: row2Y },
      nextBall: {
        pos: { x: nbX, y: nbY },
        label: { x: nbX + nbD / 2 + 10, y: nbY },
        diameter: nbD,
        labelAlign: 'left',
      },
      tiers: {
        nodeR,
        kind: 'row',
        rowY: tierRowY,
        rowX0: R.edge + safe.left,
        rowX1: vw - R.edge - safe.right,
      },
      abilities: {
        size: abilitySize,
        gap: abilityGap,
        startX: 0,
        startY: abilitiesTop + abilitySize / 2,
        centerX: true,
      },
      stack: { hudBottom, controlsTop: abilitiesTop },
    }
  }

  // ---- desktop landscape composition (fractions of the reference) ----------
  const ds = Math.min(vw / REF_W, vh / REF_H) // desktop size scale
  const m = (ref: number): number => Math.max(10, ref * ds)
  const bandH = 1125 - 170
  const zFitW = vw / STAGE_W
  const zFitH = vh / bandH
  const zContainerRef = (0.287 * vw) / CONTAINER_OUTER_W
  // Estimated score box (design size 36 · fontScale, line ≈ 1.25) — matches
  // ScoreDisplay's score text.
  const fontScaleNow = Math.max(0.75, ds)
  const scoreYEst = SCORE_DESIGN_Y * (vh / REF_H) + safe.top
  const scoreBottomEst = scoreYEst + SCORE_DESIGN_SIZE * fontScaleNow * SCORE_LINE
  // Landscape claw guard: with the floor-pinned centerY the claw top renders
  // at 0.905·vh − (FLOOR_TOP − CLAW_TOP_WORST)·z, so the guard is a simple
  // zoom ceiling.
  const zClaw = Math.max(
    0.4,
    (0.905 * vh - scoreBottomEst - 6) / (FLOOR_TOP_STAGE - CLAW_TOP_WORST),
  )
  const zoom = Math.min(zFitW, zFitH, zContainerRef, zClaw)
  // Landscape: pin the floor TOP at 90.5% of the viewport height (reference
  // y≈848 at 936).
  const centerY = FLOOR_TOP_STAGE - (0.405 * vh) / zoom
  const world = { zoom, centerX: STAGE_W / 2, centerY }

  const grid = { cell: Math.round(Math.min(44, Math.max(28, 42 * Math.min(vw / REF_W, vh / REF_H)))), line: 1.75 }

  return {
    mode,
    composition,
    vw,
    vh,
    fontScale: fontScaleNow,
    world,
    grid,
    best: { x: 38 * (vw / REF_W), y: 47 * (vh / REF_H) + safe.top },
    global: { x: 38 * (vw / REF_W), y: 47 * (vh / REF_H) + m(40) + safe.top },
    score: { x: vw / 2, y: scoreYEst },
    scoreSize: SCORE_DESIGN_SIZE,
    bestSize: 30,
    globalSize: 21,
    nextBall: {
      pos: { x: 92 * (vw / REF_W), y: 293 * (vh / REF_H) },
      label: { x: 92 * (vw / REF_W), y: 293 * (vh / REF_H) + m(50) },
      diameter: m(74),
      labelAlign: 'center',
    },
    tiers: {
      // Phase 2.16.2 (user spec): a FULL CIRCLE ring of tier nodes on the
      // free left side, like the reference image — reference-space design
      // (1920×1080): circle centered ≈ (178, 842), r ≈ 135 (fractions
      // 0.093vw / 0.78vh / 0.125vh). Verified clear of the next-ball
      // preview (above), the container (right, outer edge ≈ 0.36vw) and
      // the ability row (lower-right) at every landscape size.
      nodeR: m(18),
      kind: 'ring',
      cx: Math.round(0.093 * vw),
      cy: Math.round(0.78 * vh),
      r: Math.round(0.125 * vh),
    },
    abilities: {
      size: m(106),
      gap: m(24),
      startX: 1107 * (vw / REF_W),
      startY: 835 * (vh / REF_H),
      centerX: false,
    },
    stack: {
      hudBottom: scoreBottomEst,
      controlsTop: 835 * (vh / REF_H) - m(106) / 2,
    },
  }
}

/** Read CSS env() safe-area insets via a probe element (once per resize). */
export function readSafeArea(): SafeArea {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 }
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  }
  probe.remove()
  return out
}
