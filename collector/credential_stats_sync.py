"""
Credential Usage Stats Sync Module

Parses per-credential and per-API-key usage statistics from CLIProxy
Management API and stores aggregated results in Supabase.

Data flow:
1. Fetch /v0/management/usage    → get details[] with source, auth_index, tokens, failed
2. Fetch /v0/management/auth-files → map auth_index to email, provider, name, status
3. Aggregate by credential (auth_index) and by API key
4. Upsert to credential_usage_summary table (single-row, JSONB)
"""

import logging
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
from collections import defaultdict

logger = logging.getLogger(__name__)


class CredentialStatsSync:
    """Syncs per-credential usage statistics from CLIProxy."""

    def __init__(self, cliproxy_url: str, management_key: str, supabase_client):
        self.cliproxy_url = cliproxy_url.rstrip('/')
        self.management_key = management_key
        self.supabase = supabase_client

    def fetch_usage(self) -> Optional[Dict]:
        """Fetch usage data from CLIProxy."""
        try:
            headers = {'Authorization': f'Bearer {self.management_key}'}
            resp = requests.get(
                f"{self.cliproxy_url}/v0/management/usage",
                headers=headers, timeout=30
            )
            if resp.status_code != 200:
                logger.error(f"Usage API returned {resp.status_code}")
                return None
            return resp.json()
        except Exception as e:
            logger.error(f"Failed to fetch usage: {e}")
            return None

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

        for api_key_name, api_data in apis.items():
            ak = api_key_agg[api_key_name]

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
                'credentials_used': sorted(ak['credentials_used']),
            })

        api_key_stats.sort(key=lambda x: x['total_requests'], reverse=True)

        return credential_stats, api_key_stats

    def sync(self) -> Dict[str, int]:
        """
        Main sync: fetch, aggregate, store.
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

            credential_stats, api_key_stats = self.aggregate_stats(usage_data, auth_files)

            stats['credentials'] = len(credential_stats)
            stats['api_keys'] = len(api_key_stats)

            # Upsert to single-row summary table
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


def sync_credential_stats(cliproxy_url: str, management_key: str, supabase_client) -> Dict:
    """Convenience function."""
    syncer = CredentialStatsSync(cliproxy_url, management_key, supabase_client)
    return syncer.sync()
