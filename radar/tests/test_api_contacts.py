"""公开版本的联系人行为测试。

fixtures_contacts.json 使用合成脱敏样本、example.com 邮箱和示例电话。
它们只用于隔离的单元测试，不是真实公告，不进入生产采集或真实数据库。
测试覆盖联系方式抽取、排除、来源标记及内存/临时数据库操作。
运行：python tests/test_api_contacts.py
"""
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import db  # noqa: E402

# 先把库指到临时文件，再 import api —— api 模块导入时不建连接，但把顺序摆正
# 可以杜绝以后有人在模块级加一句 connect() 就把真库拖进测试。
_TMP = tempfile.TemporaryDirectory()
db.DB_PATH = Path(_TMP.name) / "test_radar.db"

import contacts as C  # noqa: E402
import api  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

api.STATE_DIR = str(Path(_TMP.name) / "state")   # 忽略标记不落到用户真实配置目录

FIXTURES = {f["signal_id"]: f
            for f in json.loads((HERE / "fixtures_contacts.json").read_text("utf-8"))}

LOCAL = {"X-Radar-Local": "1"}      # _guard_local 要的本地请求标记

# 三条线索，各自试一种场景：
#   1  signal#91  TED 官方采购邮箱 → 由数据侧代码落库，走「读表」路径
#   2  signal#412 海南比选公告邮箱 → 故意不落库，走「实时兜底」路径
#   3  signal#243 座谈会新闻稿    → 原文里压根没有联系方式
LEAD_STORED, LEAD_LIVE, LEAD_EMPTY = 1, 2, 3


def _build():
    """建库 + 塞样本。联系人一律由数据侧的 contacts.py 写入，不手搓 INSERT。"""
    conn = db.connect()
    conn.executescript(db.SCHEMA)
    for lead_id, sid in ((LEAD_STORED, 91), (LEAD_LIVE, 412), (LEAD_EMPTY, 243)):
        f = FIXTURES[sid]
        conn.execute("INSERT INTO signals (id, source, source_url, title, raw_text,"
                     " fetched_at, published_at) VALUES (?,?,?,?,?,?,?)",
                     (sid, "fixture", f"https://example.invalid/{sid}",
                      f["note"][:40], f["raw_text"], "2026-08-01", "2026-07-20"))
        conn.execute("INSERT INTO leads (id, signal_id, company, subject, signal_type,"
                     " region, score, score_reason, matched_product, match_reason,"
                     " status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'new',?)",
                     (lead_id, sid, "测试采购方", f"标的{lead_id}", "招标",
                      "河南濮阳", 85, "样本", "HP-100", "样本", "2026-08-01"))
    conn.execute("INSERT INTO cards (lead_id, content, created_at)"
                 " VALUES (?,?,?)", (LEAD_STORED, "时机/推荐配置/切入话术/下一步", "2026-08-01"))
    # 公告实证：走数据侧的落库函数，和 pipeline 用的是同一条路径
    n = C.save_announcement_contacts(conn, LEAD_STORED,
                                     FIXTURES[91]["raw_text"], source_note="test")
    assert n == 1, f"样本变了：signal#91 应落 1 条，实际 {n}"
    C.add_inferred_path(conn, LEAD_STORED,
                        "公告主体是公交公司，氢璞的客户是中标整车厂，建议从其新能源采购口切入",
                        source_note="test")
    conn.commit()
    conn.close()


_build()
client = TestClient(api.app)


def _contacts(lead_id):
    r = client.get(f"/api/leads/{lead_id}/contacts")
    assert r.status_code == 200, r.text
    return r.json()


def _db_count():
    conn = db.connect()
    try:
        return conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
    finally:
        conn.close()


# ---------------------------------------------------------------- 读
def test_grouped_by_kind_with_evidence_and_source_mark():
    d = _contacts(LEAD_STORED)
    assert set(d) >= {"announcement", "inferred_path", "manual", "counts", "total"}
    ann = d["announcement"]
    assert len(ann) == 1 and ann[0]["email"], ann
    # 每条都要带出处：evidence 原文片段 + 是否官方字段 + 是否已落库
    assert ann[0]["evidence"] and ann[0]["official"] is True
    assert ann[0]["persisted"] is True and ann[0]["editable"] is False
    # evidence 必须是能回到公告原文里搜到的片段（空白折叠后逐字命中）
    assert ann[0]["evidence"] in " ".join(FIXTURES[91]["raw_text"].split())
    path = d["inferred_path"]
    assert len(path) == 1 and path[0]["evidence"]
    # 死规矩：穿透路径不许有姓名/电话/邮箱
    assert path[0]["name"] is None and path[0]["phone"] is None and path[0]["email"] is None
    assert d["counts"] == {"announcement": 1, "inferred_path": 1, "manual": 0}
    assert d["announcement_live"] is False


