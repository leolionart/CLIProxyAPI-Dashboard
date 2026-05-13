# Skill Tracking Pipeline (Mar 2026)

Summary for AI agents: how skill run telemetry flows from clients → collector → PostgREST → dashboard.

## Endpoint and payload

- **Endpoint:** `POST /api/collector/skill-events`
- **Body:** `{ "events": [ { ... } ] }`
- **Minimum required fields:** `skill_name`, `session_id`
- **Primary idempotency key:** `event_uid` (fallback conflict key remains `(machine_id, sqlite_id, session_id, skill_name)` for backward compatibility)
- **Provider/source marker:** Claude marketplace plugin sends `source = plugin`; Codex hook sends `source = codex-hook`.

## 2-phase telemetry lifecycle

### Codex — Stop hook inferred final event

Codex does not expose a first-class `Skill` tool event equivalent to Claude. The repo therefore ships a best-effort Stop hook:

```bash
python3 "/Volumes/DATA/Coding Projects/CLIProxyDash/scripts/codex_skill_usage_hook.py"
```

The hook reads the Codex session JSONL, infers skill usage from concrete evidence, and sends final rows directly with `is_skeleton = false`.

Current evidence rules:
- command/function-call arguments that include a `*/skills/<skill>/SKILL.md` read
- assistant messages that explicitly announce skill usage

Operational notes:
- Treat Codex skill rows as inferred telemetry, not exact runtime events.
- Keep `source = codex-hook` visible in drilldowns so they can be separated from Claude plugin rows.
- The same `/skill-events` merge and aggregate path is reused, so no schema change is required.
- For other machines, prefer the one-step installer: `curl -fsSL https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/scripts/setup_codex_tracking.py | python3 - --collector-url "https://your-domain/api/collector/skill-events"`.
- Manual setup is still supported: install the hook script under `~/.codex/hooks/`, set `CLIPROXY_COLLECTOR_URL`, enable `features.codex_hooks = true`, and append the command to `~/.codex/hooks.json` Stop hooks.
- Codex sub-agent / agent lifecycle is not collected by this hook. It needs a separate agent event contract, collector endpoint, storage table, and dashboard view.

### Phase 1 — Early skeleton (`PostToolUse` on `Skill`)

Client plugin sends an early event immediately after `Skill` tool returns prompt text.

Typical properties:
- `is_skeleton = true`
- Stable identity fields already present (`event_uid`, `session_id`, `skill_name`, ...)
- Metrics may be missing/low (`tokens_used`, `duration_ms`, `tool_calls`, `model`)

Purpose:
- Prevent losing trace identity when the session ends before full execution is available.

### Phase 2 — Final enrichment (`Stop` hook)

At session stop, plugin re-parses transcript and sends enriched event with the **same `event_uid`**.

Typical properties:
- `is_skeleton = false`
- Better metrics from completed execution window
- Final status/error fields

Purpose:
- Improve analytics quality while preserving idempotent identity.

## Data contract

### Immutable fields (must not change across phases)

- `event_uid`
- `machine_id`
- `session_id`
- `skill_name`
- `tool_use_id`
- `attempt_no`
- `triggered_at`

### Enrichable fields (phase 2 can improve)

- `tokens_used`
- `output_tokens`
- `tool_calls`
- `duration_ms`
- `model`
- `status`
- `error_type`
- `error_message`
- `is_skeleton`
- `synced_at`

## Collector merge policy (phase-aware)

Ingest logic reads existing row by `event_uid` before upsert and applies safe merge:

- **Incoming skeleton + existing final:** do not downgrade final metrics/status/model.
- **Incoming final:** enrich over skeleton and keep best known metrics (prefer non-empty/non-zero; numeric fields keep max).
- **Out-of-order arrival:** late skeleton cannot revert an already-final row.

Estimated cost is recalculated from merged model/tokens.

## Aggregation behavior

- `skill_daily_stats` is updated only for rows resolved as final (`is_skeleton = false`).
- Skeleton rows are stored for traceability but excluded from aggregates.

## Frontend consumption

- `skill_runs` drives recent runs and per-skill rollups.
- `skill_daily_stats` drives daily charts.
- Dashboard behavior stays stable because analytics focus on final rows.

## Operational SQL checks

### Duplicate check

```sql
SELECT event_uid, COUNT(*)
FROM skill_runs
WHERE event_uid IS NOT NULL
GROUP BY event_uid
HAVING COUNT(*) > 1;
```

### Skeleton backlog (possible missing final enrichment)

```sql
SELECT event_uid, skill_name, session_id, triggered_at
FROM skill_runs
WHERE is_skeleton = true
  AND triggered_at < NOW() - INTERVAL '15 minutes'
ORDER BY triggered_at DESC
LIMIT 100;
```

### Data quality on final rows (24h)

```sql
SELECT
  COUNT(*) AS total_final,
  COUNT(*) FILTER (WHERE COALESCE(tokens_used,0)=0 AND COALESCE(output_tokens,0)=0) AS zero_token_final,
  COUNT(*) FILTER (WHERE model IS NULL OR model='') AS missing_model_final
FROM skill_runs
WHERE is_skeleton = false
  AND triggered_at >= NOW() - INTERVAL '24 hours';
```

### Aggregate consistency (`skill_runs` final vs `skill_daily_stats`)

```sql
WITH raw AS (
  SELECT DATE(triggered_at) AS stat_date, skill_name, machine_id,
         COUNT(*) AS run_count,
         SUM(tokens_used) AS total_tokens,
         SUM(output_tokens) AS total_output_tokens,
         SUM(duration_ms) AS total_duration_ms,
         SUM(tool_calls) AS total_tool_calls,
         SUM(estimated_cost_usd) AS total_cost_usd
  FROM skill_runs
  WHERE is_skeleton = false
  GROUP BY 1,2,3
)
SELECT r.stat_date, r.skill_name, r.machine_id,
       r.run_count AS raw_run_count, d.run_count AS daily_run_count,
       r.total_tokens AS raw_tokens, d.total_tokens AS daily_tokens
FROM raw r
JOIN skill_daily_stats d
  ON d.stat_date = r.stat_date
 AND d.skill_name = r.skill_name
 AND d.machine_id = r.machine_id
WHERE r.run_count <> d.run_count
   OR r.total_tokens <> d.total_tokens;
```

## Rollback

1. Plugin rollback: remove `Stop` hook (back to phase 1-only).
2. Collector rollback: revert phase-aware merge logic.
3. Monitor 24–48h using skeleton backlog + data quality queries.
