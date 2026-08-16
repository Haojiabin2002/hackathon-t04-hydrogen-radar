"""FastAPI 服务：对外提供线索/信号/作战卡接口，并托管看板前端。"""
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

from db import connect

# 全项目唯一版本号来源：改这里，OpenAPI、/api/stats、看板角标一起变
VERSION = "0.0.1"

app = FastAPI(title="氢能商机雷达 API", version=VERSION)
WEB = Path(__file__).parent / "web"


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


# 省级行政区名——模型最容易由项目名"补"出来的一类地名
PROVINCE_RE = re.compile(
    r"北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|"
    r"山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|"
    r"内蒙古|广西|西藏|宁夏|新疆|香港|澳门")


def trace_field(value: str, raw_text: str):
    """逐片段核对字段值能否在公告原文里找到，返回状态与未命中的片段。

    必须逐片段判，不能用 any()：「河南濮阳（中原油田）」里"中原油田"命中
    而"河南濮阳"未命中，整体按命中处理就会把模型推断的地名伪装成实证值——
    而这个地名正在参与区域维度打分。只要有一个实质片段无出处即标 inferred。
    """
    if not value:
        return "empty", []
    if not raw_text:
        return "unknown", []
    parts = [p for p in re.split(r"[（）()／/、,，\s]+", value) if len(p) >= 2]
    if not parts:
        return "unknown", []
    missing = [p for p in parts if p not in raw_text]
    if not missing:
        return "verified", []
    # 未命中的片段里含省级地名时最危险：它直接决定区域维度得分
    return ("inferred" if any(PROVINCE_RE.search(m) for m in missing) else "partial",
            missing)


@app.get("/api/leads")
def list_leads():
    conn = connect()
    rows = conn.execute(
        "SELECT l.id, l.signal_id, l.company, l.signal_type, l.power_range,"
        " l.region, l.amount, l.deadline, l.score, l.score_reason,"
        " l.matched_product, l.match_reason, l.status, l.dup_of, l.corroboration,"
        " s.title AS signal_title, s.source AS source,"
        " s.source_url AS source_url, s.fetched_at AS fetched_at,"
        " s.published_at AS published_at, s.raw_text AS _raw,"
        " (SELECT COUNT(*) FROM cards c WHERE c.lead_id=l.id) AS has_card"
        " FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status!='duplicate'"
        " ORDER BY (l.score IS NULL), l.score DESC, l.id DESC").fetchall()
    conn.close()
    out = []
    for r in rows_to_dicts(rows):
        raw = r.pop("_raw", "") or ""
        r["region_trace"], r["region_unsourced"] = trace_field(r.get("region", ""), raw)
        r["company_trace"], r["company_unsourced"] = trace_field(r.get("company", ""), raw)
        out.append(r)
    return out


@app.get("/api/signals")
def list_signals():
    conn = connect()
    rows = conn.execute(
        "SELECT id, source, source_url, title, fetched_at, published_at,"
        " length(raw_text) AS text_len, substr(raw_text,1,220) AS excerpt"
        " FROM signals ORDER BY COALESCE(published_at,'') DESC, id DESC").fetchall()
    conn.close()
    return rows_to_dicts(rows)


@app.get("/api/leads/{lead_id}/card", response_class=PlainTextResponse)
def get_card(lead_id: int):
    conn = connect()
    row = conn.execute(
        "SELECT content FROM cards WHERE lead_id=? ORDER BY id DESC LIMIT 1",
        (lead_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail=f"lead {lead_id} 尚无作战卡")
    return row["content"]


@app.get("/api/stats")
def stats():
    conn = connect()
    q = lambda sql: conn.execute(sql).fetchone()[0]
    data = {
        "version": VERSION,
        "signals": q("SELECT COUNT(*) FROM signals WHERE length(raw_text)>100"),
        "leads": q("SELECT COUNT(*) FROM leads WHERE status='new'"),
        "rejected": q("SELECT COUNT(*) FROM leads WHERE status='rejected'"),
        "duplicate": q("SELECT COUNT(*) FROM leads WHERE status='duplicate'"),
        # 已抓取但尚未进入研判管线的信号，账面要如实反映覆盖率
        "pending": q("SELECT COUNT(*) FROM signals s"
                     " WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.signal_id=s.id)"),
        "matched": q("SELECT COUNT(*) FROM leads"
                     " WHERE status='new' AND length(coalesce(matched_product,''))>0"),
        "cards": q("SELECT COUNT(*) FROM cards"),
        "high": q("SELECT COUNT(*) FROM leads"
                  " WHERE status='new' AND coalesce(score,0)>=80"),
    }
    conn.close()
    return data


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
