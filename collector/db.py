"""
PostgreSQL database client that mimics the Supabase Python client interface.

Provides table().select/insert/update/upsert() with method chaining,
matching the Supabase SDK pattern used throughout the collector.
Uses psycopg2 with a ThreadedConnectionPool for thread safety.
"""

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger(__name__)

# Tables with JSONB columns that need psycopg2.extras.Json wrapping on write
JSONB_COLUMNS: Dict[str, set] = {
    'usage_snapshots': {'raw_data'},
    'daily_stats': {'breakdown'},
    'credential_usage_summary': {'credentials', 'api_keys'},
    'credential_daily_stats': {'credentials', 'api_keys'},
    'credential_hourly_stats': {'api_keys'},
    'app_logs': {'details'},
}


class QueryResult:
    """Mimics the Supabase APIResponse with a .data attribute."""

    def __init__(self, data):
        self.data = data


class QueryBuilder:
    """
    Fluent query builder that translates Supabase-style calls to psycopg2 SQL.

    Usage:
        client.table('daily_stats').select('*').eq('stat_date', today).execute()
        client.table('usage_snapshots').insert({...}).execute()
        client.table('daily_stats').upsert({...}, on_conflict='stat_date').execute()
    """

    def __init__(self, pool: psycopg2.pool.ThreadedConnectionPool, table_name: str):
        self._pool = pool
        self._table = table_name
        self._operation: Optional[str] = None
        self._cols = '*'
        self._data: Optional[Union[Dict, List[Dict]]] = None
        self._conditions: List[tuple] = []  # (col, op, val)
        self._order_col: Optional[str] = None
        self._order_dir = 'ASC'
        self._limit_n: Optional[int] = None
        self._is_single = False
        self._on_conflict: Optional[str] = None

    # ── Operation builders ──────────────────────────────────────────────────

    def select(self, cols: str = '*') -> 'QueryBuilder':
        self._operation = 'select'
        self._cols = cols
        return self

    def insert(self, data: Union[Dict, List[Dict]]) -> 'QueryBuilder':
        self._operation = 'insert'
        self._data = data
        return self

    def update(self, data: Dict) -> 'QueryBuilder':
        self._operation = 'update'
        self._data = data
        return self

    def upsert(self, data: Dict, on_conflict: Optional[str] = None) -> 'QueryBuilder':
        self._operation = 'upsert'
        self._data = data
        self._on_conflict = on_conflict
        return self

    # ── Filter / modifier builders ──────────────────────────────────────────

    def eq(self, col: str, val: Any) -> 'QueryBuilder':
        self._conditions.append((col, '=', val))
        return self

    def gte(self, col: str, val: Any) -> 'QueryBuilder':
        self._conditions.append((col, '>=', val))
        return self

    def lt(self, col: str, val: Any) -> 'QueryBuilder':
        self._conditions.append((col, '<', val))
        return self

    def in_(self, col: str, vals: List) -> 'QueryBuilder':
        """Filter where col IN vals. Uses psycopg2 ANY(%s) pattern."""
        self._conditions.append((col, 'ANY', vals))
        return self

    def order(self, col: str, desc: bool = False, ascending: bool = True) -> 'QueryBuilder':
        self._order_col = col
        self._order_dir = 'DESC' if (desc or not ascending) else 'ASC'
        return self

    def limit(self, n: int) -> 'QueryBuilder':
        self._limit_n = n
        return self

    def single(self) -> 'QueryBuilder':
        """Return a single row as dict instead of list. data=None if not found."""
        self._is_single = True
        return self

    # ── Execution ───────────────────────────────────────────────────────────

    def execute(self) -> QueryResult:
        conn = self._pool.getconn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if self._operation == 'select':
                    result = self._exec_select(cur)
                elif self._operation == 'insert':
                    result = self._exec_insert(cur)
                elif self._operation == 'update':
                    result = self._exec_update(cur)
                elif self._operation == 'upsert':
                    result = self._exec_upsert(cur)
                else:
                    raise ValueError(f"No operation set. Call select/insert/update/upsert first.")
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    # ── Internal SQL builders ───────────────────────────────────────────────

    def _wrap_jsonb(self, col: str, val: Any) -> Any:
        """Wrap Python dict/list as psycopg2.extras.Json for JSONB columns."""
        if col in JSONB_COLUMNS.get(self._table, set()):
            if val is not None and not isinstance(val, psycopg2.extras.Json):
                return psycopg2.extras.Json(val)
        return val

    def _build_where(self):
        """Build WHERE clause fragments and params list."""
        parts = []
        params = []
        for col, op, val in self._conditions:
            if op == 'ANY':
                # psycopg2 idiom for IN: col = ANY(%s) with a list
                parts.append(f'"{col}" = ANY(%s)')
                params.append(list(val))
            else:
                parts.append(f'"{col}" {op} %s')
                params.append(val)
        return parts, params

    def _exec_select(self, cur) -> QueryResult:
        where_parts, params = self._build_where()
        sql = f'SELECT {self._cols} FROM "{self._table}"'
        if where_parts:
            sql += ' WHERE ' + ' AND '.join(where_parts)
        if self._order_col:
            sql += f' ORDER BY "{self._order_col}" {self._order_dir}'
        if self._limit_n is not None:
            sql += f' LIMIT {int(self._limit_n)}'

        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]

        if self._is_single:
            return QueryResult(data=rows[0] if rows else None)
        return QueryResult(data=rows)

    def _exec_insert(self, cur) -> QueryResult:
        """INSERT ... RETURNING * — always returns list for API consistency."""
        records = self._data if isinstance(self._data, list) else [self._data]
        if not records:
            return QueryResult(data=[])

        cols = list(records[0].keys())
        col_names = ', '.join(f'"{c}"' for c in cols)
        placeholders = ', '.join(['%s'] * len(cols))
        sql = f'INSERT INTO "{self._table}" ({col_names}) VALUES ({placeholders}) RETURNING *'

        inserted = []
        for record in records:
            vals = [self._wrap_jsonb(c, record.get(c)) for c in cols]
            cur.execute(sql, vals)
            row = cur.fetchone()
            if row:
                inserted.append(dict(row))

        return QueryResult(data=inserted)

    def _exec_update(self, cur) -> QueryResult:
        cols = list(self._data.keys())
        set_parts = ', '.join(f'"{c}" = %s' for c in cols)
        vals = [self._wrap_jsonb(c, self._data[c]) for c in cols]

        where_parts, where_params = self._build_where()
        sql = f'UPDATE "{self._table}" SET {set_parts}'
        if where_parts:
            sql += ' WHERE ' + ' AND '.join(where_parts)
        sql += ' RETURNING *'

        cur.execute(sql, vals + where_params)
        rows = [dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows)

    def _exec_upsert(self, cur) -> QueryResult:
        cols = list(self._data.keys())
        col_names = ', '.join(f'"{c}"' for c in cols)
        placeholders = ', '.join(['%s'] * len(cols))
        vals = [self._wrap_jsonb(c, self._data[c]) for c in cols]

        sql = f'INSERT INTO "{self._table}" ({col_names}) VALUES ({placeholders})'

        if self._on_conflict:
            raw_conflict = self._on_conflict
            conflict_cols = []

            if isinstance(raw_conflict, (list, tuple)):
                conflict_cols = [str(c).strip().strip('"') for c in raw_conflict if str(c).strip()]
            else:
                raw_conflict = str(raw_conflict).strip()
                if raw_conflict.startswith('(') and raw_conflict.endswith(')'):
                    inner = raw_conflict[1:-1]
                    conflict_cols = [c.strip().strip('"') for c in inner.split(',') if c.strip()]
                elif ',' in raw_conflict:
                    conflict_cols = [c.strip().strip('"') for c in raw_conflict.split(',') if c.strip()]
                elif raw_conflict:
                    conflict_cols = [raw_conflict.strip().strip('"')]

            conflict_target = None
            if conflict_cols:
                conflict_target = ', '.join(f'"{c}"' for c in conflict_cols)

            if conflict_target:
                update_cols = [c for c in cols if c not in conflict_cols]
                if update_cols:
                    updates = ', '.join(f'"{c}" = EXCLUDED."{c}"' for c in update_cols)
                    sql += f' ON CONFLICT ({conflict_target}) DO UPDATE SET {updates}'
                else:
                    sql += f' ON CONFLICT ({conflict_target}) DO NOTHING'

        sql += ' RETURNING *'
        cur.execute(sql, vals)
        row = cur.fetchone()
        return QueryResult(data=dict(row) if row else None)


