/**
 * Central stage + scaling configuration.
 *
 * Decision rationale and viewport calculations: docs/STAGE_SIZE.md.
 * Phase 0 decision: 720x1280. All geometry consumers must read these values
 * from here — never hardcode stage dimensions in scenes or systems.
 */
export const STAGE = {
  width: 720,
  height: 1280,
  /** Scene background while the design does not exist yet (temporary scaffold). */
  devBackgroundColor: '#24053b',
} as const

export type Stage = typeof STAGE

/**
 * Render-buffer pixel-ratio cap, shared by the WebGL backing store
 * (GameRoot), Phaser Text resolution (Typography) and menu icon bakes.
 * PERF: an iPhone (DPR 3) at native density renders a 1170×2532 buffer
 * (2.96 MP, ~3× overdraw per frame) and measured 42fps idle; DPR 2 is
 * 780×1688 (1.32 MP), ~2.25× less fill. Background art is already baked
 * at DPR 2. Raising this cap reintroduces the idle frame-rate drop.
 */
export const MAX_RENDER_DPR = 2
