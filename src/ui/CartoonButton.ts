import Phaser from 'phaser'
import { drawLucide } from './LucideIcon'
import { hudText } from './Typography'
import { pressFx } from './PressFx'

/**
 * Phase 2.11.0 — chunky cartoon button (spec §5, §9): rounded body, thick
 * black outline, a darker "side" slab underneath for physical depth, an
 * optional white illustrated icon (drawn by a callback so each ability
 * keeps its own icon), optional quantity badge and keyboard-shortcut badge,
 * press animation, and an honest disabled state (grayscale body, outline
 * preserved, still clearly readable).
 */
export interface CartoonButtonOptions {
  x: number
  y: number
  w: number
  h: number
  fill: number
  disabledFill?: number
  disabled?: boolean
  /** Icon painter, receives center coords + size. Flat buttons paint the
   * icon inside the body; doodle buttons ignore it (white dot badge + text). */
  icon?: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number) => void
  /** Quantity badge ("×2") at lower-right, if given. */
  quantity?: string
  /** Keyboard shortcut badge at upper-left, if given (e.g. "Q"). */
  hotkey?: string
  /** Center label under the icon (e.g. "CHECK OUT!"). */
  label?: string
  labelSize?: number
  /** 'doodle': menu-style wobbly hand-drawn silhouette with a white icon
   * badge (home-screen buttons). Default 'flat': crisp rounded rect (HUD). */
  style?: 'flat' | 'doodle'
  onPress?: () => void
}

/** FNV-1a-style hash of a label + dims — deterministic doodle phase per
 * button, stable across rebuilds (state changes never redraw the wobble). */
function hashSeed(text: string, w: number, h: number): number {
  let x = 2166136261
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619)
  return ((x ^ Math.imul(w, 73856093) ^ Math.imul(h, 19349663)) >>> 0) || 1
}

/**
 * Doodle silhouette: a rounded rectangle sampled along its perimeter and
 * displaced by a smooth low-frequency radial wobble (the same visual
 * language as the ball contours), then smoothed once — reads hand-drawn,
 * strokes clean, and is fully deterministic in (seed, dims) so rebuilds
 * (press/disabled states) never redraw the wobble. Points are button-local,
 * centered on (0,0).
 */
function doodleSilhouette(w: number, h: number, r: number, seed: number, amp: number): Array<{ x: number; y: number }> {
  const rr = Math.min(r, w / 2, h / 2)
  const hw = w / 2 - rr
  const hh = h / 2 - rr
  const steps = 7
  const pts: Array<{ x: number; y: number }> = []
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2)
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr })
    }
  }
  corner(-hw, -hh, Math.PI) // top-left: left edge → top edge
  corner(hw, -hh, Math.PI * 1.5) // top-right: top edge → right edge
  corner(hw, hh, 0) // bottom-right: right edge → bottom edge
  corner(-hw, hh, Math.PI * 0.5) // bottom-left: bottom edge → left edge

  // 3 midpoints on each straight edge so the wobble can breathe there too.
  // Capture the wrap pair (BL corner end → TL corner start) BEFORE any
  // splice shifts indices; then splice edges in descending index order so
  // earlier insertions never move later targets.
  const pWrap = { ...pts[31]! }
  const qWrap = { ...pts[0]! }
  for (const [a, b] of [[23, 24], [15, 16], [7, 8]] as const) {
    const p = pts[a]!
    const q = pts[b]!
    for (const t of [0.75, 0.5, 0.25]) pts.splice(a + 1, 0, { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  }
  for (const t of [0.25, 0.5, 0.75]) pts.push({ x: pWrap.x + (qWrap.x - pWrap.x) * t, y: pWrap.y + (qWrap.y - pWrap.y) * t })

  const p1 = (seed % 1000) / 1000 * Math.PI * 2
  const p2 = ((seed >>> 10) % 1000) / 1000 * Math.PI * 2
  const out = pts.map((p) => {
    const d = Math.hypot(p.x, p.y) || 1
    const th = Math.atan2(p.y, p.x)
    const dr = (Math.sin(3 * th + p1) * 0.62 + Math.sin(5 * th + p2) * 0.38) * amp
    return { x: (p.x / d) * (d + dr), y: (p.y / d) * (d + dr) }
  })
  // One smoothing pass — kills kinks, keeps the wobble legible.
  return out.map((p, i) => {
    const a = out[(i - 1 + out.length) % out.length]!
    const b = out[(i + 1) % out.length]!
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }
  })
}

