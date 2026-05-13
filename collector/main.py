#!/usr/bin/env python3
"""
CLIProxy Usage Collector
Polls the CLIProxy Management API and stores usage data in PostgreSQL
"""

import os
import time
import hmac
import hashlib
import logging
import secrets
import threading
from uuid import uuid4
from datetime import datetime, date, timezone, timedelta
from typing import Optional, Dict, Any, Tuple
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, Blueprint, request, make_response, Response, g
from flask_cors import CORS
from db import PostgreSQLClient
from credential_stats_sync import sync_credential_stats, normalize_usage_payload
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

def _env_int(name: str, default: int, min_value: int = 1) -> int:
    raw = os.getenv(name, str(default))
    try:
        return max(min_value, int(raw))
    except Exception:
        return max(min_value, default)


def _env_url(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip().rstrip('/')


# Configuration from environment
DATABASE_URL = os.getenv('DATABASE_URL', '')
CLIPROXY_URL = _env_url('CLIPROXY_URL', 'http://localhost:8317')
CLIPROXY_USAGE_URL = _env_url('CLIPROXY_USAGE_URL', CLIPROXY_URL)
CLIPROXY_MANAGEMENT_KEY = os.getenv('CLIPROXY_MANAGEMENT_KEY', '')
COLLECTOR_INTERVAL = _env_int('COLLECTOR_INTERVAL_SECONDS', 60)
CREDENTIAL_SYNC_INTERVAL = _env_int('CREDENTIAL_SYNC_INTERVAL_SECONDS', COLLECTOR_INTERVAL)
APP_LOG_CLEANUP_INTERVAL_MINUTES = _env_int('APP_LOG_CLEANUP_INTERVAL_MINUTES', 30)
TRIGGER_PORT = _env_int('COLLECTOR_TRIGGER_PORT', 5001)

ADMIN_PASSWORD = str(os.getenv('ADMIN_PASSWORD', '')).strip()
ADMIN_SESSION_COOKIE_NAME = str(os.getenv('ADMIN_SESSION_COOKIE_NAME', 'cliproxy_admin_session')).strip() or 'cliproxy_admin_session'
ADMIN_SESSION_TTL_DAYS = _env_int('ADMIN_SESSION_TTL_DAYS', 30)
ADMIN_SESSION_SECURE_COOKIE = str(os.getenv('ADMIN_SESSION_SECURE_COOKIE', 'false')).strip().lower() in {'1', 'true', 'yes', 'on'}
ADMIN_SESSION_SAMESITE = str(os.getenv('ADMIN_SESSION_SAMESITE', 'Lax')).strip().capitalize() or 'Lax'
if ADMIN_SESSION_SAMESITE not in {'Lax', 'Strict', 'None'}:
    ADMIN_SESSION_SAMESITE = 'Lax'
ADMIN_ALLOWED_ORIGINS = [origin.strip().rstrip('/') for origin in str(os.getenv('ADMIN_ALLOWED_ORIGINS', '')).split(',') if origin.strip()]

LOG_VERBOSITY = str(os.getenv('LOG_VERBOSITY', 'normal')).strip().lower()
if LOG_VERBOSITY not in {'minimal', 'normal', 'debug'}:
    LOG_VERBOSITY = 'normal'
LOG_DEBUG_EVENTS = str(os.getenv('LOG_DEBUG_EVENTS', 'false')).strip().lower() in {'1', 'true', 'yes', 'on'}
LOG_DEBUG_EVENTS_MAX_PER_SYNC = _env_int('LOG_DEBUG_EVENTS_MAX_PER_SYNC', 200, min_value=0)
APP_LOG_RETENTION_DAYS = _env_int('APP_LOG_RETENTION_DAYS', 30)


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
db_client: Optional[PostgreSQLClient] = None
remote_pricing_cache: Dict[str, Dict[str, float]] = {}
remote_pricing_last_fetch: float = 0

# --- Flask App Setup ---
flask_app = Flask(__name__)
CORS(flask_app)
api_bp = Blueprint('api', __name__, url_prefix='/api/collector')

# --- API Endpoints ---
SKILL_DEFAULT_PRICING = {'input': 3.00, 'output': 15.00}
LOG_ALLOWED_SEVERITY = {'debug', 'info', 'warn', 'error'}
LOG_ALLOWED_CATEGORY = {'skill', 'sync', 'credential', 'api', 'db', 'system', 'other'}
AUTH_PUBLIC_PATHS = {
    '/api/collector/health',
    '/api/collector/auth/login',
    '/api/collector/auth/logout',
    '/api/collector/auth/session',
    '/api/collector/auth/verify',
    '/api/collector/log-events',
    '/api/collector/skill-events',
}
AUTH_PROTECTED_POST_PATHS = {
    '/api/collector/trigger',
    '/api/collector/credential-stats/sync',
    '/api/collector/logs/clear',
    '/api/collector/auth/logout',
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        if raw.endswith('Z'):
            raw = raw[:-1] + '+00:00'
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _format_http_datetime(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def _verify_admin_password(password: str) -> bool:
    if not ADMIN_PASSWORD:
        logger.warning('ADMIN_PASSWORD is not configured; rejecting login attempt.')
        return False
    return hmac.compare_digest(password, ADMIN_PASSWORD)


def _get_request_origin() -> str:
    return (request.headers.get('Origin') or '').strip().rstrip('/')


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    if ADMIN_ALLOWED_ORIGINS:
        return origin in ADMIN_ALLOWED_ORIGINS
    host = request.host_url.rstrip('/')
    return origin == host


def _validate_same_origin_request() -> Optional[Response]:
    if not ADMIN_ALLOWED_ORIGINS:
        return None

    origin = _get_request_origin()
    referer = (request.headers.get('Referer') or '').strip()

    if origin:
        if _origin_allowed(origin):
            return None
        return jsonify({'error': 'origin not allowed'}), 403

    if referer:
        parsed = urlparse(referer)
        referer_origin = f'{parsed.scheme}://{parsed.netloc}'.rstrip('/') if parsed.scheme and parsed.netloc else ''
        if referer_origin and _origin_allowed(referer_origin):
            return None
        return jsonify({'error': 'referer not allowed'}), 403

    return jsonify({'error': 'missing origin'}), 403


def _session_cookie_settings(max_age: int = 0) -> Dict[str, Any]:
    expires_at = _utcnow() + timedelta(seconds=max_age) if max_age > 0 else _utcnow() - timedelta(days=1)
    return {
        'key': ADMIN_SESSION_COOKIE_NAME,
        'httponly': True,
        'secure': ADMIN_SESSION_SECURE_COOKIE,
        'samesite': ADMIN_SESSION_SAMESITE,
        'path': '/',
        'max_age': max_age,
        'expires': _format_http_datetime(expires_at),
    }


def _set_session_cookie(response: Response, token: str, max_age: int) -> None:
    response.set_cookie(value=token, **_session_cookie_settings(max_age=max_age))


def _clear_session_cookie(response: Response) -> None:
    response.set_cookie(value='', **_session_cookie_settings(max_age=0))


def _get_session_row(token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not db_client or not token:
        return None
    token_hash = _hash_session_token(token)
    try:
        row = db_client.table('admin_sessions').select('*').eq('token_hash', token_hash).single().execute().data
    except Exception as e:
        logger.error(f'Failed to load admin session: {e}', exc_info=True)
        return None

    if not row:
        return None

    revoked_at = _parse_iso_datetime(row.get('revoked_at'))
    expires_at = _parse_iso_datetime(row.get('expires_at'))
    now = _utcnow()
    if revoked_at or not expires_at or expires_at <= now:
        if not revoked_at:
            try:
                db_client.table('admin_sessions').update({'revoked_at': now.isoformat()}).eq('id', row.get('id')).execute()
            except Exception as e:
                logger.error(f'Failed to revoke expired admin session: {e}', exc_info=True)
        return None

    return row


def _get_authenticated_session() -> Optional[Dict[str, Any]]:
    if hasattr(g, 'admin_session'):
        return g.admin_session
    token = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)
    session_row = _get_session_row(token)
    g.admin_session = session_row
    return session_row


def _touch_session(session_row: Dict[str, Any]) -> None:
    if not db_client or not session_row or not session_row.get('id'):
        return
    try:
        db_client.table('admin_sessions').update({'last_seen_at': _utcnow().isoformat()}).eq('id', session_row['id']).execute()
    except Exception as e:
        logger.error(f'Failed to update admin session last_seen_at: {e}', exc_info=True)


def _revoke_session(session_row: Optional[Dict[str, Any]]) -> None:
    if not db_client or not session_row or not session_row.get('id'):
        return
    try:
        db_client.table('admin_sessions').update({'revoked_at': _utcnow().isoformat()}).eq('id', session_row['id']).execute()
    except Exception as e:
        logger.error(f'Failed to revoke admin session: {e}', exc_info=True)


def _session_payload(session_row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not session_row:
        return {'authenticated': False}
    return {
        'authenticated': True,
        'remember_me': bool(session_row.get('remember_me')),
        'expires_at': session_row.get('expires_at'),
        'last_seen_at': session_row.get('last_seen_at'),
    }


def _require_admin_session() -> Optional[Response]:
    session_row = _get_authenticated_session()
    if not session_row:
        return jsonify({'error': 'authentication required'}), 401
    _touch_session(session_row)
    return None


def _should_log_event(severity: str, is_debug_event: bool = False) -> bool:
    sev = _normalize_log_severity(severity)
    if LOG_VERBOSITY == 'minimal':
        return sev in {'warn', 'error'}
    if sev == 'debug' and LOG_VERBOSITY != 'debug':
        return False
    if is_debug_event and (LOG_VERBOSITY != 'debug' or not LOG_DEBUG_EVENTS):
        return False
    return True


def _log_sync_event(*, run_id: str, source: str, category: str, severity: str, title: str, message: str, details: Optional[Dict[str, Any]] = None, event_uid: Optional[str] = None, is_debug_event: bool = False) -> None:
    if not _should_log_event(severity, is_debug_event=is_debug_event):
        return

    merged_details = {'run_id': run_id}
    if isinstance(details, dict):
        merged_details.update(details)

    _log_app_event(
        source=source,
        category=category,
        severity=severity,
        title=title,
        message=message,
        details=merged_details,
        event_uid=event_uid,
    )


def _normalize_log_severity(value: Any) -> str:
    raw = str(value or '').strip().lower()
    if raw == 'warning':
        raw = 'warn'
    if raw in ('fatal', 'critical'):
        raw = 'error'
    return raw if raw in LOG_ALLOWED_SEVERITY else 'info'


def _normalize_log_category(value: Any) -> str:
    raw = str(value or '').strip().lower()
    return raw if raw in LOG_ALLOWED_CATEGORY else 'other'


def _safe_text(value: Any, max_len: int = 1000) -> str:
    return str(value or '').strip()[:max_len]


@flask_app.before_request
def _enforce_admin_auth() -> Optional[Response]:
    path = request.path.rstrip('/') or '/'

    if path.startswith('/rest/v1'):
        guard = _require_admin_session()
        if guard:
            return guard
        return None

    if not path.startswith('/api/collector'):
        return None

    if path in AUTH_PUBLIC_PATHS:
        if request.method == 'POST' and path == '/api/collector/auth/logout':
            return _validate_same_origin_request()
        return None

    if request.method == 'POST' and path in AUTH_PROTECTED_POST_PATHS:
        csrf_guard = _validate_same_origin_request()
        if csrf_guard:
            return csrf_guard

    return _require_admin_session()


def _current_local_day_bounds_utc() -> tuple[str, str]:
    now_local = datetime.now(APP_TIMEZONE)
    start_local = datetime(now_local.year, now_local.month, now_local.day, tzinfo=APP_TIMEZONE)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()


def _skill_stat_date_for_triggered_at(triggered_at: Any) -> str:
    iso_utc = _to_iso_utc(triggered_at)
    try:
        dt = datetime.fromisoformat(str(iso_utc).replace('Z', '+00:00'))
    except Exception:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(APP_TIMEZONE).date().isoformat()


def _skill_day_bounds_utc(stat_date: str) -> tuple[str, str]:
    day = datetime.strptime(stat_date, '%Y-%m-%d').date()
    start_local = datetime(day.year, day.month, day.day, tzinfo=APP_TIMEZONE)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()


def _cleanup_old_app_logs() -> int:
    if not db_client:
        return 0

    now_local = datetime.now(APP_TIMEZONE)
    cutoff_local = now_local - timedelta(days=APP_LOG_RETENTION_DAYS)
    cutoff_utc = cutoff_local.astimezone(timezone.utc).isoformat()

    conn = db_client._pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM app_logs WHERE logged_at < %s', (cutoff_utc,))
            deleted = cur.rowcount or 0
        conn.commit()
        return deleted
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to cleanup old app logs: {e}", exc_info=True)
        return 0
    finally:
        db_client._pool.putconn(conn)


def _normalize_app_log_event(evt: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(evt, dict):
        return None

    message = _safe_text(evt.get('message'), 4000)
    if not message:
        return None

    details = evt.get('details')
    if details is not None and not isinstance(details, (dict, list, str, int, float, bool)):
        details = str(details)

    return {
        'event_uid': _safe_text(evt.get('event_uid'), 255) or None,
        'logged_at': _to_iso_utc(evt.get('logged_at')),
        'source': _safe_text(evt.get('source') or 'collector', 100) or 'collector',
        'category': _normalize_log_category(evt.get('category') or 'system'),
        'severity': _normalize_log_severity(evt.get('severity') or 'info'),
        'title': _safe_text(evt.get('title'), 255) or None,
        'message': message,
        'details': details,
        'session_id': _safe_text(evt.get('session_id'), 255) or None,
        'machine_id': _safe_text(evt.get('machine_id'), 255) or None,
        'project_dir': _safe_text(evt.get('project_dir'), 500) or None,
        'created_at': datetime.utcnow().isoformat(),
    }


def _log_app_event(*, source: str, category: str, severity: str, title: str, message: str, details: Optional[Dict[str, Any]] = None, event_uid: Optional[str] = None) -> None:
    if not db_client:
        return

    evt = _normalize_app_log_event({
        'event_uid': event_uid,
        'logged_at': datetime.utcnow().isoformat(),
        'source': source,
        'category': category,
        'severity': severity,
        'title': title,
        'message': message,
        'details': details,
    })
    if not evt:
        return

    try:
        if evt.get('event_uid'):
            db_client.table('app_logs').upsert(evt, on_conflict='event_uid').execute()
        else:
            db_client.table('app_logs').insert(evt).execute()
    except Exception as e:
        logger.error(f"Failed to write app log event: {e}", exc_info=True)


@api_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now(APP_TIMEZONE).isoformat()})


@api_bp.route('/auth/login', methods=['POST'])
def auth_login():
    if not db_client:
        return jsonify({'error': 'database not initialized'}), 500

    csrf_guard = _validate_same_origin_request()
    if csrf_guard:
        return csrf_guard

    body = request.get_json(force=True, silent=True) or {}
    password = str(body.get('password') or '')
    remember_me = bool(body.get('rememberMe'))

    if not password:
        return jsonify({'error': 'password is required'}), 400

    if not _verify_admin_password(password):
        logger.warning('Admin login failed due to invalid password')
        return jsonify({'error': 'invalid credentials'}), 401

    token = _generate_session_token()
    now = _utcnow()
    expires_at = now + timedelta(days=ADMIN_SESSION_TTL_DAYS)
    session_record = {
        'token_hash': _hash_session_token(token),
        'created_at': now.isoformat(),
        'last_seen_at': now.isoformat(),
        'expires_at': expires_at.isoformat(),
        'remember_me': remember_me,
        'revoked_at': None,
        'created_ip': _safe_text(request.headers.get('X-Forwarded-For') or request.remote_addr, 255) or None,
        'user_agent': _safe_text(request.headers.get('User-Agent'), 1000) or None,
    }

    created = db_client.table('admin_sessions').insert(session_record).execute().data
    session_row = created[0] if created else session_record
    response = make_response(jsonify(_session_payload(session_row)))
    _set_session_cookie(response, token, max_age=ADMIN_SESSION_TTL_DAYS * 24 * 60 * 60)
    g.admin_session = session_row
    return response


@api_bp.route('/auth/session', methods=['GET'])
def auth_session():
    session_row = _get_authenticated_session()
    if session_row:
        _touch_session(session_row)
    return jsonify(_session_payload(session_row))


@api_bp.route('/auth/logout', methods=['POST'])
def auth_logout():
    session_row = _get_authenticated_session()
    if session_row:
        _revoke_session(session_row)
    response = make_response(jsonify({'ok': True}))
    _clear_session_cookie(response)
    g.admin_session = None
    return response


@api_bp.route('/auth/verify', methods=['GET'])
def auth_verify():
    session_row = _get_authenticated_session()
    if not session_row:
        response = make_response('', 401)
        _clear_session_cookie(response)
        return response
    _touch_session(session_row)
    return jsonify({'authenticated': True})


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
            stats = sync_credential_stats(
                CLIPROXY_URL,
                CLIPROXY_MANAGEMENT_KEY,
                db_client,
                app_timezone=APP_TIMEZONE,
                usage_url=CLIPROXY_USAGE_URL,
            )
            logger.info(f"Credential stats sync completed: {stats}")
        except Exception as e:
            logger.error(f"Credential stats sync failed: {e}", exc_info=True)
            _log_app_event(
                source='collector',
                category='credential',
                severity='error',
                title='Credential sync failed',
                message=f'Credential stats sync failed: {e}',
                details={'error': str(e)}
            )

    sync_thread = threading.Thread(target=credential_stats_task)
    sync_thread.start()
    return jsonify({"message": "Credential stats sync triggered."}), 202


@api_bp.route('/logs/clear', methods=['POST'])
def clear_logs_endpoint():
    if not db_client:
        return jsonify({'error': 'database not initialized'}), 500

    body = request.get_json(force=True, silent=True) or {}
    clear_scope = str(body.get('scope') or '').strip().lower()
    if clear_scope != 'all':
        return jsonify({'error': 'scope must be all'}), 400

    conn = db_client._pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM app_logs')
            deleted = cur.rowcount or 0
        conn.commit()

        _log_app_event(
            source='collector',
            category='system',
            severity='warn',
            title='App logs cleared',
            message='App logs were cleared from dashboard clear action.',
            details={'deleted_rows': deleted, 'scope': 'all'}
        )

        return jsonify({'status': 'ok', 'deleted': deleted})
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to clear app logs: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        db_client._pool.putconn(conn)


@api_bp.route('/log-events', methods=['POST'])
def ingest_log_events():
    if not db_client:
        return jsonify({'error': 'database not initialized'}), 500

    body = request.get_json(force=True, silent=True)
    if not body or 'events' not in body or not isinstance(body.get('events'), list):
        return jsonify({'error': 'missing events'}), 400

    events = body['events']
    upserted = 0
    skipped = 0

    for raw_evt in events:
        evt = _normalize_app_log_event(raw_evt)
        if not evt:
            skipped += 1
            continue

        try:
            if evt.get('event_uid'):
                result = db_client.table('app_logs').upsert(evt, on_conflict='event_uid').execute()
                if result.data is None:
                    db_client.table('app_logs').insert(evt).execute()
            else:
                db_client.table('app_logs').insert(evt).execute()
            upserted += 1
        except Exception as e:
            logger.error(f"Failed to ingest app log event: {e}", exc_info=True)
            skipped += 1

    return jsonify({'status': 'ok', 'upserted': upserted, 'skipped': skipped})


@api_bp.route('/skill-events', methods=['POST'])
def ingest_skill_events():
    if not db_client:
        return jsonify({"error": "database not initialized"}), 500

    body = request.get_json(force=True, silent=True)
    if not body or 'events' not in body or not isinstance(body.get('events'), list):
        return jsonify({'error': 'missing events'}), 400

    events = body['events']
    upserted = 0
    skipped = 0
    daily_keys = set()

    for evt in events:
        skill_name = str(evt.get('skill_name', '')).strip()[:100]
        session_id = str(evt.get('session_id', '')).strip()[:100]
        machine_id = str(evt.get('machine_id', '')).strip()[:100]

        if not skill_name or not session_id:
            skipped += 1
            continue

        sqlite_id = evt.get('sqlite_id')
        tool_use_id = str(evt.get('tool_use_id', '')).strip()[:255]
        attempt_no = max(_safe_int(evt.get('attempt_no'), 1), 1)
        event_uid = str(evt.get('event_uid', '')).strip()[:255]
        if not event_uid:
            event_uid = _derive_skill_event_uid(machine_id, session_id, skill_name, tool_use_id, attempt_no)

        status = _normalize_skill_status(evt.get('status'))
        incoming_is_skeleton = bool(evt.get('is_skeleton', False))
        tokens_used = _safe_int(evt.get('tokens_used'), 0)
        output_tokens = _safe_int(evt.get('output_tokens'), 0)
        tool_calls = _safe_int(evt.get('tool_calls'), 0)
        duration_ms = _safe_int(evt.get('duration_ms'), 0)
        model = str(evt.get('model') or '').strip() or None

        existing = None
        try:
            existing = db_client.table('skill_runs').select(
                'event_uid,machine_id,source,sqlite_id,tool_use_id,skill_name,session_id,trigger_type,triggered_at,'
                'status,error_type,error_message,attempt_no,arguments,tokens_used,output_tokens,tool_calls,duration_ms,'
                'skill_version_hash,model,is_skeleton,project_dir'
            ).eq('event_uid', event_uid).single().execute().data
        except Exception as e:
            logger.error(f"Failed to read existing skill event by event_uid={event_uid}: {e}", exc_info=True)

        existing_is_skeleton = bool(existing.get('is_skeleton', False)) if existing else None
        is_final_update = (not incoming_is_skeleton)

        merged_tokens_used = tokens_used
        merged_output_tokens = output_tokens
        merged_tool_calls = tool_calls
        merged_duration_ms = duration_ms
        merged_model = model
        merged_status = status
        merged_error_type = str(evt.get('error_type') or '')[:100] or None
        merged_error_message = str(evt.get('error_message') or '')[:1000] or None

        if existing:
            existing_tokens_used = _safe_int(existing.get('tokens_used'), 0)
            existing_output_tokens = _safe_int(existing.get('output_tokens'), 0)
            existing_tool_calls = _safe_int(existing.get('tool_calls'), 0)
            existing_duration_ms = _safe_int(existing.get('duration_ms'), 0)
            existing_model = str(existing.get('model') or '').strip() or None
            existing_status = _normalize_skill_status(existing.get('status'))
            existing_error_type = str(existing.get('error_type') or '')[:100] or None
            existing_error_message = str(existing.get('error_message') or '')[:1000] or None

            if incoming_is_skeleton and existing_is_skeleton is False:
                merged_tokens_used = existing_tokens_used
                merged_output_tokens = existing_output_tokens
                merged_tool_calls = existing_tool_calls
                merged_duration_ms = existing_duration_ms
                merged_model = existing_model
                merged_status = existing_status
                merged_error_type = existing_error_type
                merged_error_message = existing_error_message
            elif is_final_update:
                merged_tokens_used = max(tokens_used, existing_tokens_used)
                merged_output_tokens = max(output_tokens, existing_output_tokens)
                merged_tool_calls = max(tool_calls, existing_tool_calls)
                merged_duration_ms = max(duration_ms, existing_duration_ms)
                merged_model = model or existing_model
                if merged_status == 'success' and existing_status == 'failure':
                    merged_status = existing_status
                merged_error_type = merged_error_type or existing_error_type
                merged_error_message = merged_error_message or existing_error_message
            else:
                merged_tokens_used = max(tokens_used, existing_tokens_used)
                merged_output_tokens = max(output_tokens, existing_output_tokens)
                merged_tool_calls = max(tool_calls, existing_tool_calls)
                merged_duration_ms = max(duration_ms, existing_duration_ms)
                merged_model = model or existing_model
                merged_error_type = merged_error_type or existing_error_type
                merged_error_message = merged_error_message or existing_error_message

        final_is_skeleton = incoming_is_skeleton
        if existing and existing_is_skeleton is False:
            final_is_skeleton = False
        if is_final_update:
            final_is_skeleton = False

        immutable_triggered_at = _to_iso_utc(evt.get('triggered_at'))
        if existing and existing.get('triggered_at'):
            immutable_triggered_at = _to_iso_utc(existing.get('triggered_at'))

        immutable_tool_use_id = tool_use_id or None
        if existing and existing.get('tool_use_id'):
            immutable_tool_use_id = str(existing.get('tool_use_id')).strip()[:255] or immutable_tool_use_id

        immutable_attempt_no = attempt_no
        if existing and _safe_int(existing.get('attempt_no'), 0) > 0:
            immutable_attempt_no = _safe_int(existing.get('attempt_no'), attempt_no)

        record = {
            'event_uid': event_uid,
            'machine_id': machine_id,
            'source': str(evt.get('source') or 'manual')[:50],
            'sqlite_id': sqlite_id,
            'tool_use_id': immutable_tool_use_id,
            'skill_name': skill_name,
            'session_id': session_id,
            'trigger_type': str(evt.get('trigger_type') or 'explicit')[:50],
            'triggered_at': immutable_triggered_at,
            'status': merged_status,
            'error_type': merged_error_type,
            'error_message': merged_error_message,
            'attempt_no': immutable_attempt_no,
            'arguments': evt.get('arguments') if evt.get('arguments') is not None else (existing.get('arguments') if existing else None),
            'tokens_used': merged_tokens_used,
            'output_tokens': merged_output_tokens,
            'tool_calls': merged_tool_calls,
            'duration_ms': merged_duration_ms,
            'estimated_cost_usd': _calculate_skill_estimated_cost(merged_model, merged_tokens_used, merged_output_tokens),
            'skill_version_hash': evt.get('skill_version_hash') if evt.get('skill_version_hash') is not None else (existing.get('skill_version_hash') if existing else None),
            'model': merged_model,
            'is_skeleton': final_is_skeleton,
            'synced_at': datetime.utcnow().isoformat(),
            'project_dir': str(evt.get('project_dir', '')).strip()[:255] or (str(existing.get('project_dir', '')).strip()[:255] if existing else ''),
        }

        try:
            result = db_client.table('skill_runs').upsert(record, on_conflict='event_uid').execute()
            if result.data is None:
                result = db_client.table('skill_runs').upsert(
                    record,
                    on_conflict=['machine_id', 'sqlite_id', 'session_id', 'skill_name']
                ).execute()
            if result.data is not None:
                upserted += 1
        except Exception as e:
            logger.error(f"Failed to upsert skill event: {e}", exc_info=True)
            skipped += 1
            continue

        if final_is_skeleton is False and merged_tokens_used >= 0:
            stat_date = _skill_stat_date_for_triggered_at(record['triggered_at'])
            daily_keys.add((stat_date, skill_name, machine_id))

    for stat_date, skill_name, machine_id in daily_keys:
        try:
            _upsert_skill_daily_stats(stat_date, skill_name, machine_id)
        except Exception as e:
            logger.error(f"Failed to update skill daily stats for {skill_name}: {e}", exc_info=True)

    return jsonify({'status': 'ok', 'upserted': upserted, 'skipped': skipped})

# --- Sync Functions ---
def run_full_sync_once():
    """Helper function to run a single full sync process (data collection)."""
    run_id = uuid4().hex[:12]
    sync_started_at = time.time()

    _log_sync_event(
        run_id=run_id,
        source='collector',
        category='sync',
        severity='info',
        title='Sync started',
        message='Collector full sync started.',
        details={
            'cliproxy_url': CLIPROXY_URL,
            'cliproxy_usage_url': CLIPROXY_USAGE_URL,
            'verbosity': LOG_VERBOSITY,
        }
    )

    logger.info("Fetching usage data...")
    _log_sync_event(
        run_id=run_id,
        source='collector',
        category='api',
        severity='info',
        title='Fetch usage started',
        message='Starting usage fetch from CLIProxy management API.',
    )

    data, fetch_meta = fetch_usage_data()
    if data:
        _log_sync_event(
            run_id=run_id,
            source='collector',
            category='api',
            severity='info',
            title='Fetch usage ok',
            message='Usage data fetched successfully from CLIProxy API.',
            details=fetch_meta
        )

        _log_sync_event(
            run_id=run_id,
            source='collector',
            category='db',
            severity='info',
            title='Store usage started',
            message='Starting persistence of usage snapshot to database.',
        )

        ok, store_summary = store_usage_data(data, run_id=run_id)
        if ok:
            _log_sync_event(
                run_id=run_id,
                source='collector',
                category='db',
                severity='info',
                title='Store usage ok',
                message='Usage snapshot persisted successfully.',
                details=store_summary
            )
        else:
            _log_sync_event(
                run_id=run_id,
                source='collector',
                category='db',
                severity='error',
                title='Store usage failed',
                message='Failed to store usage snapshot into database.',
                details=store_summary,
            )
    else:
        logger.warning("No data received from CLIProxy.")
        _log_sync_event(
            run_id=run_id,
            source='collector',
            category='api',
            severity='warn',
            title='Fetch usage failed',
            message='No usage data received from CLIProxy API.',
            details=fetch_meta or {'cliproxy_url': CLIPROXY_URL}
        )

    duration_ms = int((time.time() - sync_started_at) * 1000)
    _log_sync_event(
        run_id=run_id,
        source='collector',
        category='sync',
        severity='info',
        title='Sync completed',
        message='Collector full sync completed.',
        details={
            'duration_ms': duration_ms,
            'result': 'success' if data else 'partial',
        }
    )

# --- Core Logic Functions (fetch_remote_pricing, init_db, etc.) ---
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

def init_db() -> PostgreSQLClient:
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL must be set")
    return PostgreSQLClient(DATABASE_URL)

def fetch_usage_data() -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    # (Implementation from before)
    url = f"{CLIPROXY_USAGE_URL}/v0/management/usage"
    headers = {'Authorization': f'Bearer {CLIPROXY_MANAGEMENT_KEY}'} if CLIPROXY_MANAGEMENT_KEY else {}
    started = time.time()
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        raw_payload = response.json()
        payload = normalize_usage_payload(raw_payload)
        duration_ms = int((time.time() - started) * 1000)
        meta = {
            'cliproxy_url': CLIPROXY_URL,
            'cliproxy_usage_url': CLIPROXY_USAGE_URL,
            'http_status': response.status_code,
            'latency_ms': duration_ms,
            'payload_bytes': len(response.content or b''),
            'has_usage': isinstance(payload, dict) and 'usage' in payload,
            'normalized_usage_payload': payload is not raw_payload,
        }
        return payload, meta
    except requests.exceptions.RequestException as e:
        duration_ms = int((time.time() - started) * 1000)
        logger.error(f"Failed to fetch usage data: {e}")
        _log_app_event(
            source='collector',
            category='api',
            severity='error',
            title='Usage API request failed',
            message=f'Failed to fetch usage data: {e}',
            details={
                'cliproxy_url': CLIPROXY_URL,
                'cliproxy_usage_url': CLIPROXY_USAGE_URL,
                'latency_ms': duration_ms,
            }
        )
        return None, {
            'cliproxy_url': CLIPROXY_URL,
            'cliproxy_usage_url': CLIPROXY_USAGE_URL,
            'latency_ms': duration_ms,
            'error': str(e),
        }

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

def store_usage_data(data: Dict[str, Any], run_id: Optional[str] = None) -> Tuple[bool, Dict[str, Any]]:
    """Store usage data in PostgreSQL database with proper daily delta calculation."""
    if not db_client or not data or 'usage' not in data:
        return False, {'error': 'missing database client or usage payload', 'run_id': run_id}
    usage = data['usage']
    pricing = get_model_pricing()
    debug_budget = LOG_DEBUG_EVENTS_MAX_PER_SYNC
    debug_dropped = 0
    anomaly_debug_events = []

    try:
        started_at = time.time()
        db_timings_ms = {
            'snapshot_insert': 0,
            'model_usage_insert': 0,
            'snapshot_cost_update': 0,
            'daily_stats_upsert': 0,
        }

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
        last_cost_resp = db_client.table('usage_snapshots') \
            .select('cumulative_cost_usd') \
            .order('collected_at', desc=True) \
            .limit(1) \
            .execute()
        last_cost_total = float(last_cost_resp.data[0].get('cumulative_cost_usd', 0) or 0) if last_cost_resp.data else 0.0
        snapshot_data['cumulative_cost_usd'] = last_cost_total  # placeholder, updated after cost calc

        t0 = time.time()
        snapshot_result = db_client.table('usage_snapshots').insert(snapshot_data).execute()
        db_timings_ms['snapshot_insert'] = int((time.time() - t0) * 1000)
        snapshot_id = snapshot_result.data[0]['id']
        
        # Process model-level data
        model_records = []
        total_cost = 0
        for api_endpoint, api_data in usage.get('apis', {}).items():
            for model_name, model_data in api_data.get('models', {}).items():
                input_tok = sum(d.get('tokens', {}).get('input_tokens', 0) for d in model_data.get('details', []))
                output_tok = sum(d.get('tokens', {}).get('output_tokens', 0) for d in model_data.get('details', []))
                reasoning_tok = sum(d.get('tokens', {}).get('reasoning_tokens', 0) for d in model_data.get('details', []))
                cached_tok = sum(d.get('tokens', {}).get('cached_tokens', 0) for d in model_data.get('details', []))
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
                    'reasoning_tokens': reasoning_tok,
                    'cached_tokens': cached_tok,
                    'total_tokens': model_data.get('total_tokens', 0),
                    'api_endpoint': api_endpoint
                })
        
        if model_records:
            t0 = time.time()
            db_client.table('model_usage').insert(model_records).execute()
            db_timings_ms['model_usage_insert'] = int((time.time() - t0) * 1000)

        # Update snapshot cumulative cost
        cumulative_cost = last_cost_total + total_cost
        t0 = time.time()
        db_client.table('usage_snapshots').update({'cumulative_cost_usd': cumulative_cost}).eq('id', snapshot_id).execute()
        db_timings_ms['snapshot_cost_update'] = int((time.time() - t0) * 1000)

        # === Calculate daily delta stats (Incremental Approach) ===
        # Robust against restarts: Calculate delta since LAST snapshot and add to daily_stats
        today = datetime.now(APP_TIMEZONE).date()
        today_iso = today.isoformat()

        # 1. Get the previous snapshot (just before the one we just inserted)
        # We inserted the new one, so we want the one with collected_at < current collected_at
        # Or simpler: get the 2nd latest snapshot (since we just inserted the latest)
        prev_snap_resp = db_client.table('usage_snapshots') \
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
            inc_cost = cumulative_cost - float(prev_snap.get('cumulative_cost_usd', 0) or 0)

            # Detect restart (negative delta) -> Treat current value as the full increment
            if inc_requests < 0 or inc_tokens < 0:
                logger.warning(f"Restart detected! Prev Req: {prev_snap.get('total_requests')}, Curr Req: {current_requests}")
                if run_id:
                    _log_sync_event(
                        run_id=run_id,
                        source='collector',
                        category='sync',
                        severity='warn',
                        title='Restart detected',
                        message='Detected counter reset while calculating daily incremental delta.',
                        details={
                            'snapshot_id': snapshot_id,
                            'prev_total_requests': prev_snap.get('total_requests', 0),
                            'prev_total_tokens': prev_snap.get('total_tokens', 0),
                            'current_total_requests': current_requests,
                            'current_total_tokens': current_tokens,
                        }
                    )
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
        daily_stats_resp = db_client.table('daily_stats').select('*').eq('stat_date', today_iso).execute()
        existing_daily = daily_stats_resp.data[0] if daily_stats_resp.data else {
            'total_requests': 0, 'success_count': 0, 'failure_count': 0, 'total_tokens': 0, 'estimated_cost_usd': 0,
            'breakdown': {'models': {}, 'endpoints': {}}
        }

        # Initialize breakdown deltas
        breakdown_deltas = {'models': {}, 'endpoints': {}}

        if prev_snap:
            # ... (global delta calculation kept as is) ...
            # Calculate granular deltas for breakdown
            prev_usage_resp = db_client.table('model_usage').select('*').eq('snapshot_id', prev_snap['id']).execute()
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
                p_reasoning = prev.get('reasoning_tokens', 0)
                p_cached = prev.get('cached_tokens', 0)

                c_req = curr.get('request_count', 0)
                c_tok = curr.get('total_tokens', 0)
                c_cost = float(curr.get('estimated_cost_usd', 0))
                c_in = curr.get('input_tokens', 0)
                c_out = curr.get('output_tokens', 0)
                c_reasoning = curr.get('reasoning_tokens', 0)
                c_cached = curr.get('cached_tokens', 0)

                d_req = c_req - p_req
                d_tok = c_tok - p_tok
                d_cost = c_cost - p_cost
                d_in = c_in - p_in
                d_out = c_out - p_out
                d_reasoning = c_reasoning - p_reasoning
                d_cached = c_cached - p_cached

                # Granular restart detection
                if d_req < 0 or d_tok < 0:
                    if run_id:
                        _log_sync_event(
                            run_id=run_id,
                            source='collector',
                            category='sync',
                            severity='warn',
                            title='Per-model restart detected',
                            message='Detected negative per-model delta and replaced with current cumulative values.',
                            details={
                                'snapshot_id': snapshot_id,
                                'model_endpoint_key': key,
                                'delta_requests': d_req,
                                'delta_tokens': d_tok,
                                'current_requests': c_req,
                                'current_tokens': c_tok,
                            }
                        )
                    d_req = c_req
                    d_tok = c_tok
                    d_cost = c_cost
                    d_in = c_in
                    d_out = c_out
                    d_reasoning = c_reasoning
                    d_cached = c_cached

                # Sanity Check for False Starts (New Key with huge history)
                # This prevents massive spikes when a key with existing usage is first seen
                if d_cost > 10:
                    # If delta is roughly equal to Current (Cumulative), it's a False Start.
                    if abs(d_cost - c_cost) < 0.1:
                        logger.warning(f"Skipping False Start: ${d_cost:.2f} for key {key} (Snap {snapshot_id}). Removing from global stats.")
                        if run_id:
                            _log_sync_event(
                                run_id=run_id,
                                source='collector',
                                category='sync',
                                severity='warn',
                                title='False start filtered',
                                message='Large first-seen cumulative model usage was filtered from daily delta.',
                                details={
                                    'snapshot_id': snapshot_id,
                                    'model_endpoint_key': key,
                                    'delta_requests': d_req,
                                    'delta_tokens': d_tok,
                                    'delta_cost_usd': d_cost,
                                    'current_cost_usd': c_cost,
                                }
                            )
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

                if d_req > 0 or d_cost > 0 or d_cached > 0 or d_reasoning > 0:
                    parts = key.split('|')
                    model_name = parts[0]
                    endpoint = parts[1]

                    # Add to Models
                    if model_name not in breakdown_deltas['models']:
                        breakdown_deltas['models'][model_name] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0, 'cached_tokens': 0}
                    breakdown_deltas['models'][model_name]['requests'] += d_req
                    breakdown_deltas['models'][model_name]['tokens'] += d_tok
                    breakdown_deltas['models'][model_name]['cost'] += d_cost
                    breakdown_deltas['models'][model_name]['input_tokens'] += d_in
                    breakdown_deltas['models'][model_name]['output_tokens'] += d_out
                    breakdown_deltas['models'][model_name]['reasoning_tokens'] += d_reasoning
                    breakdown_deltas['models'][model_name]['cached_tokens'] += d_cached

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
                reasoning_tok = r.get('reasoning_tokens', 0)
                cached_tok = r.get('cached_tokens', 0)

                if model_name not in breakdown_deltas['models']:
                    breakdown_deltas['models'][model_name] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0, 'cached_tokens': 0}
                breakdown_deltas['models'][model_name]['requests'] += req
                breakdown_deltas['models'][model_name]['tokens'] += tok
                breakdown_deltas['models'][model_name]['cost'] += cost
                breakdown_deltas['models'][model_name]['input_tokens'] += in_tok
                breakdown_deltas['models'][model_name]['output_tokens'] += out_tok
                breakdown_deltas['models'][model_name]['reasoning_tokens'] += reasoning_tok
                breakdown_deltas['models'][model_name]['cached_tokens'] += cached_tok

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
                    if run_id:
                        _log_sync_event(
                            run_id=run_id,
                            source='collector',
                            category='sync',
                            severity='warn',
                            title='Breakdown mismatch adjusted',
                            message='Adjusted success/failure counts due to mismatch between global and breakdown deltas.',
                            details={
                                'snapshot_id': snapshot_id,
                                'ratio': ratio,
                                'original_incremental_requests': inc_requests,
                                'safe_incremental_requests': safe_inc_requests,
                            }
                        )
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
                existing_breakdown['models'][m] = {'requests': 0, 'tokens': 0, 'cost': 0.0, 'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0, 'cached_tokens': 0}
            existing = existing_breakdown['models'][m]
            existing['requests'] += data['requests']
            existing['tokens'] += data['tokens']
            existing['cost'] += data['cost']
            existing['input_tokens'] = existing.get('input_tokens', 0) + data.get('input_tokens', 0)
            existing['output_tokens'] = existing.get('output_tokens', 0) + data.get('output_tokens', 0)
            existing['reasoning_tokens'] = existing.get('reasoning_tokens', 0) + data.get('reasoning_tokens', 0)
            existing['cached_tokens'] = existing.get('cached_tokens', 0) + data.get('cached_tokens', 0)

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
        final_tokens = total_tokens_from_breakdown if total_tokens_from_breakdown > 0 else (int(existing_daily.get('total_tokens', 0) or 0) + inc_tokens)

        # For requests, we might have successful requests that aren't in model breakdown?
        # No, all requests go through models.
        final_requests = total_requests_from_breakdown if total_requests_from_breakdown > 0 else (int(existing_daily.get('total_requests', 0) or 0) + inc_requests)

        daily_data = {
            'stat_date': today_iso,
            'total_requests': final_requests,
            'success_count': int(existing_daily.get('success_count', 0) or 0) + inc_success,
            'failure_count': int(existing_daily.get('failure_count', 0) or 0) + inc_failure,
            'total_tokens': final_tokens,
            'estimated_cost_usd': final_cost,
            'breakdown': existing_breakdown # Save the updated breakdown
        }

        t0 = time.time()
        db_client.table('daily_stats').upsert(daily_data, on_conflict='stat_date').execute()
        db_timings_ms['daily_stats_upsert'] = int((time.time() - t0) * 1000)

        if run_id:
            debug_candidates = sorted(
                [
                    {
                        'model_name': model,
                        'requests': stats.get('requests', 0),
                        'tokens': stats.get('tokens', 0),
                        'cost': round(float(stats.get('cost', 0) or 0), 6),
                    }
                    for model, stats in (breakdown_deltas.get('models') or {}).items()
                ],
                key=lambda item: (item['cost'], item['tokens'], item['requests']),
                reverse=True,
            )

            for entry in debug_candidates:
                if debug_budget <= 0:
                    debug_dropped += 1
                    continue
                anomaly_debug_events.append(entry)
                debug_budget -= 1

            for entry in anomaly_debug_events:
                _log_sync_event(
                    run_id=run_id,
                    source='collector',
                    category='sync',
                    severity='debug',
                    title='Per-model delta snapshot',
                    message=f"Model delta: {entry['model_name']}",
                    details=entry,
                    is_debug_event=True,
                )

            if debug_dropped > 0:
                _log_sync_event(
                    run_id=run_id,
                    source='collector',
                    category='sync',
                    severity='debug',
                    title='Debug event cap reached',
                    message='Some debug model-delta events were dropped due to per-sync cap.',
                    details={
                        'dropped_events': debug_dropped,
                        'cap': LOG_DEBUG_EVENTS_MAX_PER_SYNC,
                    },
                    is_debug_event=True,
                )

            _log_sync_event(
                run_id=run_id,
                source='collector',
                category='sync',
                severity='info',
                title='Delta summary',
                message='Daily delta summary for current sync has been computed.',
                details={
                    'snapshot_id': snapshot_id,
                    'incremental_requests': inc_requests,
                    'incremental_success': inc_success,
                    'incremental_failure': inc_failure,
                    'incremental_tokens': inc_tokens,
                    'incremental_cost_usd': round(float(inc_cost or 0), 6),
                    'daily_total_requests': daily_data['total_requests'],
                    'daily_total_tokens': daily_data['total_tokens'],
                    'daily_total_cost_usd': round(float(daily_data['estimated_cost_usd'] or 0), 6),
                    'model_rows_inserted': len(model_records),
                    'db_timings_ms': db_timings_ms,
                    'duration_ms': int((time.time() - started_at) * 1000),
                },
            )

        logger.info(f"Stored snapshot {snapshot_id}. Incremental: {inc_requests} req. Daily Total: {daily_data['total_requests']}")
        return True, {
            'run_id': run_id,
            'snapshot_id': snapshot_id,
            'model_rows_inserted': len(model_records),
            'incremental_requests': inc_requests,
            'incremental_tokens': inc_tokens,
            'incremental_cost_usd': round(float(inc_cost or 0), 6),
            'daily_total_requests': daily_data['total_requests'],
            'daily_total_tokens': daily_data['total_tokens'],
            'daily_total_cost_usd': round(float(daily_data['estimated_cost_usd'] or 0), 6),
            'db_timings_ms': db_timings_ms,
            'duration_ms': int((time.time() - started_at) * 1000),
        }
    except Exception as e:
        logger.error(f"Failed to store usage data: {e}")
        _log_app_event(
            source='collector',
            category='db',
            severity='error',
            title='Store usage failed',
            message=f'Failed to store usage data: {e}',
            details={'error': str(e), 'run_id': run_id}
        )
        return False, {'run_id': run_id, 'error': str(e)}


def _normalize_skill_status(value: Any) -> str:
    raw = str(value or '').strip().lower()
    return 'failure' if raw in ('failure', 'error') else 'success'


def _derive_skill_event_uid(machine_id: str, session_id: str, skill_name: str, tool_use_id: str, attempt_no: int) -> str:
    key = f"{machine_id}|{session_id}|{skill_name}|{tool_use_id}|{attempt_no}"
    return hashlib.sha1(key.encode('utf-8')).hexdigest()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value or 0)
    except Exception:
        return default


