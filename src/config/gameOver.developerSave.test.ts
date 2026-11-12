import { describe, expect, it } from 'vitest'
import { DEVELOPER_SAVE_CHANCE, rollDeveloperSave } from './gameOver'

describe('developer save roll', () => {
  it('is a one-in-four chance', () => {
    expect(DEVELOPER_SAVE_CHANCE).toBe(0.25)
    expect(rollDeveloperSave(() => 0)).toBe(true)
    expect(rollDeveloperSave(() => 0.249)).toBe(true)
    expect(rollDeveloperSave(() => 0.25)).toBe(false)
    expect(rollDeveloperSave(() => 0.999)).toBe(false)
  })

  it('never fires on a broken rng value', () => {
    expect(rollDeveloperSave(() => Number.NaN)).toBe(false)
    expect(rollDeveloperSave(() => Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('fires for roughly a quarter of uniform rolls', () => {
    let hits = 0
    const samples = 20_000
    let i = 0
    const rng = (): number => ((i++ * 0.6180339887498949) % 1)
    for (let n = 0; n < samples; n++) if (rollDeveloperSave(rng)) hits++
    expect(hits / samples).toBeGreaterThan(0.23)
    expect(hits / samples).toBeLessThan(0.27)
  })
})
