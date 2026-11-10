import { memo, useSyncExternalStore, type CSSProperties } from 'react'
import { AudioDirector } from '../game/audio/AudioDirector'
import { formatCoins } from '../game/rendering/Coin'
import type { KingdomNavItem, KingdomRect } from '../ui/KingdomMenuLayout'
import { kingdomMenuBridge } from './kingdomMenuBridge'
import './KingdomHome.css'

function position(rect: KingdomRect): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
}

const AuthoredImage = memo(function AuthoredImage({ source, className }: { source: string; className?: string }) {
  return <img className={className} src={source} alt="" aria-hidden="true" draggable={false} />
})

const NavigationButton = memo(function NavigationButton({ item, source, index }: { item: KingdomNavItem; source: string; index: number }) {
  return (
    <button
      type="button"
      className={`kingdom-button${item.action === 'play' ? ' kingdom-button--play' : ''}${item.compact ? ' kingdom-button--compact' : ''}`}
      data-kingdom-action={item.action}
      style={{ ...position(item), '--button-width': `${item.w}px`, '--button-delay': `${100 + index * 55}ms` } as CSSProperties}
      onPointerEnter={() => AudioDirector.uiHover()}
      onFocus={() => AudioDirector.uiHover()}
      onClick={() => { AudioDirector.uiClick(); kingdomMenuBridge.navigate(item.action) }}
    >
      <span className="kingdom-button__entrance">
        <span className="kingdom-button__visual">
          <AuthoredImage source={source} className="kingdom-button__art" />
          <span className="kingdom-button__label">{item.label}</span>
        </span>
      </span>
    </button>
  )
})

/** Native navigation and live statistics over the single Phaser-rendered throne hall. */
export function KingdomHome() {
  const state = useSyncExternalStore(kingdomMenuBridge.subscribe, kingdomMenuBridge.getSnapshot, kingdomMenuBridge.getSnapshot)
  if (!state.visible || !state.layout || !state.artwork) return null
  const { layout, artwork, stats } = state
  return (
    <section className={`kingdom-home kingdom-home--${layout.desktop ? 'desktop' : 'portrait'}`} aria-label="Ball Rush kingdom home" style={{ width: layout.width, height: layout.height }}>
      <h1 className="kingdom-home__sr-only">Ball Rush</h1>
      <div className="kingdom-stats" style={{ ...position(layout.stats), '--stats-width': `${layout.stats.w}px` } as CSSProperties} role="group" aria-label="Kingdom progress">
        <AuthoredImage source={artwork.stats} className="kingdom-stats__art" />
        <div className="kingdom-stat kingdom-stat--best">
          <AuthoredImage source={artwork.icons.best} className="kingdom-stat__icon" />
          <span className="kingdom-stat__text"><span className="kingdom-stat__name">BEST</span><strong>{stats.best.toLocaleString()}</strong></span>
        </div>
        <div className="kingdom-stat kingdom-stat--collection">
          <AuthoredImage source={artwork.icons.collection} className="kingdom-stat__icon" />
          <span className="kingdom-stat__text"><span className="kingdom-stat__name">FOUND</span><strong aria-label={`${stats.discovered} of ${stats.total} collected`}>{stats.discovered}/{stats.total}</strong></span>
        </div>
        <div className="kingdom-stat kingdom-stat--coins">
          <AuthoredImage source={artwork.icons.coins} className="kingdom-stat__icon" />
          <span className="kingdom-stat__text"><span className="kingdom-stat__name">COINS</span><strong aria-label={`${stats.coins} coins`}>{formatCoins(stats.coins)}</strong></span>
        </div>
      </div>
      <nav aria-label="Kingdom navigation">
        {layout.buttons.map((item, index) => <NavigationButton key={item.action} item={item} source={artwork.buttons[item.action]!} index={index} />)}
      </nav>
      {state.accountName && <span className="kingdom-home__sr-only">Signed in as {state.accountName}</span>}
    </section>
  )
}