/** Darkened copy of a 0xRRGGBB fill for the doodle extrusion slab. */
function darkenFill(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 255) * f)
  const g = Math.round(((color >> 8) & 255) * f)
  const b = Math.round((color & 255) * f)
  return (r << 16) | (g << 8) | b
}

export class CartoonButton {
  private readonly objs: Array<Phaser.GameObjects.GameObject> = []
  private container: Phaser.GameObjects.Container | null = null
  private readonly scene: Phaser.Scene
  private readonly opts: CartoonButtonOptions

  constructor(scene: Phaser.Scene, opts: CartoonButtonOptions) {
    this.scene = scene
    this.opts = opts
    this.build()
  }

  get center(): { x: number; y: number } {
    return { x: this.opts.x, y: this.opts.y }
  }

  objects(): Array<Phaser.GameObjects.GameObject> {
    return this.objs
  }

  setDisabled(disabled: boolean): void {
    if (this.opts.disabled === disabled) return
    this.opts.disabled = disabled
    this.rebuild()
  }

  rebuild(): void {
    for (const o of this.objs) o.destroy()
    this.objs.length = 0
    this.build()
  }

  private build(): void {
    const { scene } = this
    const { x, y, w, h } = this.opts
    const r = Math.min(20, h * 0.22)
    const cx = x
    const cy = y
    const c = this.scene.add.container(cx, cy)
    this.container = c
    this.objs.push(c)

    const depth = 44
    const fill = this.opts.disabled ? (this.opts.disabledFill ?? 0x8a8f96) : this.opts.fill
    const doodle = this.opts.style === 'doodle'
    let iconY: number
    let iconS: number

    if (doodle) {
      // DOODLE PLATE (menu): wobbly silhouette, fat ink outline, solid
      // color extrusion + soft drop shadow, top-left glint — the same
      // cartoon language as the balls, still crisp and finished.
      const seed = hashSeed(this.opts.label ?? 'btn', w, h)
      const amp = Math.min(4.2, Math.max(2, h * 0.055))
      const pts = doodleSilhouette(w, h, r, seed, amp).map((p) => new Phaser.Math.Vector2(p.x, p.y))
      const drop = Math.max(5, h * 0.08)
      const extrude = Math.max(3, h * 0.05)
      const inkW = Math.max(3.5, Math.min(7, w * 0.05))
      const v = (dy: number): Phaser.Math.Vector2[] => pts.map((p) => new Phaser.Math.Vector2(p.x, p.y + dy))

      const shadow = scene.add.graphics()
      shadow.fillStyle(0x000000, 0.28)
      shadow.fillPoints(v(drop + 3), true)
      // Extrusion slab: darker body color, offset down — the button's "side".
      const side = scene.add.graphics()
      side.fillStyle(darkenFill(fill, 0.62), 1)
      side.fillPoints(v(extrude), true)
      side.lineStyle(inkW, 0x111111, 1)
      side.strokePoints(v(extrude), true, true)
      const body = scene.add.graphics()
      body.fillStyle(fill, 1)
      body.fillPoints(pts, true)
      body.lineStyle(inkW, 0x111111, 1)
      body.strokePoints(pts, true, true)
      // Glint: white oval on the top-left of the head (ball-shine language).
      body.fillStyle(0xffffff, 0.3)
      body.fillEllipse(-w * 0.26, -h * 0.28, w * 0.32, h * 0.2)
      c.add([shadow, side, body])
      c.setDepth(depth)

      // Text-only: no icon, no dot — the label centers on the bar.
      iconY = this.opts.label ? -h * 0.18 : 0
      iconS = Math.min(w, h) * 0.66
    } else {
      // FLAT PLATE (HUD): crisp rounded rect + darker offset slab.
      const shadow = scene.add.graphics()
      shadow.fillStyle(0x000000, 0.35)
      shadow.fillRoundedRect(-w / 2, -h / 2 + Math.max(3, h * 0.07), w, h, r)
      // Solid extrusion slab (the button's "side") — same chunky depth as
      // the doodle plate, so HUD buttons don't read flat next to the menu.
      const side = scene.add.graphics()
      side.fillStyle(darkenFill(fill, 0.62), 1)
      side.fillRoundedRect(-w / 2, -h / 2 + 2.5, w, h, r)
      const body = scene.add.graphics()
      body.fillStyle(fill, 1)
      body.fillRoundedRect(-w / 2, -h / 2, w, h, r)
      // Crisp vector ink outline (clean cartoon stroke — all RoughJS was
      // removed; the whole game is clean vector now).
      const strokeWidth = Math.max(3, w * 0.045)
      body.lineStyle(strokeWidth, 0x111111, 1)
      body.strokeRoundedRect(-w / 2, -h / 2, w, h, r)
      // Top sheen strip for cartoon gloss
      body.fillStyle(0xffffff, 0.22)
      body.fillRoundedRect(-w / 2 + 6, -h / 2 + 5, w - 12, h * 0.22, r * 0.6)
      c.add([shadow, side, body])
      c.setDepth(depth)
      iconY = this.opts.label ? -h * 0.08 : 0
      // Lucide painters treat `s` as the icon box edge and draw ~92% of it;
      // half the button height keeps the glyph clear of the label row.
      iconS = Math.min(w, h) * 0.5
    }

    if (this.opts.icon) {
      const iconG = scene.add.graphics()
      this.opts.icon(iconG, 0, iconY, iconS)
      c.add(iconG)
    }

    if (this.opts.quantity) {
      const q = hudText(scene, 0, 0, this.opts.quantity, 1, {
        color: '#ffffff',
        size: Math.max(13, w * 0.2),
        stroke: 3,
        origin: [1, 1],
        shadow: false,
      })
      q.setPosition(w / 2 - 6, h / 2 - 4)
      c.add(q)
    }
    if (this.opts.hotkey) {
      const badge = scene.add.graphics()
      const bs = Math.max(16, w * 0.24)
      badge.fillStyle(0xffffff, 1)
      badge.fillCircle(-w / 2 + 4 + bs / 2, -h / 2 + 4 + bs / 2, bs / 2)
      badge.lineStyle(2.5, 0x111111, 1)
      badge.strokeCircle(-w / 2 + 4 + bs / 2, -h / 2 + 4 + bs / 2, bs / 2)
      c.add(badge)
      const k = hudText(scene, 0, 0, this.opts.hotkey, 1, {
        color: '#111111',
        size: bs * 0.72,
        stroke: 0,
        origin: [0.5, 0.5],
        shadow: false,
      })
      k.setPosition(-w / 2 + 4 + bs / 2, -h / 2 + 4 + bs / 2 + 1)
      c.add(k)
    }
    if (this.opts.label) {
      const l = hudText(scene, 0, 0, this.opts.label, 1, {
        color: '#ffffff',
        size: this.opts.labelSize ?? Math.max(12, h * 0.2),
        stroke: 3,
        origin: [0.5, 0.5],
        shadow: false,
      })
      l.setPosition(0, doodle ? 0 : h * 0.3)
      c.add(l)
    }
    if (this.opts.disabled) {
      // Grayscale the icon but keep the outline look (honest SOON state).
      c.setAlpha(0.75)
    }

    const hit = scene.add
      .rectangle(0, 0, w, h, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: !this.opts.disabled })
    c.add(hit)
    if (!this.opts.disabled) {
      hit.on('pointerdown', () => {
        scene.tweens.add({ targets: c, scale: 0.95, duration: 80, yoyo: true, ease: 'Quad.easeOut' })
      })
      hit.on('pointerup', () => {
        pressFx(scene, c, this.opts.onPress)
      })
    }
  }

  /** The interactive press target (for scene wiring/tests). */
  get containerObj(): Phaser.GameObjects.Container | null {
    return this.container
  }
}

