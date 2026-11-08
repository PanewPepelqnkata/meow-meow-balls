import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshSave } from '../game/state/save'
import { resolveKingdomMenuLayout } from '../ui/KingdomMenuLayout'
import { kingdomMenuBridge, kingdomStatsFromSave } from './kingdomMenuBridge'

let disconnect: (() => void) | undefined

afterEach(() => {
  disconnect?.()
  disconnect = undefined
})

describe('React home scene bridge', () => {
  it('retains state before React subscribes and gates actions while hidden', () => {
    const route = vi.fn()
    disconnect = kingdomMenuBridge.connect(route)
    const layout = resolveKingdomMenuLayout(390, 844, { top: 0, bottom: 0, left: 0, right: 0 }, false)
    kingdomMenuBridge.publish({ visible: true, layout, artwork: null, stats: { best: 12, coins: 3.4, discovered: 1, total: 40 }, accountName: null })
    const listener = vi.fn()
    const unsubscribe = kingdomMenuBridge.subscribe(listener)
    expect(kingdomMenuBridge.getSnapshot().stats.best).toBe(12)
    kingdomMenuBridge.navigate('play')
    expect(route).toHaveBeenCalledWith('play')
    kingdomMenuBridge.navigate('account')
    expect(route).toHaveBeenCalledTimes(1)
    kingdomMenuBridge.publish({ ...kingdomMenuBridge.getSnapshot(), visible: false })
    kingdomMenuBridge.navigate('play')
    expect(route).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    disconnect()
    disconnect = undefined
    expect(kingdomMenuBridge.getSnapshot().layout).toBeNull()
    expect(kingdomMenuBridge.getButtonRects()).toEqual([])
  })

  it('does not let a stale scene cleanup disconnect its successor', () => {
    const stale = kingdomMenuBridge.connect(vi.fn())
    const current = vi.fn()
    disconnect = kingdomMenuBridge.connect(current)
    stale()
    const layout = resolveKingdomMenuLayout(393, 852, { top: 0, bottom: 0, left: 0, right: 0 }, true)
    kingdomMenuBridge.publish({ visible: true, layout, artwork: null, stats: { best: 0, coins: 0, discovered: 0, total: 40 }, accountName: 'Player' })
    kingdomMenuBridge.navigate('account')
    expect(current).toHaveBeenCalledWith('account')
  })

  it('counts character discoveries rather than numeric variant records', () => {
    const save = freshSave()
    save.best = 918
    save.coins = 24.7
    save.discovered = { 1: 1, 2: 2, 8: 3, 9: 4 }
    save.variants = { '9:0': 7 }
    expect(kingdomStatsFromSave(save)).toEqual({ best: 918, coins: 24.7, discovered: 3, total: 40 })
  })
})
