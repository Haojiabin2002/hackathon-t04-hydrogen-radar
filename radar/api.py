"""FastAPI 服务：对外提供线索/信号/作战卡/采集调度/溯源问答接口，并托管看板前端。"""
import datetime as dt
import os
import re
import signal
import subprocess
import sys
import threading
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from db import connect

# 全项目唯一版本号来源：改这里，OpenAPI、/api/stats、看板角标一起变
VERSION = "0.2.1"

app = FastAPI(title="氢能商机雷达 API", version=VERSION)
WEB = Path(__file__).parent / "web"
ROOT = Path(__file__).parent
SOURCES_PATH = ROOT / "sources.yaml"


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


def _overseas_source_keys():
    """海外源清单来自 sources.yaml 的 overseas 标记。
    数据源既然可增删，"哪些算海外"就必须跟着配置走：写死站点名的话，
    用户新加一个海外源，它的线索永远不会被标成海外，统计也数不到它。"""
    try:
        cfgs = _load_sources_file().get("sources", [])
    except (OSError, yaml.YAMLError):
        # 配置文件读不到时只影响海外徽标，不把整个看板拖下水；
        # 除这两种"文件不可用"外的异常照常抛——宽捕获会把真 bug 吞成静默退化。
        return set()
    return {c.get("key") for c in cfgs
            if isinstance(c, dict) and c.get("overseas") and c.get("key")}


@app.get("/api/leads")
def list_leads():
    conn = connect()
    rows = conn.execute(
        "SELECT l.id, l.signal_id, l.company, l.signal_type, l.power_range,"
        " l.region, l.amount, l.deadline, l.score, l.score_reason,"
        " l.matched_product, l.match_reason, l.industry,"
        " l.status, l.dup_of, l.corroboration,"
        " s.title AS signal_title, s.source AS source,"
        " s.source_url AS source_url, s.fetched_at AS fetched_at,"
        " s.published_at AS published_at, s.raw_text AS _raw,"
        " (SELECT COUNT(*) FROM cards c WHERE c.lead_id=l.id) AS has_card"
        " FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status!='duplicate'"
        " ORDER BY (l.score IS NULL), l.score DESC, l.id DESC").fetchall()
    conn.close()
    os_keys = _overseas_source_keys()
    out = []
    for r in rows_to_dicts(rows):
        raw = r.pop("_raw", "") or ""
        r["region_trace"], r["region_unsourced"] = trace_field(r.get("region", ""), raw)
        r["company_trace"], r["company_unsourced"] = trace_field(r.get("company", ""), raw)
        r["overseas"] = r.get("source") in os_keys
        # 联系方式：只认原文里逐字出现的，抽不到就是抽不到，不推断
        r["contact"] = extract_contact(raw)
        out.append(r)
    return out


# 采购语境词：启发式抽取的联系方式必须出现在这些词附近，
# 否则抓到的很可能是公告发布方（媒体、会议主办方、发文机关）自己的电话。
PROCUREMENT_CUES = ["招标", "采购", "投标", "标书", "报名", "询价", "比选",
                    "开标", "供应商", "项目联系", "商务", "技术咨询"]

# (标签, 正则, 是否为结构化官方字段)
CONTACT_PATTERNS = [
    ("邮箱", re.compile(r"\[官方采购联系邮箱\]\s*([^\s\n]+)"), True),
    ("联系人", re.compile(r"联\s*系\s*人[：:]\s*([^\s，,；;。]{2,20})"), False),
    ("电话", re.compile(r"(?:联系电话|电\s*话|Tel)[：:]\s*(\d[\d\-— ]{6,20}\d)"), False),
    ("邮箱", re.compile(r"([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"), False),
]


