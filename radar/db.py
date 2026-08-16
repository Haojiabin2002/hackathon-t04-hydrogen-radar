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
    FOREIGN KEY (signal_id) REFERENCES signals(id)
);
CREATE TABLE IF NOT EXISTS cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
);
"""


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    print(f"[db] schema ready at {DB_PATH}")


if __name__ == "__main__":
    init_db()
