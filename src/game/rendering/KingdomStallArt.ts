import Phaser from 'phaser'
import type { KingdomMenuLayout } from '../../ui/KingdomMenuLayout'
import { INK_HEX } from './KingdomMenuArt'
import { bakeCanvas } from './RoughArt'

export const THRONE_PALETTE = { ROYAL: '#39284d', GOLD: '#d6ad60', VELVET: '#8d243a' } as const

/** Shared architectural anchors keep live sunlight, banners and ironwork attached on resize. */
export function throneHallGeometry(layout: KingdomMenuLayout) {
  const { width: w, height: h, desktop } = layout
  const horizon = h * (desktop ? 0.46 : 0.43)
  const windowW = desktop
    ? Math.min(w * 0.105, h * 0.12, 112)
    : Math.min(w * 0.17, h * 0.11, 74)
  const windowH = desktop
    ? Math.min(h * 0.32, windowW * 3.25)
    : Math.min(h * 0.25, windowW * 2.85)
  return {
    horizon,
    windowW,
    windowH,
    windowY: h * (desktop ? 0.13 : 0.12),
    windowXs: desktop ? [w * 0.18, w * 0.82] : [w * 0.21, w * 0.79],
    pillarXs: desktop
      ? [w * 0.048, w * 0.305, w * 0.695, w * 0.952]
      : [w * 0.085, w * 0.915],
    pillarW: desktop
      ? Math.max(22, Math.min(w * 0.042, 62))
      : Math.max(24, Math.min(w * 0.072, 34)),
    chandelierXs: desktop ? [w * 0.25, w * 0.75] : [w * 0.22, w * 0.78],
    chandelierY: Math.min(h * (desktop ? 0.165 : 0.145), 126),
    chandelierW: desktop
      ? Math.max(48, Math.min(w * 0.15, h * 0.19, 166))
      : Math.max(42, Math.min(w * 0.2, 86)),
  }
}

function pointedArch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + w * 0.72)
  ctx.bezierCurveTo(x, y + w * 0.34, x + w * 0.31, y + w * 0.18, x + w / 2, y)
  ctx.bezierCurveTo(x + w * 0.69, y + w * 0.18, x + w, y + w * 0.34, x + w, y + w * 0.72)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

export function throneBackrestGeometry(throneW: number, throneH: number) {
  const safeThroneW = Number.isFinite(throneW) ? Math.max(1, throneW) : 1
  const safeThroneH = Number.isFinite(throneH) ? Math.max(1, throneH) : 1
  const outerFrameW = safeThroneW * 0.62
  const outerFrameH = safeThroneH * 0.68
  const recessInset = Math.min(Math.max(4, safeThroneW * 0.045), outerFrameW * 0.2, outerFrameH * 0.25)
  return {
    outerFrameW,
    outerFrameH,
    recessInset,
    padW: outerFrameW - recessInset * 2.5,
    padH: outerFrameH - recessInset * 1.6,
  }
}

function polygon(ctx: CanvasRenderingContext2D, points: number[]): void {
  ctx.beginPath()
  ctx.moveTo(points[0]!, points[1]!)
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!)
  ctx.closePath()
}

