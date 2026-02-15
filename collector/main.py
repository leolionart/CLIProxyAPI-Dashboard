#!/usr/bin/env python3
"""
CLIProxy Usage Collector
Polls the CLIProxy Management API and stores usage data in Supabase
"""

import os
import time
import logging
import threading
from datetime import datetime, date, timezone, timedelta
from typing import Optional, Dict, Any
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, Blueprint
from flask_cors import CORS
from supabase import create_client, Client
from credential_stats_sync import sync_credential_stats
from waitress import serve
from apscheduler.schedulers.background import BackgroundScheduler

# Configurable timezone via environment variable (default: UTC+7 for Vietnam)
TIMEZONE_OFFSET_HOURS = int(os.environ.get('TIMEZONE_OFFSET_HOURS', '7'))
APP_TIMEZONE = timezone(timedelta(hours=TIMEZONE_OFFSET_HOURS))

# Load .env from project root (parent of collector directory)
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"Loaded environment from {env_path}")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY', '')
CLIPROXY_URL = os.getenv('CLIPROXY_URL', 'http://localhost:8317')
CLIPROXY_MANAGEMENT_KEY = os.getenv('CLIPROXY_MANAGEMENT_KEY', '')
COLLECTOR_INTERVAL = int(os.getenv('COLLECTOR_INTERVAL_SECONDS', '300'))
TRIGGER_PORT = int(os.getenv('COLLECTOR_TRIGGER_PORT', '5001'))


# Default pricing (USD per 1M tokens) - Updated Dec 2024
DEFAULT_PRICING = {
    # ... (pricing data remains the same)
    'gpt-4o': {'input': 2.50, 'output': 10.00},
    'gpt-4o-mini': {'input': 0.15, 'output': 0.60},
    'gpt-4-turbo': {'input': 10.00, 'output': 30.00},
    'gpt-4': {'input': 30.00, 'output': 60.00},
    'gpt-3.5-turbo': {'input': 0.50, 'output': 1.50},
    'o1': {'input': 15.00, 'output': 60.00},
    'o1-mini': {'input': 3.00, 'output': 12.00},
    'o1-preview': {'input': 15.00, 'output': 60.00},
    'o3': {'input': 15.00, 'output': 60.00},
    'o3-mini': {'input': 1.10, 'output': 4.40},
    'claude-sonnet-4': {'input': 3.00, 'output': 15.00},
    'claude-4-sonnet': {'input': 3.00, 'output': 15.00},
    'claude-opus-4': {'input': 15.00, 'output': 75.00},
    'claude-4-opus': {'input': 15.00, 'output': 75.00},
    'claude-3-5-sonnet': {'input': 3.00, 'output': 15.00},
    'claude-3.5-sonnet': {'input': 3.00, 'output': 15.00},
    'claude-3-5-haiku': {'input': 0.80, 'output': 4.00},
    'claude-3.5-haiku': {'input': 0.80, 'output': 4.00},
    'claude-3-sonnet': {'input': 3.00, 'output': 15.00},
    'claude-3-opus': {'input': 15.00, 'output': 75.00},
    'claude-3-haiku': {'input': 0.25, 'output': 1.25},
    'claude-sonnet': {'input': 3.00, 'output': 15.00},
    'claude-opus': {'input': 15.00, 'output': 75.00},
    'claude-haiku': {'input': 0.80, 'output': 4.00},
    'gemini-2.5-pro': {'input': 1.25, 'output': 10.00},
    'gemini-2.5-flash': {'input': 0.075, 'output': 0.30},
    'gemini-2.5-flash-preview': {'input': 0.075, 'output': 0.30},
    'gemini-2.0-flash': {'input': 0.10, 'output': 0.40},
    'gemini-2.0-flash-lite': {'input': 0.075, 'output': 0.30},
    'gemini-2.0-flash-exp': {'input': 0.10, 'output': 0.40},
    'gemini-1.5-pro': {'input': 1.25, 'output': 5.00},
    'gemini-1.5-flash': {'input': 0.075, 'output': 0.30},
    '_default': {'input': 0.15, 'output': 0.60},
}
LLM_PRICES_URL = "https://www.llm-prices.com/current-v1.json"

