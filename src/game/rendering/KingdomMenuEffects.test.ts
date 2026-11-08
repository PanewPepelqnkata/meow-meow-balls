import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { resolveKingdomMenuLayout } from '../../ui/KingdomMenuLayout'

vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 } } }))
vi.mock('./RoughArt', () => ({ bakeCanvas: vi.fn() }))

import { KingdomMenuEffects } from './KingdomMenuEffects'
import { bakeCanvas } from './RoughArt'

class DisplayObject {
  x = 0
  y = 0
  width = 0
  height = 0
  alpha = 1
  rotation = 0
  name = ''
  destroyed = false
  list: DisplayObject[] = []
  calls: Array<{ method: string; args: unknown[] }> = []
  parent: DisplayObject | null = null
  setName(name: string): this { this.name = name; return this }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this }
  setDisplaySize(width: number, height: number): this { this.width = width; this.height = height; return this }
  setAlpha(alpha: number): this { this.alpha = alpha; return this }
  setRotation(rotation: number): this { this.rotation = rotation; return this }
  setBlendMode(): this { return this }
  add(children: DisplayObject | DisplayObject[]): this {
    for (const child of Array.isArray(children) ? children : [children]) {
      child.parent = this
      this.list.push(child)
    }
    return this
  }
  removeAll(destroy: boolean): this {
    for (const child of this.list.splice(0)) {
      child.parent = null
      if (destroy) child.destroy()
    }
    return this
  }
  destroy(): void {
    this.destroyed = true
    this.removeAll(true)
    if (this.parent) this.parent.list = this.parent.list.filter((child) => child !== this)
    this.parent = null
  }
}

function makeScene() {
  const objects: DisplayObject[] = []
  const scene = {
    textures: { exists: () => true },
    add: {
      container(x: number, y: number, children: DisplayObject[] = []) {
        const object = new DisplayObject().setPosition(x, y).add(children)
        objects.push(object)
        return object
      },
      image(x: number, y: number) {
        const object = new DisplayObject().setPosition(x, y)
        objects.push(object)
        return object
      },
      graphics() {
        const object = new DisplayObject()
        const proxy = new Proxy(object, {
          get(target, key, receiver) {
            if (key in target) return Reflect.get(target, key, receiver)
            return (...args: unknown[]) => {
              if (key === 'clear') target.calls.length = 0
              else target.calls.push({ method: String(key), args })
              return receiver
            }
          },
        })
        objects.push(proxy)
        return proxy
      },
    },
  }
  return { scene: scene as unknown as Phaser.Scene, objects }
}

const layout = resolveKingdomMenuLayout(390, 844, { top: 0, left: 0, bottom: 0, right: 0 }, false)

describe('Throne vault atmosphere', () => {
  it('animates chandelier swing, layered flames, banners, beams and dust without rebaking', () => {
    const { scene, objects } = makeScene()
    const effects = new KingdomMenuEffects(scene, false)
    effects.build(layout)
    const chandelier = objects.find((object) => object.name === 'throne-chandelier-0')!
    const flame = objects.find((object) => object.name === 'throne-chandelier-flames-0')!
    const initialRotation = chandelier.rotation
    const initialAlpha = (effects.surface as unknown as DisplayObject).list[0]!.alpha
    const initialBanners = JSON.stringify((effects.banners as unknown as DisplayObject).calls)
    const objectCount = objects.length
    effects.update(1.2)
    expect(chandelier.rotation).not.toBe(initialRotation)
    expect(Math.abs(chandelier.rotation)).toBeLessThan(0.02)
    expect((effects.surface as unknown as DisplayObject).list[0]!.alpha).not.toBe(initialAlpha)
    expect(flame.calls.filter((call) => call.method === 'fillTriangle')).toHaveLength(12)
    expect(JSON.stringify((effects.banners as unknown as DisplayObject).calls)).not.toBe(initialBanners)
    expect((effects.particles as unknown as DisplayObject).calls.filter((call) => call.method === 'fillCircle').length).toBeGreaterThanOrEqual(30)
    expect(objects).toHaveLength(objectCount)
    expect(bakeCanvas).not.toHaveBeenCalled()
    effects.destroy()
    expect(objects.every((object) => object.destroyed)).toBe(true)
  })

  it('keeps reduced-motion artwork still and omits drifting particles', () => {
    const { scene, objects } = makeScene()
    const effects = new KingdomMenuEffects(scene, true)
    effects.build(layout)
    const chandelier = objects.find((object) => object.name === 'throne-chandelier-0')!
    const initial = { rotation: chandelier.rotation, banners: JSON.stringify((effects.banners as unknown as DisplayObject).calls) }
    effects.update(900)
    expect(chandelier.rotation).toBe(initial.rotation)
    expect(JSON.stringify((effects.banners as unknown as DisplayObject).calls)).toBe(initial.banners)
    expect((effects.particles as unknown as DisplayObject).calls).toEqual([])
    effects.destroy()
  })

  it('rebuilds two chandeliers and clears every old rig on resize', () => {
    const { scene, objects } = makeScene()
    const effects = new KingdomMenuEffects(scene, false)
    effects.build(layout)
    const oldChandeliers = objects.filter((object) => /^throne-chandelier-\d$/.test(object.name))
    effects.build(resolveKingdomMenuLayout(1280, 800, { top: 0, left: 0, bottom: 0, right: 0 }, true))
    expect(oldChandeliers.every((object) => object.destroyed)).toBe(true)
    expect(objects.filter((object) => /^throne-chandelier-\d$/.test(object.name) && !object.destroyed)).toHaveLength(2)
    effects.clear()
    expect((effects.surface as unknown as DisplayObject).list).toHaveLength(0)
    expect((effects.ambient as unknown as DisplayObject).list).toHaveLength(0)
    effects.destroy()
  })
})
