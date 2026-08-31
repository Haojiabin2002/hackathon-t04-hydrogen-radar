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
    -- 标的物一句话描述。一条公告（尤其招投标汇总贴）可以合法地拆出多条商机，
    -- 此时 company/title 常常相同或为空，subject 是唯一能把它们区分开的字段。
    -- 缺了它：归并阶段会把同页的不同标的误并成一条，界面也只能显示重复的标题。
    subject         TEXT,
    power_range     TEXT,
    region          TEXT,
    amount          TEXT,
    deadline        TEXT,
    score           INTEGER,
    score_reason    TEXT,
    matched_product TEXT,
    match_reason    TEXT,
    -- 所属行业：对齐氢璞样例客户信息表的字段。取值域见 knowledge.md
    -- industry_taxonomy。这是归类字段而非原文摘录，界面按「归类」呈现。
    industry        TEXT,
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

# ---------------------------------------------------------------- contacts
# 线索关键人。独立成表，不动 signals/leads/cards 三张表的任何字段。
# 一条线索可以有多个联系人，按 kind 区分来源，**界面必须分开显示，不许混为一谈**：
#
#   announcement  公告实证。只能是 raw_text 里**逐字出现**的姓名/电话/邮箱，
#                 由 contacts.py 的正则抽取写入，evidence 存原文上下文片段供回源核对。
#                 模型不参与，因此不存在编造的可能。
#   inferred_path 穿透路径。按 knowledge.md「产业链穿透」规则给出的
#                 「该找哪一方、怎么核实」，**不给名字**——
#                 name/phone/email 三列在这类记录里必须为空，
#                 evidence 里写路径说明。界面上必须标「推断」。
#   manual        人工补录。销售自己填的，对应氢璞品牌部现在的真实工作方式
#                 （名片汇总 → 人工判断真实有效 + 业务匹配）。created_at 即填写时间。
#
# 红线：任何一种 kind 都不允许由模型生成姓名/电话/邮箱。
# announcement 靠正则+原文校验保证，inferred_path 靠「工具参数里就没有姓名字段」
# 从机制上杜绝（见 tools.py 的 add_inferred_contact），manual 由人输入。
CONTACTS_DDL = """
CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id     INTEGER NOT NULL,
    -- announcement | inferred_path | manual，语义边界见上方注释
    kind        TEXT NOT NULL,
    -- 姓名/职务/电话/邮箱/所属单位。inferred_path 类这几列一律为空
    name        TEXT,
    title       TEXT,
    phone       TEXT,
    email       TEXT,
    org         TEXT,
    -- announcement：原文上下文片段（可回到 raw_text 里搜到）
    -- inferred_path：路径说明（该找哪一方、怎么核实）
    -- manual：人工备注
    evidence    TEXT,
    -- 1 表示来自公告里明确标注的官方采购联系字段（如 TED 的「官方采购联系邮箱」），
    -- 0 表示启发式命中，必须人工回源核对后才能拨打
    official    INTEGER DEFAULT 0,
    -- 抽取/填写来源说明，例如 "regex:电话" / "backfill_contacts.py" / 销售姓名
    source_note TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(lead_id);
-- 幂等去重：同一条线索、同一来源类型、同一个值只留一行。
-- 回填脚本可以反复跑而不会把库撑成重复数据。
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_dedup
    ON contacts(lead_id, kind, COALESCE(name,''), COALESCE(phone,''),
                COALESCE(email,''), COALESCE(evidence,''));
"""

SCHEMA = SCHEMA + CONTACTS_DDL


# 建表语句是 IF NOT EXISTS，对已存在的旧库不会补列。
# 新增字段必须同时登记在这里，否则先建过库的人升级后仍然缺字段。
MIGRATIONS = [
    ("leads", "dup_of", "INTEGER"),
    ("leads", "corroboration", "TEXT"),
    ("leads", "industry", "TEXT"),
    ("leads", "subject", "TEXT"),
]

# 新增**整张表**走这里：MIGRATIONS 只能补列，补不了表。
# 里面的语句必须是幂等 DDL（IF NOT EXISTS），老库升级和空库初始化都会执行一遍。
MIGRATIONS_DDL = [CONTACTS_DDL]


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def migrate(conn):
    """幂等补列 + 幂等补表：已有的跳过，不影响存量数据。"""
    for table, column, coltype in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
            print(f"[db] migrate: 补齐 {table}.{column}")
    for ddl in MIGRATIONS_DDL:
        conn.executescript(ddl)


def init_db():
    conn = connect()
    conn.executescript(SCHEMA)
    migrate(conn)
    conn.commit()
    conn.close()
    print(f"[db] schema ready at {DB_PATH}")


if __name__ == "__main__":
    init_db()
