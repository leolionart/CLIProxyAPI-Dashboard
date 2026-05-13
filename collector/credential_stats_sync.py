"""
Credential Usage Stats Sync Module

Parses per-credential and per-API-key usage statistics from CLIProxy
Management API and stores aggregated results in Supabase.

Data flow:
1. Fetch /v0/management/usage from the usage source → get details[] with source, auth_index, tokens, failed
2. Fetch /v0/management/auth-files from CLIProxyAPI → map auth_index to email, provider, name, status
3. Aggregate by credential (auth_index) and by API key
4. Calculate deltas vs previous cumulative snapshot
5. Merge deltas into credential_daily_stats (per-day)
6. Upsert to credential_usage_summary table (single-row, backward compat)
"""

import logging
import requests
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timezone, timedelta, date
from collections import defaultdict
import hashlib
import json
import os
import sqlite3

logger = logging.getLogger(__name__)

# Numeric fields on credentials that support delta calculation
CRED_NUMERIC_FIELDS = [
    'total_requests', 'success_count', 'failure_count',
    'input_tokens', 'output_tokens', 'reasoning_tokens',
    'cached_tokens', 'total_tokens',
]

# Numeric fields on credential model entries
CRED_MODEL_NUMERIC_FIELDS = [
    'requests', 'success', 'failure',
    'input_tokens', 'output_tokens', 'reasoning_tokens',
    'cached_tokens', 'total_tokens',
]

# Numeric fields on API keys
AK_NUMERIC_FIELDS = [
    'total_requests', 'total_tokens',
    'success_count', 'failure_count',
    'input_tokens', 'output_tokens',
]

# Numeric fields on API key model entries
AK_MODEL_NUMERIC_FIELDS = ['requests', 'tokens', 'success', 'failure']


def _sum_model_details(model_data: Dict) -> None:
    """Populate model totals when CPA-Manager only provides request details."""
    if not isinstance(model_data, dict):
        return

    details = model_data.get('details')
    if not isinstance(details, list):
        return

    total_requests = len(details)
    failure_count = sum(1 for detail in details if isinstance(detail, dict) and detail.get('failed'))
    success_count = total_requests - failure_count

    input_tokens = 0
    output_tokens = 0
    reasoning_tokens = 0
    cached_tokens = 0
    total_tokens = 0

    for detail in details:
        if not isinstance(detail, dict):
            continue
        tokens = detail.get('tokens') or {}
        if not isinstance(tokens, dict):
            continue
        input_tokens += int(tokens.get('input_tokens') or 0)
        output_tokens += int(tokens.get('output_tokens') or 0)
        reasoning_tokens += int(tokens.get('reasoning_tokens') or 0)
        cached_tokens += int(tokens.get('cached_tokens') or tokens.get('cache_tokens') or 0)
        total_tokens += int(tokens.get('total_tokens') or 0)

    model_data.setdefault('total_requests', total_requests)
    model_data.setdefault('success_count', success_count)
    model_data.setdefault('failure_count', failure_count)
    model_data.setdefault('input_tokens', input_tokens)
    model_data.setdefault('output_tokens', output_tokens)
    model_data.setdefault('reasoning_tokens', reasoning_tokens)
    model_data.setdefault('cached_tokens', cached_tokens)
    model_data.setdefault('total_tokens', total_tokens)


def _normalize_model_totals(usage: Dict) -> Dict:
    """Ensure each endpoint/model has the totals expected by the dashboard collector."""
    if not isinstance(usage, dict):
        return usage

    for api_data in (usage.get('apis') or {}).values():
        if not isinstance(api_data, dict):
            continue
        for model_data in (api_data.get('models') or {}).values():
            _sum_model_details(model_data)

    return usage


def normalize_usage_payload(payload: Any) -> Optional[Dict]:
    """
    Normalize usage payloads from both legacy CLIProxyAPI and CPA-Manager.

    Legacy CLIProxyAPI returned {"usage": {...}}. CPA-Manager Usage Service
    exposes a compatible usage object directly at the top level.
    """
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get('usage'), dict):
        _normalize_model_totals(payload['usage'])
        return payload
    if 'apis' in payload and any(
        field in payload
        for field in ('total_requests', 'success_count', 'failure_count', 'total_tokens')
    ):
        _normalize_model_totals(payload)
        return {'usage': payload}
    return payload


