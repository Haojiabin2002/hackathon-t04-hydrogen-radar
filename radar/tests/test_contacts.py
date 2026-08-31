"""公开版本的联系人行为测试。

fixtures_contacts.json 使用合成脱敏样本、example.com 邮箱和示例电话。
它们只用于隔离的单元测试，不是真实公告，不进入生产采集或真实数据库。
测试覆盖联系方式抽取、排除、来源标记及内存/临时数据库操作。
运行：python tests/test_contacts.py
"""
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import contacts as C  # noqa: E402
from db import MIGRATIONS_DDL, SCHEMA  # noqa: E402

FIXTURES = json.loads((HERE / "fixtures_contacts.json").read_text(encoding="utf-8"))
BY_SIGNAL = {f["signal_id"]: f for f in FIXTURES}


def _memdb():
    """内存库，走和真库一样的建表语句。真库一律不碰。"""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# ---------------------------------------------------------------- 抽取行为
def test_loose_matches_pre_move_behavior():
    """strict=False 必须与搬迁前 api.extract_contact 的输出逐字一致。"""
    for f in FIXTURES:
        got = C._extract_contact_raw(f["raw_text"])
        assert got == f["expect_loose"], f"signal#{f['signal_id']} {f['note']}"


def test_strict_matches_expected():
    for f in FIXTURES:
        got = C.extract_contact(f["raw_text"])
        assert got == f["expect_strict"], f"signal#{f['signal_id']} {f['note']}"


def test_conference_contact_never_surfaces():
    """脱敏测试样本：「八、会议联系方式 参会/赞助/申请报告联系： 示例经理 电话：202-555-0101」

    示例经理是论坛的赞助商务，把他当采购方关键人展示，销售会打过去问电堆招标。
    一条都不许出。
    """
    f = BY_SIGNAL[21]
    raw = f["raw_text"]
    assert "示例经理" in raw and "202-555-0101" in raw, "样本本身变了，先核对 fixture"
    assert C.extract_contact(raw) == []


def test_conference_contact_blocked_by_exclusion_layer_too():
    """加固：脱敏测试正文里再塞一句真实会议通知常见的「报名」。

    「报名」是采购语境词，加上它之后第一层（采购语境判定）会放行，
    此时必须由第二层排除词把它挡住——不能靠「这篇正好没写报名」的运气。
    这段拼接文本只用于测试断言，不入库、不展示。
    """
    raw = BY_SIGNAL[21]["raw_text"].replace(
        "八、会议联系方式", "八、会议联系方式 报名截止 9 月 10 日，报名从速。")
    assert C._extract_contact_raw(raw), "构造样本没触发第一层，测不到排除层"
    assert C.extract_contact(raw) == []


def test_platform_helpdesk_and_prose_name_filtered():
    """脱敏测试样本 signal#428：示例客服热线 + 被正则当成人名的一整句正文。"""
    f = BY_SIGNAL[428]
    loose_vals = {c["value"] for c in f["expect_loose"]}
    assert "202-555-0102" in loose_vals
    assert C.extract_contact(f["raw_text"]) == []


def test_official_ted_contact_kept():
    """排除层只做减法也不能误伤：TED 的官方采购邮箱必须留住。"""
    got = C.extract_contact(BY_SIGNAL[91]["raw_text"])
    assert len(got) == 1 and got[0]["official"] is True


def test_domestic_procurement_email_kept():
    got = C.extract_contact(BY_SIGNAL[412]["raw_text"])
    assert [c["value"] for c in got] == ["buyer@example.com"]
    assert got[0]["official"] is False


def test_every_value_appears_verbatim_in_raw_text():
    """红线：抽出来的每一个值都必须能在原文里原样搜到。"""
    for f in FIXTURES:
        for c in C.extract_contact(f["raw_text"]):
            assert c["value"] in f["raw_text"], f"{c['value']} 不在原文里"


def test_empty_input():
    assert C.extract_contact("") == []
    assert C.extract_contact(None) == []


