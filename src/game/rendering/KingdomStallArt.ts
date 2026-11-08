import Phaser from 'phaser'
import type { KingdomMenuLayout } from '../../ui/KingdomMenuLayout'
import { INK_HEX } from './KingdomMenuArt'
import { bakeCanvas } from './RoughArt'

export const THRONE_PALETTE = { ROYAL: '#39284d', GOLD: '#d6ad60', VELVET: '#8d243a' } as const

/** Shared architectural anchors keep live sunlight, banners and ironwork attached on resize. */
export function throneHallGeometry(layout: KingdomMenuLayout) {
  const { width: w, height: h } = layout
  const horizon = h * 0.46
  const windowW = Math.min(w * 0.105, h * 0.12, 112)
  const windowH = Math.min(h * 0.32, windowW * 3.25)
  return {
    horizon,
    windowW,
    windowH,
    windowY: h * 0.13,
    windowXs: [w * 0.17, w * 0.83],
    pillarXs: [w * 0.055, w * 0.29, w * 0.71, w * 0.945],
    pillarW: Math.max(18, Math.min(w * 0.044, 66)),
    chandelierXs: [w * 0.25, w * 0.75],
    chandelierY: Math.min(h * 0.165, 126),
    chandelierW: Math.max(48, Math.min(w * 0.15, h * 0.19, 166)),
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
    const runnerTop = w * 0.058
    const runnerBottom = Math.min(w * 0.29, 340)
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

    // Three broad stone steps and a high-backed royal throne anchor the far end.
    const daisY = horizon - h * 0.02
    for (let step = 2; step >= 0; step--) {
      const stepW = Math.min(w * (0.32 + step * 0.07), 490)
      const stepH = Math.max(5, h * 0.014)
      const y = daisY + step * stepH
      ctx.fillStyle = step % 2 ? '#716476' : '#8e7f90'
      ctx.fillRect(w / 2 - stepW / 2, y, stepW, stepH)
      ctx.fillStyle = '#c2ac99'
      ctx.fillRect(w / 2 - stepW / 2, y, stepW, 2)
      ctx.fillStyle = '#433b50'
      ctx.fillRect(w / 2 - stepW / 2, y + stepH - 2, stepW, 2)
    }
    const throneW = Math.min(w * 0.105, 112)
    const throneH = Math.min(h * 0.23, 190)
    const throneX = w / 2 - throneW / 2
    const throneY = daisY - throneH
    pointedArch(ctx, throneX, throneY, throneW, throneH)
    ctx.fillStyle = '#ae8547'
    ctx.fill()
    pointedArch(ctx, throneX + throneW * 0.13, throneY + throneW * 0.2, throneW * 0.74, throneH * 0.75)
    ctx.fillStyle = '#641e3c'
    ctx.fill()
    ctx.strokeStyle = INK_HEX
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#b99a64'
    for (const side of [-1, 1]) {
      ctx.fillRect(w / 2 + side * throneW * 0.46 - throneW * 0.07, daisY - throneH * 0.36, throneW * 0.14, throneH * 0.4)
    }
    polygon(ctx, [w / 2 - throneW * 0.26, throneY + throneH * 0.38, w / 2 - throneW * 0.31, throneY + throneH * 0.21, w / 2 - throneW * 0.09, throneY + throneH * 0.29, w / 2, throneY + throneH * 0.14, w / 2 + throneW * 0.09, throneY + throneH * 0.29, w / 2 + throneW * 0.31, throneY + throneH * 0.21, w / 2 + throneW * 0.26, throneY + throneH * 0.38])
    ctx.fillStyle = '#edc875'
    ctx.fill()

    // Four carved pillars frame the hall, leaving the menu and showcase readable.
    pillarXs.forEach((cx, index) => {
      const y = h * (index === 0 || index === 3 ? 0.095 : 0.12)
      const bottom = horizon + h * (index === 0 || index === 3 ? 0.2 : 0.03)
      const stone = ctx.createLinearGradient(cx - pillarW / 2, 0, cx + pillarW / 2, 0)
      stone.addColorStop(0, '#383443')
      stone.addColorStop(0.35, '#9b8791')
      stone.addColorStop(0.58, '#746575')
      stone.addColorStop(1, '#302c3d')
      ctx.fillStyle = stone
      ctx.fillRect(cx - pillarW / 2, y, pillarW, bottom - y)
      ctx.strokeStyle = 'rgba(17,22,37,0.6)'
      ctx.lineWidth = Math.max(1, pillarW * 0.04)
      for (const groove of [-0.27, 0, 0.27]) {
        ctx.beginPath()
        ctx.moveTo(cx + groove * pillarW, y)
        ctx.lineTo(cx + groove * pillarW, bottom)
        ctx.stroke()
      }
      for (const collarY of [y, y + pillarW * 0.24, bottom - pillarW * 0.25, bottom]) {
        ctx.fillStyle = '#8b7a85'
        ctx.fillRect(cx - pillarW * 0.68, collarY, pillarW * 1.36, Math.max(4, pillarW * 0.16))
        ctx.fillStyle = '#c4ad94'
        ctx.fillRect(cx - pillarW * 0.68, collarY, pillarW * 1.36, 1.5)
      }
    })
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.47, w * 0.12, w * 0.5, h * 0.47, Math.max(w, h) * 0.72)
    vignette.addColorStop(0, 'rgba(10,9,23,0)')
    vignette.addColorStop(1, 'rgba(10,9,23,0.65)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, w, h)
  }, dpr)
  return scene.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(Math.ceil(w), Math.ceil(h))
}
