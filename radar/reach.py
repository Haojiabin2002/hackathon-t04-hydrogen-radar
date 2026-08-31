"""受控触网层：agent 一切对外网络动作的唯一出口。

约束宪章（2026-08-29 负责人拍板）的机器实现，每一条都在代码里强制，agent 无权解锁：

- 只读 GET；检索走唯一白名单端点（博查），检索词是模型唯一可控的外发内容（≤80 字）；
- 抓取 URL 必须出自本任务候选池（搜索结果 / 已抓页内链 / 库内已有链接），且过域名分层；
- 每域最小间隔 1.2 秒；robots 声明不欢迎即弃；验证码即弃并记录，
  同域第二次命中生成「拉黑提案」交人审批——不自动拉黑（负责人裁定）；
- 预算：每任务搜 16 / 抓 60，全天全局抓 500 熔断；博查 1000 次总量持久账本；
- 全部触网动作写审计日志（本机配置目录 jsonl，只追加）；
- 抓到的正文只进内存缓存，对外只给 fetch_id + 预览——模型从机制上传不进
  任何将写入数据库的文本（raw_text 必须来自真实 HTTP 响应，从纪律升为物理事实）。

分层基线在仓库 domains.yaml（人工定版）；运行期人工批准的拉黑/放行写本机 overlay，
两者在 load_policy() 合并——仓库保持干净，本机状态可审计。
"""
import datetime as dt
import json
import os
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
import yaml
from bs4 import BeautifulSoup

from crawler import (UA, HEADERS, fetch as _raw_fetch, check_url_safe,
                     looks_like_challenge, registrable_domain)

POLICY_PATH = Path(__file__).parent / "domains.yaml"
CONF_DIR = Path(os.path.expanduser("~/.config/hydrogen-radar"))
SEARCH_CONF = CONF_DIR / "search.json"
OVERLAY_PATH = CONF_DIR / "domains_overlay.json"     # 人工批准的运行期增量
AUDIT_PATH = CONF_DIR / "reach_audit.jsonl"          # 全部触网动作，只追加
LEDGER_PATH = CONF_DIR / "bocha_ledger.json"         # 博查总量账本
DAILY_PATH = CONF_DIR / "reach_daily.json"           # 当日全局抓页计数
PROPOSALS_PATH = CONF_DIR / "proposals.json"         # 审批队列（新源 / 拉黑）

BOCHA_TOTAL = 1000        # 体验包总量；负责人指示省着用，账本见底即搜索停用
SEARCH_QUERY_MAX = 80     # 检索词长度上限：模型唯一可控的外发内容
PREVIEW_CHARS = 500
# freshness 同样是外发字段，只认端点文档里的枚举，不让模型自由拼串
FRESHNESS_OK = ("noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear")


class ReachError(RuntimeError):
    """一切被约束拒绝的触网动作。信息面向 agent 循环，说清被哪条规矩拦下。"""


def _now():
    return dt.datetime.now().isoformat(timespec="seconds")


def _canon(url):
    """候选池与缓存的统一写法：去锚点、去首尾空白。
    锚点不改变服务端返回的页面，同一页因 #frag 被判成「池外」纯属误伤。"""
    return (url or "").strip().split("#")[0]


def _read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path, obj):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    tmp.replace(path)


