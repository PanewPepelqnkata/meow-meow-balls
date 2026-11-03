/** Column geometry and label anchors use podium-canvas local coordinates. */
export interface ChampionColumn {
  x: number
  y: number
  w: number
  h: number
  rank: number
  visualCX: number
  medalY: number // Medal center.
  medalR: number
  plateY: number // Plaque top edge.
  plateW: number
  plateH: number
}

const INK = '#171613'
const MARBLE = '#f4ecd9'
const MARBLE_LIGHT = '#fff9e9'
const MARBLE_SHADE = '#ddd0b3'
const MARBLE_DARK = '#c6b797'
const GOLD = '#d9a83f'

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w * 0.5, h * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawPlinth(
  ctx: CanvasRenderingContext2D,
  w: number,
  plinthY: number,
  plinthH: number,
  outline: number,
): void {
  if (plinthH <= 0 || w <= 0) return

  const xPad = Math.min(w * 0.035, 18)
  const topH = Math.min(plinthH * 0.3, Math.max(outline * 3, 12))
  const faceTop = plinthY + topH * 0.62
  const faceBottom = plinthY + plinthH * 0.82
  const faceH = Math.max(0, faceBottom - faceTop)
  const radius = Math.min(outline * 2.2, plinthH * 0.12)

  roundedRect(ctx, xPad, plinthY + topH * 0.18, w - xPad * 2, topH, radius)
  ctx.fillStyle = MARBLE_LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, xPad * 1.35, plinthY + topH * 0.56, w - xPad * 2.7, plinthH * 0.34, radius * 0.72)
  ctx.fillStyle = MARBLE_SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  if (faceH > outline * 2.5) {
    roundedRect(ctx, xPad * 1.7, faceTop, w - xPad * 3.4, faceH, radius * 0.45)
    ctx.fillStyle = '#eee2c8'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = outline * 0.78
    ctx.stroke()

    const stripeY = faceTop + faceH * 0.5
    ctx.beginPath()
    ctx.moveTo(xPad * 2.15, stripeY)
    ctx.lineTo(w - xPad * 2.15, stripeY)
    ctx.strokeStyle = GOLD
    ctx.lineWidth = Math.max(1, outline * 0.66)
    ctx.stroke()
  }

  const footY = plinthY + plinthH * 0.83
  const footH = Math.max(outline * 2, plinthH * 0.17)
  roundedRect(ctx, xPad * 0.7, footY, w - xPad * 1.4, Math.min(footH, plinthY + plinthH - footY), radius)
  ctx.fillStyle = MARBLE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()
}