def _to_iso_utc(value: Any) -> str:
    raw = str(value or '').strip()
    if not raw:
        return datetime.utcnow().isoformat()

    normalized = raw.replace('Z', '+00:00') if raw.endswith('Z') else raw
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.utcnow().isoformat()


def _calculate_skill_estimated_cost(model: Any, input_tokens: int, output_tokens: int) -> float:
    pricing = SKILL_DEFAULT_PRICING
    model_name = str(model or '').strip()
    if model_name:
        try:
            full_pricing = get_model_pricing()
            matched, _ = find_pricing_for_model(model_name, full_pricing)
            pricing = matched or SKILL_DEFAULT_PRICING
        except Exception:
            pricing = SKILL_DEFAULT_PRICING

    return round(calculate_cost(input_tokens, output_tokens, pricing), 6)


def _upsert_skill_daily_stats(stat_date: str, skill_name: str, machine_id: str) -> None:
    if not db_client:
        return
    start_utc, end_utc = _skill_day_bounds_utc(stat_date)

    rows = db_client.table('skill_runs').select(
        'tokens_used,output_tokens,duration_ms,tool_calls,status,estimated_cost_usd'
    ) \
        .eq('skill_name', skill_name) \
        .eq('machine_id', machine_id) \
        .eq('is_skeleton', False) \
        .gte('triggered_at', start_utc) \
        .lt('triggered_at', end_utc) \
        .execute().data

    if not rows:
        return

    total_tokens = sum(r.get('tokens_used', 0) or 0 for r in rows)
    total_output_tokens = sum(r.get('output_tokens', 0) or 0 for r in rows)
    total_duration_ms = sum(r.get('duration_ms', 0) or 0 for r in rows)
    total_tool_calls = sum(r.get('tool_calls', 0) or 0 for r in rows)
    total_cost_usd = round(sum(float(r.get('estimated_cost_usd', 0) or 0) for r in rows), 6)
    success_count = sum(1 for r in rows if _normalize_skill_status(r.get('status')) == 'success')
    failure_count = len(rows) - success_count

    db_client.table('skill_daily_stats').upsert({
        'stat_date': stat_date,
        'skill_name': skill_name,
        'machine_id': machine_id,
        'run_count': len(rows),
        'success_count': success_count,
        'failure_count': failure_count,
        'total_tokens': total_tokens,
        'total_output_tokens': total_output_tokens,
        'total_duration_ms': total_duration_ms,
        'total_tool_calls': total_tool_calls,
        'total_cost_usd': total_cost_usd,
        'updated_at': datetime.utcnow().isoformat(),
    }, on_conflict=['stat_date', 'skill_name', 'machine_id']).execute()