def _cred_key(c: Dict) -> str:
    """Composite key for matching credentials across snapshots."""
    return f"{c.get('auth_index', '')}||{c.get('source', '')}"


def _ak_key(a: Dict) -> str:
    """Key for matching API keys across snapshots."""
    return a.get('api_key_name', '')


def _short_auth_index(auth_index: str) -> str:
    raw = str(auth_index or '').strip()
    return raw[:8] if raw else ''


def _detail_api_key_name(detail: Dict, cred_info: Dict) -> str:
    """
    Resolve the client/API-key identity for a usage detail.

    CPA-Manager stores endpoint paths under usage.apis (for example
    "POST /v1/chat/completions"), so that key is not an API key. Prefer any
    explicit API-key fields if future payloads include them; otherwise use the
    auth snapshot/credential identity that actually handled the request.
    """
    for field in (
        'api_key_name', 'api_key_label', 'api_key_id', 'api_key_hash',
        'key_name', 'consumer', 'client_id',
    ):
        value = str(detail.get(field) or '').strip()
        if value:
            return value

    auth_index = str(detail.get('auth_index') or cred_info.get('auth_index') or '').strip()
    label = str(
        detail.get('auth_label_snapshot') or
        cred_info.get('label') or
        cred_info.get('email') or
        ''
    ).strip()
    account = str(detail.get('account_snapshot') or '').strip()
    auth_file = str(
        detail.get('auth_file_snapshot') or
        cred_info.get('name') or
        detail.get('source') or
        ''
    ).strip()

    short_idx = _short_auth_index(auth_index)
    if label and short_idx:
        return f"{label} ({short_idx})"
    if account and short_idx:
        return f"{account} ({short_idx})"
    if auth_file:
        return auth_file
    if auth_index:
        return auth_index
    return 'unknown'


def _calc_delta(new_val: int, old_val: int) -> int:
    """Calculate delta with restart detection (negative = restart, use new value)."""
    delta = new_val - old_val
    return new_val if delta < 0 else delta


def _calc_model_deltas(new_models: Dict, old_models: Dict) -> Dict:
    """Calculate deltas for model-level stats within a credential or API key."""
    result = {}
    all_model_names = set(list(new_models.keys()) + list(old_models.keys()))

    for model_name in all_model_names:
        new_m = new_models.get(model_name, {})
        old_m = old_models.get(model_name, {})

        # Determine which numeric fields to use based on available keys
        # Credential models have 'requests', API key models also have 'requests'
        numeric_fields = CRED_MODEL_NUMERIC_FIELDS if 'input_tokens' in new_m or 'input_tokens' in old_m else AK_MODEL_NUMERIC_FIELDS

        delta_m = {}
        for field in numeric_fields:
            new_v = new_m.get(field, 0) or 0
            old_v = old_m.get(field, 0) or 0
            delta_m[field] = _calc_delta(new_v, old_v)

        # Only include if there's actual usage
        if any(delta_m.get(f, 0) > 0 for f in numeric_fields):
            result[model_name] = delta_m

    return result


def _calculate_credential_deltas(
    new_creds: List[Dict], prev_creds: List[Dict]
) -> List[Dict]:
    """
    Calculate deltas between new cumulative credentials and previous cumulative.
    Returns list of delta credential dicts.
    """
    prev_map = {_cred_key(c): c for c in prev_creds}
    deltas = []

    for new_c in new_creds:
        key = _cred_key(new_c)
        old_c = prev_map.get(key, {})

        delta = {
            'auth_index': new_c.get('auth_index', ''),
            'source': new_c.get('source', ''),
            'provider': new_c.get('provider', 'unknown'),
            'email': new_c.get('email', ''),
            'label': new_c.get('label', ''),
            'status': new_c.get('status', 'unknown'),
            'account_type': new_c.get('account_type', ''),
            'api_keys': new_c.get('api_keys', []),
        }

        # Calculate numeric deltas
        for field in CRED_NUMERIC_FIELDS:
            new_v = new_c.get(field, 0) or 0
            old_v = old_c.get(field, 0) or 0
            delta[field] = _calc_delta(new_v, old_v)

        # Recalculate success_rate from delta values
        if delta['total_requests'] > 0:
            delta['success_rate'] = round(
                (delta['success_count'] / delta['total_requests']) * 100, 1
            )
        else:
            delta['success_rate'] = 0

        # Calculate model deltas
        delta['models'] = _calc_model_deltas(
            new_c.get('models', {}), old_c.get('models', {})
        )

        # Only include if there's actual delta usage
        if delta['total_requests'] > 0 or delta['total_tokens'] > 0:
            deltas.append(delta)

    return deltas


