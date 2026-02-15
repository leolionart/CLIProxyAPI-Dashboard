import { useState, useMemo, useEffect } from 'react'
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import { BarGraph, PieGraph, DollarSign, Zap, Clock, Moon, Sun, Refresh } from './Icons'
import CredentialStatsCard from './CredentialStatsCard'


const COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1']

// Brand colors for AI providers (optimized for contrast and recognition)
const BRAND_COLORS = {
    // OpenAI - Green (official brand color)
    'openai': '#10a37f',
    'gpt': '#10a37f',
    'o1': '#10a37f',
    'o3': '#10a37f',
    'chatgpt': '#10a37f',

    // Anthropic - Orange/Copper (official brand color)
    'anthropic': '#d97757',
    'claude': '#d97757',

    // Google - Multi-color but primarily Blue for Gemini
    'google': '#4285f4',
    'gemini': '#4285f4',
    'palm': '#34a853',
    'bard': '#fbbc04',

    // DeepSeek - Purple
    'deepseek': '#8b5cf6',

    // Alibaba/Qwen - Orange
    'qwen': '#ff6a00',
    'alibaba': '#ff6a00',

    // Meta - Blue
    'meta': '#0668e1',
    'llama': '#0668e1',

    // Mistral - Dark Purple/Indigo
    'mistral': '#6366f1',

    // xAI/Grok - Dark slate
    'grok': '#64748b',
    'xai': '#64748b',

    // Cohere - Teal
    'cohere': '#14b8a6',

    // AI21 - Purple
    'ai21': '#a855f7',
    'jurassic': '#a855f7',

    // Fallback
    'unknown': '#94a3b8'
}

// Intelligent color mapping based on model provider branding
const getModelColor = (modelName) => {
    if (!modelName) return BRAND_COLORS.unknown

    const modelLower = modelName.toLowerCase()

    // Check each brand keyword
    for (const [keyword, color] of Object.entries(BRAND_COLORS)) {
        if (modelLower.includes(keyword)) {
            return color
        }
    }

    // Fallback to hash-based color for unknown models (for consistency)
    let hash = 0
    for (let i = 0; i < modelName.length; i++) {
        hash = modelName.charCodeAt(i) + ((hash << 5) - hash)
    }
    return COLORS[Math.abs(hash) % COLORS.length]
}

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