/** White outlined icon painters shared by ability buttons. */
export const Icons = {
  /** Raise Walls (Lucide `brick-wall`): the wall the ability builds. */
  raise(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'brick-wall', cx, cy, s * 0.92)
  },
  /** Swap (Lucide `arrow-right-left`): two balls trading places. */
  swap(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'arrow-right-left', cx, cy, s * 0.92)
  },
  /** Shake (Lucide `vibrate`): the phone-shake motion. */
  shake(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'vibrate', cx, cy, s * 0.92)
  },
  /** Locked slot (Lucide `circle-question-mark`). */
  soon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'circle-question-mark', cx, cy, s * 0.92)
  },
  /** Replay (Lucide `rotate-ccw`): PLAY AGAIN. */
  replay(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'rotate-ccw', cx, cy, s * 0.92)
  },
  /** Home (Lucide `house`): MAIN MENU. */
  home(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'house', cx, cy, s * 0.92)
  },
  /** BACK (Lucide `arrow-left`). */
  back(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'arrow-left', cx, cy, s * 0.92)
  },
  /** Theme picker (Lucide `paintbrush`). */
  palette(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'paintbrush', cx, cy, s * 0.92)
  },
  /** Reset progress (Lucide `trash`). */
  trash(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number): void {
    drawLucide(g, 'trash', cx, cy, s * 0.92)
  },
}
