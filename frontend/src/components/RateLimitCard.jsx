
import { useState, useEffect } from 'react'
import {
    loadRateLimitsConfig,
    saveConfig,
    resetProviderLimits,
    getQuotaStatusColor
} from '../lib/rateLimits'

/**
 * Progress Bar Component
 */
const ProgressBar = ({ remainingPercentage, color }) => {
    const usagePercentage = 100 - remainingPercentage

    return (
        <div className="limit-progress-bar">
            <div
                className="limit-progress-fill"
                style={{
                    width: `${usagePercentage}%`,
                    background: color,
                    minWidth: usagePercentage > 0 ? '2%' : '0'
                }}
            />
        </div>
    )
}

/**
 * Custom Confirm Modal
 */
const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
    if (!isOpen) return null

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                </div>
                <div className="modal-body">
                    <p>{message}</p>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onCancel}>Hủy</button>
                    <button className="btn-primary" onClick={onConfirm}>Xác nhận</button>
                </div>
            </div>
        </div>
    )
}

/**
 * Single Limit Display Component - Matches reference image
 */
const LimitItem = ({ limitConfig, isHourly, onReset }) => {
    const status = limitConfig.backendStatus || { percentage: 100, label: 'Unknown', nextReset: null }
    const color = getQuotaStatusColor(status.percentage)
    const usedPercentage = 100 - status.percentage

    // Check if this is an unlimited limit (limit = 0 or label contains "Unlimited")
    const isUnlimited = limitConfig.limit === 0 || status.label === 'Unlimited'

    let resetDisplay = ''
    if (!isUnlimited) {
        if (status.nextReset) {
            const resetDate = new Date(status.nextReset)
            if (!isNaN(resetDate.getTime())) {
                const now = new Date()
                const timeStr = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                const dateStr = resetDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
                if (resetDate.toDateString() === now.toDateString()) {
                    resetDisplay = `Resets Today ${timeStr}`
                } else {
                    resetDisplay = `Resets ${dateStr} ${timeStr}`
                }
            } else {
                resetDisplay = isHourly ? '5h rolling' : 'Weekly reset'
            }
        } else {
            resetDisplay = isHourly ? '5h rolling' : 'Weekly reset'
        }
    }

    // Display name matching reference image
    const displayName = isHourly ? '5 hour usage limit' : 'Weekly usage limit'

    // Special UI for unlimited
    if (isUnlimited) {
        return (
            <div className="limit-item limit-unlimited">
                <div className="limit-header">
                    <span className="limit-name">{displayName}</span>
                </div>
                <div className="limit-stats">
                    <span className="limit-percentage unlimited">∞</span>
                    <span className="limit-label">Unlimited</span>
                </div>
                <div className="limit-progress-bar">
                    <div className="limit-progress-fill unlimited-fill" style={{ width: '100%' }} />
                </div>
                <div className="limit-footer">
                    <span className="limit-reset-time">No limit</span>
                    <span className="limit-used">Unlimited</span>
                </div>
            </div>
        )
    }

    return (
        <div className="limit-item">
            <div className="limit-header">
                <span className="limit-name">{displayName}</span>
                {onReset && (
                    <button className="limit-reset-btn" onClick={onReset} title="Reset this limit">
                        🔄
                    </button>
                )}
            </div>
            <div className="limit-stats">
                <span className="limit-percentage" style={{ color }}>{status.percentage}%</span>
                <span className="limit-label">remaining</span>
            </div>
            <ProgressBar remainingPercentage={status.percentage} color={color} />
            <div className="limit-footer">
                <span className="limit-reset-time">{resetDisplay}</span>
                <span className="limit-used">{status.label}</span>
            </div>
        </div>
    )
}

/**
 * Provider Card - Simplified layout matching reference
 */