/** Capped, baked architecture. Only cloth, candles, sunbeams and dust redraw live. */
export function bakeThroneVaultHall(scene: Phaser.Scene, layout: KingdomMenuLayout, dpr: number): Phaser.GameObjects.Image {
  const { width: w, height: h } = layout
  const geometry = throneHallGeometry(layout)
  const { horizon, windowXs, windowY, windowW, windowH, pillarXs, pillarW } = geometry
  const key = 'br-throne-vault-hall'
  // Geometry also depends on safe-area layout; invalidate the bounded texture on a rebuild.
  if (scene.textures.exists(key)) scene.textures.remove(key)
  bakeCanvas(scene, key, Math.ceil(w), Math.ceil(h), (ctx) => {
    ctx.lineJoin = 'round'
    const wall = ctx.createLinearGradient(0, 0, 0, h)
    wall.addColorStop(0, '#181526')
    wall.addColorStop(0.39, '#514458')
    wall.addColorStop(1, '#242334')
    ctx.fillStyle = wall
    ctx.fillRect(0, 0, w, h)

    // Receding ashlar courses and the high, dark timber hammerbeam ceiling.
    ctx.lineWidth = 1
    for (let row = 0; row < 9; row++) {
      const y = h * 0.1 + row * h * 0.045
      ctx.strokeStyle = 'rgba(17,22,37,0.46)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      const blockW = Math.max(46, w / 10)
      for (let x = (row % 2 ? -0.5 : 0) * blockW; x < w; x += blockW) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + h * 0.045)
        ctx.stroke()
      }
    }
    polygon(ctx, [0, 0, w, 0, w * 0.81, h * 0.105, w * 0.19, h * 0.105])
    ctx.fillStyle = '#171321'
    ctx.fill()
    for (let i = 0; i < 7; i++) {
      const x = w * i / 6
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = Math.max(9, w * 0.015)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(w * 0.5 + (x - w * 0.5) * 0.62, h * 0.12)
      ctx.stroke()
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = Math.max(2, w * 0.003)
      ctx.stroke()
    }
    for (const y of [h * 0.028, h * 0.09]) {
      ctx.fillStyle = '#392a2e'
      ctx.fillRect(0, y, w, Math.max(7, h * 0.011))
      ctx.fillStyle = '#795847'
      ctx.fillRect(0, y, w, 2)
    }

    // Gothic windows: jewel mosaics, narrow leadwork and a carved stone surround.
    windowXs.forEach((cx, index) => {
      const x = cx - windowW / 2
      pointedArch(ctx, x - 8, windowY - 8, windowW + 16, windowH + 19)
      ctx.fillStyle = '#292536'
      ctx.fill()
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.save()
      pointedArch(ctx, x, windowY, windowW, windowH)
      ctx.clip()
      ctx.fillStyle = '#bd874f'
      ctx.fillRect(x, windowY, windowW, windowH)
      const colors = ['#ae3967', THRONE_PALETTE.ROYAL, THRONE_PALETTE.GOLD, '#628cac', THRONE_PALETTE.VELVET, '#c8a36a']
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 3; column++) {
          const tx = x + column * windowW / 3
          const ty = windowY + row * windowH / 8
          ctx.fillStyle = colors[(row + column * 2 + index) % colors.length]!
          ctx.fillRect(tx, ty, windowW / 3, windowH / 8)
          ctx.strokeStyle = INK_HEX
          ctx.lineWidth = 1.5
          ctx.strokeRect(tx, ty, windowW / 3, windowH / 8)
          polygon(ctx, [tx, ty + windowH / 16, tx + windowW / 6, ty, tx + windowW / 3, ty + windowH / 16, tx + windowW / 6, ty + windowH / 8])
          ctx.stroke()
        }
      }
      const glassLight = ctx.createLinearGradient(x, windowY, x + windowW, windowY)
      glassLight.addColorStop(0, 'rgba(255,234,178,0.05)')
      glassLight.addColorStop(0.5, 'rgba(255,244,198,0.42)')
      glassLight.addColorStop(1, 'rgba(255,234,178,0.05)')
      ctx.fillStyle = glassLight
      ctx.fillRect(x, windowY, windowW, windowH)
      ctx.restore()
      pointedArch(ctx, x, windowY, windowW, windowH)
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#9b8990'
      ctx.fillRect(x - 10, windowY + windowH, windowW + 20, 7)
    })

    // Checkerboard marble is projected from a single vanishing point, not a flat grid.
    const nearScale = w * 0.115
    const rows = 10
    for (let row = 0; row < rows; row++) {
      const p0 = row / rows
      const p1 = (row + 1) / rows
      const depth0 = 0.12 + p0 * p0 * 0.88
      const depth1 = 0.12 + p1 * p1 * 0.88
      const y0 = horizon + (h - horizon) * p0 * p0
      const y1 = horizon + (h - horizon) * p1 * p1
      for (let column = -40; column < 40; column++) {
        const x0 = w / 2 + column * nearScale * depth0
        const x1 = w / 2 + (column + 1) * nearScale * depth0
        const x2 = w / 2 + (column + 1) * nearScale * depth1
        const x3 = w / 2 + column * nearScale * depth1
        if (Math.max(x1, x2) < 0 || Math.min(x0, x3) > w) continue
        polygon(ctx, [x0, y0, x1, y0, x2, y1, x3, y1])
        ctx.fillStyle = (row + column) % 2 === 0 ? '#a99caa' : '#393747'
        ctx.fill()
        ctx.strokeStyle = 'rgba(17,22,37,0.48)'
        ctx.lineWidth = 0.65
        ctx.stroke()
        ctx.save()
        ctx.clip()
        ctx.strokeStyle = (row + column) % 2 === 0 ? 'rgba(249,237,230,0.2)' : 'rgba(181,169,188,0.12)'
        ctx.beginPath()
        ctx.moveTo(x0, y0 + (y1 - y0) * 0.3)
        ctx.bezierCurveTo(x1, y0, x3, y1, x2, y0 + (y1 - y0) * 0.7)
        ctx.stroke()
        ctx.restore()
      }
    }
    const floorShade = ctx.createLinearGradient(0, horizon, 0, h)
    floorShade.addColorStop(0, 'rgba(31,26,44,0.56)')
    floorShade.addColorStop(0.4, 'rgba(31,26,44,0.12)')
    floorShade.addColorStop(1, 'rgba(15,14,27,0.38)')
    ctx.fillStyle = floorShade
    ctx.fillRect(0, horizon, w, h - horizon)

    // The crimson runner widens into the foreground, with woven gold borders.
    const runnerTop = layout.desktop ? w * 0.068 : w * 0.14
    const runnerBottom = layout.desktop ? Math.min(w * 0.31, 380) : w * 0.44
    polygon(ctx, [w / 2 - runnerTop, horizon, w / 2 + runnerTop, horizon, w / 2 + runnerBottom, h, w / 2 - runnerBottom, h])
    const velvet = ctx.createLinearGradient(0, horizon, 0, h)
    velvet.addColorStop(0, '#601e35')
    velvet.addColorStop(0.6, THRONE_PALETTE.VELVET)
    velvet.addColorStop(1, '#4e172f')
    ctx.fillStyle = velvet
    ctx.fill()
    for (const side of [-1, 1]) {
      polygon(ctx, [w / 2 + side * runnerTop, horizon, w / 2 + side * (runnerTop - 3), horizon, w / 2 + side * (runnerBottom - 10), h, w / 2 + side * runnerBottom, h])
      ctx.fillStyle = THRONE_PALETTE.GOLD
      ctx.fill()
      ctx.strokeStyle = 'rgba(17,22,37,0.2)'
      ctx.lineWidth = 2
      for (let fold = 1; fold < 5; fold++) {
        ctx.beginPath()
        ctx.moveTo(w / 2 + side * runnerTop * fold / 5, horizon)
        ctx.lineTo(w / 2 + side * runnerBottom * fold / 5, h)
        ctx.stroke()
      }
    }

    // Three broad stone steps and the majestic Ball Rush "Iron Throne" anchor the far end.
    const daisY = horizon - h * 0.02
    for (let step = 2; step >= 0; step--) {
      const stepW = layout.desktop
        ? Math.min(w * (0.32 + step * 0.07), 490)
        : Math.min(w * (0.52 + step * 0.1), 320)
      const stepH = Math.max(5, h * 0.013)
      const y = daisY + step * stepH
      ctx.fillStyle = step % 2 ? '#716476' : '#8e7f90'
      ctx.fillRect(w / 2 - stepW / 2, y, stepW, stepH)
      ctx.fillStyle = '#c2ac99'
      ctx.fillRect(w / 2 - stepW / 2, y, stepW, 2)
      ctx.fillStyle = '#433b50'
      ctx.fillRect(w / 2 - stepW / 2, y + stepH - 2, stepW, 2)
    }

    // Back-wall stone dado wainscot & arched arcade niches so portrait & desktop feel grounded
    const dadoH = Math.max(12, h * 0.028)
    const dadoY = horizon - dadoH
    const dadoGrad = ctx.createLinearGradient(0, dadoY, 0, horizon)
    dadoGrad.addColorStop(0, '#493f56')
    dadoGrad.addColorStop(0.35, '#372f43')
    dadoGrad.addColorStop(1, '#221d2c')
    ctx.fillStyle = dadoGrad
    ctx.fillRect(0, dadoY, w, dadoH)
    ctx.fillStyle = '#a8958a'
    ctx.fillRect(0, dadoY, w, 2)
    ctx.fillStyle = 'rgba(214, 173, 96, 0.55)'
    ctx.fillRect(0, dadoY + 3, w, 1.5)
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.4
    ctx.strokeRect(0, dadoY, w, dadoH)

    // Classic Royal Throne — carved gilded wood & stone frame, deep tufted crimson velvet,
    // scrolled armrests with royal orb finials, and plush seat cushion.
    const throneW = layout.desktop ? Math.min(w * 0.14, 156) : Math.min(w * 0.3, 124)
    const throneH = layout.desktop ? Math.min(h * 0.235, 188) : Math.min(h * 0.195, 152)
    const throneCX = w / 2
    const throneBaseY = daisY + 2
    const backTopY = throneBaseY - throneH * 0.94
    const seatY = throneBaseY - throneH * 0.31

    ctx.save()
    // Soft warm backlight halo behind the throne
    const throneGlow = ctx.createRadialGradient(
      throneCX,
      throneBaseY - throneH * 0.52,
      throneW * 0.08,
      throneCX,
      throneBaseY - throneH * 0.52,
      throneW * 0.72,
    )
    throneGlow.addColorStop(0, 'rgba(255, 220, 138, 0.28)')
    throneGlow.addColorStop(0.58, 'rgba(182, 78, 118, 0.12)')
    throneGlow.addColorStop(1, 'rgba(24, 21, 38, 0)')
    ctx.fillStyle = throneGlow
    ctx.beginPath()
    ctx.arc(throneCX, throneBaseY - throneH * 0.52, throneW * 0.72, 0, Math.PI * 2)
    ctx.fill()

    // Floor contact shadow under the throne base
    ctx.fillStyle = 'rgba(12, 10, 22, 0.48)'
    ctx.beginPath()
    ctx.ellipse(throneCX, throneBaseY + 2, throneW * 0.48, Math.max(4, throneH * 0.045), 0, 0, Math.PI * 2)
    ctx.fill()

    // Rear carved timber & gold upright Stile posts flanking the backrest
    const postHalfSpan = throneW * 0.31
    const postW = Math.max(6, throneW * 0.085)
    for (const side of [-1, 1]) {
      const px = throneCX + side * postHalfSpan - postW / 2
      const postTop = throneBaseY - throneH * 0.84
      const postGrad = ctx.createLinearGradient(px, 0, px + postW, 0)
      postGrad.addColorStop(0, side < 0 ? '#6e4e23' : '#9c7336')
      postGrad.addColorStop(0.45, '#f0c96b')
      postGrad.addColorStop(1, '#583d1b')
      ctx.fillStyle = postGrad
      ctx.fillRect(px, postTop, postW, throneBaseY - postTop)
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 1.6
      ctx.strokeRect(px, postTop, postW, throneBaseY - postTop)

      // Carved collar rings & finialspire on each upright post
      ctx.fillStyle = '#ffe08a'
      ctx.fillRect(px - 1.5, postTop + throneH * 0.1, postW + 3, Math.max(3, throneH * 0.028))
      ctx.strokeRect(px - 1.5, postTop + throneH * 0.1, postW + 3, Math.max(3, throneH * 0.028))

      const finialR = postW * 0.62
      const finialCX = px + postW / 2
      const finialCY = postTop - finialR * 0.65
      const finialGrad = ctx.createRadialGradient(
        finialCX - finialR * 0.28,
        finialCY - finialR * 0.28,
        finialR * 0.1,
        finialCX,
        finialCY,
        finialR,
      )
      finialGrad.addColorStop(0, '#fff2b8')
      finialGrad.addColorStop(0.55, '#e0ae48')
      finialGrad.addColorStop(1, '#6f4c1d')
      ctx.fillStyle = finialGrad
      ctx.beginPath()
      ctx.arc(finialCX, finialCY, finialR, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Outer carved gilded frame of the high arched backrest
    const { outerFrameW, outerFrameH, recessInset, padW, padH } = throneBackrestGeometry(throneW, throneH)
    const outerFrameX = throneCX - outerFrameW / 2
    const outerFrameY = backTopY + throneH * 0.06
    pointedArch(ctx, outerFrameX, outerFrameY, outerFrameW, outerFrameH)
    const goldFrameGrad = ctx.createLinearGradient(outerFrameX, outerFrameY, outerFrameX + outerFrameW, outerFrameY + outerFrameH)
    goldFrameGrad.addColorStop(0, '#8c6428')
    goldFrameGrad.addColorStop(0.28, '#f4cf76')
    goldFrameGrad.addColorStop(0.52, '#c5923c')
    goldFrameGrad.addColorStop(0.78, '#fae094')
    goldFrameGrad.addColorStop(1, '#634419')
    ctx.fillStyle = goldFrameGrad
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 2
    ctx.stroke()

    // Dark carved walnut inner molding recess
    pointedArch(
      ctx,
      outerFrameX + recessInset * 0.65,
      outerFrameY + recessInset * 0.65,
      outerFrameW - recessInset * 1.3,
      outerFrameH - recessInset * 0.9,
    )
    ctx.fillStyle = '#38202c'
    ctx.fill()
    ctx.strokeStyle = '#755020'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Plush crimson velvet upholstered backrest with radial vignette shading & diamond tufting
    const padX = outerFrameX + recessInset * 1.25
    const padY = outerFrameY + recessInset * 1.25
    ctx.save()
    pointedArch(ctx, padX, padY, padW, padH)
    ctx.clip()
    const velvetBackGrad = ctx.createRadialGradient(
      throneCX - padW * 0.12,
      padY + padH * 0.35,
      padW * 0.06,
      throneCX,
      padY + padH * 0.45,
      padH * 0.72,
    )
    velvetBackGrad.addColorStop(0, '#c63656')
    velvetBackGrad.addColorStop(0.48, '#8d223c')
    velvetBackGrad.addColorStop(1, '#471022')
    ctx.fillStyle = velvetBackGrad
    ctx.fillRect(padX, padY, padW, padH)

    // Diamond quilting seams & shadow creases
    const tuftCols = 3
    const tuftRows = 4
    const cellW = padW / tuftCols
    const cellH = (padH * 0.78) / tuftRows
    const tuftStartY = padY + padH * 0.16
    ctx.lineWidth = 1.2
    for (let r = -1; r <= tuftRows + 1; r++) {
      for (let c = -1; c <= tuftCols + 1; c++) {
        const tx = padX + (c + (r % 2 ? 0.5 : 0)) * cellW
        const ty = tuftStartY + r * cellH
        ctx.strokeStyle = 'rgba(34, 6, 16, 0.58)'
        ctx.beginPath()
        ctx.moveTo(tx, ty - cellH)
        ctx.lineTo(tx + cellW * 0.5, ty)
        ctx.lineTo(tx, ty + cellH)
        ctx.lineTo(tx - cellW * 0.5, ty)
        ctx.closePath()
        ctx.stroke()

        // Soft top-left puff highlight inside each quilted diamond
        ctx.fillStyle = 'rgba(255, 168, 188, 0.09)'
        ctx.beginPath()
        ctx.ellipse(tx - cellW * 0.06, ty - cellH * 0.18, cellW * 0.18, cellH * 0.22, -0.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Gold tuft buttons at diamond intersections
    for (let r = 1; r < tuftRows; r++) {
      for (let c = 0; c <= tuftCols; c++) {
        const bx = padX + (c + (r % 2 ? 0.5 : 0)) * cellW
        const by = tuftStartY + r * cellH
        if (bx < padX + 5 || bx > padX + padW - 5) continue
        ctx.fillStyle = 'rgba(24, 5, 12, 0.65)'
        ctx.beginPath()
        ctx.arc(bx + 0.8, by + 1.2, 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#f8d578'
        ctx.beginPath()
        ctx.arc(bx, by, 1.7, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Ambient shadow under the seat cushion against the lower backrest
    const lowerBackShade = ctx.createLinearGradient(0, seatY - throneH * 0.12, 0, seatY + 4)
    lowerBackShade.addColorStop(0, 'rgba(28, 6, 15, 0)')
    lowerBackShade.addColorStop(1, 'rgba(20, 4, 11, 0.72)')
    ctx.fillStyle = lowerBackShade
    ctx.fillRect(padX, seatY - throneH * 0.12, padW, throneH * 0.15)
    ctx.restore()

    // Crisp gold piping around the inner velvet arch
    pointedArch(ctx, padX, padY, padW, padH)
    ctx.strokeStyle = '#ecc365'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Lower throne base box (carved walnut and gold apron between the front legs)
    const baseW = throneW * 0.68
    const baseTopY = seatY + throneH * 0.05
    const baseBoxH = throneBaseY - baseTopY
    const baseGrad = ctx.createLinearGradient(throneCX - baseW / 2, baseTopY, throneCX + baseW / 2, throneBaseY)
    baseGrad.addColorStop(0, '#3e2733')
    baseGrad.addColorStop(0.5, '#593946')
    baseGrad.addColorStop(1, '#291922')
    ctx.fillStyle = baseGrad
    ctx.fillRect(throneCX - baseW / 2, baseTopY, baseW, baseBoxH)
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.8
    ctx.strokeRect(throneCX - baseW / 2, baseTopY, baseW, baseBoxH)

    // Recessed gold brocade front apron panel with ornamental arch
    const apronW = baseW * 0.62
    const apronH = baseBoxH * 0.68
    ctx.fillStyle = '#731b33'
    ctx.fillRect(throneCX - apronW / 2, baseTopY + baseBoxH * 0.16, apronW, apronH)
    ctx.strokeStyle = '#e0b254'
    ctx.lineWidth = 1.4
    ctx.strokeRect(throneCX - apronW / 2, baseTopY + baseBoxH * 0.16, apronW, apronH)
    // Gold tassel fringe along the apron bottom
    ctx.fillStyle = '#eab94f'
    const tasselCount = 9
    for (let i = 0; i < tasselCount; i++) {
      const tx = throneCX - apronW * 0.44 + (i / (tasselCount - 1)) * apronW * 0.88
      ctx.fillRect(tx - 1, baseTopY + baseBoxH * 0.16 + apronH, 2, Math.max(3, baseBoxH * 0.12))
    }

    // Thick bolster velvet seat cushion with piping & highlight roll
    const cushionW = throneW * 0.64
    const cushionH = Math.max(9, throneH * 0.095)
    const cushionX = throneCX - cushionW / 2
    const cushionY = seatY - cushionH * 0.35
    const cushionGrad = ctx.createLinearGradient(0, cushionY, 0, cushionY + cushionH)
    cushionGrad.addColorStop(0, '#d84567')
    cushionGrad.addColorStop(0.45, '#98233f')
    cushionGrad.addColorStop(1, '#4c0f21')
    ctx.fillStyle = cushionGrad
    ctx.beginPath()
    ctx.roundRect(cushionX, cushionY, cushionW, cushionH, cushionH * 0.42)
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 1.7
    ctx.stroke()
    // Gold cord piping across the cushion crown
    ctx.strokeStyle = '#f3cb70'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(cushionX + cushionH * 0.35, cushionY + cushionH * 0.28)
    ctx.quadraticCurveTo(throneCX, cushionY + cushionH * 0.14, cushionX + cushionW - cushionH * 0.35, cushionY + cushionH * 0.28)
    ctx.stroke()

    // Scrolled gilded armrests with velvet arm pads & carved lion-gold orb knuckles
    for (const side of [-1, 1]) {
      const armCenterX = throneCX + side * throneW * 0.33
      const armW = Math.max(9, throneW * 0.11)
      const armTopY = seatY - throneH * 0.14
      const armBottomY = throneBaseY

      // Vertical carved front pillar leg of the armrest
      const legGrad = ctx.createLinearGradient(armCenterX - armW / 2, 0, armCenterX + armW / 2, 0)
      legGrad.addColorStop(0, '#6a4a20')
      legGrad.addColorStop(0.45, '#f2ca6d')
      legGrad.addColorStop(1, '#533816')
      ctx.fillStyle = legGrad
      ctx.fillRect(armCenterX - armW * 0.42, armTopY + throneH * 0.06, armW * 0.84, armBottomY - (armTopY + throneH * 0.06))
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 1.6
      ctx.strokeRect(armCenterX - armW * 0.42, armTopY + throneH * 0.06, armW * 0.84, armBottomY - (armTopY + throneH * 0.06))

      // Upholstered velvet armrest top pad
      const padArmW = armW * 1.12
      const padArmH = Math.max(6, throneH * 0.055)
      ctx.fillStyle = '#992440'
      ctx.beginPath()
      ctx.roundRect(armCenterX - padArmW / 2, armTopY, padArmW, padArmH, 3)
      ctx.fill()
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Gilded scroll knuckle & lion-gold orb finial at front of armrest
      const knuckleR = armW * 0.56
      const knuckleX = armCenterX + side * armW * 0.1
      const knuckleY = armTopY + padArmH * 0.55
      const knuckleGrad = ctx.createRadialGradient(
        knuckleX - knuckleR * 0.25,
        knuckleY - knuckleR * 0.25,
        knuckleR * 0.1,
        knuckleX,
        knuckleY,
        knuckleR,
      )
      knuckleGrad.addColorStop(0, '#fff2ba')
      knuckleGrad.addColorStop(0.55, '#e2b04a')
      knuckleGrad.addColorStop(1, '#6d4b1c')
      ctx.fillStyle = knuckleGrad
      ctx.beginPath()
      ctx.arc(knuckleX, knuckleY, knuckleR, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Stepped gold claw foot at floor level
      ctx.fillStyle = '#dfae4b'
      ctx.beginPath()
      ctx.roundRect(armCenterX - armW * 0.56, armBottomY - Math.max(4, throneH * 0.032), armW * 1.12, Math.max(4, throneH * 0.032), 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()

    // Gothic colonnade pilasters with arched vault ribs & warm gold capitals.
    // On portrait phones, columns sit strictly on the upper back wall (ending at the dado/horizon),
    // with wider, sturdy proportions and an overhead stone archway so they never look like tall skinny poles.
    pillarXs.forEach((cx, index) => {
      const isOuter = index === 0 || index === pillarXs.length - 1
      const y = layout.desktop ? h * (isOuter ? 0.085 : 0.11) : h * 0.115
      const bottom = layout.desktop ? horizon + h * (isOuter ? 0.16 : 0.015) : horizon - dadoH * 0.15
      const colW = layout.desktop ? (isOuter ? pillarW : pillarW * 0.76) : pillarW
      const baseH = Math.max(10, colW * 0.44)

      // Vaulted stone arch rib springing from the column capital toward the ceiling
      ctx.save()
      ctx.strokeStyle = '#3d354b'
      ctx.lineWidth = Math.max(4, colW * 0.28)
      ctx.beginPath()
      ctx.moveTo(cx, y)
      ctx.quadraticCurveTo(cx + (cx < w / 2 ? 1 : -1) * colW * 1.9, y - h * 0.055, cx + (cx < w / 2 ? 1 : -1) * colW * 3.4, 0)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(214, 173, 96, 0.38)'
      ctx.lineWidth = 1.3
      ctx.stroke()
      ctx.restore()

      // Octagonal marble shaft with warm gold trim
      const stone = ctx.createLinearGradient(cx - colW / 2, 0, cx + colW / 2, 0)
      stone.addColorStop(0, '#2a2538')
      stone.addColorStop(0.22, '#6d6076')
      stone.addColorStop(0.5, '#9d8c9a')
      stone.addColorStop(0.78, '#5a4f64')
      stone.addColorStop(1, '#231f30')
      ctx.fillStyle = stone
      ctx.fillRect(cx - colW / 2, y, colW, bottom - y)
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 1.6
      ctx.strokeRect(cx - colW / 2, y, colW, bottom - y)

      // Vertical gold inlay fillet in the center of the pilaster
      ctx.strokeStyle = 'rgba(235, 196, 112, 0.35)'
      ctx.lineWidth = Math.max(1, colW * 0.06)
      ctx.beginPath()
      ctx.moveTo(cx, y + baseH * 0.6)
      ctx.lineTo(cx, bottom - baseH * 0.8)
      ctx.stroke()

      // Ornate Corinthian-inspired gold & stone capital at the top
      ctx.fillStyle = '#c89b48'
      ctx.strokeStyle = INK_HEX
      ctx.lineWidth = 1.4
      ctx.fillRect(cx - colW * 0.68, y, colW * 1.36, Math.max(5, colW * 0.2))
      ctx.strokeRect(cx - colW * 0.68, y, colW * 1.36, Math.max(5, colW * 0.2))
      ctx.fillStyle = '#6f6177'
      ctx.fillRect(cx - colW * 0.58, y + Math.max(5, colW * 0.2), colW * 1.16, Math.max(4, colW * 0.16))
      ctx.strokeRect(cx - colW * 0.58, y + Math.max(5, colW * 0.2), colW * 1.16, Math.max(4, colW * 0.16))

      // Stepped octagonal plinth base with gold molding ring
      ctx.fillStyle = '#574c61'
      ctx.fillRect(cx - colW * 0.66, bottom - baseH * 0.55, colW * 1.32, baseH * 0.55)
      ctx.strokeRect(cx - colW * 0.66, bottom - baseH * 0.55, colW * 1.32, baseH * 0.55)
      ctx.fillStyle = '#3f3749'
      ctx.fillRect(cx - colW * 0.78, bottom - baseH * 0.22, colW * 1.56, baseH * 0.22)
      ctx.strokeRect(cx - colW * 0.78, bottom - baseH * 0.22, colW * 1.56, baseH * 0.22)
      ctx.fillStyle = '#d6ad60'
      ctx.fillRect(cx - colW * 0.62, bottom - baseH * 0.58, colW * 1.24, Math.max(2.5, colW * 0.09))
    })
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.47, w * 0.12, w * 0.5, h * 0.47, Math.max(w, h) * 0.72)
    vignette.addColorStop(0, 'rgba(10,9,23,0)')
    vignette.addColorStop(1, 'rgba(10,9,23,0.65)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, w, h)
  }, dpr)
  return scene.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(Math.ceil(w), Math.ceil(h))
}