def _calculate_api_key_deltas(
    new_keys: List[Dict], prev_keys: List[Dict]
) -> List[Dict]:
    """
    Calculate deltas between new cumulative API keys and previous cumulative.
    Returns list of delta API key dicts.
    """
    prev_map = {_ak_key(a): a for a in prev_keys}
    deltas = []

    for new_a in new_keys:
        key = _ak_key(new_a)
        old_a = prev_map.get(key, {})

        delta = {
            'api_key_name': new_a.get('api_key_name', ''),
            'credentials_used': new_a.get('credentials_used', []),
            'endpoints': new_a.get('endpoints', []),
        }

        for field in AK_NUMERIC_FIELDS:
            new_v = new_a.get(field, 0) or 0
            old_v = old_a.get(field, 0) or 0
            delta[field] = _calc_delta(new_v, old_v)

        if delta['total_requests'] > 0:
            delta['success_rate'] = round(
                (delta['success_count'] / delta['total_requests']) * 100, 1
            )
        else:
            delta['success_rate'] = 0

        delta['models'] = _calc_model_deltas(
            new_a.get('models', {}), old_a.get('models', {})
        )

        if delta['total_requests'] > 0 or delta['total_tokens'] > 0:
            deltas.append(delta)

    return deltas


def _merge_daily_credentials(
    existing_creds: List[Dict], delta_creds: List[Dict]
) -> List[Dict]:
    """
    Merge delta credentials into existing daily credentials.
    Matches by composite key, adds numeric fields, merges models.
    """
    existing_map = {_cred_key(c): c for c in existing_creds}

    for delta in delta_creds:
        key = _cred_key(delta)
        if key in existing_map:
            ex = existing_map[key]
            # Sum numeric fields
            for field in CRED_NUMERIC_FIELDS:
                ex[field] = (ex.get(field, 0) or 0) + (delta.get(field, 0) or 0)
            # Recalculate success_rate
            if ex['total_requests'] > 0:
                ex['success_rate'] = round(
                    (ex['success_count'] / ex['total_requests']) * 100, 1
                )
            # Merge models
            ex_models = ex.get('models', {})
            for model_name, delta_m in delta.get('models', {}).items():
                if model_name in ex_models:
                    for f in CRED_MODEL_NUMERIC_FIELDS:
                        ex_models[model_name][f] = (
                            (ex_models[model_name].get(f, 0) or 0) +
                            (delta_m.get(f, 0) or 0)
                        )
                else:
                    ex_models[model_name] = dict(delta_m)
            ex['models'] = ex_models
            # Merge api_keys (union)
            ex['api_keys'] = sorted(set(
                ex.get('api_keys', []) + delta.get('api_keys', [])
            ))
            # Update metadata fields
            for f in ['provider', 'email', 'label', 'status', 'account_type']:
                if delta.get(f):
                    ex[f] = delta[f]
        else:
            existing_map[key] = dict(delta)

    result = list(existing_map.values())
    result.sort(key=lambda x: x.get('total_requests', 0), reverse=True)
    return result


