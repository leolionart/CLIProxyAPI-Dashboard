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


