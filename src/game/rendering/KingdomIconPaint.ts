import { getTier } from '../../config/ballTiers'
import { ballLookFor, faceLayoutFor, INK, restContour } from './BallAppearance'
import { paintCanonicalCoin } from './Coin'
import { INK_HEX, rrPath, starPath } from './KingdomMenuArt'
export type KingdomButtonIconKind = 'play' | 'leaderboard' | 'collection' | 'store' | 'settings' | 'login'
export type KingdomStatIconKind = 'best' | 'collection' | 'coins'

export function paintMiniTrophy(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(r, r)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Subtle drop shadow
  ctx.fillStyle = 'rgba(17, 22, 37, 0.35)'
  ctx.beginPath()
  ctx.ellipse(0, 0.84, 0.62, 0.16, 0, 0, Math.PI * 2)
  ctx.fill()

  // Ornate twin handles
  const handles = new Path2D('M -.54 -.48 C -1.24 -.68 -1.16 .24 -.42 .2 M .54 -.48 C 1.24 -.68 1.16 .24 .42 .2')
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.24
  ctx.stroke(handles)
  ctx.strokeStyle = '#ffce42'
  ctx.lineWidth = 0.13
  ctx.stroke(handles)

  // Pedestal stem & stepped base
  const stem = new Path2D('M -.18 .14 L .18 .14 L .22 .54 Q .46 .56 .52 .74 L -.52 .74 Q -.46 .56 -.22 .54 Z')
  ctx.fillStyle = '#d48817'
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.12
  ctx.fill(stem)
  ctx.stroke(stem)

  // Main golden chalice cup
  const cup = new Path2D('M -.72 -.74 Q 0 -.62 .72 -.74 L .58 -.06 Q .48 .34 0 .38 Q -.48 .34 -.58 -.06 Z')
  const cupGrad = ctx.createLinearGradient(-0.65, -0.7, 0.65, 0.35)
  cupGrad.addColorStop(0, '#fff39e')
  cupGrad.addColorStop(0.45, '#ffc53d')
  cupGrad.addColorStop(1, '#cf7e12')
  ctx.fillStyle = cupGrad
  ctx.fill(cup)
  ctx.stroke(cup)

  // Specular highlight
  ctx.save()
  ctx.clip(cup)
  ctx.fillStyle = 'rgba(255, 250, 210, 0.65)'
  ctx.fill(new Path2D('M -.58 -.68 L -.22 -.66 L -.18 .24 Q -.44 .14 -.5 -.12 Z'))
  ctx.restore()

  // Center star emblem
  ctx.fillStyle = '#fff6b8'
  starPath(ctx, 0, -0.22, 0.27, 5, 0.46)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.08
  ctx.stroke()

  // Heavy gold base plinth
  ctx.fillStyle = '#ffe578'
  rrPath(ctx, -0.58, 0.64, 1.16, 0.25, 0.1)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.12
  ctx.stroke()
  ctx.restore()
}

function paintBook(ctx: CanvasRenderingContext2D): void {
  ctx.rotate(-0.06)
  ctx.lineWidth = 0.12
  ctx.strokeStyle = INK_HEX

  // Back royal grimoire cover
  ctx.fillStyle = '#4e1f6b'
  rrPath(ctx, -0.78, -0.84, 1.54, 1.66, 0.18)
  ctx.fill()
  ctx.stroke()

  // Cream parchment page block
  ctx.fillStyle = '#fff4d4'
  rrPath(ctx, -0.66, 0.46, 1.38, 0.32, 0.1)
  ctx.fill()
  ctx.stroke()

  // Crimson bookmark ribbon hanging out bottom
  const ribbon = new Path2D('M .18 .68 L .44 .68 L .48 1.02 L .31 .89 L .14 1.02 Z')
  ctx.fillStyle = '#e53945'
  ctx.fill(ribbon)
  ctx.stroke(ribbon)

  // Front beveled amethyst cover
  const coverGrad = ctx.createLinearGradient(-0.7, -0.82, 0.65, 0.56)
  coverGrad.addColorStop(0, '#b55cff')
  coverGrad.addColorStop(0.55, '#8935d1')
  coverGrad.addColorStop(1, '#5e1d9c')
  ctx.fillStyle = coverGrad
  rrPath(ctx, -0.74, -0.84, 1.44, 1.38, 0.16)
  ctx.fill()
  ctx.stroke()

  // Gold spine band & inner frame
  ctx.fillStyle = '#d98eff'
  rrPath(ctx, -0.72, -0.8, 0.22, 1.3, 0.08)
  ctx.fill()
  ctx.strokeStyle = '#ffce42'
  ctx.lineWidth = 0.08
  rrPath(ctx, -0.44, -0.68, 0.98, 1.06, 0.08)
  ctx.stroke()

  // Central golden star crest on cover
  ctx.fillStyle = '#ffe875'
  starPath(ctx, 0.05, -0.15, 0.38, 4, 0.44)
  ctx.fill()
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.09
  ctx.stroke()
}