class PostgreSQLClient:
    """
    PostgreSQL client mimicking the Supabase Python client interface.

    Drop-in replacement for `supabase.create_client(url, key)`.
    Only requires a PostgreSQL connection string (DATABASE_URL).
    """

    def __init__(self, database_url: str, min_conn: int = 1, max_conn: int = 10):
        psycopg2.extras.register_uuid()
        self._pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=min_conn,
            maxconn=max_conn,
            dsn=database_url,
        )
        logger.info("PostgreSQL connection pool initialized (min=%d, max=%d)", min_conn, max_conn)

    def table(self, name: str) -> QueryBuilder:
        return QueryBuilder(self._pool, name)

    def run_migrations(self, migrations_dir: Optional[str] = None) -> None:
        """
        Apply pending SQL migration files from migrations_dir (default: ./migrations/).
        Tracks applied migrations in the `schema_migrations` table.
        Each .sql file is applied exactly once, in filename order.
        """
        if migrations_dir is None:
            migrations_dir = Path(__file__).parent / 'migrations'
        else:
            migrations_dir = Path(migrations_dir)

        conn = self._pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        filename TEXT PRIMARY KEY,
                        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
                conn.commit()

                sql_files = sorted(
                    sql_file
                    for sql_file in migrations_dir.glob('*.sql')
                    if not sql_file.name.startswith('.')
                )
                if not sql_files:
                    logger.info("No migration files found in %s", migrations_dir)
                    return

                for sql_file in sql_files:
                    cur.execute("SELECT 1 FROM schema_migrations WHERE filename = %s", (sql_file.name,))
                    if cur.fetchone():
                        continue

                    logger.info("Applying migration: %s", sql_file.name)
                    sql = sql_file.read_text(encoding='utf-8')
                    cur.execute(sql)
                    cur.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (sql_file.name,))
                    conn.commit()
                    logger.info("Migration applied: %s", sql_file.name)

        except Exception as e:
            conn.rollback()
            logger.error("Migration failed: %s", e)
            raise
        finally:
            self._pool.putconn(conn)

    def close(self):
        self._pool.closeall()
        logger.info("PostgreSQL connection pool closed")
