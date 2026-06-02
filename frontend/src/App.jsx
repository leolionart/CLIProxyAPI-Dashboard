import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from './lib/supabase'
import Dashboard from './components/Dashboard'

const APP_LOGS_PAGE_SIZE = Number(import.meta.env.VITE_APP_LOGS_PAGE_SIZE || 500)
const FRONTEND_AUTO_REFRESH_MS = Math.max(1000, Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 60) * 1000)
const COLLECTOR_BASE = '/api/collector'
const DEV_BYPASS_AUTH = import.meta.env.DEV && String(import.meta.env.VITE_DEV_BYPASS_AUTH || '').toLowerCase() === 'true'
const DEV_MOCK_SKILLS = import.meta.env.DEV && String(import.meta.env.VITE_DEV_MOCK_SKILLS || '').toLowerCase() === 'true'

const createMockSkillRuns = () => {
    const now = Date.now()
    const skills = [
        { name: 'review-pr', model: 'claude-sonnet-4-6', project: '/Users/admin/projects/cliproxy-dashboard', machine: 'macbook-pro-m3', baseIn: 18000, baseOut: 4200, cost: 0.28 },
        { name: 'commit', model: 'claude-sonnet-4-6', project: '/Users/admin/projects/cliproxy-dashboard', machine: 'macbook-pro-m3', baseIn: 9000, baseOut: 1800, cost: 0.09 },
        { name: 'frontend-design', model: 'claude-opus-4-6', project: '/Users/admin/projects/marketing-site', machine: 'studio-imac', baseIn: 26000, baseOut: 6800, cost: 0.64 },
        { name: 'debugging', model: 'claude-sonnet-4-6', project: '/Users/admin/projects/collector', machine: 'ubuntu-buildbox', baseIn: 15000, baseOut: 2500, cost: 0.21 },
        { name: 'docs-seeker', model: 'claude-haiku-4-5-20251001', project: '/Users/admin/projects/agent-docs', machine: 'macbook-air', baseIn: 7000, baseOut: 1300, cost: 0.04 },
        { name: 'web-testing', model: 'claude-sonnet-4-6', project: '/Users/admin/projects/dashboard-e2e', machine: 'ubuntu-buildbox', baseIn: 12000, baseOut: 2400, cost: 0.16 },
    ]

    const statuses = ['success', 'success', 'success', 'success', 'failure']
    const runs = []

    for (let day = 0; day < 12; day += 1) {
        skills.forEach((skill, skillIndex) => {
            const runCount = Math.max(1, 4 - Math.floor(skillIndex / 2))
            for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
                const ts = new Date(now - ((day * 24 + (skillIndex * 3) + runIndex) * 60 * 60 * 1000))
                const status = statuses[(day + skillIndex + runIndex) % statuses.length]
                const input = skill.baseIn + (day * 350) + (runIndex * 420)
                const output = status === 'failure' ? Math.round(skill.baseOut * 0.2) : skill.baseOut + (runIndex * 180)
                runs.push({
                    event_uid: `mock-${skill.name}-${day}-${runIndex}`,
                    tool_use_id: `tool-${skill.name}-${day}-${runIndex}`,
                    skill_name: skill.name,
                    session_id: `session-${(skillIndex % 3) + 1}`,
                    machine_id: skill.machine,
                    source: 'mock-dev',
                    triggered_at: ts.toISOString(),
                    status,
                    error_type: status === 'failure' ? 'tool_error' : null,
                    error_message: status === 'failure' ? 'Mock failure to preview error states in recent runs.' : null,
                    attempt_no: 1,
                    tokens_used: input,
                    output_tokens: output,
                    duration_ms: 1200 + (skillIndex * 330) + (runIndex * 140),
                    model: skill.model,
                    tool_calls: 1 + ((day + runIndex) % 4),
                    estimated_cost_usd: Number((skill.cost + day * 0.01 + runIndex * 0.005).toFixed(3)),
                    is_skeleton: false,
                    project_dir: skill.project,
                })
            }
        })
    }

    return runs.sort((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at))
}

const createMockSkillDailyStats = (runs) => {
    const dailyMap = new Map()

    for (const run of runs) {
        const dt = new Date(run.triggered_at)
        const statDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
        const key = `${statDate}|||${run.skill_name}|||${run.machine_id}`

        if (!dailyMap.has(key)) {
            dailyMap.set(key, {
                stat_date: statDate,
                skill_name: run.skill_name,
                machine_id: run.machine_id,
                run_count: 0,
                success_count: 0,
                failure_count: 0,
                total_tokens: 0,
                total_output_tokens: 0,
                total_tool_calls: 0,
                total_cost_usd: 0,
            })
        }

        const row = dailyMap.get(key)
        row.run_count += 1
        row.success_count += run.status === 'failure' ? 0 : 1
        row.failure_count += run.status === 'failure' ? 1 : 0
        row.total_tokens += run.tokens_used || 0
        row.total_output_tokens += run.output_tokens || 0
        row.total_tool_calls += run.tool_calls || 0
        row.total_cost_usd += Number(run.estimated_cost_usd || 0)
    }

    return Array.from(dailyMap.values()).sort((a, b) => a.stat_date.localeCompare(b.stat_date))
}

const MOCK_SKILL_RUNS = createMockSkillRuns()
const MOCK_SKILL_DAILY_STATS = createMockSkillDailyStats(MOCK_SKILL_RUNS)

