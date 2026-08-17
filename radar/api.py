"""FastAPI 服务：对外提供线索/信号/作战卡接口，并托管看板前端。"""
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from db import connect
from llm import (LLMUnavailable, health_check, provider_statuses, public_config,
                 save_config, test_provider)

# 全项目唯一版本号来源：改这里，OpenAPI、/api/stats、看板角标一起变
VERSION = "0.1.0"

app = FastAPI(title="氢能商机雷达 API", version=VERSION)
WEB = Path(__file__).parent / "web"


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


class LLMConfigInput(BaseModel):
    provider: str
    model: str | None = Field(default="", max_length=128)
    base_url: str | None = Field(default="", max_length=2048)
    api_key: str | None = Field(default=None, max_length=4096)
    clear_api_key: bool = False


class LLMTestInput(BaseModel):
    provider: str
    model: str | None = Field(default="", max_length=128)
    base_url: str | None = Field(default="", max_length=2048)
    api_key: str | None = Field(default=None, max_length=4096)


def require_settings_access(request: Request):
    """模型凭据属于管理员设置：默认仅本机；部署时必须配管理口令。"""
    expected = os.getenv("RADAR_SETTINGS_TOKEN", "")
    authorization = request.headers.get("authorization", "")
    bearer = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    supplied = request.headers.get("x-radar-settings-token", "") or bearer
    if expected:
        if not supplied or not secrets.compare_digest(supplied, expected):
            raise HTTPException(status_code=401, detail="模型设置口令无效")
        return

    client_host = request.client.host if request.client else ""
    host = (urlsplit("//" + request.headers.get("host", "")).hostname or "").lower()
    loopbacks = {"127.0.0.1", "::1", "localhost"}
    if client_host not in loopbacks or host not in loopbacks:
        raise HTTPException(
            status_code=403,
            detail="模型设置默认只允许本机访问；公网部署请设置 RADAR_SETTINGS_TOKEN",
        )

    # 本机端口仍可能被恶意网页跨站触发。浏览器若提供来源信息，只接受同源请求；
    # curl 等非浏览器客户端没有这些头，继续保留本机调试能力。
    fetch_site = request.headers.get("sec-fetch-site", "").lower()
    if fetch_site and fetch_site not in {"same-origin", "none"}:
        raise HTTPException(status_code=403, detail="拒绝跨站访问模型设置")

    target_scheme = request.url.scheme.lower()
    target_port = urlsplit("//" + request.headers.get("host", "")).port
    target_port = target_port or (443 if target_scheme == "https" else 80)
    for source in (request.headers.get("origin", ""), request.headers.get("referer", "")):
        if not source:
            continue
        parsed = urlsplit(source)
        source_port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
        if (parsed.scheme.lower(), (parsed.hostname or "").lower(), source_port) != (
                target_scheme, host, target_port):
            raise HTTPException(status_code=403, detail="拒绝跨站访问模型设置")


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


def llm_settings_payload():
    """把通道内部状态转换成稳定的前端契约。"""
    config = public_config()
    selected = config["provider"]
    billing = {
        "codex_cli": "Codex CLI 登录 ChatGPT 后使用 Codex 订阅额度，不走 OpenAI API Key。",
        "claude_cli": "使用 Claude CLI 当前登录账号的额度。",
        "openai_api": "OpenAI SDK 使用 API Key，按 API 平台单独计费；ChatGPT 订阅不包含 API 用量。",
        "openai_compatible": "费用与数据处理规则由所填写的兼容 API 服务商决定。",
    }
    providers = []
    for item in provider_statuses():
        provider = item["id"]
        is_api = provider in ("openai_api", "openai_compatible")
        if item["available"]:
            status, status_label = "ready", "可用"
        elif not item["installed"]:
            status, status_label = "not_installed", "未安装"
        elif not is_api and not item["authenticated"]:
            status, status_label = "needs_login", "未登录"
        elif is_api and not config["has_api_key"].get(provider):
            status, status_label = "needs_key", "需要密钥"
        else:
            status, status_label = "manual", "待补配置"
        providers.append({
            "id": provider,
            "name": item["label"],
            "status": status,
            "status_label": status_label,
            "detail": " · ".join(x for x in (item.get("version"), item.get("detail")) if x),
            "billing": billing[provider],
            "selectable": is_api or item["available"],
            "is_default": provider == selected,
            "requires_api_key": is_api,
            "supports_base_url": provider == "openai_compatible",
            "key_configured": config["has_api_key"].get(provider, False),
            "model": config["models"].get(provider, ""),
            "base_url": config["base_url"] if provider == "openai_compatible" else "",
        })
    return {"selected": selected, "providers": providers}


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


@app.get("/api/llm/providers")
def llm_providers(request: Request, response: Response):
    """扫描本机真实通道并返回脱敏配置，不执行模型推理。"""
    require_settings_access(request)
    no_store(response)
    try:
        return llm_settings_payload()
    except LLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/llm/providers/scan")
def scan_llm_providers(request: Request, response: Response):
    """显式重新检测安装和登录状态。"""
    return llm_providers(request, response)


@app.get("/api/llm/config")
def get_llm_config(request: Request, response: Response):
    require_settings_access(request)
    no_store(response)
    try:
        return public_config()
    except LLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/llm/health")
def get_llm_health(request: Request, response: Response):
    require_settings_access(request)
    no_store(response)
    try:
        ok, detail = health_check()
        config = public_config()
    except LLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    return {"ok": True, "provider": config["provider"], "detail": detail}


@app.put("/api/llm/config")
def update_llm_config(payload: LLMConfigInput, request: Request, response: Response):
    """保存当前通道；API Key 仅写入仓库外 0600 文件且绝不回传。"""
    require_settings_access(request)
    no_store(response)
    try:
        config = save_config(
            provider=payload.provider,
            model=payload.model or "",
            base_url=payload.base_url or "",
            api_key=payload.api_key,
            clear_api_key=payload.clear_api_key,
        )
        result = llm_settings_payload()
        result.update({"ok": True, "message": "默认模型通道已保存", "config": config})
        return result
    except (ValueError, LLMUnavailable) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/llm/providers/test")
def test_llm_connection(payload: LLMTestInput, request: Request, response: Response):
    """用表单中的临时配置发起一次真实请求；测试不保存密钥。"""
    require_settings_access(request)
    no_store(response)
    started = time.monotonic()
    try:
        ok, detail = test_provider(
            provider=payload.provider,
            model=payload.model or "",
            base_url=payload.base_url or "",
            api_key=payload.api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=502, detail=detail)
    return {"ok": True, "message": "连接成功", "detail": detail,
            "latency_ms": round((time.monotonic() - started) * 1000)}


@app.post("/api/llm/test", include_in_schema=False)
def test_llm_connection_compat(payload: LLMTestInput, request: Request, response: Response):
    """早期调用方的兼容别名。"""
    return test_llm_connection(payload, request, response)


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
