-- Supabase Database Schema for CLIProxy Dashboard
-- Run this in Supabase SQL Editor

-- Table for storing raw usage snapshots
CREATE TABLE IF NOT EXISTS usage_snapshots (
    id BIGSERIAL PRIMARY KEY,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_requests INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    raw_data JSONB
);

-- Table for storing per-model usage data
CREATE TABLE IF NOT EXISTS model_usage (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT REFERENCES usage_snapshots(id) ON DELETE CASCADE,
    api_endpoint VARCHAR(255) NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(10, 6) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for storing daily aggregated statistics
CREATE TABLE IF NOT EXISTS daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date DATE NOT NULL UNIQUE,
    total_requests INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(10, 6) DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for model pricing configuration
CREATE TABLE IF NOT EXISTS model_pricing (
    id BIGSERIAL PRIMARY KEY,
    model_pattern VARCHAR(255) NOT NULL UNIQUE,
    input_price_per_million DECIMAL(10, 4) NOT NULL,
    output_price_per_million DECIMAL(10, 4) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_collected_at ON usage_snapshots(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_snapshot_id ON model_usage(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_model_name ON model_usage(model_name);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date DESC);

-- Enable Row Level Security (optional, for production)
ALTER TABLE usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_pricing ENABLE ROW LEVEL SECURITY;

-- Create policies to allow read access for anon users
CREATE POLICY "Allow read access" ON usage_snapshots FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON model_usage FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON daily_stats FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON model_pricing FOR SELECT USING (true);

-- Create policies to allow service role to insert/update
CREATE POLICY "Allow service insert" ON usage_snapshots FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service insert" ON model_usage FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service upsert" ON daily_stats FOR ALL USING (true);
CREATE POLICY "Allow service insert" ON model_pricing FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service insert" ON model_pricing FOR INSERT WITH CHECK (true);

-- Table for rate limit configurations
CREATE TABLE IF NOT EXISTS rate_limit_configs (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL, -- 'OpenAI', 'Anthropic', 'Google'
    tier_name VARCHAR(50) NOT NULL, -- 'Plus', 'Pro', 'AI Pro'
    model_pattern VARCHAR(255) NOT NULL, -- e.g. 'gpt-4', 'claude-3', 'gemini'
    token_limit BIGINT, -- Null means no specific token limit
    request_limit INTEGER, -- Null means no specific request limit
    context_window INTEGER, -- Max context window in tokens
    window_minutes INTEGER NOT NULL DEFAULT 1440, -- Default 24 hours
    reset_strategy VARCHAR(20) NOT NULL DEFAULT 'daily', -- 'daily', 'rolling', 'fixed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for tracking current rate limit status
CREATE TABLE IF NOT EXISTS rate_limit_status (
    id BIGSERIAL PRIMARY KEY,
    config_id BIGINT REFERENCES rate_limit_configs(id) ON DELETE CASCADE,
    remaining_tokens BIGINT,
    remaining_requests INTEGER,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_reset TIMESTAMPTZ,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_status_per_config UNIQUE (config_id)
);

-- Enable RLS for new tables
ALTER TABLE rate_limit_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_status ENABLE ROW LEVEL SECURITY;

-- Policies for new tables
CREATE POLICY "Allow read access" ON rate_limit_configs FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON rate_limit_status FOR SELECT USING (true);
CREATE POLICY "Allow service all" ON rate_limit_configs FOR ALL USING (true);
CREATE POLICY "Allow service all" ON rate_limit_status FOR ALL USING (true);

-- Insert default rate limit configurations
-- Codex/ChatGPT Plus: 5h soft ~800k tokens, Weekly hard ~5M tokens
-- Claude Pro: 5h soft ~1.5M tokens, Weekly planning ~20M tokens
-- Google AI Pro: 5h soft ~2M tokens, Weekly ~25M tokens
INSERT INTO rate_limit_configs (provider, tier_name, model_pattern, token_limit, request_limit, context_window, window_minutes, reset_strategy)
VALUES 
    -- Codex - ChatGPT Plus: 5 hour limit (~800k tokens)
    ('OpenAI', 'Plus', 'gpt', 800000, NULL, 192000, 300, 'rolling'),
    -- Codex - ChatGPT Plus: Weekly limit (~5M tokens)
    ('OpenAI', 'Plus', 'gpt-weekly', 5000000, NULL, 192000, 10080, 'weekly'),
    
    -- Claude Pro: 5 hour limit (~1.5M tokens)
    ('Anthropic', 'Pro', 'claude', 1500000, NULL, 200000, 300, 'rolling'),
    -- Claude Pro: Weekly limit (~20M tokens)
    ('Anthropic', 'Pro', 'claude-weekly', 20000000, NULL, 200000, 10080, 'weekly'),
    
    -- Google AI Pro: 5 hour limit (~2M tokens)
    ('Google', 'AI Pro', 'gemini', 2000000, NULL, 1000000, 300, 'rolling'),
    -- Google AI Pro: Weekly limit (~25M tokens)
    ('Google', 'AI Pro', 'gemini-weekly', 25000000, NULL, 1000000, 10080, 'weekly');

