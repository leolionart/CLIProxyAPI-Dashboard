# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLIProxy Dashboard is a real-time monitoring system that tracks API usage from CLIProxy (an AI API proxy). It consists of two main services:

- **Collector** (Python): Polls the CLIProxy Management API every 5 minutes, processes usage data, calculates costs, manages rate limits, and stores everything in Supabase
- **Frontend** (React): Visualizes usage analytics with charts, cost breakdowns, and rate limit tracking

**Data Flow:**
```
CLIProxy API → Collector (Python/Flask) → Supabase (PostgreSQL) → React Dashboard
```

## Common Commands

### Development

**Frontend:**
```bash
cd frontend
npm install
npm run dev          # Start dev server on localhost:5173
npm run build        # Build for production
npm run preview      # Preview production build
```

**Collector (local testing):**
```bash
cd collector
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
python main.py       # Requires .env file with valid credentials
```

### Docker Operations

**Build and start:**
```bash
docker compose build
docker compose up -d
```

**View logs:**
```bash
docker compose logs -f                    # All services
docker compose logs -f collector          # Collector only
docker compose logs -f frontend           # Frontend only
```

**Check health:**
```bash
docker compose ps
docker ps --filter "name=collector" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**Restart services:**
```bash
docker compose restart collector
docker compose restart frontend
```

**Rebuild after code changes:**
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

**Access dashboard:**
```
http://localhost:8417
```

## Architecture

### Database Schema (Supabase/PostgreSQL)

**Core Tables:**
- `usage_snapshots`: Raw snapshots collected every 5 minutes with total requests, success/failure counts, tokens
- `model_usage`: Per-model breakdown of each snapshot (linked via snapshot_id FK), includes token counts and estimated cost
- `daily_stats`: Daily aggregated statistics (upserted daily), used for efficient date range queries
- `model_pricing`: Pricing configuration (USD per 1M tokens), supports pattern matching for model names

**Key Relationships:**
- `model_usage.snapshot_id` → `usage_snapshots.id` (CASCADE DELETE)

### Collector Architecture (collector/main.py)

**Core Components:**
1. **Flask API Server** (port 5001):
   - Health check endpoint: `/api/collector/health`
   - Manual trigger endpoint: `/api/collector/trigger`
   - Runs on Waitress WSGI server for production stability

2. **Background Scheduler** (APScheduler):
   - Polls CLIProxy API every `COLLECTOR_INTERVAL_SECONDS` (default: 300s)
   - Calculates usage deltas by comparing current vs previous snapshots
   - Stores snapshots, model usage, and updates daily_stats

**Critical Implementation Details:**
- **Delta Calculation**: The collector stores cumulative snapshots from CLIProxy but calculates **daily deltas** by subtracting previous day's final snapshot from current snapshot. This handles CLIProxy restarts gracefully.
- **Timezone Handling**: Uses `TIMEZONE_OFFSET_HOURS` environment variable (default: 7 for UTC+7). All date boundaries are calculated in local time then converted to UTC for database storage.
- **Restart Detection**: When CLIProxy restarts, usage counters reset to 0. The collector detects this (new value < old value) and treats the new snapshot as the delta instead of calculating (new - old).

### Frontend Architecture (frontend/src/)

**Main Components:**
- `App.jsx`: Main application shell, handles date range selection and data fetching from Supabase
- `Dashboard.jsx`: Main dashboard component with all visualization cards
- `Icons.jsx`: Reusable SVG icon components

**State Management:**
- Uses React hooks (useState, useEffect, useCallback)
- No external state library - all state is local
- Real-time updates via Supabase subscriptions could be added but currently uses manual refresh

**Date Range Logic** (App.jsx):
- Supports: Today, Yesterday, 7 Days, 30 Days, This Year
- **Today/Yesterday**: Queries `daily_stats` for exact date match, shows **delta** for that day
- **Multi-day ranges**: Aggregates across multiple `daily_stats` rows, shows **total**
- Converts local midnight to UTC for timestamp queries to match collector's storage format

**Key Libraries:**
- Recharts for all visualizations (line charts, bar charts, pie charts)
- @supabase/supabase-js for database queries
- React 18 with Vite for fast development

## Environment Configuration

All services use environment variables from `.env` (see `.env.example`):

**Required:**
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SECRET_KEY`: Service role key (collector only, for write access)
- `SUPABASE_PUBLISHABLE_KEY`: Anon public key (frontend only, for read access)
- `CLIPROXY_URL`: CLIProxy Management API URL (use `host.docker.internal:PORT` from Docker)
- `CLIPROXY_MANAGEMENT_KEY`: Secret key for CLIProxy Management API

**Optional:**
- `COLLECTOR_INTERVAL_SECONDS`: Polling interval (default: 300)
- `TIMEZONE_OFFSET_HOURS`: Timezone offset from UTC (default: 7)

**Frontend Build-time Variables:**
- Vite injects `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time via docker-compose.yml args
- The collector URL is intentionally empty in production (frontend queries Supabase directly, not the collector)

## Docker Configuration

**Services:**
- `collector`: Python Flask app on internal port 5001 (not exposed externally)
- `frontend`: Nginx serving static React build on port 8417

**Important Details:**
- Both services use `host.docker.internal:host-gateway` to access CLIProxy running on host machine
- Health check on collector verifies Flask server is responding before frontend starts
- Logging configured with 10MB max size, 3 file rotation
- Network: `cliproxy-network` bridge network for inter-service communication

## Cost Calculation

Cost estimation uses pattern matching against `model_pricing` table:
- Model name from usage data is matched against `model_pattern` (supports wildcards)
- Cost = (input_tokens / 1M) × input_price + (output_tokens / 1M) × output_price
- Default pricing defined in `MODEL_PRICING_DEFAULTS` in collector/main.py (automatically inserted on first run)

**To Update Pricing:**
1. Edit pricing values in Supabase `model_pricing` table directly, or
2. Update `MODEL_PRICING_DEFAULTS` in collector/main.py and restart collector

## Troubleshooting Notes

**Collector Can't Connect to CLIProxy:**
- Verify CLIProxy has `remote-management.allow-remote: true` in config
- Check `CLIPROXY_MANAGEMENT_KEY` matches CLIProxy's `secret`
- Ensure CLIProxy is accessible from Docker network (use `host.docker.internal`)

**Dashboard Shows No Data:**
- Wait 5 minutes for first collection cycle
- Check collector logs: `docker compose logs -f collector`
- Verify Supabase tables were created (see README.md SQL schema)
- Check browser console for Supabase connection errors

**Date Range Showing Wrong Data:**
- Verify `TIMEZONE_OFFSET_HOURS` matches your actual timezone
- Check that `daily_stats` table has entries for the date range
- Today/Yesterday use daily deltas; longer ranges show cumulative totals

