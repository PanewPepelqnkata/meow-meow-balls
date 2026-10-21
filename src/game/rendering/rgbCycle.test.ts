import { describe, expect, it } from 'vitest'
import { CYCLE_COLORS, CYCLE_STEP_MS, cycleColor } from './rgbCycle'

/**
 * The TIER 8 ball's colour cycle — the user's spec: a SOLID colour (not a
 * rainbow) that steps red -> blue -> red every 0.25s.
 *
 * The cycle is derived from the CLOCK, so every consumer (the gameplay
 * renderer, the drop claw, the next-ball preview, the tier progression
 * strip, the collection screen, the discovery overlay) shows the same
 * colour at the same moment.
 */
describe('rgbCycle: the tier 8 colour cycle', () => {
  it('holds ONE colour for the whole 250ms step', () => {
    const t = 1000
    expect(cycleColor(t)).toBe(cycleColor(t + 1))
    expect(cycleColor(t)).toBe(cycleColor(t + 249))
    // the step boundary itself belongs to the NEXT colour
    expect(cycleColor(t + 250)).not.toBe(cycleColor(t))
  })

  it('changes at every step boundary', () => {
    const t = 1000
    const first = cycleColor(t)
    expect(cycleColor(t + CYCLE_STEP_MS)).not.toBe(first)
    expect(cycleColor(t + CYCLE_STEP_MS * 2)).toBe(first)
  })

  it('repeats after two steps (500ms)', () => {
    const t = 1000
    expect(cycleColor(t + CYCLE_STEP_MS * 2)).toBe(cycleColor(t))
  })

  it('cycles between EXACTLY two colours', () => {
    expect(CYCLE_COLORS).toEqual([0xf44336, 0x2196f3])
    const seen = new Set<number>()
    for (let i = 0; i < 8; i++) seen.add(cycleColor(i * CYCLE_STEP_MS))
    expect(seen.size).toBe(2)
    for (const c of seen) expect(CYCLE_COLORS).toContain(c)
  })

  it('the step is 250ms', () => {
    expect(CYCLE_STEP_MS).toBe(250)
  })

  it('is stable for negative and huge timestamps', () => {
    // A negative clock (a clock skew) must not throw or return garbage.
    expect(CYCLE_COLORS).toContain(cycleColor(-500))
    expect(CYCLE_COLORS).toContain(cycleColor(1e12))
  })
})
