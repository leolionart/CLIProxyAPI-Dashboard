import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { getProviderDisplay } from '../lib/brandColors'
import './CredentialStatsCard.css'

/**
 * Credential Stats Card
 *
 * Shows real-time per-credential and per-API-key usage statistics
 * from CLIProxy. Data comes from credential_usage_summary table
 * which is populated by the collector's credential_stats_sync module.
 *
 * Data source: CLIProxy /v0/management/usage → details[] array
 * Each request detail contains: source, auth_index, tokens, failed
 */

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

const MiniProgressBar = ({ percentage, color }) => (
  <div className="cred-mini-progress">
    <div
      className="cred-mini-progress-fill"
      style={{
        width: `${Math.min(100, Math.max(0, percentage))}%`,
        background: `linear-gradient(90deg, ${color}, ${color}cc)`,
      }}
    />
  </div>
)

/**
 * Tabs component for switching between Credentials and API Keys views
 */
const ViewTabs = ({ activeView, onSwitch }) => (
  <div className="chart-tabs">
    <button
      className={`tab ${activeView === 'credentials' ? 'active' : ''}`}
      onClick={() => onSwitch('credentials')}
    >
      Credentials
    </button>
    <button
      className={`tab ${activeView === 'api_keys' ? 'active' : ''}`}
      onClick={() => onSwitch('api_keys')}
    >
      API Keys
    </button>
  </div>
)

export default function CredentialStatsCard() {
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [activeView, setActiveView] = useState('credentials')
  const [sortConfig, setSortConfig] = useState({ key: 'total_requests', dir: 'desc' })
  const [expandedRow, setExpandedRow] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        const { data: rows, error } = await supabase
          .from('credential_usage_summary')
          .select('*')
          .eq('id', 1)
          .single()

        if (error) {
          if (error.code === 'PGRST205' || error.message?.includes('relation') || error.message?.includes('does not exist') || error.message?.includes('Could not find')) {
            setSetupRequired(true)
          }
          throw error
        }

        setData(rows)
      } catch (err) {
        console.error('Error fetching credential stats:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 120_000)
    return () => clearInterval(interval)
  }, [])

  const credentials = data?.credentials || []
  const apiKeys = data?.api_keys || []

  // Sorting logic
  const sortedItems = useMemo(() => {
    const items = activeView === 'credentials' ? [...credentials] : [...apiKeys]
    const { key, dir } = sortConfig

    items.sort((a, b) => {
      let aVal = a[key], bVal = b[key]
      if (typeof aVal === 'string') {
        return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      aVal = aVal ?? 0
      bVal = bVal ?? 0
      return dir === 'asc' ? aVal - bVal : bVal - aVal
    })

    return items
  }, [credentials, apiKeys, activeView, sortConfig])

  // Summary
  const summary = useMemo(() => {
    const totalReqs = credentials.reduce((s, c) => s + (c.total_requests || 0), 0)
    const totalSuccess = credentials.reduce((s, c) => s + (c.success_count || 0), 0)
    const totalFail = credentials.reduce((s, c) => s + (c.failure_count || 0), 0)
    const totalTokens = credentials.reduce((s, c) => s + (c.total_tokens || 0), 0)
    const overallRate = totalReqs > 0 ? Math.round((totalSuccess / totalReqs) * 100) : 0

    return {
      totalReqs, totalSuccess, totalFail, totalTokens, overallRate,
      credCount: credentials.length,
      apiKeyCount: apiKeys.length,
    }
  }, [credentials, apiKeys])

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
  }

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <span className="sort-icon">&#x21C5;</span>
    return <span className="sort-icon active">{sortConfig.dir === 'asc' ? '\u2191' : '\u2193'}</span>
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
          <div className="cred-empty-subtitle">
            Data will appear once the collector syncs credential stats from CLIProxy
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chart-card chart-full cred-stats-card">
      {/* Header */}
      <div className="chart-header">
        <h3>Credential Usage Statistics</h3>
        <ViewTabs activeView={activeView} onSwitch={(v) => { setActiveView(v); setExpandedRow(null) }} />
      </div>

      {/* Summary Row */}
      <div className="cred-summary-row">
        <div className="cred-summary-stat">
          <div className="cred-summary-value">{formatNumber(summary.totalReqs)}</div>
          <div className="cred-summary-label">Total Requests</div>
        </div>
        <div className="cred-summary-stat">
          <div className="cred-summary-value" style={{ color: '#10b981' }}>{formatNumber(summary.totalSuccess)}</div>
          <div className="cred-summary-label">Success</div>
        </div>
        <div className="cred-summary-stat">
          <div className="cred-summary-value" style={{ color: '#ef4444' }}>{formatNumber(summary.totalFail)}</div>
          <div className="cred-summary-label">Failed</div>
        </div>
        <div className="cred-summary-stat">
          <div className="cred-summary-value" style={{ color: getSuccessColor(summary.overallRate) }}>{summary.overallRate}%</div>
          <div className="cred-summary-label">Success Rate</div>
        </div>
        <div className="cred-summary-stat">
          <div className="cred-summary-value">{formatNumber(summary.totalTokens)}</div>
          <div className="cred-summary-label">Total Tokens</div>
        </div>
        <div className="cred-summary-stat">
          <div className="cred-summary-value">{summary.credCount}</div>
          <div className="cred-summary-label">Credentials</div>
        </div>
        <div className="cred-summary-stat">
          <div className="cred-summary-value">{summary.apiKeyCount}</div>
          <div className="cred-summary-label">API Keys</div>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        {activeView === 'credentials' ? (
          <CredentialsTable
            items={sortedItems}
            onSort={handleSort}
            SortIcon={SortIcon}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
          />
        ) : (
          <ApiKeysTable
            items={sortedItems}
            onSort={handleSort}
            SortIcon={SortIcon}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
          />
        )}
      </div>

      {/* Sync timestamp */}
      {data?.synced_at && (
        <div className="cred-sync-footer">
          Last synced: {new Date(data.synced_at).toLocaleString()}
        </div>
      )}
    </div>
  )
}

