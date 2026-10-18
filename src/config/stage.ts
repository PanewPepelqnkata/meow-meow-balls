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
