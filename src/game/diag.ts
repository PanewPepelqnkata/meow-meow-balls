import Phaser from 'phaser'

declare const __BR_BUILD__: string

/**
 * ?diag=1 — on-device diagnostic overlay (works in production builds).
 *
 * Answers, from the phone itself:
 * 1. BUILD  — which commit the running code was built from (stale-deploy
 *    detection: iOS home-screen PWAs cache index.html, the only un-hashed
 *    asset, so a stale PWA keeps loading old bundles).
 * 2. GPU/RENDERER — WebGL vs Canvas, actual GPU string.
 * 3. VIEW — CSS viewport, dpr, canvas buffer size.
 * 4. MODE — PWA standalone vs browser tab (stale-cache risk factor).
 * 5. LAYER STATES — live visibility/alpha/displaySize of every baked
 *    background layer plus the active theme.
 * 6. THREE TEST PATCHES through the exact same render pipeline as the
 *    background:
 *      T1 = solid-color canvas texture on an Image (texture upload test)
 *      T2 = transparent canvas + red circle on an Image (bake-style test)
 *      G  = Graphics fillRect (Graphics path test)
 *    All three render at depth 999, top-left, scrollFactor 0. If G shows
 *    but T1/T2 don't, canvas-texture upload is broken on that device. If
 *    none show, the camera/space/depth stack is wrong. If T1/T2 show,
 *    textures work and the bug is in bake content/coords.
 */
