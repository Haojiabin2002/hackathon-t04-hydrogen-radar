"""SQLite 数据层。表结构由验收脚本依赖，字段名不得修改。"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "radar.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    source_url  TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    raw_text    TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    published_at TEXT
);
CREATE TABLE IF NOT EXISTS leads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id       INTEGER NOT NULL,
    company         TEXT,
    signal_type     TEXT,
    power_range     TEXT,
    region          TEXT,
    amount          TEXT,
    deadline        TEXT,
    score           INTEGER,
    score_reason    TEXT,
    matched_product TEXT,
    match_reason    TEXT,
    status          TEXT DEFAULT 'new',
    created_at      TEXT NOT NULL,
    -- 同一标的被多家媒体报道时：重复条目的 dup_of 指向留用的那条，
    -- 留用条目的 corroboration 记下佐证来源，供销售回源核对
    dup_of          INTEGER,
    corroboration   TEXT,
    FOREIGN KEY (signal_id) REFERENCES signals(id),
    FOREIGN KEY (dup_of) REFERENCES leads(id)
);
CREATE TABLE IF NOT EXISTS cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
);
"""


# 建表语句是 IF NOT EXISTS，对已存在的旧库不会补列。
# 新增字段必须同时登记在这里，否则先建过库的人升级后仍然缺字段。
MIGRATIONS = [
    ("leads", "dup_of", "INTEGER"),
    ("leads", "corroboration", "TEXT"),
]


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def migrate(conn):
    """幂等补列：已有该列就跳过，不影响存量数据。"""
    for table, column, coltype in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
            print(f"[db] migrate: 补齐 {table}.{column}")


def init_db():
    conn = connect()
    conn.executescript(SCHEMA)
    migrate(conn)
    conn.commit()
    conn.close()
    print(f"[db] schema ready at {DB_PATH}")


if __name__ == "__main__":
    init_db()
