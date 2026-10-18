import { describe, expect, it } from 'vitest'
import { createDeformState, registerImpact, stepDeform, contourPoint, contourRadii } from './deform'

describe('2.6 localized-primary verification (§5)', () => {
  const R = 34
  function hardFloor() {
    const s = createDeformState()
    registerImpact(s, 0, 1, 19, R, 0)
    return s
  }
  function ellipseOnly(state: { squash: number; axisX: number }, angle: number, radius: number): number {
    const g = state.squash * 0.4
    const along = 1 - g
    const across = 1 / Math.max(0.8, along)
    const c = Math.cos(angle), sn = Math.sin(angle)
    const rx = state.axisX !== 0 ? along : across
    const ry = state.axisX !== 0 ? across : along
    return radius / Math.sqrt((c / rx) ** 2 + (sn / ry) ** 2)
  }

  it('rest = perfect circle', () => {
    const radii = contourRadii(createDeformState(), R, 40)
    for (const r of radii) expect(r).toBeCloseTo(R, 6)
  })

  it('peak: contact dent is deep, localized, and dominates the ellipse', () => {
    const state = hardFloor()
    let peakDent = 0, peakBulge = 0
    let shareAtPeakDent = 0
    for (let i = 0; i < 40; i++) {
      stepDeform(state, 16.6)
      const atContact = contourPoint(state, Math.PI / 2, R)
      const dent = R - atContact
      if (dent > peakDent) {
        peakDent = dent
        // at the peak-dent frame: how much of the dip is localized (dent+bulge
        // terms) vs the global ellipse? ellipse-only radius at the contact:
        const ellipse = ellipseOnly(state, Math.PI / 2, R)
        shareAtPeakDent = (ellipse - atContact) / dent
      }
      // bulge ring at ~90° from contact
      const bulgeR = contourPoint(state, Math.PI / 2 + 1.6, R)
      peakBulge = Math.max(peakBulge, bulgeR - R)
    }
    // Deep dent (20–25%+ of radius per spec) and clear bulge (≥8%)
    expect(peakDent).toBeGreaterThan(R * 0.2)
    expect(peakDent).toBeLessThan(R * 0.35)
    expect(peakBulge).toBeGreaterThan(R * 0.08)
    // Localized component accounts for most of the visible displacement
    expect(shareAtPeakDent).toBeGreaterThan(0.55)
  })

  it('contour is smooth: adjacent-point deltas stay small (no polygon artifacts)', () => {
    const state = hardFloor()
    for (let i = 0; i < 5; i++) stepDeform(state, 16.6)
    const radii = contourRadii(state, R, 40)
    for (let i = 0; i < 40; i++) {
      const next = radii[(i + 1) % 40]!
      expect(Math.abs(next - radii[i]!)).toBeLessThan(R * 0.09)
    }
  })

  it('recovery: multi-oscillation tail then exact circle', () => {
    const state = hardFloor()
    let osc = 0
    let prevSign = 0
    for (let i = 0; i < 240; i++) {
      stepDeform(state, 16.6)
      const sgn = Math.sign(state.squash)
      if (sgn !== 0 && prevSign !== 0 && sgn !== prevSign) osc++
      if (sgn !== 0) prevSign = sgn
    }
    expect(osc).toBeGreaterThanOrEqual(3)
    for (const r of contourRadii(state, R, 40)) expect(r).toBeCloseTo(R, 4)
  })

  it('re-excite mid-recovery without abrupt reset', () => {
    const state = hardFloor()
    for (let i = 0; i < 12; i++) stepDeform(state, 16.6) // mid-recovery
    const before = state.squash
    registerImpact(state, 0, 1, 10, R, 0) // second hit while recovering
    expect(state.squashVel).toBeGreaterThan(0) // re-energized, not reset
    expect(state.squash).toBeGreaterThanOrEqual(before * 0.9) // continuity
  })

  it('gentle vs hard: peak intensity scales, gentle stays subtle', () => {
    const gentle = createDeformState()
    registerImpact(gentle, 0, 1, 2.5, R, 0) // gentle tap
    const hard = hardFloor()
    let peakGentle = 0, peakHard = 0
    for (let i = 0; i < 40; i++) {
      stepDeform(gentle, 16.6)
      stepDeform(hard, 16.6)
      peakGentle = Math.max(peakGentle, R - contourPoint(gentle, Math.PI / 2, R))
      peakHard = Math.max(peakHard, R - contourPoint(hard, Math.PI / 2, R))
    }
    expect(peakGentle).toBeGreaterThan(0)
    expect(peakGentle).toBeLessThan(peakHard * 0.5)
  })

  it('wall impact dents toward the wall; ball-to-ball dents toward the other ball', () => {
    const wall = createDeformState()
    registerImpact(wall, 1, 0, 15, R, 0)
    for (let i = 0; i < 3; i++) stepDeform(wall, 16.6)
    const ballHit = createDeformState()
    registerImpact(ballHit, -0.87, 0.5, 13, R, 0.3) // diagonal contact, rotated body
    for (let i = 0; i < 3; i++) stepDeform(ballHit, 16.6)
    // min radius must be near each contact angle, not at a fixed vertical spot
    const radiiW = contourRadii(wall, R, 40)
    const minW = radiiW.indexOf(Math.min(...radiiW))
    const angleW = (minW / 40) * 360
    const radiiB = contourRadii(ballHit, R, 40)
    const minB = radiiB.indexOf(Math.min(...radiiB))
    const angleB = (minB / 40) * 360
    // wall contact at 0° → dent within ±40° of 0°/360°
    const nearZero = (a: number) => a < 40 || a > 320
    expect(nearZero(angleW)).toBe(true)
    // ball contact at atan2(0.5, -0.87) ≈ 150° in world; local frame rotated
    // by body angle 0.3 rad → contact local angle ≈ 150° − 17° ≈ 133°.
    // The dent minimum must sit near the LOCAL contact direction.
    const expectedLocal = (Math.atan2(0.5, -0.87) * 180) / Math.PI - (0.3 * 180) / Math.PI
    const nearContact = Math.abs(((angleB - expectedLocal + 540) % 360) - 180) < 45
    expect(nearContact).toBe(true)
  })
})