def _merge_daily_api_keys(
    existing_keys: List[Dict], delta_keys: List[Dict]
) -> List[Dict]:
    """
    Merge delta API keys into existing daily API keys.
    """
    existing_map = {_ak_key(a): a for a in existing_keys}

    for delta in delta_keys:
        key = _ak_key(delta)
        if key in existing_map:
            ex = existing_map[key]
            for field in AK_NUMERIC_FIELDS:
                ex[field] = (ex.get(field, 0) or 0) + (delta.get(field, 0) or 0)
            if ex['total_requests'] > 0:
                ex['success_rate'] = round(
                    (ex['success_count'] / ex['total_requests']) * 100, 1
                )
            ex_models = ex.get('models', {})
            for model_name, delta_m in delta.get('models', {}).items():
                if model_name in ex_models:
                    for f in AK_MODEL_NUMERIC_FIELDS:
                        ex_models[model_name][f] = (
                            (ex_models[model_name].get(f, 0) or 0) +
                            (delta_m.get(f, 0) or 0)
                        )
                else:
                    ex_models[model_name] = dict(delta_m)
            ex['models'] = ex_models
            ex['credentials_used'] = sorted(set(
                ex.get('credentials_used', []) + delta.get('credentials_used', [])
            ))
            ex['endpoints'] = sorted(set(
                ex.get('endpoints', []) + delta.get('endpoints', [])
            ))
        else:
            existing_map[key] = dict(delta)

    result = list(existing_map.values())
    result.sort(key=lambda x: x.get('total_requests', 0), reverse=True)
    return result


