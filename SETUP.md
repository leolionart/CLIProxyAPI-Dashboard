# 🚀 CLIProxy Dashboard - Setup Guide

**Complete guide for setting up CLIProxy Dashboard from scratch**

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Supabase Setup](#1-supabase-setup)
3. [CLIProxy Configuration](#2-cliproxy-configuration)
4. [Dashboard Installation](#3-dashboard-installation)
5. [Deployment](#4-deployment)
6. [Verification](#5-verification)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- ✅ **Docker** & **Docker Compose** installed ([Get Docker](https://docs.docker.com/get-docker/))
- ✅ **Supabase account** (free tier works - [Sign up](https://supabase.com))
- ✅ **CLIProxy** running with Management API enabled
- ✅ Basic knowledge of terminal/command line

**Estimated setup time:** 15-20 minutes

---

## 1. Supabase Setup

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Fill in project details:
   - **Name**: `cliproxy-dashboard` (or any name you prefer)
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Choose closest to your location
4. Click **"Create new project"** and wait ~2 minutes

### 1.2 Create Database Schema

1. In Supabase dashboard, click **"SQL Editor"** (left sidebar)
2. Click **"New Query"**
3. Copy the entire SQL schema from `supabase-schema.sql` in this repository
4. Paste it into the SQL editor
5. Click **"Run"** (or press `Ctrl+Enter`)
6. ✅ You should see "Success. No rows returned"

**What this creates:**
- `usage_snapshots` - Raw data collected every 5 minutes
- `model_usage` - Per-model usage breakdown
- `daily_stats` - Aggregated daily statistics
- `model_pricing` - Cost calculation configuration
- `rate_limit_configs` - Rate limit configurations
- `rate_limit_status` - Current rate limit tracking

### 1.3 Get API Keys

1. Go to **Settings** → **API** (left sidebar, bottom)
2. Copy the following values (you'll need them in step 3):

| Key | Location | Description |
|-----|----------|-------------|
| **Project URL** | Top of page | `https://xxxxx.supabase.co` |
| **anon public** | "Project API keys" section | Public key for frontend |
| **service_role** | "Project API keys" section | Secret key for collector (click 👁️ to reveal) |

⚠️ **Important:** Keep `service_role` key private! Never commit it to Git.

---

## 2. CLIProxy Configuration

Your CLIProxy must have the Management API enabled to allow the dashboard to collect usage data.

### 2.1 Edit CLIProxy Config

Open your CLIProxy configuration file and add/verify:

```yaml
remote-management:
  allow-remote: true
  secret: "your-secure-secret-key-here"  # Choose a strong secret!
```

### 2.2 Restart CLIProxy

```bash
# Restart CLIProxy to apply changes
# (Command depends on how you're running CLIProxy)
```

### 2.3 Verify Management API

Test that the Management API is accessible:

```bash
# Replace with your actual URL and secret
curl -H "Authorization: Bearer your-secret-key-here" \
  http://localhost:8317/v0/management/usage
```

✅ You should see JSON response with usage data.

---

## 3. Dashboard Installation

### 3.1 Clone Repository

```bash
git clone https://github.com/yourusername/cliproxy-dashboard.git
cd cliproxy-dashboard
```

### 3.2 Create Environment File

```bash
cp .env.example .env
```

### 3.3 Configure Environment Variables

Open `.env` in your text editor and fill in the values:

```env
# ============================================
# Supabase Configuration (from Step 1.3)
# ============================================
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SECRET_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ============================================
# CLIProxy Connection (from Step 2.1)
# ============================================
CLIPROXY_URL=http://host.docker.internal:8317
CLIPROXY_MANAGEMENT_KEY=your-secure-secret-key-here

# ============================================
# Optional Settings
# ============================================
COLLECTOR_INTERVAL_SECONDS=300  # Poll every 5 minutes (default)
TIMEZONE_OFFSET_HOURS=7         # Your timezone offset from UTC
```

**Important Notes:**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (from step 1.3) |
| `SUPABASE_PUBLISHABLE_KEY` | The "anon public" key from Supabase |
| `SUPABASE_SECRET_KEY` | The "service_role" key from Supabase |
| `CLIPROXY_URL` | Use `host.docker.internal:PORT` if CLIProxy runs on same machine |
| `CLIPROXY_MANAGEMENT_KEY` | Must match the `secret` in CLIProxy config |
| `TIMEZONE_OFFSET_HOURS` | Your timezone offset (e.g., 7 for Vietnam/Bangkok, 0 for UTC) |

---

## 4. Deployment

### 4.1 Build & Start Services

```bash
# Build Docker images
docker compose build

# Start services in background
docker compose up -d
```

**What this does:**
- Builds the collector (Python) service
- Builds the frontend (React) service
- Starts both services in detached mode

### 4.2 Check Service Status

```bash
# View running containers
docker compose ps

# Expected output:
# NAME                   STATUS       PORTS
# cliproxy-collector     Up (healthy)
# cliproxy-dashboard     Up           0.0.0.0:8417->80/tcp
```

### 4.3 View Logs (Optional)

```bash
# View all logs
docker compose logs -f

# View collector logs only
docker compose logs -f collector

# View frontend logs only
docker compose logs -f frontend
```

---

## 5. Verification

### 5.1 Access Dashboard

Open your browser to: **http://localhost:8417**

You should see the dashboard interface with date range tabs at the top.

### 5.2 Wait for First Data Collection

⏱️ **Important:** The collector runs every 5 minutes by default.

- First data will appear within 5 minutes
- If you don't see data immediately, this is normal!

### 5.3 Check Collector Health

```bash
# Test collector health endpoint
curl http://localhost:5001/api/collector/health

# Expected response:
# {"status": "ok"}
```

### 5.4 Manual Trigger (Optional)

To collect data immediately without waiting:

```bash
curl -X POST http://localhost:5001/api/collector/trigger
```

---

## Troubleshooting

### ❌ Collector can't connect to CLIProxy

**Symptoms:** Collector logs show connection errors

**Solutions:**
```bash
# 1. Check CLIProxy is running
curl http://localhost:8317/v0/management/usage

# 2. Verify CLIProxy has remote-management enabled
# Check your CLIProxy config file

# 3. Verify CLIPROXY_MANAGEMENT_KEY matches
# Compare .env with CLIProxy config

# 4. On Linux, ensure host.docker.internal works
# Add to docker-compose.yml if missing:
# extra_hosts:
#   - "host.docker.internal:host-gateway"
```

### ❌ Dashboard shows no data

**Symptoms:** Dashboard loads but all cards show 0 or "No data"

**Solutions:**
```bash
# 1. Wait 5 minutes for first collection
# Be patient!

# 2. Check collector logs
docker compose logs collector

# 3. Verify Supabase tables exist
# Go to Supabase → Table Editor
# Should see: usage_snapshots, model_usage, daily_stats, etc.

# 4. Check browser console (F12)
# Look for Supabase connection errors
```

### ❌ Frontend build errors

**Symptoms:** Docker build fails for frontend service

**Solutions:**
```bash
# 1. Ensure .env file exists with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
cat .env

# 2. Rebuild with no cache
docker compose build --no-cache frontend

# 3. Check .env.example has all required variables
diff .env .env.example
```

### ❌ Permission errors on Linux

**Symptoms:** Docker containers fail to start with permission errors

**Solutions:**
```bash
# Add your user to docker group
sudo usermod -aG docker $USER

# Logout and login again, then:
docker compose up -d
```

### ❌ Port 8417 already in use

**Symptoms:** Error binding to port 8417

**Solutions:**
```bash
# Option 1: Stop service using port 8417
sudo lsof -i :8417
# Kill the process using that port

# Option 2: Change port in docker-compose.yml
# Edit: "8417:80" to "8418:80" (or any free port)
```

---

## 🔄 Updating the Dashboard

When new updates are available:

```bash
# Pull latest changes
git pull

# Rebuild and restart services
docker compose down
docker compose build
docker compose up -d
```

---

## 🛠 Development Mode

### Frontend Development (Hot Reload)

For rapid UI development:

```bash
cd frontend
npm install
npm run dev
```

Access at: `http://localhost:5173` (auto-reloads on code changes)

### Collector Development

For testing collector locally:

```bash
cd collector
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

---

## 📊 Default Configuration

### Model Pricing (USD per 1M tokens)

The collector includes default pricing for popular models:

| Model | Input | Output |
|-------|--------|--------|
| GPT-4o | $2.50 | $10.00 |
| GPT-4o-mini | $0.15 | $0.60 |
| Claude 3.5 Sonnet | $3.00 | $15.00 |
| Claude 4 Sonnet | $3.00 | $15.00 |
| Gemini 2.5 Flash | $0.15 | $0.60 |
| Gemini 2.5 Pro | $1.25 | $10.00 |

To update pricing:
1. Go to Supabase → Table Editor → `model_pricing`
2. Edit the pricing values directly

---

## 🔐 Security Best Practices

✅ **DO:**
- Keep `.env` file private (never commit to Git)
- Use strong secrets for `CLIPROXY_MANAGEMENT_KEY`
- Regularly update dependencies
- Enable Supabase Row Level Security (RLS) policies

❌ **DON'T:**
- Share your `service_role` key publicly
- Use default/weak management keys
- Expose collector port 5001 publicly
- Commit `.env` file to version control

---

## 📞 Getting Help

- **Issues:** [GitHub Issues](https://github.com/yourusername/cliproxy-dashboard/issues)
- **Documentation:** See `README.md` and `CLAUDE.md`
- **CLIProxy:** Check [CLIProxy documentation](https://cliproxy.dev)

---

## ✅ Setup Checklist

- [ ] Supabase project created
- [ ] Database schema executed
- [ ] API keys copied
- [ ] CLIProxy remote-management enabled
- [ ] Repository cloned
- [ ] `.env` file configured
- [ ] Docker services built and started
- [ ] Dashboard accessible at localhost:8417
- [ ] First data collection verified

**Setup complete! 🎉**
