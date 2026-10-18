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
 * DESKTOP / landscape (>1100px wide, or any landscape viewport):
 *   purpose-built landscape composition from the 1648×936 reference —
 *   Best/Global top-left, Score top-center, Next Ball upper-left of the
 *   gameplay, circular tier progression on the left,
 *   ability row lower-right. The 720×1280 gameplay stage is framed by the
 *   world camera on its RELEVANT BAND (spawn sky y≈170 → below the floor
 *   y≈1125) so the container stays the visual focal point, centered.
 *
 * MOBILE / portrait (<1100px wide, portrait):
 *   purpose-built portrait stack — top strip (Best + Score),
 *   Next Ball preview below it at the left, container dominant center
 *   (65–75% of screen width), tier progression row and ability row at the
 *   bottom above the safe area.
 *
 * All desktop reference positions are stored as fractions of the reference
 * viewport so they scale fluidly to 1280×720 … 1920×1080. Mobile positions
 * are fractions of the viewport with min/max clamps on sizes. Safe-area
 * insets (from CSS env()) are added as margins so notches/home bars never
 * clip the UI.
 */

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
  /** Top-center score. `scoreSize` is the design-px font size (the portrait
   * row is shared with Best/Global, so the score is smaller there). */
  score: Pt
  scoreSize: number
  /** Next-ball preview (ball center + label anchor, diameter in px). */
  nextBall: { pos: Pt; label: Pt; diameter: number }
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
}

/** Gameplay-relevant stage band: spawn sky top → floor + margin. */
const BAND_TOP = 170
const BAND_BOTTOM = 1125
/** Vertical center of the gameplay band (camera default center). */
const BAND_CENTER = (BAND_TOP + BAND_BOTTOM) / 2
const STAGE_W = 720
/** Container interior width in stage px (from config/container geometry). */
const CONTAINER_W = 405
/** Container BLOCK width incl. the striped side walls at the TOP (widest
 * point): interior top 495.9 + 2×74.6 band run ≈ 645 stage px (Phase 2.11.2
 * geometry, height 320, visual band thickness 74). */
const CONTAINER_OUTER_W = 645
/** Floor bottom edge (floor top 1085 + collider frame thickness 22) in
 * stage px — the PHYSICS floor. The fat decorative band (visual 42) may
 * crop a few px on the shortest portrait screens; the claw/score guard has
 * priority, and the band still fits at the reference sizes. */
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
  BAND_TOP,
  BAND_BOTTOM,
  BAND_CENTER,
  FLOOR_BOTTOM,
  CLAW_TOP_WORST,
  CONTAINER_OUTER_W,
  SCORE_DESIGN_SIZE,
  SCORE_DESIGN_SIZE_PORTRAIT: 30,
  SCORE_DESIGN_Y,
  SCORE_LINE,
} as const