class CredentialStatsSync:
    """Syncs per-credential usage statistics from CLIProxy."""

    def __init__(self, cliproxy_url: str, management_key: str, supabase_client,
                 app_timezone=None, usage_url: Optional[str] = None):
        self.cliproxy_url = cliproxy_url.rstrip('/')
        self.usage_url = (usage_url or cliproxy_url).rstrip('/')
        self.management_key = management_key
        self.supabase = supabase_client
        self.app_timezone = app_timezone or timezone(timedelta(hours=7))

    def fetch_usage(self) -> Optional[Dict]:
        """Fetch usage data from CLIProxy."""
        sqlite_usage = self.fetch_usage_from_sqlite()
        if sqlite_usage:
            return sqlite_usage

        try:
            headers = {'Authorization': f'Bearer {self.management_key}'}
            resp = requests.get(
                f"{self.usage_url}/v0/management/usage",
                headers=headers, timeout=30
            )
            if resp.status_code != 200:
                logger.error(f"Usage API returned {resp.status_code}")
                return None
            return normalize_usage_payload(resp.json())
        except Exception as e:
            logger.error(f"Failed to fetch usage: {e}")
            return None

    def fetch_api_keys(self) -> List[str]:
        """Fetch configured inbound API keys so CPA api_key_hash can be labeled."""
        try:
            headers = {
                'Authorization': f'Bearer {self.management_key}',
                'X-Management-Key': self.management_key,
            }
            resp = requests.get(
                f"{self.cliproxy_url}/v0/management/api-keys",
                headers=headers, timeout=30
            )
            if resp.status_code != 200:
                logger.warning(f"API keys endpoint returned {resp.status_code}")
                return []
            payload = resp.json()
            values = payload.get('api-keys') or payload.get('api_keys') or []
            return [str(v) for v in values if str(v or '').strip()]
        except Exception as e:
            logger.warning(f"Failed to fetch API keys: {e}")
            return []

    def _api_key_hash_map(self) -> Dict[str, str]:
        mapping: Dict[str, str] = {}
        for key in self.fetch_api_keys():
            mapping[hashlib.sha256(key.encode('utf-8')).hexdigest()] = key
        return mapping

    def fetch_usage_from_sqlite(self) -> Optional[Dict]:
        """
        Read CPA-Manager SQLite directly when mounted.

        CPA's /v0/management/usage response currently omits api_key_hash from
        details[], while /data/usage.sqlite keeps it in usage_events. Reading the
        SQLite DB lets the dashboard recover true inbound API-key attribution.
        """
        db_path = os.environ.get('CPA_USAGE_DB_PATH') or os.environ.get('CLIPROXY_USAGE_DB_PATH')
        if not db_path or not os.path.exists(db_path):
            return None

        key_by_hash = self._api_key_hash_map()
        usage = {
            'total_requests': 0,
            'success_count': 0,
            'failure_count': 0,
            'total_tokens': 0,
            'apis': {},
        }

        try:
            conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT
                    timestamp,
                    provider,
                    model,
                    endpoint,
                    method,
                    path,
                    auth_type,
                    auth_index,
                    source,
                    api_key_hash,
                    account_snapshot,
                    auth_label_snapshot,
                    auth_file_snapshot,
                    auth_provider_snapshot,
                    auth_snapshot_at_ms,
                    input_tokens,
                    output_tokens,
                    reasoning_tokens,
                    cached_tokens,
                    cache_tokens,
                    total_tokens,
                    latency_ms,
                    failed
                FROM usage_events
                ORDER BY id ASC
            """).fetchall()
            conn.close()
        except Exception as e:
            logger.warning(f"Failed to read CPA usage sqlite at {db_path}: {e}", exc_info=True)
            return None

        for row in rows:
            endpoint = row['endpoint'] or f"{row['method'] or 'POST'} {row['path'] or '/v1/chat/completions'}"
            model = row['model'] or 'unknown'
            failed = bool(row['failed'])
            tokens = {
                'input_tokens': int(row['input_tokens'] or 0),
                'output_tokens': int(row['output_tokens'] or 0),
                'reasoning_tokens': int(row['reasoning_tokens'] or 0),
                'cached_tokens': int(row['cached_tokens'] or 0),
                'cache_tokens': int(row['cache_tokens'] or 0),
                'total_tokens': int(row['total_tokens'] or 0),
            }
            api_key_hash = str(row['api_key_hash'] or '').strip()
            api_key_name = key_by_hash.get(api_key_hash) or (f"sha256:{api_key_hash[:12]}" if api_key_hash else '')

            api_data = usage['apis'].setdefault(endpoint, {'models': {}})
            model_data = api_data['models'].setdefault(model, {'details': []})
            model_data['details'].append({
                'timestamp': row['timestamp'],
                'provider': row['provider'],
                'auth_type': row['auth_type'],
                'auth_index': row['auth_index'] or '',
                'source': row['source'] or '',
                'api_key_hash': api_key_hash,
                'api_key_name': api_key_name,
                'account_snapshot': row['account_snapshot'],
                'auth_label_snapshot': row['auth_label_snapshot'],
                'auth_file_snapshot': row['auth_file_snapshot'],
                'auth_provider_snapshot': row['auth_provider_snapshot'],
                'auth_snapshot_at_ms': row['auth_snapshot_at_ms'],
                'latency_ms': row['latency_ms'],
                'failed': failed,
                'tokens': tokens,
            })

            usage['total_requests'] += 1
            usage['total_tokens'] += tokens['total_tokens']
            if failed:
                usage['failure_count'] += 1
            else:
                usage['success_count'] += 1

        _normalize_model_totals(usage)
        logger.info(
            "Loaded CPA usage sqlite: %s events, %s API key hash labels",
            usage['total_requests'], len(key_by_hash)
        )
        return {'usage': usage}

    def fetch_auth_files(self) -> Optional[List[Dict]]:
        """Fetch auth files for credential mapping."""
        try:
            headers = {'X-Management-Key': self.management_key}
            resp = requests.get(
                f"{self.cliproxy_url}/v0/management/auth-files",
                headers=headers, timeout=30
            )
            if resp.status_code != 200:
                logger.error(f"Auth files API returned {resp.status_code}")
                return None
            return resp.json().get('files', [])
        except Exception as e:
            logger.error(f"Failed to fetch auth files: {e}")
            return None

    def build_auth_index_map(self, auth_files: List[Dict]) -> Dict[str, Dict]:
        """
        Build lookup maps from auth files.
        Returns dict keyed by auth_index with credential info.
        Also builds a secondary map by source (name field) for fallback matching.
        """
        by_auth_index = {}
        by_name = {}

        for f in auth_files:
            info = {
                'provider': f.get('provider', ''),
                'email': f.get('email', ''),
                'name': f.get('name', ''),
                'label': f.get('label', ''),
                'status': f.get('status', 'unknown'),
                'account_type': f.get('account_type', ''),
                'auth_index': f.get('auth_index', ''),
            }
            if f.get('auth_index'):
                by_auth_index[f['auth_index']] = info
            if f.get('name'):
                by_name[f['name']] = info

        return by_auth_index, by_name

    def resolve_credential(self, auth_index: str, source: str,
                           by_auth_index: Dict, by_name: Dict) -> Dict:
        """
        Resolve a credential from auth_index and source.
        Try auth_index first, then source (filename), then fallback.
        """
        # Try auth_index match
        if auth_index and auth_index in by_auth_index:
            return by_auth_index[auth_index]

        # Try source as filename match
        if source and source in by_name:
            return by_name[source]

        # Fallback - try to infer from source string
        provider = 'unknown'
        email = source or auth_index or 'unknown'

        if source:
            s = source.lower()
            if s.startswith('aizasy') or 'googleapis' in s:
                provider = 'gemini-api-key'
                email = source[:20] + '...'
            elif s.endswith('.json'):
                # Try to extract provider-email pattern
                parts = s.replace('.json', '').split('-', 1)
                if len(parts) == 2:
                    provider = parts[0]
                    email = parts[1].replace('_', '.')
            elif '@' in source:
                email = source
                provider = 'oauth'
            elif '=' in source or len(source) > 40:
                provider = 'api-key'
                email = source[:20] + '...'

        return {
            'provider': provider,
            'email': email,
            'name': source or '',
            'label': email,
            'status': 'active',
            'account_type': 'inferred',
            'auth_index': auth_index or '',
        }

    def aggregate_stats(self, usage_data: Dict, auth_files: List[Dict]) -> tuple:
        """
        Parse usage details and aggregate per-credential and per-API-key stats.

        Returns:
            (credential_stats: list, api_key_stats: list)
        """
        by_auth_index, by_name = self.build_auth_index_map(auth_files)

        # Per-credential aggregation keyed by auth_index (or source as fallback)
        cred_agg = defaultdict(lambda: {
            'total_requests': 0, 'success_count': 0, 'failure_count': 0,
            'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0,
            'cached_tokens': 0, 'total_tokens': 0,
            'models': defaultdict(lambda: {
                'requests': 0, 'success': 0, 'failure': 0,
                'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0,
                'cached_tokens': 0, 'total_tokens': 0,
            }),
            'api_keys': set(),
            'info': None,
        })

        # Per-API-key aggregation
        api_key_agg = defaultdict(lambda: {
            'total_requests': 0, 'total_tokens': 0,
            'success_count': 0, 'failure_count': 0,
            'input_tokens': 0, 'output_tokens': 0,
            'models': defaultdict(lambda: {
                'requests': 0, 'tokens': 0,
                'success': 0, 'failure': 0,
            }),
            'credentials_used': set(),
        })

        apis = usage_data.get('usage', {}).get('apis', {})

        for api_endpoint, api_data in apis.items():
            for model_name, model_data in api_data.get('models', {}).items():
                details = model_data.get('details', [])

                for d in details:
                    auth_idx = d.get('auth_index', '')
                    source = d.get('source', '')
                    failed = d.get('failed', False)
                    tokens = d.get('tokens', {})

                    # Use auth_index as primary key, source as fallback
                    cred_key = auth_idx or source or 'unknown'

                    # Resolve credential info (only once per key)
                    cred = cred_agg[cred_key]
                    if cred['info'] is None:
                        cred['info'] = self.resolve_credential(
                            auth_idx, source, by_auth_index, by_name
                        )
                    cred_info = cred['info'] or {}
                    api_key_name = _detail_api_key_name(d, cred_info)
                    ak = api_key_agg[api_key_name]

                    # Token values
                    in_tok = tokens.get('input_tokens', 0)
                    out_tok = tokens.get('output_tokens', 0)
                    reason_tok = tokens.get('reasoning_tokens', 0)
                    cache_tok = tokens.get('cached_tokens', 0)
                    tot_tok = tokens.get('total_tokens', 0)

                    # Update credential stats
                    cred['total_requests'] += 1
                    if failed:
                        cred['failure_count'] += 1
                    else:
                        cred['success_count'] += 1
                    cred['input_tokens'] += in_tok
                    cred['output_tokens'] += out_tok
                    cred['reasoning_tokens'] += reason_tok
                    cred['cached_tokens'] += cache_tok
                    cred['total_tokens'] += tot_tok
                    cred['api_keys'].add(api_key_name)

                    # Update credential model stats
                    m = cred['models'][model_name]
                    m['requests'] += 1
                    m['success'] += 0 if failed else 1
                    m['failure'] += 1 if failed else 0
                    m['input_tokens'] += in_tok
                    m['output_tokens'] += out_tok
                    m['reasoning_tokens'] += reason_tok
                    m['cached_tokens'] += cache_tok
                    m['total_tokens'] += tot_tok

                    # Update API key stats
                    ak['total_requests'] += 1
                    ak['total_tokens'] += tot_tok
                    ak['input_tokens'] += in_tok
                    ak['output_tokens'] += out_tok
                    ak.setdefault('endpoints', set()).add(api_endpoint)
                    if failed:
                        ak['failure_count'] += 1
                    else:
                        ak['success_count'] += 1
                    ak['credentials_used'].add(cred_key)

                    ak_model = ak['models'][model_name]
                    ak_model['requests'] += 1
                    ak_model['tokens'] += tot_tok
                    ak_model['success'] += 0 if failed else 1
                    ak_model['failure'] += 1 if failed else 0

        # Convert to serializable lists
        credential_stats = []
        for cred_key, cred in cred_agg.items():
            info = cred['info'] or {}
            success_rate = 0
            if cred['total_requests'] > 0:
                success_rate = round(
                    (cred['success_count'] / cred['total_requests']) * 100, 1
                )
            credential_stats.append({
                'auth_index': info.get('auth_index', cred_key),
                'source': info.get('name', ''),
                'provider': info.get('provider', 'unknown'),
                'email': info.get('email', ''),
                'label': info.get('label', ''),
                'status': info.get('status', 'unknown'),
                'account_type': info.get('account_type', ''),
                'total_requests': cred['total_requests'],
                'success_count': cred['success_count'],
                'failure_count': cred['failure_count'],
                'success_rate': success_rate,
                'input_tokens': cred['input_tokens'],
                'output_tokens': cred['output_tokens'],
                'reasoning_tokens': cred['reasoning_tokens'],
                'cached_tokens': cred['cached_tokens'],
                'total_tokens': cred['total_tokens'],
                'models': {
                    k: dict(v) for k, v in cred['models'].items()
                },
                'api_keys': sorted(cred['api_keys']),
            })

        # Sort by total_requests descending
        credential_stats.sort(key=lambda x: x['total_requests'], reverse=True)

        api_key_stats = []
        for ak_name, ak in api_key_agg.items():
            success_rate = 0
            if ak['total_requests'] > 0:
                success_rate = round(
                    (ak['success_count'] / ak['total_requests']) * 100, 1
                )
            api_key_stats.append({
                'api_key_name': ak_name,
                'total_requests': ak['total_requests'],
                'total_tokens': ak['total_tokens'],
                'success_count': ak['success_count'],
                'failure_count': ak['failure_count'],
                'success_rate': success_rate,
                'input_tokens': ak['input_tokens'],
                'output_tokens': ak['output_tokens'],
                'models': {
                    k: dict(v) for k, v in ak['models'].items()
                },
                'endpoints': sorted(ak.get('endpoints', set())),
                'credentials_used': sorted(ak['credentials_used']),
            })

        api_key_stats.sort(key=lambda x: x['total_requests'], reverse=True)

        return credential_stats, api_key_stats

    def _read_previous_summary(self) -> Tuple[List[Dict], List[Dict]]:
        """Read previous cumulative data from credential_usage_summary."""
        try:
            result = self.supabase.table('credential_usage_summary') \
                .select('credentials, api_keys') \
                .eq('id', 1) \
                .single() \
                .execute()
            if result.data:
                return (
                    result.data.get('credentials', []) or [],
                    result.data.get('api_keys', []) or [],
                )
        except Exception as e:
            logger.debug(f"No previous summary found (first run?): {e}")
        return [], []

    def _read_today_daily(self, today_str: str) -> Tuple[List[Dict], List[Dict]]:
        """Read existing today's row from credential_daily_stats."""
        try:
            result = self.supabase.table('credential_daily_stats') \
                .select('credentials, api_keys') \
                .eq('stat_date', today_str) \
                .single() \
                .execute()
            if result.data:
                return (
                    result.data.get('credentials', []) or [],
                    result.data.get('api_keys', []) or [],
                )
        except Exception:
            pass
        return [], []

    def _upsert_daily_stats(self, today_str: str, credentials: List[Dict],
                            api_keys: List[Dict]):
        """Upsert merged daily stats for today."""
        self.supabase.table('credential_daily_stats').upsert({
            'stat_date': today_str,
            'credentials': credentials,
            'api_keys': api_keys,
            'total_credentials': len(credentials),
            'total_api_keys': len(api_keys),
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }, on_conflict='stat_date').execute()

    def sync(self) -> Dict[str, int]:
        """
        Main sync: fetch, aggregate, calculate deltas, store daily + summary.
        Returns stats dict.
        """
        stats = {'credentials': 0, 'api_keys': 0, 'error': False}

        try:
            usage_data = self.fetch_usage()
            if not usage_data:
                stats['error'] = True
                return stats

            auth_files = self.fetch_auth_files()
            if auth_files is None:
                auth_files = []
                logger.warning("Could not fetch auth files, proceeding without credential mapping")

            # New cumulative stats from CLIProxy
            credential_stats, api_key_stats = self.aggregate_stats(usage_data, auth_files)

            stats['credentials'] = len(credential_stats)
            stats['api_keys'] = len(api_key_stats)

            # --- Delta calculation + daily stats ---
            try:
                # 1. Read previous cumulative data
                prev_creds, prev_keys = self._read_previous_summary()

                # 2. Calculate deltas
                delta_creds = _calculate_credential_deltas(credential_stats, prev_creds)
                delta_keys = _calculate_api_key_deltas(api_key_stats, prev_keys)

                if delta_creds or delta_keys:
                    # 3. Get today's date in app timezone
                    today_str = datetime.now(self.app_timezone).strftime('%Y-%m-%d')

                    # 4. Read existing today's daily row
                    existing_creds, existing_keys = self._read_today_daily(today_str)

                    # 5. Merge deltas into existing
                    merged_creds = _merge_daily_credentials(existing_creds, delta_creds)
                    merged_keys = _merge_daily_api_keys(existing_keys, delta_keys)

                    # 6. Upsert daily stats
                    self._upsert_daily_stats(today_str, merged_creds, merged_keys)

                    logger.info(
                        f"Credential daily stats updated for {today_str}: "
                        f"{len(delta_creds)} credential deltas, {len(delta_keys)} API key deltas"
                    )
                else:
                    logger.debug("No credential deltas detected (no new usage)")

            except Exception as e:
                # Daily stats failure should not block summary upsert
                logger.warning(f"Failed to update credential daily stats: {e}", exc_info=True)

            # --- Upsert summary (backward compat) ---
            self.supabase.table('credential_usage_summary').upsert({
                'id': 1,
                'credentials': credential_stats,
                'api_keys': api_key_stats,
                'total_credentials': len(credential_stats),
                'total_api_keys': len(api_key_stats),
                'synced_at': datetime.now(timezone.utc).isoformat(),
            }, on_conflict='id').execute()

            logger.info(
                f"Credential stats synced: {stats['credentials']} credentials, "
                f"{stats['api_keys']} API keys"
            )

        except Exception as e:
            logger.error(f"Credential stats sync failed: {e}", exc_info=True)
            stats['error'] = True

        return stats


def sync_credential_stats(cliproxy_url: str, management_key: str,
                          supabase_client, app_timezone=None,
                          usage_url: Optional[str] = None) -> Dict:
    """Convenience function."""
    syncer = CredentialStatsSync(
        cliproxy_url, management_key, supabase_client,
        app_timezone=app_timezone,
        usage_url=usage_url,
    )
    return syncer.sync()