function Dashboard({ stats, dailyStats, modelUsage, hourlyStats, loading, isRefreshing, lastUpdated, dateRange, onDateRangeChange, endpointUsage: rawEndpointUsage }) {
    // Auto-select time range based on dateRange: hour for today/yesterday, day for longer ranges
    const defaultTimeRange = (dateRange === 'today' || dateRange === 'yesterday') ? 'hour' : 'day'

    const [requestTimeRange, setRequestTimeRange] = useState(defaultTimeRange)
    const [tokenTimeRange, setTokenTimeRange] = useState(defaultTimeRange)
    const [chartAnimated, setChartAnimated] = useState(false)
    const [tableSort, setTableSort] = useState({ column: 'estimated_cost_usd', direction: 'desc' })
    const [endpointSort, setEndpointSort] = useState('requests') // 'requests' or 'cost'
    const [modelSort, setModelSort] = useState('requests') // 'requests' or 'cost'
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
        setRequestTimeRange(newTimeRange)
        setTokenTimeRange(newTimeRange)
    }, [dateRange])

    useEffect(() => {
        const timer = setTimeout(() => setChartAnimated(true), 300)
        return () => clearTimeout(timer)
    }, [])

    // Re-trigger animation when switching chart tabs
    useEffect(() => {
        setChartAnimated(false)
        const timer = setTimeout(() => setChartAnimated(true), 50)
        return () => clearTimeout(timer)
    }, [requestTimeRange, tokenTimeRange])

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
    // Fallback to daily stats sum if model usage is empty (e.g. legacy data)
    const totalCostFromBreakdown = filteredModelUsage.reduce((sum, m) => sum + (m.estimated_cost_usd || 0), 0)
    const totalCostFromDaily = filteredDailyStats.reduce((sum, d) => sum + (parseFloat(d.estimated_cost_usd) || 0), 0)

    // Prefer breakdown sum if available and significant, otherwise use daily stats
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

    // Hourly data - now comes from App.jsx with accurate delta calculations
    const hourlyData = hourlyStats || []

    // Daily data
    const dailyChartData = useMemo(() => {
        return (filteredDailyStats || []).map(d => ({
            time: new Date(d.stat_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            requests: d.total_requests,
            tokens: d.total_tokens,
            cost: parseFloat(d.estimated_cost_usd) || 0,
            models: d.models || {} // Pass through breakdown
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

    // Get active top models based on sort dimension
    const activeTopModels = useMemo(() => {
        if (modelSort === 'cost') {
            return [...filteredModelUsage]
                .sort((a, b) => (b.estimated_cost_usd || 0) - (a.estimated_cost_usd || 0))
                .slice(0, 5)
                .map(m => m.model_name)
        }
        if (modelSort === 'tokens') return topTokenModels
        return topRequestModels
    }, [filteredModelUsage, modelSort, topRequestModels, topTokenModels])

    // Prepare data for Stacked Area Chart (Model Trends)
    const modelTrendData = useMemo(() => {
        const sourceData = (requestTimeRange === 'hour' ? hourlyData : dailyChartData)

        return sourceData.map(point => {
            const newPoint = { time: point.time }
            // Flatten models
            activeTopModels.forEach(modelName => {
                const modelData = point.models?.[modelName]
                let val = 0

                if (modelData) {
                    if (modelSort === 'cost') val = modelData.cost || modelData.estimated_cost_usd || 0
                    else if (modelSort === 'tokens') val = modelData.tokens || modelData.total_tokens || 0
                    else val = modelData.requests || modelData.request_count || 0
                }

                newPoint[modelName] = val
            })
            return newPoint
        })
    }, [hourlyData, dailyChartData, requestTimeRange, activeTopModels, modelSort])

    // Model distribution - uses filtered model usage data
    const stackedModelData = useMemo(() => {
        if (!filteredModelUsage.length) return []

        const modelCounts = {}
        for (const model of filteredModelUsage) {
            const name = model.model_name
            if (!modelCounts[name]) {
                modelCounts[name] = { requests: 0, tokens: 0, cost: 0 }
            }
            modelCounts[name].requests += model.request_count || 0
            modelCounts[name].tokens += model.total_tokens || 0
            modelCounts[name].cost += model.estimated_cost_usd || 0
        }

        const data = Object.entries(modelCounts)
            .map(([name, values]) => ({ model: name, ...values }))
        if (modelSort === 'cost') {
            return data.sort((a, b) => (b.cost || 0) - (a.cost || 0))
        }
        return data.sort((a, b) => b.requests - a.requests)
    }, [filteredModelUsage, modelSort])

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
                    ...m // Include other props like model_name
                }
            })

        if (endpointSort === 'cost') {
            return normalized.sort((a, b) => (b.cost || 0) - (a.cost || 0))
        }
        return normalized.sort((a, b) => (b.requests || 0) - (a.requests || 0))
    }, [rawEndpointUsage, endpointSort])

    const sparklineData = hourlyData.slice(-12)
    const costSparkline = dailyChartData.length >= 2 ? dailyChartData : [...Array(7)].map((_, i) => ({ cost: i === 6 ? totalCost : totalCost * (i * 0.1) }))

    // Cost breakdown with sorting
    const costBreakdown = useMemo(() => {
        const data = (filteredModelUsage || []).map((m) => ({
            ...m,
            percentage: totalCost > 0 ? ((m.estimated_cost_usd || 0) / totalCost * 100).toFixed(0) : '0',
            color: getModelColor(m.model_name)  // Use consistent color based on model name
        }))

        // Sort based on tableSort
        return data.sort((a, b) => {
            let aVal = a[tableSort.column]
            let bVal = b[tableSort.column]

            // Handle string vs number
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

            {/* Stats Cards */}
            <div className="stats-grid">
                <StatCard
                    label="TOTAL REQUESTS"
                    value={formatNumber(totalRequests)}
                    meta={`<span class="success">Success: ${successCount}</span> · <span class="failure">Failed: ${failureCount}</span>`}
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
                    label="RPM"
                    value={rpm}
                    meta={`Requests: ${totalRequests}`}
                    icon={<Zap />}
                    sparklineData={sparklineData}
                    dataKey="requests"
                    stroke="#10b981"
                />
                <StatCard
                    label="TPM"
                    value={formatNumber(tpm)}
                    meta={`Tokens: ${formatNumber(totalTokens)}`}
                    icon={<Clock />}
                    sparklineData={sparklineData}
                    dataKey="tokens"
                    stroke="#8b5cf6"
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

            {/* Charts Row 1 */}
            <div className="charts-row">
                <div className="chart-card chart-large">
                    <div className="chart-header">
                        <h3>Request Trends</h3>
                        <div className="chart-tabs">
                            <button className={`tab ${requestTimeRange === 'hour' ? 'active' : ''}`} onClick={() => setRequestTimeRange('hour')}>Hour</button>
                            <button className={`tab ${requestTimeRange === 'day' ? 'active' : ''}`} onClick={() => setRequestTimeRange('day')}>Day</button>
                        </div>
                    </div>
                    <div className="chart-body">
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={requestTimeRange === 'hour' ? hourlyData : dailyChartData}>
                                <defs>
                                    <linearGradient id="requestGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                                <Area
                                    type="monotone"
                                    dataKey="requests"
                                    name="Requests"
                                    stroke="#3b82f6"
                                    fill="url(#requestGradient)"
                                    strokeWidth={2}
                                    isAnimationActive={chartAnimated}
                                    animationDuration={2000}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="chart-card chart-small">
                    <div className="chart-header">
                        <h3>💰 Cost Breakdown</h3>
                    </div>
                    <div className="chart-body pie-container">
                        {costBreakdown.length > 0 ? (
                            <ResponsiveContainer width="100%" height={200}>
                                <PieChart>
                                    <Pie
                                        data={costBreakdown}
                                        dataKey="estimated_cost_usd"
                                        nameKey="model_name"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={70}
                                        innerRadius={40}
                                        label={({ percentage }) => `${percentage}%`}
                                        labelLine={false}
                                        isAnimationActive={chartAnimated}
                                        animationDuration={1500}
                                    >
                                        {costBreakdown.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} forceCurrency={true} />} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="empty-state">No cost data</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Token Usage Trends */}
            <div className="charts-row">
                <div className="chart-card chart-full">
                    <div className="chart-header">
                        <h3>Token Usage Trends</h3>
                        <div className="chart-tabs">
                            <button className={`tab ${tokenTimeRange === 'hour' ? 'active' : ''}`} onClick={() => setTokenTimeRange('hour')}>Hour</button>
                            <button className={`tab ${tokenTimeRange === 'day' ? 'active' : ''}`} onClick={() => setTokenTimeRange('day')}>Day</button>
                        </div>
                    </div>
                    <div className="chart-body">
                        <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={tokenTimeRange === 'hour' ? hourlyData : dailyChartData}>
                                <defs>
                                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatNumber} />
                                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                                <Area
                                    type="monotone"
                                    dataKey="tokens"
                                    name="Tokens"
                                    stroke="#10b981"
                                    fill="url(#tokenGradient)"
                                    strokeWidth={2}
                                    isAnimationActive={chartAnimated}
                                    animationDuration={2000}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Model Usage & API Endpoints */}
            <div className="charts-row">
                <div className="chart-card chart-half">
                    <div className="chart-header">
                        <h3>📊 Model Usage (Top 5 Trends)</h3>
                        <div className="chart-tabs">
                            <button className={`tab ${modelSort === 'requests' ? 'active' : ''}`} onClick={() => setModelSort('requests')}>Reqs</button>
                            <button className={`tab ${modelSort === 'tokens' ? 'active' : ''}`} onClick={() => setModelSort('tokens')}>Toks</button>
                            <button className={`tab ${modelSort === 'cost' ? 'active' : ''}`} onClick={() => setModelSort('cost')}>Cost</button>
                        </div>
                    </div>
                    <div className="chart-body">
                        {modelTrendData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={220}>
                                <AreaChart data={modelTrendData}>
                                    <XAxis dataKey="time" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={modelSort === 'cost' ? (val) => `$${val}` : formatNumber} />
                                    <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} forceCurrency={modelSort === 'cost'} />} />
                                    {activeTopModels.map((modelName, index) => (
                                        <Area
                                            key={modelName}
                                            type="monotone"
                                            dataKey={modelName}
                                            stackId="1"
                                            stroke={getModelColor(modelName)}
                                            fill={getModelColor(modelName)}
                                            fillOpacity={0.6}
                                            strokeWidth={1}
                                            isAnimationActive={chartAnimated}
                                            animationDuration={1500}
                                        />
                                    ))}
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="empty-state">No model data</div>
                        )}
                    </div>
                </div>

                <div className="chart-card chart-half">
                    <div className="chart-header">
                        <h3>🔑 API Keys ({endpointUsage.length})</h3>
                        <div className="chart-tabs">
                            <button className={`tab ${endpointSort === 'requests' ? 'active' : ''}`} onClick={() => setEndpointSort('requests')}>Requests</button>
                            <button className={`tab ${endpointSort === 'cost' ? 'active' : ''}`} onClick={() => setEndpointSort('cost')}>Cost</button>
                        </div>
                    </div>
                    <div className="chart-body">
                        {endpointUsage.length > 0 ? (
                            <ResponsiveContainer width="100%" height={Math.max(200, endpointUsage.length * 45)}>
                                <BarChart data={endpointUsage} layout="vertical" margin={{ left: 10, right: 150 }}>
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
                                        fill="#8b5cf6"
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

            {/* Cost Details Table */}
            <div className="chart-card">
                <div className="chart-header">
                    <h3>💵 Cost Details by Model</h3>
                </div>
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
                                <tr key={i}>
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
            </div>

            {/* Credential Stats - Usage rates and limits per credential */}
            <CredentialStatsCard isDarkMode={isDarkMode} />
        </div>
    )
}

export default Dashboard
