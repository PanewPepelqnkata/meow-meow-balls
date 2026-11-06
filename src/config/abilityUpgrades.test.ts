import { describe, expect, it } from 'vitest'
import {
  UPGRADE_CATALOG,
  freshUpgradeLevels,
  normalizeUpgradeLevels,
  shakeDurationMs,
  shakeImpulseMultiplier,
  upgradeCost,
  wallDurationMs,
} from './abilityUpgrades'

describe('ability upgrade configuration', () => {
  it('starts with zero levels and clamps malformed levels to catalog caps', () => {
    expect(freshUpgradeLevels()).toEqual({ wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 })
    expect(normalizeUpgradeLevels({ wallDuration: 4.9, shakeDuration: 99, shakeIntensity: -2, unknown: 8 })).toEqual({
      wallDuration: 4,
      shakeDuration: 10,
      shakeIntensity: 0,
    })
  })

  it('prices the next level using the configured base costs', () => {
    expect(upgradeCost('wallDuration', 0)).toBe(10)
    expect(upgradeCost('wallDuration', 9)).toBe(100)
    expect(upgradeCost('wallDuration', 10)).toBe(0)
    expect(upgradeCost('shakeDuration', 3)).toBe(40)
    expect(upgradeCost('shakeIntensity', 0)).toBe(20)
    expect(upgradeCost('shakeIntensity', 4)).toBe(100)
    expect(upgradeCost('shakeIntensity', 5)).toBe(0)
    expect(UPGRADE_CATALOG.wallDuration.maxLevel).toBe(10)
    expect(UPGRADE_CATALOG.shakeIntensity.maxLevel).toBe(5)
  })

  it('derives ability values from levels without changing camera visual settings', () => {
    const levels = { wallDuration: 3, shakeDuration: 4, shakeIntensity: 5 }
    expect(wallDurationMs(levels)).toBe(18_000)
    expect(shakeDurationMs(levels)).toBe(7_000)
    expect(shakeImpulseMultiplier(levels)).toBe(1.5)
  })
})