function drawShaft(
  ctx: CanvasRenderingContext2D,
  column: ChampionColumn,
  deckH: number,
  outline: number,
): void {
  const cx = column.x + column.w * 0.5
  const baseH = Math.min(column.h * 0.2, Math.max(8, deckH * 0.3))
  const baseY = column.y + column.h - baseH
  const topY = Math.min(column.y + deckH * 0.84, baseY)
  const shaftH = Math.max(0, baseY - topY)
  const topHalf = column.w * 0.275
  const bottomHalf = column.w * 0.345

  if (shaftH > 0) {
    ctx.beginPath()
    ctx.moveTo(cx - topHalf, topY)
    ctx.lineTo(cx + topHalf, topY)
    ctx.lineTo(cx + bottomHalf, baseY)
    ctx.lineTo(cx - bottomHalf, baseY)
    ctx.closePath()
    ctx.fillStyle = MARBLE
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = outline
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx + topHalf * 0.52, topY + outline * 0.55)
    ctx.lineTo(cx + bottomHalf * 0.62, baseY - outline * 0.8)
    ctx.lineTo(cx + bottomHalf * 0.91, baseY - outline * 0.8)
    ctx.lineTo(cx + topHalf * 0.92, topY + outline * 0.55)
    ctx.closePath()
    ctx.fillStyle = '#e4d8bf'
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(cx - topHalf * 0.72, topY + outline)
    ctx.lineTo(cx - bottomHalf * 0.78, baseY - outline)
    ctx.moveTo(cx + topHalf * 0.08, topY + outline)
    ctx.lineTo(cx + bottomHalf * 0.09, baseY - outline)
    ctx.strokeStyle = MARBLE_LIGHT
    ctx.lineWidth = Math.max(1.2, column.w * 0.035)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx - topHalf * 0.92, topY + shaftH * 0.42)
    ctx.quadraticCurveTo(cx - topHalf * 0.68, topY + shaftH * 0.48, cx - topHalf * 0.78, topY + shaftH * 0.54)
    ctx.strokeStyle = MARBLE_DARK
    ctx.lineWidth = Math.max(0.8, outline * 0.42)
    ctx.stroke()
  }

  const baseW = column.w * 0.86
  const baseX = cx - baseW * 0.5
  const stepH = Math.max(3, baseH * 0.43)
  roundedRect(ctx, cx - column.w * 0.39, baseY, column.w * 0.78, stepH, outline * 0.7)
  ctx.fillStyle = MARBLE_LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, baseX, baseY + stepH * 0.58, baseW, Math.max(2, column.y + column.h - (baseY + stepH * 0.58)), outline * 0.8)
  ctx.fillStyle = MARBLE_SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(baseX + outline, baseY + stepH * 0.72)
  ctx.lineTo(baseX + baseW - outline, baseY + stepH * 0.72)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.62)
  ctx.stroke()


}
function drawCapital(
  ctx: CanvasRenderingContext2D,
  column: ChampionColumn,
  deckH: number,
  outline: number,
): void {
  const { x, y, w } = column
  const layerH = Math.max(2, deckH * 0.2)
  const faceY = y + deckH * 0.39
  const faceH = deckH * 0.61
  const radius = Math.min(outline * 2, deckH * 0.14)

  roundedRect(ctx, x + w * 0.1, faceY, w * 0.8, faceH, radius)
  ctx.fillStyle = MARBLE_SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, x + w * 0.045, y + deckH * 0.31, w * 0.91, layerH, radius)
  ctx.fillStyle = MARBLE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  roundedRect(ctx, x, y + deckH * 0.16, w, layerH, radius)
  ctx.fillStyle = MARBLE_LIGHT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x + w * 0.14, y + deckH * 0.77)
  ctx.lineTo(x + w * 0.86, y + deckH * 0.77)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.72)
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(column.visualCX, y + deckH * 0.58, w * 0.35, Math.max(2, deckH * 0.105), 0, 0, Math.PI * 2)
  ctx.fillStyle = '#fffaf0'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(1.5, outline * 0.82)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(column.visualCX, y + deckH * 0.58, w * 0.27, Math.max(1, deckH * 0.05), 0, Math.PI * 1.06, Math.PI * 1.94)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(1, outline * 0.6)
  ctx.stroke()
}

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  breadth: number,
  fill: string,
  highlight: string,
  outline: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const px = -dy / length * breadth
  const py = dx / length * breadth
  const mx = (x1 + x2) * 0.5
  const my = (y1 + y2) * 0.5

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(mx + px, my + py, x2, y2)
  ctx.quadraticCurveTo(mx - px, my - py, x1, y1)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x1 + dx * 0.2, y1 + dy * 0.2)
  ctx.lineTo(x1 + dx * 0.72, y1 + dy * 0.72)
  ctx.strokeStyle = highlight
  ctx.lineWidth = outline * 0.48
  ctx.stroke()
}

