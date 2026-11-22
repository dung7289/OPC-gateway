"""
Database module for Industrial Gateway.
Handles SQLite connection and schema initialization using aiosqlite.
"""

import aiosqlite
import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

if getattr(sys, "frozen", False):
    DB_PATH = Path(sys.executable).parent / "gateway.db"
else:
    DB_PATH = Path(__file__).parent.parent / "gateway.db"

CREATE_CONNECTIONS_TABLE = """
CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    protocol    TEXT    NOT NULL,
    host        TEXT,
    port        INTEGER,
    config_json TEXT    DEFAULT '{}',
    enabled     INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now'))
);
"""

CREATE_TAGS_TABLE = """
CREATE TABLE IF NOT EXISTS tags (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id  INTEGER NOT NULL,
    name           TEXT    NOT NULL,
    address        TEXT    NOT NULL,
    data_type      TEXT    NOT NULL DEFAULT 'float32',
    scan_rate_ms   INTEGER NOT NULL DEFAULT 100,
    enabled        INTEGER DEFAULT 1,
    description    TEXT    DEFAULT '',
    tag_group      TEXT    DEFAULT '',
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    UNIQUE(connection_id, tag_group, name)
);
"""

CREATE_TAG_GROUPS_TABLE = """
CREATE TABLE IF NOT EXISTS tag_groups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT DEFAULT '',
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    UNIQUE(connection_id, name)
);
"""

CREATE_EVENT_LOGS_TABLE = """
CREATE TABLE IF NOT EXISTS event_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    level      TEXT NOT NULL DEFAULT 'INFO',
    source     TEXT NOT NULL DEFAULT 'system',
    message    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
"""

# Data Logger: historical samples (ts = unix epoch seconds, UTC)
CREATE_TAG_HISTORY_TABLE = """
CREATE TABLE IF NOT EXISTS tag_history (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id  INTEGER NOT NULL,
    ts      REAL    NOT NULL,
    value   REAL,
    quality TEXT    DEFAULT 'Good'
);
"""
CREATE_TAG_HISTORY_INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_tag_history_tag_ts ON tag_history (tag_id, ts);"
)

# Columns added after the first release (applied to existing databases via ALTER TABLE).
# (column_name, ddl_fragment)
TAG_EXTRA_COLUMNS = [
    ("access",       "TEXT    NOT NULL DEFAULT 'rw'"),   # 'rw' = Read/Write, 'ro' = Read Only
    ("unit",         "TEXT    DEFAULT ''"),              # engineering unit (bar, m3/h, Hz ...)
    ("scale_type",   "TEXT    NOT NULL DEFAULT 'none'"), # none | linear | factor
    ("raw_min",      "REAL    DEFAULT 0"),
    ("raw_max",      "REAL    DEFAULT 100"),
    ("eng_min",      "REAL    DEFAULT 0"),
    ("eng_max",      "REAL    DEFAULT 100"),
    ("scale_factor", "REAL    DEFAULT 1"),
    ("scale_offset", "REAL    DEFAULT 0"),
    ("scale_clamp",  "INTEGER DEFAULT 0"),
    ("log_enabled",  "INTEGER DEFAULT 0"),              # Data Logger on/off per tag
]


async def _migrate_tags_table(db) -> None:
    """Add any missing optional columns to the tags table (safe to run on every start)."""
    async with db.execute("PRAGMA table_info(tags)") as cur:
        existing = {row[1] for row in await cur.fetchall()}
    for col, ddl in TAG_EXTRA_COLUMNS:
        if col not in existing:
            await db.execute(f"ALTER TABLE tags ADD COLUMN {col} {ddl}")


async def init_db() -> None:
    """Initialize the SQLite database and create tables if they do not exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute("PRAGMA busy_timeout=5000;")
        await db.execute("PRAGMA foreign_keys=ON;")
        await db.execute(CREATE_CONNECTIONS_TABLE)
        await db.execute(CREATE_TAGS_TABLE)
        await db.execute(CREATE_TAG_GROUPS_TABLE)
        await db.execute(CREATE_EVENT_LOGS_TABLE)
        await db.execute(CREATE_TAG_HISTORY_TABLE)
        await db.execute(CREATE_TAG_HISTORY_INDEX)
        await _migrate_tags_table(db)
        await db.commit()


@asynccontextmanager
async def get_db():
    """Async context manager that yields an aiosqlite connection with row_factory set."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA busy_timeout=5000;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
        yield db