function paintStore(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 0.12
  ctx.strokeStyle = INK_HEX

  // Royal treasure chest base
  const chestGrad = ctx.createLinearGradient(0, -0.2, 0, 0.85)
  chestGrad.addColorStop(0, '#c86d2d')
  chestGrad.addColorStop(1, '#7a3912')
  ctx.fillStyle = chestGrad
  rrPath(ctx, -0.82, -0.18, 1.64, 1.0, 0.16)
  ctx.fill()
  ctx.stroke()

  // Overflowing golden glow + coins inside open chest
  ctx.fillStyle = '#ffe568'
  ctx.beginPath()
  ctx.ellipse(0, -0.18, 0.68, 0.22, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  for (const [cx, cy, cr] of [[-0.36, -0.24, 0.22], [0.34, -0.22, 0.22], [0, -0.3, 0.26]] as const) {
    ctx.fillStyle = '#ffce42'
    ctx.beginPath()
    ctx.arc(cx, cy, cr, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // Domed chest lid
  const lid = new Path2D('M -.84 -.32 Q -.82 -.88 0 -.88 Q .82 -.88 .84 -.32 Z')
  ctx.fillStyle = '#a8521c'
  ctx.fill(lid)
  ctx.stroke(lid)

  // Gold reinforcing bands
  ctx.fillStyle = '#ffce42'
  for (const bx of [-0.56, 0.38]) {
    rrPath(ctx, bx, -0.8, 0.18, 1.6, 0.05)
    ctx.fill()
    ctx.stroke()
  }

  // Center golden lock plate with keyhole
  ctx.fillStyle = '#ffe678'
  rrPath(ctx, -0.22, -0.26, 0.44, 0.52, 0.1)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = INK_HEX
  ctx.beginPath()
  ctx.arc(0, -0.04, 0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(-0.04, -0.02, 0.08, 0.16)
}

function paintGear(ctx: CanvasRenderingContext2D): void {
  const teeth = 8
  ctx.beginPath()
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / (teeth * 4)
    const r = i % 4 === 0 || i % 4 === 3 ? 0.94 : 0.72
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  const gearGrad = ctx.createLinearGradient(-0.8, -0.8, 0.8, 0.8)
  gearGrad.addColorStop(0, '#e5eef5')
  gearGrad.addColorStop(0.5, '#9cb0bf')
  gearGrad.addColorStop(1, '#5d7082')
  ctx.fillStyle = gearGrad
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.12
  ctx.fill()
  ctx.stroke()

  // Recessed inner bronze ring
  ctx.fillStyle = '#3d4a5d'
  ctx.beginPath()
  ctx.arc(0, 0, 0.48, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Golden hub cap
  ctx.fillStyle = '#ffce42'
  ctx.beginPath()
  ctx.arc(0, 0, 0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 0.09
  ctx.stroke()
}

function paintLogin(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.12
  // Royal heraldic shield
  const shield = new Path2D('M 0 -.9 L .78 -.58 L .72 .14 Q .6 .74 0 .94 Q -.6 .74 -.72 .14 L -.78 -.58 Z')
  const shieldGrad = ctx.createLinearGradient(-0.7, -0.85, 0.7, 0.85)
  shieldGrad.addColorStop(0, '#5c93ff')
  shieldGrad.addColorStop(0.55, '#2f62d9')
  shieldGrad.addColorStop(1, '#1b3b8c')
  ctx.fillStyle = shieldGrad
  ctx.fill(shield)
  ctx.stroke(shield)

  // Gold inner shield trim
  ctx.strokeStyle = '#ffce42'
  ctx.lineWidth = 0.07
  ctx.stroke(new Path2D('M 0 -.76 L .64 -.48 L .58 .12 Q .48 .6 0 .78 Q -.48 .6 -.58 .12 L -.64 -.48 Z'))

  // Crowned knight/monarch bust
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.11
  ctx.fillStyle = '#fff5dc'
  ctx.beginPath()
  ctx.moveTo(-0.46, 0.56)
  ctx.quadraticCurveTo(-0.42, 0.1, 0, 0.1)
  ctx.quadraticCurveTo(0.42, 0.1, 0.46, 0.56)
  ctx.quadraticCurveTo(0, 0.72, -0.46, 0.56)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#ffe599'
  ctx.beginPath()
  ctx.arc(0, -0.22, 0.27, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Mini golden crown on bust
  const crown = new Path2D('M -.26 -.42 L -.32 -.68 L -.12 -.54 L 0 -.72 L .12 -.54 L .32 -.68 L .26 -.42 Z')
  ctx.fillStyle = '#ffce42'
  ctx.fill(crown)
  ctx.lineWidth = 0.08
  ctx.stroke(crown)
}

function paintPlayTriangle(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 0.12
  ctx.strokeStyle = INK_HEX
  const tri = new Path2D('M -.38 -.56 L .58 0 L -.38 .56 Z')
  ctx.fillStyle = '#fffef5'
  ctx.fill(tri)
  ctx.stroke(tri)
}

export function paintButtonIcon(
  ctx: CanvasRenderingContext2D,
  kind: KingdomButtonIconKind,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(r, r)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = INK_HEX
  ctx.lineWidth = 0.12
  if (kind === 'play') paintPlayTriangle(ctx)
  else if (kind === 'leaderboard') {
    ctx.restore()
    paintMiniTrophy(ctx, cx, cy, r * 0.98)
    return
  } else if (kind === 'collection') paintBook(ctx)
  else if (kind === 'store') paintStore(ctx)
  else if (kind === 'settings') paintGear(ctx)
  else paintLogin(ctx)
  ctx.restore()
}

function paintCollectibleBallStat(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Render an authentic in-game Ball Rush ball using the exact BallAppearance pipeline
  // (restContour + faceLayoutFor + getTier color) so the stats pill matches actual gameplay balls.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const tier = 3
  const seed = 8800 + 2 * 113 + tier * 17
  const ballR = r * 0.86
  const look = ballLookFor(tier, seed)
  const contour = restContour(look, ballR, 0, 0, 40)
  const tierColor = getTier(tier)?.color ?? 0xf96ec0
  const fillHex = `#${tierColor.toString(16).padStart(6, '0')}`
  const inkHex = `#${INK.toString(16).padStart(6, '0')}`
  const outlineW = Math.max(1.8, ballR * 0.15)

  // Subtle drop shadow
  ctx.fillStyle = 'rgba(17, 22, 37, 0.28)'
  ctx.beginPath()
  ctx.arc(ballR * 0.06, ballR * 0.1, ballR, 0, Math.PI * 2)
  ctx.fill()

  // Wobbled soft-body contour fill + chunky ink outline
  ctx.beginPath()
  ctx.moveTo(contour[0]!.x, contour[0]!.y)
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i]!.x, contour[i]!.y)
  }
  ctx.closePath()
  ctx.fillStyle = fillHex
  ctx.fill()
  ctx.strokeStyle = inkHex
  ctx.lineWidth = outlineW
  ctx.stroke()

  // Exact normalized in-game face layout (oversized close-set slime eyes, off-center gaze, top-left glint, marker smile)
  const L = faceLayoutFor(look, ballR, 1, { x: 0.42, y: -0.08 })
  for (const e of L.eyes) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(e.x, e.y, e.a, e.b, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = inkHex
    ctx.lineWidth = Math.max(1.2, e.rim * 0.85)
    ctx.stroke()

    ctx.fillStyle = inkHex
    ctx.beginPath()
    ctx.ellipse(e.x + e.px, e.y + e.py, e.pa, e.pb, 0, 0, Math.PI * 2)
    ctx.fill()

    // Pupil upper-left specular highlight + secondary dot
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(e.x + e.px - e.pa * 0.32, e.y + e.py - e.pb * 0.34, e.pa * 0.3, 0, Math.PI * 2)
    ctx.arc(e.x + e.px - e.pa * 0.1, e.y + e.py - e.pb * 0.38, e.pa * 0.12, 0, Math.PI * 2)
    ctx.fill()
  }

  // 10 o'clock body glint + dot
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.beginPath()
  ctx.ellipse(L.highlight.x, L.highlight.y, L.highlight.w / 2, L.highlight.h / 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.beginPath()
  ctx.arc(L.highlightDot.x, L.highlightDot.y, L.highlightDot.r, 0, Math.PI * 2)
  ctx.fill()

  // Simple child-drawn marker mouth
  const m = L.mouth
  ctx.strokeStyle = inkHex
  ctx.lineWidth = Math.max(1.2, m.stroke * 0.85)
  ctx.beginPath()
  const steps = 14
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps
    const tiltLift = m.style === 1 ? 1 + m.tilt * 0.35 * t : 1
    const mx = m.x + t * m.halfW
    const my = m.y + (1 - t * t) * m.depth * tiltLift
    if (i === 0) ctx.moveTo(mx, my)
    else ctx.lineTo(mx, my)
  }
  ctx.stroke()
  ctx.restore()
}

export function paintStatIcon(
  ctx: CanvasRenderingContext2D,
  kind: KingdomStatIconKind,
  cx: number,
  cy: number,
  r: number,
): void {
  if (kind === 'best') {
    paintMiniTrophy(ctx, cx, cy, r * 0.92)
    return
  }
  if (kind === 'coins') {
    paintCanonicalCoin(ctx, cx, cy, r * 0.95)
    return
  }
  paintCollectibleBallStat(ctx, cx, cy, r * 0.95)
}

export const paintKingdomStatIcon = paintStatIcon