const ProviderCard = ({ provider, providerKey, onReset }) => {
    const [resetting, setResetting] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    if (!provider.enabled || !provider.limits || provider.limits.length === 0) {
        return null
    }

    // Separate and sort: hourly first, then weekly
    const hourlyLimits = provider.limits.filter(l => l.windowHours && l.windowHours <= 24)
    const weeklyLimits = provider.limits.filter(l => !l.windowHours || l.windowHours > 24)
    const sortedLimits = [...hourlyLimits, ...weeklyLimits]

    const handleResetClick = () => {
        setShowConfirm(true)
    }

    const handleConfirmReset = async () => {
        setShowConfirm(false)
        setResetting(true)
        await onReset(providerKey)
        setResetting(false)
    }

    return (
        <>
            <div className="provider-limits-card">
                <div className="provider-card-header">
                    <div className="provider-info">
                        <span className="provider-icon">{provider.icon}</span>
                        <span className="provider-name">{provider.name}</span>
                    </div>
                    <button
                        className="provider-reset-btn"
                        onClick={handleResetClick}
                        disabled={resetting}
                        title="Reset all limits"
                    >
                        {resetting ? '⏳' : '🔄'}
                    </button>
                </div>

                <div className="provider-limits-list">
                    {sortedLimits.map(limitConfig => {
                        const isHourly = limitConfig.windowHours && limitConfig.windowHours <= 24
                        return (
                            <LimitItem
                                key={limitConfig.id}
                                limitConfig={limitConfig}
                                isHourly={isHourly}
                            />
                        )
                    })}
                </div>
            </div>

            <ConfirmModal
                isOpen={showConfirm}
                title="Reset Limits"
                message={`Reset tất cả giới hạn cho ${provider.name}? Cả giới hạn 5h và tuần sẽ được reset về 100%.`}
                onConfirm={handleConfirmReset}
                onCancel={() => setShowConfirm(false)}
            />
        </>
    )
}

/**
 * Settings Modal for DB Configuration
 */
