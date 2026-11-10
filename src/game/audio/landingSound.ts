export interface LandingSummary {
  tier: number
  speed: number
}

/** Add a qualifying floor impact, retaining only the strongest impact per ball. */
export function recordFloorLanding(
  output: Map<number, LandingSummary>,
  ballId: number,
  tier: number,
  otherLabel: string,
  approachSpeed: number,
  minApproachSpeed = 2.5,
): void {
  if (otherLabel !== 'floor' || approachSpeed <= minApproachSpeed) return
  const previous = output.get(ballId)
  if (!previous || approachSpeed > previous.speed) output.set(ballId, { tier, speed: approachSpeed })
}

/** Per-frame wrapper retained for focused testing; caller supplies its reusable Map. */
export function collectFloorLandings(
  contacts: readonly { ballId: number; tier: number; otherLabel: string; approachSpeed: number }[],
  output: Map<number, LandingSummary>,
  minApproachSpeed = 2.5,
): Map<number, LandingSummary> {
  output.clear()
  for (const contact of contacts) {
    recordFloorLanding(output, contact.ballId, contact.tier, contact.otherLabel, contact.approachSpeed, minApproachSpeed)
  }
  return output
}
