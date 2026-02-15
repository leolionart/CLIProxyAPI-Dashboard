# OAuth Credentials Tracking Migration Guide

## Overview

This migration adds OAuth credentials tracking to CLIProxyDash, allowing you to monitor your Antigravity (Claude), Codex (ChatGPT), and Gemini CLI credentials including subscription status, plan tiers, and account information.

## Features Added

- **OAuth Credential Monitoring**: Track all OAuth credentials synced from CLIProxy
- **Plan Information**: See subscription tier (Free/Plus/Pro) for Codex/OpenAI accounts
- **Subscription Status**: Monitor subscription expiration dates
- **Per-Credential Usage**: (Future feature) Track usage breakdown per credential
- **Auto-Sync**: Credentials automatically sync every 15 minutes from CLIProxy Management API

## Migration Steps

### 1. Run Database Migration

Execute the SQL migration in Supabase SQL Editor:

```bash
# Navigate to migrations folder
cd migrations

# Copy migration content
cat 001_add_oauth_credentials.sql
```

Then in **Supabase Dashboard** → **SQL Editor** → **New Query**, paste and run the migration.

Or run directly from command line if you have Supabase CLI:

```bash
supabase db push migrations/001_add_oauth_credentials.sql
```

### 2. Update Environment Variables (Optional)

Add to your `.env` file:

```env
# OAuth Credentials Sync Interval (default: 900 seconds = 15 minutes)
OAUTH_SYNC_INTERVAL_SECONDS=900
```

### 3. Rebuild and Restart Services

For Docker deployment:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

For development:

```bash
# Backend
cd collector
pip install -r requirements.txt  # Installs pyjwt
python main.py

# Frontend (no changes needed, rebuild to get new component)
cd frontend
npm install
npm run build
```

### 4. Verify Migration

1. **Check Database Tables**:
   - Go to Supabase → **Table Editor**
   - Verify these tables exist:
     - `oauth_credentials`
     - `oauth_usage`
     - `oauth_daily_stats`

2. **Check Collector Logs**:
   ```bash
   docker compose logs -f collector
   ```
   Look for:
   ```
   OAuth credentials sync scheduled every 900 seconds.
   Fetching OAuth credentials from http://...
   OAuth sync completed: ...
   ```

3. **Check Dashboard**:
   - Open dashboard at http://localhost:8417
   - You should see a new "OAuth Credentials" card below Rate Limits
   - If you have credentials configured in CLIProxy, they will appear within 15 minutes

## Troubleshooting

### No Credentials Showing

**Possible causes:**
1. **No OAuth credentials in CLIProxy**: Add credentials via CLIProxy CLI (`/antigravity`, `/codex`, `/gemini-cli` commands)
2. **Sync hasn't run yet**: Wait up to 15 minutes, or manually trigger:
   ```bash
   curl -X POST http://localhost:5001/api/collector/oauth/sync
   ```
3. **Management API connection issue**: Check collector logs for errors

### Collector Error: "Failed to fetch auth files"

**Solution:**
1. Verify `CLIPROXY_MANAGEMENT_KEY` matches your CLIProxy config
2. Ensure CLIProxy Management API is accessible from collector:
   ```bash
   docker exec -it collector curl http://host.docker.internal:8317/v0/management/health
   ```

### Migration SQL Errors

**If tables already exist:**
- Migration uses `IF NOT EXISTS`, so it's safe to re-run
- If you see errors, check if tables already exist:
  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name LIKE 'oauth%';
  ```

## Rollback (If Needed)

To remove OAuth credentials tracking:

```sql
-- Drop tables (cascades to dependent data)
DROP TABLE IF EXISTS oauth_daily_stats CASCADE;
DROP TABLE IF EXISTS oauth_usage CASCADE;
DROP TABLE IF EXISTS oauth_credentials CASCADE;
```

Then rebuild without the OAuth sync code:
```bash
git checkout HEAD~1  # Or previous commit
docker compose build --no-cache
docker compose up -d
```

## New API Endpoints

### Trigger OAuth Sync

```bash
POST http://localhost:5001/api/collector/oauth/sync

# Response
{
  "message": "OAuth credentials sync triggered."
}
```

## Data Structure

### oauth_credentials Table

```sql
id                  BIGSERIAL PRIMARY KEY
provider            VARCHAR(50)           -- 'codex', 'claude', 'gemini-cli'
email               VARCHAR(255)
account_id          VARCHAR(255)          -- Codex account ID
plan_type           VARCHAR(50)           -- 'free', 'plus', 'pro', 'team'
subscription_start  TIMESTAMPTZ
subscription_end    TIMESTAMPTZ
is_active           BOOLEAN
status_label        VARCHAR(50)
label               VARCHAR(255)
source              VARCHAR(20)           -- 'file' or 'memory'
project_id          VARCHAR(255)          -- Gemini CLI GCP Project ID
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
last_refresh        TIMESTAMPTZ           -- Last token refresh
last_synced         TIMESTAMPTZ           -- Last sync from Management API
```

## Future Enhancements

Planned features for next releases:

1. **Per-Credential Usage Tracking**: Link usage snapshots to specific credentials
2. **Credential Usage Charts**: Visualize usage breakdown per OAuth account
3. **Subscription Alerts**: Notifications when subscriptions are expiring
4. **Credential Health Monitoring**: Track token refresh errors and credential validity

## Support

If you encounter issues:

1. Check collector logs: `docker compose logs -f collector`
2. Check frontend console: Browser DevTools → Console
3. Verify Supabase tables exist and have proper RLS policies
4. Ensure CLIProxy Management API is accessible

## Changelog

**Version 1.1.0** (2026-01-19)
- ✨ Added OAuth credentials tracking
- ✨ JWT token parsing for plan information
- ✨ Auto-sync from CLIProxy Management API
- ✨ OAuth Credentials Card in dashboard
- 📊 Database schema for oauth_credentials, oauth_usage, oauth_daily_stats
- 🔧 New environment variable: `OAUTH_SYNC_INTERVAL_SECONDS`