def test_live_fallback_marks_itself_and_never_writes_back():
    before = _db_count()
    d = _contacts(LEAD_LIVE)
    assert d["announcement_live"] is True
    assert len(d["announcement"]) == 1
    c = d["announcement"][0]
    assert c["persisted"] is False and c["id"] is None and c["editable"] is False
    assert c["email"] and c["source_note"].startswith("live:")
    # 兜底只是换了个读取时机，绝不落库——落库是数据侧的职责
    assert _db_count() == before


def test_no_contact_in_announcement_stays_empty():
    d = _contacts(LEAD_EMPTY)
    assert d["announcement"] == [] and d["total"] == 0


def test_list_carries_counts_only_not_details():
    rows = client.get("/api/leads").json()
    by_id = {r["id"]: r for r in rows}
    stored = by_id[LEAD_STORED]
    assert stored["contacts_count"] == 2
    assert stored["contacts_kinds"] == {"announcement": 1, "inferred_path": 1, "manual": 0}
    # 既有的 contact 字段结构一个键都没变
    assert stored["contact"][0].keys() == {"label", "value", "context", "official"}
    assert stored["contact_live"] is False
    assert by_id[LEAD_LIVE]["contact_live"] is True
    # 列表不许把三类明细塞进来
    for key in ("announcement", "inferred_path", "manual", "contacts"):
        assert key not in stored


def test_detail_aggregates_everything():
    d = client.get(f"/api/leads/{LEAD_STORED}").json()
    assert set(d) == {"lead", "trace", "card", "contacts", "corroboration", "signal"}
    assert d["lead"]["id"] == LEAD_STORED
    assert d["card"]["content"].startswith("时机")
    assert d["contacts"]["counts"]["announcement"] == 1
    assert d["signal"]["source_url"].endswith("/91")
    assert d["signal"]["text_len"] == len(FIXTURES[91]["raw_text"])
    fields = {t["field"]: t for t in d["trace"]}
    # 「河南濮阳」不在这篇原文里 —— 模型推断的地名不许伪装成实证值
    assert fields["region"]["status"] == "inferred"
    assert "河南濮阳" in fields["region"]["unsourced"]


def test_detail_404_on_unknown_lead():
    assert client.get("/api/leads/99999").status_code == 404
    assert client.get("/api/leads/99999/contacts").status_code == 404


# ---------------------------------------------------------------- 写：人工补录
def test_manual_requires_local_header():
    r = client.post(f"/api/leads/{LEAD_STORED}/contacts", json={"name": "王工"})
    assert r.status_code == 403


def test_manual_post_404_on_unknown_lead():
    r = client.post("/api/leads/99999/contacts", json={"name": "王工"}, headers=LOCAL)
    assert r.status_code == 404


def test_manual_validation():
    bad = [
        ({}, "全空"),
        ({"name": "王" * 60}, "姓名超长"),
        ({"email": "not-an-email"}, "邮箱格式"),
        ({"phone": "转接请找王工"}, "电话含中文"),
        ({"phone": "12"}, "电话数字太少"),
    ]
    for payload, why in bad:
        r = client.post(f"/api/leads/{LEAD_STORED}/contacts", json=payload, headers=LOCAL)
        assert r.status_code == 400, f"{why} 应当被挡下：{r.status_code} {r.text}"


