
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from supabase import Client

logger = logging.getLogger(__name__)

# Configurable timezone via environment variable (default: UTC+7 for Vietnam)
TIMEZONE_OFFSET_HOURS = int(os.environ.get('TIMEZONE_OFFSET_HOURS', '7'))
APP_TIMEZONE = timezone(timedelta(hours=TIMEZONE_OFFSET_HOURS))

class RateLimiter:
    """
    Handles the calculation and synchronization of rate limits based on usage data.
    """
    def __init__(self, supabase_client: Client):
        self.supabase = supabase_client

    def sync_limits(self):
        """
        Main function to sync all rate limit configurations.
        It fetches configurations, processes each one, and updates their status.
        """
        try:
            logger.info("Starting rate limit synchronization process...")
            configs = self._fetch_configs()
            if not configs:
                logger.info("No rate limit configurations found. Sync process finished.")
                return

            for config in configs:
                try:
                    self._process_config(config)
                except Exception:
                    config_id = config.get('id', 'N/A')
                    model_pattern = config.get('model_pattern', 'N/A')
                    logger.error(f"Failed to process config ID {config_id} for pattern '{model_pattern}'.", exc_info=True)

            logger.info("Rate limit synchronization process completed successfully.")
        except Exception:
            logger.error("A critical error occurred during the rate limit sync process.", exc_info=True)

    def _fetch_configs(self) -> List[Dict[str, Any]]:
        """Fetches all active rate limit configurations from the database."""
        try:
            response = self.supabase.table('rate_limit_configs').select('*').execute()
            return response.data or []
        except Exception as e:
            logger.error(f"Failed to fetch rate limit configurations: {e}")
            return []

    def _process_config(self, config: Dict[str, Any]):
        """
        Processes a single rate limit configuration to calculate and update its status.
        """
        model_pattern = config.get('model_pattern')
        config_id = config.get('id')
        logger.info(f"--- Processing config for: '{model_pattern}' (ID: {config_id}) ---")

        window_minutes = config.get('window_minutes')
        reset_strategy = config.get('reset_strategy')
        token_limit = config.get('token_limit')
        request_limit = config.get('request_limit')

        if not all([config_id, model_pattern, window_minutes, reset_strategy]):
            logger.warning(f"Skipping incomplete config ID {config_id}. Missing required fields.")
            return

        now = datetime.now(APP_TIMEZONE)

        # Determine the time window for usage calculation
        calculated_window_start = now
        if reset_strategy == 'daily':
            calculated_window_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            next_reset = calculated_window_start + timedelta(days=1)
        elif reset_strategy == 'weekly':
            # Calendar week: Reset on Monday 00:00
            start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
            days_since_monday = start_of_today.weekday() # Monday is 0
            calculated_window_start = start_of_today - timedelta(days=days_since_monday)
            next_reset = calculated_window_start + timedelta(weeks=1)
        elif reset_strategy == 'rolling':
            calculated_window_start = now - timedelta(minutes=window_minutes)
            next_reset = now + timedelta(minutes=1)
        else:
            logger.warning(f"Unsupported reset strategy '{reset_strategy}' for config ID {config_id}.")
            return

        # Adjust window_start if a manual reset has occurred
        window_start = calculated_window_start
        reset_anchor_str = config.get('reset_anchor_timestamp')
        if reset_anchor_str:
            try:
                # remove Z if present for compatibility (though fromisoformat handles +00:00)
                reset_anchor_dt = datetime.fromisoformat(reset_anchor_str.replace('Z', '+00:00'))
                
                # IMPORTANT: If the manual reset anchor is NEWER than the calculated natural start, use it.
                # Example: Weekly resets Monday. User resets Wednesday.
                # Window start becomes Wednesday. Next Monday, calculated start (new Monday) > anchor (prev Wednesday), so it reverts to natural.
                if reset_anchor_dt > calculated_window_start:
                    logger.info(f"Manual reset anchor ({reset_anchor_dt}) is active (newer than natural start {calculated_window_start}).")
                    window_start = reset_anchor_dt
                else:
                    logger.info(f"Manual reset anchor ({reset_anchor_dt}) is expired (older than natural start {calculated_window_start}).")
            except ValueError:
                logger.error(f"Could not parse reset_anchor_timestamp: '{reset_anchor_str}'")

        # Calculate usage within the determined window
        usage = self._calculate_usage(model_pattern, window_start)
        used_tokens = usage['total_tokens']
        used_requests = usage['request_count']

        # Update the status in the database
        self._update_status(
            config_id=config_id,
            used_tokens=used_tokens,
            used_requests=used_requests,
            window_start=window_start,
            next_reset=next_reset,
            token_limit=token_limit,
            request_limit=request_limit
        )
        logger.info(f"--- Finished processing for: '{model_pattern}' ---")

    def _calculate_usage(self, model_pattern: str, since: datetime) -> Dict[str, int]:
        """
        [FINAL VERSION] Calculates usage for a model pattern within a given time window.
        This version correctly handles data gaps by finding the true baseline.
        """
        logger.info(f"Calculating usage for '{model_pattern}' in window since {since.isoformat()}")

        # 1. Get the most recent snapshot for the pattern to establish the "current" total.
        latest_snapshot_resp = self.supabase.table('model_usage') \
            .select('created_at, model_name, total_tokens, request_count') \
            .ilike('model_name', f'%{model_pattern}%') \
            .order('created_at', desc=True) \
            .limit(1) \
            .execute()

        if not latest_snapshot_resp.data:
            logger.info("No usage data found for this pattern at all. Usage is 0.")
            return {'total_tokens': 0, 'request_count': 0}

        latest_time = latest_snapshot_resp.data[0]['created_at']
        
        # Parse latest_time to datetime for comparison
        # Supabase returns ISO strings. We assume UTC or offset-aware.
        latest_dt = datetime.fromisoformat(latest_time.replace('Z', '+00:00'))

        # If the latest snapshot is OLDER than the window start (e.g. no activity in days), usage is 0.
        if latest_dt < since:
             logger.info(f"Latest snapshot ({latest_dt}) is older than window start ({since}). Usage is 0.")
             return {'total_tokens': 0, 'request_count': 0}

        # 2. Find the earliest snapshot *inside* the window (>= since).
        first_inner_resp = self.supabase.table('model_usage') \
            .select('created_at') \
            .ilike('model_name', f'%{model_pattern}%') \
            .gte('created_at', since.isoformat()) \
            .order('created_at', desc=False) \
            .limit(1) \
            .execute()
            
        first_inner_snapshot_time = None
        if first_inner_resp.data:
            first_inner_snapshot_time = first_inner_resp.data[0]['created_at']

        # 3. Find the baseline snapshot: the latest one taken *before* the window started (~ since).
        baseline_snapshot_resp = self.supabase.table('model_usage') \
            .select('created_at') \
            .ilike('model_name', f'%{model_pattern}%') \
            .lt('created_at', since.isoformat()) \
            .order('created_at', desc=True) \
            .limit(1) \
            .execute()

        baseline_time = None
        if baseline_snapshot_resp.data:
            baseline_time = baseline_snapshot_resp.data[0]['created_at']

        # 4. DECISION LOGIC: Which baseline to use?

        # Scenario A: No baseline before window. Must use first inner snapshot.
        if not baseline_time:
            if not first_inner_snapshot_time:
                # No data before, no data inside (though we checked latest_dt >= since, checking again implies safety)
                return {'total_tokens': 0, 'request_count': 0}

            logger.warning("No snapshot found before window. Using first inner snapshot as baseline (Optimistic).")
            # Usage = Current - First_Inner. (Ignores usage from start_of_time to First_Inner)
            return self._calculate_delta_from_snapshots(latest_time, first_inner_snapshot_time, model_pattern)

        # Scenario B: Baseline exists. Check for "Data Gap".
        if first_inner_snapshot_time:
            baseline_dt = datetime.fromisoformat(baseline_time.replace('Z', '+00:00'))
            first_inner_dt = datetime.fromisoformat(first_inner_snapshot_time.replace('Z', '+00:00'))

            # Gap duration
            gap_seconds = (first_inner_dt - baseline_dt).total_seconds()

            # Threshold: 30 minutes (1800 seconds). Configurable?
            GAP_THRESHOLD = 1800

            if gap_seconds > GAP_THRESHOLD:
                # GAP DETECTED: The baseline is too old relative to the first activity in the window.
                # Instead of importing the entire gap usage, we interpolate the baseline value at the window start.
                logger.info(
                    "Large Data Gap detected (%ss > %ss) crossing window boundary.",
                    gap_seconds,
                    GAP_THRESHOLD
                )
                logger.info("Baseline snapshot: %s | First inner snapshot: %s", baseline_time, first_inner_snapshot_time)
                ratio_seconds = (since - baseline_dt).total_seconds()
                window_span = gap_seconds if gap_seconds > 0 else 1
                ratio = max(0.0, min(1.0, ratio_seconds / window_span))
                logger.info("Interpolating baseline %.2f%% between baseline and first_inner", ratio * 100)
                baseline_map = self._build_snapshot_map(model_pattern, baseline_time)
                first_inner_map = self._build_snapshot_map(model_pattern, first_inner_snapshot_time)
                interpolated_map = self._interpolate_snapshot_map(baseline_map, first_inner_map, ratio)
                logger.info("Using interpolated baseline to avoid false usage spike caused by idle gap.")
                return self._calculate_delta_from_snapshots(
                    latest_time,
                    baseline_time,
                    model_pattern,
                    baseline_override=interpolated_map
                )
            else:
                # No significant gap, or gap is small (just normal interval). Use standard baseline.
                return self._calculate_delta_from_snapshots(latest_time, baseline_time, model_pattern)
        else:
            # Baseline exists, but no inner snapshot?
            # This means latest_dt must be older than since? But we checked "latest_dt < since" above.
            # So latest_dt >= since. Thus latest_snapshot IS an inner snapshot.
            # So first_inner_snapshot_time CANNOT be None here theoretically.
            # But just in case:
            return self._calculate_delta_from_snapshots(latest_time, baseline_time, model_pattern)

    def _build_snapshot_map(self, model_pattern: str, snapshot_time: str) -> Dict[str, Dict[str, int]]:
        """Fetches and aggregates model usage for a specific snapshot time."""
        resp = self.supabase.table('model_usage') \
            .select('model_name, total_tokens, request_count') \
            .ilike('model_name', f'%{model_pattern}%') \
            .eq('created_at', snapshot_time) \
            .execute()
        snapshot_map: Dict[str, Dict[str, int]] = {}
        for rec in (resp.data or []):
            m_name = rec['model_name']
            if m_name not in snapshot_map:
                snapshot_map[m_name] = {'total_tokens': 0, 'request_count': 0}
            snapshot_map[m_name]['total_tokens'] += (rec.get('total_tokens', 0) or 0)
            snapshot_map[m_name]['request_count'] += (rec.get('request_count', 0) or 0)
        return snapshot_map

    def _interpolate_snapshot_map(
        self,
        baseline_map: Dict[str, Dict[str, int]],
        first_inner_map: Dict[str, Dict[str, int]],
        ratio: float
    ) -> Dict[str, Dict[str, int]]:
        """Interpolates usage counters between two snapshot maps based on ratio [0,1]."""
        interpolated: Dict[str, Dict[str, int]] = {}
        for model_name in set(baseline_map.keys()) | set(first_inner_map.keys()):
            baseline_rec = baseline_map.get(model_name, {'total_tokens': 0, 'request_count': 0})
            inner_rec = first_inner_map.get(model_name, baseline_rec)
            start_tokens = baseline_rec.get('total_tokens', 0) or 0
            end_tokens = inner_rec.get('total_tokens', 0) or 0
            start_requests = baseline_rec.get('request_count', 0) or 0
            end_requests = inner_rec.get('request_count', 0) or 0
            interp_tokens = start_tokens + ratio * (end_tokens - start_tokens)
            interp_requests = start_requests + ratio * (end_requests - start_requests)
            interpolated[model_name] = {
                'total_tokens': int(round(interp_tokens)),
                'request_count': int(round(interp_requests))
            }
        return interpolated

    def _calculate_delta_from_snapshots(
        self,
        latest_time: str,
        baseline_time: str,
        model_pattern: str,
        baseline_override: Optional[Dict[str, Dict[str, int]]] = None
    ) -> Dict[str, int]:
        """Helper function to calculate the usage delta between two snapshot times."""
        logger.info(f"Calculating delta between latest ({latest_time}) and baseline ({baseline_time})")

        # Get data from the latest snapshot
        current_map = self._build_snapshot_map(model_pattern, latest_time)

        # Get data from the baseline snapshot or use override
        if baseline_override is not None:
            baseline_map = baseline_override
        else:
            baseline_map = self._build_snapshot_map(model_pattern, baseline_time)

        # Sum the deltas for all relevant models
        total_used_tokens = 0
        total_used_requests = 0
        for model_name, current_rec in current_map.items():
            current_tokens = current_rec.get('total_tokens', 0)
            current_reqs = current_rec.get('request_count', 0)

            baseline_rec = baseline_map.get(model_name, {}) # Default to empty dict if model didn't exist at baseline
            baseline_tokens = baseline_rec.get('total_tokens', 0) or 0
            baseline_reqs = baseline_rec.get('request_count', 0) or 0

            # Delta calculation
            total_used_tokens += max(0, current_tokens - baseline_tokens)
            total_used_requests += max(0, current_reqs - baseline_reqs)

        logger.info(f"Delta calculated: {total_used_tokens} tokens, {total_used_requests} requests.")
        return {'total_tokens': total_used_tokens, 'request_count': total_used_requests}

    def _update_status(self, config_id: int, used_tokens: int, used_requests: int,
                       window_start: datetime, next_reset: Optional[datetime],
                       token_limit: Optional[int], request_limit: Optional[int]):
        """
        Updates the rate_limit_status table with the newly calculated usage.
        """
        label = "N/A"
        percentage = 100
        rem_tokens = 0
        rem_requests = 0

        # Prioritize token limit for status display
        if token_limit is not None and token_limit > 0:
            rem_tokens = max(0, token_limit - used_tokens)
            percentage = int((rem_tokens / token_limit) * 100)
            label = f"{used_tokens:,}/{token_limit:,} Tokens"
        # Fallback to request limit
        elif request_limit is not None and request_limit > 0:
            rem_requests = max(0, request_limit - used_requests)
            percentage = int((rem_requests / request_limit) * 100)
            label = f"{used_requests:,}/{request_limit:,} Requests"
        else:
            label = f"Used: {used_tokens:,}T / {used_requests:,}R"

        percentage = max(0, min(100, percentage))

        # This is the corrected data payload
        data = {
            'config_id': config_id,
            'last_updated': datetime.now(APP_TIMEZONE).isoformat(),
            'window_start': window_start.isoformat(),
            'used_tokens': used_tokens,
            'used_requests': used_requests,
            'status_label': label,
            'percentage': percentage, # Corrected column name
            'remaining_tokens': rem_tokens,
            'remaining_requests': rem_requests,
        }
        if next_reset:
            data['next_reset'] = next_reset.isoformat()

        logger.info(f"Updating DB for config {config_id}: Label='{label}', Percentage={percentage}%, Used_Tokens={used_tokens}")
        try:
            self.supabase.table('rate_limit_status').upsert(data, on_conflict='config_id').execute()
        except Exception as e:
            logger.error(f"DATABASE ERROR: Failed to upsert status for config_id {config_id}. Check table structure. Error: {e}")
            logger.error(f"Data payload that failed: {data}")
