-- ============================================
-- Credential Usage Summary
-- ============================================
-- Stores real-time per-credential and per-API-key usage statistics
-- parsed from CLIProxy Management API usage details.
--
-- This is a "current snapshot" table - refreshed on each collector sync.
-- CLIProxy resets counters on restart, so this reflects usage since last restart.
--
-- Date: 2026-02-15
-- ============================================

CREATE TABLE IF NOT EXISTS credential_usage_summary (
    id SERIAL PRIMARY KEY,

    -- Per-credential usage stats (aggregated from usage.apis.*.models.*.details[])
    -- Each entry: { auth_index, source, provider, email, credential_name, status,
    --               total_requests, success_count, failure_count,
    --               input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens,
    --               models: { model_name: { requests, success, failure, input_tokens, output_tokens, ... } },
    --               api_keys: [ list of api_key names that used this credential ] }
    credentials JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Per-API-key usage stats (top-level keys in usage.apis)
    -- Each entry: { api_key_name, total_requests, total_tokens,
    --               models: { model_name: { requests, tokens, ... } },
    --               credentials_used: [ list of auth_index that were used ] }
    api_keys JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Raw totals for quick access
    total_credentials INTEGER DEFAULT 0,
    total_api_keys INTEGER DEFAULT 0,

    -- Timestamp
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only keep one row (latest summary)
-- The collector will UPSERT by id=1
INSERT INTO credential_usage_summary (id, credentials, api_keys) VALUES (1, '[]', '[]')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE credential_usage_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to credential_usage_summary"
    ON credential_usage_summary FOR SELECT
    USING (true);

CREATE POLICY "Allow service role full access to credential_usage_summary"
    ON credential_usage_summary
    USING (auth.role() = 'service_role');

COMMENT ON TABLE credential_usage_summary IS 'Real-time credential and API key usage summary from CLIProxy. Single-row table refreshed on each sync.';
