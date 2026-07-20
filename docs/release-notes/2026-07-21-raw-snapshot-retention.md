# Raw Snapshot Retention

## Changed

- Collector no longer stores the full cumulative CLIProxy payload in `usage_snapshots.raw_data` on every sync.
- Raw payloads are now optional debug samples controlled by:
  - `RAW_SNAPSHOT_ENABLED`
  - `RAW_SNAPSHOT_RETENTION_DAYS`
  - `RAW_SNAPSHOT_MIN_INTERVAL_HOURS`
  - `RAW_SNAPSHOT_CLEANUP_BATCH_SIZE`
  - `RAW_SNAPSHOT_CLEANUP_MAX_BATCHES`
- Expired raw payloads are set to `NULL` in bounded batches without deleting `usage_snapshots` rows, preserving `model_usage` history.
- Added an idempotent migration for raw snapshot retention/time-range indexes.

## Operational Notes

- Default behavior keeps roughly one raw debug payload every 24 hours and retains raw payloads for 3 days.
- Dashboard/statistics reads continue using normalized aggregate tables and `model_usage`.
- Startup and daily cleanup logs include nullified row counts, batch counts, cutoff, and duration.