def extract_contact(raw_text: str):
    """从公告原文里逐字抽联系方式。抽不到返回空列表——由前端显示「公告未载」。

    死规矩：不编造联系人/电话/邮箱。这里只做正则摘取，不做补全或推断，
    每一项都能在 raw_text 里原样找到。

    同样重要的一条：**不能把发文单位自己的联系方式当成采购方的**。
    政策解读、会议通知类公告里常带媒体或主办方电话，直接放进
    「联系方式」栏，销售照着打过去就是打给了写稿的人。
    因此启发式命中必须落在采购语境附近，并附原文片段供人工核对；
    TED 的结构化官方字段本身已标明是采购联系人，不受此限。
    """
    if not raw_text:
        return []
    found, seen = [], set()
    for label, pat, official in CONTACT_PATTERNS:
        for m in pat.finditer(raw_text):
            val = m.group(1).strip(" \u3000：:，,。、（）()[]【】")
            if not val or val in seen:
                continue
            lo = max(0, m.start() - 120)
            ctx = re.sub(r"\s+", " ", raw_text[lo:m.end() + 60]).strip()
            if not official and not any(c in ctx for c in PROCUREMENT_CUES):
                continue
            seen.add(val)
            found.append({"label": label, "value": val,
                          "context": ctx, "official": official})
            if len(found) >= 4:
                return found
    return found


@app.get("/api/signals")
def list_signals():
    conn = connect()
    rows = conn.execute(
        "SELECT id, source, source_url, title, fetched_at, published_at,"
        " length(raw_text) AS text_len, substr(raw_text,1,220) AS excerpt"
        " FROM signals ORDER BY COALESCE(published_at,'') DESC, id DESC").fetchall()
    conn.close()
    out = rows_to_dicts(rows)
    os_keys = _overseas_source_keys()
    for r in out:
        r["overseas"] = r["source"] in os_keys
    return out


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
        # 只数看得见的卡：线索被归并为重复后，它的卡在界面上已不可达，
        # 再计入总数就是虚报。孤儿卡另计，不隐藏。
        "cards": q("SELECT COUNT(*) FROM cards c JOIN leads l ON l.id=c.lead_id"
                   " WHERE l.status!='duplicate'"),
        "cards_orphan": q("SELECT COUNT(*) FROM cards c JOIN leads l ON l.id=c.lead_id"
                          " WHERE l.status='duplicate'"),
        "high": q("SELECT COUNT(*) FROM leads"
                  " WHERE status='new' AND coalesce(score,0)>=80"),
    }
    os_keys = _overseas_source_keys()
    data["overseas"] = (conn.execute(
        f"SELECT COUNT(*) FROM signals WHERE source IN ({','.join('?' * len(os_keys))})",
        tuple(os_keys)).fetchone()[0] if os_keys else 0)
    conn.close()
    return data


# ---------- 数据源管理：可增可删可停用（产品化「这些网站是不是要再加再减」）----------

# 写 sources.yaml 必须串行：探测慢（要抓好几个页面），两个请求并发写会互相覆盖。
_sources_lock = threading.Lock()


def _load_sources_file():
    with open(SOURCES_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f) or {"sources": []}


