import { useState, useMemo, useEffect } from 'react'
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { BarGraph, PieGraph, DollarSign, Moon, Sun, Refresh } from './Icons'
import CredentialStatsCard from './CredentialStatsCard'
import ChartDialog from './ChartDialog'
import DrilldownPanel from './DrilldownPanel'
import { getModelColor } from '../lib/brandColors'

// Date Range Options - using identifiers for precise boundary logic
const DATE_RANGES = [
    { label: 'Today', id: 'today' },
    { label: 'Yesterday', id: 'yesterday' },
    { label: '7 Days', id: '7d' },
    { label: '30 Days', id: '30d' },
    { label: 'This Year', id: 'year' },
    { label: 'All Time', id: 'all' }
]

// Animated Stat Card Component
const StatCard = ({ label, value, meta, icon, sparklineData, dataKey, stroke }) => {
    const [animate, setAnimate] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => setAnimate(true), 100)
        return () => clearTimeout(timer)
    }, [])

    return (
        <div className="stat-card">
            <div className="stat-header">
                <span className="stat-label">{label}</span>
                <div className="stat-icon" style={{ backgroundColor: stroke }}>{icon}</div>
            </div>
            <div className="stat-value">{value}</div>
            <div className="stat-meta" dangerouslySetInnerHTML={{ __html: meta }}></div>
            <div className="stat-sparkline">
                <ResponsiveContainer width="100%" height={35}>
                    <AreaChart data={sparklineData}>
                        <defs>
                            <linearGradient id={`gradient-${dataKey}-${stroke.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
                                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <Area
                            type="monotone"
                            dataKey={dataKey}
                            stroke={stroke}
                            fill={`url(#gradient-${dataKey}-${stroke.replace('#', '')})`}
                            strokeWidth={1.5}
                            isAnimationActive={animate}
                            animationDuration={1500}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

// Custom Tooltip Component - Fintech Style
const CustomTooltip = ({ active, payload, label, isDarkMode, forceCurrency }) => {
    if (!active || !payload?.length) return null

    // Check for nested models (API Key Breakdown)
    const data = payload[0].payload
    const hasModels = data.models && Object.keys(data.models).length > 0

    return (
        <div style={{
            background: isDarkMode ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
            border: `1px solid ${isDarkMode ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.4)'}`,
            borderRadius: 10,
            padding: '10px 14px',
            boxShadow: isDarkMode
                ? '0 8px 24px rgba(0,0,0,0.4), 0 0 16px rgba(245, 158, 11, 0.15)'
                : '0 8px 24px rgba(0,0,0,0.1), 0 0 16px rgba(245, 158, 11, 0.1)',
            backdropFilter: 'blur(12px)',
            maxWidth: 250,
            zIndex: 100
        }}>
            <div style={{
                color: isDarkMode ? '#F8FAFC' : '#0F172A',
                fontWeight: 600,
                marginBottom: 6,
                fontFamily: 'Space Grotesk, sans-serif'
            }}>{label}</div>
            {payload.map((p, i) => (
                <div key={i} style={{
                    color: isDarkMode ? '#94A3B8' : '#475569',
                    fontSize: 12,
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center'
                }}>
                    <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: p.color,
                        boxShadow: `0 0 8px ${p.color}`
                    }}></span>
                    <span>{p.name}:</span>
                    <span style={{ fontWeight: 600, color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>
                        {typeof p.value === 'number' && (forceCurrency || p.name?.toLowerCase().includes('cost') || p.dataKey === 'estimated_cost_usd') ? `$${p.value.toFixed(4)}` : p.value?.toLocaleString()}
                    </span>
                </div>
            ))}

            {/* Model Breakdown for API Keys */}
            {hasModels && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(71, 85, 105, 0.1)'}`, paddingTop: 8 }}>
                    <div style={{ fontSize: 10, color: isDarkMode ? '#94A3B8' : '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Models</div>
                    {Object.entries(data.models)
                        .sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0))
                        .slice(0, 5)
                        .map(([mName, mData], i) => (
                        <div key={i} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', marginBottom: 3, alignItems: 'center' }}>
                            <span style={{ color: isDarkMode ? '#CBD5E1' : '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                                {mName}
                            </span>
                            <span style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: 'monospace', fontSize: 10 }}>
                                ${mData.cost?.toFixed(2) || '0.00'}
                            </span>
                        </div>
                    ))}
                    {Object.keys(data.models).length > 5 && (
                        <div style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic', textAlign: 'right', marginTop: 2 }}>
                            + {Object.keys(data.models).length - 5} more
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// Custom Label for API Keys chart to show requests and cost
const ApiKeyLabel = ({ x, y, width, height, value, data, isDarkMode }) => {
    const item = data
    if (!item) return null

    const labelX = x + width + 10
    const labelY = y + height / 2

    return (
        <g>
            <text
                x={labelX}
                y={labelY}
                fill={isDarkMode ? '#94A3B8' : '#475569'}
                fontSize={11}
                fontFamily="monospace"
                textAnchor="start"
                dominantBaseline="middle"
            >
                {value.toLocaleString()} req | ${item.cost?.toFixed(2) || '0.00'}
            </text>
        </g>
    )
}

// Trend configuration for the unified Usage Trends chart
const TREND_CONFIG = {
    requests: { stroke: '#3b82f6', name: 'Requests' },
    tokens: { stroke: '#10b981', name: 'Tokens' },
    cost: { stroke: '#f59e0b', name: 'Cost' },
}

function Dashboard({ stats, dailyStats, modelUsage, hourlyStats, loading, isRefreshing, lastUpdated, dateRange, onDateRangeChange, endpointUsage: rawEndpointUsage }) {
    // Auto-select time range based on dateRange: hour for today/yesterday, day for longer ranges
    const defaultTimeRange = (dateRange === 'today' || dateRange === 'yesterday') ? 'hour' : 'day'

    // Unified usage trend controls (replaces separate requestTimeRange, tokenTimeRange, modelSort)
    const [usageTrendMetric, setUsageTrendMetric] = useState('requests')
    const [usageTrendView, setUsageTrendView] = useState('models')
    const [usageTrendTime, setUsageTrendTime] = useState(defaultTimeRange)

    // Cost analysis view toggle
    const [costView, setCostView] = useState('chart')

    const [chartAnimated, setChartAnimated] = useState(false)
    const [tableSort, setTableSort] = useState({ column: 'estimated_cost_usd', direction: 'desc' })
    const [endpointSort, setEndpointSort] = useState('requests')
    const [drilldownData, setDrilldownData] = useState(null)
    const [isDarkMode, setIsDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('theme')
            if (saved) return saved === 'dark'
            return true
        }
        return true
    })

    // Auto-switch time range when dateRange changes
    useEffect(() => {
        const newTimeRange = (dateRange === 'today' || dateRange === 'yesterday') ? 'hour' : 'day'
        setUsageTrendTime(newTimeRange)
    }, [dateRange])

    useEffect(() => {
        const timer = setTimeout(() => setChartAnimated(true), 300)
        return () => clearTimeout(timer)
    }, [])

    // Re-trigger chart animation when switching views
    useEffect(() => {
        setChartAnimated(false)
        const timer = setTimeout(() => setChartAnimated(true), 50)
        return () => clearTimeout(timer)
    }, [usageTrendTime, usageTrendMetric, usageTrendView, costView])

    const toggleTheme = () => {
        setIsDarkMode(prev => {
            const newValue = !prev
            localStorage.setItem('theme', newValue ? 'dark' : 'light')
            return newValue
        })
    }

    // Use data directly from props (already filtered by API)
    const filteredDailyStats = dailyStats || []
    const filteredModelUsage = modelUsage || []

    // Calculate totals from filtered daily stats (properly filtered by date range)
    const totalRequests = filteredDailyStats.reduce((sum, d) => sum + (d.total_requests || 0), 0)
    const totalTokens = filteredDailyStats.reduce((sum, d) => sum + (d.total_tokens || 0), 0)
    const successCount = filteredDailyStats.reduce((sum, d) => sum + (d.success_count || 0), 0)
    const failureCount = filteredDailyStats.reduce((sum, d) => sum + (d.failure_count || 0), 0)

    // Use sum of model usage for total cost to ensure consistency with breakdown table
    const totalCostFromBreakdown = filteredModelUsage.reduce((sum, m) => sum + (m.estimated_cost_usd || 0), 0)
    const totalCostFromDaily = filteredDailyStats.reduce((sum, d) => sum + (parseFloat(d.estimated_cost_usd) || 0), 0)
    const totalCost = (filteredModelUsage.length > 0) ? totalCostFromBreakdown : totalCostFromDaily

    const daysCount = Math.max(1, filteredDailyStats.length || 1)
    const rpm = totalRequests > 0 ? (totalRequests / (daysCount * 24 * 60)).toFixed(2) : '0.00'
    const tpm = totalTokens > 0 ? Math.round(totalTokens / (daysCount * 24 * 60)) : 0

    const formatNumber = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
        if (num >= 1000) return (num / 1000).toFixed(2) + 'K'
        return num.toString()
    }

    const formatCost = (cost) => '$' + cost.toFixed(2)

    // Hourly data - with computed cost field
    const hourlyData = hourlyStats || []
    const hourlyChartData = useMemo(() => {
        return hourlyData.map(h => ({
            ...h,
            cost: Object.values(h.models || {}).reduce((sum, m) => sum + (m.cost || 0), 0)
        }))
    }, [hourlyData])

    // Daily data
    const dailyChartData = useMemo(() => {
        return (filteredDailyStats || []).map(d => ({
            time: new Date(d.stat_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            requests: d.total_requests,
            tokens: d.total_tokens,
            cost: parseFloat(d.estimated_cost_usd) || 0,
            models: d.models || {}
        }))
    }, [filteredDailyStats])

    // Top 5 Models for Trends
    const topRequestModels = useMemo(() => {
        return [...filteredModelUsage]
            .sort((a, b) => (b.request_count || 0) - (a.request_count || 0))
            .slice(0, 5)
            .map(m => m.model_name)
    }, [filteredModelUsage])

    const topTokenModels = useMemo(() => {
        return [...filteredModelUsage]
            .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))
            .slice(0, 5)
            .map(m => m.model_name)
    }, [filteredModelUsage])

    // Get active top models based on selected metric
    const activeTopModels = useMemo(() => {
        if (usageTrendMetric === 'cost') {
            return [...filteredModelUsage]
                .sort((a, b) => (b.estimated_cost_usd || 0) - (a.estimated_cost_usd || 0))
                .slice(0, 5)
                .map(m => m.model_name)
        }
        if (usageTrendMetric === 'tokens') return topTokenModels
        return topRequestModels
    }, [filteredModelUsage, usageTrendMetric, topRequestModels, topTokenModels])

    // Prepare data for Stacked Area Chart (By Model view)
    const modelTrendData = useMemo(() => {
        const sourceData = usageTrendTime === 'hour' ? hourlyChartData : dailyChartData

        return sourceData.map(point => {
            const newPoint = {
                time: point.time,
                _totalTokens: point.tokens || 0,
                _totalCost: point.cost || 0,
                _totalRequests: point.requests || 0,
            }
            activeTopModels.forEach(modelName => {
                const modelData = point.models?.[modelName]
                let val = 0

                if (modelData) {
                    if (usageTrendMetric === 'cost') val = modelData.cost || modelData.estimated_cost_usd || 0
                    else if (usageTrendMetric === 'tokens') val = modelData.tokens || modelData.total_tokens || 0
                    else val = modelData.requests || modelData.request_count || 0
                }

                newPoint[modelName] = val
            })
            return newPoint
        })
    }, [hourlyChartData, dailyChartData, usageTrendTime, activeTopModels, usageTrendMetric])

    // Token Type Breakdown data - input vs output per model
    const tokenTypeData = useMemo(() => {
        return (filteredModelUsage || [])
            .filter(m => (m.input_tokens > 0 || m.output_tokens > 0))
            .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))
            .slice(0, 10)
            .map(m => ({
                model: m.model_name?.split('-').slice(-2).join('-') || m.model_name,
                fullName: m.model_name,
                input_tokens: m.input_tokens || 0,
                output_tokens: m.output_tokens || 0,
                total_tokens: m.total_tokens || 0,
            }))
    }, [filteredModelUsage])

    // API Endpoint usage - uses granular endpointUsage passed from App.jsx
    const endpointUsage = useMemo(() => {
        const normalized = (rawEndpointUsage || [])
            .map(m => {
                const name = m.api_endpoint || 'Default'
                const cleanName = name.replace(/^https?:\/\//, '')
                const parts = cleanName.split('/')
                const displayName = parts.length > 1 && parts[parts.length - 1]
                    ? parts[parts.length - 1]
                    : parts[0]

                return {
                    endpoint: displayName,
                    requests: m.request_count || 0,
                    tokens: m.total_tokens || 0,
                    cost: m.estimated_cost_usd || 0,
                    ...m
                }
            })

        if (endpointSort === 'cost') {
            return normalized.sort((a, b) => (b.cost || 0) - (a.cost || 0))
        }
        return normalized.sort((a, b) => (b.requests || 0) - (a.requests || 0))
    }, [rawEndpointUsage, endpointSort])

    const sparklineData = hourlyChartData.slice(-12)
    const costSparkline = dailyChartData.length >= 2 ? dailyChartData : [...Array(7)].map((_, i) => ({ cost: i === 6 ? totalCost : totalCost * (i * 0.1) }))

    // Cost breakdown with sorting
    const costBreakdown = useMemo(() => {
        const data = (filteredModelUsage || []).map((m) => ({
            ...m,
            percentage: totalCost > 0 ? ((m.estimated_cost_usd || 0) / totalCost * 100).toFixed(0) : '0',
            color: getModelColor(m.model_name)
        }))

        return data.sort((a, b) => {
            let aVal = a[tableSort.column]
            let bVal = b[tableSort.column]

            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase()
                bVal = bVal.toLowerCase()
                return tableSort.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal)
            }

            return tableSort.direction === 'asc' ? aVal - bVal : bVal - aVal
        })
    }, [filteredModelUsage, totalCost, tableSort])

    // Handle table sort
    const handleSort = (column) => {
        setTableSort(prev => ({
            column,
            direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
        }))
    }

    const SortIcon = ({ column }) => {
        if (tableSort.column !== column) return <span className="sort-icon">↕</span>
        return <span className="sort-icon active">{tableSort.direction === 'asc' ? '↑' : '↓'}</span>
    }

    // Current trend visual config
    const currentTrend = TREND_CONFIG[usageTrendMetric]

    // Loading state
    if (loading) {
        return (
            <div className={`dashboard ${isDarkMode ? 'dark' : 'light'}`}>
                <div className="loading"><div className="spinner"></div></div>
            </div>
        )
    }

    return (
        <div className={`dashboard ${isDarkMode ? 'dark' : 'light'}`}>
            {/* Header */}
            <header className="header">
                <div className="header-left">
                    <h1>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75zM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 01-1.875-1.875V8.625zM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 013 19.875v-6.75z" />
                        </svg>
                        CLIProxyAPI Dashboard
                    </h1>
                </div>
                <div className="header-right">
                    <span className="last-updated">
                        {isRefreshing ? (
                            <span className="refreshing-indicator">
                                <span className="refreshing-dot"></span>
                                Loading...
                            </span>
                        ) : (
                            lastUpdated ? `Updated: ${lastUpdated.toLocaleTimeString()}` : ''
                        )}
                    </span>
                    {/* Date Range Selector */}
                    <div className="date-range-selector">
                        {DATE_RANGES.map(range => (
                            <button
                                key={range.id}
                                className={`date-btn ${dateRange === range.id ? 'active' : ''}`}
                                onClick={() => onDateRangeChange(range.id)}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>
                    <button className="refresh-btn" onClick={() => onDateRangeChange(dateRange, true)}>
                        <Refresh /> Refresh
                    </button>
                    <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
                        {isDarkMode ? <Sun /> : <Moon />}
                    </button>
                </div>
            </header>

            {/* Stats Cards - 3 consolidated cards */}
            <div className="stats-grid">
                <StatCard
                    label="TOTAL REQUESTS"
                    value={formatNumber(totalRequests)}
                    meta={`<span class="success">${formatNumber(successCount)} success</span> · <span class="failure">${formatNumber(failureCount)} failed</span> · RPM ${rpm}`}
                    icon={<BarGraph />}
                    sparklineData={sparklineData}
                    dataKey="requests"
                    stroke="#3b82f6"
                />
                <StatCard
                    label="TOTAL TOKENS"
                    value={formatNumber(totalTokens)}
                    meta={`TPM: ${formatNumber(tpm)}`}
                    icon={<PieGraph />}
                    sparklineData={sparklineData}
                    dataKey="tokens"
                    stroke="#f59e0b"
                />
                <StatCard
                    label="TOTAL COST"
                    value={<span className="cost-value">{formatCost(totalCost)}</span>}
                    meta="Estimated"
                    icon={<DollarSign />}
                    sparklineData={costSparkline}
                    dataKey="cost"
                    stroke="#10b981"
                />
            </div>

            {/* ===== Usage Trends (By Model × Metric × Time | Token Types) ===== */}
            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Usage Trends</h3>
                        <div className="chart-controls">
                            {usageTrendView === 'models' && (
                                <div className="chart-tabs">
                                    <button className={`tab ${usageTrendMetric === 'requests' ? 'active' : ''}`} onClick={() => setUsageTrendMetric('requests')}>Requests</button>
                                    <button className={`tab ${usageTrendMetric === 'tokens' ? 'active' : ''}`} onClick={() => setUsageTrendMetric('tokens')}>Tokens</button>
                                </div>
                            )}
                            <div className="chart-tabs">
                                <button className={`tab ${usageTrendView === 'models' ? 'active' : ''}`} onClick={() => setUsageTrendView('models')}>Models</button>
                                <button className={`tab ${usageTrendView === 'tokenTypes' ? 'active' : ''}`} onClick={() => setUsageTrendView('tokenTypes')}>Token Types</button>
                            </div>
                            {usageTrendView === 'models' && (
                                <div className="chart-tabs">
                                    <button className={`tab ${usageTrendTime === 'hour' ? 'active' : ''}`} onClick={() => setUsageTrendTime('hour')}>Hour</button>
                                    <button className={`tab ${usageTrendTime === 'day' ? 'active' : ''}`} onClick={() => setUsageTrendTime('day')}>Day</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="chart-body chart-body-dark">
                        {usageTrendView === 'models' ? (
                            <ResponsiveContainer width="100%" height={320}>
                                {modelTrendData.length > 0 ? (
                                    <AreaChart data={modelTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            {activeTopModels.map((modelName) => {
                                                const color = getModelColor(modelName)
                                                const safeId = modelName.replace(/[^a-zA-Z0-9]/g, '_')
                                                return (
                                                    <linearGradient key={safeId} id={`gradModel_${safeId}`} x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                                                        <stop offset="100%" stopColor={color} stopOpacity={0.03} />
                                                    </linearGradient>
                                                )
                                            })}
                                        </defs>
                                        <CartesianGrid strokeDasharray="4 4" stroke={isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                                        <XAxis dataKey="time" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                        <YAxis
                                            stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                            tick={{ fontSize: 11 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={formatNumber}
                                        />
                                        <Tooltip
                                            content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null
                                                const point = payload[0]?.payload
                                                const modelEntries = payload.filter(p => !p.dataKey.startsWith('_'))
                                                return (
                                                    <div style={{
                                                        background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.98)',
                                                        border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                                        borderRadius: 10,
                                                        padding: '10px 14px',
                                                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                                                        backdropFilter: 'blur(12px)',
                                                        maxWidth: 280,
                                                    }}>
                                                        <div style={{ fontWeight: 600, marginBottom: 8, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: 'Space Grotesk' }}>{label}</div>
                                                        <div style={{ display: 'flex', gap: 12, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
                                                            <div style={{ fontSize: 11 }}>
                                                                <span style={{ color: '#06b6d4' }}>Tokens</span>
                                                                <div style={{ fontWeight: 700, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: 'Space Grotesk' }}>{formatNumber(point?._totalTokens || 0)}</div>
                                                            </div>
                                                            <div style={{ fontSize: 11 }}>
                                                                <span style={{ color: '#f59e0b' }}>Cost</span>
                                                                <div style={{ fontWeight: 700, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: 'Space Grotesk' }}>${(point?._totalCost || 0).toFixed(2)}</div>
                                                            </div>
                                                            <div style={{ fontSize: 11 }}>
                                                                <span style={{ color: '#3b82f6' }}>Reqs</span>
                                                                <div style={{ fontWeight: 700, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: 'Space Grotesk' }}>{formatNumber(point?._totalRequests || 0)}</div>
                                                            </div>
                                                        </div>
                                                        {modelEntries.map((p, i) => (
                                                            <div key={i} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                                                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, boxShadow: `0 0 6px ${p.color}`, flexShrink: 0 }}></span>
                                                                <span style={{ color: isDarkMode ? '#94A3B8' : '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                                                <span style={{ fontWeight: 600, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: 'Space Grotesk', whiteSpace: 'nowrap' }}>
                                                                    {formatNumber(p.value)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )
                                            }}
                                        />
                                        <Legend
                                            verticalAlign="top"
                                            height={36}
                                            formatter={(value) => <span style={{ color: isDarkMode ? '#94A3B8' : '#475569', fontSize: 11 }}>{value}</span>}
                                        />
                                        {activeTopModels.map((modelName) => {
                                            const color = getModelColor(modelName)
                                            const safeId = modelName.replace(/[^a-zA-Z0-9]/g, '_')
                                            return (
                                                <Area
                                                    key={modelName}
                                                    type="monotone"
                                                    dataKey={modelName}
                                                    stroke={color}
                                                    fill={`url(#gradModel_${safeId})`}
                                                    strokeWidth={2}
                                                    dot={false}
                                                    activeDot={{ r: 4, strokeWidth: 2 }}
                                                    isAnimationActive={chartAnimated}
                                                    animationDuration={1500}
                                                />
                                            )
                                        })}
                                    </AreaChart>
                                ) : (
                                    <AreaChart data={[]}>
                                        <text x="50%" y="50%" textAnchor="middle" fill={isDarkMode ? '#64748B' : '#94A3B8'} fontSize={13}>No model data</text>
                                    </AreaChart>
                                )}
                            </ResponsiveContainer>
                        ) : (
                            /* Token Types: Input vs Output per model */
                            tokenTypeData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={Math.max(280, tokenTypeData.length * 40)}>
                                    <BarChart data={tokenTypeData} layout="vertical" margin={{ left: 10, right: 30 }}>
                                        <defs>
                                            <linearGradient id="gradInput" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.9} />
                                            </linearGradient>
                                            <linearGradient id="gradOutput" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                                                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.9} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} horizontal={false} />
                                        <XAxis type="number" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={formatNumber} />
                                        <YAxis type="category" dataKey="model" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 11 }} width={120} axisLine={false} tickLine={false} interval={0} />
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (!active || !payload?.length) return null
                                                const d = payload[0]?.payload
                                                return (
                                                    <div style={{
                                                        background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.98)',
                                                        border: `1px solid ${isDarkMode ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.4)'}`,
                                                        borderRadius: 10, padding: '10px 14px',
                                                        boxShadow: isDarkMode ? '0 8px 24px rgba(0,0,0,0.4)' : '0 8px 24px rgba(0,0,0,0.1)',
                                                    }}>
                                                        <div style={{ fontWeight: 600, color: isDarkMode ? '#F8FAFC' : '#0F172A', marginBottom: 6, fontFamily: 'Space Grotesk' }}>{d?.fullName}</div>
                                                        <div style={{ fontSize: 12, color: isDarkMode ? '#94A3B8' : '#475569' }}>
                                                            <div><span style={{ color: '#3b82f6' }}>Input:</span> <strong style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>{formatNumber(d?.input_tokens)}</strong></div>
                                                            <div><span style={{ color: '#f59e0b' }}>Output:</span> <strong style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>{formatNumber(d?.output_tokens)}</strong></div>
                                                            <div style={{ borderTop: '1px solid rgba(148,163,184,0.2)', marginTop: 4, paddingTop: 4 }}>
                                                                Ratio: <strong style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>{d?.input_tokens > 0 ? (d.output_tokens / d.input_tokens).toFixed(1) : '—'}x</strong> output/input
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }}
                                            cursor={false}
                                        />
                                        <Legend
                                            verticalAlign="top"
                                            height={30}
                                            formatter={(value) => <span style={{ color: isDarkMode ? '#94A3B8' : '#475569', fontSize: 12 }}>{value}</span>}
                                        />
                                        <Bar dataKey="input_tokens" name="Input Tokens" fill="url(#gradInput)" stroke="#3b82f6" strokeWidth={1} stackId="1" radius={[0, 0, 0, 0]}
                                            isAnimationActive={chartAnimated} animationDuration={1500} />
                                        <Bar dataKey="output_tokens" name="Output Tokens" fill="url(#gradOutput)" stroke="#f59e0b" strokeWidth={1} stackId="1" radius={[0, 4, 4, 0]}
                                            isAnimationActive={chartAnimated} animationDuration={1500} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="empty-state" style={{ minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    No token type breakdown data available
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* ===== Cost Analysis (unified: Pie Chart + Details Table) ===== */}
            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Cost Analysis</h3>
                        <div className="chart-tabs">
                            <button className={`tab ${costView === 'chart' ? 'active' : ''}`} onClick={() => setCostView('chart')}>Chart</button>
                            <button className={`tab ${costView === 'details' ? 'active' : ''}`} onClick={() => setCostView('details')}>Details</button>
                        </div>
                    </div>
                    {costView === 'chart' ? (
                        <div className="chart-body chart-body-dark pie-container" style={{ minHeight: 300 }}>
                            {costBreakdown.length > 0 ? (
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart onClick={() => {
                                        if (costBreakdown.length > 0) {
                                            const models = {}
                                            costBreakdown.forEach(m => {
                                                models[m.model_name] = {
                                                    requests: m.request_count,
                                                    tokens: m.total_tokens,
                                                    cost: m.estimated_cost_usd
                                                }
                                            })
                                            setDrilldownData({ label: 'All Models', data: { models }, chartType: 'cost', title: 'Cost Breakdown — All Models' })
                                        }
                                    }}>
                                        <Pie
                                            data={costBreakdown}
                                            dataKey="estimated_cost_usd"
                                            nameKey="model_name"
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={110}
                                            innerRadius={65}
                                            label={({ model_name, percentage }) => `${model_name?.split('-').slice(-2).join('-') || ''} ${percentage}%`}
                                            labelLine={{ stroke: isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }}
                                            stroke={isDarkMode ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)'}
                                            strokeWidth={2}
                                            isAnimationActive={chartAnimated}
                                            animationDuration={1500}
                                        >
                                            {costBreakdown.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.85} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} forceCurrency={true} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="empty-state">No cost data</div>
                            )}
                        </div>
                    ) : (
                        <div className="table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th onClick={() => handleSort('model_name')} className="sortable">
                                            Model <SortIcon column="model_name" />
                                        </th>
                                        <th onClick={() => handleSort('request_count')} className="sortable">
                                            Requests <SortIcon column="request_count" />
                                        </th>
                                        <th onClick={() => handleSort('input_tokens')} className="sortable">
                                            Input Tokens <SortIcon column="input_tokens" />
                                        </th>
                                        <th onClick={() => handleSort('output_tokens')} className="sortable">
                                            Output Tokens <SortIcon column="output_tokens" />
                                        </th>
                                        <th onClick={() => handleSort('total_tokens')} className="sortable">
                                            Total Tokens <SortIcon column="total_tokens" />
                                        </th>
                                        <th onClick={() => handleSort('estimated_cost_usd')} className="sortable">
                                            Cost <SortIcon column="estimated_cost_usd" />
                                        </th>
                                        <th onClick={() => handleSort('percentage')} className="sortable">
                                            % <SortIcon column="percentage" />
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {costBreakdown.length > 0 ? costBreakdown.map((m, i) => (
                                        <tr key={i} className="clickable-row" onClick={() => {
                                            const apiKeyRows = endpointUsage
                                                .filter(ep => ep.models?.[m.model_name])
                                                .map(ep => {
                                                    const md = ep.models[m.model_name]
                                                    return {
                                                        _key: ep.endpoint,
                                                        apiKey: ep.endpoint,
                                                        requests: md.requests || md.request_count || 0,
                                                        tokens: md.tokens || md.total_tokens || 0,
                                                        cost: md.cost || md.estimated_cost_usd || 0,
                                                    }
                                                })
                                                .sort((a, b) => b.requests - a.requests)
                                            setDrilldownData({
                                                label: m.model_name,
                                                title: `${m.model_name} — Per API Key`,
                                                chartType: 'modelApiKeys',
                                                columns: [
                                                    { key: 'apiKey', label: 'API Key' },
                                                    { key: 'requests', label: 'Requests', render: v => formatNumber(v) },
                                                    { key: 'tokens', label: 'Tokens', render: v => formatNumber(v) },
                                                    { key: 'cost', label: 'Cost', render: v => `$${v.toFixed(4)}` },
                                                ],
                                                rows: apiKeyRows,
                                            })
                                        }}>
                                            <td><span className="color-dot" style={{ background: m.color }}></span>{m.model_name}</td>
                                            <td>{formatNumber(m.request_count)}</td>
                                            <td>{formatNumber(m.input_tokens)}</td>
                                            <td>{formatNumber(m.output_tokens)}</td>
                                            <td>{formatNumber(m.total_tokens)}</td>
                                            <td className="cost">{formatCost(m.estimated_cost_usd || 0)}</td>
                                            <td>{m.percentage}%</td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan="7" className="empty">No data</td></tr>
                                    )}
                                </tbody>
                                {costBreakdown.length > 0 && (
                                    <tfoot>
                                        <tr>
                                            <td><strong>Total</strong></td>
                                            <td><strong>{formatNumber((filteredModelUsage || []).reduce((s, m) => s + m.request_count, 0))}</strong></td>
                                            <td><strong>{formatNumber((filteredModelUsage || []).reduce((s, m) => s + m.input_tokens, 0))}</strong></td>
                                            <td><strong>{formatNumber((filteredModelUsage || []).reduce((s, m) => s + m.output_tokens, 0))}</strong></td>
                                            <td><strong>{formatNumber((filteredModelUsage || []).reduce((s, m) => s + m.total_tokens, 0))}</strong></td>
                                            <td className="cost"><strong>{formatCost(totalCost)}</strong></td>
                                            <td><strong>100%</strong></td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* ===== API Keys ===== */}
            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>API Keys ({endpointUsage.length})</h3>
                        <div className="chart-tabs">
                            <button className={`tab ${endpointSort === 'requests' ? 'active' : ''}`} onClick={() => setEndpointSort('requests')}>Requests</button>
                            <button className={`tab ${endpointSort === 'cost' ? 'active' : ''}`} onClick={() => setEndpointSort('cost')}>Cost</button>
                        </div>
                    </div>
                    <div className="chart-body chart-body-dark">
                        {endpointUsage.length > 0 ? (
                            <ResponsiveContainer width="100%" height={Math.max(200, endpointUsage.length * 45)}>
                                <BarChart data={endpointUsage} layout="vertical" margin={{ left: 10, right: 150 }} onClick={(data) => {
                                    if (data?.activePayload?.[0]?.payload?.models) {
                                        const point = data.activePayload[0].payload
                                        setDrilldownData({ label: point.endpoint, data: point, chartType: 'apikeys' })
                                    }
                                }}>
                                    <defs>
                                        <linearGradient id="gradApiKeys" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} horizontal={false} />
                                    <XAxis type="number" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis
                                        type="category"
                                        dataKey="endpoint"
                                        stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                        tick={{ fontSize: 12 }}
                                        width={150}
                                        axisLine={false}
                                        tickLine={false}
                                        interval={0}
                                    />
                                    <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} cursor={false} />
                                    <Bar
                                        dataKey={endpointSort === 'cost' ? 'cost' : 'requests'}
                                        name={endpointSort === 'cost' ? 'Cost ($)' : 'Requests'}
                                        fill="url(#gradApiKeys)"
                                        stroke="#8b5cf6"
                                        strokeWidth={1}
                                        radius={[0, 4, 4, 0]}
                                        isAnimationActive={chartAnimated}
                                        animationDuration={1500}
                                        minPointSize={2}
                                        label={(props) => <ApiKeyLabel {...props} data={endpointUsage[props.index]} isDarkMode={isDarkMode} />}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="empty-state">No endpoint data</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Credential Stats - Usage rates and limits per credential */}
            <div className="charts-row">
                <CredentialStatsCard isDarkMode={isDarkMode} onRowClick={(item, type) => {
                    if (!item?.models || Object.keys(item.models).length === 0) return
                    const label = type === 'api_key' ? item.api_key_name : (item.email || item.source || 'Unknown')
                    const modelRows = Object.entries(item.models)
                        .map(([name, m]) => ({
                            _key: name,
                            model: name,
                            requests: m.requests || 0,
                            success: m.success || 0,
                            failed: m.failure || 0,
                            tokens: m.total_tokens || m.tokens || 0,
                        }))
                        .sort((a, b) => b.requests - a.requests)
                    setDrilldownData({
                        label,
                        title: `${label} — Model Breakdown`,
                        chartType: 'credential',
                        columns: [
                            { key: 'model', label: 'Model' },
                            { key: 'requests', label: 'Requests', render: v => formatNumber(v) },
                            { key: 'success', label: 'Success', render: v => formatNumber(v) },
                            { key: 'failed', label: 'Failed', render: (v) => v > 0 ? v : '0' },
                            { key: 'tokens', label: 'Tokens', render: v => formatNumber(v) },
                        ],
                        rows: modelRows,
                    })
                }} />
            </div>

            {/* Drilldown Dialog - shows when clicking a data point on any chart */}
            <ChartDialog
                isOpen={drilldownData !== null}
                onClose={() => setDrilldownData(null)}
                title={drilldownData?.title || `Breakdown: ${drilldownData?.label || ''}`}
            >
                {drilldownData?.columns ? (
                    <DrilldownPanel
                        columns={drilldownData.columns}
                        rows={drilldownData.rows}
                    />
                ) : drilldownData ? (
                    <DrilldownPanel
                        data={drilldownData.data}
                    />
                ) : null}
            </ChartDialog>
        </div>
    )
}

export default Dashboard
