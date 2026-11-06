import EventEmitter from 'eventemitter3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type Phaser from 'phaser'

type ButtonScene = {
  add: {
    container: (x: number, y: number) => DisplayObject
    zone: (x: number, y: number, w: number, h: number) => DisplayObject
  }
}

const account = vi.hoisted(() => ({
  registered: true,
  save: { coins: 100, upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 } },
  authListeners: new Set<() => void>(),
  saveListeners: new Set<() => void>(),
  purchase: vi.fn<(...args: unknown[]) => Promise<{ error: Error | null }>>(),
}))

vi.mock('phaser', () => ({
  default: {
    WEBGL: 2,
    Math: { Vector2: class { x = 0; y = 0 } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown', UPDATE: 'update' } },
    Display: { Masks: { GeometryMask: class { destroy = vi.fn() } } },
  },
}))
vi.mock('../../services/auth', () => ({
  authService: {
    isRegisteredAccount: () => account.registered,
    purchaseUpgrade: account.purchase,
    onAuthStateChange: (listener: () => void) => {
      account.authListeners.add(listener)
      return () => account.authListeners.delete(listener)
    },
  },
}))
vi.mock('../state/save', () => ({ loadSave: () => account.save }))
vi.mock('../events/gameBus', () => ({
  gameBus: {
    on: (_event: string, listener: () => void) => {
      account.saveListeners.add(listener)
      return () => account.saveListeners.delete(listener)
    },
  },
}))
vi.mock('../../ui/ResponsiveLayout', () => ({ readSafeArea: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
vi.mock('./BallAppearance', () => ({
  INK: 0x111625,
  ballLookFor: () => ({}),
  ballOutlineWidth: () => 2,
  drawBallFace: vi.fn(),
  restContour: (_look: unknown, r: number, cx: number, cy: number) => [
    { x: cx - r, y: cy },
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
    { x: cx, y: cy + r },
  ],
}))
vi.mock('./RoughArt', () => ({ bakeCanvas: vi.fn() }))
vi.mock('../../ui/Typography', () => ({
  hudText: (scene: { add: { text: (...args: unknown[]) => DisplayObject } }, x: number, y: number,
    value: string, _fontScale: number, options: { size: number }) => scene.add.text(x, y, value, { fontSize: Math.max(10, Math.round(options.size)) }),
}))
vi.mock('../../ui/DesignSystem', () => ({
  ChunkyButton: class {
    container: DisplayObject
    hit: DisplayObject
    options: Record<string, unknown>
    constructor(options: { scene: ButtonScene; x: number; y: number; w: number; h: number; label: string; onClick: () => void }) {
      this.options = options
      this.container = options.scene.add.container(options.x, options.y)
      this.container.data.buttonOptions = options
      this.hit = options.scene.add.zone(0, 0, options.w, options.h).setInteractive()
      this.hit.on('pointerup', () => {
        if (this.hit.input?.enabled) options.onClick()
      })
      this.container.add(this.hit)
    }
    setDisabled(disabled: boolean): void {
      this.hit.input!.enabled = !disabled
    }
  },
}))

import { StoreView } from './StoreView'

/** Scene-graph/input doubles keep these behavioral tests independent of WebGL. */
class DisplayObject extends EventEmitter {
  x = 0
  y = 0
  width = 100
  height = 20
  scale = 1
  scaleY = 1
  alpha = 1
  rotation = 0
  texture = ''
  fontSize = 16
  data: Record<string, unknown> = {}
  initialFontSize = 16
  drawCalls: { method: string; args: unknown[] }[] = []
  name = ''
  text = ''
  visible = true
  destroyed = false
  list: DisplayObject[] = []
  parent: DisplayObject | null = null
  input: { enabled: boolean } | null = null
  mask: { destroy: () => void } | null = null
  filters: { external: { addMask: Mock<() => { autoUpdate: boolean; active: boolean }>; remove: Mock } } | null = null

  get displayWidth(): number { return this.width * this.scale }
  get parentContainer(): DisplayObject | null { return this.parent }
  setName(name: string): this { this.name = name; return this }
  setX(x: number): this { this.x = x; return this }
  setY(y: number): this { this.y = y; return this }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this }
  setSize(width: number, height: number): this { this.width = width; this.height = height; return this }
  setDisplaySize(width: number, height: number): this { this.scale = width / this.width; this.scaleY = height / this.height; return this }
  setRotation(rotation: number): this { this.rotation = rotation; return this }
  setScale(scale: number, scaleY = scale): this { this.scale = scale; this.scaleY = scaleY; return this }
  setStroke(): this { return this }
  setPadding(): this { return this }
  setAlign(): this { return this }
  setShadow(): this { return this }
  setFontSize(size: number): this {
    this.fontSize = size
    const lines = this.text.split('\n')
    this.width = Math.ceil(Math.max(...lines.map((line) => line.length)) * size * 0.6) + 2
    this.height = lines.length * size * 1.2 + 2
    return this
  }
  setWordWrapWidth(width: number): this {
    this.height *= Math.ceil((this.width - 2) / width)
    this.width = Math.min(this.width, width + 2)
    return this
  }
  setVisible(visible: boolean): this { this.visible = visible; return this }
  setAlpha(alpha: number): this { this.alpha = alpha; return this }
  setInteractive(): this { this.input = { enabled: true }; return this }
  setMask(mask: { destroy: () => void }): this { this.mask = mask; return this }
  clearMask(destroy: boolean): this {
    if (destroy) this.mask?.destroy()
    this.mask = null
    return this
  }
  enableFilters(): this {
    this.filters = { external: { addMask: vi.fn(() => ({ autoUpdate: true, active: true })), remove: vi.fn() } }
    return this
  }
  add(children: DisplayObject | DisplayObject[]): this {
    for (const child of Array.isArray(children) ? children : [children]) {
      child.parent = this
      this.list.push(child)
    }
    return this
  }
  addAt(child: DisplayObject, index: number): this {
    child.parent = this
    this.list.splice(index, 0, child)
    return this
  }
  removeAll(destroy: boolean): this {
    const children = this.list.splice(0)
    for (const child of children) {
      child.parent = null
      if (destroy) child.destroy()
    }
    return this
  }
  destroy(): void {
    if (this.destroyed) return
    this.emit('destroy')
    this.destroyed = true
    this.removeAll(true)
    if (this.parent) this.parent.list = this.parent.list.filter((child) => child !== this)
    this.removeAllListeners()
  }
}

function makeScene(webgl = false) {
  const objects: DisplayObject[] = []
  const input = new EventEmitter()
  const events = new EventEmitter()
  const time = { now: 1_000 }
  let pendingTween: { targets: DisplayObject; startX: number; x: number; paused: boolean; onComplete: () => void } | null = null
  const scene = {
    add: {
      container: (x = 0, y = 0) => {
        const object = new DisplayObject().setX(x).setY(y)
        objects.push(object)
        return object
      },
      graphics: () => {
        const object = new DisplayObject()
        const proxy = new Proxy(object, {
          get(target, key, receiver) {
            if (key in target) return Reflect.get(target, key, receiver)
            return (...args: unknown[]) => {
              target.drawCalls.push({ method: String(key), args })
              return receiver
            }
          },
        })
        objects.push(proxy)
        return proxy
      },
      image: (x: number, y: number, texture: string) => {
        const object = new DisplayObject().setPosition(x, y).setSize(256, 256)
        object.texture = texture
        objects.push(object)
        return object
      },
      zone: (x: number, y: number, w: number, h: number) => {
        const object = new DisplayObject().setX(x).setY(y)
        object.width = w
        object.height = h
        objects.push(object)
        return object
      },
      text: (x: unknown, y: unknown, value: unknown, style: { fontSize: number }) => {
        const object = new DisplayObject().setPosition(Number(x), Number(y))
        object.text = String(value)
        object.initialFontSize = style.fontSize
        object.setFontSize(style.fontSize)
        objects.push(object)
        return object
      },
    },
    game: { renderer: { type: webgl ? 2 : 0 } },
    cameras: { main: { zoom: 1, getWorldPoint: (x: number, y: number, out: { x: number; y: number }) => { out.x = x; out.y = y; return out } } },
    tweens: {
      killTweensOf: vi.fn(() => { pendingTween = null }),
      add: vi.fn((config: { targets: DisplayObject; x: number; onComplete: () => void }) => {
        const tween = { ...config, startX: config.targets.x, paused: false }
        pendingTween = tween
        return {
          stop: vi.fn(() => { if (pendingTween === tween) pendingTween = null }),
          pause: vi.fn(() => { tween.paused = true }),
          resume: vi.fn(() => { tween.paused = false }),
        }
      }),
    },
    input,
    events,
    time,
  }
  return {
    scene, objects,
    advanceUpdates(milliseconds: number) {
      for (let remaining = milliseconds; remaining > 0; remaining -= 50) {
        const delta = Math.min(50, remaining)
        time.now += delta
        events.emit('update', time.now, delta)
      }
    },
    advanceTween(progress: number) {
      if (pendingTween && !pendingTween.paused) {
        pendingTween.targets.setX(pendingTween.startX + (pendingTween.x - pendingTween.startX) * progress)
      }
    },
    completeTween() {
      if (pendingTween?.paused) return
      const tween = pendingTween
      pendingTween = null
      if (tween) {
        tween.targets.setX(tween.x)
        tween.onComplete()
      }
    },
  }
}

function descendants(object: DisplayObject): DisplayObject[] {
  return object.list.flatMap((child) => [child, ...descendants(child)])
}

function find(root: DisplayObject, name: string): DisplayObject {
  const object = descendants(root).find((child) => child.name === name)
  if (!object) throw new Error(`Missing ${name}`)
  return object
}

function labels(root: DisplayObject): string[] {
  return descendants(root).map((object) => object.text).filter(Boolean)
}

function tap(zone: DisplayObject, x = 100, y = 200): void {
  if (!zone.input?.enabled) return
  const pointer = { id: 1, x, y, isDown: true }
  zone.emit('pointerdown', pointer)
  zone.emit('pointerup', { ...pointer, isDown: false })
}

const stores: StoreView[] = []
function createStore(vw = 1280, vh = 800, webgl = false) {
  const fixture = makeScene(webgl)
  const parent = new DisplayObject()
  const view = new StoreView(fixture.scene as unknown as Phaser.Scene, parent as unknown as Phaser.GameObjects.Container, vw, vh, 54)
  stores.push(view)
  return { ...fixture, parent, view }
}

beforeEach(() => {
  account.registered = true
  account.save = { coins: 100, upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 } }
  account.purchase.mockReset().mockResolvedValue({ error: null })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
})
afterEach(() => {
  for (const store of stores.splice(0)) store.destroy()
  account.authListeners.clear()
  account.saveListeners.clear()
  vi.unstubAllGlobals()
})

describe('merchant store', () => {
  it('lays out six desktop goods in three columns and two rows, with three locked previews', () => {
    const { parent } = createStore()
    const cards = find(parent, 'merchant-item-pages').list
    expect(cards).toHaveLength(6)
    expect(new Set(cards.map((card) => card.x)).size).toBe(3)
    expect(new Set(cards.map((card) => card.y)).size).toBe(2)
    expect(labels(parent)).toContain('100.0 COINS')
    for (const id of ['coinMagnet', 'mergeBonus', 'extraAbility']) {
      const card = find(parent, `merchant-upgrade-${id}`)
      expect(labels(card)).toContain('COMING SOON')
      expect(find(card, 'merchant-buy-hit').input?.enabled).toBe(false)
    }
  })

  it.each([[390, 844, 2, 2], [320, 844, 1, 3], [390, 500, 1, 3], [700, 600, 3, 1], [844, 390, 3, 1]])(
    'uses responsive columns and page counts at %i×%i', (vw, vh, columns, pages) => {
      const { parent } = createStore(vw, vh)
      const cards = find(parent, 'merchant-item-pages').list
      const firstPage = cards.slice(0, columns * 2)
      expect(new Set(firstPage.map((card) => card.x)).size).toBe(columns)
      expect(new Set(firstPage.map((card) => card.y)).size).toBe(2)
      const dotZones = descendants(parent).filter((object) => /^merchant-page-\d+$/.test(object.name))
      expect(dotZones).toHaveLength(pages === 1 ? 0 : pages)
    },
  )

  it('keeps maximum-effect and stage labels separate in compact landscape cards', () => {
    const { parent } = createStore(844, 390)
    const wall = find(parent, 'merchant-upgrade-wallDuration')
    const maximum = descendants(wall).find((object) => object.text === 'MAX EFFECT 25s')!
    const stage = descendants(wall).find((object) => object.text === 'STAGE 0 / 10')!
    expect(stage.y - maximum.y).toBeGreaterThan(9)
  })

  it('fits constrained titles by changing font size while leaving the text bitmap at unit scale', () => {
    const { parent } = createStore(390, 844)
    const title = descendants(find(parent, 'merchant-upgrade-shakeIntensity')).find((object) => object.text === 'Shake\nIntensity')!
    expect(title.fontSize).toBeLessThan(title.initialFontSize)
    expect(title.fontSize).toBeGreaterThanOrEqual(8)
    for (const text of descendants(parent).filter((object) => object.text)) expect(text.scale).toBe(1)
  })

  it('runs one staggered entrance clock without flashing, replaying on saves, or floating card text', () => {
    const { parent, scene, advanceUpdates } = createStore()
    const first = find(parent, 'merchant-upgrade-wallDuration')
    const second = find(parent, 'merchant-upgrade-shakeDuration')
    expect(first.alpha).toBe(0)
    expect(second.alpha).toBe(0)
    advanceUpdates(25)
    expect(first.alpha).toBeGreaterThan(0)
    expect(second.alpha).toBe(0)
    advanceUpdates(75)
    const alpha = first.alpha
    const y = first.y
    for (const listener of account.saveListeners) listener()
    const refreshed = find(parent, 'merchant-upgrade-wallDuration')
    expect(refreshed.alpha).toBeCloseTo(alpha)
    expect(refreshed.y).toBe(y)
    advanceUpdates(1000)
    expect(refreshed.alpha).toBe(1)
    const restingY = refreshed.y
    const art = find(refreshed, 'merchant-upgrade-art-wallDuration')
    const artY = art.y
    advanceUpdates(250)
    expect(refreshed.y).toBe(restingY)
    expect(refreshed.scale).toBe(1)
    expect(art.y).not.toBe(artY)
    for (const listener of account.saveListeners) listener()
    expect(find(parent, 'merchant-upgrade-wallDuration').alpha).toBe(1)
    expect(scene.tweens.add).not.toHaveBeenCalled()
  })

  it('lifts the whole desktop card with a warm border and deeper shadow, and depresses its buy button', () => {
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query.includes('(hover: hover)') }) })
    const { parent, advanceUpdates } = createStore()
    advanceUpdates(1000)
    const card = find(parent, 'merchant-upgrade-wallDuration')
    const baseY = card.y
    const button = find(card, 'merchant-buy-wallDuration')
    const buttonY = button.y
    const hover = find(card, 'merchant-card-hover-hit')
    expect(hover.input?.enabled).toBe(true)
    hover.emit('pointerover')
    advanceUpdates(100)
    expect(card.y).toBeLessThan(baseY)
    expect(card.scale).toBe(1)
    expect(find(card, 'merchant-card-hover-border').alpha).toBeGreaterThan(0)
    expect(find(card, 'merchant-card-hover-shadow').alpha).toBeGreaterThan(0)
    const buy = find(card, 'merchant-buy-hit')
    buy.emit('pointerdown', { id: 1, x: 100, y: 200 })
    advanceUpdates(50)
    expect(button.y).toBeGreaterThan(buttonY)
    expect(button.scaleY).toBeLessThan(1)
    buy.emit('pointerout')
    hover.emit('pointerout')
    advanceUpdates(1000)
    expect(card.y).toBe(baseY)
    expect(button.y).toBe(buttonY)
    expect(button.scale).toBe(1)
    expect(account.purchase).not.toHaveBeenCalled()
  })

  it('reuses light sprites and static stall art while swinging lanterns beneath an unobscured sign', () => {
    const { parent, objects, advanceUpdates } = createStore()
    const store = find(parent, 'merchant-store')
    const sign = find(parent, 'merchant-stall-sign')
    const canopy = find(parent, 'merchant-canopy-anim')
    expect(store.list.indexOf(sign)).toBeGreaterThan(store.list.indexOf(canopy))
    expect(find(sign, 'merchant-sign-backing').drawCalls.length).toBeGreaterThan(0)
    const lights = objects.filter((object) => object.texture)
    expect(lights).toHaveLength(6)
    expect(new Set(lights.map((light) => light.texture)).size).toBe(1)
    const frame = find(parent, 'merchant-stall')
    const lantern = find(parent, 'merchant-lantern-1')
    const housing = lantern.list[0]!
    const objectCount = objects.length
    const staticCommands = frame.drawCalls.length + housing.drawCalls.length
    const rotation = lantern.rotation
    const intensity = lights[0]!.alpha
    advanceUpdates(250)
    expect(objects).toHaveLength(objectCount)
    expect(frame.drawCalls.length + housing.drawCalls.length).toBe(staticCommands)
    expect(lantern.rotation).not.toBe(rotation)
    expect(lights[0]!.alpha).not.toBe(intensity)
    const title = descendants(sign).find((object) => object.text === 'STORE')!
    expect(title.x).toBe(Math.round(1280 * 0.5))
    const prev = find(parent, 'merchant-prev')
    expect(prev.alpha).toBe(1)
    expect(prev.data.buttonOptions).toMatchObject({
      disabledFill: 0x181b24,
      disabledShadowColor: 0x090b10,
      disabledHighlightColor: 0x3b4254,
      disabledKeepOpaque: true,
    })
  })

  it('reads current, next and maximum effects and prices from persisted catalog levels', () => {
    account.save.upgrades.wallDuration = 4
    account.save.upgrades.shakeDuration = 10
    account.save.coins = 49
    const { parent } = createStore()
    const wall = find(parent, 'merchant-upgrade-wallDuration')
    expect(labels(wall)).toContain('19s → 20s')
    expect(labels(wall)).toContain('MAX EFFECT 25s')
    expect(labels(wall)).toContain('STAGE 4 / 10')
    expect(labels(wall)).toContain('50')
    expect(find(wall, 'merchant-buy-hit').input?.enabled).toBe(true)
    tap(find(wall, 'merchant-buy-hit'))
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('NOT ENOUGH COINS')
    expect(account.purchase).not.toHaveBeenCalled()
    expect(labels(find(parent, 'merchant-upgrade-shakeDuration'))).toContain('MAXED')
    expect(find(find(parent, 'merchant-upgrade-shakeDuration'), 'merchant-buy-hit').input?.enabled).toBe(false)
  })

  it('lets guests browse every page without enabling a purchase or hiding the coin balance', () => {
    account.registered = false
    account.save.coins = 0
    const { parent, completeTween } = createStore(390, 844)
    expect(labels(parent)).toContain('0.0 COINS')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('ACCOUNTS ONLY')
    for (const object of descendants(parent).filter((child) => child.name === 'merchant-buy-hit')) expect(object.input?.enabled).toBe(false)
    tap(find(parent, 'merchant-next').list[0]!)
    completeTween()
    expect(find(parent, 'merchant-item-pages').x).toBeLessThan(0)
    expect(account.purchase).not.toHaveBeenCalled()
  })

  it('purchases through auth, shows pending status, and refreshes wallet and stages from save events', async () => {
    const { parent } = createStore()
    tap(find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit'))
    expect(account.purchase).toHaveBeenCalledExactlyOnceWith('wallDuration')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('BUYING...')
    tap(find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit'))
    expect(account.purchase).toHaveBeenCalledTimes(1)
    account.save.coins = 90
    account.save.upgrades.wallDuration = 1
    for (const listener of account.saveListeners) listener()
    await Promise.resolve()
    expect(labels(parent)).toContain('90.0 COINS')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('STAGE 1 / 10')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('PURCHASED!')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('20')
  })

  it('surfaces a rejected server purchase without changing persisted progress', async () => {
    account.purchase.mockResolvedValue({ error: new Error('Coin balance changed') })
    const { parent } = createStore()
    tap(find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit'))
    await Promise.resolve()
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('Coin balance changed')
    expect(labels(parent)).toContain('100.0 COINS')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('STAGE 0 / 10')
  })

  it('anchors purchase celebrations to the purchased card on a later page', async () => {
    const { parent, completeTween } = createStore(320, 844)
    tap(find(parent, 'merchant-next').list[0]!)
    completeTween()
    const pages = find(parent, 'merchant-item-pages')
    const card = find(parent, 'merchant-upgrade-shakeIntensity')
    const expectedX = card.x + pages.x
    const expectedY = card.y
    tap(find(card, 'merchant-buy-hit'))
    await Promise.resolve()
    const particle = find(parent, 'merchant-celebration').drawCalls.find((call) => call.method === 'fillCircle')!
    expect(particle.args[0]).toBeCloseTo(expectedX)
    expect(particle.args[1]).toBeCloseTo(expectedY)
  })

  it('slides only product pages, snaps after a swipe, and prevents drag-to-purchase', () => {
    const { parent, scene, completeTween } = createStore(320, 844)
    const viewport = find(parent, 'merchant-items')
    const pages = find(parent, 'merchant-item-pages')
    const frame = find(parent, 'merchant-stall')
    const zone = find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit')
    const startX = viewport.x + 150
    const startY = viewport.y + 130
    const down = { id: 1, x: startX, y: startY, isDown: true }
    zone.emit('pointerdown', down)
    scene.input.emit('pointerdown', down)
    scene.time.now += 25
    const moved = { ...down, x: startX - 100 }
    scene.input.emit('pointermove', moved)
    expect(pages.x).toBeLessThan(0)
    expect(frame.x).toBe(0)
    expect(viewport.x).toBeGreaterThan(0)
    zone.emit('pointerup', { ...moved, isDown: false })
    scene.input.emit('pointerup', { ...moved, isDown: false })
    expect(account.purchase).not.toHaveBeenCalled()
    expect(scene.tweens.add).toHaveBeenCalled()
    completeTween()
    expect(pages.x).toBeLessThan(-100)
    expect(find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit').input?.enabled).toBe(false)
    expect(find(find(parent, 'merchant-upgrade-shakeIntensity'), 'merchant-buy-hit').input?.enabled).toBe(true)
  })

  it('snaps short drags back and respects first/last page bounds', () => {
    const { parent, scene, completeTween } = createStore(320, 844)
    const viewport = find(parent, 'merchant-items')
    const pages = find(parent, 'merchant-item-pages')
    const down = { id: 1, x: viewport.x + 100, y: viewport.y + 50, isDown: true }
    scene.input.emit('pointerdown', down)
    scene.time.now += 500
    const moved = { ...down, x: down.x - 15 }
    scene.input.emit('pointermove', moved)
    scene.time.now += 200
    scene.input.emit('pointerup', { ...moved, isDown: false })
    completeTween()
    expect(pages.x).toBeCloseTo(0)
    tap(find(parent, 'merchant-prev').list[0]!)
    expect(pages.x).toBeCloseTo(0)
    tap(find(parent, 'merchant-page-3'))
    completeTween()
    const lastPageX = pages.x
    tap(find(parent, 'merchant-next').list[0]!)
    expect(pages.x).toBe(lastPageX)
  })

  it.each([false, true])('cleans input, state subscriptions, masks and tweens on destroy (WebGL=%s)', async (webgl) => {
    const { parent, scene, view, objects } = createStore(390, 844, webgl)
    const viewport = find(parent, 'merchant-items')
    const mask = objects.find((object) => object.name === 'merchant-item-mask')!
    const geometryMask = viewport.mask
    const filters = viewport.filters
    tap(find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit'))
    tap(find(parent, 'merchant-next').list[0]!)
    const objectCount = objects.length
    view.destroy()
    view.destroy()
    await Promise.resolve()
    expect(objects).toHaveLength(objectCount)
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'gameout']) expect(scene.input.listenerCount(event)).toBe(0)
    expect(scene.events.listenerCount('shutdown')).toBe(0)
    expect(account.authListeners.size).toBe(0)
    expect(account.saveListeners.size).toBe(0)
    expect(scene.tweens.killTweensOf).toHaveBeenCalled()
    expect(mask.destroyed).toBe(true)
    expect(scene.events.listenerCount('update')).toBe(0)
    if (webgl) expect(filters!.external.remove).toHaveBeenCalledWith(expect.anything(), true)
    else expect(geometryMask!.destroy).toHaveBeenCalledExactlyOnceWith()
  })

  it('also releases resources when the parent scene graph destroys the store', () => {
    const { parent, scene, objects } = createStore()
    find(parent, 'merchant-store').destroy()
    expect(account.authListeners.size).toBe(0)
    expect(account.saveListeners.size).toBe(0)
    expect(scene.input.listenerCount('pointerdown')).toBe(0)
    expect(objects.find((object) => object.name === 'merchant-item-mask')?.destroyed).toBe(true)
  })

  it('invalidates a pending purchase after an account change', async () => {
    const { parent } = createStore()
    tap(find(find(parent, 'merchant-upgrade-wallDuration'), 'merchant-buy-hit'))
    account.registered = false
    for (const listener of account.authListeners) listener()
    await Promise.resolve()
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('ACCOUNTS ONLY')
    expect(labels(parent)).not.toContain('PURCHASED!')
    expect(find(parent, 'merchant-celebration').drawCalls.some((call) => call.method === 'fillCircle')).toBe(false)
  })

  it('snaps reduced-motion pages, skips decorative animation, and releases listeners on shutdown', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const { parent, scene, advanceUpdates } = createStore(390, 844, true)
    const viewport = find(parent, 'merchant-items')
    const card = find(parent, 'merchant-upgrade-wallDuration')
    expect(card.alpha).toBe(1)
    expect(find(parent, 'merchant-lantern-1').rotation).toBe(0)
    tap(find(card, 'merchant-buy-hit'))
    await Promise.resolve()
    const canopy = find(parent, 'merchant-canopy-anim')
    const environmentCommands = canopy.drawCalls.length
    advanceUpdates(1000)
    expect(canopy.drawCalls).toHaveLength(environmentCommands)
    expect(find(parent, 'merchant-upgrade-art-wallDuration').y).toBe(0)
    expect(find(parent, 'merchant-celebration').drawCalls.some((call) => call.method === 'fillCircle')).toBe(false)
    tap(find(parent, 'merchant-next').list[0]!)
    expect(find(parent, 'merchant-item-pages').x).toBeLessThan(0)
    expect(scene.tweens.add).not.toHaveBeenCalled()
    expect(viewport.filters!.external.addMask.mock.results[0]!.value.active).toBe(false)
    const dots = find(parent, 'merchant-page-dots')
    const dotCommands = dots.drawCalls.length
    advanceUpdates(1000)
    expect(dots.drawCalls).toHaveLength(dotCommands)
    scene.events.emit('shutdown')
    expect(account.saveListeners.size).toBe(0)
    expect(scene.input.listenerCount('pointermove')).toBe(0)
    expect(scene.events.listenerCount('update')).toBe(0)
  })

  it.each(['ancestor', 'document'])('pauses page motion and decorative clocks while a %s is hidden', (hiddenBy) => {
    const { parent, scene, advanceUpdates, advanceTween } = createStore(320, 844, true)
    advanceUpdates(50)
    tap(find(parent, 'merchant-next').list[0]!)
    advanceTween(0.35)
    advanceUpdates(50)
    const pages = find(parent, 'merchant-item-pages')
    const card = find(parent, 'merchant-upgrade-wallDuration')
    const canopy = find(parent, 'merchant-canopy-anim')
    const x = pages.x
    const y = card.y
    const commands = canopy.drawCalls.length
    if (hiddenBy === 'ancestor') parent.setVisible(false)
    else vi.stubGlobal('document', { hidden: true })
    advanceUpdates(1000)
    const viewport = find(parent, 'merchant-items')
    const killedTweens = scene.tweens.killTweensOf.mock.calls.length
    scene.input.emit('pointerdown', { id: 1, x: viewport.x + 100, y: viewport.y + 80, isDown: true })
    expect(scene.tweens.killTweensOf).toHaveBeenCalledTimes(killedTweens)
    advanceTween(0.8)
    expect(pages.x).toBe(x)
    expect(card.y).toBe(y)
    expect(canopy.drawCalls).toHaveLength(commands)
    expect(scene.tweens.add.mock.results[0]!.value.pause).toHaveBeenCalledTimes(1)
    if (hiddenBy === 'ancestor') parent.setVisible(true)
    else vi.stubGlobal('document', { hidden: false })
    advanceUpdates(50)
    advanceTween(0.6)
    expect(pages.x).not.toBe(x)
    expect(canopy.drawCalls.length).toBeGreaterThan(commands)
    expect(scene.tweens.add.mock.results[0]!.value.resume).toHaveBeenCalledTimes(1)
  })

  it('animates page-dot progress without resetting it when a save rebuilds the navigation', () => {
    const { parent, advanceUpdates, advanceTween } = createStore(390, 844)
    tap(find(parent, 'merchant-next').list[0]!)
    advanceTween(0.5)
    advanceUpdates(50)
    const dots = find(parent, 'merchant-page-dots')
    const widths = dots.drawCalls.filter((call) => call.method === 'fillRoundedRect').slice(-2).map((call) => call.args[2])
    expect(widths).toHaveLength(2)
    expect(Number(widths[0])).toBeLessThan(15)
    expect(Number(widths[1])).toBeLessThan(15)
    for (const listener of account.saveListeners) listener()
    const refreshed = find(parent, 'merchant-page-dots')
    expect(refreshed.drawCalls.filter((call) => call.method === 'fillRoundedRect').map((call) => call.args[2])).toEqual(widths)
  })

  it('shows both pages and activates the WebGL mask throughout a page slide', () => {
    const { parent, completeTween } = createStore(390, 844, true)
    const mask = find(parent, 'merchant-items').filters!.external.addMask.mock.results[0]!.value
    const page1Card = find(parent, 'merchant-upgrade-wallDuration')
    const page2Card = find(parent, 'merchant-upgrade-mergeBonus')
    expect(page1Card.visible).toBe(true)
    expect(page2Card.visible).toBe(false)
    expect(mask.active).toBe(false)
    tap(find(parent, 'merchant-next').list[0]!)
    expect(page1Card.visible).toBe(true)
    expect(page2Card.visible).toBe(true)
    expect(mask.active).toBe(true)
    completeTween()
    expect(page1Card.visible).toBe(false)
    expect(page2Card.visible).toBe(true)
    expect(mask.active).toBe(false)
  })

  it('retains clipping and disables purchases when a pointer interrupts a partially completed slide', () => {
    const { parent, scene, advanceTween, completeTween } = createStore(320, 844, true)
    const viewport = find(parent, 'merchant-items')
    const mask = viewport.filters!.external.addMask.mock.results[0]!.value
    tap(find(parent, 'merchant-next').list[0]!)
    advanceTween(0.4)
    const down = { id: 1, x: viewport.x + 100, y: viewport.y + 80, isDown: true }
    scene.input.emit('pointerdown', down)
    expect(mask.active).toBe(true)
    expect(find(parent, 'merchant-upgrade-wallDuration').visible).toBe(true)
    expect(find(parent, 'merchant-upgrade-shakeIntensity').visible).toBe(true)
    for (const hit of descendants(parent).filter((object) => object.name === 'merchant-buy-hit')) expect(hit.input?.enabled).toBe(false)
    scene.input.emit('pointerup', { ...down, isDown: false })
    expect(mask.active).toBe(true)
    completeTween()
    expect(mask.active).toBe(false)
    expect(find(parent, 'merchant-upgrade-wallDuration').visible).toBe(false)
    expect(find(find(parent, 'merchant-upgrade-shakeIntensity'), 'merchant-buy-hit').input?.enabled).toBe(true)
  })
})
