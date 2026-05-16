CREATE TABLE IF NOT EXISTS credential_hourly_stats (
    id BIGSERIAL PRIMARY KEY,
    bucket_hour TIMESTAMPTZ NOT NULL UNIQUE,
    api_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credential_hourly_stats_bucket
    ON credential_hourly_stats(bucket_hour DESC);

GRANT SELECT ON credential_hourly_stats TO web_anon;
