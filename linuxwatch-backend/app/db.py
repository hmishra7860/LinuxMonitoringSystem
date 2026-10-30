"""Thin PostgreSQL access layer (psycopg 3 + connection pool, plain SQL)."""
import uuid
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import settings


class J:
    """Wrap a Python dict/list to send it as a jsonb parameter."""

    def __init__(self, value):
        self.value = value


def _adapt(p):
    return Jsonb(p.value) if isinstance(p, J) else p


def _clean_value(v):
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, list):
        return [_clean_value(i) for i in v]
    return v


def _clean(row: dict) -> dict:
    return {k: _clean_value(v) for k, v in row.items()}


class Tx:
    """One database transaction. Commits when the `with db.tx()` block exits cleanly, rolls back on error."""

    def __init__(self, conn):
        self.conn = conn

    def q(self, sql: str, params=()) -> list:
        with self.conn.cursor() as cur:
            cur.execute(sql, [_adapt(p) for p in params])
            return [_clean(r) for r in cur.fetchall()] if cur.description else []

    def one(self, sql: str, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def x(self, sql: str, params=()) -> int:
        with self.conn.cursor() as cur:
            cur.execute(sql, [_adapt(p) for p in params])
            return cur.rowcount


class Database:
    def __init__(self):
        self.pool = None

    def open(self):
        self.pool = ConnectionPool(settings.database_url, min_size=1, max_size=12, kwargs={"row_factory": dict_row}, open=False)
        self.pool.open(wait=True, timeout=30)

    def close(self):
        if self.pool:
            self.pool.close()

    @contextmanager
    def tx(self):
        with self.pool.connection() as conn:
            yield Tx(conn)

    def init_schema(self):
        with open(settings.schema_path, encoding="utf-8") as f:
            sql = f.read()
        with self.pool.connection() as conn:
            conn.execute("SELECT pg_advisory_lock(847201)")  # serialise concurrent workers
            try:
                conn.execute(sql)
                conn.commit()
            finally:
                conn.execute("SELECT pg_advisory_unlock(847201)")
                conn.commit()


db = Database()
