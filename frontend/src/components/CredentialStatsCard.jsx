import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { getProviderDisplay, BRAND_COLORS, CHART_TYPOGRAPHY } from '../lib/brandColors'
import ChartDialog from './ChartDialog'
import './CredentialStatsCard.css'

/**
 * Credential Stats Card — Topology Node Monitor
 *
 * Visual node-graph layout: center provider node connected to credential
 * cards via SVG bezier curves. Line thickness = request volume.
 * Desktop: click credential → inline detail panel on right side.
 * Mobile: click credential → modal dialog.
 */

function useIsDesktop(breakpoint = 900) {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= breakpoint
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const handler = (e) => setIsDesktop(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])
  return isDesktop
}

const getSuccessColor = (rate) => {
  if (rate >= 95) return '#10b981'
  if (rate >= 80) return '#f59e0b'
  if (rate >= 50) return '#f97316'
  return '#ef4444'
}

const formatNumber = (num) => {
  if (num == null || num === 0) return '0'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toLocaleString()
}

const getProviderHex = (provider) => {
  const p = (provider || 'unknown').toLowerCase()
  return BRAND_COLORS[p] || BRAND_COLORS.unknown
}

const getCredKey = (cred) => cred.auth_index || cred.source || cred.email

const shortenApiKeyLabel = (key) => {
  const v = String(key || '')
  return v || 'unknown'
}

/** SVG Donut ring */
const SuccessRing = ({ rate, size = 44, stroke = 3.5 }) => {
  const radius = (size - stroke) / 2
  const circ = 2 * Math.PI * radius
  const offset = circ - (circ * Math.min(100, rate)) / 100
  const color = getSuccessColor(rate)
  return (
    <svg width={size} height={size} className="cred-ring" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={stroke} opacity={0.3} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} className="cred-ring-fill" />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="cred-ring-text" fill={color}>
        {Math.round(rate)}%
      </text>
    </svg>
  )
}

/** Mini progress bar */
const MiniProgressBar = ({ percentage, color }) => (
  <div className="cred-mini-progress">
    <div className="cred-mini-progress-fill" style={{
      width: `${Math.min(100, Math.max(0, percentage))}%`,
      background: `linear-gradient(90deg, ${color}, ${color}cc)`,
    }} />
  </div>
)

/** View tabs */
const ViewTabs = ({ activeView, onSwitch }) => (
  <div className="chart-tabs">
    <button className={`tab ${activeView === 'credentials' ? 'active' : ''}`} onClick={() => onSwitch('credentials')}>
      Credentials
    </button>
    <button className={`tab ${activeView === 'api_keys' ? 'active' : ''}`} onClick={() => onSwitch('api_keys')}>
      API Keys
    </button>
  </div>
)

/* ================================================================
   Provider Topology — SVG node-graph with bezier connections
   ================================================================ */