def _audit(kind, **fields):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    rec = {"ts": _now(), "kind": kind}
    rec.update(fields)
    with open(AUDIT_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


# ---------- 域名策略 ----------

def load_policy():
    """仓库基线 + 本机 overlay 合并。overlay 只可能由人工审批流程写入。"""
    with open(POLICY_PATH, encoding="utf-8") as f:
        base = yaml.safe_load(f) or {}
    ov = _read_json(OVERLAY_PATH, {})

    def norm(*groups):
        out = set()
        for g in groups:
            for e in (g or []):
                e = str(e).strip().lower().strip(".")
                if e:
                    out.add(e)
        return out

    pol = {
        "allow": norm(base.get("allow"), ov.get("allow")),
        "deny": norm(base.get("deny"), ov.get("deny")),
        "signpost": norm(base.get("signpost"), ov.get("signpost")),
        "gray_page_budget": int(base.get("gray_page_budget", 8)),
        "task_fetch_budget": int(base.get("task_fetch_budget", 60)),
        "task_search_budget": int(base.get("task_search_budget", 16)),
        "daily_fetch_cap": int(base.get("daily_fetch_cap", 500)),
        "per_domain_interval": float(base.get("per_domain_interval", 1.2)),
    }
    return pol


def classify(url, pol):
    """返回 (层级, 可注册域)。deny 优先于一切；未列入者为 gray。"""
    # 末尾的点是合法的 FQDN 写法（bad.example. 与 bad.example 是同一台主机），
    # 不归一就等于给黑名单留了一个一个字符的绕行口。
    host = (urlparse(url).hostname or "").lower().strip(".")
    dom = registrable_domain(host) or host
    def hit(entries):
        return any(dom == e or dom.endswith("." + e) or host == e or host.endswith("." + e)
                   for e in entries)
    if hit(pol["deny"]):
        return "deny", dom
    if hit(pol["signpost"]):
        return "signpost", dom
    if hit(pol["allow"]):
        return "allow", dom
    return "gray", dom


# ---------- 博查账本 / 当日计数 ----------

def bocha_remaining():
    used = int(_read_json(LEDGER_PATH, {}).get("used", 0))
    return max(0, BOCHA_TOTAL - used)


def _bocha_bump():
    led = _read_json(LEDGER_PATH, {})
    led["used"] = int(led.get("used", 0)) + 1
    led["updated"] = _now()
    _write_json(LEDGER_PATH, led)


def _daily_count():
    d = _read_json(DAILY_PATH, {})
    today = dt.date.today().isoformat()
    return int(d.get("count", 0)) if d.get("date") == today else 0


def _daily_bump():
    today = dt.date.today().isoformat()
    d = _read_json(DAILY_PATH, {})
    if d.get("date") != today:
        d = {"date": today, "count": 0}
    d["count"] = int(d.get("count", 0)) + 1
    _write_json(DAILY_PATH, d)


# ---------- 审批提案（新源 / 拉黑）----------

def propose(kind, payload):
    """写入审批队列。kind: add_source（新增常驻源）| deny_domain（拉黑确认）
    | weekly_review（每周复盘提出的优化点，见 weekly_review.py）。
    只提案不执行——批准动作由人完成，代码据批准结果落 overlay / 走源注册。"""
    items = _read_json(PROPOSALS_PATH, [])
    pid = f"{kind}-{int(time.time())}-{len(items)}"
    rec = {"id": pid, "kind": kind, "status": "pending",
           "created": _now(), "payload": payload}
    items.append(rec)
    _write_json(PROPOSALS_PATH, items)
    _audit("propose", proposal=pid, kind_of=kind, payload=payload)
    return rec


def pending_deny(domain):
    """该域是否已有待审的拉黑提案——同一个域反复堆卡只会淹没审批队列。"""
    return any(p["payload"].get("domain") == domain
               for p in list_proposals("pending") if p.get("kind") == "deny_domain")


def list_proposals(status=None):
    items = _read_json(PROPOSALS_PATH, [])
    return [i for i in items if status is None or i.get("status") == status]


def resolve_proposal(pid, approve):
    """人工裁决落库。deny_domain 批准 → 域名进 overlay.deny；
    add_source 的批准动作在源注册路径里另行执行（此处只改状态）；
    weekly_review 批准 → **只打「已采纳」标记，不碰任何文件**——
    改 knowledge.md 会直接改变之后所有线索的打分口径，偏好与记忆同理，
    那一步由人在编辑页/记忆面板亲手做（api.py 的 resolve 会给出去哪改的指路）。"""
    items = _read_json(PROPOSALS_PATH, [])
    hit = next((i for i in items if i.get("id") == pid), None)
    if not hit:
        raise ValueError(f"提案 {pid} 不存在")
    if hit["status"] != "pending":
        raise ValueError(f"提案 {pid} 已是 {hit['status']}，不重复裁决")
    hit["status"] = "approved" if approve else "rejected"
    hit["resolved"] = _now()
    if approve and hit["kind"] == "weekly_review":
        # 唯一的落地动作就是这一行标记。绝不在这里写 knowledge.md / preferences.json：
        # 「已采纳」是给人的待办，不是代码的执行许可。
        if isinstance(hit.get("payload"), dict):
            hit["payload"]["adopted_at"] = _now()
    if approve and hit["kind"] == "deny_domain":
        ov = _read_json(OVERLAY_PATH, {})
        deny = set(ov.get("deny") or [])
        deny.add(hit["payload"]["domain"])
        ov["deny"] = sorted(deny)
        _write_json(OVERLAY_PATH, ov)
    _write_json(PROPOSALS_PATH, items)
    _audit("resolve", proposal=pid, approve=approve)
    return hit


# ---------- robots ----------

_ROBOTS_CACHE = {}


def _robots_allows(url, throttle=None):
    """robots.txt 的 Disallow 即弃（君子协定，负责人拍板严格遵守）。
    取不到 robots.txt 按业界惯例视为允许。

    throttle：仅在真的要请求 robots.txt（未命中缓存）时回调一次——
    robots.txt 也是一次落到对方服务器的请求，必须一样走每域限速；
    缓存命中时不回调，免得白等 1.2 秒。
    """
    u = urlparse(url)
    key = f"{u.scheme}://{u.netloc}"          # 同主机的 http / https 分开缓存
    rp = _ROBOTS_CACHE.get(key)
    if rp is None:
        if throttle:
            throttle()
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = requests.get(f"{key}/robots.txt", headers=HEADERS, timeout=6)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:
            rp.parse([])
        _ROBOTS_CACHE[key] = rp
    return rp.can_fetch(UA, url)


# ---------- 正文抽取（通用兜底，不依赖各源选择器）----------

def _page_text(html):
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.get_text(strip=True) if soup.title else "")[:200]
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    text = " ".join(soup.get_text(" ").split())
    links = []
    for a in soup.find_all("a", href=True)[:400]:
        links.append((a.get_text(strip=True)[:80], a["href"]))
    return title, text, links