def test_manual_crud_roundtrip():
    r = client.post(f"/api/leads/{LEAD_STORED}/contacts", headers=LOCAL, json={
        "name": "王工", "title": "设备科长", "phone": "010-8888 6666",
        "email": "wang@example.com", "org": "某公交集团",
        "evidence": "展会名片，2026-08-20 当面确认在跟这个项目",
        "source_note": "示例维护者"})
    assert r.status_code == 200, r.text
    c = r.json()
    cid = c["id"]
    assert c["kind"] == "manual" and c["editable"] is True and c["persisted"] is True
    assert c["created_at"] and c["updated_at"] is None      # created_at 即填写时间

    # 同一条线索完全相同的补录再来一次 → 撞唯一索引
    dup = client.post(f"/api/leads/{LEAD_STORED}/contacts", headers=LOCAL, json={
        "name": "王工", "title": "设备科长", "phone": "010-8888 6666",
        "email": "wang@example.com", "org": "某公交集团",
        "evidence": "展会名片，2026-08-20 当面确认在跟这个项目",
        "source_note": "示例维护者"})
    assert dup.status_code == 409, dup.text

    up = client.put(f"/api/contacts/{cid}", headers=LOCAL,
                    json={"name": "王工", "title": "副总工", "phone": "13800138000",
                          "evidence": "职务已更正"})
    assert up.status_code == 200, up.text
    assert up.json()["title"] == "副总工" and up.json()["updated_at"]
    assert up.json()["email"] is None      # 整条覆盖：没填就是清空，不猜

    assert client.put(f"/api/contacts/{cid}", json={"name": "王工"}).status_code == 403
    assert client.delete(f"/api/contacts/{cid}").status_code == 403

    d = client.delete(f"/api/contacts/{cid}", headers=LOCAL)
    assert d.status_code == 200 and d.json()["deleted"] == cid
    assert client.delete(f"/api/contacts/{cid}", headers=LOCAL).status_code == 404
    assert _contacts(LEAD_STORED)["counts"]["manual"] == 0


# ---------------------------------------------------------------- 写：不可篡改
def _stored_ann_id():
    return _contacts(LEAD_STORED)["announcement"][0]["id"]


def test_announcement_cannot_be_edited_or_deleted():
    cid = _stored_ann_id()
    for r in (client.put(f"/api/contacts/{cid}", headers=LOCAL, json={"name": "李工"}),
              client.delete(f"/api/contacts/{cid}", headers=LOCAL)):
        assert r.status_code == 409, r.text
        assert "ignore" in r.json()["detail"]      # 明确指路到「标忽略」
    # 原始记录一个字没动
    conn = db.connect()
    row = conn.execute("SELECT name, phone, email, evidence FROM contacts WHERE id=?",
                       (cid,)).fetchone()
    conn.close()
    assert row["email"] and row["evidence"] in FIXTURES[91]["raw_text"].replace("\n", " ")


def test_inferred_path_cannot_be_edited_either():
    path_id = _contacts(LEAD_STORED)["inferred_path"][0]["id"]
    assert client.put(f"/api/contacts/{path_id}", headers=LOCAL,
                      json={"name": "张经理"}).status_code == 409
    assert client.delete(f"/api/contacts/{path_id}", headers=LOCAL).status_code == 409


def test_ignore_hides_without_touching_the_row():
    cid = _stored_ann_id()
    before = _db_count()
    assert client.post(f"/api/contacts/{cid}/ignore",
                       json={"reason": "x"}).status_code == 403
    assert client.post(f"/api/contacts/{cid}/ignore", headers=LOCAL,
                       json={"reason": "  "}).status_code == 400   # 必须写理由

    r = client.post(f"/api/contacts/{cid}/ignore", headers=LOCAL,
                    json={"reason": "这是发文单位自己的邮箱，不是采购方"})
    assert r.status_code == 200 and r.json()["ignored"] is True
    assert r.json()["ignore_reason"].startswith("这是发文单位")

    d = _contacts(LEAD_STORED)
    assert d["announcement"][0]["ignored"] is True          # 记录还在，可回溯
    assert d["counts"]["announcement"] == 0                 # 但不计入角标
    assert d["announcement_live"] is False                  # 也不许因此重新实时抽一遍
    lead = next(x for x in client.get("/api/leads").json() if x["id"] == LEAD_STORED)
    assert lead["contact"] == [] and lead["contacts_count"] == 1
    assert _db_count() == before                            # contacts 表分毫未动

    assert client.delete(f"/api/contacts/{cid}/ignore",
                         headers=LOCAL).status_code == 200
    assert _contacts(LEAD_STORED)["counts"]["announcement"] == 1
    assert client.delete(f"/api/contacts/{cid}/ignore",
                         headers=LOCAL).status_code == 404


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