# --- Globals ---
supabase: Optional[Client] = None
remote_pricing_cache: Dict[str, Dict[str, float]] = {}
remote_pricing_last_fetch: float = 0

# --- Flask App Setup ---
flask_app = Flask(__name__)
CORS(flask_app)
api_bp = Blueprint('api', __name__, url_prefix='/api/collector')

# --- API Endpoints ---
@api_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now(APP_TIMEZONE).isoformat()})

@api_bp.route('/trigger', methods=['POST'])
def trigger_sync_endpoint():
    """Endpoint to manually trigger the full data collection and sync process."""
    logger.info("Manual trigger received for full sync.")
    sync_thread = threading.Thread(target=run_full_sync_once)
    sync_thread.start()
    return jsonify({"message": "Full data collection process triggered."}), 202

@api_bp.route('/credential-stats/sync', methods=['POST'])
def trigger_credential_stats_sync():
    """Endpoint to manually trigger credential usage stats sync."""
    logger.info("Manual trigger received for credential stats sync.")

    def credential_stats_task():
        try:
            stats = sync_credential_stats(CLIPROXY_URL, CLIPROXY_MANAGEMENT_KEY, supabase)
            logger.info(f"Credential stats sync completed: {stats}")
        except Exception as e:
            logger.error(f"Credential stats sync failed: {e}", exc_info=True)

    sync_thread = threading.Thread(target=credential_stats_task)
    sync_thread.start()
    return jsonify({"message": "Credential stats sync triggered."}), 202

# --- Sync Functions ---
def run_full_sync_once():
    """Helper function to run a single full sync process (data collection)."""
    logger.info("Fetching usage data...")
    data = fetch_usage_data()
    if data:
        store_usage_data(data)
    else:
        logger.warning("No data received from CLIProxy.")

# --- Core Logic Functions (fetch_remote_pricing, init_supabase, etc.) ---
# These functions remain largely the same as before.
def fetch_remote_pricing() -> Dict[str, Dict[str, float]]:
    # (Implementation from before)
    global remote_pricing_cache, remote_pricing_last_fetch
    if remote_pricing_cache and (time.time() - remote_pricing_last_fetch) < 3600:
        return remote_pricing_cache
    try:
        logger.info("Fetching latest pricing from llm-prices.com...")
        response = requests.get(LLM_PRICES_URL, timeout=30)
        response.raise_for_status()
        data = response.json()
        pricing = {
            item['id'].lower(): {
                'input': float(item['input']),
                'output': float(item['output']),
                'vendor': item.get('vendor', 'unknown')
            }
            for item in data.get('prices', [])
            if item.get('id') and item.get('input') is not None and item.get('output') is not None
        }
        if pricing:
            remote_pricing_cache = pricing
            remote_pricing_last_fetch = time.time()
            return pricing
    except Exception as e:
        logger.warning(f"Could not fetch remote pricing: {e}")
    return {}

def init_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        raise ValueError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

def fetch_usage_data() -> Optional[Dict[str, Any]]:
    # (Implementation from before)
    url = f"{CLIPROXY_URL}/v0/management/usage"
    headers = {'Authorization': f'Bearer {CLIPROXY_MANAGEMENT_KEY}'} if CLIPROXY_MANAGEMENT_KEY else {}
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to fetch usage data: {e}")
        return None

def get_model_pricing() -> Dict[str, Dict[str, float]]:
    # (Implementation from before)
    remote_pricing = fetch_remote_pricing()
    if remote_pricing:
        return {**DEFAULT_PRICING, **remote_pricing}
    return DEFAULT_PRICING