def _save_sources_file(cfg):
    """先写临时文件再原子替换，避免写到一半进程被打断留下半截配置。"""
    tmp = SOURCES_PATH.with_suffix(".yaml.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False, width=100)
    tmp.replace(SOURCES_PATH)


@app.get("/api/sources")
def list_sources():
    with open(SOURCES_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    conn = connect()
    counts = {r["source"]: r["c"] for r in conn.execute(
        "SELECT source, COUNT(*) c FROM signals WHERE length(raw_text)>100"
        " GROUP BY source")}
    conn.close()
    out = []
    for s in cfg.get("sources", []):
        out.append({
            "key": s["key"], "name": s.get("name", s["key"]),
            "enabled": bool(s.get("enabled")), "kind": s.get("kind", "web"),
            "quota": s.get("quota", 0),
            "reason": (s.get("reason") or "").strip(),
            "signals": counts.get(s["key"], 0),
        })
    # 已删除源留下的历史信号：单列，不并进任何在册源的计数，
    # 否则新建一个同名源会立刻"冒领"前一个源抓到的数据。
    known = {x["key"] for x in cfg.get("sources", [])}
    orphan = {k: v for k, v in counts.items() if k not in known}
    if orphan:
        out.append({"key": "__orphan__", "name": "已删除源的历史信号",
                    "enabled": False, "kind": "-", "quota": 0,
                    "signals": sum(orphan.values()),
                    "reason": "这些信号由已删除的数据源抓取，来源链接仍可回溯，故予以保留；"
                              "它们不计入任何在册源的条数。明细：" +
                              "、".join(f"{k} {v} 条" for k, v in sorted(orphan.items()))})
    return out


class ToggleIn(BaseModel):
    enabled: bool


@app.post("/api/sources/{key}/toggle")
def toggle_source(key: str, body: ToggleIn):
    """启用/停用一个源。写回 sources.yaml，下次采集立即生效。

    必须与 create/delete 共用同一把锁并走原子替换：早先这里是裸的
    open(...,"w") 截断写且不持锁，与另一个写请求并发可以互相丢失更新，
    极端情况下采集子进程会读到被腰斩甚至空的配置文件。
    """
    with _sources_lock:
        cfg = _load_sources_file()
        hit = next((s for s in cfg.get("sources", []) if s["key"] == key), None)
        if not hit:
            raise HTTPException(status_code=404, detail=f"未知数据源 {key}")
        hit["enabled"] = body.enabled
        _save_sources_file(cfg)
    return {"key": key, "enabled": hit["enabled"]}


# ---------- 数据源的新增 / 删除 ----------
KEY_RE = re.compile(r"^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .·（）()-]{0,39}$")


class ProbeIn(BaseModel):
    url: str


@app.post("/api/sources/probe")
def probe_source_api(body: ProbeIn):
    """探测一个 URL 能否作为采集源。不调用大模型，通道断了也能加源。"""
    from crawler import probe_source
    try:
        rep = probe_source(body.url.strip(), sample_limit=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"探测失败 {type(e).__name__}: {e}")
    return rep


class SourceIn(BaseModel):
    url: str
    name: str
    reason: str
    quota: int = 15
    enabled: bool = True
    article_pattern: str = ""
    body_selectors: list[str] = []
    # 探测认出同域已有源时，前端可要求挂成该源的栏目页而不是新建站点
    attach_to: str = ""


@app.post("/api/sources")
def create_source(body: SourceIn):
    from crawler import validate_source, check_url_safe
    from urllib.parse import urlparse

    url = body.url.strip()
    ok, why = check_url_safe(url)
    if not ok:
        raise HTTPException(status_code=400, detail=why)
    if not body.reason.strip():
        raise HTTPException(status_code=400,
                            detail="必须填写选它的理由——这条要拿去对客户解释数据来源")

    with _sources_lock:
        cfg = _load_sources_file()
        items = cfg.setdefault("sources", [])

        # 情形一：挂成已有源的一个栏目页
        if body.attach_to:
            hit = next((x for x in items if x["key"] == body.attach_to), None)
            if not hit:
                raise HTTPException(status_code=404, detail=f"未知数据源 {body.attach_to}")
            from crawler import registrable_domain
            base_dom = registrable_domain(urlparse(hit.get("base", "")).hostname)
            new_dom = registrable_domain(urlparse(url).hostname)
            if base_dom and new_dom != base_dom:
                raise HTTPException(
                    status_code=400,
                    detail=(f"该网址属于 {new_dom}，与《{hit.get('name', hit['key'])}》"
                            f"的 {base_dom} 不是同一个站点。并入会让信号来源标错，"
                            f"请改为新建数据源。"))
            lists = hit.setdefault("lists", [])
            if url in lists:
                return {"action": "noop", "key": hit["key"],
                        "message": "该栏目页已在源中，未重复添加"}
            lists.append(url)
            _save_sources_file(cfg)
            return {"action": "attached", "key": hit["key"],
                    "message": f"已作为栏目页并入《{hit.get('name', hit['key'])}》",
                    "lists": lists}

        # 情形二：新建站点
        key = body.name.strip()
        if len(body.reason) > 500:
            raise HTTPException(status_code=400, detail="理由过长（限 500 字）")
        if not KEY_RE.match(key):
            raise HTTPException(status_code=400,
                                detail="名称需为 1-40 个字，且不含斜杠等特殊符号")
        if any(x["key"] == key for x in items):
            raise HTTPException(status_code=409, detail=f"已存在同名数据源「{key}」")

        # 服务端必须自己再探一次：前端传来的 article_pattern / body_selectors
        # 可以被任意伪造，若不复核就等于"没探测也能存"，
        # 存进去的源每轮白跑、界面上却显示正常。
        from crawler import probe_source
        rep_ = probe_source(url, sample_limit=2)
        if not rep_.get("usable"):
            raise HTTPException(
                status_code=400,
                detail=f"该网址不可用（{rep_.get('verdict')}）："
                       + "；".join(rep_.get("detail") or []))
        pattern = (body.article_pattern or rep_.get("article_pattern") or "").strip()
        if not pattern:
            raise HTTPException(
                status_code=400,
                detail="未能归纳出文章网址的统一形态，无法自动配置。"
                       "请改填该站文章链接的共同路径片段（例如 /news/）后重试。")
        selectors = [x for x in (body.body_selectors or rep_.get("body_selectors") or []) if x]

        parsed = urlparse(url)
        newsrc = {
            "key": key,
            "name": f"{key}（{parsed.hostname}）",
            "enabled": bool(body.enabled),
            "kind": "web",
            "quota": max(1, min(int(body.quota), 100)),
            "base": f"{parsed.scheme}://{parsed.netloc}",
            "lists": [url],
            "article_pattern": pattern,
            "body_selectors": selectors,
            "reason": body.reason.strip(),
        }
        good, problems = validate_source(newsrc)
        if not good:
            raise HTTPException(status_code=400,
                                detail="配置不合法：" + "；".join(problems))
        items.append(newsrc)
        _save_sources_file(cfg)
        return {"action": "created", "key": key, "source": newsrc}


@app.delete("/api/sources/{key}")
def delete_source(key: str, purge: bool = False):
    """删除一个源。默认保留它已抓到的历史信号——那些信号是真实抓取产物，
    删源不等于它们没发生过；只有显式 purge 才会连同信号一起清掉。"""
    with _sources_lock:
        cfg = _load_sources_file()
        items = cfg.get("sources", [])
        hit = next((x for x in items if x["key"] == key), None)
        if not hit:
            raise HTTPException(status_code=404, detail=f"未知数据源 {key}")
        cfg["sources"] = [x for x in items if x["key"] != key]
        _save_sources_file(cfg)

    conn = connect()
    n = conn.execute("SELECT COUNT(*) FROM signals WHERE source=?", (key,)).fetchone()[0]
    if purge and n:
        # 显式要求才清；连同由这些信号派生的线索与作战卡一并清掉，
        # 否则会留下 signal_id 指向空气的孤儿线索。
        conn.execute(
            "DELETE FROM cards WHERE lead_id IN (SELECT l.id FROM leads l"
            " JOIN signals s ON s.id=l.signal_id WHERE s.source=?)", (key,))
        conn.execute(
            "DELETE FROM leads WHERE signal_id IN (SELECT id FROM signals WHERE source=?)",
            (key,))
        conn.execute("DELETE FROM signals WHERE source=?", (key,))
        conn.commit()
        conn.close()
        return {"deleted": key, "signals_purged": n,
                "message": f"已删除源「{key}」，并按要求清除其 {n} 条信号及派生线索、作战卡。"}
    conn.close()
    return {"deleted": key, "signals_kept": n,
            "message": (f"已删除源「{key}」。它此前抓到的 {n} 条信号予以保留"
                        f"（真实抓取产物，来源链接仍可回溯）。" if n else
                        f"已删除源「{key}」。")}


# ---------- 自动工作模式：定时采集 + 手动触发 ----------

RUN_HOURS = (9, 14)          # 上午一次、下午一次
COLLECT_MAX_NEW = 25         # 每轮采集最多新增条数（界面触发与定时都走这个）
_collect_lock = threading.Lock()
_collect = {"running": False, "last_at": None, "last_result": None,
            "last_error": None, "next_at": None, "last_skip": None}


def _next_run_at(now=None):
    now = now or dt.datetime.now()
    for h in RUN_HOURS:
        cand = now.replace(hour=h, minute=0, second=0, microsecond=0)
        if cand > now:
            return cand
    nxt = now + dt.timedelta(days=1)
    return nxt.replace(hour=RUN_HOURS[0], minute=0, second=0, microsecond=0)


def _run_stage(cmd, timeout):
    """起一个子进程并放进独立进程组，超时时连同它拉起的孙进程一起杀掉。

    否则 pipeline 超时只杀掉 python 自己，它 subprocess 起的 claude CLI
    会变成孤儿继续跑、继续消耗订阅额度，而界面上这一轮已经算失败了。
    """
    proc = subprocess.Popen(cmd, cwd=str(ROOT), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True,
                            start_new_session=True)
    try:
        so, se = proc.communicate(timeout=timeout)
        return subprocess.CompletedProcess(cmd, proc.returncode, so, se)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            proc.kill()
        so, se = proc.communicate()
        return subprocess.CompletedProcess(cmd, -9, so or "",
                                           (se or "") + f"\n[超时 {timeout}s，已连同子进程组一并终止]")


def _do_collect(trigger):
    """跑一次采集。管线阶段依赖 LLM 通道，通道不通就只采集不研判——
    绝不因为"想让流程跑完"而产出未经模型判定的线索。"""
    with _collect_lock:
        _collect["running"] = True
    try:
        py = sys.executable
        # 单轮上限：拆掉「按库存卡死」的旧闸门后，配额是按源逐轮生效的，
        # 四个源加起来一次能拉一百多条、跑十几分钟。界面点一下就该有个头，
        # 所以这里显式限流；要全量补数据就在命令行跑 crawler.py 不带上限。
        out = _run_stage([py, "crawler.py", "--max-new", str(COLLECT_MAX_NEW)], 1800)
        lines = (out.stdout or "").strip().splitlines()
        tail = lines[-4:]
        # 逐源失败要浮到界面上。早先只把 rc 存进 last_result 却从不渲染，
        # 采集整轮挂掉在页面上看起来跟"正常完成"一模一样。
        src_errors = [l for l in lines if "配置不合法" in l or "采集异常" in l]
        added = 0
        for l in lines:
            m = re.search(r"本次新增 (\d+) 条", l)
            if m:
                added = int(m.group(1))
        result = {"trigger": trigger, "crawler_rc": out.returncode,
                  "crawler_tail": tail, "crawler_added": added,
                  "source_errors": src_errors, "pipeline": "skipped"}
        if out.returncode != 0:
            result["crawler_error"] = (out.stderr or "")[-300:] or "采集进程非零退出"

        health = _run_stage([py, "llm.py"], 180)
        if "LLM_MODE: live" in (health.stdout or ""):
            pl = _run_stage([py, "pipeline.py", "all"], 3600)
            result["pipeline"] = f"rc={pl.returncode}"
            result["pipeline_tail"] = (pl.stdout or "").strip().splitlines()[-4:]
        else:
            result["pipeline"] = "blocked：LLM 通道未登录，本轮只采集不研判"
        _collect["last_result"] = result
        _collect["last_error"] = None
    except Exception as e:
        _collect["last_error"] = f"{type(e).__name__}: {e}"
    finally:
        # running 必须第一个放开：早先它排在两条可能抛错的赋值之后，
        # 一旦时间格式化出错，采集器就永久卡在 running=True 再也点不动。
        _collect["running"] = False
        try:
            _collect["last_at"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
            _collect["next_at"] = _next_run_at().astimezone().isoformat(timespec="seconds")
        except Exception:
            pass


def _scheduler():
    """定时触发。用标准库线程，不引入任何调度中间件。

    三处曾经的坑，都在这里堵掉：
    ① 原来判 `now.minute == 0`，而循环固定 wait(60) 会相位前移，
       整点那一分钟可能被整个跳过，于是当天一次也不跑；
    ② 原来在触发前就把槽位记进 fired，若此刻正在采集，该轮直接作废且无记录；
    ③ 原来 fired 无限增长。
    现改为：按"已过触发时刻且本槽未跑过"判断，与采样时刻无关；
    正在采集则不烧槽位，下一轮醒来继续尝试；fired 只保留当天。
    """
    fired = set()
    while True:
        try:
            now = dt.datetime.now()
            fired = {k for k in fired if k[0] == now.date()}
            for h in RUN_HOURS:
                slot = (now.date(), h)
                if slot in fired or now.hour < h:
                    continue
                # 只补当天：错过太久（比如机器休眠了半天）就不追跑了，
                # 但要留痕，避免"看起来没跑过"与"其实跳过了"混为一谈
                if _collect["running"]:
                    _collect["last_skip"] = (
                        f"{now.date()} {h}:00 触发时上一轮仍在进行，本轮顺延")
                    continue
                fired.add(slot)
                threading.Thread(target=_do_collect, args=("定时",), daemon=True).start()
                break
            _collect["next_at"] = _next_run_at(now).astimezone().isoformat(timespec="seconds")
        except Exception as e:
            _collect["last_error"] = f"调度器异常：{type(e).__name__}: {e}"
        threading.Event().wait(30)


@app.on_event("startup")
def _start_scheduler():
    _collect["next_at"] = _next_run_at().astimezone().isoformat(timespec="seconds")
    threading.Thread(target=_scheduler, daemon=True).start()


@app.post("/api/collect")
def trigger_collect():
    # 检查与置位必须在同一把锁内：早先先查后起线程，两次快速点击
    # 会双双通过检查，起两个采集进程同时写同一个 SQLite。
    with _collect_lock:
        if _collect["running"]:
            return {"started": False, "reason": "上一轮采集仍在进行中"}
        _collect["running"] = True
    threading.Thread(target=_do_collect, args=("手动",), daemon=True).start()
    return {"started": True}


@app.get("/api/collect/status")
def collect_status():
    # 持锁取快照：finally 里有多条连续赋值，无锁读可能读到
    # "running=False 但 last_at 还是上上轮"这种自相矛盾的组合。
    with _collect_lock:
        snap = dict(_collect)
    return {**snap, "run_hours": list(RUN_HOURS)}


# ---------- 溯源问答：只回答"这条线索为什么出得来" ----------

BOARD_CHAT_PROMPT = """你是氢能商机雷达的看板助手。销售没有选中具体线索，是对整个看板提问。

你只能依据下面的漏斗统计与线索索引回答，**不得引入索引之外的任何信息**：
- 引用具体线索时必须写成 #线索ID（如 #13），前端会把它变成可点击的跳转；
- 涉及数量就直接给数字；涉及挑选就给出线索ID并说明依据（分数/区域/类型/行业）；
- 索引里没有的信息（如公告原文细节、联系方式）不要猜，请回答"这需要点开具体线索查看原文"；
- 回答控制在 200 字以内，中文，直接给结论，不要寒暄。

【漏斗统计】
{funnel}

【在研线索索引】（每行：#ID｜采购方｜类型｜规模｜区域｜行业｜分数｜发布月｜有无作战卡）
{listing}

【销售的问题】
{question}
"""


def _board_context(conn):
    """给看板级对话构造上下文：漏斗数字 + 在研线索紧凑索引。

    只放结构化字段，不放公告原文——原文属于线索级对话的语境；
    索引最多 200 条（按分数排），超出部分如实告知条数，不静默截断。
    """
    n_signals = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
    st = dict(conn.execute(
        "SELECT status, COUNT(*) FROM leads GROUP BY status").fetchall())
    n_cards = conn.execute(
        "SELECT COUNT(*) FROM cards c JOIN leads l ON l.id=c.lead_id"
        " AND l.status='new'").fetchone()[0]
    funnel = (f"采集信号 {n_signals} 条 → 已研判 {sum(st.values())} 条"
              f"（在研 {st.get('new', 0)}、判非商机 {st.get('rejected', 0)}、"
              f"重复归并 {st.get('duplicate', 0)}）→ 作战卡 {n_cards} 张")

    rows = conn.execute(
        "SELECT l.id, l.company, l.signal_type, l.power_range, l.region,"
        " l.industry, l.score, substr(s.published_at,1,7) AS pub,"
        " (SELECT COUNT(*) FROM cards c WHERE c.lead_id=l.id) AS has_card"
        " FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status='new' ORDER BY l.score DESC, l.id LIMIT 201").fetchall()
    clipped = len(rows) > 200
    rows = rows[:200]
    listing = "\n".join(
        f"#{r['id']}｜{r['company'] or '未提及'}｜{r['signal_type'] or '未知'}"
        f"｜{r['power_range'] or '—'}｜{r['region'] or '—'}｜{r['industry'] or '未归类'}"
        f"｜{r['score']}分｜{r['pub'] or '日期未载'}｜{'有卡' if r['has_card'] else '无卡'}"
        for r in rows)
    if clipped:
        listing += "\n（仅列出分数最高的 200 条，其余低分线索未列出）"
    return funnel, listing


CHAT_PROMPT = """你是氢能商机雷达的溯源助手。销售在看一条线索，向你提问。

你只能依据下面给出的线索档案与公告原文回答，**不得引入档案之外的任何信息**。
若问题超出档案能回答的范围，直接说"该问题超出本条线索的记录范围"，不要猜测。
回答控制在 150 字以内，中文，直接给结论与依据，不要寒暄。

【线索档案】
线索ID：{lead_id}
采购方：{company}
信号类型：{signal_type}
功率/规模：{power_range}
区域：{region}
金额/数量：{amount}
截止时间：{deadline}
评分：{score}
评分理由：{score_reason}
推荐产品：{matched_product}
推荐理由：{match_reason}
来源：{source}｜{source_url}
交叉验证：{corroboration}

【公告原文】
{raw_text}

【销售的问题】
{question}
"""


class ChatIn(BaseModel):
    lead_id: int | None = None   # 不传 = 对整个看板提问
    question: str


@app.post("/api/chat")
def chat(body: ChatIn):
    """对话面板后端。通道不通时返回 503 并说明原因——不使用任何预置应答。

    两种模式：带 lead_id 是线索级溯源问答（原文进上下文）；
    不带 lead_id 是看板级问答（漏斗统计 + 线索索引进上下文，回答须引用 #ID）。
    """
    conn = connect()
    if body.lead_id is None:
        funnel, listing = _board_context(conn)
        conn.close()
        try:
            from llm import ask, LLMUnavailable
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"LLM 模块不可用：{e}")
        prompt = BOARD_CHAT_PROMPT.format(
            funnel=funnel, listing=listing, question=body.question[:500])
        try:
            answer = ask(prompt, expect_json=False)
        except LLMUnavailable as e:
            raise HTTPException(status_code=503, detail=f"LLM 通道不可用：{e}")
        except Exception as e:
            raise HTTPException(status_code=500,
                                detail=f"模型调用失败：{type(e).__name__}: {e}")
        return {"lead_id": None, "answer": answer}

    row = conn.execute(
        "SELECT l.*, s.title AS signal_title, s.source, s.source_url, s.raw_text"
        " FROM leads l JOIN signals s ON s.id=l.signal_id WHERE l.id=?",
        (body.lead_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail=f"lead {body.lead_id} 不存在")

    try:
        from llm import ask, LLMUnavailable
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"LLM 模块不可用：{e}")

    prompt = CHAT_PROMPT.format(
        lead_id=row["id"], company=row["company"] or "未提及",
        signal_type=row["signal_type"] or "未知",
        power_range=row["power_range"] or "未提及", region=row["region"] or "未提及",
        amount=row["amount"] or "未提及", deadline=row["deadline"] or "未提及",
        score=row["score"], score_reason=row["score_reason"] or "—",
        matched_product=row["matched_product"] or "—",
        match_reason=row["match_reason"] or "—",
        source=row["source"], source_url=row["source_url"],
        corroboration=row["corroboration"] or "无",
        raw_text=(row["raw_text"] or "")[:3000], question=body.question[:500])
    try:
        answer = ask(prompt, expect_json=False)
    except LLMUnavailable as e:
        raise HTTPException(status_code=503, detail=f"LLM 通道不可用：{e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"模型调用失败：{type(e).__name__}: {e}")
    return {"lead_id": body.lead_id, "answer": answer}


# ---------- 模型通道：进页面先探测，用户自己选用哪一个 ----------
# 三条通道（Claude CLI / Codex CLI / 兼容 API）的实现与安全加固都在 llm.py 里，
# 这里只做三件事：把探测结果吐给前端、代跑实测、把用户的选择存下来。
# 存之前服务端一定会自己再测一次——和新增数据源同一个道理：
# 前端说"我测过了"不算数，不然一个伪造请求就能把通道切到攻击者的接口上，
# 而全部公告正文与 prompt 都会流过那个接口。

_llm_lock = threading.Lock()


def _guard_local(request: Request):
    """挡跨站请求伪造。

    服务只听 127.0.0.1，但浏览器里任何一个网页都能往 localhost:8000 发 POST。
    切通道是高价值目标（改成攻击者的 Base URL 就能拿到全部抓取正文），必须挡。
    做法：要求一个自定义头。浏览器发自定义头必须先过 CORS 预检，而本服务没开 CORS，
    预检就会失败——跨站请求根本到不了这里。curl / 本地前端不受影响。
    """
    if request.headers.get("x-radar-local") != "1":
        raise HTTPException(status_code=403,
                            detail="缺少本地请求标记（防跨站伪造）。请从看板界面操作。")
    origin = request.headers.get("origin")
    if origin and not re.match(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", origin):
        raise HTTPException(status_code=403, detail=f"拒绝跨站来源 {origin}")


class ChannelTestIn(BaseModel):
    channel: str
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    style: str = ""


@app.get("/api/llm/channels")
def list_channels():
    """进设置页时调这个：只看装没装、配没配，不发模型请求、不花额度。

    刻意不回传 api_key，只回 key_set 布尔值——密钥没有任何理由再离开本机一次。
    """
    try:
        from llm import scan_channels
        return scan_channels()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"通道探测失败：{type(e).__name__}: {e}")


@app.post("/api/llm/channels/test")
def test_channel_api(body: ChannelTestIn, request: Request):
    """实测一条通道：发一次真实请求；CLI 通道再跑一次子进程隔离探针。

    耗时是真的（CLI 首次含探针约 10-30 秒），因为结论必须来自真实调用。
    """
    _guard_local(request)
    try:
        from llm import test_channel, CHANNELS
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"LLM 模块不可用：{e}")
    if body.channel not in CHANNELS:
        raise HTTPException(status_code=400, detail=f"未知通道 {body.channel}")
    api_cfg = {"base_url": body.base_url.strip(), "model": body.model.strip(),
               "api_key": body.api_key, "style": body.style}
    with _llm_lock:
        return test_channel(body.channel, api_cfg)


@app.put("/api/llm/channels")
def set_channel(body: ChannelTestIn, request: Request):
    """保存用户选定的通道。服务端先自己实测一遍，测不过就不存。

    不存的理由：存了等于让整条管线切到一个没验证过的通道上，
    下一次采集会连着几十条公告一起失败，而失败原因要翻日志才看得见。
    """
    _guard_local(request)
    try:
        from llm import test_channel, load_config, save_config, CHANNELS
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"LLM 模块不可用：{e}")
    if body.channel not in CHANNELS:
        raise HTTPException(status_code=400, detail=f"未知通道 {body.channel}")

    cur = load_config()
    api_cfg = dict(cur["api"])
    if body.channel == "api":
        if body.base_url.strip():
            api_cfg["base_url"] = body.base_url.strip()
        if body.model.strip():
            api_cfg["model"] = body.model.strip()
        if body.api_key:                      # 留空表示沿用已存的 Key，不清空
            api_cfg["api_key"] = body.api_key
        if body.style:
            api_cfg["style"] = body.style

    with _llm_lock:
        res = test_channel(body.channel, api_cfg)
        if not res.get("ok"):
            raise HTTPException(
                status_code=400,
                detail=f"该通道未通过实测，未保存：{res.get('reason', '未知原因')}")
        saved = save_config({"channel": body.channel, "api": api_cfg})
    return {"saved": True, "channel": saved["channel"], "test": res}


@app.get("/api/llm/health")
def llm_health():
    try:
        from llm import health_check
        ok, detail = health_check()
    except Exception as e:
        return {"ok": False, "detail": f"{type(e).__name__}: {e}"}
    return {"ok": ok, "detail": detail}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
