import { getTier } from '../../config/ballTiers'
import { gameBus } from '../events/gameBus'

/**
 * Run score tracking (GAME_SPEC §6). Base points come from the tier config;
 * chain depth applies a modest doubling bonus (chain depth 1 = base, depth 2 =
 * 2×, depth 3 = 4×, capped at 8×).
 */
export class ScoreSystem {
  private _score = 0

  get score(): number {
    return this._score
  }

  /**
   * Award points for a merge that created `resultTier` at `chainDepth`
   * (1 for a first merge in a step, 2+ for chains).
   * Returns the points awarded, or 0 for an invalid tier.
   */
  award(resultTier: number, chainDepth: number): number {
    const tier = getTier(resultTier)
    if (!tier) return 0
    const multiplier = Math.min(2 ** Math.max(0, chainDepth - 1), 8)
    const points = tier.score * multiplier
    this._score += points
    gameBus.emit('state:score', { score: this._score, lastAward: points, chainDepth })
    return points
  }

  /** Reset for a new run. */
  reset(): void {
    this._score = 0
    gameBus.emit('state:score', { score: 0, lastAward: 0, chainDepth: 0 })
  }
}
