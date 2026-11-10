import EventEmitter from 'eventemitter3'
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } } } }))
vi.mock('./Typography', () => ({ hudText: vi.fn() }))
vi.mock('./LucideIcon', () => ({ drawLucide: vi.fn() }))
vi.mock('./ResponsiveLayout', () => ({ readSafeArea: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
vi.mock('../game/audio/AudioDirector', () => ({ AudioDirector: { uiHover: vi.fn(), uiClick: vi.fn(), uiToggle: vi.fn() } }))

import { ChunkyButton } from './DesignSystem'

class HitZone extends EventEmitter {
  input = { enabled: true, cursor: 'pointer' }
  setInteractive(): this { return this }
}

function makeButton(onClick: () => void) {
  const hit = new HitZone()
  const graphics = {
    clear: vi.fn().mockReturnThis(), fillStyle: vi.fn().mockReturnThis(), fillRoundedRect: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(), strokeRoundedRect: vi.fn().mockReturnThis(),
  }
  const container = { add: vi.fn(), destroy: vi.fn() }
  const scene = { add: { container: () => container, graphics: () => graphics, zone: () => hit } }
  new ChunkyButton({ scene: scene as never, x: 20, y: 20, w: 100, h: 40, onClick })
  return hit
}

describe('ChunkyButton pointer release', () => {
  it('activates once when pointerout precedes release on the pressed hit zone', () => {
    const onClick = vi.fn()
    const hit = makeButton(onClick)
    const pointer = { id: 1 }
    hit.emit('pointerdown', pointer)
    hit.emit('pointerout', pointer)
    hit.emit('pointerup', pointer)
    hit.emit('pointerup', pointer)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('cancels a release outside without activating', () => {
    const onClick = vi.fn()
    const hit = makeButton(onClick)
    const pointer = { id: 2 }
    hit.emit('pointerdown', pointer)
    hit.emit('pointerout', pointer)
    hit.emit('pointerupoutside', pointer)
    expect(onClick).not.toHaveBeenCalled()
  })
})