// Helper to get date boundaries based on range ID
// Uses local timezone for date display, converts to UTC for timestamp queries
const getDateBoundaries = (rangeId, customRange) => {
    const now = new Date()

    // Get today's date in local timezone as YYYY-MM-DD (for daily_stats)
    const formatDate = (d) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    // Create Date at local midnight and convert to UTC ISO string
    const localMidnightToUTC = (d) => {
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
        return localMidnight.toISOString()  // Converts to UTC
    }

    const todayStr = formatDate(now)
    const todayUTC = localMidnightToUTC(now)

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = formatDate(yesterday)
    const yesterdayUTC = localMidnightToUTC(yesterday)

    const parseLocalDate = (value) => {
        if (!value) return null
        const [y, m, d] = value.split('-').map(Number)
        if (!y || !m || !d) return null
        return new Date(y, m - 1, d, 0, 0, 0)
    }

    switch (rangeId) {
        case 'today':
            return {
                startDate: todayStr,
                endDate: null,
                startTime: todayUTC,
                endTime: null
            }
        case 'yesterday':
            return {
                startDate: yesterdayStr,
                endDate: todayStr,
                startTime: yesterdayUTC,
                endTime: todayUTC
            }
        case '7d': {
            const d7 = new Date(now)
            d7.setDate(d7.getDate() - 7)
            return {
                startDate: formatDate(d7),
                endDate: null,
                startTime: localMidnightToUTC(d7),
                endTime: null
            }
        }
        case '30d': {
            const d30 = new Date(now)
            d30.setDate(d30.getDate() - 30)
            return {
                startDate: formatDate(d30),
                endDate: null,
                startTime: localMidnightToUTC(d30),
                endTime: null
            }
        }
        case 'month': {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
            return {
                startDate: formatDate(monthStart),
                endDate: null,
                startTime: localMidnightToUTC(monthStart),
                endTime: null
            }
        }
        case 'quarter': {
            const qStartMonth = Math.floor(now.getMonth() / 3) * 3
            const quarterStart = new Date(now.getFullYear(), qStartMonth, 1)
            return {
                startDate: formatDate(quarterStart),
                endDate: null,
                startTime: localMidnightToUTC(quarterStart),
                endTime: null
            }
        }
        case 'year': {
            const yearStart = new Date(now.getFullYear(), 0, 1)
            return {
                startDate: formatDate(yearStart),
                endDate: null,
                startTime: localMidnightToUTC(yearStart),
                endTime: null
            }
        }
        case 'custom': {
            const start = parseLocalDate(customRange?.startDate)
            const end = parseLocalDate(customRange?.endDate)

            const endExclusive = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null

            return {
                startDate: start ? formatDate(start) : null,
                endDate: endExclusive ? formatDate(endExclusive) : null,
                startTime: start ? localMidnightToUTC(start) : null,
                endTime: endExclusive ? localMidnightToUTC(endExclusive) : null
            }
        }
        case 'all':
        default:
            return { startDate: null, endDate: null, startTime: null, endTime: null }
    }
}

