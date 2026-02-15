/**
 * AI Provider Brand Colors — Single source of truth
 *
 * CSS variables are defined in styles/index.css as --color-brand-*
 * This module mirrors those values for JS usage (e.g. Recharts).
 * Keep both in sync when updating provider colors.
 */

// Chart palette fallback for unknown models
export const CHART_COLORS = [
  '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
]

// Provider brand colors — keyword → hex
// Mirrors --color-brand-* CSS custom properties in index.css
export const BRAND_COLORS = {
  // OpenAI — --color-brand-openai
  'openai': '#10a37f',
  'gpt': '#10a37f',
  'o1': '#10a37f',
  'o3': '#10a37f',
  'chatgpt': '#10a37f',
  'codex': '#10a37f',

  // Anthropic — --color-brand-anthropic
  'anthropic': '#d97757',
  'claude': '#d97757',
  'antigravity': '#d97757',

  // Google — --color-brand-google
  'google': '#4285f4',
  'gemini': '#4285f4',
  'gemini-cli': '#4285f4',
  'gemini-api-key': '#4285f4',
  'vertex': '#4285f4',
  'palm': '#34a853',
  'bard': '#fbbc04',

  // DeepSeek — --color-brand-deepseek
  'deepseek': '#8b5cf6',

  // Alibaba/Qwen — --color-brand-qwen
  'qwen': '#ff6a00',
  'alibaba': '#ff6a00',

  // Meta — --color-brand-meta
  'meta': '#0668e1',
  'llama': '#0668e1',

  // Mistral — --color-brand-mistral
  'mistral': '#6366f1',

  // xAI — --color-brand-xai
  'grok': '#64748b',
  'xai': '#64748b',

  // Cohere — --color-brand-cohere
  'cohere': '#14b8a6',

  // AI21 — --color-brand-ai21
  'ai21': '#a855f7',
  'jurassic': '#a855f7',

  // Fallback
  'unknown': '#94a3b8',
}

/**
 * Resolve a model name to its brand color.
 * Checks keywords in BRAND_COLORS, falls back to hash-based palette.
 */
export function getModelColor(modelName) {
  if (!modelName) return BRAND_COLORS.unknown

  const lower = modelName.toLowerCase()
  for (const [keyword, color] of Object.entries(BRAND_COLORS)) {
    if (lower.includes(keyword)) return color
  }

  // Hash-based fallback for consistency
  let hash = 0
  for (let i = 0; i < modelName.length; i++) {
    hash = modelName.charCodeAt(i) + ((hash << 5) - hash)
  }
  return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length]
}

// Provider display config for credential badges
// Maps provider key → { name, colorVar }
// colorVar is the CSS custom property name for use in stylesheets
export const PROVIDER_DISPLAY = {
  'openai': { name: 'OpenAI', colorVar: '--color-brand-openai' },
  'codex': { name: 'Codex', colorVar: '--color-brand-openai' },
  'gpt': { name: 'GPT', colorVar: '--color-brand-openai' },
  'chatgpt': { name: 'ChatGPT', colorVar: '--color-brand-openai' },
  'claude': { name: 'Claude', colorVar: '--color-brand-anthropic' },
  'antigravity': { name: 'Antigravity', colorVar: '--color-brand-anthropic' },
  'anthropic': { name: 'Anthropic', colorVar: '--color-brand-anthropic' },
  'google': { name: 'Google', colorVar: '--color-brand-google' },
  'gemini': { name: 'Gemini', colorVar: '--color-brand-google' },
  'gemini-cli': { name: 'Gemini CLI', colorVar: '--color-brand-google' },
  'gemini-api-key': { name: 'Gemini Key', colorVar: '--color-brand-google' },
  'vertex': { name: 'Vertex AI', colorVar: '--color-brand-google' },
  'deepseek': { name: 'DeepSeek', colorVar: '--color-brand-deepseek' },
  'qwen': { name: 'Qwen', colorVar: '--color-brand-qwen' },
  'alibaba': { name: 'Alibaba', colorVar: '--color-brand-qwen' },
  'meta': { name: 'Meta', colorVar: '--color-brand-meta' },
  'llama': { name: 'Llama', colorVar: '--color-brand-meta' },
  'mistral': { name: 'Mistral', colorVar: '--color-brand-mistral' },
  'grok': { name: 'Grok', colorVar: '--color-brand-xai' },
  'xai': { name: 'xAI', colorVar: '--color-brand-xai' },
  'oauth': { name: 'OAuth', colorVar: '--color-brand-ai21' },
  'api-key': { name: 'API Key', colorVar: '--color-brand-xai' },
  'unknown': { name: 'Unknown', colorVar: '--color-brand-unknown' },
}

export function getProviderDisplay(provider) {
  return PROVIDER_DISPLAY[provider?.toLowerCase()] ||
    { name: provider || 'Unknown', colorVar: '--color-brand-unknown' }
}
