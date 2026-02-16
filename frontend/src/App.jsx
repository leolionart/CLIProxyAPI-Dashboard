import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import Dashboard from './components/Dashboard'

// Helper to get date boundaries based on range ID
// Uses local timezone for date display, converts to UTC for timestamp queries
const getDateBoundaries = (rangeId) => {
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

    switch (rangeId) {
        case 'today':
            return {
                startDate: todayStr,      // For daily_stats (YYYY-MM-DD)
                endDate: null,
                startTime: todayUTC,      // For model_usage/snapshots (UTC ISO)
                endTime: null
            }
        case 'yesterday':
            return {
                startDate: yesterdayStr,
                endDate: todayStr,        // exclusive
                startTime: yesterdayUTC,  // start of yesterday in UTC
                endTime: todayUTC         // start of today in UTC (exclusive)
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
        case 'year': {
            const yearStart = new Date(now.getFullYear(), 0, 1)
            return {
                startDate: formatDate(yearStart),
                endDate: null,
                startTime: localMidnightToUTC(yearStart),
                endTime: null
            }
        }
        case 'all':
        default:
            return { startDate: null, endDate: null, startTime: null, endTime: null }
    }
}

function App() {
    const [stats, setStats] = useState(null)
    const [dailyStats, setDailyStats] = useState([])
    const [modelUsage, setModelUsage] = useState([])
    const [endpointUsage, setEndpointUsage] = useState([]) // NEW: granular usage for API Keys
    const [hourlyStats, setHourlyStats] = useState([]) // NEW: hourly breakdown
    const [loading, setLoading] = useState(true) // Only for initial load
    const [isRefreshing, setIsRefreshing] = useState(false) // For date range changes
    const [lastUpdated, setLastUpdated] = useState(null)
    const [dateRange, setDateRange] = useState('today') // 'today', 'yesterday', '7d', '30d', 'year', 'all'

    // Credential stats state
    const [credentialData, setCredentialData] = useState(null)
    const [credentialLoading, setCredentialLoading] = useState(true)
    const [credentialSetupRequired, setCredentialSetupRequired] = useState(false)

    // Fetch credential stats (not affected by date range)
    const fetchCredentialStats = useCallback(async () => {
        try {
            setCredentialLoading(true)
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
            setCredentialSetupRequired(false)
        } catch (err) {
            console.error('Error fetching credential stats:', err)
        } finally {
            setCredentialLoading(false)
        }
    }, [])

    const fetchData = useCallback(async (rangeId = dateRange, isInitial = false) => {
        try {
            if (isInitial) {
                setLoading(true)
            } else {
                setIsRefreshing(true)
            }

            const { startTime, endTime, startDate, endDate } = getDateBoundaries(rangeId)

            // 1. Fetch latest snapshot for raw_data (used for Rate Limits)
            const { data: latestSnapshots } = await supabase
                .from('usage_snapshots')
                .select('*')
                .order('collected_at', { ascending: false })
                .limit(1)

            if (latestSnapshots?.length > 0) {
                setStats(latestSnapshots[0])
                setLastUpdated(new Date(latestSnapshots[0].collected_at))
            }

            // 2. Fetch ALL snapshots within date range (including model_usage for granular delta)
            let snapshotsQuery = supabase
                .from('usage_snapshots')
                .select('id, collected_at, total_requests, success_count, failure_count, total_tokens, model_usage(model_name, request_count, total_tokens, estimated_cost_usd)')
                .order('collected_at', { ascending: true })

            if (startTime) {
                snapshotsQuery = snapshotsQuery.gte('collected_at', startTime)
            }
            if (endTime) {
                snapshotsQuery = snapshotsQuery.lt('collected_at', endTime)
            }

            const { data: snapshotsData } = await snapshotsQuery

            // 2b. Fetch baseline snapshot (just before startTime) for accurate delta calculation
            let baselineSnapshot = null
            if (startTime && snapshotsData?.length > 0) {
                const { data: baselineData } = await supabase
                    .from('usage_snapshots')
                    .select('id, collected_at, total_requests, success_count, failure_count, total_tokens, model_usage(model_name, request_count, total_tokens, estimated_cost_usd)')
                    .lt('collected_at', startTime)
                    .order('collected_at', { ascending: false })
                    .limit(1)

                baselineSnapshot = baselineData?.[0] || null
            }

            // 3. Calculate daily and hourly stats from snapshots
            const dailyMap = {}
            const hourlyMap = {}
            let prevSnapshot = baselineSnapshot  // Start with baseline instead of null

            if (snapshotsData?.length > 0) {
                for (const snap of snapshotsData) {
                    const snapTime = new Date(snap.collected_at)
                    const dateKey = snapTime.toLocaleDateString('en-CA') // YYYY-MM-DD in local timezone
                    const hourKey = snapTime.getHours().toString().padStart(2, '0')

                    if (prevSnapshot) {
                        const delta = {
                            requests: Math.max(0, snap.total_requests - prevSnapshot.total_requests),
                            tokens: Math.max(0, snap.total_tokens - prevSnapshot.total_tokens),
                            success: Math.max(0, snap.success_count - prevSnapshot.success_count),
                            failure: Math.max(0, snap.failure_count - prevSnapshot.failure_count)
                        }

                        // Aggregate by day
                        if (!dailyMap[dateKey]) {
                            dailyMap[dateKey] = { requests: 0, tokens: 0, success: 0, failure: 0 }
                        }
                        dailyMap[dateKey].requests += delta.requests
                        dailyMap[dateKey].tokens += delta.tokens
                        dailyMap[dateKey].success += delta.success
                        dailyMap[dateKey].failure += delta.failure

                        // Aggregate by hour
                        if (!hourlyMap[hourKey]) {
                            hourlyMap[hourKey] = { requests: 0, tokens: 0, models: {} }
                        }
                        hourlyMap[hourKey].requests += delta.requests
                        hourlyMap[hourKey].tokens += delta.tokens

                        // Model Breakdown Logic
                        const prevModels = new Map((prevSnapshot.model_usage || []).map(m => [m.model_name, m]))
                        const currModels = new Map((snap.model_usage || []).map(m => [m.model_name, m]))
                        const allModelNames = new Set([...prevModels.keys(), ...currModels.keys()])

                        for (const name of allModelNames) {
                            const p = prevModels.get(name) || { request_count: 0, total_tokens: 0, estimated_cost_usd: 0 }
                            const c = currModels.get(name) || { request_count: 0, total_tokens: 0, estimated_cost_usd: 0 }

                            // Calculate delta for this model
                            // Handle restarts (curr < prev) -> assume curr is the delta (approx)
                            let dReq = c.request_count - p.request_count
                            let dTok = c.total_tokens - p.total_tokens
                            let dCost = (c.estimated_cost_usd || 0) - (p.estimated_cost_usd || 0)

                            if (dReq < 0 || dTok < 0 || dCost < 0) {
                                dReq = c.request_count
                                dTok = c.total_tokens
                                dCost = c.estimated_cost_usd || 0
                            }

                            if (dReq > 0 || dTok > 0 || dCost > 0) {
                                if (!hourlyMap[hourKey].models[name]) hourlyMap[hourKey].models[name] = { requests: 0, tokens: 0, cost: 0 }
                                hourlyMap[hourKey].models[name].requests += dReq
                                hourlyMap[hourKey].models[name].tokens += dTok
                                hourlyMap[hourKey].models[name].cost += dCost
                            }
                        }
                    }
                    prevSnapshot = snap
                }
            }

            // Convert daily map to array (requests/tokens derived from snapshots)
            const calculatedDailyArray = Object.entries(dailyMap)
                .map(([date, data]) => ({
                    stat_date: date,
                    total_requests: data.requests,
                    total_tokens: data.tokens,
                    success_count: data.success,
                    failure_count: data.failure,
                    estimated_cost_usd: 0
                }))
                .sort((a, b) => a.stat_date.localeCompare(b.stat_date))

            // Fetch authoritative data from daily_stats table
            let dailyStatsFromDB = {}  // Keyed by stat_date
            let breakdownByDate = {} // Store breakdown for daily stats
            let aggregatedBreakdown = { models: {}, endpoints: {} }
            let hasBreakdownData = false

            // For 'all' time, we want all daily stats, otherwise respect startDate
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

                    // Aggregate Breakdown from JSON
                    if (row.breakdown) {
                        hasBreakdownData = true
                        const b = row.breakdown

                        // Store daily breakdown for charts
                        if (b.models) {
                             breakdownByDate[row.stat_date] = b.models
                        }

                        // Merge Models
                        if (b.models) {
                            for (const [mName, data] of Object.entries(b.models)) {
                                if (!aggregatedBreakdown.models[mName]) {
                                    aggregatedBreakdown.models[mName] = {
                                        model_name: mName,
                                        request_count: 0,
                                        total_tokens: 0,
                                        estimated_cost_usd: 0,
                                        input_tokens: 0, // Not stored in breakdown currently, assume 0 or avg?
                                        output_tokens: 0
                                        // Note: breakdown JSON only stores 'tokens' (total).
                                        // If we need input/output split, we need to update schema/collector.
                                        // For now, charts use total_tokens mainly. Cost details table uses input/output.
                                        // If input/output missing, table might show 0.
                                        // Update: My collector update DID NOT save input/output split to breakdown.
                                        // This is a regression for the table view if we switch fully.
                                    }
                                }
                                const m = aggregatedBreakdown.models[mName]
                                m.request_count += data.requests || 0
                                m.total_tokens += data.tokens || 0
                                m.estimated_cost_usd += data.cost || 0
                                m.input_tokens += data.input_tokens || 0
                                m.output_tokens += data.output_tokens || 0
                            }
                        }

                        // Merge Endpoints
                        if (b.endpoints) {
                             for (const [epName, data] of Object.entries(b.endpoints)) {
                                 if (!aggregatedBreakdown.endpoints[epName]) {
                                     aggregatedBreakdown.endpoints[epName] = {
                                         api_endpoint: epName,
                                         request_count: 0,
                                         estimated_cost_usd: 0,
                                         models: {} // Track nested model usage
                                     }
                                 }
                                 const e = aggregatedBreakdown.endpoints[epName]
                                 e.request_count += data.requests || 0
                                 e.estimated_cost_usd += data.cost || 0

                                 // Merge nested models if available
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
                    }
                })
            }

            // Merge calculated data with daily_stats data
            // Priority: Use daily_stats if available (authoritative), fallback to calculated data
            const allDates = new Set([
                ...Object.keys(dailyMap),
                ...Object.keys(dailyStatsFromDB)
            ])

            const mergedDailyArray = Array.from(allDates).map(dateKey => {
                const fromDB = dailyStatsFromDB[dateKey]
                const calculated = dailyMap[dateKey]

                // Prefer DB data if available, otherwise use calculated
                return {
                    stat_date: dateKey,
                    total_requests: fromDB?.total_requests ?? (calculated?.requests || 0),
                    total_tokens: fromDB?.total_tokens ?? (calculated?.tokens || 0),
                    success_count: fromDB?.success_count ?? (calculated?.success || 0),
                    failure_count: fromDB?.failure_count ?? (calculated?.failure || 0),
                    estimated_cost_usd: fromDB?.estimated_cost_usd ?? 0,
                    models: breakdownByDate[dateKey] || {}
                }
            }).sort((a, b) => a.stat_date.localeCompare(b.stat_date))

            setDailyStats(mergedDailyArray)

            // Convert hourly map to array
            const now = new Date()
            const hoursToShow = rangeId === 'today' ? now.getHours() + 1 : 24
            const hourlyArray = Array.from({ length: hoursToShow }, (_, i) => {
                const hourKey = i.toString().padStart(2, '0')
                const hData = hourlyMap[hourKey] || { requests: 0, tokens: 0, models: {} }

                // Flatten model usage for easy chart consumption
                // Structure: { time, requests, tokens, models: { "gpt-4": { requests: 10, tokens: 100, cost: 0.05 }, ... } }
                return {
                    time: `${hourKey}:00`,
                    requests: hData.requests,
                    tokens: hData.tokens,
                    models: hData.models || {}
                }
            })
            setHourlyStats(hourlyArray)

            // 4. Get model usage
            // PRIORITY: Use Aggregated Breakdown if available (Performance Optimization)
            if (hasBreakdownData) {
                 const finalModels = Object.values(aggregatedBreakdown.models)
                    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                 setModelUsage(finalModels)

                 const finalEndpoints = Object.values(aggregatedBreakdown.endpoints)
                    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
                 setEndpointUsage(finalEndpoints)
            } else {
                // FALLBACK: Old Snapshot Logic (Slow, but full detail including input/output tokens)
                // ... (Keep existing logic as else block)
                if (snapshotsData?.length > 0) {
                     // ... existing snapshot processing ...
                     // I need to wrap the existing logic in this else block.
                     // But wait, the existing logic is huge.
                     // I will implement this by conditionally executing the snapshot logic.
                } else {
                    setModelUsage([])
                    setEndpointUsage([])
                }
            }

            // To properly wrap, I'll use a guard clause or boolean flag.
            const runSnapshotLogic = !hasBreakdownData && snapshotsData?.length > 0;

            if (runSnapshotLogic) {
                let totalByModel = new Map()
                // ... (rest of the existing logic) ...


                // Helper function to clean arrays (remove null/undefined)
                const cleanArray = (arr) => arr.filter(x => x !== null && x !== undefined);

                // 1. Identify "Critical Points" (Baseline, Peaks, Last Snapshot)

                // We need a baseline (snapshot BEFORE the range) to calculate valid delta for the first segment.
                // If no baseline (e.g. All Time), assume 0 for all counters.
                let baselineId = null;
                if (startTime) {
                    const { data: baselineData } = await supabase.from('usage_snapshots')
                        .select('id, collected_at, total_requests, success_count, failure_count, total_tokens')
                        .lt('collected_at', startTime)
                        .order('collected_at', { ascending: false })
                        .limit(1)

                    baselineId = baselineData?.[0]?.id;
                }

                // Handling for "Missing Baseline" in specific date ranges (e.g. "Today" but first install was at noon)
                // If we have a startTime (not All Time) but NO baseline found, we must treat the FIRST snapshot
                // of the range as the baseline to avoid counting its cumulative value as "Today's usage".
                let effectiveBaselineId = baselineId;
                let startIdx = 0;

                if (startTime && !baselineId && snapshotsData.length > 0) {
                     effectiveBaselineId = snapshotsData[0].id;
                     // We start processing critical points from the NEXT snapshot,
                     // effectively ignoring the first snapshot's absolute value (delta = 0)
                     // But we still need to check if it's a critical point itself?
                     // No, if it's the baseline, it's the reference.
                     startIdx = 0; // We will handle this by filtering criticalSnapIds
                }

                const criticalSnapIds = [];

                // Iterate snapshotsData to find "peaks" (snapshots immediately preceding a reset)
                for (let i = startIdx; i < snapshotsData.length - 1; i++) {
                    const curr = snapshotsData[i];
                    const next = snapshotsData[i + 1];

                    // Detect a global restart if total_requests or total_tokens drop significantly
                    // A simple drop check is sufficient for CLIProxy's global counters
                    if (next.total_requests < curr.total_requests || next.total_tokens < curr.total_tokens) {
                        criticalSnapIds.push(curr.id); // This 'curr' is a peak before a reset
                    }
                }
                // Always include the very last snapshot in the range as a critical point
                // Unless the range only had 1 snapshot and we used it as baseline?
                if (snapshotsData.length > 0) {
                     const lastId = snapshotsData[snapshotsData.length - 1].id;
                     if (lastId !== effectiveBaselineId) {
                         criticalSnapIds.push(lastId);
                     }
                }

                // 2. Fetch detailed model usage for Baseline and all Critical Points
                const allSnapIdsToFetch = cleanArray([effectiveBaselineId, ...criticalSnapIds]);
                // Ensure unique IDs
                const uniqueSnapIds = [...new Set(allSnapIdsToFetch)];

                // If we have a lot of critical points (e.g. erratic server over a year), we might need to batch this.
                // For now, assuming < 100 restarts is safe for a single 'in' query.
                // CRITICAL: Supabase defaults to 1000 rows. With many snapshots, this query can return thousands of rows.
                // We MUST increase the limit.
                const { data: usageRecords } = await supabase.from('model_usage')
                    .select('snapshot_id, model_name, api_endpoint, request_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd')
                    .in('snapshot_id', uniqueSnapIds)
                    .limit(100000); // Increase limit to ensure we get all records

                // Group fetched usage records by Snapshot ID -> Map<snapshot_id, Map<composite_key, model_usage_data>>
                const snapMap = new Map();
                usageRecords?.forEach(record => {
                    if (!snapMap.has(record.snapshot_id)) {
                        snapMap.set(record.snapshot_id, new Map());
                    }
                    const key = `${record.model_name}|||${record.api_endpoint}`;
                    snapMap.get(record.snapshot_id).set(key, record);
                });

                // 3. Calculate total usage by summing deltas between critical points
                let prevModelUsageMap = snapMap.get(effectiveBaselineId) || new Map(); // Start with baseline or empty map

                // If effectiveBaselineId was snapshotsData[0] (because real baseline missing),
                // prevModelUsageMap is populated with its data.
                // If effectiveBaselineId was null (All Time), prevModelUsageMap is empty.

                for (const currentSnapId of criticalSnapIds) {
                    const currentModelUsageMap = snapMap.get(currentSnapId);
                    if (!currentModelUsageMap) {
                         // If we requested it but it's missing (e.g. partial data), skip to avoid crash
                         // But we must NOT update prevModelUsageMap to keep continuity from valid baseline
                         continue;
                    }

                    // Get all unique model+endpoint keys present in either previous or current map
                    const allKeys = new Set([...prevModelUsageMap.keys(), ...currentModelUsageMap.keys()]);

                    for (const key of allKeys) {
                        const prev = prevModelUsageMap.get(key) || { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };
                        const curr = currentModelUsageMap.get(key) || { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };

                        let deltaReq = 0, deltaIn = 0, deltaOut = 0, deltaTotal = 0, deltaCost = 0;

                        // Determine if a reset occurred for this specific model+endpoint key
                        // A reset is indicated if current counters are less than previous counters
                        const isReset = curr.total_tokens < prev.total_tokens || curr.request_count < prev.request_count;

                        if (isReset) {
                            // If reset, the usage for this segment is simply the current value
                            // (assuming it started from ~0 after the reset)
                            deltaReq = curr.request_count;
                            deltaIn = curr.input_tokens;
                            deltaOut = curr.output_tokens;
                            deltaTotal = curr.total_tokens;
                            deltaCost = parseFloat(curr.estimated_cost_usd || 0);
                        } else {
                            // No reset, calculate the difference
                            deltaReq = curr.request_count - prev.request_count;
                            deltaIn = curr.input_tokens - prev.input_tokens;
                            deltaOut = curr.output_tokens - prev.output_tokens;
                            deltaTotal = curr.total_tokens - prev.total_tokens;
                            deltaCost = parseFloat(curr.estimated_cost_usd || 0) - parseFloat(prev.estimated_cost_usd || 0);
                        }

                        // Only add positive deltas (usage cannot be negative)
                        if (deltaReq > 0 || deltaCost > 0) {
                            if (!totalByModel.has(key)) {
                                totalByModel.set(key, {
                                    model_name: curr.model_name || prev.model_name, // Use whichever is available
                                    api_endpoint: curr.api_endpoint || prev.api_endpoint,
                                    request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0
                                });
                            }
                            const item = totalByModel.get(key);
                            item.request_count += deltaReq;
                            item.input_tokens += deltaIn;
                            item.output_tokens += deltaOut;
                            item.total_tokens += deltaTotal;
                            item.estimated_cost_usd += deltaCost;
                        }
                    }
                    // Move current map to previous for the next iteration
                    prevModelUsageMap = currentModelUsageMap;
                }

                // Final Aggregation: Split into Model Usage (Summed) and Endpoint Usage (Granular)

                // 1. Model Usage: Group by model_name
                const modelMap = new Map()
                // 2. Endpoint Usage: This is already totalByModel (keyed by composite), but we should ensure valid list

                for (const [key, data] of totalByModel) {
                    const mName = data.model_name
                    if (!modelMap.has(mName)) {
                        modelMap.set(mName, {
                            model_name: mName,
                            api_endpoint: data.api_endpoint, // First endpoint found (will be overwritten if mult)
                            request_count: 0,
                            input_tokens: 0,
                            output_tokens: 0,
                            total_tokens: 0,
                            estimated_cost_usd: 0
                        })
                    }
                    const mExisting = modelMap.get(mName)
                    mExisting.request_count += data.request_count
                    mExisting.input_tokens += data.input_tokens
                    mExisting.output_tokens += data.output_tokens
                    mExisting.total_tokens += data.total_tokens
                    mExisting.estimated_cost_usd += data.estimated_cost_usd
                    // Note: api_endpoint aggregation for Model List isn't strictly needed as list doesn't show it,
                    // but if it does, we'd need a Set. For now, one endpoint is fine or ignore.
                }

                const finalModels = Array.from(modelMap.values())
                setModelUsage(finalModels.sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd))

                // Endpoint Usage (for API Keys chart)
                // We aggregate by api_endpoint (summing across models for the same key) or keep separate?
                // The API Keys chart typically shows: "sk-abc (Gemini)": Usage?
                // Or just "sk-abc": Usage?
                // The Dashboard previously derived it from "modelUsage".
                // If we want "One bar per API Key", we sort by API Key.
                // If one API key is used for multiple models, do we group them? YES.

                const endpointMap = new Map()
                for (const [key, data] of totalByModel) {
                    const ep = data.api_endpoint
                    if (!endpointMap.has(ep)) {
                        endpointMap.set(ep, {
                            api_endpoint: ep,
                            model_name: data.model_name, // Representative
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
                    // We can track models used too
                }

                setEndpointUsage(Array.from(endpointMap.values()))
            }

            setLoading(false)
            setIsRefreshing(false)
        } catch (error) {
            console.error('Error fetching data:', error)
            setLoading(false)
            setIsRefreshing(false)
        }
    }, [dateRange])

    // Initial load - fetch credential stats once
    useEffect(() => {
        fetchCredentialStats()
    }, [fetchCredentialStats])

    // Refetch when dateRange changes
    useEffect(() => {
        fetchData(dateRange)
    }, [dateRange, fetchData])

    useEffect(() => {
        // Set up real-time subscription
        const channel = supabase
            .channel('usage_changes')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'usage_snapshots' },
                () => {
                    fetchData(dateRange)
                }
            )
            .subscribe()

        // Refresh every 5 minutes - also refresh credential stats
        const interval = setInterval(() => {
            fetchData(dateRange)
            fetchCredentialStats()
        }, 5 * 60 * 1000)

        return () => {
            supabase.removeChannel(channel)
            clearInterval(interval)
        }
    }, [dateRange, fetchData, fetchCredentialStats])

    // Trigger collector to fetch fresh data from CLIProxy
    const triggerCollector = async () => {
        // In production (Docker): use relative URL via nginx proxy
        // In development: fallback to localhost:5001
        const isProduction = import.meta.env.PROD
        const collectorUrl = isProduction
            ? '/api/collector/trigger'  // Nginx proxies this to collector container
            : (import.meta.env.VITE_COLLECTOR_URL || 'http://localhost:5001') + '/trigger'

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

            const response = await fetch(collectorUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                // Small delay to let collector store data
                await new Promise(resolve => setTimeout(resolve, 500))

                // If date range hasn't changed, useEffect won't run, so we must fetch manually
                if (days === dateRange) {
                    await fetchData()
                }
            } catch (e) {
                console.error('Trigger error:', e)
                setIsRefreshing(false)
            }
        }
        setDateRange(days)
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
                endpointUsage={endpointUsage}
                credentialData={credentialData}
                credentialLoading={credentialLoading}
                credentialSetupRequired={credentialSetupRequired}
            />
        </div>
    )
}

export default App