function App() {
    const [authState, setAuthState] = useState({ loading: true, authenticated: false, authRequired: false, expiresAt: null, rememberMe: false })
    const [loginForm, setLoginForm] = useState({ password: '', rememberMe: true })
    const [loginError, setLoginError] = useState('')
    const [loginSubmitting, setLoginSubmitting] = useState(false)
    const unauthorizedHandledRef = useRef(false)
    const credentialStatsInFlightRef = useRef(false)
    const dashboardDataInFlightRef = useRef(false)

    const resetDashboardState = useCallback(() => {
        setStats(null)
        setDailyStats([])
        setModelUsage([])
        setEndpointUsage([])
        setHourlyStats([])
        setSkillRuns([])
        setSkillDailyStats([])
        setAppLogs([])
        setLastUpdated(null)
        setCredentialData(null)
        setCredentialTimeSeries({ byDay: [], byHour: [], meta: {} })
        setCredentialSetupRequired(false)
        setCredentialLoading(false)
        setLoading(false)
        setIsRefreshing(false)
        setHasInitialDataLoaded(false)
    }, [])

    const handleUnauthorized = useCallback(() => {
        if (unauthorizedHandledRef.current) return
        unauthorizedHandledRef.current = true
        resetDashboardState()
        setAuthState(prev => ({
            loading: false,
            authenticated: !prev.authRequired,
            authRequired: prev.authRequired,
            expiresAt: null,
            rememberMe: false,
        }))
        setLoginForm(prev => ({ ...prev, password: '' }))
        setLoginError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    }, [resetDashboardState])

    const [stats, setStats] = useState(null)
    const [dailyStats, setDailyStats] = useState([])
    const [modelUsage, setModelUsage] = useState([])
    const [endpointUsage, setEndpointUsage] = useState([])
    const [hourlyStats, setHourlyStats] = useState([])
    const [skillRuns, setSkillRuns] = useState([])
    const [skillDailyStats, setSkillDailyStats] = useState([])
    const [appLogs, setAppLogs] = useState([])
    const [loading, setLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [hasInitialDataLoaded, setHasInitialDataLoaded] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [dateRange, setDateRange] = useState('today')
    const [customRange, setCustomRange] = useState({ startDate: null, endDate: null })
    const rangeBoundaries = useMemo(() => getDateBoundaries(dateRange, customRange), [dateRange, customRange])

    const [credentialData, setCredentialData] = useState(null)
    const [credentialTimeSeries, setCredentialTimeSeries] = useState({ byDay: [], byHour: [], meta: {} })
    const [credentialLoading, setCredentialLoading] = useState(true)
    const [credentialSetupRequired, setCredentialSetupRequired] = useState(false)

    const mockSkillData = useMemo(() => {
        if (!DEV_MOCK_SKILLS) {
            return { skillRuns: skillRuns, skillDailyStats: skillDailyStats }
        }

        const { startTime, endTime, startDate, endDate } = getDateBoundaries(dateRange, customRange)
        const filteredRuns = MOCK_SKILL_RUNS.filter((run) => {
            const triggeredAt = run.triggered_at || ''
            if (startTime && triggeredAt < startTime) return false
            if (endTime && triggeredAt >= endTime) return false
            return true
        })

        const filteredDailyStats = MOCK_SKILL_DAILY_STATS.filter((row) => {
            if (startDate && row.stat_date < startDate) return false
            if (endDate && row.stat_date >= endDate) return false
            return true
        })

        return {
            skillRuns: filteredRuns,
            skillDailyStats: filteredDailyStats,
        }
    }, [skillRuns, skillDailyStats, dateRange, customRange])

    const authFetch = useCallback(async (url, options = {}) => {
        const { skipUnauthorized = false, headers, ...rest } = options
        const response = await fetch(url, {
            credentials: 'include',
            ...rest,
            headers: {
                'Content-Type': 'application/json',
                ...(headers || {}),
            },
        })

        if (!skipUnauthorized && response.status === 401) {
            handleUnauthorized()
        }

        return response
    }, [handleUnauthorized])

    const fetchSession = useCallback(async () => {
        if (DEV_BYPASS_AUTH) {
            unauthorizedHandledRef.current = false
            setAuthState({ loading: false, authenticated: true, authRequired: false, expiresAt: null, rememberMe: true })
            return true
        }

        try {
            const response = await authFetch(`${COLLECTOR_BASE}/auth/session`, { method: 'GET', skipUnauthorized: true })
            if (!response.ok) {
                setAuthState({ loading: false, authenticated: false, authRequired: true, expiresAt: null, rememberMe: false })
                return false
            }

            const session = await response.json()
            const authRequired = Boolean(session.auth_required)
            const authenticated = !authRequired || Boolean(session.authenticated)
            unauthorizedHandledRef.current = false
            setAuthState({
                loading: false,
                authenticated,
                authRequired,
                expiresAt: session.expires_at || null,
                rememberMe: Boolean(session.remember_me),
            })
            return authenticated
        } catch (error) {
            console.error('Error fetching session:', error)
            setAuthState({ loading: false, authenticated: false, authRequired: true, expiresAt: null, rememberMe: false })
            return false
        }
    }, [authFetch])

    const fetchCredentialStats = useCallback(async (rangeId = dateRange) => {
        if (!authState.authenticated) {
            setCredentialLoading(false)
            return
        }
        if (credentialStatsInFlightRef.current) {
            return
        }
        credentialStatsInFlightRef.current = true

        try {
            setCredentialLoading(true)

            const { startDate, endDate } = getDateBoundaries(rangeId, customRange)

            let useDailyStats = false
            let dailyRowsForSeries = []
            try {
                let query = supabase
                    .from('credential_daily_stats')
                    .select('credentials, api_keys, total_credentials, total_api_keys, stat_date')

                if (startDate) {
                    query = query.gte('stat_date', startDate)
                }
                if (endDate) {
                    query = query.lt('stat_date', endDate)
                }

                const { data: dailyRows, error: dailyError } = await query

                if (!dailyError && dailyRows) {
                    dailyRowsForSeries = dailyRows
                }

                if (!dailyError && dailyRows && dailyRows.length > 0) {
                    useDailyStats = true

                    const credMap = {}
                    const akMap = {}

                    const CRED_NUM = ['total_requests', 'success_count', 'failure_count',
                        'input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens']
                    const AK_NUM = ['total_requests', 'total_tokens', 'success_count', 'failure_count',
                        'input_tokens', 'output_tokens']
                    const MODEL_NUM_CRED = ['requests', 'success', 'failure',
                        'input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens']
                    const MODEL_NUM_AK = ['requests', 'tokens', 'success', 'failure']

                    for (const row of dailyRows) {
                        for (const c of (row.credentials || [])) {
                            const key = `${c.auth_index || ''}||${c.source || ''}`
                            if (!credMap[key]) {
                                credMap[key] = { ...c, models: { ...(c.models || {}) } }
                            } else {
                                const ex = credMap[key]
                                for (const f of CRED_NUM) {
                                    ex[f] = (ex[f] || 0) + (c[f] || 0)
                                }
                                for (const [mName, mData] of Object.entries(c.models || {})) {
                                    if (!ex.models[mName]) {
                                        ex.models[mName] = { ...mData }
                                    } else {
                                        for (const f of MODEL_NUM_CRED) {
                                            ex.models[mName][f] = (ex.models[mName][f] || 0) + (mData[f] || 0)
                                        }
                                    }
                                }
                                ex.api_keys = [...new Set([...(ex.api_keys || []), ...(c.api_keys || [])])].sort()
                                for (const f of ['provider', 'email', 'label', 'status', 'account_type']) {
                                    if (c[f]) ex[f] = c[f]
                                }
                            }
                        }

                        for (const a of (row.api_keys || [])) {
                            const key = a.api_key_name || ''
                            if (!akMap[key]) {
                                akMap[key] = { ...a, models: { ...(a.models || {}) } }
                            } else {
                                const ex = akMap[key]
                                for (const f of AK_NUM) {
                                    ex[f] = (ex[f] || 0) + (a[f] || 0)
                                }
                                for (const [mName, mData] of Object.entries(a.models || {})) {
                                    if (!ex.models[mName]) {
                                        ex.models[mName] = { ...mData }
                                    } else {
                                        for (const f of MODEL_NUM_AK) {
                                            ex.models[mName][f] = (ex.models[mName][f] || 0) + (mData[f] || 0)
                                        }
                                    }
                                }
                                ex.credentials_used = [...new Set([...(ex.credentials_used || []), ...(a.credentials_used || [])])].sort()
                            }
                        }
                    }

                    const aggregatedCreds = Object.values(credMap).map(c => ({
                        ...c,
                        success_rate: c.total_requests > 0
                            ? Math.round((c.success_count / c.total_requests) * 1000) / 10
                            : 0
                    })).sort((a, b) => b.total_requests - a.total_requests)

                    const aggregatedAKs = Object.values(akMap).map(a => ({
                        ...a,
                        success_rate: a.total_requests > 0
                            ? Math.round((a.success_count / a.total_requests) * 1000) / 10
                            : 0
                    })).sort((a, b) => b.total_requests - a.total_requests)

                    setCredentialData({
                        credentials: aggregatedCreds,
                        api_keys: aggregatedAKs,
                        total_credentials: aggregatedCreds.length,
                        total_api_keys: aggregatedAKs.length,
                    })
                    setCredentialSetupRequired(false)
                }
            } catch (dailyErr) {
                console.debug('credential_daily_stats not available, falling back to summary:', dailyErr.message)
            }

            const dailyCostByDate = {}
            if (startDate || rangeId === 'all') {
                let dailyBreakdownQuery = supabase
                    .from('daily_stats')
                    .select('stat_date, breakdown')

                if (startDate) dailyBreakdownQuery = dailyBreakdownQuery.gte('stat_date', startDate)
                if (endDate) dailyBreakdownQuery = dailyBreakdownQuery.lt('stat_date', endDate)

                const { data: dailyBreakdownRows } = await dailyBreakdownQuery
                for (const row of (dailyBreakdownRows || [])) {
                    const apiKeys = row?.breakdown?.api_keys || row?.breakdown?.endpoints || {}
                    const costMap = {}
                    for (const [apiKeyName, apiKeyData] of Object.entries(apiKeys)) {
                        costMap[apiKeyName] = apiKeyData?.cost || 0
                    }
                    dailyCostByDate[row.stat_date] = costMap
                }
            }

            const apiKeyDailySeries = (dailyRowsForSeries || [])
                .map((row) => {
                    const dayCostMap = dailyCostByDate[row.stat_date] || {}
                    const keys = (row.api_keys || [])
                        .map((k) => ({
                            api_key_name: k.api_key_name || 'unknown',
                            total_requests: k.total_requests || 0,
                            total_tokens: k.total_tokens || 0,
                            success_count: k.success_count || 0,
                            failure_count: k.failure_count || 0,
                            estimated_cost_usd: dayCostMap[k.api_key_name || 'unknown'] || 0,
                            success_rate: (k.total_requests || 0) > 0
                                ? Math.round(((k.success_count || 0) / (k.total_requests || 0)) * 1000) / 10
                                : 0,
                        }))
                        .sort((a, b) => b.total_requests - a.total_requests)

                    return {
                        stat_date: row.stat_date,
                        total_requests: keys.reduce((sum, k) => sum + (k.total_requests || 0), 0),
                        total_tokens: keys.reduce((sum, k) => sum + (k.total_tokens || 0), 0),
                        total_cost: keys.reduce((sum, k) => sum + (k.estimated_cost_usd || 0), 0),
                        keys,
                    }
                })
                .sort((a, b) => (a.stat_date || '').localeCompare(b.stat_date || ''))

            const { startTime, endTime } = getDateBoundaries(rangeId, customRange)
            let apiKeyHourlySeries = []
            let hasHourlyAggregates = false
            try {
                let hourlyQuery = supabase
                    .from('credential_hourly_stats')
                    .select('bucket_hour, api_keys, total_requests, total_tokens, total_cost_usd')
                    .order('bucket_hour', { ascending: true })

                if (startTime) hourlyQuery = hourlyQuery.gte('bucket_hour', startTime)
                if (endTime) hourlyQuery = hourlyQuery.lt('bucket_hour', endTime)

                const { data: hourlyRows, error: hourlyError } = await hourlyQuery
                if (!hourlyError) {
                    hasHourlyAggregates = true
                    apiKeyHourlySeries = (hourlyRows || []).map((row) => {
                        const dt = new Date(row.bucket_hour)
                        const hour = `${dt.toLocaleDateString('en-CA')} ${dt.getHours().toString().padStart(2, '0')}:00`
                        const keys = (row.api_keys || []).map((k) => ({
                            ...k,
                            api_key_name: k.api_key_name || 'unknown',
                            total_requests: k.total_requests || 0,
                            total_tokens: k.total_tokens || 0,
                            estimated_cost_usd: k.estimated_cost_usd || 0,
                        }))
                        return {
                            hour,
                            total_requests: row.total_requests || 0,
                            total_tokens: row.total_tokens || 0,
                            total_cost: Number(row.total_cost_usd || 0),
                            keys,
                        }
                    })
                }
            } catch (hourlyErr) {
                console.debug('credential_hourly_stats not available:', hourlyErr.message)
            }

            setCredentialTimeSeries({
                byDay: apiKeyDailySeries,
                byHour: apiKeyHourlySeries,
                meta: {
                    hasRawSnapshots: hasHourlyAggregates,
                    hasHourlyData: apiKeyHourlySeries.length > 0,
                    rangeId,
                },
            })

            if (!useDailyStats) {
                const { data: rows, error } = await supabase
                    .from('credential_usage_summary')
                    .select('*')
                    .eq('id', 1)
                    .single()

                if (error) {
                    if (error.code === 'PGRST205' || error.message?.includes('relation') || error.message?.includes('does not exist') || error.message?.includes('Could not find')) {
                        setCredentialSetupRequired(true)
                    }
                    throw error
                }

                setCredentialData(rows)
                setCredentialTimeSeries({ byDay: [], byHour: [], meta: { hasRawSnapshots: false, hasHourlyData: false, rangeId } })
                setCredentialSetupRequired(false)
            }
        } catch (err) {
            console.error('Error fetching credential stats:', err)
            setCredentialTimeSeries({ byDay: [], byHour: [], meta: { hasRawSnapshots: false, hasHourlyData: false, rangeId } })
        } finally {
            credentialStatsInFlightRef.current = false
            setCredentialLoading(false)
        }
    }, [authState.authenticated, customRange, dateRange])

    const fetchData = useCallback(async (rangeId = dateRange, isInitial = false) => {
        if (!authState.authenticated) {
            return
        }
        if (dashboardDataInFlightRef.current) {
            return
        }
        dashboardDataInFlightRef.current = true

        const shouldShowInitialLoading = isInitial && !hasInitialDataLoaded

        try {
            if (shouldShowInitialLoading) {
                setLoading(true)
            } else {
                setIsRefreshing(true)
            }

            const { startTime, endTime, startDate, endDate } = getDateBoundaries(rangeId, customRange)
            const isCustomSingleDay = rangeId === 'custom'
                && customRange?.startDate
                && customRange.startDate === customRange.endDate
            const shouldFetchSnapshotSeries = rangeId === 'today' || rangeId === 'yesterday' || isCustomSingleDay

            const { data: latestSnapshots } = await supabase
                .from('usage_snapshots')
                .select('id, collected_at, total_requests, success_count, failure_count, total_tokens, cumulative_cost_usd')
                .order('collected_at', { ascending: false })
                .limit(1)

            if (latestSnapshots?.length > 0) {
                setStats(latestSnapshots[0])
                setLastUpdated(new Date(latestSnapshots[0].collected_at))
            }

            let snapshotsData = []
            if (shouldFetchSnapshotSeries) {
                let snapshotsQuery = supabase
                    .from('usage_snapshots')
                    .select('id, collected_at, total_requests, success_count, failure_count, total_tokens, model_usage(model_name, request_count, total_tokens, estimated_cost_usd, input_tokens, output_tokens, reasoning_tokens, cached_tokens)')
                    .order('collected_at', { ascending: true })

                if (startTime) {
                    snapshotsQuery = snapshotsQuery.gte('collected_at', startTime)
                }
                if (endTime) {
                    snapshotsQuery = snapshotsQuery.lt('collected_at', endTime)
                }

                const { data } = await snapshotsQuery
                snapshotsData = data || []
            }

            let baselineSnapshot = null
            if (shouldFetchSnapshotSeries && startTime && snapshotsData.length > 0) {
                const { data: baselineData } = await supabase
                    .from('usage_snapshots')
                    .select('id, collected_at, total_requests, success_count, failure_count, total_tokens, model_usage(model_name, request_count, total_tokens, estimated_cost_usd)')
                    .lt('collected_at', startTime)
                    .order('collected_at', { ascending: false })
                    .limit(1)

                baselineSnapshot = baselineData?.[0] || null
            }

            const dailyMap = {}
            const hourlyMap = {}
            let prevSnapshot = baselineSnapshot

            if (snapshotsData?.length > 0) {
                for (const snap of snapshotsData) {
                    const snapTime = new Date(snap.collected_at)
                    const dateKey = snapTime.toLocaleDateString('en-CA')
                    const hourKey = snapTime.getHours().toString().padStart(2, '0')

                    if (prevSnapshot) {
                        const delta = {
                            requests: Math.max(0, snap.total_requests - prevSnapshot.total_requests),
                            tokens: Math.max(0, snap.total_tokens - prevSnapshot.total_tokens),
                            success: Math.max(0, snap.success_count - prevSnapshot.success_count),
                            failure: Math.max(0, snap.failure_count - prevSnapshot.failure_count)
                        }

                        if (!dailyMap[dateKey]) {
                            dailyMap[dateKey] = { requests: 0, tokens: 0, success: 0, failure: 0 }
                        }
                        dailyMap[dateKey].requests += delta.requests
                        dailyMap[dateKey].tokens += delta.tokens
                        dailyMap[dateKey].success += delta.success
                        dailyMap[dateKey].failure += delta.failure

                        if (!hourlyMap[hourKey]) {
                            hourlyMap[hourKey] = { requests: 0, tokens: 0, models: {} }
                        }
                        hourlyMap[hourKey].requests += delta.requests
                        hourlyMap[hourKey].tokens += delta.tokens

                        const prevModels = new Map((prevSnapshot.model_usage || []).map(m => [m.model_name, m]))
                        const currModels = new Map((snap.model_usage || []).map(m => [m.model_name, m]))
                        const allModelNames = new Set([...prevModels.keys(), ...currModels.keys()])

                        for (const name of allModelNames) {
                            const p = prevModels.get(name) || { request_count: 0, total_tokens: 0, estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 }
                            const c = currModels.get(name) || { request_count: 0, total_tokens: 0, estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 }

                            let dReq = c.request_count - p.request_count
                            let dTok = c.total_tokens - p.total_tokens
                            let dCost = (c.estimated_cost_usd || 0) - (p.estimated_cost_usd || 0)
                            let dIn = (c.input_tokens || 0) - (p.input_tokens || 0)
                            let dOut = (c.output_tokens || 0) - (p.output_tokens || 0)
                            let dReasoning = (c.reasoning_tokens || 0) - (p.reasoning_tokens || 0)
                            let dCached = (c.cached_tokens || 0) - (p.cached_tokens || 0)

                            if (dReq < 0 || dTok < 0 || dCost < 0) {
                                dReq = c.request_count
                                dTok = c.total_tokens
                                dCost = c.estimated_cost_usd || 0
                                dIn = c.input_tokens || 0
                                dOut = c.output_tokens || 0
                                dReasoning = c.reasoning_tokens || 0
                                dCached = c.cached_tokens || 0
                            }

                            if (dReq > 0 || dTok > 0 || dCost > 0) {
                                if (!hourlyMap[hourKey].models[name]) hourlyMap[hourKey].models[name] = { requests: 0, tokens: 0, cost: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 }
                                hourlyMap[hourKey].models[name].requests += dReq
                                hourlyMap[hourKey].models[name].tokens += dTok
                                hourlyMap[hourKey].models[name].cost += dCost
                                hourlyMap[hourKey].models[name].input_tokens += Math.max(0, dIn)
                                hourlyMap[hourKey].models[name].output_tokens += Math.max(0, dOut)
                                hourlyMap[hourKey].models[name].reasoning_tokens += Math.max(0, dReasoning)
                                hourlyMap[hourKey].models[name].cached_tokens += Math.max(0, dCached)
                            }
                        }
                    }
                    prevSnapshot = snap
                }
            }

            let dailyStatsFromDB = {}
            let breakdownByDate = {}
            let apiKeyBreakdownByDate = {}
            let aggregatedBreakdown = { models: {}, endpoints: {}, api_keys: {} }
            let hasBreakdownData = false

            if (rangeId === 'all' || startDate) {
                let dailyStatsQuery = supabase
                    .from('daily_stats')
                    .select('stat_date, total_requests, total_tokens, success_count, failure_count, estimated_cost_usd, breakdown')

                if (startDate) {
                    dailyStatsQuery = dailyStatsQuery.gte('stat_date', startDate)
                }
                if (endDate) {
                    dailyStatsQuery = dailyStatsQuery.lt('stat_date', endDate)
                }
                const { data: dailyStatsRows } = await dailyStatsQuery
                dailyStatsRows?.forEach(row => {
                    dailyStatsFromDB[row.stat_date] = {
                        total_requests: row.total_requests || 0,
                        total_tokens: row.total_tokens || 0,
                        success_count: row.success_count || 0,
                        failure_count: row.failure_count || 0,
                        estimated_cost_usd: parseFloat(row.estimated_cost_usd) || 0
                    }

                    if (row.breakdown) {
                        hasBreakdownData = true
                        const b = row.breakdown

                        if (b.models) {
                            breakdownByDate[row.stat_date] = b.models
                        }
                        if (b.api_keys) {
                            apiKeyBreakdownByDate[row.stat_date] = b.api_keys
                        }

                        if (b.models) {
                            for (const [mName, data] of Object.entries(b.models)) {
                                if (!aggregatedBreakdown.models[mName]) {
                                    aggregatedBreakdown.models[mName] = {
                                        model_name: mName,
                                        request_count: 0,
                                        total_tokens: 0,
                                        estimated_cost_usd: 0,
                                        input_tokens: 0,
                                        output_tokens: 0,
                                        reasoning_tokens: 0,
                                        cached_tokens: 0,
                                    }
                                }
                                const m = aggregatedBreakdown.models[mName]
                                m.request_count += data.requests || 0
                                m.total_tokens += data.tokens || 0
                                m.estimated_cost_usd += data.cost || 0
                                m.input_tokens += data.input_tokens || 0
                                m.output_tokens += data.output_tokens || 0
                                m.reasoning_tokens += data.reasoning_tokens || 0
                                m.cached_tokens += data.cached_tokens || 0
                            }
                        }

                        if (b.endpoints) {
                            for (const [epName, data] of Object.entries(b.endpoints)) {
                                if (!aggregatedBreakdown.endpoints[epName]) {
                                    aggregatedBreakdown.endpoints[epName] = {
                                        api_endpoint: epName,
                                        request_count: 0,
                                        estimated_cost_usd: 0,
                                        models: {}
                                    }
                                }
                                const e = aggregatedBreakdown.endpoints[epName]
                                e.request_count += data.requests || 0
                                e.estimated_cost_usd += data.cost || 0

                                if (data.models) {
                                    for (const [mName, mData] of Object.entries(data.models)) {
                                        if (!e.models[mName]) {
                                            e.models[mName] = { requests: 0, cost: 0, tokens: 0 }
                                        }
                                        e.models[mName].requests += mData.requests || 0
                                        e.models[mName].cost += mData.cost || 0
                                        e.models[mName].tokens += mData.tokens || 0
                                    }
                                }
                            }
                        }

                        if (b.api_keys) {
                            for (const [apiKeyName, data] of Object.entries(b.api_keys)) {
                                if (!aggregatedBreakdown.api_keys[apiKeyName]) {
                                    aggregatedBreakdown.api_keys[apiKeyName] = {
                                        api_endpoint: apiKeyName,
                                        request_count: 0,
                                        total_tokens: 0,
                                        input_tokens: 0,
                                        output_tokens: 0,
                                        reasoning_tokens: 0,
                                        cached_tokens: 0,
                                        estimated_cost_usd: 0,
                                        success_count: 0,
                                        failure_count: 0,
                                        models: {},
                                        isApiKeyUsage: true,
                                    }
                                }
                                const keyUsage = aggregatedBreakdown.api_keys[apiKeyName]
                                keyUsage.request_count += data.requests || 0
                                keyUsage.total_tokens += data.tokens || 0
                                keyUsage.input_tokens += data.input_tokens || 0
                                keyUsage.output_tokens += data.output_tokens || 0
                                keyUsage.reasoning_tokens += data.reasoning_tokens || 0
                                keyUsage.cached_tokens += data.cached_tokens || 0
                                keyUsage.estimated_cost_usd += data.cost || 0
                                keyUsage.success_count += data.success || 0
                                keyUsage.failure_count += data.failure || 0

                                for (const [mName, mData] of Object.entries(data.models || {})) {
                                    if (!keyUsage.models[mName]) {
                                        keyUsage.models[mName] = { requests: 0, cost: 0, tokens: 0 }
                                    }
                                    keyUsage.models[mName].requests += mData.requests || 0
                                    keyUsage.models[mName].cost += mData.cost || 0
                                    keyUsage.models[mName].tokens += mData.tokens || 0
                                }
                            }
                        }
                    }
                })
            }

            const allDates = new Set([
                ...Object.keys(dailyMap),
                ...Object.keys(dailyStatsFromDB)
            ])

            const mergedDailyArray = Array.from(allDates).map(dateKey => {
                const fromDB = dailyStatsFromDB[dateKey]
                const calculated = dailyMap[dateKey]

                return {
                    stat_date: dateKey,
                    total_requests: fromDB?.total_requests ?? (calculated?.requests || 0),
                    total_tokens: fromDB?.total_tokens ?? (calculated?.tokens || 0),
                    success_count: fromDB?.success_count ?? (calculated?.success || 0),
                    failure_count: fromDB?.failure_count ?? (calculated?.failure || 0),
                    estimated_cost_usd: fromDB?.estimated_cost_usd ?? 0,
                    models: breakdownByDate[dateKey] || {},
                    api_keys: apiKeyBreakdownByDate[dateKey] || {}
                }
            }).sort((a, b) => a.stat_date.localeCompare(b.stat_date))

            setDailyStats(mergedDailyArray)

            const now = new Date()
            const hoursToShow = rangeId === 'today' ? now.getHours() + 1 : 24
            const hourlyArray = Array.from({ length: hoursToShow }, (_, i) => {
                const hourKey = i.toString().padStart(2, '0')
                const hData = hourlyMap[hourKey] || { requests: 0, tokens: 0, models: {} }
                return {
                    time: `${hourKey}:00`,
                    requests: hData.requests,
                    tokens: hData.tokens,
                    models: hData.models || {},
                    api_keys: {}
                }
            })
            setHourlyStats(hourlyArray)

            if (hasBreakdownData) {
                const finalModels = Object.values(aggregatedBreakdown.models)
                    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                setModelUsage(finalModels)

                const finalApiKeys = Object.values(aggregatedBreakdown.api_keys)
                    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                const finalEndpoints = finalApiKeys.length > 0
                    ? finalApiKeys
                    : Object.values(aggregatedBreakdown.endpoints)
                        .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                setEndpointUsage(finalEndpoints)
            } else {
                if (snapshotsData?.length > 0) {
                    let totalByModel = new Map()
                    const cleanArray = (arr) => arr.filter(x => x !== null && x !== undefined)

                    let baselineId = null
                    if (startTime) {
                        const { data: baselineData } = await supabase.from('usage_snapshots')
                            .select('id, collected_at, total_requests, success_count, failure_count, total_tokens')
                            .lt('collected_at', startTime)
                            .order('collected_at', { ascending: false })
                            .limit(1)

                        baselineId = baselineData?.[0]?.id
                    }

                    let effectiveBaselineId = baselineId
                    let startIdx = 0

                    if (startTime && !baselineId && snapshotsData.length > 0) {
                        effectiveBaselineId = snapshotsData[0].id
                        startIdx = 0
                    }

                    const criticalSnapIds = []

                    for (let i = startIdx; i < snapshotsData.length - 1; i++) {
                        const curr = snapshotsData[i]
                        const next = snapshotsData[i + 1]
                        if (next.total_requests < curr.total_requests || next.total_tokens < curr.total_tokens) {
                            criticalSnapIds.push(curr.id)
                        }
                    }
                    if (snapshotsData.length > 0) {
                        const lastId = snapshotsData[snapshotsData.length - 1].id
                        if (lastId !== effectiveBaselineId) {
                            criticalSnapIds.push(lastId)
                        }
                    }

                    const allSnapIdsToFetch = cleanArray([effectiveBaselineId, ...criticalSnapIds])
                    const uniqueSnapIds = [...new Set(allSnapIdsToFetch)]

                    const { data: usageRecords } = await supabase.from('model_usage')
                        .select('snapshot_id, model_name, api_endpoint, request_count, input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, estimated_cost_usd')
                        .in('snapshot_id', uniqueSnapIds)
                        .limit(100000)

                    const snapMap = new Map()
                    usageRecords?.forEach(record => {
                        if (!snapMap.has(record.snapshot_id)) {
                            snapMap.set(record.snapshot_id, new Map())
                        }
                        const key = `${record.model_name}|||${record.api_endpoint}`
                        snapMap.get(record.snapshot_id).set(key, record)
                    })

                    let prevModelUsageMap = snapMap.get(effectiveBaselineId) || new Map()

                    for (const currentSnapId of criticalSnapIds) {
                        const currentModelUsageMap = snapMap.get(currentSnapId)
                        if (!currentModelUsageMap) {
                            continue
                        }

                        const allKeys = new Set([...prevModelUsageMap.keys(), ...currentModelUsageMap.keys()])

                        for (const key of allKeys) {
                            const prev = prevModelUsageMap.get(key) || { request_count: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 }
                            const curr = currentModelUsageMap.get(key) || { request_count: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 }

                            let deltaReq = 0, deltaIn = 0, deltaOut = 0, deltaReasoning = 0, deltaCached = 0, deltaTotal = 0, deltaCost = 0

                            const isReset = curr.total_tokens < prev.total_tokens || curr.request_count < prev.request_count

                            if (isReset) {
                                deltaReq = curr.request_count
                                deltaIn = curr.input_tokens
                                deltaOut = curr.output_tokens
                                deltaReasoning = curr.reasoning_tokens || 0
                                deltaCached = curr.cached_tokens || 0
                                deltaTotal = curr.total_tokens
                                deltaCost = parseFloat(curr.estimated_cost_usd || 0)
                            } else {
                                deltaReq = curr.request_count - prev.request_count
                                deltaIn = curr.input_tokens - prev.input_tokens
                                deltaOut = curr.output_tokens - prev.output_tokens
                                deltaReasoning = (curr.reasoning_tokens || 0) - (prev.reasoning_tokens || 0)
                                deltaCached = (curr.cached_tokens || 0) - (prev.cached_tokens || 0)
                                deltaTotal = curr.total_tokens - prev.total_tokens
                                deltaCost = parseFloat(curr.estimated_cost_usd || 0) - parseFloat(prev.estimated_cost_usd || 0)
                            }

                            if (deltaReq > 0 || deltaCost > 0) {
                                if (!totalByModel.has(key)) {
                                    totalByModel.set(key, {
                                        model_name: curr.model_name || prev.model_name,
                                        api_endpoint: curr.api_endpoint || prev.api_endpoint,
                                        request_count: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0, estimated_cost_usd: 0
                                    })
                                }
                                const item = totalByModel.get(key)
                                item.request_count += deltaReq
                                item.input_tokens += deltaIn
                                item.output_tokens += deltaOut
                                item.reasoning_tokens += deltaReasoning
                                item.cached_tokens += deltaCached
                                item.total_tokens += deltaTotal
                                item.estimated_cost_usd += deltaCost
                            }
                        }
                        prevModelUsageMap = currentModelUsageMap
                    }

                    const modelMap = new Map()
                    for (const [, data] of totalByModel) {
                        const mName = data.model_name
                        if (!modelMap.has(mName)) {
                            modelMap.set(mName, {
                                model_name: mName,
                                api_endpoint: data.api_endpoint,
                                request_count: 0,
                                input_tokens: 0,
                                output_tokens: 0,
                                reasoning_tokens: 0,
                                cached_tokens: 0,
                                total_tokens: 0,
                                estimated_cost_usd: 0
                            })
                        }
                        const mExisting = modelMap.get(mName)
                        mExisting.request_count += data.request_count
                        mExisting.input_tokens += data.input_tokens
                        mExisting.output_tokens += data.output_tokens
                        mExisting.reasoning_tokens += data.reasoning_tokens || 0
                        mExisting.cached_tokens += data.cached_tokens || 0
                        mExisting.total_tokens += data.total_tokens
                        mExisting.estimated_cost_usd += data.estimated_cost_usd
                    }

                    const finalModels = Array.from(modelMap.values())
                    setModelUsage(finalModels.sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd))

                    const endpointMap = new Map()
                    for (const [, data] of totalByModel) {
                        const ep = data.api_endpoint
                        if (!endpointMap.has(ep)) {
                            endpointMap.set(ep, {
                                api_endpoint: ep,
                                model_name: data.model_name,
                                request_count: 0,
                                input_tokens: 0,
                                output_tokens: 0,
                                total_tokens: 0,
                                estimated_cost_usd: 0
                            })
                        }
                        const eExisting = endpointMap.get(ep)
                        eExisting.request_count += data.request_count
                        eExisting.estimated_cost_usd += data.estimated_cost_usd
                    }

                    setEndpointUsage(Array.from(endpointMap.values()))
                } else {
                    setModelUsage([])
                    setEndpointUsage([])
                }
            }

            let skillRunsQuery = supabase
                .from('skill_runs')
                .select('event_uid,tool_use_id,skill_name,session_id,machine_id,source,triggered_at,status,error_type,error_message,attempt_no,tokens_used,output_tokens,duration_ms,model,tool_calls,estimated_cost_usd,is_skeleton,project_dir')
                .eq('is_skeleton', false)
                .order('triggered_at', { ascending: false })
                .limit(1000)

            if (startTime) {
                skillRunsQuery = skillRunsQuery.gte('triggered_at', startTime)
            }
            if (endTime) {
                skillRunsQuery = skillRunsQuery.lt('triggered_at', endTime)
            }

            let skillDailyQuery = supabase
                .from('skill_daily_stats')
                .select('*')
                .order('stat_date', { ascending: true })

            if (startDate) {
                skillDailyQuery = skillDailyQuery.gte('stat_date', startDate)
            }
            if (endDate) {
                skillDailyQuery = skillDailyQuery.lt('stat_date', endDate)
            }

            let appLogsQuery = supabase
                .from('app_logs')
                .select('id,event_uid,logged_at,source,category,severity,title,message,details,session_id,machine_id,project_dir')
                .order('logged_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(APP_LOGS_PAGE_SIZE)

            if (startTime) {
                appLogsQuery = appLogsQuery.gte('logged_at', startTime)
            }
            if (endTime) {
                appLogsQuery = appLogsQuery.lt('logged_at', endTime)
            }

            const [{ data: skillRunsData }, { data: skillDailyData }, { data: appLogsData }] = await Promise.all([
                skillRunsQuery,
                skillDailyQuery,
                appLogsQuery,
            ])

            const appRows = appLogsData || []

            setSkillRuns(skillRunsData || [])
            setSkillDailyStats(skillDailyData || [])
            setAppLogs(appRows)
            setHasInitialDataLoaded(true)

            setLoading(false)
            setIsRefreshing(false)
        } catch (error) {
            console.error('Error fetching data:', error)
            setLoading(false)
            setIsRefreshing(false)
        } finally {
            dashboardDataInFlightRef.current = false
        }
    }, [authState.authenticated, customRange, dateRange, hasInitialDataLoaded])

    useEffect(() => {
        const onUnauthorized = () => handleUnauthorized()
        window.addEventListener('cliproxy:auth-unauthorized', onUnauthorized)
        return () => window.removeEventListener('cliproxy:auth-unauthorized', onUnauthorized)
    }, [handleUnauthorized])

    useEffect(() => {
        fetchSession()
    }, [fetchSession])

    useEffect(() => {
        if (!authState.authenticated) return
        fetchData(dateRange, true)
        fetchCredentialStats(dateRange)
    }, [authState.authenticated, dateRange, fetchData, fetchCredentialStats])

    useEffect(() => {
        if (!authState.authenticated) return

        const interval = setInterval(() => {
            fetchData(dateRange)
            fetchCredentialStats(dateRange)
        }, FRONTEND_AUTO_REFRESH_MS)

        return () => {
            clearInterval(interval)
        }
    }, [authState.authenticated, dateRange, fetchData, fetchCredentialStats])

    const triggerCollector = async () => {
        const collectorUrl = `${COLLECTOR_BASE}/trigger`

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000)

            const response = await authFetch(collectorUrl, {
                method: 'POST',
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (!response.ok) {
                console.warn(`Collector trigger failed with status: ${response.status}`)
                return false
            }

            const result = await response.json()
            console.log('Collector trigger result:', result)
            return result.status === 'success'
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('Collector trigger timed out')
            } else {
                console.warn('Could not trigger collector:', error.message)
            }
            return false
        }
    }

    const handleDateRangeChange = async (days, shouldTriggerCollector = false) => {
        if (shouldTriggerCollector) {
            setIsRefreshing(true)
            try {
                await triggerCollector()
                await new Promise(resolve => setTimeout(resolve, 500))

                if (days === dateRange) {
                    await fetchData()
                    await fetchCredentialStats(dateRange)
                }
            } catch (e) {
                console.error('Trigger error:', e)
                setIsRefreshing(false)
            }
        }
        setDateRange(days)
    }

    const clearAllAppLogs = useCallback(async () => {
        const response = await authFetch(`${COLLECTOR_BASE}/logs/clear`, {
            method: 'POST',
            body: JSON.stringify({ scope: 'all' })
        })

        if (!response.ok) {
            throw new Error(`Clear logs failed: ${response.status}`)
        }

        await fetchData(dateRange)
    }, [authFetch, dateRange, fetchData])

    const handleCustomRangeApply = (range) => {
        setCustomRange({
            startDate: range.startDate || null,
            endDate: range.endDate || null
        })
        setDateRange('custom')
    }

    const handleLoginSubmit = async (event) => {
        event.preventDefault()

        if (DEV_BYPASS_AUTH) {
            unauthorizedHandledRef.current = false
            setAuthState({ loading: false, authenticated: true, authRequired: false, expiresAt: null, rememberMe: true })
            setLoginError('')
            return
        }

        setLoginError('')
        setLoginSubmitting(true)

        try {
            const response = await authFetch(`${COLLECTOR_BASE}/auth/login`, {
                method: 'POST',
                body: JSON.stringify(loginForm),
                skipUnauthorized: true,
            })

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}))
                setLoginError(payload.error || 'Đăng nhập thất bại.')
                return
            }

            const session = await response.json()
            const authRequired = Boolean(session.auth_required)
            const authenticated = !authRequired || Boolean(session.authenticated)
            unauthorizedHandledRef.current = false
            setAuthState({
                loading: false,
                authenticated,
                authRequired,
                expiresAt: session.expires_at || null,
                rememberMe: Boolean(session.remember_me),
            })
            setLoginForm(prev => ({ ...prev, password: '' }))
            setLoginError('')
        } catch (error) {
            console.error('Login failed:', error)
            setLoginError('Không thể kết nối tới collector để đăng nhập.')
        } finally {
            setLoginSubmitting(false)
        }
    }

    const handleLogout = useCallback(async () => {
        try {
            await authFetch(`${COLLECTOR_BASE}/auth/logout`, { method: 'POST' })
        } catch (error) {
            console.error('Logout failed:', error)
        } finally {
            unauthorizedHandledRef.current = false
            resetDashboardState()
            setAuthState(prev => ({
                loading: false,
                authenticated: !prev.authRequired,
                authRequired: prev.authRequired,
                expiresAt: null,
                rememberMe: false,
            }))
            setLoginForm(prev => ({ ...prev, password: '' }))
            setLoginError('')
        }
    }, [authFetch, resetDashboardState])

    if (authState.loading) {
        return (
            <div className="dashboard auth-screen">
                <div className="auth-shell">
                    <div className="auth-card auth-card--loading">
                        <div className="auth-kicker">Session</div>
                        <h1 className="auth-title">CLIProxy Dashboard</h1>
                        <p className="auth-subtitle">Checking session...</p>
                    </div>
                </div>
            </div>
        )
    }

    if (authState.authRequired && !authState.authenticated) {
        return (
            <div className="dashboard auth-screen">
                <div className="auth-shell">
                    <form onSubmit={handleLoginSubmit} className="auth-card">
                        <div className="auth-kicker">Admin Access</div>
                        <h1 className="auth-title">CLIProxy Dashboard</h1>
                        <p className="auth-subtitle">Đăng nhập để mở dashboard và khóa truy cập dữ liệu qua session cookie HttpOnly.</p>

                        <label className="auth-field">
                            <span className="auth-label">Password</span>
                            <input
                                className="auth-input"
                                type="password"
                                value={loginForm.password}
                                onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                                autoComplete="current-password"
                                placeholder="Nhập mật khẩu admin"
                            />
                        </label>

                        <label className="auth-checkbox">
                            <input
                                type="checkbox"
                                checked={loginForm.rememberMe}
                                onChange={(e) => setLoginForm(prev => ({ ...prev, rememberMe: e.target.checked }))}
                            />
                            <span>Remember this device</span>
                        </label>

                        {loginError ? (
                            <div className="auth-alert" role="alert">
                                {loginError}
                            </div>
                        ) : null}

                        <div className="auth-actions">
                            <button
                                type="submit"
                                className="auth-submit"
                                disabled={loginSubmitting}
                            >
                                {loginSubmitting ? 'Signing in...' : 'Unlock dashboard'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )
    }

    return (
        <div className="app">
            <Dashboard
                stats={stats}
                dailyStats={dailyStats}
                modelUsage={modelUsage}
                hourlyStats={hourlyStats}
                loading={loading}
                isRefreshing={isRefreshing}
                lastUpdated={lastUpdated}
                dateRange={dateRange}
                onDateRangeChange={handleDateRangeChange}
                customRange={customRange}
                rangeBoundaries={rangeBoundaries}
                onCustomRangeApply={handleCustomRangeApply}
                endpointUsage={endpointUsage}
                credentialData={credentialData}
                credentialTimeSeries={credentialTimeSeries}
                credentialLoading={credentialLoading}
                credentialSetupRequired={credentialSetupRequired}
                skillRuns={mockSkillData.skillRuns}
                skillDailyStats={mockSkillData.skillDailyStats}
                appLogs={appLogs}
                onClearAllLogs={clearAllAppLogs}
                onLogout={authState.authRequired ? handleLogout : undefined}
            />
        </div>
    )
}

export default App