def find_pricing_for_model(model_name: str, pricing: Dict) -> tuple[Dict[str, float], bool]:
    # (Implementation from before)
    model_lower = model_name.lower()
    if model_lower in pricing:
        return pricing[model_lower], True
    for pattern, prices in pricing.items():
        if pattern != '_default' and (pattern in model_lower or model_lower in pattern):
            return prices, True
    return pricing.get('_default', {'input': 0.15, 'output': 0.60}), False

def calculate_cost(input_tokens: int, output_tokens: int, pricing: Dict[str, float]) -> float:
    # (Implementation from before)
    return ((input_tokens / 1_000_000) * pricing['input']) + ((output_tokens / 1_000_000) * pricing['output'])

def store_usage_data(data: Dict[str, Any]) -> bool:
    """Store usage data in Supabase database with proper daily delta calculation."""
    if not supabase or not data or 'usage' not in data:
        return False
    usage = data['usage']
    pricing = get_model_pricing()
    
    try:
        # Current cumulative values from CLIProxy
        current_requests = usage.get('total_requests', 0)
        current_success = usage.get('success_count', 0)
        current_failure = usage.get('failure_count', 0)
        current_tokens = usage.get('total_tokens', 0)
        
        # Insert snapshot with cumulative data
        snapshot_data = {
            'raw_data': data,
            'total_requests': current_requests,
            'success_count': current_success,
            'failure_count': current_failure,
            'total_tokens': current_tokens
        }
        # Track cumulative cost (sum of costs from all snapshots so far)
        last_cost_resp = supabase.table('usage_snapshots') \
            .select('cumulative_cost_usd') \
            .order('collected_at', desc=True) \
            .limit(1) \
            .execute()
        last_cost_total = last_cost_resp.data[0].get('cumulative_cost_usd', 0) if last_cost_resp.data else 0
        snapshot_data['cumulative_cost_usd'] = last_cost_total  # placeholder, updated after cost calc

        snapshot_result = supabase.table('usage_snapshots').insert(snapshot_data).execute()
        snapshot_id = snapshot_result.data[0]['id']
        
        # Process model-level data
        model_records = []
        total_cost = 0
        for api_endpoint, api_data in usage.get('apis', {}).items():
            for model_name, model_data in api_data.get('models', {}).items():
                input_tok = sum(d.get('tokens', {}).get('input_tokens', 0) for d in model_data.get('details', []))
                output_tok = sum(d.get('tokens', {}).get('output_tokens', 0) for d in model_data.get('details', []))
                model_price, _ = find_pricing_for_model(model_name, pricing)
                cost = calculate_cost(input_tok, output_tok, model_price)
                total_cost += cost
                model_records.append({
                    'snapshot_id': snapshot_id,
                    'model_name': model_name,
                    'estimated_cost_usd': cost,
                    'request_count': model_data.get('total_requests', 0),
                    'input_tokens': input_tok,
                    'output_tokens': output_tok,
                    'total_tokens': model_data.get('total_tokens', 0),
                    'api_endpoint': api_endpoint
                })
        
        if model_records:
            supabase.table('model_usage').insert(model_records).execute()

        # Update snapshot cumulative cost
        cumulative_cost = last_cost_total + total_cost
        supabase.table('usage_snapshots').update({'cumulative_cost_usd': cumulative_cost}).eq('id', snapshot_id).execute()

        # === Calculate daily delta stats (Incremental Approach) ===
        # Robust against restarts: Calculate delta since LAST snapshot and add to daily_stats
        today = datetime.now(APP_TIMEZONE).date()
        today_iso = today.isoformat()

        # 1. Get the previous snapshot (just before the one we just inserted)
        # We inserted the new one, so we want the one with collected_at < current collected_at
        # Or simpler: get the 2nd latest snapshot (since we just inserted the latest)
        prev_snap_resp = supabase.table('usage_snapshots') \
            .select('id, total_requests, success_count, failure_count, total_tokens, cumulative_cost_usd') \
            .order('collected_at', desc=True) \
            .limit(2) \
            .execute()

        has_prev = len(prev_snap_resp.data) >= 2
        prev_snap = prev_snap_resp.data[1] if has_prev else None

        if prev_snap:
            # Calculate incremental delta
            inc_requests = current_requests - prev_snap.get('total_requests', 0)
            inc_success = current_success - prev_snap.get('success_count', 0)
            inc_failure = current_failure - prev_snap.get('failure_count', 0)
            inc_tokens = current_tokens - prev_snap.get('total_tokens', 0)
            inc_cost = cumulative_cost - (prev_snap.get('cumulative_cost_usd', 0) or 0)

            # Detect restart (negative delta) -> Treat current value as the full increment
            if inc_requests < 0 or inc_tokens < 0:
                logger.warning(f"Restart detected! Prev Req: {prev_snap.get('total_requests')}, Curr Req: {current_requests}")
                inc_requests = current_requests
                inc_success = current_success
                inc_failure = current_failure
                inc_tokens = current_tokens
                # For cost, we need to be careful. cumulative_cost is our own calculation, so it should be monotonic
                # UNLESS last_cost_total was 0 because of a fresh DB.
                # But cumulative_cost is derived from adding to last_cost_total, so inc_cost should be positive.
                # However, if we just calculated total_cost for THIS snapshot, that IS the incremental cost.
                inc_cost = total_cost
        else:
            # First snapshot ever? Or first after DB wipe?
            inc_requests = 0 # Don't double count if it's the very first run, or assume 0 delta
            # Actually, if it's the first run, the "current" values are usage since CLIProxy start.
            # We should probably count them.
            inc_requests = current_requests
            inc_success = current_success
            inc_failure = current_failure
            inc_tokens = current_tokens
            inc_cost = total_cost

        # 2. Get existing daily_stats for today
        daily_stats_resp = supabase.table('daily_stats').select('*').eq('stat_date', today_iso).execute()
        existing_daily = daily_stats_resp.data[0] if daily_stats_resp.data else {
            'total_requests': 0, 'success_count': 0, 'failure_count': 0, 'total_tokens': 0, 'estimated_cost_usd': 0,
            'breakdown': {'models': {}, 'endpoints': {}}
        }

        # Initialize breakdown deltas
        breakdown_deltas = {'models': {}, 'endpoints': {}}

        if prev_snap:
            # ... (global delta calculation kept as is) ...
            # Calculate granular deltas for breakdown
            prev_usage_resp = supabase.table('model_usage').select('*').eq('snapshot_id', prev_snap['id']).execute()
            prev_usage_map = {}
            for r in prev_usage_resp.data:
                # Key must handle potential None for api_endpoint (though unlikely if schema enforces)
                ep = r.get('api_endpoint') or 'unknown'
                key = f"{r.get('model_name')}|{ep}"
                prev_usage_map[key] = r

            curr_usage_map = {}
            for r in model_records:
                ep = r.get('api_endpoint') or 'unknown'
                key = f"{r.get('model_name')}|{ep}"
                curr_usage_map[key] = r

            all_keys = set(prev_usage_map.keys()) | set(curr_usage_map.keys())

            for key in all_keys:
                prev = prev_usage_map.get(key, {})
                curr = curr_usage_map.get(key, {})

                # Get values safely
                p_req = prev.get('request_count', 0)
                p_tok = prev.get('total_tokens', 0)
                p_cost = float(prev.get('estimated_cost_usd', 0))
                p_in = prev.get('input_tokens', 0)
                p_out = prev.get('output_tokens', 0)

                c_req = curr.get('request_count', 0)
                c_tok = curr.get('total_tokens', 0)
                c_cost = float(curr.get('estimated_cost_usd', 0))
                c_in = curr.get('input_tokens', 0)
                c_out = curr.get('output_tokens', 0)

                d_req = c_req - p_req
                d_tok = c_tok - p_tok
                d_cost = c_cost - p_cost
                d_in = c_in - p_in
                d_out = c_out - p_out

                # Granular restart detection
                if d_req < 0 or d_tok < 0:
                    d_req = c_req
                    d_tok = c_tok
                    d_cost = c_cost
                    d_in = c_in
                    d_out = c_out

                # Sanity Check for False Starts (New Key with huge history)
                # This prevents massive spikes when a key with existing usage is first seen
                if d_cost > 10:
                    # If delta is roughly equal to Current (Cumulative), it's a False Start.
                    if abs(d_cost - c_cost) < 0.1:
                        logger.warning(f"Skipping False Start: ${d_cost:.2f} for key {key} (Snap {snapshot_id}). Removing from global stats.")
                        # Adjust global increments to remove this false start
                        inc_requests -= d_req
                        inc_tokens -= d_tok
                        inc_cost -= d_cost

                        # Note: We do not adjust inc_success/inc_failure because we don't know
                        # if this model's requests were successes or failures.
                        # This might lead to Success+Failure > TotalRequests for this day,
                        # but that is better than a massive cost spike.

                        # We must update prev_usage_map so next delta is correct (small)
                        # But since we are constructing breakdown_deltas locally and NOT updating a persistent state object
                        # (prev_usage_map is rebuilt from DB next time), we just need to NOT add to breakdown_deltas.
                        continue

                if d_req > 0 or d_cost > 0:
                    parts = key.split('|')
                    model_name = parts[0]
                    endpoint = parts[1]

                    # Add to Models
                    if model_name not in breakdown_deltas['models']:
                        breakdown_deltas['models'][model_name] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'input_tokens': 0, 'output_tokens': 0}
                    breakdown_deltas['models'][model_name]['requests'] += d_req
                    breakdown_deltas['models'][model_name]['tokens'] += d_tok
                    breakdown_deltas['models'][model_name]['cost'] += d_cost
                    breakdown_deltas['models'][model_name]['input_tokens'] += d_in
                    breakdown_deltas['models'][model_name]['output_tokens'] += d_out

                    # Add to Endpoints
                    if endpoint not in breakdown_deltas['endpoints']:
                        breakdown_deltas['endpoints'][endpoint] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'models': {}}
                    breakdown_deltas['endpoints'][endpoint]['requests'] += d_req
                    breakdown_deltas['endpoints'][endpoint]['tokens'] += d_tok
                    breakdown_deltas['endpoints'][endpoint]['cost'] += d_cost

                    # Add to nested models within endpoint
                    if model_name not in breakdown_deltas['endpoints'][endpoint]['models']:
                         breakdown_deltas['endpoints'][endpoint]['models'][model_name] = {'requests': 0, 'tokens': 0, 'cost': 0.0}
                    m_data = breakdown_deltas['endpoints'][endpoint]['models'][model_name]
                    m_data['requests'] += d_req
                    m_data['tokens'] += d_tok
                    m_data['cost'] += d_cost


        else:
            # First snapshot ever - treat current as delta
            for r in model_records:
                model_name = r.get('model_name')
                endpoint = r.get('api_endpoint') or 'unknown'
                req = r.get('request_count', 0)
                tok = r.get('total_tokens', 0)
                cost = float(r.get('estimated_cost_usd', 0))
                in_tok = r.get('input_tokens', 0)
                out_tok = r.get('output_tokens', 0)

                if model_name not in breakdown_deltas['models']:
                    breakdown_deltas['models'][model_name] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'input_tokens': 0, 'output_tokens': 0}
                breakdown_deltas['models'][model_name]['requests'] += req
                breakdown_deltas['models'][model_name]['tokens'] += tok
                breakdown_deltas['models'][model_name]['cost'] += cost
                breakdown_deltas['models'][model_name]['input_tokens'] += in_tok
                breakdown_deltas['models'][model_name]['output_tokens'] += out_tok

                if endpoint not in breakdown_deltas['endpoints']:
                    breakdown_deltas['endpoints'][endpoint] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'models': {}}
                breakdown_deltas['endpoints'][endpoint]['requests'] += req
                breakdown_deltas['endpoints'][endpoint]['tokens'] += tok
                breakdown_deltas['endpoints'][endpoint]['cost'] += cost

                # Add to nested models within endpoint
                if model_name not in breakdown_deltas['endpoints'][endpoint]['models']:
                        breakdown_deltas['endpoints'][endpoint]['models'][model_name] = {'requests': 0, 'tokens': 0, 'cost': 0.0}
                m_data = breakdown_deltas['endpoints'][endpoint]['models'][model_name]
                m_data['requests'] += req
                m_data['tokens'] += tok
                m_data['cost'] += cost


        # --- Consistency Check & Global Override ---
        # Calculate safe global increments from breakdown (ensures consistency)
        # This handles False Starts automatically because they are excluded from breakdown_deltas
        safe_inc_cost = sum(m['cost'] for m in breakdown_deltas['models'].values())
        safe_inc_tokens = sum(m['tokens'] for m in breakdown_deltas['models'].values())
        safe_inc_requests = sum(m['requests'] for m in breakdown_deltas['models'].values())

        if prev_snap:
            # Adjust success/failure counts if we filtered out some requests (e.g. False Starts)
            # We assume the distribution of success/failure is uniform across the dropped requests
            if inc_requests > 0:
                ratio = safe_inc_requests / inc_requests
                # Clamp ratio to [0, 1] just in case
                ratio = max(0.0, min(1.0, ratio))

                if ratio < 0.99: # Only adjust if there's a significant difference
                    logger.warning(f"Adjusting global stats due to breakdown mismatch (False Starts likely). Ratio: {ratio:.4f}")
                    inc_success = int(inc_success * ratio)
                    inc_failure = int(inc_failure * ratio)

            # Override global stats with breakdown sums
            inc_cost = safe_inc_cost
            inc_tokens = safe_inc_tokens
            inc_requests = safe_inc_requests

        # Merge breakdown deltas into existing breakdown
        existing_breakdown = existing_daily.get('breakdown') or {'models': {}, 'endpoints': {}}
        # Ensure structure
        if 'models' not in existing_breakdown: existing_breakdown['models'] = {}
        if 'endpoints' not in existing_breakdown: existing_breakdown['endpoints'] = {}

        # Merge Models
        for m, data in breakdown_deltas['models'].items():
            if m not in existing_breakdown['models']:
                existing_breakdown['models'][m] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'input_tokens': 0, 'output_tokens': 0}
            existing = existing_breakdown['models'][m]
            existing['requests'] += data['requests']
            existing['tokens'] += data['tokens']
            existing['cost'] += data['cost']
            existing['input_tokens'] = existing.get('input_tokens', 0) + data.get('input_tokens', 0)
            existing['output_tokens'] = existing.get('output_tokens', 0) + data.get('output_tokens', 0)

        # Merge Endpoints
        for e, data in breakdown_deltas['endpoints'].items():
            if e not in existing_breakdown['endpoints']:
                existing_breakdown['endpoints'][e] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'models': {}}
            existing = existing_breakdown['endpoints'][e]
            existing['requests'] += data['requests']
            existing['tokens'] += data['tokens']
            existing['cost'] += data['cost']

            # Merge nested models
            if 'models' not in existing: existing['models'] = {}
            for mName, mData in data.get('models', {}).items():
                 if mName not in existing['models']:
                      existing['models'][mName] = {'requests': 0, 'tokens': 0, 'cost': 0.0}
                 existing['models'][mName]['requests'] += mData['requests']
                 existing['models'][mName]['tokens'] += mData['tokens']
                 existing['models'][mName]['cost'] += mData['cost']


        # --- Self-Healing: Recalculate Totals from Merged Breakdown ---
        # This ensures that the global totals ALWAYS match the sum of the breakdown models.
        # It fixes inconsistencies caused by race conditions or partial updates.
        total_cost_from_breakdown = sum(m['cost'] for m in existing_breakdown['models'].values())
        total_tokens_from_breakdown = sum(m['tokens'] for m in existing_breakdown['models'].values())
        total_requests_from_breakdown = sum(m['requests'] for m in existing_breakdown['models'].values())

        # 3. Add incremental delta to existing daily stats
        # We prefer the recalculated totals from breakdown, but we fall back to incremental if breakdown is empty
        # (though breakdown shouldn't be empty if we have usage)

        final_cost = total_cost_from_breakdown if total_cost_from_breakdown > 0 else (float(existing_daily.get('estimated_cost_usd', 0)) + inc_cost)
        final_tokens = total_tokens_from_breakdown if total_tokens_from_breakdown > 0 else (existing_daily.get('total_tokens', 0) + inc_tokens)

        # For requests, we might have successful requests that aren't in model breakdown?
        # No, all requests go through models.
        final_requests = total_requests_from_breakdown if total_requests_from_breakdown > 0 else (existing_daily.get('total_requests', 0) + inc_requests)

        daily_data = {
            'stat_date': today_iso,
            'total_requests': final_requests,
            'success_count': existing_daily.get('success_count', 0) + inc_success,
            'failure_count': existing_daily.get('failure_count', 0) + inc_failure,
            'total_tokens': final_tokens,
            'estimated_cost_usd': final_cost,
            'breakdown': existing_breakdown # Save the updated breakdown
        }

        supabase.table('daily_stats').upsert(daily_data, on_conflict='stat_date').execute()

        logger.info(f"Stored snapshot {snapshot_id}. Incremental: {inc_requests} req. Daily Total: {daily_data['total_requests']}")
        return True
    except Exception as e:
        logger.error(f"Failed to store usage data: {e}")
        return False

