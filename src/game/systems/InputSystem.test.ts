import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'

vi.mock('phaser', () => ({
  default: {
    Input: { Events: { POINTER_MOVE: 'pointermove', POINTER_UP: 'pointerup', POINTER_UP_OUTSIDE: 'pointerupoutside' } },
  },
}))

import { InputController } from './InputSystem'

function inputHarness() {
  let activeMs = 0
  let overUi = false
  const drops: Array<{ x: number }> = []
  const events = new EventEmitter()
  const scene = { input: events } as unknown as Phaser.Scene
  const input = new InputController({
    stageWidth: 720,
    stageHeight: 1280,
    interior: { x: 100, width: 500 },
    maxRadius: 30,
    cooldownMs: 1000,
    now: () => activeMs,
    toStage: (pointer) => overUi ? null : { x: pointer.x, y: pointer.y },
    onDrop: (target) => drops.push(target),
  })
  input.attach(scene)
  return {
    input,
    drops,
    release: (x = 300) => events.emit('pointerup', { x, y: 600 }),
    at: (ms: number) => { activeMs = ms },
    block: (blocked: boolean) => { overUi = blocked },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('gameplay input while menus own the pointer', () => {
  it('does not drop or consume the cooldown on a UI release', () => {
    const h = inputHarness()
    h.block(true)
    h.release(450)
    expect(h.drops).toEqual([])
    h.block(false)
    h.release(300)
    expect(h.drops).toEqual([{ x: 300 }])
  })

  it('keeps the remaining cooldown across a pause and resumes at its exact boundary', () => {
    const wallTime = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    const h = inputHarness()
    h.release()
    h.at(300)
    h.input.setEnabled(false)
    wallTime.mockReturnValue(70_000)
    h.release(400)
    expect(h.input.cooldownRemainingMs()).toBe(700)
    expect(h.drops).toEqual([{ x: 300 }])
    h.input.setEnabled(true)
    h.at(999)
    h.release(400)
    expect(h.drops).toEqual([{ x: 300 }])
    h.at(1000)
    h.release(400)
    expect(h.drops).toEqual([{ x: 300 }, { x: 400 }])
    expect(h.input.cooldownRemainingMs()).toBe(1000)
  })

  it('starts a fresh cooldown on restart without enabling a menu-gated controller', () => {
    const h = inputHarness()
    h.release(450)
    h.at(50)
    h.input.setEnabled(false)
    h.input.reset()
    h.release(300)
    expect(h.drops).toEqual([{ x: 450 }])
    h.input.setEnabled(true)
    h.release(300)
    expect(h.drops).toEqual([{ x: 450 }, { x: 300 }])
  })
})