function ProviderTopology({ provider, group, selectedCred, onCredClick }) {
  const containerRef = useRef(null)
  const centerRef = useRef(null)
  const cardElsRef = useRef(new Map())
  const [connections, setConnections] = useState([])

  const pc = getProviderDisplay(provider)
  const providerColor = getProviderHex(provider)

  // Sort credentials by volume descending, split into left/right
  const sorted = useMemo(() =>
    [...group.credentials].sort((a, b) => (b.total_requests || 0) - (a.total_requests || 0))
  , [group.credentials])

  const leftCreds = useMemo(() => sorted.filter((_, i) => i % 2 === 0), [sorted])
  const rightCreds = useMemo(() => sorted.filter((_, i) => i % 2 === 1), [sorted])

  const maxVolume = useMemo(() => Math.max(1, ...sorted.map(c => c.total_requests || 0)), [sorted])

  const setCardRef = useCallback((key, el) => {
    if (el) cardElsRef.current.set(key, el)
    else cardElsRef.current.delete(key)
  }, [])

  // Calculate SVG bezier paths
  const recalc = useCallback(() => {
    const container = containerRef.current
    const center = centerRef.current
    if (!container || !center) return

    const cr = container.getBoundingClientRect()
    const nr = center.getBoundingClientRect()
    const conns = []

    const process = (creds, side) => {
      creds.forEach((cred) => {
        const key = getCredKey(cred)
        const el = cardElsRef.current.get(key)
        if (!el) return

        const er = el.getBoundingClientRect()
        const vol = cred.total_requests || 0
        const sw = 1.5 + (vol / maxVolume) * 4
        const hasFail = (cred.failure_count || 0) > 0

        let sx, sy, ex, ey
        if (side === 'left') {
          sx = er.right - cr.left
          sy = er.top + er.height / 2 - cr.top
          ex = nr.left - cr.left
          ey = nr.top + nr.height / 2 - cr.top
        } else {
          sx = nr.right - cr.left
          sy = nr.top + nr.height / 2 - cr.top
          ex = er.left - cr.left
          ey = er.top + er.height / 2 - cr.top
        }

        const dx = Math.abs(ex - sx)
        const cpOff = dx * 0.5
        const path = side === 'left'
          ? `M ${sx} ${sy} C ${sx + cpOff} ${sy}, ${ex - cpOff} ${ey}, ${ex} ${ey}`
          : `M ${sx} ${sy} C ${sx + cpOff} ${sy}, ${ex - cpOff} ${ey}, ${ex} ${ey}`

        conns.push({ path, sw, key, hasFail, vol, sx, sy, ex, ey })
      })
    }

    process(leftCreds, 'left')
    process(rightCreds, 'right')
    setConnections(conns)
  }, [leftCreds, rightCreds, maxVolume])

  useEffect(() => {
    const timer = setTimeout(recalc, 80)
    const ro = new ResizeObserver(recalc)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [recalc])

  // Provider group stats
  const groupSuccess = group.credentials.reduce((s, c) => s + (c.success_count || 0), 0)
  const groupRate = group.totalReqs > 0 ? Math.round((groupSuccess / group.totalReqs) * 100) : 0

  return (
    <div className="cred-topology" ref={containerRef}>
      {/* SVG Connection Lines */}
      <svg className="cred-topology-svg">
        {connections.map((conn) => {
          const isActive = selectedCred === conn.key
          const lineColor = conn.hasFail ? '#ef4444' : providerColor
          return (
            <g key={conn.key}>
              {/* Glow layer */}
              <path d={conn.path} fill="none" stroke={lineColor} strokeWidth={conn.sw + 4}
                opacity={0.06} strokeLinecap="round" />
              {/* Main line */}
              <path d={conn.path} fill="none" stroke={lineColor} strokeWidth={conn.sw}
                opacity={isActive ? 0.85 : 0.35} strokeLinecap="round"
                className={isActive ? 'cred-topo-line--active' : ''} />
              {/* Animated flow dashes */}
              <path d={conn.path} fill="none" stroke={lineColor}
                strokeWidth={Math.max(1, conn.sw * 0.4)}
                opacity={isActive ? 0.5 : 0.15} strokeLinecap="round"
                strokeDasharray="4 8" className="cred-topo-line-flow" />
              {/* Endpoint dots */}
              <circle cx={conn.sx} cy={conn.sy} r={3.5} fill={lineColor} opacity={isActive ? 1 : 0.6} />
              <circle cx={conn.ex} cy={conn.ey} r={3.5} fill={lineColor} opacity={isActive ? 1 : 0.6} />
            </g>
          )
        })}
      </svg>

      {/* 3-column topology grid */}
      <div className="cred-topology-grid">
        {/* Left credentials */}
        <div className="cred-topology-col cred-topology-left">
          {leftCreds.map((cred) => {
            const key = getCredKey(cred)
            return (
              <div key={key} ref={el => setCardRef(key, el)}
                className={`cred-topo-card ${selectedCred === key ? 'cred-topo-card--selected' : ''} ${cred.failure_count > 0 ? 'cred-topo-card--error' : ''}`}
                onClick={() => onCredClick(cred)}
              >
                <TopoCardContent cred={cred} providerColor={providerColor} />
              </div>
            )
          })}
        </div>

        {/* Center provider node */}
        <div className="cred-topology-center">
          <div ref={centerRef} className="cred-center-node" style={{ '--node-color': providerColor }}>
            <div className="cred-center-node-dot cred-center-node-dot--left" style={{ background: providerColor }} />
            <div className="cred-center-node-dot cred-center-node-dot--right" style={{ background: providerColor }} />
            <div className="cred-center-node-icon" style={{ background: providerColor }}>
              {pc.name.charAt(0)}
            </div>
            <div className="cred-center-node-title">{pc.name}</div>
            <div className="cred-center-node-sub">PROVIDER</div>
            <div className="cred-center-node-stats">
              <div className="cred-center-stat">
                <span className="cred-center-stat-label">Total Requests</span>
                <span className="cred-center-stat-value">{formatNumber(group.totalReqs)}</span>
              </div>
              <div className="cred-center-stat">
                <span className="cred-center-stat-label">Accounts</span>
                <span className="cred-center-stat-value">{group.credentials.length}</span>
              </div>
            </div>
            <div className="cred-center-node-bar">
              <div className="cred-center-node-bar-fill" style={{ width: `${groupRate}%`, background: providerColor }} />
            </div>
          </div>
        </div>

        {/* Right credentials */}
        <div className="cred-topology-col cred-topology-right">
          {rightCreds.map((cred) => {
            const key = getCredKey(cred)
            return (
              <div key={key} ref={el => setCardRef(key, el)}
                className={`cred-topo-card ${selectedCred === key ? 'cred-topo-card--selected' : ''} ${cred.failure_count > 0 ? 'cred-topo-card--error' : ''}`}
                onClick={() => onCredClick(cred)}
              >
                <TopoCardContent cred={cred} providerColor={providerColor} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Content inside a topology credential card */
function TopoCardContent({ cred, providerColor }) {
  const displayName = cred.email || cred.source || cred.label || getCredKey(cred)
  const truncated = displayName.length > 20 ? displayName.slice(0, 18) + '...' : displayName
  const rateColor = getSuccessColor(cred.success_rate || 0)

  return (
    <>
      <div className="cred-topo-card-top">
        <span className="cred-topo-card-name" title={displayName}>{truncated}</span>
        <SuccessRing rate={cred.success_rate || 0} size={38} stroke={3} />
      </div>
      <div className="cred-topo-card-row">
        <div className="cred-topo-card-metric">
          <span className="cred-topo-card-metric-label">SUCCESS RATE</span>
          <span className="cred-topo-card-metric-value" style={{ color: rateColor }}>
            {cred.success_rate ?? 0}%
          </span>
        </div>
        <div className="cred-topo-card-metric">
          <span className="cred-topo-card-metric-label">VOLUME</span>
          <span className="cred-topo-card-metric-value">{formatNumber(cred.total_requests)}</span>
        </div>
      </div>
      <div className="cred-topo-card-badges">
        <span className="cred-topo-badge cred-topo-badge--success">{cred.success_count || 0}</span>
        <span className="cred-topo-badge cred-topo-badge--fail">{cred.failure_count || 0}</span>
      </div>
      {cred.failure_count > 0 && (
        <div className="cred-topo-card-error">
          {cred.failure_count} failed request{cred.failure_count > 1 ? 's' : ''}
        </div>
      )}
      {cred.api_keys?.length > 0 && (
        <div className="cred-topo-card-hint" title={cred.api_keys.join(', ')}>
          via {cred.api_keys.map(shortenApiKeyLabel).join(', ')}
        </div>
      )}
    </>
  )
}

/* ================================================================
   Credential Detail Dialog Content
   ================================================================ */
function CredentialDetailContent({ cred }) {
  if (!cred) return null
  const pc = getProviderDisplay(cred.provider)
  const providerColor = getProviderHex(cred.provider)
  const models = cred.models || {}
  const modelEntries = Object.entries(models).sort(([, a], [, b]) => (b.requests || 0) - (a.requests || 0))
  const maxModelReqs = Math.max(1, ...modelEntries.map(([, m]) => m.requests || 0))

  return (
    <div className="cred-dialog-content">
      {/* Summary pills */}
      <div className="cred-dialog-summary">
        <div className="cred-dialog-pill">
          <span className="cred-dialog-pill-n">{formatNumber(cred.total_requests)}</span>
          <span className="cred-dialog-pill-label">requests</span>
        </div>
        <div className="cred-dialog-pill cred-dialog-pill--success">
          <span className="cred-dialog-pill-n">{formatNumber(cred.success_count)}</span>
          <span className="cred-dialog-pill-label">success</span>
        </div>
        {cred.failure_count > 0 && (
          <div className="cred-dialog-pill cred-dialog-pill--danger">
            <span className="cred-dialog-pill-n">{formatNumber(cred.failure_count)}</span>
            <span className="cred-dialog-pill-label">failed</span>
          </div>
        )}
        <div className="cred-dialog-pill">
          <span className="cred-dialog-pill-n" style={{ color: getSuccessColor(cred.success_rate || 0) }}>
            {cred.success_rate ?? 0}%
          </span>
          <span className="cred-dialog-pill-label">success rate</span>
        </div>
        <div className="cred-dialog-pill">
          <span className="cred-dialog-pill-n">{formatNumber(cred.total_tokens)}</span>
          <span className="cred-dialog-pill-label">tokens</span>
        </div>
      </div>

      {/* Token breakdown */}
      {(cred.input_tokens > 0 || cred.output_tokens > 0) && (
        <div className="cred-dialog-tokens">
          <div className="cred-dialog-token">
            <span className="cred-dialog-token-label">Input</span>
            <span className="cred-dialog-token-value">{formatNumber(cred.input_tokens)}</span>
          </div>
          <div className="cred-dialog-token">
            <span className="cred-dialog-token-label">Output</span>
            <span className="cred-dialog-token-value">{formatNumber(cred.output_tokens)}</span>
          </div>
          {cred.cached_tokens > 0 && (
            <div className="cred-dialog-token">
              <span className="cred-dialog-token-label">Cached</span>
              <span className="cred-dialog-token-value" style={{ color: '#06b6d4' }}>{formatNumber(cred.cached_tokens)}</span>
            </div>
          )}
          {cred.reasoning_tokens > 0 && (
            <div className="cred-dialog-token">
              <span className="cred-dialog-token-label">Reasoning</span>
              <span className="cred-dialog-token-value" style={{ color: '#a855f7' }}>{formatNumber(cred.reasoning_tokens)}</span>
            </div>
          )}
        </div>
      )}

      {/* API Keys used */}
      {cred.api_keys?.length > 0 && (
        <div className="cred-dialog-apikeys">
          <span className="cred-dialog-apikeys-label">API Keys:</span>
          {cred.api_keys.map(k => <span key={k} className="cred-dialog-apikeys-tag" title={k}>{shortenApiKeyLabel(k)}</span>)}
        </div>
      )}

      {/* Model breakdown table */}
      {modelEntries.length > 0 ? (
        <div className="cred-dialog-models">
          <table className="cred-dialog-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Requests</th>
                <th>Success</th>
                <th>Failed</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {modelEntries.map(([modelName, m]) => {
                const barPct = maxModelReqs > 0 ? (m.requests / maxModelReqs) * 100 : 0
                return (
                  <tr key={modelName}>
                    <td>
                      <div className="cred-dialog-model-name">
                        <span className="cred-dialog-model-dot" style={{ background: providerColor }} />
                        {modelName}
                      </div>
                    </td>
                    <td>
                      <div className="cred-dialog-model-req">
                        <span>{formatNumber(m.requests)}</span>
                        <div className="cred-dialog-model-bar">
                          <div className="cred-dialog-model-bar-fill" style={{ width: `${barPct}%`, background: providerColor }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ color: '#10b981' }}>{formatNumber(m.success)}</td>
                    <td style={{ color: m.failure > 0 ? '#ef4444' : undefined }}>{m.failure || 0}</td>
                    <td>{formatNumber(m.total_tokens || m.tokens || 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cred-dialog-empty">No model data available</div>
      )}
    </div>
  )
}

/** Inline detail panel for desktop — shown to the right of topology */
function CredentialDetailPanel({ cred, onClose }) {
  if (!cred) return null
  const pc = getProviderDisplay(cred.provider)
  const displayName = cred.email || cred.source || cred.label || getCredKey(cred)

  return (
    <div className="cred-detail-side" key={getCredKey(cred)}>
      <div className="cred-detail-side-header">
        <div className="cred-detail-side-title">
          <span className="cred-detail-side-provider" style={{ background: getProviderHex(cred.provider) }}>
            {pc.name.charAt(0)}
          </span>
          <div className="cred-detail-side-info">
            <span className="cred-detail-side-name">{displayName}</span>
            <span className="cred-detail-side-sub">{pc.name}</span>
          </div>
        </div>
        <button className="cred-detail-side-close" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="cred-detail-side-body">
        <CredentialDetailContent cred={cred} />
      </div>
    </div>
  )
}

/* ================================================================
   Main Exported Component
   ================================================================ */
export default function CredentialStatsCard({ onRowClick, data, timeSeries, dateRange, isLoading, setupRequired }) {
  const [activeView, setActiveView] = useState('credentials')
  const [apiKeysSubView, setApiKeysSubView] = useState('overview')
  const [selectedCred, setSelectedCred] = useState(null)
  const [dialogCred, setDialogCred] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: 'total_requests', dir: 'desc' })
  const [expandedApiKey, setExpandedApiKey] = useState(null)
  const isDesktop = useIsDesktop(900)

  const credentials = data?.credentials || []
  const apiKeys = data?.api_keys || []
  const apiKeyDailySeries = timeSeries?.byDay || []
  const apiKeyHourlySeries = timeSeries?.byHour || []
  const hasRawSnapshots = timeSeries?.meta?.hasRawSnapshots !== false

  // Summary stats
  const summary = useMemo(() => {
    const totalReqs = credentials.reduce((s, c) => s + (c.total_requests || 0), 0)
    const totalSuccess = credentials.reduce((s, c) => s + (c.success_count || 0), 0)
    const totalFail = credentials.reduce((s, c) => s + (c.failure_count || 0), 0)
    const totalTokens = credentials.reduce((s, c) => s + (c.total_tokens || 0), 0)
    const overallRate = totalReqs > 0 ? Math.round((totalSuccess / totalReqs) * 100) : 0
    return { totalReqs, totalSuccess, totalFail, totalTokens, overallRate, credCount: credentials.length, apiKeyCount: apiKeys.length }
  }, [credentials, apiKeys])

  // Group credentials by provider
  const providerGroups = useMemo(() => {
    const groups = {}
    credentials.forEach((cred) => {
      const provider = cred.provider || 'unknown'
      if (!groups[provider]) groups[provider] = { credentials: [], totalReqs: 0 }
      groups[provider].credentials.push(cred)
      groups[provider].totalReqs += cred.total_requests || 0
    })
    return Object.entries(groups).sort(([, a], [, b]) => b.totalReqs - a.totalReqs)
  }, [credentials])

  // API Keys sorting
  const sortedApiKeys = useMemo(() => {
    const items = [...apiKeys]
    const { key, dir } = sortConfig
    items.sort((a, b) => {
      let aVal = a[key], bVal = b[key]
      if (typeof aVal === 'string') return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      aVal = aVal ?? 0; bVal = bVal ?? 0
      return dir === 'asc' ? aVal - bVal : bVal - aVal
    })
    return items
  }, [apiKeys, sortConfig])

  const handleSort = (key) => {
    setSortConfig((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }))
  }

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <span className="sort-icon">&#x21C5;</span>
    return <span className="sort-icon active">{sortConfig.dir === 'asc' ? '\u2191' : '\u2193'}</span>
  }

  const handleCredClick = (cred) => {
    const key = getCredKey(cred)
    setSelectedCred(prev => prev === key ? null : key)
    setDialogCred(cred)
  }

  // --- Render states ---
  if (setupRequired) {
    return (
      <div className="chart-card chart-full cred-stats-card">
        <div className="chart-header">
          <h3>Credential Usage Statistics</h3>
          <span className="cred-setup-badge">Setup Required</span>
        </div>
        <div className="empty-state" style={{ padding: '48px 24px' }}>
          <div className="cred-empty-title">Credential Tracking Not Configured</div>
          <div className="cred-empty-subtitle">
            Run migration <code className="cred-code">004_add_credential_usage_summary.sql</code> to enable.
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="chart-card chart-full cred-stats-card">
        <div className="chart-header"><h3>Credential Usage Statistics</h3></div>
        <div className="chart-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (credentials.length === 0 && apiKeys.length === 0) {
    return (
      <div className="chart-card chart-full cred-stats-card">
        <div className="chart-header"><h3>Credential Usage Statistics</h3></div>
        <div className="empty-state" style={{ padding: '48px 24px' }}>
          <div className="cred-empty-title">No Usage Data Yet</div>
          <div className="cred-empty-subtitle">Data will appear once the collector syncs credential stats from CLIProxy</div>
        </div>
      </div>
    )
  }

  const dialogTitle = dialogCred
    ? `${getProviderDisplay(dialogCred.provider).name} — ${dialogCred.email || dialogCred.source || getCredKey(dialogCred)}`
    : ''

  return (
    <div className="chart-card chart-full cred-stats-card">
      {/* Header */}
      <div className="chart-header">
        <h3>Credential Usage Statistics</h3>
        <ViewTabs activeView={activeView} onSwitch={(v) => {
          setActiveView(v)
          setSelectedCred(null)
          if (v !== 'api_keys') setApiKeysSubView('overview')
        }} />
      </div>

      {/* Summary Stats Bar */}
      <div className="cred-stats-bar">
        <div className="cred-stat-chip">
          <span className="cred-stat-chip-icon">&#x26A1;</span>
          <div className="cred-stat-chip-body">
            <span className="cred-stat-chip-label">ACCOUNTS</span>
            <span className="cred-stat-chip-value">{summary.credCount}</span>
          </div>
        </div>
        <div className="cred-stat-chip">
          <span className="cred-stat-chip-icon cred-stat-chip-icon--success">&#x25CF;</span>
          <div className="cred-stat-chip-body">
            <span className="cred-stat-chip-label">SUCCESS</span>
            <span className="cred-stat-chip-value cred-stat-chip-value--success">{formatNumber(summary.totalSuccess)}</span>
          </div>
        </div>
        <div className="cred-stat-chip">
          <span className="cred-stat-chip-icon cred-stat-chip-icon--danger">&#x2718;</span>
          <div className="cred-stat-chip-body">
            <span className="cred-stat-chip-label">FAILED</span>
            <span className="cred-stat-chip-value cred-stat-chip-value--danger">{formatNumber(summary.totalFail)}</span>
          </div>
        </div>
        <div className="cred-stat-chip">
          <span className="cred-stat-chip-icon cred-stat-chip-icon--rate">&#x2727;</span>
          <div className="cred-stat-chip-body">
            <span className="cred-stat-chip-label">SUCCESS RATE</span>
            <span className="cred-stat-chip-value" style={{ color: getSuccessColor(summary.overallRate) }}>{summary.overallRate}%</span>
          </div>
        </div>
        <div className="cred-stat-chip">
          <span className="cred-stat-chip-icon">&#x1F511;</span>
          <div className="cred-stat-chip-body">
            <span className="cred-stat-chip-label">API KEYS</span>
            <span className="cred-stat-chip-value">{summary.apiKeyCount}</span>
          </div>
        </div>
        <div className="cred-stat-chip">
          <span className="cred-stat-chip-icon">&#x2211;</span>
          <div className="cred-stat-chip-body">
            <span className="cred-stat-chip-label">TOKENS</span>
            <span className="cred-stat-chip-value">{formatNumber(summary.totalTokens)}</span>
          </div>
        </div>
      </div>

      {activeView === 'credentials' ? (
        <div className="cred-monitor-split">
          <div className="cred-monitor-body">
            {providerGroups.map(([provider, group]) => (
              <ProviderTopology
                key={provider}
                provider={provider}
                group={group}
                selectedCred={selectedCred}
                onCredClick={handleCredClick}
              />
            ))}
          </div>
          {isDesktop && dialogCred && (
            <CredentialDetailPanel
              cred={dialogCred}
              onClose={() => { setDialogCred(null); setSelectedCred(null) }}
            />
          )}
        </div>
      ) : (
        <div className="cred-monitor-body">
          <div className="cred-subtabs" role="tablist" aria-label="API Keys views">
            <button
              className={`cred-subtab ${apiKeysSubView === 'overview' ? 'active' : ''}`}
              onClick={() => setApiKeysSubView('overview')}
            >
              Overview
            </button>
            <button
              className={`cred-subtab ${apiKeysSubView === 'by_day' ? 'active' : ''}`}
              onClick={() => setApiKeysSubView('by_day')}
            >
              By Day
            </button>
            <button
              className={`cred-subtab ${apiKeysSubView === 'by_hour' ? 'active' : ''}`}
              onClick={() => setApiKeysSubView('by_hour')}
            >
              By Hour
            </button>
          </div>

          {apiKeysSubView === 'overview' && (
            <div className="table-wrapper cred-table-wrapper">
              <ApiKeysTable
                items={sortedApiKeys}
                onSort={handleSort}
                SortIcon={SortIcon}
                expandedRow={onRowClick ? null : expandedApiKey}
                setExpandedRow={setExpandedApiKey}
                onRowClick={onRowClick}
              />
            </div>
          )}

          {apiKeysSubView === 'by_day' && (
            <ApiKeyTimeSeriesChart
              rows={apiKeyDailySeries}
              bucketKey="stat_date"
              emptyMessage="No daily API key data in selected range"
            />
          )}

          {apiKeysSubView === 'by_hour' && (
            <>
              {!(dateRange === 'today' || dateRange === 'yesterday') && (
                <div className="cred-time-hint">
                  Tip: By Hour is most useful for today/yesterday to spot request peaks quickly.
                </div>
              )}
              {!hasRawSnapshots ? (
                <div className="cred-time-empty">
<<<<<<< HEAD
                  Hourly view is disabled until hourly API-key aggregates are available. Overview and By Day are still available.
=======
                  Hourly view needs usage snapshots with raw_data. Overview and By Day are still available.
>>>>>>> b3c67fc (📦 Auto-sync: 2026-06-15 23:46:59)
                </div>
              ) : (
                <ApiKeyTimeSeriesChart
                  rows={apiKeyHourlySeries}
                  bucketKey="hour"
                  emptyMessage="Not enough snapshot data to calculate hourly deltas"
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Sync timestamp */}
      {data?.synced_at && (
        <div className="cred-sync-footer">Last synced: {new Date(data.synced_at).toLocaleString()}</div>
      )}

      {/* Detail Dialog — mobile only */}
      <ChartDialog
        isOpen={dialogCred !== null && !isDesktop}
        onClose={() => { setDialogCred(null); setSelectedCred(null) }}
        title={dialogTitle}
      >
        <CredentialDetailContent cred={dialogCred} />
      </ChartDialog>
    </div>
  )
}

function ApiKeyTimeSeriesChart({ rows, bucketKey, emptyMessage }) {
  const PALETTE = ['#22d3ee', '#60a5fa', '#a78bfa', '#34d399', '#f59e0b']

  const topKeys = useMemo(() => {
    const totals = {}
    for (const row of (rows || [])) {
      for (const k of (row.keys || [])) {
        const name = k.api_key_name || 'unknown'
        if (!totals[name]) totals[name] = { requests: 0, cost: 0 }
        totals[name].requests += k.total_requests || 0
        totals[name].cost += k.estimated_cost_usd || 0
      }
    }
    return Object.entries(totals)
      .sort(([, a], [, b]) => b.requests - a.requests)
      .slice(0, 5)
      .map(([name]) => name)
  }, [rows])

  const requestData = useMemo(() => {
    if (!rows || !topKeys.length) return []
    return rows.map((row) => {
      const entry = { bucket: row[bucketKey] }
      for (const key of topKeys) {
        const keyRow = (row.keys || []).find((k) => k.api_key_name === key)
        entry[key] = keyRow?.total_requests || 0
      }
      return entry
    })
  }, [rows, bucketKey, topKeys])

  const costData = useMemo(() => {
    if (!rows || !topKeys.length) return []
    return rows.map((row) => {
      const entry = { bucket: row[bucketKey] }
      for (const key of topKeys) {
        const keyRow = (row.keys || []).find((k) => k.api_key_name === key)
        entry[key] = Number((keyRow?.estimated_cost_usd || 0).toFixed(4))
      }
      return entry
    })
  }, [rows, bucketKey, topKeys])

  const tooltipBoxStyle = {
    background: 'rgba(15, 23, 42, 0.95)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: 10,
    padding: '10px 14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(12px)',
  }

  if (!rows || rows.length === 0) {
    return <div className="cred-time-empty">{emptyMessage}</div>
  }

  if (!topKeys.length) {
    return <div className="cred-time-empty">No API key activity in selected range</div>
  }

  return (
    <div className="cred-time-chart-wrap">
      <div className="cred-u-chart-head">
        <span className="cred-u-chart-side">Requests</span>
        <span className="cred-u-chart-center">Time Range</span>
        <span className="cred-u-chart-side">Cost</span>
      </div>

      <div className="cred-u-chart-grid">
        <div className="cred-time-chart">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={requestData} margin={{ top: 10, right: 8, left: 8, bottom: 16 }}>
              <defs>
                {topKeys.map((key, idx) => (
                  <linearGradient key={`req-${key}`} id={`req-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE[idx % PALETTE.length]} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={PALETTE[idx % PALETTE.length]} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="bucket" tick={{ ...CHART_TYPOGRAPHY.axisTick, fill: '#94A3B8' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={{ ...CHART_TYPOGRAPHY.axisTick, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tooltipBoxStyle}
                labelStyle={{ color: '#F8FAFC', fontWeight: CHART_TYPOGRAPHY.tooltipLabel.fontWeight, fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily, fontSize: CHART_TYPOGRAPHY.tooltipLabel.fontSize }}
                itemStyle={{ color: '#CBD5E1', fontFamily: CHART_TYPOGRAPHY.tooltipItem.fontFamily, fontSize: CHART_TYPOGRAPHY.tooltipItem.fontSize }}
                formatter={(value, name) => [formatNumber(value || 0), shortenApiKeyLabel(name)]}
              />
              <Legend wrapperStyle={{ color: '#CBD5E1', fontSize: CHART_TYPOGRAPHY.legend.fontSize, fontFamily: CHART_TYPOGRAPHY.legend.fontFamily, fontWeight: CHART_TYPOGRAPHY.legend.fontWeight }} formatter={(v) => shortenApiKeyLabel(v)} />
              {topKeys.map((key, idx) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={shortenApiKeyLabel(key)}
                  stroke={PALETTE[idx % PALETTE.length]}
                  fill={`url(#req-grad-${idx})`}
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 6, strokeWidth: 2, fill: PALETTE[idx % PALETTE.length] }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="cred-time-chart">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={costData} margin={{ top: 10, right: 8, left: 8, bottom: 16 }}>
              <defs>
                {topKeys.map((key, idx) => (
                  <linearGradient key={`cost-${key}`} id={`cost-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE[idx % PALETTE.length]} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={PALETTE[idx % PALETTE.length]} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="bucket" tick={{ ...CHART_TYPOGRAPHY.axisTick, fill: '#94A3B8' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={{ ...CHART_TYPOGRAPHY.axisTick, fill: '#94A3B8' }} orientation="right" axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tooltipBoxStyle}
                labelStyle={{ color: '#F8FAFC', fontWeight: CHART_TYPOGRAPHY.tooltipLabel.fontWeight, fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily, fontSize: CHART_TYPOGRAPHY.tooltipLabel.fontSize }}
                itemStyle={{ color: '#CBD5E1', fontFamily: CHART_TYPOGRAPHY.tooltipItem.fontFamily, fontSize: CHART_TYPOGRAPHY.tooltipItem.fontSize }}
                formatter={(value, name) => [`$${Number(value || 0).toFixed(4)}`, shortenApiKeyLabel(name)]}
              />
              <Legend wrapperStyle={{ color: '#CBD5E1', fontSize: CHART_TYPOGRAPHY.legend.fontSize, fontFamily: CHART_TYPOGRAPHY.legend.fontFamily, fontWeight: CHART_TYPOGRAPHY.legend.fontWeight }} formatter={(v) => shortenApiKeyLabel(v)} />
              {topKeys.map((key, idx) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={shortenApiKeyLabel(key)}
                  stroke={PALETTE[idx % PALETTE.length]}
                  fill={`url(#cost-grad-${idx})`}
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 6, strokeWidth: 2, fill: PALETTE[idx % PALETTE.length] }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   API Keys Table
   ================================================================ */
function ApiKeysTable({ items, onSort, SortIcon, expandedRow, setExpandedRow, onRowClick }) {
  return (
    <>
      <table className="data-table cred-table">
        <thead>
          <tr>
            <th onClick={() => onSort('api_key_name')} className="sortable">API Key <SortIcon column="api_key_name" /></th>
            <th onClick={() => onSort('total_requests')} className="sortable">Requests <SortIcon column="total_requests" /></th>
            <th onClick={() => onSort('success_rate')} className="sortable">Success Rate <SortIcon column="success_rate" /></th>
            <th onClick={() => onSort('failure_count')} className="sortable">Failed <SortIcon column="failure_count" /></th>
            <th onClick={() => onSort('total_tokens')} className="sortable">Total Tokens <SortIcon column="total_tokens" /></th>
            <th onClick={() => onSort('input_tokens')} className="sortable">Input <SortIcon column="input_tokens" /></th>
            <th onClick={() => onSort('output_tokens')} className="sortable">Output <SortIcon column="output_tokens" /></th>
            <th>Credentials Used</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ak) => {
            const rateColor = getSuccessColor(ak.success_rate || 0)
            const isExpanded = expandedRow === ak.api_key_name
            return (
              <tr key={ak.api_key_name}
                className={`cred-row ${isExpanded ? 'cred-row-expanded' : ''}`}
                onClick={() => onRowClick ? onRowClick(ak, 'api_key') : setExpandedRow(isExpanded ? null : ak.api_key_name)}
              >
                <td><span className="cred-apikey-badge" title={ak.api_key_name}>{shortenApiKeyLabel(ak.api_key_name)}</span></td>
                <td className="cred-mono">{formatNumber(ak.total_requests)}</td>
                <td>
                  <div className="cred-health-cell">
                    <span className="cred-health-value" style={{ color: rateColor }}>{ak.success_rate ?? 0}%</span>
                    <MiniProgressBar percentage={ak.success_rate || 0} color={rateColor} />
                  </div>
                </td>
                <td className="cred-mono" style={{ color: ak.failure_count > 0 ? '#ef4444' : undefined }}>{ak.failure_count || 0}</td>
                <td className="cred-mono">{formatNumber(ak.total_tokens)}</td>
                <td className="cred-mono">{formatNumber(ak.input_tokens || 0)}</td>
                <td className="cred-mono">{formatNumber(ak.output_tokens || 0)}</td>
                <td className="cred-mono cred-center">{ak.credentials_used?.length || 0}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {expandedRow && (() => {
        const ak = items.find((a) => a.api_key_name === expandedRow)
        if (!ak?.models || Object.keys(ak.models).length === 0) return null
        const modelEntries = Object.entries(ak.models).sort(([, a], [, b]) => (b.requests || 0) - (a.requests || 0))
        return (
          <div className="cred-detail-panel">
            <div className="cred-detail-header">
              <span className="cred-apikey-badge" title={ak.api_key_name}>{shortenApiKeyLabel(ak.api_key_name)}</span>
              <span className="cred-detail-email">{ak.credentials_used?.length || 0} credentials used</span>
            </div>
            <div className="cred-detail-models">
              <div className="cred-detail-model cred-detail-model-header">
                <span className="cred-detail-model-name">Model</span>
                <div className="cred-detail-model-bar">
                  <span className="cred-detail-model-stats">Requests</span>
                  <span className="cred-detail-model-stats">Success</span>
                  <span className="cred-detail-model-stats">Failed</span>
                  <span className="cred-detail-model-stats">Tokens</span>
                </div>
              </div>
              {modelEntries.map(([modelName, m]) => (
                <div key={modelName} className="cred-detail-model">
                  <span className="cred-detail-model-name">{modelName}</span>
                  <div className="cred-detail-model-bar">
                    <span className="cred-detail-model-stats">{formatNumber(m.requests)}</span>
                    <span className="cred-detail-model-stats" style={{ color: '#10b981' }}>{formatNumber(m.success)}</span>
                    <span className="cred-detail-model-stats" style={{ color: m.failure > 0 ? '#ef4444' : undefined }}>{m.failure || 0}</span>
                    <span className="cred-detail-model-stats">{formatNumber(m.tokens)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </>
  )
}