/**
 * Credentials Table View
 */
function CredentialsTable({ items, onSort, SortIcon, expandedRow, setExpandedRow }) {
  return (
    <>
      <table className="data-table cred-table">
        <thead>
          <tr>
            <th onClick={() => onSort('provider')} className="sortable">Provider <SortIcon column="provider" /></th>
            <th onClick={() => onSort('email')} className="sortable">Credential <SortIcon column="email" /></th>
            <th onClick={() => onSort('total_requests')} className="sortable">Requests <SortIcon column="total_requests" /></th>
            <th onClick={() => onSort('success_rate')} className="sortable">Success Rate <SortIcon column="success_rate" /></th>
            <th onClick={() => onSort('failure_count')} className="sortable">Failed <SortIcon column="failure_count" /></th>
            <th onClick={() => onSort('total_tokens')} className="sortable">Tokens <SortIcon column="total_tokens" /></th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((cred) => {
            const pc = getProviderDisplay(cred.provider)
            const rateColor = getSuccessColor(cred.success_rate || 0)
            const key = cred.auth_index || cred.source || cred.email
            const isExpanded = expandedRow === key

            return (
              <tr
                key={key}
                className={`cred-row ${isExpanded ? 'cred-row-expanded' : ''}`}
                onClick={() => setExpandedRow(isExpanded ? null : key)}
              >
                <td>
                  <span className="cred-provider-badge" style={{ background: `var(${pc.colorVar})` }}>
                    {pc.name}
                  </span>
                </td>
                <td>
                  <div className="cred-email-cell">
                    <span className="cred-email">{cred.email || cred.source || '-'}</span>
                    {cred.api_keys?.length > 0 && (
                      <span className="cred-api-keys-hint">
                        via {cred.api_keys.join(', ')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="cred-mono">{formatNumber(cred.total_requests)}</td>
                <td>
                  <div className="cred-health-cell">
                    <span className="cred-health-value" style={{ color: rateColor }}>
                      {cred.success_rate ?? 0}%
                    </span>
                    <MiniProgressBar percentage={cred.success_rate || 0} color={rateColor} />
                  </div>
                </td>
                <td className="cred-mono" style={{ color: cred.failure_count > 0 ? '#ef4444' : undefined }}>
                  {cred.failure_count || 0}
                </td>
                <td className="cred-mono">{formatNumber(cred.total_tokens)}</td>
                <td>
                  <span className={`cred-status ${cred.status === 'active' ? 'active' : cred.status === 'error' ? 'error' : 'inactive'}`}>
                    <span className="cred-status-dot" />
                    {cred.status || '-'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Expanded model detail */}
      {expandedRow && (() => {
        const cred = items.find((c) => (c.auth_index || c.source || c.email) === expandedRow)
        if (!cred?.models || Object.keys(cred.models).length === 0) return null

        const pc = getProviderDisplay(cred.provider)
        const modelEntries = Object.entries(cred.models)
          .sort(([, a], [, b]) => (b.requests || 0) - (a.requests || 0))

        return (
          <div className="cred-detail-panel">
            <div className="cred-detail-header">
              <span className="cred-provider-badge" style={{ background: `var(${pc.colorVar})` }}>{pc.name}</span>
              <span className="cred-detail-email">{cred.email || cred.source}</span>
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
              {modelEntries.map(([modelName, m]) => {
                const mRate = m.requests > 0 ? Math.round((m.success / m.requests) * 100) : 0
                return (
                  <div key={modelName} className="cred-detail-model">
                    <span className="cred-detail-model-name">{modelName}</span>
                    <div className="cred-detail-model-bar">
                      <span className="cred-detail-model-stats">{formatNumber(m.requests)}</span>
                      <span className="cred-detail-model-stats" style={{ color: '#10b981' }}>{formatNumber(m.success)}</span>
                      <span className="cred-detail-model-stats" style={{ color: m.failure > 0 ? '#ef4444' : undefined }}>
                        {m.failure || 0}
                      </span>
                      <span className="cred-detail-model-stats">{formatNumber(m.total_tokens)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </>
  )
}

/**
 * API Keys Table View
 */
function ApiKeysTable({ items, onSort, SortIcon, expandedRow, setExpandedRow }) {
  return (
    <>
      <table className="data-table cred-table">
        <thead>
          <tr>
            <th onClick={() => onSort('api_key_name')} className="sortable">API Key <SortIcon column="api_key_name" /></th>
            <th onClick={() => onSort('total_requests')} className="sortable">Requests <SortIcon column="total_requests" /></th>
            <th onClick={() => onSort('success_rate')} className="sortable">Success Rate <SortIcon column="success_rate" /></th>
            <th onClick={() => onSort('failure_count')} className="sortable">Failed <SortIcon column="failure_count" /></th>
            <th onClick={() => onSort('total_tokens')} className="sortable">Tokens <SortIcon column="total_tokens" /></th>
            <th>Credentials Used</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ak) => {
            const rateColor = getSuccessColor(ak.success_rate || 0)
            const isExpanded = expandedRow === ak.api_key_name

            return (
              <tr
                key={ak.api_key_name}
                className={`cred-row ${isExpanded ? 'cred-row-expanded' : ''}`}
                onClick={() => setExpandedRow(isExpanded ? null : ak.api_key_name)}
              >
                <td>
                  <span className="cred-apikey-badge">{ak.api_key_name}</span>
                </td>
                <td className="cred-mono">{formatNumber(ak.total_requests)}</td>
                <td>
                  <div className="cred-health-cell">
                    <span className="cred-health-value" style={{ color: rateColor }}>
                      {ak.success_rate ?? 0}%
                    </span>
                    <MiniProgressBar percentage={ak.success_rate || 0} color={rateColor} />
                  </div>
                </td>
                <td className="cred-mono" style={{ color: ak.failure_count > 0 ? '#ef4444' : undefined }}>
                  {ak.failure_count || 0}
                </td>
                <td className="cred-mono">{formatNumber(ak.total_tokens)}</td>
                <td className="cred-mono cred-center">{ak.credentials_used?.length || 0}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Expanded model detail for API key */}
      {expandedRow && (() => {
        const ak = items.find((a) => a.api_key_name === expandedRow)
        if (!ak?.models || Object.keys(ak.models).length === 0) return null

        const modelEntries = Object.entries(ak.models)
          .sort(([, a], [, b]) => (b.requests || 0) - (a.requests || 0))

        return (
          <div className="cred-detail-panel">
            <div className="cred-detail-header">
              <span className="cred-apikey-badge">{ak.api_key_name}</span>
              <span className="cred-detail-email">
                {ak.credentials_used?.length || 0} credentials used
              </span>
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
                    <span className="cred-detail-model-stats" style={{ color: m.failure > 0 ? '#ef4444' : undefined }}>
                      {m.failure || 0}
                    </span>
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
