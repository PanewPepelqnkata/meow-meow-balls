import { useCallback, useEffect, useMemo, useState } from 'react'
import { authService } from '../services/auth'
import {
  bossService,
  type BossAnalyticsSummary,
  type BossCoinOperation,
  type BossPlayerRecord,
  type BossRunEnriched,
} from '../services/boss'
import { BALL_TIERS } from '../config/ballTiers'
import './BossDashboard.css'

type BossTab = 'overview' | 'players' | 'guests' | 'runs'

interface BossNotice {
  type: 'success' | 'error'
  text: string
}

interface RunFormState {
  scoreId: number | null
  userId: string
  isGuest: boolean
  score: number
  tier: number
  merges: number
  durationMs: number
}

interface PlayerFormState {
  userId: string
  isGuest: boolean
  username: string
  displayName: string
  bestScore: number
  runs: number
  merges: number
  bestTier: number
}

interface CoinFormState {
  userId: string
  displayName: string
  currentCoins: number
  operation: BossCoinOperation
  amount: number
}

const TIER_COLORS = BALL_TIERS.map(
  (t) => `#${t.color.toString(16).padStart(6, '0')}`,
)

function tierColor(tier: number): string {
  return TIER_COLORS[Math.max(0, Math.min(11, tier - 1))] ?? '#4fc3f7'
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtCoins(value: number | string | null | undefined): string {
  const coins = Number(value)
  return Number.isFinite(coins) ? Math.max(0, coins).toFixed(1) : '0.0'
}

function fmtDate(iso: string | number | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function BossRunCollectibles({
  collectibles,
}: {
  collectibles: BossRunEnriched['collectibles']
}) {
  if (collectibles == null) return <span className="boss-muted">Not recorded</span>
  if (collectibles.length === 0) return <span className="boss-muted">None discovered</span>

  return (
    <ul className="boss-collectibles" aria-label="Collectibles discovered in this run">
      {collectibles.map((item) => (
        <li key={`${item.tier}:${item.theme}:${item.variant}`}>
          <strong>T{item.tier} — {item.theme.toUpperCase()}</strong>
          <span
            className="boss-muted"
            title={`Palette ${item.variant} (0-based) · Discovered ${new Date(item.discoveredAt).toLocaleString('en-US')}`}
          >
            Palette {item.variant} · {fmtDate(item.discoveredAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function BossDashboard() {
  const [authReady, setAuthReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const [tab, setTab] = useState<BossTab>('overview')
  const [data, setData] = useState<BossAnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<BossNotice | null>(null)

  const [playerQuery, setPlayerQuery] = useState('')
  const [guestQuery, setGuestQuery] = useState('')
  const [guestFilter, setGuestFilter] = useState<'all' | 'active' | 'converted'>('all')
  const [runQuery, setRunQuery] = useState('')
  const [runFilter, setRunFilter] = useState<'all' | 'registered' | 'guest'>('all')
  const [runSort, setRunSort] = useState<'recent' | 'score' | 'tier' | 'merges'>('recent')
  const [runForm, setRunForm] = useState<RunFormState | null>(null)
  const [playerForm, setPlayerForm] = useState<PlayerFormState | null>(null)
  const [coinForm, setCoinForm] = useState<CoinFormState | null>(null)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<BossPlayerRecord | null>(null)
  const [confirmResetUser, setConfirmResetUser] = useState<BossPlayerRecord | null>(null)
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<BossRunEnriched | null>(null)
  const [busy, setBusy] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const summary = await bossService.fetchDashboard()
      setData(summary)
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load dashboard data',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await authService.initialize()
      if (cancelled) return
      setAuthed(authService.isAuthenticated())
      setAuthReady(true)
      if (authService.isAuthenticated()) {
        void loadData()
      }
    }
    void init()

    const unsubscribe = authService.onAuthStateChange((isAuthed) => {
      setAuthed(isAuthed)
      if (isAuthed) {
        void loadData()
      } else {
        setData(null)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [loadData])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setLoginError('Username and password are required')
      return
    }
    setLoggingIn(true)
    setLoginError('')
    const { error } = await authService.signInWithUsername(username.trim(), password)
    setLoggingIn(false)
    if (error) {
      setLoginError(error.message || 'Invalid username or password')
      return
    }
    setAuthed(true)
    void loadData()
  }

  const handleLogout = async () => {
    await authService.signOut()
  }

  const filteredPlayers = useMemo(() => {
    if (!data) return []
    const q = playerQuery.trim().toLowerCase()
    if (!q) return data.players
    return data.players.filter(
      (p) =>
        p.username.toLowerCase().includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q),
    )
  }, [data, playerQuery])

  const filteredGuests = useMemo(() => {
    if (!data) return []
    let list = data.guests
    if (guestFilter === 'converted') {
      list = list.filter((g) => Boolean(g.convertedUserId))
    } else if (guestFilter === 'active') {
      list = list.filter((g) => !g.convertedUserId)
    }
    const q = guestQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (g) =>
        g.id.toLowerCase().includes(q) ||
        g.username.toLowerCase().includes(q) ||
        g.displayName.toLowerCase().includes(q) ||
        g.email.toLowerCase().includes(q),
    )
  }, [data, guestQuery, guestFilter])

  const filteredRuns = useMemo(() => {
    if (!data) return []
    const q = runQuery.trim().toLowerCase()
    let list =
      runFilter === 'registered'
        ? data.runs
        : runFilter === 'guest'
          ? data.guestRuns
          : data.allRuns
    // Filter out invalid runs: 0 score AND 0 merges means the player never
    // actually played (accidental drop, immediate game over, etc.)
    list = list.filter((r) => r.score > 0 || r.balls_merged > 0)
    if (q) {
      list = list.filter(
        (r) =>
          r.username.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    switch (runSort) {
      case 'score':
        sorted.sort((a, b) => b.score - a.score)
        break
      case 'tier':
        sorted.sort((a, b) => b.tier_reached - a.tier_reached || b.score - a.score)
        break
      case 'merges':
        sorted.sort((a, b) => b.balls_merged - a.balls_merged)
        break
      case 'recent':
      default:
        sorted.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    }
    return sorted
  }, [data, runQuery, runFilter, runSort])

  const openEditRun = (run: BossRunEnriched) => {
    setRunForm({
      scoreId: run.id,
      userId: run.user_id,
      isGuest: Boolean(run.isGuest),
      score: run.score,
      tier: run.tier_reached,
      merges: run.balls_merged,
      durationMs: run.duration_ms,
    })
  }

  const openAddRun = (player: BossPlayerRecord) => {
    setRunForm({
      scoreId: null,
      userId: player.id,
      isGuest: Boolean(player.isGuest),
      score: 0,
      tier: 1,
      merges: 0,
      durationMs: 0,
    })
  }

  const openEditPlayer = (player: BossPlayerRecord) => {
    setPlayerForm({
      userId: player.id,
      isGuest: Boolean(player.isGuest),
      username: player.username,
      displayName: player.displayName,
      bestScore: player.bestScore,
      runs: player.careerRuns,
      merges: player.totalMerges,
      bestTier: player.bestTier,
    })
  }

  const openEditCoins = (player: BossPlayerRecord) => {
    if (player.isGuest) return
    setCoinForm({
      userId: player.id,
      displayName: player.displayName,
      currentCoins: Number(player.coins ?? 0),
      operation: 'increase',
      amount: 1,
    })
  }

  const submitRunForm = async () => {
    if (!runForm) return
    setBusy(true)
    setNotice(null)
    try {
      if (runForm.isGuest) {
        if (runForm.scoreId === null || runForm.scoreId < 0) {
          await bossService.createGuestScore(
            runForm.userId,
            runForm.score,
            runForm.tier,
            runForm.merges,
            runForm.durationMs,
          )
          setNotice({ type: 'success', text: 'Guest run added and guest progress synchronized.' })
        } else {
          await bossService.updateGuestScore(
            runForm.scoreId,
            runForm.score,
            runForm.tier,
            runForm.merges,
            runForm.durationMs,
          )
          setNotice({ type: 'success', text: 'Guest run updated and guest progress synchronized.' })
        }
      } else if (runForm.scoreId === null) {
        await bossService.createScore(
          runForm.userId,
          runForm.score,
          runForm.tier,
          runForm.merges,
          runForm.durationMs,
        )
        setNotice({ type: 'success', text: 'Run added and player progress synchronized.' })
      } else {
        await bossService.updateScore(
          runForm.scoreId,
          runForm.score,
          runForm.tier,
          runForm.merges,
          runForm.durationMs,
        )
        setNotice({ type: 'success', text: 'Run updated and player progress synchronized.' })
      }
      setRunForm(null)
      await loadData()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save run',
      })
    } finally {
      setBusy(false)
    }
  }

  const submitPlayerForm = async () => {
    if (!playerForm) return
    setBusy(true)
    setNotice(null)
    try {
      if (playerForm.isGuest) {
        await bossService.updateGuest({
          guestId: playerForm.userId,
          bestScore: playerForm.bestScore,
          runs: playerForm.runs,
          merges: playerForm.merges,
          bestTier: playerForm.bestTier,
        })
        setNotice({ type: 'success', text: 'Guest progression updated.' })
      } else {
        await bossService.updateUser({
          userId: playerForm.userId,
          username: playerForm.username,
          displayName: playerForm.displayName,
          bestScore: playerForm.bestScore,
          runs: playerForm.runs,
          merges: playerForm.merges,
          bestTier: playerForm.bestTier,
        })
        setNotice({ type: 'success', text: 'Player profile and progression updated.' })
      }
      setPlayerForm(null)
      await loadData()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update player',
      })
    } finally {
      setBusy(false)
    }
  }

  const submitCoinForm = async () => {
    if (!coinForm) return
    const amount = Number(coinForm.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      setNotice({ type: 'error', text: 'Coin amount must be a non-negative number.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await bossService.updateUserCoins(coinForm.userId, coinForm.operation, amount)
      setCoinForm(null)
      setNotice({ type: 'success', text: `${coinForm.displayName}'s coin balance was updated.` })
      await loadData()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update coins',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!confirmDeleteUser) return
    setBusy(true)
    setNotice(null)
    try {
      if (confirmDeleteUser.isGuest) {
        await bossService.deleteGuest(confirmDeleteUser.id)
      } else {
        await bossService.deleteUser(confirmDeleteUser.id)
      }
      setNotice({
        type: 'success',
        text: `Deleted ${confirmDeleteUser.displayName} and all of their runs.`,
      })
      setConfirmDeleteUser(null)
      await loadData()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete user',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleResetUser = async () => {
    if (!confirmResetUser) return
    setBusy(true)
    setNotice(null)
    try {
      if (confirmResetUser.isGuest) {
        await bossService.resetGuestProgress(confirmResetUser.id)
      } else {
        await bossService.resetUserProgress(confirmResetUser.id)
      }
      setNotice({
        type: 'success',
        text: `Reset ${confirmResetUser.displayName}'s score and progression to 0.`,
      })
      setConfirmResetUser(null)
      await loadData()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reset progress',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteRun = async () => {
    if (!confirmDeleteRun) return
    setBusy(true)
    setNotice(null)
    try {
      if (confirmDeleteRun.isGuest) {
        await bossService.deleteGuestScore(confirmDeleteRun.id)
      } else {
        await bossService.deleteScore(confirmDeleteRun.id)
      }
      setNotice({ type: 'success', text: 'Run deleted and progress synchronized.' })
      setConfirmDeleteRun(null)
      await loadData()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete run',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!authReady) {
    return (
      <div className="boss-shell boss-auth-wrap">
        <div className="boss-auth-card" style={{ textAlign: 'center' }}>
          <div className="boss-auth-badge">BOSS ACCESS</div>
          <h1 className="boss-auth-title">Loading…</h1>
          <p className="boss-auth-sub">Restoring your session.</p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="boss-shell boss-auth-wrap">
        <form className="boss-auth-card" onSubmit={handleLogin}>
          <div className="boss-auth-badge">BOSS CONTROL PANEL</div>
          <h1 className="boss-auth-title">Admin Dashboard</h1>
          <p className="boss-auth-sub">
            Live analytics, player management, and run moderation for Ball Rush.
          </p>
          <div className="boss-auth-notice">
            Access is restricted to pre-existing accounts. Registration is disabled on this panel —
            sign in with your existing game username and password.
          </div>
          {loginError && <div className="boss-auth-error">{loginError}</div>}
          <div className="boss-field">
            <label htmlFor="boss-username">Username</label>
            <input
              id="boss-username"
              className="boss-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. paneww"
            />
          </div>
          <div className="boss-field">
            <label htmlFor="boss-password">Password</label>
            <input
              id="boss-password"
              className="boss-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            className="boss-btn boss-btn-primary"
            style={{ width: '100%', padding: '12px' }}
            disabled={loggingIn}
          >
            {loggingIn ? 'Signing in…' : 'Sign In to Dashboard'}
          </button>
          <p className="boss-muted" style={{ marginTop: 14, textAlign: 'center' }}>
            No account? Ask an existing admin to create one in the game first.
          </p>
        </form>
      </div>
    )
  }

  const profile = authService.getProfile()
  const currentUserName = profile?.display_name || profile?.username || 'Admin'

  return (
    <div className="boss-shell">
      <div className="boss-container">
        {/* Top bar */}
        <div className="boss-topbar">
          <div className="boss-brand">
            <div>
              <h1 className="boss-brand-title">
                Ball Rush Boss <span className="boss-route-pill">/boss</span>
              </h1>
              <div className="boss-brand-meta">
                {data
                  ? `Updated ${fmtDate(data.generatedAt)} · ${data.totalPlayers} players · ${data.totalGuests} guests · ${data.allRuns.length} runs`
                  : 'Loading analytics…'}
              </div>
            </div>
          </div>
          <div className="boss-top-actions">
            <div className="boss-user-chip">
              <span className="boss-status-dot" />
              Signed in as <strong>{currentUserName}</strong>
            </div>
            <button className="boss-btn boss-btn-secondary" onClick={() => void loadData()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh Data'}
            </button>
            <button className="boss-btn boss-btn-secondary" onClick={() => void handleLogout()}>
              Logout
            </button>
          </div>
        </div>

        {notice && (
          <div className={`boss-banner boss-banner-${notice.type}`}>
            <span>{notice.text}</span>
            <button
              className="boss-btn boss-btn-sm boss-btn-secondary"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="boss-nav">
          <div className="boss-tabs">
            <button
              className={`boss-tab ${tab === 'overview' ? 'active' : ''}`}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              className={`boss-tab ${tab === 'players' ? 'active' : ''}`}
              onClick={() => setTab('players')}
            >
              Players
              {data && <span className="boss-tab-count">{data.totalPlayers}</span>}
            </button>
            <button
              className={`boss-tab ${tab === 'guests' ? 'active' : ''}`}
              onClick={() => setTab('guests')}
            >
              Guests
              {data && <span className="boss-tab-count">{data.totalGuests}</span>}
            </button>
            <button
              className={`boss-tab ${tab === 'runs' ? 'active' : ''}`}
              onClick={() => setTab('runs')}
            >
              Runs
              {data && <span className="boss-tab-count">{data.allRuns.length}</span>}
            </button>
          </div>
        </div>

        {!data && loading && (
          <div className="boss-card" style={{ textAlign: 'center', padding: 60 }}>
            <p className="boss-muted">Loading dashboard analytics from Supabase…</p>
          </div>
        )}

        {data && tab === 'overview' && (
          <>
            {/* KPI Grid */}
            <div className="boss-kpi-grid">
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Total Players</div>
                <div className="boss-kpi-value">{fmtNum(data.totalPlayers)}</div>
                <div className="boss-kpi-sub">
                  <span className="boss-kpi-highlight">+{data.newPlayers24h}</span> last 24h
                  <span>·</span>
                  <span className="boss-kpi-highlight">+{data.newPlayers7d}</span> last 7d
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">All-Time High Score</div>
                <div className="boss-kpi-value">{fmtNum(data.allTimeHighScore)}</div>
                <div className="boss-kpi-sub">
                  held by <span className="boss-kpi-highlight">{data.allTimeHighHolder}</span>
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Total Runs</div>
                <div className="boss-kpi-value">{fmtNum(data.totalCareerRuns)}</div>
                <div className="boss-kpi-sub">
                  <span className="boss-kpi-highlight">{data.runs24h}</span> last 24h
                  <span>·</span>
                  <span className="boss-kpi-highlight">{data.runs7d}</span> last 7d
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Anonymous Guests</div>
                <div className="boss-kpi-value">{fmtNum(data.totalGuests)}</div>
                <div className="boss-kpi-sub">
                  <span className="boss-kpi-highlight">+{data.newGuests24h}</span> 24h
                  <span>·</span>
                  <span className="boss-kpi-highlight">{data.convertedGuests}</span> converted (
                  {data.guestConversionPct}%)
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Guest Runs</div>
                <div className="boss-kpi-value">{fmtNum(data.totalGuestCareerRuns)}</div>
                <div className="boss-kpi-sub">
                  <span className="boss-kpi-highlight">{data.guestRuns24h}</span> last 24h
                  <span>·</span>
                  <span className="boss-kpi-highlight">{data.totalGuestRecordedRuns}</span> logged
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Avg Run Score</div>
                <div className="boss-kpi-value">{fmtNum(data.avgRunScore)}</div>
                <div className="boss-kpi-sub">
                  median {fmtNum(data.medianRunScore)} · p90 {fmtNum(data.p90RunScore)}
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Total Balls Merged</div>
                <div className="boss-kpi-value">{fmtNum(data.totalBallsMerged)}</div>
                <div className="boss-kpi-sub">
                  avg {fmtNum(data.avgMergesPerRun)} / run · max {fmtNum(data.maxMergesSingleRun)}
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Peak Tier Reached</div>
                <div className="boss-kpi-value">Tier {data.peakTierOverall}</div>
                <div className="boss-kpi-sub">
                  avg tier/run {data.avgTierPerRun} ·{' '}
                  <span className="boss-kpi-highlight">
                    {data.collectibleReachPct}% reached T9+
                  </span>
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Avg Run Duration</div>
                <div className="boss-kpi-value">{fmtDuration(data.avgDurationMs)}</div>
                <div className="boss-kpi-sub">
                  total playtime {fmtDuration(data.totalDurationMs)}
                </div>
              </div>
              <div className="boss-kpi-card">
                <div className="boss-kpi-label">Score Efficiency</div>
                <div className="boss-kpi-value">{data.avgScorePerMerge}</div>
                <div className="boss-kpi-sub">avg points per merge across all runs</div>
              </div>
            </div>

            <div className="boss-grid-2">
              {/* Daily Activity Chart */}
              <div className="boss-card">
                <div className="boss-card-header">
                  <div>
                    <h2 className="boss-card-title">Daily Runs (Last 14 Days)</h2>
                    <p className="boss-card-subtitle">
                      Recorded runs per day · hover values shown above bars
                    </p>
                  </div>
                </div>
                <div className="boss-chart-bars">
                  {data.dailySeries.map((d) => {
                    const maxRuns = Math.max(1, ...data.dailySeries.map((x) => x.runs))
                    const pct = d.runs > 0 ? Math.max(6, Math.round((d.runs / maxRuns) * 100)) : 0
                    return (
                      <div className="boss-chart-col" key={d.dateKey}>
                        <div className="boss-chart-val">{d.runs > 0 ? d.runs : ''}</div>
                        <div
                          className={`boss-chart-bar ${d.runs === 0 ? 'empty' : ''}`}
                          style={{ height: `${pct}%` }}
                          title={`${d.runs} runs · peak ${fmtNum(d.peakScore)} · avg ${fmtNum(d.avgScore)}`}
                        />
                        <div className="boss-chart-date">{d.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Tier Funnel */}
              <div className="boss-card">
                <div className="boss-card-header">
                  <div>
                    <h2 className="boss-card-title">Tier Funnel</h2>
                    <p className="boss-card-subtitle">
                      % of players who unlocked each tier (lifetime)
                    </p>
                  </div>
                </div>
                <div className="boss-tier-list">
                  {data.tierStats.map((t) => (
                    <div className="boss-tier-row" key={t.tier}>
                      <span className="boss-tier-badge">
                        <span
                          className="boss-tier-dot"
                          style={{ background: tierColor(t.tier) }}
                        />
                        Tier {t.tier}
                      </span>
                      <div className="boss-progress-track">
                        <div
                          className="boss-progress-fill"
                          style={{
                            width: `${t.playerUnlockPct}%`,
                            background: tierColor(t.tier),
                          }}
                        />
                      </div>
                      <span className="boss-muted">
                        {t.playersUnlocked} players ({t.playerUnlockPct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="boss-grid-2">
              {/* Score Distribution */}
              <div className="boss-card">
                <div className="boss-card-header">
                  <div>
                    <h2 className="boss-card-title">Score Distribution</h2>
                    <p className="boss-card-subtitle">Share of recorded runs by score range</p>
                  </div>
                </div>
                <div className="boss-tier-list">
                  {data.scoreDistribution.map((b) => (
                    <div className="boss-tier-row" key={b.label}>
                      <span className="boss-tier-badge" style={{ background: '#1b2440' }}>
                        {b.label}
                      </span>
                      <div className="boss-progress-track">
                        <div
                          className="boss-progress-fill"
                          style={{ width: `${b.pct}%`, background: '#4fc3f7' }}
                        />
                      </div>
                      <span className="boss-muted">
                        {b.count} runs ({b.pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Theme & Variants */}
              <div className="boss-card">
                <div className="boss-card-header">
                  <div>
                    <h2 className="boss-card-title">Theme & Collectible Variants</h2>
                    <p className="boss-card-subtitle">
                      Player theme settings and discovered tier 9–10 variants
                    </p>
                  </div>
                </div>
                <div className="boss-tier-list" style={{ marginBottom: 18 }}>
                  {data.themeBreakdown.map((t) => (
                    <div className="boss-tier-row" key={t.theme}>
                      <span className="boss-tier-badge" style={{ background: '#1b2440' }}>
                        {t.theme}
                      </span>
                      <div className="boss-progress-track">
                        <div
                          className="boss-progress-fill"
                          style={{ width: `${t.pct}%`, background: '#81d4fa' }}
                        />
                      </div>
                      <span className="boss-muted">
                        {t.count} players ({t.pct}%)
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="boss-kpi-label" style={{ marginBottom: 8 }}>
                    Discovered Variants
                  </div>
                  {data.variantBreakdown.length === 0 ? (
                    <p className="boss-muted">No collectible variants discovered yet.</p>
                  ) : (
                    <div className="boss-tier-pills">
                      {data.variantBreakdown.map((v) => (
                        <span
                          key={v.key}
                          className="boss-tier-mini unlocked"
                          style={{ width: 'auto', padding: '0 8px' }}
                          title={`Variant ${v.key} discovered by ${v.count} player(s)`}
                        >
                          {v.key} ×{v.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Top Players */}
            <div className="boss-card">
              <div className="boss-card-header">
                <div>
                  <h2 className="boss-card-title">Top Players by Best Score</h2>
                  <p className="boss-card-subtitle">
                    Highest lifetime score, career runs, and total merges
                  </p>
                </div>
              </div>
              <div className="boss-table-wrap">
                <table className="boss-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Coins</th>
                      <th>Best Score</th>
                      <th>Career Runs</th>
                      <th>Total Merges</th>
                      <th>Best Tier</th>
                      <th>Last Sign In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.players.slice(0, 8).map((p, idx) => (
                      <tr key={p.id}>
                        <td className="boss-muted">{idx + 1}</td>
                        <td>
                          <strong>{p.displayName}</strong>
                          <div className="boss-muted">@{p.username}</div>
                        </td>
                        <td className="boss-mono boss-coins">{fmtCoins(p.coins)}</td>
                        <td className="boss-mono">{fmtNum(p.bestScore)}</td>
                        <td>{p.careerRuns}</td>
                        <td>{fmtNum(p.totalMerges)}</td>
                        <td>
                          <span className="boss-tier-badge">
                            <span
                              className="boss-tier-dot"
                              style={{ background: tierColor(p.bestTier) }}
                            />
                            T{p.bestTier}
                          </span>
                        </td>
                        <td className="boss-muted">{fmtDate(p.lastSignInAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {data && tab === 'players' && (
          <div className="boss-card">
            <div className="boss-card-header">
              <div>
                <h2 className="boss-card-title">Player Management</h2>
                <p className="boss-card-subtitle">
                  View coin balances, edit progression, add runs, reset accounts, or delete players
                </p>
              </div>
            </div>
            <div className="boss-toolbar">
              <input
                className="boss-input"
                placeholder="Search by username, display name, or email…"
                value={playerQuery}
                onChange={(e) => setPlayerQuery(e.target.value)}
              />
            </div>
            <div className="boss-table-wrap">
              <table className="boss-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Email</th>
                    <th>Coins</th>
                    <th>Best Score</th>
                    <th>Career Runs</th>
                    <th>Total Merges</th>
                    <th>Best Tier</th>
                    <th>Unlocked Tiers</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.displayName}</strong>
                        <div className="boss-muted">@{p.username}</div>
                      </td>
                      <td className="boss-muted">{p.email}</td>
                      <td className="boss-mono boss-coins">{fmtCoins(p.coins)}</td>
                      <td className="boss-mono">{fmtNum(p.bestScore)}</td>
                      <td>{p.careerRuns}</td>
                      <td>{fmtNum(p.totalMerges)}</td>
                      <td>
                        <span className="boss-tier-badge">
                          <span
                            className="boss-tier-dot"
                            style={{ background: tierColor(p.bestTier) }}
                          />
                          T{p.bestTier}
                        </span>
                      </td>
                      <td>
                        <div className="boss-tier-pills">
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((t) => (
                            <span
                              key={t}
                              className={`boss-tier-mini ${p.discoveredTiers.includes(t) ? 'unlocked' : ''}`}
                              title={`Tier ${t}`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="boss-muted">{fmtDate(p.createdAt)}</td>
                      <td>
                        <div className="boss-actions-cell">
                          <button
                            className="boss-btn boss-btn-sm boss-btn-secondary"
                            onClick={() => openEditPlayer(p)}
                          >
                            Edit
                          </button>
                          <button
                            className="boss-btn boss-btn-sm boss-btn-primary"
                            onClick={() => openEditCoins(p)}
                          >
                            Coins
                          </button>
                          <button
                            className="boss-btn boss-btn-sm boss-btn-secondary"
                            onClick={() => openAddRun(p)}
                          >
                            Add Run
                          </button>
                          <button
                            className="boss-btn boss-btn-sm boss-btn-warning"
                            onClick={() => setConfirmResetUser(p)}
                          >
                            Reset
                          </button>
                          <button
                            className="boss-btn boss-btn-sm boss-btn-danger"
                            onClick={() => setConfirmDeleteUser(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && tab === 'guests' && (
          <div className="boss-card">
            <div className="boss-card-header">
              <div>
                <h2 className="boss-card-title">Guest Sessions & Conversion</h2>
                <p className="boss-card-subtitle">
                  Anonymous visitors tracked automatically · converted guests link to registered
                  accounts on sign-up
                </p>
              </div>
            </div>
            <div className="boss-toolbar">
              <input
                className="boss-input"
                placeholder="Search by guest ID or converted account…"
                value={guestQuery}
                onChange={(e) => setGuestQuery(e.target.value)}
              />
              <select
                className="boss-select"
                value={guestFilter}
                onChange={(e) => setGuestFilter(e.target.value as typeof guestFilter)}
              >
                <option value="all">All Guests ({data.guests.length})</option>
                <option value="active">
                  Unconverted Guests ({data.guests.length - data.convertedGuests})
                </option>
                <option value="converted">Converted to Account ({data.convertedGuests})</option>
              </select>
            </div>
            <div className="boss-table-wrap">
              <table className="boss-table">
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Status / Account</th>
                    <th>Best Score</th>
                    <th>Career Runs</th>
                    <th>Total Merges</th>
                    <th>Best Tier</th>
                    <th>Unlocked Tiers</th>
                    <th>Last Seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGuests.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="boss-muted" style={{ textAlign: 'center', padding: 32 }}>
                        No guest sessions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    filteredGuests.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <strong>{g.displayName}</strong>
                          <div className="boss-muted" title={g.id}>
                            {g.id.slice(0, 8)}…
                          </div>
                        </td>
                        <td className="boss-muted">
                          {g.convertedUserId ? (
                            <span className="boss-tier-badge" style={{ background: '#11382a', color: '#4ade80' }}>
                              Converted → @{g.convertedUsername || g.convertedUserId.slice(0, 6)}
                            </span>
                          ) : (
                            <span>Anonymous Guest</span>
                          )}
                        </td>
                        <td className="boss-mono">{fmtNum(g.bestScore)}</td>
                        <td>{g.careerRuns}</td>
                        <td>{fmtNum(g.totalMerges)}</td>
                        <td>
                          <span className="boss-tier-badge">
                            <span
                              className="boss-tier-dot"
                              style={{ background: tierColor(g.bestTier) }}
                            />
                            T{g.bestTier}
                          </span>
                        </td>
                        <td>
                          <div className="boss-tier-pills">
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((t) => (
                              <span
                                key={t}
                                className={`boss-tier-mini ${g.discoveredTiers.includes(t) ? 'unlocked' : ''}`}
                                title={`Tier ${t}`}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="boss-muted">{fmtDate(g.lastSignInAt)}</td>
                        <td>
                          <div className="boss-actions-cell">
                            <button
                              className="boss-btn boss-btn-sm boss-btn-secondary"
                              onClick={() => openEditPlayer(g)}
                            >
                              Edit
                            </button>
                            <button
                              className="boss-btn boss-btn-sm boss-btn-secondary"
                              onClick={() => openAddRun(g)}
                            >
                              Add Run
                            </button>
                            <button
                              className="boss-btn boss-btn-sm boss-btn-warning"
                              onClick={() => setConfirmResetUser(g)}
                            >
                              Reset
                            </button>
                            <button
                              className="boss-btn boss-btn-sm boss-btn-danger"
                              onClick={() => setConfirmDeleteUser(g)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && tab === 'runs' && (
          <div className="boss-card">
            <div className="boss-card-header">
              <div>
                <h2 className="boss-card-title">Run History</h2>
                <p className="boss-card-subtitle">
                  Every recorded game-over run · edit or delete individual scores
                </p>
              </div>
            </div>
            <div className="boss-toolbar">
              <input
                className="boss-input"
                placeholder="Search by player or guest…"
                value={runQuery}
                onChange={(e) => setRunQuery(e.target.value)}
              />
              <select
                className="boss-select"
                value={runFilter}
                onChange={(e) => setRunFilter(e.target.value as typeof runFilter)}
              >
                <option value="all">All Runs ({data.allRuns.length})</option>
                <option value="registered">Registered ({data.runs.length})</option>
                <option value="guest">Guests ({data.guestRuns.length})</option>
              </select>
              <select
                className="boss-select"
                value={runSort}
                onChange={(e) => setRunSort(e.target.value as typeof runSort)}
              >
                <option value="recent">Most Recent</option>
                <option value="score">Highest Score</option>
                <option value="tier">Highest Tier</option>
                <option value="merges">Most Merges</option>
              </select>
            </div>
            <div className="boss-table-wrap">
              <table className="boss-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Player</th>
                    <th>Score</th>
                    <th>Tier</th>
                    <th>Collectibles</th>
                    <th>Merges</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Score/Merge</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((r) => (
                    <tr key={`${r.isGuest ? 'g' : 'u'}-${r.id}`}>
                      <td className="boss-muted">{fmtDate(r.created_at)}</td>
                      <td>
                        <strong>{r.displayName}</strong>
                        <div className="boss-muted">
                          @{r.username} {r.isGuest ? '· Guest' : ''}
                        </div>
                      </td>
                      <td className="boss-mono">{fmtNum(r.score)}</td>
                      <td>
                        <span className="boss-tier-badge">
                          <span
                            className="boss-tier-dot"
                            style={{ background: tierColor(r.tier_reached) }}
                          />
                          T{r.tier_reached}
                        </span>
                      </td>
                      <td><BossRunCollectibles collectibles={r.collectibles} /></td>
                      <td>{fmtNum(r.balls_merged)}</td>
                      <td className="boss-muted">{fmtDuration(r.duration_ms)}</td>
                      <td>
                        {r.interruption_reason ? (
                          <span className="boss-badge boss-badge-warning" title={r.interruption_reason}>
                            {r.interruption_reason}
                          </span>
                        ) : (
                          <span className="boss-muted">Completed</span>
                        )}
                      </td>
                      <td className="boss-mono">{r.scorePerMerge}</td>
                      <td>
                        <div className="boss-actions-cell">
                          <button
                            className="boss-btn boss-btn-sm boss-btn-secondary"
                            onClick={() => openEditRun(r)}
                          >
                            Edit
                          </button>
                          {r.id > 0 && (
                            <button
                              className="boss-btn boss-btn-sm boss-btn-danger"
                              onClick={() => setConfirmDeleteRun(r)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ---- Run Edit / Add Modal ---- */}
      {runForm && (
        <div className="boss-modal-backdrop" onClick={() => !busy && setRunForm(null)}>
          <div className="boss-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="boss-modal-title">
              {runForm.scoreId === null ? 'Add New Run' : 'Edit Run'}
            </h3>
            <p className="boss-modal-sub">
              Changes immediately update the player's best score, tier unlocks, and career stats.
            </p>
            <div className="boss-form-grid">
              <div className="boss-field">
                <label>Score</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  value={runForm.score}
                  onChange={(e) =>
                    setRunForm({ ...runForm, score: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </div>
              <div className="boss-field">
                <label>Tier Reached (1–12)</label>
                <input
                  className="boss-input"
                  type="number"
                  min={1}
                  max={12}
                  value={runForm.tier}
                  onChange={(e) =>
                    setRunForm({
                      ...runForm,
                      tier: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                    })
                  }
                />
              </div>
              <div className="boss-field">
                <label>Balls Merged</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  value={runForm.merges}
                  onChange={(e) =>
                    setRunForm({ ...runForm, merges: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </div>
              <div className="boss-field">
                <label>Duration (ms)</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  value={runForm.durationMs}
                  onChange={(e) =>
                    setRunForm({
                      ...runForm,
                      durationMs: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>
            <div className="boss-modal-footer">
              <button
                className="boss-btn boss-btn-secondary"
                onClick={() => setRunForm(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="boss-btn boss-btn-primary"
                onClick={() => void submitRunForm()}
                disabled={busy}
              >
                {busy ? 'Saving…' : runForm.scoreId === null ? 'Add Run' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Player Edit Modal ---- */}
      {playerForm && (
        <div className="boss-modal-backdrop" onClick={() => !busy && setPlayerForm(null)}>
          <div className="boss-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="boss-modal-title">
              {playerForm.isGuest ? 'Edit Guest Session' : 'Edit Player'}
            </h3>
            <p className="boss-modal-sub">
              Update career progression overrides. Tier unlocks are synced to the best tier.
            </p>
            <div className="boss-form-grid">
              {!playerForm.isGuest && (
                <>
                  <div className="boss-field">
                    <label>Username</label>
                    <input
                      className="boss-input"
                      type="text"
                      value={playerForm.username}
                      onChange={(e) =>
                        setPlayerForm({ ...playerForm, username: e.target.value })
                      }
                    />
                  </div>
                  <div className="boss-field">
                    <label>Display Name</label>
                    <input
                      className="boss-input"
                      type="text"
                      value={playerForm.displayName}
                      onChange={(e) =>
                        setPlayerForm({ ...playerForm, displayName: e.target.value })
                      }
                    />
                  </div>
                </>
              )}
              <div className="boss-field">
                <label>Best Score</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  value={playerForm.bestScore}
                  onChange={(e) =>
                    setPlayerForm({
                      ...playerForm,
                      bestScore: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
              <div className="boss-field">
                <label>Career Runs</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  value={playerForm.runs}
                  onChange={(e) =>
                    setPlayerForm({
                      ...playerForm,
                      runs: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
              <div className="boss-field">
                <label>Total Merges</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  value={playerForm.merges}
                  onChange={(e) =>
                    setPlayerForm({
                      ...playerForm,
                      merges: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
              <div className="boss-field">
                <label>Best Tier (0–12)</label>
                <input
                  className="boss-input"
                  type="number"
                  min={0}
                  max={12}
                  value={playerForm.bestTier}
                  onChange={(e) =>
                    setPlayerForm({
                      ...playerForm,
                      bestTier: Math.max(0, Math.min(12, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            </div>
            <div className="boss-modal-footer">
              <button
                className="boss-btn boss-btn-secondary"
                onClick={() => setPlayerForm(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="boss-btn boss-btn-primary"
                onClick={() => void submitPlayerForm()}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save Player'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Coin Adjustment Modal ---- */}
      {coinForm && (
        <div className="boss-modal-backdrop" onClick={() => !busy && setCoinForm(null)}>
          <div className="boss-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="boss-modal-title">Adjust Coins</h3>
            <p className="boss-modal-sub">
              Update <strong>{coinForm.displayName}</strong>'s persisted balance. Current balance:{' '}
              <strong className="boss-coins">{fmtCoins(coinForm.currentCoins)}</strong>
            </p>
            <div className="boss-form-grid">
              <div className="boss-field">
                <label htmlFor="coin-operation">Coin action</label>
                <select
                  id="coin-operation"
                  className="boss-select"
                  value={coinForm.operation}
                  onChange={(e) =>
                    setCoinForm({
                      ...coinForm,
                      operation: e.target.value as BossCoinOperation,
                    })
                  }
                >
                  <option value="increase">Increase balance</option>
                  <option value="decrease">Decrease balance</option>
                  <option value="set">Set exact balance</option>
                </select>
              </div>
              <div className="boss-field">
                <label htmlFor="coin-amount">
                  {coinForm.operation === 'set' ? 'Exact balance' : 'Amount'}
                </label>
                <input
                  id="coin-amount"
                  className="boss-input"
                  type="number"
                  min={0}
                  max={99999999999.9}
                  step={0.1}
                  value={coinForm.amount}
                  onChange={(e) =>
                    setCoinForm({
                      ...coinForm,
                      amount: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>
            <p className="boss-muted">
              {coinForm.operation === 'increase'
                ? `New balance: ${fmtCoins(coinForm.currentCoins + coinForm.amount)}`
                : coinForm.operation === 'decrease'
                  ? `New balance: ${fmtCoins(Math.max(0, coinForm.currentCoins - coinForm.amount))}`
                  : `New balance: ${fmtCoins(coinForm.amount)}`}
            </p>
            <div className="boss-modal-footer">
              <button
                className="boss-btn boss-btn-secondary"
                onClick={() => setCoinForm(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="boss-btn boss-btn-primary"
                onClick={() => void submitCoinForm()}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save Coin Balance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete User Confirm ---- */}
      {confirmDeleteUser && (
        <div className="boss-modal-backdrop" onClick={() => !busy && setConfirmDeleteUser(null)}>
          <div className="boss-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="boss-modal-title">Delete Player</h3>
            <p className="boss-modal-sub">
              This permanently deletes <strong>{confirmDeleteUser.displayName}</strong>'s account,
              all {confirmDeleteUser.recordedRuns} recorded runs, and all progression. This action
              cannot be undone.
            </p>
            <div className="boss-modal-footer">
              <button
                className="boss-btn boss-btn-secondary"
                onClick={() => setConfirmDeleteUser(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="boss-btn boss-btn-danger"
                onClick={() => void handleDeleteUser()}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Reset User Confirm ---- */}
      {confirmResetUser && (
        <div className="boss-modal-backdrop" onClick={() => !busy && setConfirmResetUser(null)}>
          <div className="boss-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="boss-modal-title">Reset Progress</h3>
            <p className="boss-modal-sub">
              Reset <strong>{confirmResetUser.displayName}</strong>'s best score, runs, merges,
              and tier unlocks back to 0. Their account and login remain active.
            </p>
            <div className="boss-modal-footer">
              <button
                className="boss-btn boss-btn-secondary"
                onClick={() => setConfirmResetUser(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="boss-btn boss-btn-warning"
                onClick={() => void handleResetUser()}
                disabled={busy}
              >
                {busy ? 'Resetting…' : 'Reset Progress'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete Run Confirm ---- */}
      {confirmDeleteRun && (
        <div className="boss-modal-backdrop" onClick={() => !busy && setConfirmDeleteRun(null)}>
          <div className="boss-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="boss-modal-title">Delete Run</h3>
            <p className="boss-modal-sub">
              Delete {confirmDeleteRun.displayName}'s run of{' '}
              <strong>{fmtNum(confirmDeleteRun.score)}</strong> points (Tier{' '}
              {confirmDeleteRun.tier_reached})? The player's best score and stats will be
              recalculated from their remaining runs.
            </p>
            <div className="boss-modal-footer">
              <button
                className="boss-btn boss-btn-secondary"
                onClick={() => setConfirmDeleteRun(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="boss-btn boss-btn-danger"
                onClick={() => void handleDeleteRun()}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Delete Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
