import { useState, useMemo, useEffect, useRef, cloneElement } from 'react'
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'

const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'
import { DateRange } from 'react-date-range'
import { BarGraph, PieGraph, DollarSign, Moon, Sun, Refresh } from './Icons'
import CredentialStatsCard from './CredentialStatsCard'
import ChartDialog from './ChartDialog'
import DrilldownPanel from './DrilldownPanel'
import SkillsPanel from './SkillsPanel'
import LogViewerPanel from './LogViewerPanel'
import SetupGuide from './SkillWebhookHelp'
import { getModelColor, CHART_TYPOGRAPHY } from '../lib/brandColors'
import 'react-date-range/dist/styles.css'
import 'react-date-range/dist/theme/default.css'

// Measures container width via ResizeObserver — works on all browsers/OS
const AutoWidthChart = ({ height, children, style }) => {
    const ref = useRef(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        if (!ref.current) return
        setWidth(ref.current.getBoundingClientRect().width)
        const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
        ro.observe(ref.current)
        return () => ro.disconnect()
    }, [])
    return (
        <div ref={ref} style={{ width: '100%', height, ...style }}>
            {width > 0 && cloneElement(children, { width, height })}
        </div>
    )
}

// Date Range Options - using identifiers for precise boundary logic
const DATE_RANGES = [
    { label: 'Today', id: 'today' },
    { label: 'Yesterday', id: 'yesterday' },
    { label: '7 Days', id: '7d' },
    { label: '30 Days', id: '30d' },
    { label: 'This Month', id: 'month' },
    { label: 'This Quarter', id: 'quarter' },
    { label: 'This Year', id: 'year' },
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
                <AutoWidthChart height={35}>
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
                </AutoWidthChart>
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
                ...CHART_TYPOGRAPHY.tooltipLabel,
                marginBottom: 6
            }}>{label}</div>
            {payload.map((p, i) => (
                <div key={i} style={{
                    color: isDarkMode ? '#94A3B8' : '#475569',
                    ...CHART_TYPOGRAPHY.tooltipItem,
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
                        {typeof p.value === 'number' && (forceCurrency || p.name?.toLowerCase().includes('cost') || p.dataKey === 'estimated_cost_usd') ? (p.value < 1 ? `$${p.value.toFixed(2)}` : `$${Math.round(p.value).toLocaleString('en-US')}`) : p.value?.toLocaleString()}
                    </span>
                </div>
            ))}

            {/* Model Breakdown for API keys */}
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
                                <span style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.mono.fontFamily, fontSize: 10 }}>
                                    ${mData.cost ? (mData.cost < 1 ? '$' + mData.cost.toFixed(2) : '$' + Math.round(mData.cost).toLocaleString('en-US')) : '$0'}
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

// Custom Label for API Keys chart to show context-aware metrics
const shortenApiKeyLabel = (key) => {
    const v = String(key || '')
    if (v.length <= 36) return v
    return `${v.slice(0, 28)}...${v.slice(-5)}`
}

const ApiKeyLabel = ({ x, y, width, height, value, data, isDarkMode, endpointSort }) => {
    const item = data
    if (!item) return null

    const labelX = x + width + 10
    const labelY = y + height / 2
    const costText = `$${(item.cost || 0) < 1 ? (item.cost || 0).toFixed(2) : Math.round(item.cost || 0).toLocaleString('en-US')}`
    const tokenCount = item.tokens || 0
    const requestsCount = item.requests || 0
    const primaryText = endpointSort === 'tokens'
        ? `${tokenCount.toLocaleString()} tokens | ${requestsCount.toLocaleString()} req`
        : endpointSort === 'cost'
            ? `${costText} | ${tokenCount.toLocaleString()} tokens`
            : `${requestsCount.toLocaleString()} req | ${tokenCount.toLocaleString()} tokens`

    return (
        <g>
            <text
                x={labelX}
                y={labelY}
                fill={isDarkMode ? '#94A3B8' : '#475569'}
                fontSize={CHART_TYPOGRAPHY.mono.fontSize}
                fontFamily={CHART_TYPOGRAPHY.mono.fontFamily}
                textAnchor="start"
                dominantBaseline="middle"
            >
                {primaryText}
            </text>
        </g>
    )
}

// Token type color constants (distinct colors, not opacity-based)
const TOKEN_TYPES = [
    { label: 'Input', short: 'In', suffix: 'in', color: '#6366f1', dataKey: 'input_tokens' },
    { label: 'Output', short: 'Out', suffix: 'out', color: '#8b5cf6', dataKey: 'output_tokens' },
    { label: 'Cached', short: 'Ca', suffix: 'ca', color: '#f59e0b', dataKey: 'cached_tokens' },
    { label: 'Reasoning', short: 'Re', suffix: 're', color: '#10b981', dataKey: 'reasoning_tokens' },
]

// Trend configuration for the unified Usage Trends chart
const TREND_CONFIG = {
    requests: { stroke: '#3b82f6', name: 'Requests' },
    tokens: { stroke: '#10b981', name: 'Tokens' },
    cost: { stroke: '#f59e0b', name: 'Cost' },
}