# --- Main Application ---
def main():
    """Main collector startup."""
    global supabase
    logger.info("Starting CLIProxy Usage Collector")

    # Initialize Supabase
    try:
        supabase = init_supabase()
        logger.info("Supabase client initialized.")
    except Exception as e:
        logger.critical(f"CRITICAL: Failed to initialize Supabase: {e}", exc_info=True)
        return

    # Register the API blueprint
    flask_app.register_blueprint(api_bp)

    # Start the background scheduler
    scheduler = BackgroundScheduler(daemon=True)

    # Schedule usage data collection (every COLLECTOR_INTERVAL seconds)
    scheduler.add_job(run_full_sync_once, 'interval', seconds=COLLECTOR_INTERVAL)

    # Schedule credential usage stats sync (runs with usage collection)
    scheduler.add_job(
        lambda: sync_credential_stats(CLIPROXY_URL, CLIPROXY_MANAGEMENT_KEY, supabase),
        'interval',
        seconds=COLLECTOR_INTERVAL,
        id='credential_stats_sync',
        next_run_time=datetime.now() + timedelta(seconds=10)  # Run 10s after startup
    )

    scheduler.start()
    logger.info(f"Background sync scheduled every {COLLECTOR_INTERVAL} seconds.")
    logger.info(f"Credential stats sync scheduled every {COLLECTOR_INTERVAL} seconds.")

    # Start the Flask app using Waitress
    logger.info(f"Flask server starting on http://0.0.0.0:{TRIGGER_PORT}")
    logger.info(f"API endpoints available under /api/collector")
    serve(flask_app, host='0.0.0.0', port=TRIGGER_PORT)

if __name__ == '__main__':
    main()