/** Standalone medal, laurels, and stamped metallic rank numeral. */
export function drawChampionMedal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rank: number,
): void {
  if (w <= 0 || h <= 0) return

  const cx = w * 0.5
  const cy = h * 0.5
  const radius = Math.min(w / 3.8, h / 2.4)
  const outline = Math.min(3.6, radius * 0.115)
  const medalFill = rank === 2 ? '#d9e2e3' : rank === 3 ? '#dc9964' : '#f2c65e'
  const medalFace = rank === 2 ? '#c5d0d3' : rank === 3 ? '#cc8350' : '#eab448'
  const medalEdge = rank === 2 ? '#788b92' : rank === 3 ? '#8f4d2d' : '#a57123'
  const highlight = rank === 2 ? '#f5ffff' : rank === 3 ? '#ffcea1' : '#fff1b2'
  const laurel = rank === 2 ? '#b8c7cb' : rank === 3 ? '#bd7849' : '#dda53a'
  const leafOutline = outline * 0.52

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(cx - radius * 0.58, cy + radius * 0.94)
  ctx.bezierCurveTo(cx - radius * 1.49, cy + radius * 0.64, cx - radius * 1.51, cy - radius * 0.3, cx - radius * 1.1, cy - radius * 0.84)
  ctx.moveTo(cx + radius * 0.58, cy + radius * 0.94)
  ctx.bezierCurveTo(cx + radius * 1.49, cy + radius * 0.64, cx + radius * 1.51, cy - radius * 0.3, cx + radius * 1.1, cy - radius * 0.84)
  ctx.strokeStyle = INK
  ctx.lineWidth = outline * 1.1
  ctx.stroke()
  ctx.strokeStyle = medalEdge
  ctx.lineWidth = outline * 0.58
  ctx.stroke()

  for (let i = 0; i < 5; i += 1) {
    const leafY = cy + radius * (0.62 - i * 0.27)
    const leafX = radius * (1.18 + Math.sin((i + 0.5) / 5 * Math.PI) * 0.16)
    for (let side = -1; side <= 1; side += 2) {
      drawLeaf(ctx, cx + side * leafX, leafY, cx + side * (leafX + radius * 0.32), leafY - radius * 0.23, radius * 0.125, laurel, highlight, leafOutline)
      drawLeaf(ctx, cx + side * leafX, leafY - radius * 0.04, cx + side * (leafX - radius * 0.25), leafY - radius * 0.31, radius * 0.105, medalFill, highlight, leafOutline)
    }
  }
  for (let side = -1; side <= 1; side += 2) {
    drawLeaf(ctx, cx + side * radius * 1.12, cy - radius * 0.63, cx + side * radius * 1.07, cy - radius * 0.99, radius * 0.12, laurel, highlight, leafOutline)
  }

  // The lower rim is a physical extrusion, not a blurred canvas shadow.
  ctx.beginPath()
  ctx.arc(cx, cy + radius * 0.075, radius, 0, Math.PI * 2)
  ctx.fillStyle = medalEdge
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = medalFill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.81, 0, Math.PI * 2)
  ctx.fillStyle = medalFace
  ctx.fill()
  ctx.strokeStyle = medalEdge
  ctx.lineWidth = outline * 0.64
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.905, Math.PI * 1.08, Math.PI * 1.82)
  ctx.strokeStyle = highlight
  ctx.lineWidth = outline * 0.72
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.905, Math.PI * 0.09, Math.PI * 0.8)
  ctx.strokeStyle = medalEdge
  ctx.lineWidth = outline * 0.52
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.695, 0, Math.PI * 2)
  ctx.strokeStyle = medalEdge
  ctx.lineWidth = outline * 0.34
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.72, Math.PI * 0.08, Math.PI * 0.88)
  ctx.strokeStyle = highlight
  ctx.lineWidth = outline * 0.28
  ctx.stroke()

  // An inset die impression: the upper-left cut is dark and the lower-right
  // lip catches the same light as the rim. The numeral shares the alloy.
  ctx.font = `800 ${radius * 1.26}px Nunito, ui-rounded, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const numeral = String(rank)
  const glyphY = cy + radius * 0.045
  const relief = Math.max(0.65, radius * 0.045)
  ctx.fillStyle = highlight
  ctx.fillText(numeral, cx + relief * 0.55, glyphY + relief)
  ctx.strokeStyle = medalEdge
  ctx.lineWidth = Math.max(0.65, radius * 0.055)
  ctx.strokeText(numeral, cx - relief * 0.35, glyphY - relief * 0.55)
  ctx.fillStyle = medalEdge
  ctx.fillText(numeral, cx - relief * 0.35, glyphY - relief * 0.55)
  ctx.fillStyle = rank === 2 ? '#8d9fa4' : rank === 3 ? '#a56339' : '#bd862a'
  ctx.fillText(numeral, cx, glyphY)

  ctx.restore()
}

function plaquePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  corner: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + corner, y)
  ctx.lineTo(x + w - corner, y)
  ctx.lineTo(x + w, y + corner)
  ctx.lineTo(x + w, y + h - corner)
  ctx.lineTo(x + w - corner, y + h)
  ctx.lineTo(x + corner, y + h)
  ctx.lineTo(x, y + h - corner)
  ctx.lineTo(x, y + corner)
  ctx.closePath()
}

/** Text-free plaque with a quiet inset of eight horizontal and six vertical pixels. */
export function drawChampionPlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: 'name' | 'score',
): void {
  if (w <= 0 || h <= 0) return

  const isScore = kind === 'score'
  const outline = Math.min(2.2, w * 0.055, h * 0.09)
  const inset = outline * 0.5 + Math.min(0.35, Math.min(w, h) * 0.02)
  const depth = Math.min(1.8, h * 0.07)
  const frame = Math.min(1.65, w * 0.05, h * 0.06)
  const corner = Math.min(3.8, w * 0.06, h * 0.15)
  const faceW = w - inset * 2
  const faceH = h - inset * 2 - depth
  const ornamentScale = Math.min(1, w / 32, h / 20)

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  plaquePath(ctx, inset, inset + depth, faceW, faceH, corner)
  ctx.fillStyle = isScore ? '#28291f' : '#ab9874'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  const frameFill = ctx.createLinearGradient(0, inset, 0, inset + faceH)
  frameFill.addColorStop(0, isScore ? '#dfb75e' : '#f5d782')
  frameFill.addColorStop(1, isScore ? '#96682c' : '#be8931')
  plaquePath(ctx, inset, inset, faceW, faceH, corner)
  ctx.fillStyle = frameFill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = outline
  ctx.stroke()

  const faceFill = ctx.createLinearGradient(0, inset + frame, 0, inset + faceH - frame)
  faceFill.addColorStop(0, isScore ? '#fff2cf' : '#fff9e9')
  faceFill.addColorStop(0.45, isScore ? '#f2dfb7' : '#f8efd9')
  faceFill.addColorStop(1, isScore ? '#e4ca97' : '#e9dcc0')
  plaquePath(ctx, inset + frame, inset + frame, faceW - frame * 2, faceH - frame * 2, Math.max(0, corner - frame * 0.65))
  ctx.fillStyle = faceFill
  ctx.fill()
  ctx.strokeStyle = isScore ? '#b79045' : '#ac8745'
  ctx.lineWidth = outline * 0.42
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(inset + corner, inset + outline * 0.55)
  ctx.lineTo(w - inset - corner, inset + outline * 0.55)
  ctx.strokeStyle = isScore ? '#f3d28b' : '#fff1bd'
  ctx.lineWidth = outline * 0.38
  ctx.stroke()

  // Small angular keys stay in the border, leaving the label field untouched.
  ctx.strokeStyle = isScore ? '#c6a45e' : '#bd9a54'
  ctx.lineWidth = ornamentScale * 0.72
  for (let side = -1; side <= 1; side += 2) {
    const cornerX = side === -1 ? 0 : w
    const directionX = -side * ornamentScale
    for (let edge = -1; edge <= 1; edge += 2) {
      const cornerY = edge === -1 ? 0 : h
      const directionY = -edge * ornamentScale
      ctx.beginPath()
      ctx.moveTo(cornerX + directionX * 5, cornerY + directionY * 5.4)
      ctx.lineTo(cornerX + directionX * 5, cornerY + directionY * 3.8)
      ctx.lineTo(cornerX + directionX * 7, cornerY + directionY * 3.8)
      ctx.lineTo(cornerX + directionX * 7, cornerY + directionY * 4.7)
      ctx.lineTo(cornerX + directionX * 6.2, cornerY + directionY * 4.7)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = isScore ? '#c3a56c' : '#d8caab'
  ctx.lineWidth = ornamentScale * 0.6
  for (let side = -1; side <= 1; side += 2) {
    const edgeX = side === -1 ? 0 : w
    const direction = -side * ornamentScale
    ctx.beginPath()
    ctx.moveTo(edgeX + direction * 4.8, h * 0.36)
    ctx.lineTo(edgeX + direction * 6.6, h * 0.46)
    ctx.lineTo(edgeX + direction * 5.5, h * 0.58)
    ctx.stroke()
  }

  ctx.restore()
}

export function drawChampionPodium(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  slots: readonly ChampionColumn[],
  plinthY: number,
  plinthH: number,
  deckH: number,
): void {
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const outline = Math.max(2.2, Math.min(4.2, Math.min(w, h) / 100))

  drawPlinth(ctx, w, plinthY, plinthH, outline)

  for (const column of slots) {
    if (column.w <= 0 || column.h <= 0) continue
    drawShaft(ctx, column, deckH, outline)
    drawCapital(ctx, column, deckH, outline)
  }

  ctx.restore()
}