# ---------------------------------------------------------------- 落库
def _seed_lead(conn, signal_id=1):
    conn.execute("INSERT INTO signals (id, source, source_url, title, raw_text,"
                 " fetched_at) VALUES (?,?,?,?,?,?)",
                 (signal_id, "t", f"http://x/{signal_id}", "t", "body", "2026-01-01"))
    cur = conn.execute("INSERT INTO leads (signal_id, status, created_at)"
                       " VALUES (?,?,?)", (signal_id, "new", "2026-01-01"))
    return cur.lastrowid


def test_save_announcement_contacts_is_idempotent():
    conn = _memdb()
    lid = _seed_lead(conn)
    raw = BY_SIGNAL[412]["raw_text"]
    first = C.save_announcement_contacts(conn, lid, raw)
    conn.commit()
    second = C.save_announcement_contacts(conn, lid, raw)
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM contacts WHERE lead_id=?", (lid,)).fetchone()[0]
    assert first == 1 and second == 0 and n == 1
    row = conn.execute("SELECT * FROM contacts WHERE lead_id=?", (lid,)).fetchone()
    assert row["kind"] == "announcement"
    assert row["email"] == "buyer@example.com"
    assert row["name"] is None and row["phone"] is None
    assert row["evidence"] and "buyer@example.com" in row["evidence"]


def test_save_announcement_contacts_writes_nothing_for_conference():
    conn = _memdb()
    lid = _seed_lead(conn)
    assert C.save_announcement_contacts(conn, lid, BY_SIGNAL[21]["raw_text"]) == 0
    assert conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 0


def test_inferred_path_has_no_person_fields():
    conn = _memdb()
    lid = _seed_lead(conn)
    note = ("公告主体是公交公司，氢璞的客户是中标整车厂，"
            "建议从其新能源采购口切入；中标结果公示后回源核实厂名。")
    assert C.add_inferred_path(conn, lid, note) == 1
    assert C.add_inferred_path(conn, lid, note) == 0  # 幂等
    conn.commit()
    row = conn.execute("SELECT * FROM contacts WHERE kind='inferred_path'").fetchone()
    assert row["name"] is None and row["phone"] is None and row["email"] is None
    assert row["evidence"] == note
    assert row["official"] == 0


def test_list_contacts_groups_by_kind():
    conn = _memdb()
    lid = _seed_lead(conn)
    C.save_announcement_contacts(conn, lid, BY_SIGNAL[412]["raw_text"])
    C.add_inferred_path(conn, lid, "先查中标整车厂名单")
    conn.execute("INSERT INTO contacts (lead_id, kind, name, phone, org, created_at)"
                 " VALUES (?,?,?,?,?,?)",
                 (lid, "manual", "张工", "13800000000", "某某整车厂", "2026-01-01"))
    conn.commit()
    g = C.list_contacts(conn, lid)
    assert len(g["announcement"]) == 1
    assert len(g["inferred_path"]) == 1
    assert len(g["manual"]) == 1


# ---------------------------------------------------------------- 建表 / 迁移
def test_migration_creates_table_on_legacy_db():
    """老库场景：只有 signals/leads/cards，跑 migrate 后必须建出 contacts + 索引。"""
    from db import migrate
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    legacy = SCHEMA[:SCHEMA.index("CREATE TABLE IF NOT EXISTS contacts")]
    conn.executescript(legacy)
    assert not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='contacts'").fetchone()
    migrate(conn)
    assert conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='contacts'").fetchone()
    assert conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index'"
        " AND name='idx_contacts_lead'").fetchone()
    migrate(conn)  # 再跑一次不报错


def test_migrations_ddl_registered():
    """三件套第二件：新表必须登记进 MIGRATIONS_DDL，否则老库升级不出表。"""
    assert any("contacts" in d for d in MIGRATIONS_DDL)


def _main():
    fns = [(n, f) for n, f in sorted(globals().items())
           if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"  PASS {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {name}: {e}")
    print(f"[tests] {len(fns) - failed}/{len(fns)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_main())