export function resolveLayout(vw: number, vh: number, safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 }): UiLayout {
  const mode: LayoutMode = vw < 600 ? 'mobile' : vw <= 1100 ? 'tablet' : 'desktop'
  const composition: Composition = vh > vw ? 'portrait' : 'landscape'
  const portrait = composition === 'portrait'
  // Portrait scale/strip metrics — needed by the framing guard below (the
  // score estimate) and the composition section.
  const ps = Math.max(0.82, Math.min(1.25, Math.min(vw / 390, vh / 844)))
  const topStripY = 10 + safe.top

  // ---- world camera framing -------------------------------------------------
  // Fit the gameplay band; on narrow portrait screens zoom in until the
  // container spans ~70% of the viewport width (spec §6) — the stage margins
  // beside the container are empty sky, so the overflow crops nothing.
  //
  // Phase 2.11.2: the LANDSCAPE framing is derived from the reference
  // geometry (spec §1/§2): the container block (540 stage px wide) renders
  // at ~28% of the viewport width, and the camera is pinned so the floor TOP
  // lands at ~90.5% of the viewport height — at 1648×936 this puts the
  // container outer bounds at x≈590–1050, wall tops y≈576, floor top y≈845,
  // and the crane ball center at (824, ~230) — the reference targets.
  const bandH = BAND_BOTTOM - BAND_TOP
  const zFitW = vw / STAGE_W
  const zFitH = vh / bandH
  const zContainer = (0.7 * vw) / CONTAINER_W
  const zContainerRef = (0.287 * vw) / CONTAINER_OUTER_W
  // Estimated score box (design size 36 · fontScale, line ≈ 1.25) — matches
  // ScoreDisplay's score text.
  const fontScaleNow = portrait
    ? Math.max(0.85, ps)
    : Math.max(0.75, Math.min(vw / REF_W, vh / REF_H))
  // Portrait keeps the score on the TOP ROW (shared with Best/Global) at a
  // smaller size — moving it below the strip conflicts with the claw guard
  // on short screens (floor visibility forces the claw high). The Global
  // text shortens on portrait so the center gap always fits the score.
  const scoreSizeNow = portrait ? 30 : SCORE_DESIGN_SIZE
  const scoreYEst = portrait
    ? topStripY + 4 * ps
    : SCORE_DESIGN_Y * (vh / REF_H) + safe.top
  const scoreBottomEst = scoreYEst + scoreSizeNow * fontScaleNow * SCORE_LINE
  // Landscape claw guard: with the floor-pinned centerY the claw top renders
  // at 0.905·vh − (FLOOR_TOP − CLAW_TOP_WORST)·z, so the guard is a simple
  // zoom ceiling.
  const zClaw = Math.max(
    0.4,
    (0.905 * vh - scoreBottomEst - 6) / (FLOOR_TOP_STAGE - CLAW_TOP_WORST),
  )
  const zoom = portrait
    ? Math.max(zFitW, Math.min(zFitH, zContainer))
    : Math.min(zFitW, zFitH, zContainerRef, zClaw)
  // Landscape: pin the floor TOP at 90.5% of the viewport height (reference
  // y≈848 at 936). Portrait: keep the band centered, but on very short
  // screens shift the camera so BOTH the claw (below the score) and the
  // floor stay visible.
  const floorMin = FLOOR_BOTTOM + 6 - vh / (2 * zoom)
  const clawMax = CLAW_TOP_WORST + (vh / 2 - scoreBottomEst - 4) / zoom
  const centerY = portrait
    ? Math.min(Math.max(BAND_CENTER, floorMin), Math.max(floorMin, clawMax))
    : FLOOR_TOP_STAGE - (0.405 * vh) / zoom
  const world = { zoom, centerX: STAGE_W / 2, centerY }

  // ---- background grid (spec §3) -------------------------------------------
  const grid =
    mode === 'mobile'
      ? { cell: 26, line: 1.25 }
      : { cell: Math.round(Math.min(44, Math.max(28, 42 * Math.min(vw / REF_W, vh / REF_H)))), line: 1.75 }

  // ---- desktop landscape composition (fractions of the reference) ----------
  if (!portrait) {
    const ds = Math.min(vw / REF_W, vh / REF_H) // desktop size scale
    const m = (ref: number): number => Math.max(10, ref * ds)
    return {
      mode,
      composition,
      vw,
      vh,
      fontScale: Math.max(0.75, ds),
      world,
      grid,
      best: { x: 38 * (vw / REF_W), y: 47 * (vh / REF_H) + safe.top },
      global: { x: 38 * (vw / REF_W), y: 47 * (vh / REF_H) + m(40) + safe.top },
      score: { x: vw / 2, y: SCORE_DESIGN_Y * (vh / REF_H) + safe.top },
      scoreSize: SCORE_DESIGN_SIZE,
      nextBall: {
        pos: { x: 92 * (vw / REF_W), y: 293 * (vh / REF_H) },
        label: { x: 92 * (vw / REF_W), y: 293 * (vh / REF_H) + m(50) },
        diameter: m(74),
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
    }
  }

  // ---- portrait composition (mobile + portrait tablet) ---------------------
  // Sizes scale with the viewport but clamp so 320×568 stays usable and
  // 430×932 does not balloon.
  const abilitySize = Math.round(Math.max(54, Math.min(70, 62 * ps)))
  // CartoonButton positions its container at the button CENTER — startY must
  // be the center y (Phase 2.11.1: the old vh − size − 10 treated it as top
  // and pushed the buttons up over the tier row).
  const abilitiesTop = vh - safe.bottom - abilitySize - 10
  const nbPos = { x: 34 + safe.left + 24 * ps, y: topStripY + 106 * ps }
  const nbD = Math.round(Math.max(44, Math.min(64, 54 * ps)))
  return {
    mode,
    composition,
    vw,
    vh,
    fontScale: Math.max(0.85, ps),
    world,
    grid,
    best: { x: 14 + safe.left, y: topStripY },
    // Global clears the Best text's full height (30 design · 1.3 line) —
    // 26·ps overlapped it at large font scales (768×1024).
    global: { x: 14 + safe.left, y: topStripY + 42 * ps },
    score: { x: vw / 2, y: topStripY + 4 * ps },
    scoreSize: 30,
    nextBall: {
      pos: nbPos,
      // Label clears the preview ball's bottom edge AND the disc scan
      // (offset derives from the diameter, never a fixed px).
      label: { x: nbPos.x, y: nbPos.y + nbD / 2 + 18 * ps },
      diameter: nbD,
    },
    tiers: {
      nodeR: Math.max(9, Math.min(14, 12 * ps)),
      kind: 'row',
      // Nodes sit just ABOVE the ability buttons' top edge (startY is the
      // button center — see abilitiesTop).
      rowY: abilitiesTop - 10 * ps - Math.max(9, Math.min(14, 12 * ps)),
      rowX0: 30 + safe.left,
      rowX1: vw - 30 - safe.right,
    },
    abilities: {
      size: abilitySize,
      gap: Math.round(10 * ps),
      startX: 0,
      startY: abilitiesTop + abilitySize / 2,
      centerX: true,
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
