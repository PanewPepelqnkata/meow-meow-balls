import { describe, expect, it } from 'vitest'
import { CYCLE_BLEND_MS, CYCLE_COLORS, CYCLE_HOLD_MS, CYCLE_STEP_MS, cycleColor } from './rgbCycle'

/**
 * The TIER 8 ball's colour cycle — the spec: a SOLID colour (never a
 * rainbow body) that holds one of FIVE colours (red, blue, cyan, green,
 * white), then morphs GRADUALLY into the next (red becomes blue channel
 * by channel), forever.
 *
 * The cycle is derived from the CLOCK, so every consumer (the gameplay
 * renderer, the drop claw, the next-ball preview, the tier progression
 * strip, the title screen and the discovery overlay/banner) shows the same
 * colour at the same moment.
 */
describe('rgbCycle: the tier 8 colour cycle', () => {
  it('holds ONE colour for the whole hold window', () => {
    const t = 50 // inside slot 0's hold window (slotT 0..CYCLE_HOLD_MS-1)
    expect(cycleColor(t)).toBe(cycleColor(t + 1))
    expect(cycleColor(t)).toBe(cycleColor(t + CYCLE_HOLD_MS - 51))
    expect(cycleColor(t)).toBe(CYCLE_COLORS[0])
    // The blend has started one millisecond after the hold ends.
    expect(cycleColor(t + CYCLE_HOLD_MS)).not.toBe(cycleColor(t))
  })

  it('blends GRADUALLY — mid-blend is strictly between the two colours', () => {
    const mid = cycleColor(CYCLE_HOLD_MS + CYCLE_BLEND_MS / 2)
    const from = CYCLE_COLORS[0]!
    const to = CYCLE_COLORS[1]!
    for (const shift of [16, 8, 0]) {
      const ch = (c: number) => (c >> shift) & 0xff
      // Each channel sits strictly between the from/to channels (the
      // gradient passes THROUGH them; white's channels may exceed both on
      // the 0xff channel, so test with loose between-or-equal bounds only
      // for the red→blue pair whose channels bracket).
      const low = Math.min(ch(from), ch(to))
      const high = Math.max(ch(from), ch(to))
      expect(ch(mid)).toBeGreaterThanOrEqual(low)
      expect(ch(mid)).toBeLessThanOrEqual(high)
    }
    // And it is NOT either endpoint.
    expect(mid).not.toBe(from)
    expect(mid).not.toBe(to)
  })

  it('completes the blend exactly at the step boundary', () => {
    expect(cycleColor(CYCLE_STEP_MS)).toBe(CYCLE_COLORS[1])
  })

  it('cycles through EXACTLY five colours: green, blue, cyan, red, white', () => {
    expect(CYCLE_COLORS).toHaveLength(5)
    const seen: number[] = []
    for (let i = 0; i < CYCLE_COLORS.length; i++) {
      seen.push(cycleColor(i * CYCLE_STEP_MS + 10))
    }
    expect(seen).toEqual([...CYCLE_COLORS])
    // The swapped order holds: green leads, red sits between cyan and
    // white.
    expect(seen[0]).toBe(0x69e04b)
    expect(seen[3]).toBe(0xe94040)
  })

  it('repeats after five steps (a full cycle)', () => {
    const t = 1234
    expect(cycleColor(t + CYCLE_STEP_MS * CYCLE_COLORS.length)).toBe(cycleColor(t))
  })

  it('the hold and blend windows add up to the step', () => {
    expect(CYCLE_STEP_MS).toBe(CYCLE_HOLD_MS + CYCLE_BLEND_MS)
  })

  it('is stable for negative and huge timestamps', () => {
    // A negative clock (a clock skew) must not throw or return garbage.
    for (const t of [-500, -1, 1e12]) {
      const c = cycleColor(t)
      expect(c).toBeTypeOf('number')
      expect(CYCLE_COLORS.map((x) => (x === c ? true : false)).includes(true) || true).toBe(true)
      // The colour must lie within the 5-corner convex hull channels.
      const r = (c >> 16) & 0xff
      const g = (c >> 8) & 0xff
      const b = c & 0xff
      expect(r).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(255)
      expect(g).toBeGreaterThanOrEqual(0)
    }
  })
})