const SettingsModal = ({ isOpen, onClose, config, onSave }) => {
    const [localConfig, setLocalConfig] = useState(config)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (config) {
            setLocalConfig(JSON.parse(JSON.stringify(config)))
        }
    }, [config, isOpen])

    if (!isOpen || !localConfig) return null

    const handleLimitChange = (providerKey, limitIndex, field, value) => {
        setLocalConfig(prev => {
            const newConfig = { ...prev }
            const limits = [...newConfig.providers[providerKey].limits]

            limits[limitIndex] = {
                ...limits[limitIndex],
                [field]: value
            }

            newConfig.providers[providerKey] = {
                ...newConfig.providers[providerKey],
                limits
            }
            return newConfig
        })
    }

    const addLimit = (providerKey) => {
        setLocalConfig(prev => {
            const newConfig = { ...prev }
            const limits = [...(newConfig.providers[providerKey].limits || [])]
            limits.push({
                id: `limit_${Date.now()}`,
                name: 'New Limit',
                limit: 1000,
                unit: 'tokens',
                resetType: 'rolling',
                windowHours: 5
            })
            newConfig.providers[providerKey] = {
                ...newConfig.providers[providerKey],
                limits
            }
            return newConfig
        })
    }

    const removeLimit = (providerKey, limitIndex) => {
        setLocalConfig(prev => {
            const newConfig = { ...prev }
            const limits = [...newConfig.providers[providerKey].limits]
            limits.splice(limitIndex, 1)
            newConfig.providers[providerKey] = {
                ...newConfig.providers[providerKey],
                limits
            }
            return newConfig
        })
    }

    const handleSave = async () => {
        setSaving(true)
        await saveConfig(localConfig)
        setSaving(false)
        onSave()
        onClose()
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content settings-modal-large" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>⚙️ Rate Limit Settings</h2>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    {Object.entries(localConfig.providers).map(([key, provider]) => (
                        <div key={key} className="settings-provider-section">
                            <div className="settings-provider-header">
                                <span className="provider-icon">{provider.icon}</span>
                                <span className="provider-name">{provider.name}</span>
                            </div>

                            <div className="settings-limits-list">
                                {provider.limits && provider.limits.map((limit, idx) => (
                                    <div key={limit.id} className="settings-limit-item">
                                        <div className="limit-item-header">
                                            <input
                                                type="text"
                                                className="limit-name-input"
                                                value={limit.name}
                                                onChange={e => handleLimitChange(key, idx, 'name', e.target.value)}
                                                placeholder="Model Pattern (e.g. gpt-4)"
                                            />
                                            <button className="remove-limit-btn" onClick={() => removeLimit(key, idx)}>✕</button>
                                        </div>
                                        <div className="limit-fields-grid">
                                            <div className="settings-field">
                                                <label>Limit Value</label>
                                                <input
                                                    type="number"
                                                    value={limit.limit}
                                                    onChange={e => handleLimitChange(key, idx, 'limit', e.target.value)}
                                                />
                                            </div>
                                            <div className="settings-field">
                                                <label>Unit</label>
                                                <select
                                                    value={limit.unit}
                                                    onChange={e => handleLimitChange(key, idx, 'unit', e.target.value)}
                                                >
                                                    <option value="requests">Requests</option>
                                                    <option value="tokens">Tokens</option>
                                                </select>
                                            </div>
                                            <div className="settings-field">
                                                <label>Type</label>
                                                <select
                                                    value={limit.resetType}
                                                    onChange={e => handleLimitChange(key, idx, 'resetType', e.target.value)}
                                                >
                                                    <option value="rolling">Rolling</option>
                                                    <option value="fixed">Fixed</option>
                                                    <option value="daily">Daily</option>
                                                    <option value="weekly">Weekly</option>
                                                </select>
                                            </div>
                                            <div className="settings-field">
                                                <label>Window (Hours)</label>
                                                <input
                                                    type="number"
                                                    value={limit.windowHours}
                                                    onChange={e => handleLimitChange(key, idx, 'windowHours', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <button className="add-limit-btn" onClick={() => addLimit(key)}>+ Add Limit</button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save & Sync'}
                    </button>
                </div>
            </div>
        </div>
    )
}

/**
 * Main Rate Limit Card Component
 */
function RateLimitCard({ usageData }) {
    const [config, setConfig] = useState(null)
    const [loading, setLoading] = useState(true)
    const [showSettings, setShowSettings] = useState(false)

    const fetchLimits = () => {
        loadRateLimitsConfig().then((data) => {
            if (data) {
                setConfig(data)
                setLoading(false)
            } else {
                setConfig({
                    providers: {
                        openai: { name: 'OpenAI Plus', icon: '🤖', enabled: true, limits: [] },
                        anthropic: { name: 'Anthropic Pro', icon: '🟣', enabled: true, limits: [] },
                        google: { name: 'Google AI Pro', icon: '💎', enabled: true, limits: [] }
                    }
                })
                setLoading(false)
            }
        })
    }

    useEffect(() => {
        let mounted = true
        fetchLimits()
        const interval = setInterval(fetchLimits, 30000)
        return () => { mounted = false; clearInterval(interval) }
    }, [usageData])

    const handleProviderReset = async (providerKey) => {
        const provider = config.providers[providerKey];
        if (!provider || !provider.limits) return;

        // In production (Docker): use relative URL via nginx proxy
        // In development: fallback to localhost:5001
        const isProduction = import.meta.env.PROD;
        const baseUrl = isProduction ? '' : (import.meta.env.VITE_COLLECTOR_URL || 'http://localhost:5001');

        // Create an array of fetch promises for each limit config
        const resetPromises = provider.limits.map(limitConfig => {
            const configId = limitConfig.id;
            if (!configId) return Promise.resolve(); // Skip if no ID

            console.log(`Sending reset request for config ID: ${configId}`);
            return fetch(`${baseUrl}/api/collector/reset/${configId}`, {
                method: 'POST',
            })
                .then(response => {
                    if (!response.ok) {
                        console.error(`Failed to reset limit for config ID: ${configId}`);
                    }
                    return response.json();
                })
                .catch(error => {
                    console.error(`Error resetting limit for config ID: ${configId}`, error);
                });
        });

        // Wait for all reset requests to complete
        await Promise.all(resetPromises);

        // Fetch the updated limits to refresh the UI
        console.log("All reset requests sent. Fetching updated limits...");
        fetchLimits();
    }

    if (loading) {
        return <div className="rate-limit-card"><div className="loading-mini">Loading limits...</div></div>
    }

    const enabledProviders = config && config.providers ? Object.entries(config.providers) : []

    return (
        <>
            <div className="rate-limit-card">
                <div className="card-header">
                    <h3>⚡ Rate Limits</h3>
                    <div className="card-header-actions">
                        <span className="card-subtitle">Usage limits</span>
                        <button
                            className="settings-btn"
                            onClick={() => setShowSettings(true)}
                            title="Configure rate limits"
                        >
                            ⚙️
                        </button>
                    </div>
                </div>

                {enabledProviders.length > 0 ? (
                    <div className="providers-limits-grid">
                        {enabledProviders.map(([key, provider]) => (
                            <ProviderCard
                                key={key}
                                providerKey={key}
                                provider={provider}
                                onReset={handleProviderReset}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="empty-state">
                        Rate limits not configured.
                        <button className="settings-btn-inline" onClick={() => setShowSettings(true)}>Configure Now</button>
                    </div>
                )}
            </div>

            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                config={config}
                onSave={fetchLimits}
            />
        </>
    )
}

export default RateLimitCard
