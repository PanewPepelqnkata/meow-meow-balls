export type DiscoveryPresentation = 'first' | 'repeat'

/** Pure routing rule shared by gameplay and regression tests. */
export function discoveryPresentationFor(
  tier: number,
  alreadyPresentedThisRun: boolean,
  firstLifetimeDiscovery: boolean,
  sandbox: boolean,
): DiscoveryPresentation | null {
  if (sandbox || alreadyPresentedThisRun || tier < 5) return null
  return firstLifetimeDiscovery ? 'first' : 'repeat'
}