function Dashboard({ stats, dailyStats, modelUsage, hourlyStats, loading, isRefreshing, lastUpdated, dateRange, onDateRangeChange, customRange, rangeBoundaries, onCustomRangeApply, endpointUsage: rawEndpointUsage, credentialData, credentialTimeSeries, credentialLoading, credentialSetupRequired, skillRuns, skillDailyStats, appLogs, onClearAllLogs, onLogout }) {
    // Auto-select time range based on dateRange: hour for today/yesterday, day for longer ranges
    const defaultTimeRange = (dateRange === 'today' || dateRange === 'yesterday') ? 'hour' : 'day'

    // Unified usage trend controls
    const [usageTrendView, setUsageTrendView] = useState('models')
    const [usageTrendTime, setUsageTrendTime] = useState(defaultTimeRange)

    // Cost analysis view toggle
    const [costView, setCostView] = useState('chart')

    // Page tab toggle
    const [activeTab, setActiveTab] = useState(() => {
        const p = new URLSearchParams(window.location.search)
        return p.get('tab') || 'usage'
    })
    const [menuOpen, setMenuOpen] = useState(false)
    const [isPinned, setIsPinned] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth > 768 : true
    )
    const [isHovered, setIsHovered] = useState(false)
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth <= 768 : false
    )

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
    const [showDatePicker, setShowDatePicker] = useState(false)
    const [selectedPreset, setSelectedPreset] = useState(dateRange)
    const [customSelection, setCustomSelection] = useState({
        startDate: customRange?.startDate ? new Date(customRange.startDate) : new Date(),
        endDate: customRange?.endDate ? new Date(customRange.endDate) : new Date(),
        key: 'selection'
    })
    const [isMobilePicker, setIsMobilePicker] = useState(false)
    const dateRangeRef = useRef(null)

    // Auto-switch time range when dateRange changes
    useEffect(() => {
        const isCustomSingleDay = dateRange === 'custom' && customRange?.startDate && customRange?.endDate && customRange.startDate === customRange.endDate;
        const newTimeRange = (dateRange === 'today' || dateRange === 'yesterday' || isCustomSingleDay) ? 'hour' : 'day'
        setUsageTrendTime(newTimeRange)
    }, [dateRange, customRange])

    useEffect(() => {
        const timer = setTimeout(() => setChartAnimated(true), 300)
        return () => clearTimeout(timer)
    }, [])

    // Re-trigger chart animation when switching views
    useEffect(() => {
        setChartAnimated(false)
        const timer = setTimeout(() => setChartAnimated(true), 50)
        return () => clearTimeout(timer)
    }, [usageTrendTime, usageTrendView, costView])

    useEffect(() => {
        if (activeTab !== 'usage' && drilldownData) {
            setDrilldownData(null)
        }
    }, [activeTab, drilldownData])

    useEffect(() => {
        setCustomSelection({
            startDate: customRange?.startDate ? new Date(customRange.startDate) : new Date(),
            endDate: customRange?.endDate ? new Date(customRange.endDate) : new Date(),
            key: 'selection'
        })
    }, [customRange])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
        const mq = window.matchMedia('(max-width: 768px)')
        const update = (e) => {
            setIsMobilePicker(e.matches)
            setIsMobile(e.matches)
            // When switching to desktop, close the mobile drawer
            if (!e.matches) setMenuOpen(false)
        }
        update(mq)
        mq.addEventListener('change', update)
        return () => mq.removeEventListener('change', update)
    }, [])

    // Sync selectedPreset when dateRange changes from outside
    useEffect(() => {
        if (dateRange !== 'custom') {
            setSelectedPreset(dateRange)
        }
    }, [dateRange])

    // Click-outside & Escape key to close picker
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dateRangeRef.current && !dateRangeRef.current.contains(e.target)) {
                setShowDatePicker(false)
            }
        }
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                setShowDatePicker(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('touchstart', handleClickOutside)
        document.addEventListener('keydown', handleEscape)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('touchstart', handleClickOutside)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [])

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
        if (!num && num !== 0) return '0'
        return Math.round(num).toLocaleString('en-US')
    }

    const formatNumberShort = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
        return num.toString()
    }

    const formatCost = (cost) => {
        if (!cost) return '$0'
        if (cost < 1) return '$' + cost.toFixed(2)
        return '$' + Math.round(cost).toLocaleString('en-US')
    }

    // API key usage must come from credential stats. Endpoint usage has names
    // like "responses" or "completions" and should not be shown as API keys.
    const endpointUsage = useMemo(() => {
        const sourceRows = (credentialData?.api_keys || []).map((key) => ({
            api_endpoint: key.api_key_name || 'unknown',
            request_count: key.total_requests || 0,
            total_tokens: key.total_tokens || 0,
            input_tokens: key.input_tokens || 0,
            output_tokens: key.output_tokens || 0,
            reasoning_tokens: key.reasoning_tokens || 0,
            cached_tokens: key.cached_tokens || 0,
            estimated_cost_usd: key.estimated_cost_usd || 0,
            success_count: key.success_count || 0,
            failure_count: key.failure_count || 0,
            models: key.models || {},
            endpoints: key.endpoints || [],
            credentials_used: key.credentials_used || [],
            isApiKeyUsage: true,
        }))

        const normalized = sourceRows
            .map(m => {
                const name = m.api_endpoint || 'Default'
                const displayName = m.isApiKeyUsage
                    ? name
                    : (() => {
                        const cleanName = name.replace(/^https?:\/\//, '')
                        const parts = cleanName.split('/')
                        return parts.length > 1 && parts[parts.length - 1]
                            ? parts[parts.length - 1]
                            : parts[0]
                    })()

                return {
                    endpoint: displayName,
                    endpoint_full: displayName,
                    requests: m.request_count || 0,
                    tokens: m.total_tokens || 0,
                    cost: m.estimated_cost_usd || 0,
                    ...m
                }
            })

        if (endpointSort === 'cost') {
            return normalized.sort((a, b) => (b.cost || 0) - (a.cost || 0))
        }
        if (endpointSort === 'tokens') {
            return normalized.sort((a, b) => (b.tokens || 0) - (a.tokens || 0))
        }
        return normalized.sort((a, b) => (b.requests || 0) - (a.requests || 0))
    }, [credentialData, endpointSort])

    const apiKeyTotalCost = endpointUsage.reduce((sum, key) => sum + (key.cost || key.estimated_cost_usd || 0), 0)

    const formatDateLabel = (value) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
    const formatISODate = (dateObj) => {
        if (!dateObj) return null
        const y = dateObj.getFullYear()
        const m = String(dateObj.getMonth() + 1).padStart(2, '0')
        const d = String(dateObj.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    const handleDateRangeSelect = (rangeId) => {
        // Calculate date range for calendar highlight
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const yr = today.getFullYear()
        let start = new Date(today)
        let end = new Date(today)

        switch (rangeId) {
            case 'today':
                break
            case 'yesterday':
                start.setDate(start.getDate() - 1)
                end = new Date(start)
                break
            case '7d':
                start.setDate(start.getDate() - 6)
                break
            case '30d':
                start.setDate(start.getDate() - 29)
                break
            case 'month':
                start = new Date(yr, today.getMonth(), 1)
                break
            case 'quarter': {
                const qStart = Math.floor(today.getMonth() / 3) * 3
                start = new Date(yr, qStart, 1)
                break
            }
            case 'year':
                start = new Date(yr, 0, 1)
                break
            default:
                break
        }

        setCustomSelection({ startDate: start, endDate: end, key: 'selection' })
        setSelectedPreset(rangeId)

        // Month/Quarter ranges use custom range apply (date-bounded)
        if (['month', 'quarter'].includes(rangeId)) {
            onCustomRangeApply({
                startDate: formatISODate(start),
                endDate: formatISODate(end)
            })
        } else {
            onDateRangeChange(rangeId)
        }
    }

    const handleCustomApply = () => {
        if (!customSelection?.startDate) return
        let startVal = customSelection.startDate
        let endVal = customSelection.endDate

        if (endVal && endVal < startVal) {
            [startVal, endVal] = [endVal, startVal]
        }

        setSelectedPreset(null)
        onCustomRangeApply({
            startDate: formatISODate(startVal),
            endDate: endVal ? formatISODate(endVal) : null
        })
        setShowDatePicker(false)
    }

    const handlePickerClose = () => {
        setShowDatePicker(false)
        setCustomSelection({
            startDate: customRange?.startDate ? new Date(customRange.startDate) : new Date(),
            endDate: customRange?.endDate ? new Date(customRange.endDate) : new Date(),
            key: 'selection'
        })
    }

    const currentRangeLabel = DATE_RANGES.find(r => r.id === selectedPreset)?.label
        || (dateRange === 'custom' && customRange?.startDate
            ? `${formatDateLabel(customRange.startDate)} → ${customRange.endDate ? formatDateLabel(customRange.endDate) : 'Now'}`
            : DATE_RANGES.find(r => r.id === dateRange)?.label || 'Today')

    // Hourly data - with computed cost field
    const hourlyData = hourlyStats || []
    const hourlyChartData = useMemo(() => {
        const keySeriesByHour = new Map((credentialTimeSeries?.byHour || []).map(row => [
            String(row.hour || '').slice(-5),
            row,
        ]))
        return hourlyData.map(h => ({
            ...h,
            cost: Object.values(h.models || {}).reduce((sum, m) => sum + (m.cost || 0), 0),
            api_keys: Object.fromEntries((keySeriesByHour.get(h.time)?.keys || []).map(key => [
                key.api_key_name || 'unknown',
                {
                    requests: key.total_requests || 0,
                    tokens: key.total_tokens || 0,
                    cost: key.estimated_cost_usd || 0,
                    input_tokens: key.input_tokens || 0,
                    output_tokens: key.output_tokens || 0,
                    reasoning_tokens: key.reasoning_tokens || 0,
                    cached_tokens: key.cached_tokens || 0,
                },
            ]))
        }))
    }, [hourlyData, credentialTimeSeries])

    // Daily data
    const dailyChartData = useMemo(() => {
        const keySeriesByDate = new Map((credentialTimeSeries?.byDay || []).map(row => [row.stat_date, row]))
        return (filteredDailyStats || []).map(d => ({
            time: new Date(d.stat_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            requests: d.total_requests,
            tokens: d.total_tokens,
            cost: parseFloat(d.estimated_cost_usd) || 0,
            models: d.models || {},
            api_keys: Object.keys(d.api_keys || {}).length > 0
                ? d.api_keys
                : Object.fromEntries((keySeriesByDate.get(d.stat_date)?.keys || []).map(key => [
                    key.api_key_name || 'unknown',
                    {
                        requests: key.total_requests || 0,
                        tokens: key.total_tokens || 0,
                        cost: key.estimated_cost_usd || 0,
                        input_tokens: key.input_tokens || 0,
                        output_tokens: key.output_tokens || 0,
                    },
                ]))
        }))
    }, [filteredDailyStats, credentialTimeSeries])

    // Top API keys for trends
    const topRequestModels = useMemo(() => {
        return [...endpointUsage]
            .sort((a, b) => (b.requests || b.request_count || 0) - (a.requests || a.request_count || 0))
            .slice(0, 10)
            .map(m => m.endpoint_full || m.endpoint || m.api_endpoint)
    }, [endpointUsage])

    const topTokenModels = useMemo(() => {
        return [...endpointUsage]
            .sort((a, b) => (b.tokens || b.total_tokens || 0) - (a.tokens || a.total_tokens || 0))
            .slice(0, 10)
            .map(m => m.endpoint_full || m.endpoint || m.api_endpoint)
    }, [endpointUsage])

    // Top API keys sorted by requests (chart always shows requests)
    const activeTopModels = useMemo(() => {
        return [...endpointUsage]
            .sort((a, b) => (b.requests || b.request_count || 0) - (a.requests || a.request_count || 0))
            .slice(0, 10)
            .map(m => m.endpoint_full || m.endpoint || m.api_endpoint)
    }, [endpointUsage])

    // Legend ordering for Usage Trends: sort current top API keys by cost desc
    const activeTopModelsByCost = useMemo(() => {
        const modelMap = new Map(endpointUsage.map(m => [m.endpoint_full || m.endpoint || m.api_endpoint, m]))
        return [...activeTopModels]
            .map(name => modelMap.get(name) || { endpoint_full: name, api_endpoint: name })
            .sort((a, b) => (b.cost || b.estimated_cost_usd || 0) - (a.cost || a.estimated_cost_usd || 0))
    }, [activeTopModels, endpointUsage])

    // Prepare data for Stacked Area Chart (By API key view)
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
                const modelData = point.api_keys?.[modelName] || point.models?.[modelName]
                let val = 0

                if (modelData) {
                    val = modelData.requests || modelData.request_count || 0
                }

                newPoint[modelName] = val
            })
            return newPoint
        })
    }, [hourlyChartData, dailyChartData, usageTrendTime, activeTopModels])

    // Token Type Time-Series: clustered stacked by time, 4 groups per point, stacks = API keys
    // Hourly for today/yesterday, daily for multi-day ranges
    const { tokenTrendData, tokenTrendModels, tokenTrendTotals } = useMemo(() => {
        const isHourly = ['today', 'yesterday'].includes(dateRange)
        const sourceData = isHourly ? hourlyStats : dailyStats

        // Find top API keys + accumulate per-type totals from same source as chart
        const modelTotals = {}
        const typeTotals = {} // api key → { input_tokens, output_tokens, cached_tokens, reasoning_tokens }
        for (const point of (sourceData || [])) {
            for (const [name, d] of Object.entries(point.api_keys || point.models || {})) {
                const total = (d.input_tokens || 0) + (d.output_tokens || 0) +
                    (d.reasoning_tokens || 0) + (d.cached_tokens || 0)
                if (total > 0) modelTotals[name] = (modelTotals[name] || 0) + total
                if (!typeTotals[name]) typeTotals[name] = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 }
                typeTotals[name].input_tokens += d.input_tokens || 0
                typeTotals[name].output_tokens += d.output_tokens || 0
                typeTotals[name].cached_tokens += d.cached_tokens || 0
                typeTotals[name].reasoning_tokens += d.reasoning_tokens || 0
            }
        }
        const topModels = Object.entries(modelTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name]) => name)

        const data = (sourceData || []).map(point => {
            const timeLabel = isHourly
                ? point.time
                : (point.stat_date || '').slice(5) // YYYY-MM-DD → MM-DD
            const row = { time: timeLabel }
            for (const model of topModels) {
                const d = point.api_keys?.[model] || point.models?.[model] || {}
                row[`${model}||in`] = d.input_tokens || 0
                row[`${model}||ca`] = d.cached_tokens || 0
                row[`${model}||out`] = d.output_tokens || 0
                row[`${model}||re`] = d.reasoning_tokens || 0
            }
            return row
        })

        return { tokenTrendData: data, tokenTrendModels: topModels, tokenTrendTotals: typeTotals }
    }, [hourlyStats, dailyStats, dateRange])

    const sparklineData = hourlyChartData.slice(-12)
    const costSparkline = dailyChartData.length >= 2 ? dailyChartData : [...Array(7)].map((_, i) => ({ cost: i === 6 ? totalCost : totalCost * (i * 0.1) }))

    // Cost breakdown datasets
    const topModelSet = useMemo(() => new Set(activeTopModels), [activeTopModels])

    // Full dataset for Details tab (unlimited)
    const costBreakdownAllBase = useMemo(() => {
        const denominator = apiKeyTotalCost || totalCost
        return (endpointUsage || []).map((m) => ({
            ...m,
            model_name: m.endpoint_full || m.endpoint || m.api_endpoint,
            request_count: m.requests || m.request_count || 0,
            total_tokens: m.tokens || m.total_tokens || 0,
            estimated_cost_usd: m.cost || m.estimated_cost_usd || 0,
            percentage: denominator > 0 ? (((m.cost || m.estimated_cost_usd || 0) / denominator) * 100).toFixed(0) : '0',
            color: getModelColor(m.endpoint_full || m.endpoint || m.api_endpoint)
        }))
    }, [endpointUsage, apiKeyTotalCost, totalCost])

    // Chart/legend dataset follows same top model scope as Usage Trends
    const costLegend = useMemo(() => {
        return costBreakdownAllBase
            .filter(m => topModelSet.has(m.model_name))
            .sort((a, b) => (b.estimated_cost_usd || 0) - (a.estimated_cost_usd || 0))
    }, [costBreakdownAllBase, topModelSet])

    // Table sorting honors user-selected column/direction
    const costBreakdown = useMemo(() => {
        return [...costBreakdownAllBase].sort((a, b) => {
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
    }, [costBreakdownAllBase, tableSort])

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

    const openApiKeyDrilldown = (apiKeyName) => {
        const item = endpointUsage.find(ep => (ep.endpoint_full || ep.endpoint || ep.api_endpoint) === apiKeyName)
        const modelRows = Object.entries(item?.models || {})
            .map(([name, m]) => ({
                _key: name,
                model: name,
                requests: m.requests || m.request_count || 0,
                tokens: m.tokens || m.total_tokens || 0,
                cost: m.cost || m.estimated_cost_usd || 0,
            }))
            .sort((a, b) => b.requests - a.requests)
        setDrilldownData({
            label: apiKeyName,
            title: `${apiKeyName} — Model Breakdown`,
            chartType: 'apiKeyModels',
            columns: [
                { key: 'model', label: 'Model' },
                { key: 'requests', label: 'Requests', render: v => formatNumber(v) },
                { key: 'tokens', label: 'Tokens', render: v => formatNumber(v) },
                { key: 'cost', label: 'Cost', render: v => formatCost(v) },
            ],
            rows: modelRows,
        })
    }

    // Drilldown: show per-API-key breakdown for a given model
    const openModelDrilldown = (modelName) => {
        const apiKeyRows = endpointUsage
            .filter(ep => ep.models?.[modelName])
            .map(ep => {
                const md = ep.models[modelName]
                return {
                    _key: ep.endpoint,
                    apiKey: ep.endpoint_full || ep.endpoint,
                    requests: md.requests || md.request_count || 0,
                    tokens: md.tokens || md.total_tokens || 0,
                    cost: md.cost || md.estimated_cost_usd || 0,
                }
            })
            .sort((a, b) => b.requests - a.requests)
        setDrilldownData({
            label: modelName,
            title: `${modelName} — Per API Key`,
            chartType: 'modelApiKeys',
            columns: [
                { key: 'apiKey', label: 'API Key' },
                { key: 'requests', label: 'Requests', render: v => formatNumber(v) },
                { key: 'tokens', label: 'Tokens', render: v => formatNumber(v) },
                { key: 'cost', label: 'Cost', render: v => formatCost(v) },
            ],
            rows: apiKeyRows,
        })
    }

    // Current trend visual config
    const currentTrend = TREND_CONFIG['requests']

    const handleNavigate = (tab) => {
        setActiveTab(tab)
        setMenuOpen(false)
    }

    // AI Boot Sequence loading screen
    const bootLines = useMemo(() => [
        { text: '> Initializing CLIProxy Dashboard v2.4.0...', type: 'system' },
        { text: '  ✓ PostgreSQL connection pool established', type: 'success' },
        { text: '  ✓ PostgREST API endpoint verified', type: 'success' },
        { text: '> Loading model pricing matrix...', type: 'system' },
        { text: '  ✓ 24 models configured (OpenAI, Anthropic, Google, DeepSeek)', type: 'success' },
        { text: '> Querying usage snapshots...', type: 'system' },
        { text: '  → Fetching daily_stats for date range', type: 'info' },
        { text: '  → Calculating token deltas & cost aggregation', type: 'info' },
        { text: '  ✓ Data pipeline ready', type: 'success' },
        { text: '> Rendering dashboard components...', type: 'system' },
        { text: '  ✓ Charts initialized', type: 'success' },
        { text: '> System online. Welcome back.', type: 'final' },
    ], [])

    const [bootStep, setBootStep] = useState(0)
    const bootTimers = useRef([])

    useEffect(() => {
        if (!loading) {
            bootTimers.current.forEach(clearTimeout)
            bootTimers.current = []
            return
        }
        setBootStep(0)
        let cumulative = 0
        bootLines.forEach((_, i) => {
            const delay = i === 0 ? 200 : (bootLines[i].type === 'system' ? 250 : 100) + Math.random() * 150
            cumulative += delay
            const t = setTimeout(() => setBootStep(i + 1), cumulative)
            bootTimers.current.push(t)
        })
        return () => {
            bootTimers.current.forEach(clearTimeout)
            bootTimers.current = []
        }
    }, [loading, bootLines])

    if (loading) {
        return (
            <div className={`dashboard ${isDarkMode ? 'dark' : 'light'}`}>
                <div className="loading ai-boot-screen">
                    <div className="boot-terminal">
                        <div className="boot-header">
                            <span className="boot-dot red"></span>
                            <span className="boot-dot yellow"></span>
                            <span className="boot-dot green"></span>
                            <span className="boot-title">cliproxy-dashboard — boot</span>
                        </div>
                        <div className="boot-body">
                            {bootLines.slice(0, bootStep).map((line, i) => (
                                <div
                                    key={i}
                                    className={`boot-line boot-${line.type} ${i === bootStep - 1 ? 'boot-latest' : ''}`}
                                >
                                    {line.text}
                                </div>
                            ))}
                            {bootStep < bootLines.length && (
                                <span className="boot-cursor">▋</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className={`dashboard ${isDarkMode ? 'dark' : 'light'} ${menuOpen ? 'drawer-open' : ''}`}>
            <div className={`drawer-overlay ${menuOpen ? 'visible' : ''}`} onClick={() => setMenuOpen(false)}></div>

            {/* Invisible hover trigger on the left edge when unpinned */}
            {!isPinned && !isHovered && !isMobile && (
                <div
                    className="sidebar-hover-trigger"
                    onMouseEnter={() => setIsHovered(true)}
                />
            )}

            <aside
                className={`side-drawer ${menuOpen ? 'open' : ''} ${!isMobile ? (!isPinned ? 'unpinned' : 'pinned') : ''} ${isHovered ? 'hover-expanded' : ''}`}
                role="navigation"
                aria-label="Main navigation"
                onMouseEnter={() => !isPinned && !isMobile && setIsHovered(true)}
                onMouseLeave={() => !isPinned && !isMobile && setIsHovered(false)}
            >

                {/* Drawer Header */}
                <div className="drawer-header">
                    {!isMobile && (
                        <button
                            className="sidebar-pin-btn"
                            onClick={() => {
                                setIsPinned(v => !v);
                                setIsHovered(false);
                            }}
                            aria-label="Toggle sidebar pin"
                            title={isPinned ? "Unpin Sidebar" : "Pin Sidebar"}
                        >
                            {isPinned ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="17" x2="12" y2="22"></line>
                                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="17" x2="12" y2="22"></line>
                                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                                </svg>
                            )}
                        </button>
                    )}
                    <button
                        className="drawer-close mobile-only"
                        onClick={() => setMenuOpen(false)}
                        aria-label="Close menu"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>


                {/* Nav Items */}
                <nav className="drawer-nav" role="menu">
                    <button
                        className={activeTab === 'usage' ? 'active' : ''}
                        onClick={() => { handleNavigate('usage'); setMenuOpen(false) }}
                        role="menuitem"
                        aria-current={activeTab === 'usage' ? 'page' : undefined}
                        title="Usage"
                    >
                        <span className="drawer-nav-icon">
                            {/* Bar chart outline */}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="20" x2="18" y2="10" />
                                <line x1="12" y1="20" x2="12" y2="4" />
                                <line x1="6" y1="20" x2="6" y2="14" />
                            </svg>
                        </span>
                        <span className="drawer-nav-label">Usage</span>
                    </button>
                    <button
                        className={activeTab === 'skills' ? 'active' : ''}
                        onClick={() => { handleNavigate('skills'); setMenuOpen(false) }}
                        role="menuitem"
                        aria-current={activeTab === 'skills' ? 'page' : undefined}
                        title="Agent Skills"
                    >
                        <span className="drawer-nav-icon">
                            {/* Sparkle / star outline */}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        </span>
                        <span className="drawer-nav-label">Agent Skills</span>
                    </button>
                    <button
                        className={activeTab === 'logs' ? 'active' : ''}
                        onClick={() => { handleNavigate('logs'); setMenuOpen(false) }}
                        role="menuitem"
                        aria-current={activeTab === 'logs' ? 'page' : undefined}
                        title="Log Viewer"
                    >
                        <span className="drawer-nav-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 4h18" />
                                <path d="M3 10h18" />
                                <path d="M3 16h18" />
                                <path d="M3 22h18" />
                            </svg>
                        </span>
                        <span className="drawer-nav-label">Log Viewer</span>
                    </button>
                    <button
                        className={activeTab === 'webhook' ? 'active' : ''}
                        onClick={() => { handleNavigate('webhook'); setMenuOpen(false) }}
                        role="menuitem"
                        aria-current={activeTab === 'webhook' ? 'page' : undefined}
                        title="Setup Guide"
                    >
                        <span className="drawer-nav-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                            </svg>
                        </span>
                        <span className="drawer-nav-label">Setup Guide</span>
                    </button>
                </nav>

                <div className="drawer-footer">
                    <button className="drawer-logout-btn" onClick={onLogout} title="Logout">
                        <span className="drawer-nav-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                        </span>
                        <span className="drawer-nav-label">Logout</span>
                    </button>
                    <div className="drawer-footer-badge">
                        <span className="drawer-footer-dot"></span>
                        <span className="drawer-footer-text">Version v{APP_VERSION}</span>
                    </div>
                </div>
            </aside>

            <div className="content-shell">
                {/* Header */}
                <header className="header">
                    <button
                        className={`menu-icon mobile-only ${menuOpen ? 'open' : ''}`}
                        onClick={() => { if (isMobile) setMenuOpen(v => !v) }}
                        aria-label="Toggle menu"
                    >
                        <span></span><span></span><span></span>
                    </button>
                    <h1 className="header-title" onClick={() => handleNavigate('usage')} style={{ cursor: 'pointer' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75zM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 01-1.875-1.875V8.625zM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 013 19.875v-6.75z" />
                        </svg>
                        <span className="header-title-text">CLIProxyAPI Dashboard</span>
                    </h1>
                    <div className="header-controls">
                        <div className="date-range-selector" ref={dateRangeRef}>
                            <button
                                className="date-range-trigger"
                                onClick={() => setShowDatePicker(prev => !prev)}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                                <span>{currentRangeLabel}</span>
                                <svg className={`trigger-chevron ${showDatePicker ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </button>

                            {showDatePicker && (
                                <>
                                    <div className="custom-picker-backdrop" onClick={handlePickerClose} />
                                    <div className="custom-range-popover">
                                        <div className="popover-header">
                                            <span className="popover-title">Date Range</span>
                                            <button className="popover-close" onClick={handlePickerClose} aria-label="Close">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                                </svg>
                                            </button>
                                        </div>

                                        <div className="picker-presets">
                                            {DATE_RANGES.map(range => (
                                                <button
                                                    key={range.id}
                                                    className={`picker-preset-btn ${selectedPreset === range.id ? 'active' : ''}`}
                                                    onClick={() => handleDateRangeSelect(range.id)}
                                                >
                                                    {range.label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="picker-divider" />

                                        <DateRange
                                            onChange={({ selection }) => setCustomSelection(selection)}
                                            moveRangeOnFirstSelection={false}
                                            ranges={[customSelection]}
                                            months={isMobilePicker ? 1 : 2}
                                            direction={isMobilePicker ? 'vertical' : 'horizontal'}
                                            showMonthAndYearPickers={true}
                                            weekStartsOn={1}
                                            showDateDisplay={false}
                                            rangeColors={['#F59E0B']}
                                            className={`rdr-theme ${isDarkMode ? 'rdr-dark' : 'rdr-light'}`}
                                        />
                                        <div className="custom-range-actions">
                                            <button type="button" className="ghost-btn" onClick={handlePickerClose}>Cancel</button>
                                            <button type="button" className="primary-btn" disabled={!customSelection?.startDate} onClick={handleCustomApply}>Apply Range</button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                        <button className="refresh-btn" onClick={() => onDateRangeChange(dateRange, true)}>
                            <Refresh /> <span className="refresh-text">Refresh</span>
                        </button>
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
                    </div>
                    <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
                        {isDarkMode ? <Sun /> : <Moon />}
                    </button>
                </header>

                <div className="page-content">
                    {activeTab === 'usage' ? (
                        <>

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

                            {/* ===== Usage Trends (By API Key × Metric × Time | Token Types) ===== */}
                            <div className="charts-row">
                                <div className="chart-card chart-full">
                                    <div className="chart-header">
                                        <h3>Usage Trends</h3>
                                        <div className="chart-controls">
                                            <div className="chart-tabs">
                                                <button className={`tab ${usageTrendView === 'models' ? 'active' : ''}`} onClick={() => setUsageTrendView('models')}>API Keys</button>
                                                <button className={`tab ${usageTrendView === 'tokenTypes' ? 'active' : ''}`} onClick={() => setUsageTrendView('tokenTypes')}>Token Types</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="chart-body chart-body-dark">
                                        {usageTrendView === 'models' ? (
                                            <div className="chart-split">
                                                <div className="chart-split-main">
                                                    <AutoWidthChart height={320}>
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
                                                                <XAxis dataKey="time" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={CHART_TYPOGRAPHY.axisTick} axisLine={false} tickLine={false} />
                                                                <YAxis
                                                                    stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                                                    tick={CHART_TYPOGRAPHY.axisTick}
                                                                    axisLine={false}
                                                                    tickLine={false}
                                                                    tickFormatter={formatNumberShort}
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
                                                                                <div style={{ fontWeight: 600, marginBottom: 8, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily }}>{label}</div>
                                                                                <div style={{ display: 'flex', gap: 12, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
                                                                                    <div style={{ fontSize: 11 }}>
                                                                                        <span style={{ color: '#06b6d4' }}>Tokens</span>
                                                                                        <div style={{ fontWeight: 700, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily }}>{formatNumber(point?._totalTokens || 0)}</div>
                                                                                    </div>
                                                                                    <div style={{ fontSize: 11 }}>
                                                                                        <span style={{ color: '#f59e0b' }}>Cost</span>
                                                                                        <div style={{ fontWeight: 700, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily }}>{formatCost(point?._totalCost || 0)}</div>
                                                                                    </div>
                                                                                    <div style={{ fontSize: 11 }}>
                                                                                        <span style={{ color: '#3b82f6' }}>Reqs</span>
                                                                                        <div style={{ fontWeight: 700, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily }}>{formatNumber(point?._totalRequests || 0)}</div>
                                                                                    </div>
                                                                                </div>
                                                                                {modelEntries.map((p, i) => (
                                                                                    <div key={i} style={{ ...CHART_TYPOGRAPHY.tooltipItem, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                                                                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, boxShadow: `0 0 6px ${p.color}`, flexShrink: 0 }}></span>
                                                                                        <span style={{ color: isDarkMode ? '#94A3B8' : '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                                                                        <span style={{ fontWeight: 600, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily, whiteSpace: 'nowrap' }}>
                                                                                            {formatNumber(p.value)}
                                                                                        </span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )
                                                                    }}
                                                                    allowEscapeViewBox={{ x: false, y: true }}
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
                                                                <text x="50%" y="50%" textAnchor="middle" fill={isDarkMode ? '#64748B' : '#94A3B8'} fontSize={13}>No API key data</text>
                                                            </AreaChart>
                                                        )}
                                                    </AutoWidthChart>
                                                </div>
                                                <div className="chart-legend-panel chart-split-legend" style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px',
                                                    paddingTop: '10px',
                                                    overflowY: 'auto',
                                                    maxHeight: '320px'
                                                }}>
                                                    <div style={{
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        color: isDarkMode ? '#94A3B8' : '#475569',
                                                        marginBottom: '4px',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.5px',
                                                        display: 'grid',
                                                        gridTemplateColumns: '1fr 46px 46px 52px',
                                                        gap: '4px',
                                                        paddingRight: '4px'
                                                    }}>
                                                        <span>Top 10 API Keys</span>
                                                        <span style={{ textAlign: 'right' }}>Req</span>
                                                        <span style={{ textAlign: 'right' }}>Tokens</span>
                                                        <span style={{ textAlign: 'right', color: isDarkMode ? '#10b981' : '#059669' }}>Cost</span>
                                                    </div>
                                                    {activeTopModelsByCost.map((model) => {
                                                        const modelName = model.endpoint_full || model.endpoint || model.api_endpoint || model.model_name
                                                        const color = getModelColor(modelName)
                                                        const modelData = model

                                                        return (
                                                            <div key={modelName} onClick={() => openApiKeyDrilldown(modelName)} style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: '1fr 46px 46px 52px',
                                                                gap: '4px',
                                                                alignItems: 'center',
                                                                padding: '5px 8px',
                                                                background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                                                                borderRadius: '6px',
                                                                border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                                                                cursor: 'pointer',
                                                                transition: 'all 0.2s ease'
                                                            }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
                                                                    e.currentTarget.style.borderColor = color
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
                                                                    e.currentTarget.style.borderColor = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                                                                }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                                    <span style={{
                                                                        width: '8px',
                                                                        height: '8px',
                                                                        borderRadius: '50%',
                                                                        background: color,
                                                                        boxShadow: `0 0 6px ${color}`,
                                                                        flexShrink: 0
                                                                    }}></span>
                                                                    <span style={{
                                                                        fontSize: '11px',
                                                                        fontWeight: 500,
                                                                        color: isDarkMode ? '#F8FAFC' : '#0F172A',
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap'
                                                                    }}>
                                                                        {modelName}
                                                                    </span>
                                                                </div>
                                                                <span style={{ fontSize: CHART_TYPOGRAPHY.mono.fontSize, fontWeight: CHART_TYPOGRAPHY.mono.fontWeight, color: isDarkMode ? '#CBD5E1' : '#334155', fontFamily: CHART_TYPOGRAPHY.mono.fontFamily, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                                    {formatNumberShort(modelData?.request_count || 0)}
                                                                </span>
                                                                <span style={{ fontSize: CHART_TYPOGRAPHY.mono.fontSize, fontWeight: CHART_TYPOGRAPHY.mono.fontWeight, color: isDarkMode ? '#CBD5E1' : '#334155', fontFamily: CHART_TYPOGRAPHY.mono.fontFamily, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                                    {formatNumberShort(modelData?.total_tokens || 0)}
                                                                </span>
                                                                <span style={{ fontSize: CHART_TYPOGRAPHY.mono.fontSize, fontWeight: CHART_TYPOGRAPHY.mono.fontWeight, color: isDarkMode ? '#10b981' : '#059669', fontFamily: CHART_TYPOGRAPHY.mono.fontFamily, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                                    {formatCost(modelData?.estimated_cost_usd || 0)}
                                                                </span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            /* Token Types: Clustered stacked column — X = time, 4 clusters per tick, stacks = API keys */
                                            <div className="chart-split" style={{ minHeight: 320 }}>
                                                {/* Chart column */}
                                                <div className="chart-split-main">
                                                    {/* Token type legend (opacity key) */}
                                                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 4 }}>
                                                        {TOKEN_TYPES.map(({ label, color, suffix }) => (
                                                            <span key={suffix} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color }}>
                                                                <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                                                                {label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <AutoWidthChart height={300}>
                                                        <BarChart
                                                            data={tokenTrendData}
                                                            margin={{ top: 4, right: 10, left: 10, bottom: 5 }}
                                                            barCategoryGap="20%"
                                                            barGap={1}
                                                        >
                                                            <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} vertical={false} />
                                                            <XAxis
                                                                dataKey="time"
                                                                stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                                                tick={CHART_TYPOGRAPHY.axisTick}
                                                                axisLine={false}
                                                                tickLine={false}
                                                            />
                                                            <YAxis
                                                                stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                                                tick={CHART_TYPOGRAPHY.axisTick}
                                                                axisLine={false}
                                                                tickLine={false}
                                                                tickFormatter={formatNumberShort}
                                                                width={55}
                                                            />
                                                            <Tooltip
                                                                content={({ active, payload, label }) => {
                                                                    if (!active || !payload?.length) return null
                                                                    const byModel = {}
                                                                    for (const p of payload) {
                                                                        if (!p.value) continue
                                                                    const [apiKey, type] = p.dataKey.split('||')
                                                                    if (!byModel[apiKey]) byModel[apiKey] = {}
                                                                    byModel[apiKey][type] = (byModel[apiKey][type] || 0) + p.value
                                                                    }
                                                                    const typeLabels = { in: 'Input', out: 'Output', ca: 'Cached', re: 'Reasoning' }
                                                                    const grandTotal = payload.reduce((s, p) => s + (p.value || 0), 0)
                                                                    return (
                                                                        <div style={{
                                                                            background: isDarkMode ? 'rgba(15,23,42,0.97)' : 'rgba(255,255,255,0.98)',
                                                                            border: `1px solid ${isDarkMode ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'}`,
                                                                            borderRadius: 10, padding: '10px 14px', minWidth: 200,
                                                                            boxShadow: isDarkMode ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.1)',
                                                                            maxHeight: 320, overflowY: 'auto'
                                                                        }}>
                                                                            <div style={{ fontWeight: 700, marginBottom: 8, color: isDarkMode ? '#F8FAFC' : '#0F172A', fontFamily: CHART_TYPOGRAPHY.tooltipLabel.fontFamily }}>
                                                                                {label}
                                                                            </div>
                                                                            {Object.entries(byModel).map(([apiKey, types]) => (
                                                                                <div key={apiKey} style={{ marginBottom: 6 }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                                                                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: getModelColor(apiKey), display: 'inline-block' }} />
                                                                                        <span style={{ fontSize: 11, fontWeight: 600, color: isDarkMode ? '#CBD5E1' : '#334155' }}>
                                                                                            {apiKey.length > 22 ? '…' + apiKey.slice(-18) : apiKey}
                                                                                        </span>
                                                                                    </div>
                                                                                    {['in', 'out', 'ca', 're'].filter(t => types[t] > 0).map(t => (
                                                                                        <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11, paddingLeft: 13, marginBottom: 1 }}>
                                                                                            <span style={{ color: isDarkMode ? '#94A3B8' : '#64748B' }}>{typeLabels[t]}</span>
                                                                                            <strong style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>{formatNumber(types[t])}</strong>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            ))}
                                                                            <div style={{ borderTop: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                                                                <span style={{ color: isDarkMode ? '#94A3B8' : '#64748B' }}>Total</span>
                                                                                <strong style={{ color: isDarkMode ? '#F8FAFC' : '#0F172A' }}>{formatNumber(grandTotal)}</strong>
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                }}
                                                                cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
                                                                allowEscapeViewBox={{ x: true, y: true }}
                                                            />
                                                            {/* Bars: color = token type (distinct), stacked by model (opacity gradient) */}
                                                            {TOKEN_TYPES.map(({ suffix, color }) =>
                                                                tokenTrendModels.map((model, i) => (
                                                                    <Bar key={`${model}-${suffix}`} dataKey={`${model}||${suffix}`} stackId={suffix}
                                                                        fill={color}
                                                                        fillOpacity={1 - (i * 0.12)}
                                                                        radius={i === tokenTrendModels.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                                                                        isAnimationActive={chartAnimated} animationDuration={1000} animationBegin={i * 60}
                                                                    />
                                                                ))
                                                            )}
                                                        </BarChart>
                                                    </AutoWidthChart>
                                                </div>
                                                {/* Legend panel (right side) — same style as model legend */}
                                                <div className="chart-legend-panel chart-split-legend" style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '10px', overflowY: 'auto', maxHeight: '340px' }}>
                                                    {/* Column headers — fixed col widths match value rows */}
                                                    <div style={{
                                                        fontSize: '11px', fontWeight: 600,
                                                        marginBottom: '4px', textTransform: 'uppercase',
                                                        letterSpacing: '0.5px', display: 'grid',
                                                        gridTemplateColumns: '1fr 46px 46px 46px 46px',
                                                        gap: '4px', paddingRight: '4px'
                                                    }}>
                                                        <span style={{ color: isDarkMode ? '#94A3B8' : '#475569' }}>API Key</span>
                                                        {TOKEN_TYPES.map(t => (
                                                            <span key={t.suffix} style={{ textAlign: 'right', color: t.color }}>{t.short}</span>
                                                        ))}
                                                    </div>
                                                    {tokenTrendModels
                                                        .map(model => ({ model, cost: (endpointUsage.find(m => (m.endpoint_full || m.endpoint || m.api_endpoint) === model)?.cost) || 0 }))
                                                        .sort((a, b) => b.cost - a.cost)
                                                        .map(({ model }) => {
                                                            const color = getModelColor(model)
                                                            const md = tokenTrendTotals[model] || {}
                                                            return (
                                                                <div key={model}
                                                                    onClick={() => openApiKeyDrilldown(model)}
                                                                    onMouseEnter={(e) => {
                                                                        e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
                                                                        e.currentTarget.style.borderColor = color
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
                                                                        e.currentTarget.style.borderColor = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                                                                    }}
                                                                    style={{
                                                                        display: 'grid', gridTemplateColumns: '1fr 46px 46px 46px 46px',
                                                                        gap: '4px', alignItems: 'center',
                                                                        padding: '6px 8px',
                                                                        background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                                                                        borderRadius: '6px',
                                                                        border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                                                                        cursor: 'pointer',
                                                                        transition: 'all 0.2s ease'
                                                                    }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
                                                                        <span style={{ fontSize: '11px', fontWeight: 500, color: isDarkMode ? '#F8FAFC' : '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {model}
                                                                        </span>
                                                                    </div>
                                                                    {TOKEN_TYPES.map(t => (
                                                                        <span key={t.suffix} style={{ fontSize: '11px', fontFamily: CHART_TYPOGRAPHY.mono.fontFamily, textAlign: 'right', color: t.color, fontWeight: 600, whiteSpace: 'nowrap', display: 'block' }}>
                                                                            {formatNumberShort(md[t.dataKey] || 0)}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )
                                                        })}
                                                </div>
                                            </div>
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
                                            {costLegend.length > 0 ? (
                                                <div className="chart-split">
                                                    <div className="chart-split-main">
                                                        <AutoWidthChart height={300}>
                                                            <PieChart onClick={() => {
                                                                if (costLegend.length > 0) {
                                                                    const rows = []
                                                                    costLegend.forEach(m => {
                                                                        rows.push({
                                                                            _key: m.model_name,
                                                                            apiKey: m.model_name,
                                                                            requests: m.request_count,
                                                                            tokens: m.total_tokens,
                                                                            cost: m.estimated_cost_usd,
                                                                        })
                                                                    })
                                                                    setDrilldownData({
                                                                        label: 'All API Keys',
                                                                        chartType: 'cost',
                                                                        title: 'Cost Breakdown — All API Keys',
                                                                        columns: [
                                                                            { key: 'apiKey', label: 'API Key' },
                                                                            { key: 'requests', label: 'Requests', render: v => formatNumber(v) },
                                                                            { key: 'tokens', label: 'Tokens', render: v => formatNumber(v) },
                                                                            { key: 'cost', label: 'Cost', render: v => formatCost(v) },
                                                                        ],
                                                                        rows,
                                                                    })
                                                                }
                                                            }}>
                                                                <Pie
                                                                    data={costLegend}
                                                                    dataKey="estimated_cost_usd"
                                                                    nameKey="model_name"
                                                                    cx="50%"
                                                                    cy="50%"
                                                                    outerRadius={110}
                                                                    innerRadius={65}
                                                                    label={false}
                                                                    stroke={isDarkMode ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)'}
                                                                    strokeWidth={2}
                                                                    isAnimationActive={chartAnimated}
                                                                    animationDuration={1500}
                                                                >
                                                                    {costLegend.map((entry, index) => (
                                                                        <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.85} />
                                                                    ))}
                                                                </Pie>
                                                                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} forceCurrency={true} />} />
                                                            </PieChart>
                                                        </AutoWidthChart>
                                                    </div>
                                                    <div className="chart-legend-panel chart-split-legend" style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '6px',
                                                        paddingTop: '10px',
                                                        overflowY: 'auto',
                                                        maxHeight: '300px'
                                                    }}>
                                                        <div style={{
                                                            fontSize: '11px',
                                                            fontWeight: 600,
                                                            color: isDarkMode ? '#94A3B8' : '#475569',
                                                            marginBottom: '4px',
                                                            textTransform: 'uppercase',
                                                            letterSpacing: '0.5px',
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            paddingRight: '8px'
                                                        }}>
                                                            <span>Top 10 API Keys</span>
                                                            <span>Cost / %</span>
                                                        </div>
                                                        {costLegend.map((model, index) => (
                                                            <div key={index} onClick={() => openApiKeyDrilldown(model.model_name)} style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '10px',
                                                                padding: '6px 10px',
                                                                background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                                                                borderRadius: '6px',
                                                                border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                                                                cursor: 'pointer',
                                                                transition: 'all 0.2s ease'
                                                            }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
                                                                    e.currentTarget.style.borderColor = model.color
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
                                                                    e.currentTarget.style.borderColor = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                                                                }}>
                                                                <span style={{
                                                                    width: '10px',
                                                                    height: '10px',
                                                                    borderRadius: '50%',
                                                                    background: model.color,
                                                                    boxShadow: `0 0 8px ${model.color}`,
                                                                    flexShrink: 0
                                                                }}></span>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{
                                                                        fontSize: '11px',
                                                                        fontWeight: 500,
                                                                        color: isDarkMode ? '#F8FAFC' : '#0F172A',
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap'
                                                                    }}>
                                                                        {model.model_name}
                                                                    </div>
                                                                </div>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    gap: '8px',
                                                                    alignItems: 'center',
                                                                    flexShrink: 0
                                                                }}>
                                                                    <span style={{
                                                                        fontSize: '11px',
                                                                        fontWeight: 600,
                                                                        color: isDarkMode ? '#10b981' : '#059669',
                                                                        fontFamily: CHART_TYPOGRAPHY.mono.fontFamily
                                                                    }}>
                                                                        {formatCost(model.estimated_cost_usd || 0)}
                                                                    </span>
                                                                    <span style={{
                                                                        fontSize: '10px',
                                                                        color: isDarkMode ? '#64748B' : '#94A3B8',
                                                                        minWidth: '32px',
                                                                        textAlign: 'right'
                                                                    }}>
                                                                        {model.percentage}%
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
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
                                                            API Key <SortIcon column="model_name" />
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
                                                        <tr key={i} className="clickable-row" onClick={() => openApiKeyDrilldown(m.model_name)}>
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
                                                            <td><strong>{formatNumber((costBreakdownAllBase || []).reduce((s, m) => s + (m.request_count || 0), 0))}</strong></td>
                                                            <td><strong>{formatNumber((costBreakdownAllBase || []).reduce((s, m) => s + (m.input_tokens || 0), 0))}</strong></td>
                                                            <td><strong>{formatNumber((costBreakdownAllBase || []).reduce((s, m) => s + (m.output_tokens || 0), 0))}</strong></td>
                                                            <td><strong>{formatNumber((costBreakdownAllBase || []).reduce((s, m) => s + (m.total_tokens || 0), 0))}</strong></td>
                                                            <td className="cost"><strong>{formatCost(apiKeyTotalCost || totalCost)}</strong></td>
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
                                            <button className={`tab ${endpointSort === 'tokens' ? 'active' : ''}`} onClick={() => setEndpointSort('tokens')}>Tokens</button>
                                        </div>
                                    </div>
                                    <div className="chart-body chart-body-dark">
                                        {endpointUsage.length > 0 ? (
                                            <AutoWidthChart height={Math.max(260, endpointUsage.length * 58)}>
                                                <BarChart data={endpointUsage} layout="vertical" margin={{ left: 10, right: 210 }} onClick={(data) => {
                                                    if (data?.activePayload?.[0]?.payload?.models) {
                                                        const point = data.activePayload[0].payload
                                                        setDrilldownData({ label: point.endpoint_full || point.endpoint, data: point, chartType: 'apikeys' })
                                                    }
                                                }}>
                                                    <defs>
                                                        <linearGradient id="gradApiKeys" x1="0" y1="0" x2="1" y2="0">
                                                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} horizontal={false} />
                                                    <XAxis type="number" stroke={isDarkMode ? '#6e7681' : '#57606a'} tick={CHART_TYPOGRAPHY.axisTick} axisLine={false} tickLine={false} />
                                                    <YAxis
                                                        type="category"
                                                        dataKey="endpoint_full"
                                                        stroke={isDarkMode ? '#6e7681' : '#57606a'}
                                                        tick={{ ...CHART_TYPOGRAPHY.axisTick, fontSize: 11 }}
                                                        width={290}
                                                        axisLine={false}
                                                        tickLine={false}
                                                        interval={0}
                                                    />
                                                    <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} cursor={false} />
                                                    <Bar
                                                        dataKey={endpointSort === 'cost' ? 'cost' : endpointSort === 'tokens' ? 'tokens' : 'requests'}
                                                        name={endpointSort === 'cost' ? 'Cost ($)' : endpointSort === 'tokens' ? 'Tokens' : 'Requests'}
                                                        fill="url(#gradApiKeys)"
                                                        stroke="#8b5cf6"
                                                        strokeWidth={1}
                                                        radius={[0, 4, 4, 0]}
                                                        isAnimationActive={chartAnimated}
                                                        animationDuration={1500}
                                                        minPointSize={2}
                                                        label={(props) => <ApiKeyLabel {...props} data={endpointUsage[props.index]} isDarkMode={isDarkMode} endpointSort={endpointSort} />}
                                                    />
                                                </BarChart>
                                            </AutoWidthChart>
                                        ) : (
                                            <div className="empty-state">No API key data</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Credential Stats - Usage rates and limits per credential */}
                            <div className="charts-row">
                                <CredentialStatsCard
                                    isDarkMode={isDarkMode}
                                    data={credentialData}
                                    timeSeries={credentialTimeSeries}
                                    dateRange={dateRange}
                                    isLoading={credentialLoading}
                                    setupRequired={credentialSetupRequired}
                                    onRowClick={(item, type) => {
                                        if (!item?.models || Object.keys(item.models).length === 0) return
                                        const label = type === 'api_key'
                                            ? shortenApiKeyLabel(item.api_key_name)
                                            : (item.email || item.source || 'Unknown')
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
                        </>
                    ) : activeTab === 'skills' ? (
                        <SkillsPanel
                            skillRuns={skillRuns}
                            skillDailyStats={skillDailyStats}
                            dateRange={dateRange}
                            customRange={customRange}
                            rangeBoundaries={rangeBoundaries}
                            isDarkMode={isDarkMode}
                        />
                    ) : activeTab === 'logs' ? (
                        <LogViewerPanel
                            appLogs={appLogs}
                            skillRuns={skillRuns}
                            dateRange={dateRange}
                            customRange={customRange}
                            onClearAllLogs={onClearAllLogs}
                        />
                    ) : (
                        <SetupGuide isDarkMode={isDarkMode} />
                    )}
                </div>
            </div>
        </div >
    )
}

export default Dashboard