export function installDiag(game: Phaser.Game): void {
  const w = window as unknown as Record<string, unknown>
  w.__brGame = game

  // Single instance across React Strict Mode double-mounts.
  if (w.__brDiagTimer) clearInterval(w.__brDiagTimer as ReturnType<typeof setInterval>)

  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:2px;left:2px;z-index:99999;background:rgba(0,0,0,.75);color:#4f4;' +
    'font:11px/1.4 ui-monospace,Menlo,monospace;padding:6px 8px;pointer-events:none;' +
    'white-space:pre;max-width:96vw;border-radius:6px;text-shadow:0 1px 0 #000'
  document.body.appendChild(panel)

  const legend = document.createElement('div')
  legend.style.cssText =
    'position:fixed;bottom:2px;left:2px;z-index:99999;background:rgba(0,0,0,.75);color:#4f4;' +
    'font:11px/1.4 ui-monospace,Menlo,monospace;padding:6px 8px;pointer-events:none;' +
    'white-space:pre;border-radius:6px;text-shadow:0 1px 0 #000'
  legend.textContent = 'T1=solid tex T2=circle tex T3=large tex G=graphics'
  document.body.appendChild(legend)

  let gpu = '?'
  try {
    const r = game.renderer as unknown as { gl?: WebGLRenderingContext; type?: number }
    const gl = r.gl
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'webgl(hidden)'
    } else {
      gpu = 'canvas2d'
    }
  } catch {
    gpu = '?'
  }

  const fmtImg = (i: { visible: boolean; alpha: number; displayWidth: number; displayHeight: number } | null | undefined): string =>
    i ? `${i.visible ? 'vis' : 'HID'} a${i.alpha.toFixed(2)} ${Math.round(i.displayWidth)}x${Math.round(i.displayHeight)}` : 'null'

  const render = (): void => {
    try {
      const standalone =
        (navigator as unknown as { standalone?: boolean }).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches
      const lines: string[] = []
      lines.push(`BUILD ${__BR_BUILD__}`)
      lines.push(`PHASER ${Phaser.VERSION} ${gpu}`)
      lines.push(`VIEW ${window.innerWidth}x${window.innerHeight} dpr${window.devicePixelRatio} buf ${game.scale.width}x${game.scale.height}`)
      lines.push(`MODE ${standalone ? 'PWA-standalone' : 'browser-tab'}`)
      const bg = game.scene.getScene('BackgroundScene') as Phaser.Scene & { background?: Record<string, unknown> }
      const th = bg?.background
      const intro = game.scene.getScene('StartIntroScene') as Phaser.Scene & { scene: { settings: { status: number; data?: { introDiag?: { outerR: number; innerR: number; r: number; phase: string } } } } }
      if (intro && intro.scene.settings.data?.introDiag) {
        const d = intro.scene.settings.data.introDiag
        const closed = 1 - d.r / d.outerR
        lines.push(`INTRO phase=${d.phase} closed=${Math.round(closed * 100)}% status=${intro.scene.settings.status}`)
      }
      if (th) {
        const arts = Object.entries((th.artImages as Record<string, Phaser.GameObjects.Image>) ?? {})
          .map(([k, img]) => `${k}:${fmtImg(img)}`)
          .join(' ')
        lines.push(`theme ${String(th.themeName)} trans ${String(th.transitionProgress)}`)
        lines.push(`grad ${fmtImg(th.gradImage as Phaser.GameObjects.Image | null)}`)
        lines.push(`art ${arts || 'none'}`)
        lines.push(`star ${fmtImg(th.starImage as Phaser.GameObjects.Image | null)} grid ${fmtImg(th.gridImage as Phaser.GameObjects.Image | null)}`)
      } else {
        lines.push('no BackgroundTheme')
      }
      panel.textContent = lines.join('\n')
    } catch (e) {
      panel.textContent = 'diag error: ' + String(e)
    }
  }

  // Test patches once the scenes exist.
  game.events.once(Phaser.Core.Events.READY, () => {
    try {
      const bg = game.scene.getScene('BackgroundScene') as Phaser.Scene | null
      if (!bg) return
      if (!bg.textures.exists('br-diag-t1')) {
        const c1 = document.createElement('canvas')
        c1.width = 16
        c1.height = 16
        const x1 = c1.getContext('2d')!
        x1.fillStyle = '#ff2222'
        x1.fillRect(0, 0, 16, 16)
        bg.textures.addCanvas('br-diag-t1', c1)
      }
      if (!bg.textures.exists('br-diag-t2')) {
        const c2 = document.createElement('canvas')
        c2.width = 64
        c2.height = 64
        const x2 = c2.getContext('2d')!
        x2.fillStyle = '#ff2222'
        x2.beginPath()
        x2.arc(32, 32, 22, 0, Math.PI * 2)
        x2.fill()
        bg.textures.addCanvas('br-diag-t2', c2)
      }
      if (!bg.textures.exists('br-diag-t3')) {
        // LARGE-texture patch: 1170×2532 solid red — the EXACT upload
        // class of the background bakes (11.8 MP RGBA). A smaller patch
        // could false-clear the large-upload branch.
        const c3 = document.createElement('canvas')
        c3.width = 1170
        c3.height = 2532
        const x3 = c3.getContext('2d')!
        x3.fillStyle = '#ff2222'
        x3.fillRect(0, 0, 1170, 2532)
        bg.textures.addCanvas('br-diag-t3', c3)
      }
      // Patch row at y=200: the DOM text panel (~140px tall) paints the
      // top-left corner — patches behind it are unreadable on device.
      bg.add
        .image(8, 200, 'br-diag-t1')
        .setOrigin(0, 0)
        .setDisplaySize(46, 46)
        .setDepth(999)
      bg.add
        .image(62, 200, 'br-diag-t2')
        .setOrigin(0, 0)
        .setDisplaySize(46, 46)
        .setDepth(999)
      bg.add
        .image(116, 200, 'br-diag-t3')
        .setOrigin(0, 0)
        .setDisplaySize(46, 46)
        .setDepth(999)
      const g = bg.add.graphics().setDepth(999)
      g.fillStyle(0x22cc44, 1)
      g.fillRect(170, 200, 46, 46)
    } catch {
      /* patches are best-effort; the text panel still works */
    }
  })

  render()
  w.__brDiagTimer = setInterval(render, 800)
}

