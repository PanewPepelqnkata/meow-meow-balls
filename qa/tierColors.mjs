/** Tier fill colors mirrored from src/config/ballTiers.ts (QA probe use only;
 * the authoritative values live in the TS config). */
export function getTierColor(tier) {
  const colors = {
    1: [79, 195, 247],
    2: [95, 212, 55],
    3: [249, 110, 192],
    4: [244, 67, 54],
    5: [255, 152, 0],
    6: [255, 235, 59],
    7: [255, 140, 46],
    8: [156, 39, 176],
    9: [121, 85, 72],
    10: [33, 33, 33],
  }
  return colors[tier] ?? [150, 150, 150]
}
