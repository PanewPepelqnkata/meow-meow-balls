import { describe, expect, it } from 'vitest'
import { collectFloorLandings } from './landingSound'

describe('collectFloorLandings', () => {
  it('emits only the strongest qualifying floor contact once per ball', () => {
    const output = new Map<number, { tier: number; speed: number }>()
    const result = collectFloorLandings([
      { ballId: 1, tier: 2, otherLabel: 'floor', approachSpeed: 3.1 },
      { ballId: 1, tier: 2, otherLabel: 'floor', approachSpeed: 5.8 },
      { ballId: 1, tier: 2, otherLabel: 'wall-left', approachSpeed: 9.2 },
      { ballId: 2, tier: 8, otherLabel: 'floor', approachSpeed: 1.4 },
    ], output)
    expect([...result.entries()]).toEqual([[1, { tier: 2, speed: 5.8 }]])
  })

  it('clears the reused output map for each frame drain', () => {
    const output = new Map<number, { tier: number; speed: number }>([[1, { tier: 2, speed: 4 }]])
    expect([...collectFloorLandings([], output)]).toEqual([])
  })
})
