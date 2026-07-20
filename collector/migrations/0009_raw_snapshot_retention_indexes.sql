CREATE INDEX IF NOT EXISTS idx_usage_snapshots_collected_at
    ON usage_snapshots(collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_raw_data_retention
    ON usage_snapshots(collected_at ASC)
    WHERE raw_data IS NOT NULL;
