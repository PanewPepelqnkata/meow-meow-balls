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
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
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
vi.mock('./BallAppearance', () => ({ INK: 0x111625 }))
vi.mock('../../ui/Typography', () => ({
  hudText: (scene: { add: { text: (...args: unknown[]) => DisplayObject } }, x: number, y: number, value: string) => scene.add.text(x, y, value),
}))
vi.mock('../../ui/DesignSystem', () => ({
  ChunkyButton: class {
    container: DisplayObject
    hit: DisplayObject
    constructor(options: { scene: ButtonScene; x: number; y: number; w: number; h: number; label: string; onClick: () => void }) {
      this.container = options.scene.add.container(options.x, options.y)
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
  name = ''
  text = ''
  visible = true
  destroyed = false
  list: DisplayObject[] = []
  parent: DisplayObject | null = null
  input: { enabled: boolean } | null = null
  mask: { destroy: () => void } | null = null
  filters: { external: { addMask: Mock<() => { autoUpdate: boolean }>; remove: Mock } } | null = null

  get displayWidth(): number { return this.width * this.scale }
  setName(name: string): this { this.name = name; return this }
  setX(x: number): this { this.x = x; return this }
  setY(y: number): this { this.y = y; return this }
  setScale(scale: number): this { this.scale = scale; return this }
  setStroke(): this { return this }
  setAlign(): this { return this }
  setShadow(): this { return this }
  setVisible(visible: boolean): this { this.visible = visible; return this }
  setAlpha(): this { return this }
  setInteractive(): this { this.input = { enabled: true }; return this }
  setMask(mask: { destroy: () => void }): this { this.mask = mask; return this }
  clearMask(destroy: boolean): this {
    if (destroy) this.mask?.destroy()
    this.mask = null
    return this
  }
  enableFilters(): this {
    this.filters = { external: { addMask: vi.fn(() => ({ autoUpdate: true })), remove: vi.fn() } }
    return this
  }
  add(children: DisplayObject | DisplayObject[]): this {
    for (const child of Array.isArray(children) ? children : [children]) {
      child.parent = this
      this.list.push(child)
    }
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
  let pendingTween: { targets: DisplayObject; x: number; onComplete: () => void } | null = null
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
            return () => receiver
          },
        })
        objects.push(proxy)
        return proxy
      },
      zone: (x: number, y: number, w: number, h: number) => {
        const object = new DisplayObject().setX(x).setY(y)
        object.width = w
        object.height = h
        objects.push(object)
        return object
      },
      text: (x: unknown, y: unknown, value: unknown) => {
        const object = new DisplayObject().setX(Number(x)).setY(Number(y))
        object.text = String(value)
        object.width = Math.max(...object.text.split('\n').map((line) => line.length)) * 8
        objects.push(object)
        return object
      },
    },
    game: { renderer: { type: webgl ? 2 : 0 } },
    cameras: { main: { zoom: 1, getWorldPoint: (x: number, y: number, out: { x: number; y: number }) => { out.x = x; out.y = y; return out } } },
    tweens: {
      killTweensOf: vi.fn(() => { pendingTween = null }),
      add: vi.fn((config: { targets: DisplayObject; x: number; onComplete: () => void }) => {
        pendingTween = config
        return { stop: vi.fn() }
      }),
    },
    input,
    events,
    time,
  }
  return {
    scene, objects,
    completeTween() {
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
  it('shows six illustrated goods in a desktop 3×2 grid, including three locked previews', () => {
    const { parent } = createStore()
    const cards = find(parent, 'merchant-item-pages').list
    expect(cards).toHaveLength(6)
    expect(new Set(cards.map((card) => card.x)).size).toBe(3)
    expect(new Set(cards.map((card) => card.y)).size).toBe(2)
    expect(labels(parent)).toContain('STORE')
    expect(labels(parent)).toContain('UPGRADES • BOOSTS • ITEMS')
    expect(labels(parent)).toContain('COINS 100.0')
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

  it('reads current, next and maximum effects and prices from persisted catalog levels', () => {
    account.save.upgrades.wallDuration = 4
    account.save.upgrades.shakeDuration = 10
    account.save.coins = 49
    const { parent } = createStore()
    const wall = find(parent, 'merchant-upgrade-wallDuration')
    expect(labels(wall)).toContain('19s → 20s')
    expect(labels(wall)).toContain('MAX EFFECT 25s')
    expect(labels(wall)).toContain('STAGE 4 / 10')
    expect(labels(wall)).toContain('NEED 50')
    expect(find(wall, 'merchant-buy-hit').input?.enabled).toBe(false)
    expect(labels(find(parent, 'merchant-upgrade-shakeDuration'))).toContain('MAXED')
    expect(find(find(parent, 'merchant-upgrade-shakeDuration'), 'merchant-buy-hit').input?.enabled).toBe(false)
  })

  it('lets guests browse every page without enabling a purchase or hiding the coin balance', () => {
    account.registered = false
    account.save.coins = 0
    const { parent, completeTween } = createStore(390, 844)
    expect(labels(parent)).toContain('COINS 0.0')
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
    expect(labels(parent)).toContain('COINS 90.0')
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
    expect(labels(parent)).toContain('COINS 100.0')
    expect(labels(find(parent, 'merchant-upgrade-wallDuration'))).toContain('STAGE 0 / 10')
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
  })

  it('supports reduced-motion paging and scene shutdown cleanup', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const { parent, scene } = createStore(390, 844)
    tap(find(parent, 'merchant-next').list[0]!)
    expect(find(parent, 'merchant-item-pages').x).toBeLessThan(0)
    expect(scene.tweens.add).not.toHaveBeenCalled()
    scene.events.emit('shutdown')
    expect(account.saveListeners.size).toBe(0)
    expect(scene.input.listenerCount('pointermove')).toBe(0)
  })
})
