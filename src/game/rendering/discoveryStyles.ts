import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { FONT_FAMILY } from '../../ui/Typography'

/**
 * DISCOVERY PRESENTATION STYLES.
 *
 * The user asked for alternatives to the "NEW BALL DISCOVERED!" band
 * presentation ("overall the new ball discovered is not cool") — same
 * hand-drawn comic style, but more polished.
 *
 * Each style is a self-contained DESCRIPTION of what to draw and how it
 * animates. The overlay builds the one that is selected; the styles share
 * the character-drawing pipeline and the tier colour so they all read as
 * the same game.
 *
 * - 'band'   — the current presentation: a full-width tier-coloured band
 *              with the character on a cream disc.
 * - 'spot'   — NO band. The character pops in the middle of the screen on
 *              its own, with a burst of rays and the title above it. The
 *              smallest, calmest option.
 * - 'stamp'  — the character SLAMS down onto a round ink stamp (like a
 *              rubber stamp / medal), with a shockwave ring and the title
 *              slamming in with it.
 * - 'reveal' — the character is revealed by an iris (a shrinking hole
 *              that opens out from a point), with the title revealed by
 *              the same wipe. The most "premium" option.
 * - 'card'   — a small rounded card in the centre with the character
 *              inside it, the title on the card, and the whole card
 *              springing in. The most restrained option.
 */
export type DiscoveryStyle = 'band' | 'spot' | 'stamp' | 'reveal' | 'card'

export const DISCOVERY_STYLES: readonly DiscoveryStyle[] = ['band', 'spot', 'stamp', 'reveal', 'card']

/** The style in use. Read from the URL (?discovery=spot) so a style can be
 * tried on the device without a rebuild; the default is the shipped one. */
export function selectedDiscoveryStyle(): DiscoveryStyle {
  if (typeof window === 'undefined') return 'band'
  const p = new URLSearchParams(window.location.search).get('discovery')
  return (DISCOVERY_STYLES as readonly string[]).includes(p ?? '') ? (p as DiscoveryStyle) : 'band'
}

/** Darken a color by a factor. */
export function shadeColor(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f)
  const g = Math.round(((color >> 8) & 0xff) * f)
  const b = Math.round((color & 0xff) * f)
  return (r << 16) | (g << 8) | b
}

/** Lighten a color toward white by a factor. */
export function tintColor(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) + (255 - ((color >> 16) & 0xff)) * f)
  const g = Math.round(((color >> 8) & 0xff) + (255 - ((color >> 8) & 0xff)) * f)
  const b = Math.round((color & 0xff) + (255 - (color & 0xff)) * f)
  return (r << 16) | (g << 8) | b
}

/** The tier's colour — the single source of truth for the presentation. */
export function tierColor(tier: number): number {
  return getTier(tier)?.color ?? 0xffffff
}

/**
 * A comic-style headline, sized to the viewport.
 *
 * The title is the loudest thing on screen in every style, so it gets one
 * helper: the same font, the same ink outline, and a width clamp — only
 * the position and the entrance differ per style.
 */
export function makeHeadline(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  vw: number,
  sizeScale = 1,
): Phaser.GameObjects.Text {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: FONT_FAMILY,
      fontSize: `${Math.round(Math.min(58, Math.max(26, vw * 0.032)) * sizeScale)}px`,
      color: '#ffeb3b',
      stroke: '#111111',
      strokeThickness: 9,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      wordWrap: { width: Math.max(160, vw - 96), useAdvancedWrap: true },
    })
    .setOrigin(0.5, 0.5)
    .setShadow(0, 5, '#00000066', 0, false, true)
  const maxW = Math.min(vw * 0.88, vw - 96)
  if (t.width > maxW) t.setScale(maxW / t.width)
  return t
}

/** A small "Tier N" caption. */
export function makeTierLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  tier: number,
  vw: number,
): Phaser.GameObjects.Text {
  const t = scene.add
    .text(x, y, `Tier ${tier}`, {
      fontFamily: FONT_FAMILY,
      fontSize: `${Math.round(Math.min(34, Math.max(20, vw * 0.02)))}px`,
      color: '#ffffff',
      stroke: '#111111',
      strokeThickness: 7,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    })
    .setOrigin(0.5, 0.5)
    .setShadow(0, 4, '#00000066', 0, false, true)
  const maxW = vw * 0.6
  if (t.width > maxW) t.setScale(maxW / t.width)
  return t
}