# --- Main Application ---
def main():
    """Main collector startup."""
    global db_client
    logger.info("Starting CLIProxy Usage Collector")

    # Initialize PostgreSQL
    try:
        db_client = init_db()
        logger.info("PostgreSQL client initialized.")
        db_client.run_migrations()
        deleted = _cleanup_old_app_logs()
        if deleted > 0:
            logger.info(f"Initial app logs cleanup removed {deleted} rows older than today.")
    except Exception as e:
        logger.critical(f"CRITICAL: Failed to initialize PostgreSQL: {e}", exc_info=True)
        return

    # Register the API blueprint
    flask_app.register_blueprint(api_bp)

    # Start the background scheduler
    scheduler = BackgroundScheduler(daemon=True)

    # Schedule usage data collection (every COLLECTOR_INTERVAL seconds)
    scheduler.add_job(run_full_sync_once, 'interval', seconds=COLLECTOR_INTERVAL)

    # Schedule credential usage stats sync
    scheduler.add_job(
        lambda: sync_credential_stats(
            CLIPROXY_URL,
            CLIPROXY_MANAGEMENT_KEY,
            db_client,
            app_timezone=APP_TIMEZONE,
            usage_url=CLIPROXY_USAGE_URL,
        ),
        'interval',
        seconds=CREDENTIAL_SYNC_INTERVAL,
        id='credential_stats_sync',
        next_run_time=datetime.now() + timedelta(seconds=10)  # Run 10s after startup
    )

    # Keep app logs by retention window, clear periodically
    scheduler.add_job(
        _cleanup_old_app_logs,
        'interval',
        minutes=APP_LOG_CLEANUP_INTERVAL_MINUTES,
        id='app_logs_cleanup',
        next_run_time=datetime.now() + timedelta(seconds=20)
    )

    scheduler.start()
    logger.info(f"Background sync scheduled every {COLLECTOR_INTERVAL} seconds.")
    logger.info(f"Credential stats sync scheduled every {CREDENTIAL_SYNC_INTERVAL} seconds.")
    logger.info(f"App logs cleanup scheduled every {APP_LOG_CLEANUP_INTERVAL_MINUTES} minute(s) (retention={APP_LOG_RETENTION_DAYS} day(s)).")

    # Start the Flask app using Waitress
    logger.info(f"Flask server starting on http://0.0.0.0:{TRIGGER_PORT}")
    logger.info(f"API endpoints available under /api/collector")
    serve(flask_app, host='0.0.0.0', port=TRIGGER_PORT)

if __name__ == '__main__':
    main()