# ---------- 任务会话 ----------

class TaskSession:
    """一次调查任务的触网会话：预算、候选池、抓取缓存、挑战计数都在这里。

    候选池是防「模型凭空拼 URL」的闸：fetch 只接受池内地址。
    抓取缓存是防编造的闸：正文只在缓存里，落库方（save_evidence）凭 fetch_id
    从缓存取正文，模型只见预览。
    """

    def __init__(self, task_id, goal=""):
        self.task_id = str(task_id)
        self.goal = goal[:200]
        self.pol = load_policy()
        self.search_used = 0
        self.fetch_used = 0
        self.gray_pages = {}        # 域 -> 已用页数
        self.challenge_hits = {}    # 域 -> 确认命中人机验证的次数（本任务）
        self.fail_hits = {}         # 域 -> 原因不明的抓取失败次数（不等同于验证码）
        self.pool = set()
        self.cache = {}             # fetch_id -> {url,title,text,domain,layer}
        self._seq = 0
        self._last_hit = {}         # 域 -> 上次请求时刻
        self._seed_pool()
        _audit("task_start", task=self.task_id, goal=self.goal)

    def _seed_pool(self):
        """库内已有链接天然入池：agent 可以直接回访自家来源。"""
        try:
            from db import connect
            conn = connect()
            for r in conn.execute("SELECT source_url FROM signals"):
                u = _canon(r["source_url"])
                if u.startswith("http"):
                    self.pool.add(u)
            conn.close()
        except Exception as e:
            # 建库前也能用（比如纯搜索测试）；池为空只是更严，不是更松。
            # 但不能静默：查不到库和库是空的，排障时是两回事。
            _audit("seed_fail", task=self.task_id, error=f"{type(e).__name__}: {e}")

    # ---- 检索 ----

    def search(self, query, count=8, freshness="noLimit"):
        query = (query or "").strip()
        if not query:
            raise ReachError("检索词为空")
        if len(query) > SEARCH_QUERY_MAX:
            raise ReachError(f"检索词超过 {SEARCH_QUERY_MAX} 字上限（外发内容受限）")
        if self.search_used >= self.pol["task_search_budget"]:
            raise ReachError(f"本任务搜索预算（{self.pol['task_search_budget']} 次）已用完")
        if bocha_remaining() <= 0:
            raise ReachError("博查总量账本已见底，搜索停用（等人工续量）")
        if freshness not in FRESHNESS_OK:
            raise ReachError(f"freshness 只接受 {'/'.join(FRESHNESS_OK)}")
        try:
            count = max(1, min(int(count), 10))
        except (TypeError, ValueError):
            raise ReachError("count 必须是 1-10 的整数")
        conf = _read_json(SEARCH_CONF, {})
        if not conf.get("api_key") or not conf.get("endpoint"):
            raise ReachError("搜索服务未配置（无 key/端点则不检索，无降级路径）")
        # 记账必须在发请求之前：一旦请求出门，额度就可能已经扣掉。
        # 失败不记账 = agent 可以在同一个错误上无限重试，把 1000 次体验包烧穿。
        self.search_used += 1
        try:
            r = requests.post(conf["endpoint"],
                              headers={"Authorization": f"Bearer {conf['api_key']}",
                                       "Content-Type": "application/json"},
                              json={"query": query, "count": count,
                                    "freshness": freshness, "summary": False},
                              timeout=30)  # 首跑实测 15s 三次超两次，博查偶发 20s+ 延迟
        except Exception as e:
            _audit("search_fail", task=self.task_id, query=query,
                   error=f"{type(e).__name__}: {e}")
            raise ReachError(f"搜索端点请求失败：{type(e).__name__}")
        _bocha_bump()   # 有响应即按已消耗计：宁可多算一次，也不能把总量账本算漏
        if r.status_code != 200:
            _audit("search_fail", task=self.task_id, query=query, status=r.status_code)
            raise ReachError(f"搜索端点返回 HTTP {r.status_code}")
        try:
            payload = r.json()
        except ValueError:
            _audit("search_fail", task=self.task_id, query=query, status="non-json")
            raise ReachError("搜索端点返回的不是 JSON")
        pages = ((payload.get("data") or {}).get("webPages") or {}).get("value") or []
        results = []
        for p in pages:
            u = _canon(p.get("url") or "")
            if u.startswith("http"):
                self.pool.add(u)
                results.append({"title": (p.get("name") or "")[:120], "url": u,
                                "snippet": (p.get("snippet") or "")[:200],
                                "site": (p.get("siteName") or "")[:40],
                                "layer": classify(u, self.pol)[0]})
        _audit("search", task=self.task_id, query=query, hits=len(results),
               domains=sorted({urlparse(x["url"]).netloc for x in results}),
               bocha_left=bocha_remaining())
        return {"query": query, "results": results,
                "search_left": self.pol["task_search_budget"] - self.search_used,
                "bocha_left": bocha_remaining()}

    # ---- 抓取 ----

    def fetch(self, url):
        url = _canon(url)
        if url not in self.pool:
            raise ReachError("URL 不在本任务候选池内（只能抓：搜索结果 / 已抓页内链 / 库内已有链接）")
        if self.fetch_used >= self.pol["task_fetch_budget"]:
            raise ReachError(f"本任务抓页预算（{self.pol['task_fetch_budget']} 页）已用完")
        if _daily_count() >= self.pol["daily_fetch_cap"]:
            raise ReachError(f"全天抓页熔断（{self.pol['daily_fetch_cap']} 页）已触发，今日停抓")
        layer, dom = classify(url, self.pol)
        if layer == "deny":
            raise ReachError(f"域名 {dom} 在黑名单，拒绝")
        if layer == "gray":
            used = self.gray_pages.get(dom, 0)
            if used >= self.pol["gray_page_budget"]:
                raise ReachError(f"陌生域 {dom} 本任务额度（{self.pol['gray_page_budget']} 页）已用完")
        safe, why = check_url_safe(url)
        if not safe:
            self._dead_end(url, f"安全校验拒绝：{why}")
            raise ReachError(f"安全校验拒绝：{why}")
        if not _robots_allows(url, throttle=lambda: self._throttle(dom)):
            self._dead_end(url, "robots 声明不欢迎抓取，按君子协定放弃")
            raise ReachError(f"{dom} 的 robots 声明不欢迎抓取，按君子协定放弃")
        self._throttle(dom)

        html, ok = _raw_fetch(url)
        self.fetch_used += 1
        _daily_bump()
        if layer == "gray":
            self.gray_pages[dom] = self.gray_pages.get(dom, 0) + 1

        # looks_like_challenge 判的是「抽出的正文」，不是原始 HTML：正经页面的内联
        # 脚本里 document.cookie / appkey 一抓一大把，<noscript>请开启JavaScript</noscript>
        # 更是随处可见——拿 HTML 去判会把真公告误杀成验证页。所以先抽正文再判。
        title, text, raw_links = _page_text(html) if (ok and html) else ("", "", [])

        # crawler.fetch 只回 (html, ok)，不回失败原因：ok=False 既可能是超时/非 200，
        # 也可能是它自己拦下的 WAF 页。所以「确认是人机验证」只认一种情形——
        # 拿到了正文、而正文是反爬占位页。把网络故障也算成验证码，会伪造出一张
        # 写着「同域两次命中人机验证」的拉黑提案，那是给人看的假陈述。
        challenged = bool(text and looks_like_challenge(text))
        if not ok or challenged:
            if challenged:
                n = self.challenge_hits.get(dom, 0) + 1
                self.challenge_hits[dom] = n
                reason = "人机验证/反爬占位页，即弃不绕"
                self._dead_end(url, reason)
                if n >= 2 and not pending_deny(dom):
                    # 负责人裁定：不自动拉黑，转审批卡（同域第二次验证码）
                    propose("deny_domain", {"domain": dom, "reason":
                            f"同域两次命中人机验证（任务 {self.task_id}）",
                            "example_url": url})
            else:
                self.fail_hits[dom] = self.fail_hits.get(dom, 0) + 1
                reason = "抓取失败（非 200 / 网络异常 / 响应过大 / 被对方拦截，原因不明）"
                self._dead_end(url, reason)
            raise ReachError(f"{reason}：{url}")

        added = 0
        for _t, href in raw_links:
            absu = _canon(urljoin(url, href))
            if absu.startswith("http") and absu not in self.pool:
                self.pool.add(absu)
                added += 1
        self._seq += 1
        fid = f"{self.task_id}-{self._seq}"
        self.cache[fid] = {"url": url, "title": title, "text": text,
                           "domain": dom, "layer": layer}
        _audit("fetch", task=self.task_id, url=url, domain=dom, layer=layer,
               bytes=len(html), fetch_id=fid)
        return {"fetch_id": fid, "url": url, "title": title, "layer": layer,
                "preview": text[:PREVIEW_CHARS], "chars": len(text),
                "links_added": added,
                # 路标层只准用来发现线索，正文不得落库（save_evidence 据此拒收）
                "body_storable": layer != "signpost",
                "fetch_left": self.pol["task_fetch_budget"] - self.fetch_used}

    # ---- 记录与预算 ----

    def _throttle(self, dom):
        """每域最小间隔——安全类参数，任何对该域的请求（含 robots.txt）都要过。"""
        last = self._last_hit.get(dom)
        if last is not None:
            wait = self.pol["per_domain_interval"] - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        self._last_hit[dom] = time.monotonic()

    def _dead_end(self, url, reason):
        _audit("dead_end", task=self.task_id, url=url, reason=reason)

    def dead_end(self, url, reason):
        """agent 主动记录走不通的路（付费墙/登录墙等），沉淀为源覆盖情报。"""
        self._dead_end(url, str(reason)[:200])
        return {"logged": True}

    def budget(self):
        return {"search_used": self.search_used,
                "search_left": self.pol["task_search_budget"] - self.search_used,
                "fetch_used": self.fetch_used,
                "fetch_left": self.pol["task_fetch_budget"] - self.fetch_used,
                "gray_pages": dict(self.gray_pages),
                "gray_page_budget": self.pol["gray_page_budget"],
                "challenge_hits": dict(self.challenge_hits),
                "fail_hits": dict(self.fail_hits),
                "daily_used": _daily_count(),
                "daily_cap": self.pol["daily_fetch_cap"],
                "bocha_left": bocha_remaining()}

    def cached(self, fetch_id):
        """落库方专用：凭 fetch_id 取回缓存正文。模型永远不经手这条通道。"""
        if fetch_id not in self.cache:
            raise ReachError(f"fetch_id {fetch_id} 不存在或已过期（只在本任务内有效）")
        return self.cache[fetch_id]
