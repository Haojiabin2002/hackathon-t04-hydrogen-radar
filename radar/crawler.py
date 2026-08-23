"""信号监听层：从氢能行业垂直站与欧盟招标库抓取真实招标/中标/项目公告。

死规矩：raw_text 必须来自真实 HTTP 响应，不得手工粘贴或编造。
不绕过任何人机验证（WAF/验证码）——遇到即跳过该源并记录。

信号源不写死在本文件里——全部读 sources.yaml，可增可删可停用，改完下次采集即生效。
会上定的产品能力之一是"这些网站是不是要再加再减"，所以源必须是配置而非代码常量。
停用的源同样保留在配置里并写明停用理由（多为人机验证，按死规矩不绕过）。
"""
import ipaddress
import re
import socket
import time
import datetime as dt
from collections import Counter
from urllib.parse import urljoin, urlparse
from pathlib import Path

import requests
import yaml
from bs4 import BeautifulSoup

from db import connect, init_db

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
HEADERS = {"User-Agent": UA}
TIMEOUT = 30
SLEEP = 1.2  # 控频，避免给源站造成压力

# 氢能商机关键词——只做粗筛，真正的商机判断交给 LLM（任务2）。
# 必须中英并列：早先只有中文词，任何英文源经 collect_links 都会静默归零
# （TED 能出数据只因为它走 API 不走 collect_links）。匹配时统一转小写。
KEYWORDS = [
    "氢", "燃料电池", "电解槽", "加氢", "制氢", "电堆", "甲醇", "绿氨",
    "hydrogen", "fuel cell", "fuel-cell", "electrolyser", "electrolyzer",
    "electrolysis", "refuelling", "refueling", "h2",
]


def hit_keyword(text):
    low = (text or "").lower()
    return any(k in low for k in KEYWORDS)

# 商机类标题特征——优先抓这些（招标/中标/采购/签约/订单是最强商机信号）
BIZ_MARKERS = ["招标", "中标", "采购", "签约", "订单", "交付", "投运", "开标", "成交", "台", "辆"]

WAF_MARKERS = ["安全验证", "CF_APP_WAF", "快速验证", "请开启JavaScript"]

# 正文层面的挑战页特征：WAF 会返回一个体积不小、但正文只有一段 JS 配置的页面。
# 早先只在 fetch() 里按「页面 < 8000 字节」判拦截，北极星的文章页 15885 字节、
# 抽出正文 358 字全是 CF_APP_WAF 的 token——照样过了 100 字入库门槛，
# 等于把人机验证页当成真实公告存进 signals，直接违反「不绕过验证」这条死规矩。
BODY_CHALLENGE_MARKERS = [
    "CF_APP_WAF", "appkey", "traceid", "sceneId", "requestInfo",
    "安全验证", "快速验证", "请开启JavaScript", "验证码",
    "window.location.href", "document.cookie", "_setAcCookie",
]
# 强标记：正常公告正文绝无可能出现，命中即判定为反爬占位页
STRONG_CHALLENGE_MARKERS = ["CF_APP_WAF", "_setAcCookie", "请开启JavaScript"]


def looks_like_challenge(text):
    """判断抽出的正文是不是人机验证/反爬占位，而非真实公告。

    早先只在「正文<1200字 且 命中>=2个标记」时判真，缺口有两个：
    ① 挑战页把整段 JS 配置塞进来时正文可以有好几千字；
    ② 只出现一个标记（如仅 CF_APP_WAF）就漏判。
    现改为三条任一即判：强标记出现、标记密度高、或短正文命中任一标记。
    宁可误杀一条也不能把验证页当公告入库——那是这个项目的死规矩。
    """
    if not text:
        return False
    hits = [m for m in BODY_CHALLENGE_MARKERS if m in text]
    if not hits:
        return False
    # ① 强标记：只有反爬脚本才会出现，真实公告不会
    if any(m in text for m in STRONG_CHALLENGE_MARKERS):
        return True
    # ② 短正文 + 任一标记
    if len(text) <= 1200:
        return True
    # ③ 长正文但标记扎堆，且正文里几乎没有中文句读（说明是脚本不是文章）
    if len(hits) >= 3 and text.count("。") + text.count("；") < 3:
        return True
    return False

SOURCES_PATH = Path(__file__).parent / "sources.yaml"

# TED 查询语法陷阱（实测）：FT~("a" OR "b") 被 TED 解析器当成"同时包含"处理——
# hydrogen 单词命中 9158 条，写成 FT~("hydrogen" OR "fuel cell") 反而只剩 333 条。
# 而显式 OR（FT~("a") OR FT~("b")）虽是真 OR，却把"买药顺带提到氢"的公告全带进来。
# 因此配置里用显式 AND 的多组高精度查询求并集：精度靠 AND，召回靠多组。
TED_API = "https://api.ted.europa.eu/v3/notices/search"
TED_SORT = " SORT BY publication-date DESC"
TED_FIELDS = ["publication-number", "publication-date", "title-proc", "description-proc",
              "buyer-name", "buyer-country", "organisation-email-buyer"]
TED_DETAIL = "https://ted.europa.eu/en/notice/-/detail/{pn}"


def load_sources(only_enabled=True):
    """读 sources.yaml。文件缺失或格式错时直接抛错——不静默回退到硬编码源，
    否则界面上把某个源关掉了、爬虫还在偷偷抓，账就对不上了。

    sources.yaml 必须随仓库提交：它是采集层的唯一配置来源，
    缺了它整条链路无法从零重建（CLAUDE.md：库里的一切都要能由仓库代码重建）。
    """
    if not SOURCES_PATH.exists():
        raise FileNotFoundError(
            f"缺少采集源配置 {SOURCES_PATH}。\n"
            f"这个文件必须随仓库提交——它是 crawler.py 的唯一配置来源。\n"
            f"若是刚 clone 下来遇到本错误，说明上游漏提交了 radar/sources.yaml。")
    with open(SOURCES_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    items = data.get("sources") or []
    if not items:
        raise ValueError(f"{SOURCES_PATH} 未配置任何源")
    return [s for s in items if s.get("enabled")] if only_enabled else items


def build_lists(cfg):
    """列表页 = 固定 lists + 可选分页展开。"""
    lists = list(cfg.get("lists") or [])
    pg = cfg.get("paginate")
    if pg:
        lo, hi = pg.get("pages", [2, 2])
        # 闭区间：配置里 pages: [2, 12] 指第 2 到第 12 页，range(2,12) 会漏掉第 12 页
        lists += [pg["template"].format(p=p) for p in range(lo, hi + 1)]
    return lists


class SourceConfigError(ValueError):
    """源配置本身不合法（缺字段、正则或选择器写错）。保存前与运行前都要挡。"""


def validate_source(cfg):
    """校验一个源配置能否被采集器使用。返回 (ok, 问题列表)。

    保存前调用可以挡住坏配置进文件；运行前调用可以让坏配置只跳过自己，
    而不是抛异常把整轮采集（连同排在后面的好源）一起带走。
    """
    problems = []
    for f in ("key", "kind"):
        if not cfg.get(f):
            problems.append(f"缺少必填字段 {f}")
    kind = cfg.get("kind")
    if kind == "web":
        for f in ("base", "lists", "article_pattern"):
            if not cfg.get(f):
                problems.append(f"web 源缺少必填字段 {f}")
        if cfg.get("lists") is not None and not isinstance(cfg.get("lists"), list):
            problems.append("lists 必须是列表")
        elif isinstance(cfg.get("lists"), list) and not all(
                isinstance(x, str) and x.startswith(("http://", "https://"))
                for x in cfg["lists"]):
            problems.append("lists 里每一项都必须是 http(s) 网址")
        if cfg.get("body_selectors") is not None and not isinstance(
                cfg.get("body_selectors"), list):
            problems.append("body_selectors 必须是列表")
        pg = cfg.get("paginate")
        if pg is not None:
            if not isinstance(pg, dict) or "template" not in pg:
                problems.append("paginate 必须是含 template 的对象")
            else:
                pages = pg.get("pages")
                if (not isinstance(pages, (list, tuple)) or len(pages) != 2
                        or not all(isinstance(x, int) for x in pages)
                        or pages[0] > pages[1]):
                    problems.append("paginate.pages 必须是 [起始页, 结束页] 两个整数")
        pat = cfg.get("article_pattern")
        if pat:
            if len(pat) > 200:
                problems.append("article_pattern 过长（>200 字符）")
            elif re.search(r"(\([^)]*[+*]\)[+*])|(\[[^\]]*\][+*]){3,}", pat):
                # 嵌套量词是灾难性回溯的典型形态，存进配置会让每轮采集永久卡死
                problems.append("article_pattern 含嵌套量词，可能导致正则回溯爆炸，请简化")
            else:
                try:
                    re.compile(pat)
                except re.error as e:
                    problems.append(f"article_pattern 不是合法正则：{e}")
        for sel in (cfg.get("body_selectors") or []):
            try:
                BeautifulSoup("<div></div>", "lxml").select(sel)
            except Exception as e:
                problems.append(f"body_selectors 中 {sel!r} 不是合法 CSS 选择器：{e}")
    elif kind == "ted_api":
        qs = cfg.get("queries")
        if not qs:
            problems.append("ted_api 源缺少 queries")
        elif not isinstance(qs, list) or not all(
                isinstance(q, dict) and q.get("q") and q.get("label") for q in qs):
            problems.append("queries 必须是含 label 与 q 字段的对象列表")
    else:
        problems.append(f"未知源类型 {kind!r}")
    return (not problems), problems


MAX_BYTES = 8 * 1024 * 1024      # 单页响应体上限，防内存放大
MAX_REDIRECTS = 5


def fetch(url):
    """返回 (html, ok)；命中人机验证返回 ok=False，绝不尝试绕过。

    重定向必须逐跳复检：requests 默认自动跟随，而入口只校验过用户给的
    那一个 URL，任何合法外网地址都能 302 跳进内网。这里改为手动跟随，
    每一跳都重新过 check_url_safe。
    """
    seen = 0
    cur = url
    while True:
        safe, why = check_url_safe(cur)
        if not safe:
            print(f"  [skip] 拒绝访问 {cur} -> {why}")
            return "", False
        try:
            r = requests.get(cur, headers=HEADERS, timeout=(10, TIMEOUT),
                             allow_redirects=False, stream=True)
        except Exception as e:
            print(f"  [warn] 请求失败 {cur} -> {type(e).__name__}")
            return "", False
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("Location") or ""
            r.close()
            seen += 1
            if not loc or seen > MAX_REDIRECTS:
                print(f"  [warn] 重定向过多或缺 Location {cur}")
                return "", False
            cur = urljoin(cur, loc)
            continue
        break
    if r.status_code != 200:
        print(f"  [warn] HTTP {r.status_code} {cur}")
        r.close()
        return "", False
    body = b""
    for chunk in r.iter_content(65536):
        body += chunk
        if len(body) > MAX_BYTES:
            print(f"  [warn] 响应体超过 {MAX_BYTES} 字节，放弃 {cur}")
            r.close()
            return "", False
    r._content = body
    r._content_consumed = True
    r.encoding = r.apparent_encoding or "utf-8"
    html = r.text
    if any(m in html for m in WAF_MARKERS) and len(html) < 8000:
        print(f"  [skip] 命中人机验证，按规矩不绕过：{url}")
        return "", False
    return html, True


# 两站的发布时间写法不同：氢启未来「发布时间: 」/ 国际氢能网「日期：」
PUB_RE = re.compile(r"(?:发布时间|日期)[:：]\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)")


def clean_text(soup):
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    for sel in ["div.nav", "div.uhead", "div.foot", "div.links"]:
        for tag in soup.select(sel):
            tag.decompose()
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text)


def _pick_container(soup, selectors):
    """在候选选择器里挑正文最长的那个节点，避开同名空容器。

    国际氢能网首页模板里有多个 div.content，第一个是空的——
    只取 select_one 会拿到 0 字正文，必须按文本长度择优。
    """
    best_text = ""
    for sel in selectors:
        for node in soup.select(sel):
            t = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
            if len(t) > len(best_text):
                best_text = t
    return best_text


def extract_body(html, selectors=("div.conts",)):
    """抽正文、标题与公告发布时间。

    正文优先取文章容器；取不到才回退到"整页去样板 + 锚点切割"，
    避免把免责声明、相关文章、友情链接算进正文长度。
    """
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else ""

    # 发布时间要在切正文之前抠，否则会被锚点切割丢掉
    m = PUB_RE.search(soup.get_text(" ", strip=True))
    published = m.group(1).strip() if m else ""

    text = _pick_container(soup, selectors)
    if not text:
        text = clean_text(soup)
        for anchor in ["[ 导读 ]", "导读", "发布时间:"]:
            idx = text.find(anchor)
            if idx > 0:
                text = text[idx:]
                break
    return title, text[:6000], published


def collect_links(lists, base, accept, min_len=8):
    """从多个列表页汇总文章链接。accept 判定 href 是否为文章页。"""
    found = {}
    for lurl in lists:
        html, ok = fetch(lurl)
        if not ok:
            continue
        soup = BeautifulSoup(html, "lxml")
        for a in soup.find_all("a", href=True):
            txt = a.get_text(strip=True)
            href = a["href"]
            if not accept(href) or len(txt) < min_len:
                continue
            if not hit_keyword(txt):
                continue
            # 必须与 probe_source 同用 urljoin：早先这里是 base+href 字符串拼接，
            # 遇到 "news/1.html" 这类不带前导斜杠的相对链接会拼出错误 URL，
            # 于是探测说"可用"、真采集却一条也抓不到。
            found[urljoin(lurl, href)] = txt
        print(f"  [list] {lurl} -> 累计候选 {len(found)}")
        time.sleep(SLEEP)
    # 商机类标题排前面：招标/中标/签约类的信息密度远高于会展与综述
    return dict(sorted(found.items(),
                       key=lambda kv: -sum(m in kv[1] for m in BIZ_MARKERS)))


def save_signal(conn, source, url, title, body, published):
    conn.execute(
        "INSERT INTO signals (source, source_url, title, raw_text, fetched_at, published_at)"
        " VALUES (?,?,?,?,?,?)",
        (source, url, title, body,
         dt.datetime.now().astimezone().isoformat(timespec="seconds"), published))
    conn.commit()


def crawl_site(conn, source, lists, base, accept, selectors, budget):
    """抓一个网页型信号源，返回新增条数。budget 为本源最多新增几条。"""
    if budget <= 0:
        return 0
    print(f"[{source}] 开始收集链接")
    links = collect_links(lists, base, accept)
    print(f"[{source}] 候选文章 {len(links)} 条，预算 {budget} 条")
    saved = 0
    for url, title in links.items():
        if saved >= budget:
            break
        if conn.execute("SELECT 1 FROM signals WHERE source_url=?", (url,)).fetchone():
            continue
        html, ok = fetch(url)
        time.sleep(SLEEP)
        if not ok:
            continue
        _, body, published = extract_body(html, selectors)
        if looks_like_challenge(body):
            print(f"  [skip] 正文为人机验证占位，按规矩不入库：{title[:24]}")
            continue
        if len(body) <= 100:
            print(f"  [skip] 正文过短({len(body)}字) {title[:24]}")
            continue
        save_signal(conn, source, url, title, body, published)
        saved += 1
        print(f"  [ok] {saved:2d}. {title[:34]} ({len(body)}字)")
    print(f"[{source}] 新增 {saved} 条")
    return saved


def _ted_flat(val):
    """把 TED 的多语字段 {"eng": ["..."]} 摊平成字符串，优先英文。"""
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        return " ".join(_ted_flat(v) for v in val if v)
    if isinstance(val, dict):
        for key in ("eng", "ENG"):
            if val.get(key):
                return _ted_flat(val[key])
        return _ted_flat(next(iter(val.values()), ""))
    return str(val)


def crawl_ted(conn, cfg, budget):
    """抓 TED 欧盟采购公告。raw_text 由真实 API 响应字段拼装。

    多组查询求并集；同一公告可能被多组命中，按 publication-number 去重。
    """
    if budget <= 0:
        return 0
    key = cfg["key"]
    per_query = cfg.get("per_query", 25)
    print(f"[{key}] 检索中，预算 {budget} 条")
    pool, seen = [], set()
    for item in cfg.get("queries", []):
        label, q = item["label"], item["q"]
        try:
            r = requests.post(TED_API,
                              json={"query": q + TED_SORT, "limit": per_query,
                                    "fields": TED_FIELDS},
                              headers={**HEADERS, "Content-Type": "application/json"},
                              timeout=TIMEOUT)
        except Exception as e:
            print(f"  [warn] {key}[{label}] 请求失败 -> {type(e).__name__}")
            continue
        if r.status_code != 200:
            print(f"  [warn] {key}[{label}] HTTP {r.status_code}: {r.text[:120]}")
            continue
        data = r.json()
        fresh = 0
        for n in data.get("notices", []):
            pn = n.get("publication-number")
            if not pn or pn in seen:
                continue
            seen.add(pn)
            pool.append(n)
            fresh += 1
        print(f"  [ted] {label}: 命中 {data.get('totalNoticeCount')} 条，本组新增候选 {fresh}")
        time.sleep(SLEEP)

    # 并集按发布日期倒序，优先入库最新公告
    pool.sort(key=lambda n: _ted_flat(n.get("publication-date")), reverse=True)
    print(f"  [ted] 候选并集 {len(pool)} 条")

    saved = 0
    for n in pool:
        if saved >= budget:
            break
        pn = n.get("publication-number")
        url = TED_DETAIL.format(pn=pn)
        if conn.execute("SELECT 1 FROM signals WHERE source_url=?", (url,)).fetchone():
            continue

        title = _ted_flat(n.get("title-proc")).strip()
        desc = _ted_flat(n.get("description-proc")).strip()
        buyer = _ted_flat(n.get("buyer-name")).strip()
        country = _ted_flat(n.get("buyer-country")).strip()
        email = _ted_flat(n.get("organisation-email-buyer")).strip()
        published = _ted_flat(n.get("publication-date"))[:10]

        # 逐字段带标签落文，字段值全部原样保留，便于 trace_field 逐字核对
        body = "\n".join(filter(None, [
            f"[TED 公告编号] {pn}",
            f"[采购方] {buyer}" if buyer else "",
            f"[采购方国别] {country}" if country else "",
            f"[发布日期] {published}" if published else "",
            f"[标的名称] {title}" if title else "",
            f"[采购内容] {desc}" if desc else "",
            f"[官方采购联系邮箱] {email}" if email else "",
        ]))
        if len(body) <= 100:
            print(f"  [skip] TED {pn} 字段过少({len(body)}字)")
            continue
        save_signal(conn, key, url, title or f"TED {pn}", body, published)
        saved += 1
        print(f"  [ok] {saved:2d}. [{country}] {title[:40]} ({len(body)}字)")
    print(f"[{key}] 新增 {saved} 条")
    return saved


# ---------- 源探测：给一个 URL，判断它能不能当采集源 ----------
# 全程复用上面采集时用的同一批函数（fetch / hit_keyword / extract_body），
# 保证「探测说找到 N 条」与「真采集能抓到 N 条」是同一个口径。
# 死规矩：探测不调用任何大模型——通道断了也必须能加源。

PRIVATE_HOST_RE = re.compile(
    r"^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|"
    r"172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)", re.I)

# 常见正文容器，按命中文本长度择优；猜不中会回退整页并被标记为低质量
CANDIDATE_SELECTORS = [
    "div.conts", "div.conTextBox", "div.article", "div.article-content",
    "div.content", "div.artCon", "div.detail", "div.news-content",
    "div.entry-content", "div.post-content", "article", "div.TRS_Editor",
]


# 二级域名后缀（.com.cn / .gov.cn 这类），判定主域名时要多取一段
SECOND_LEVEL = {"com", "net", "org", "gov", "edu", "ac", "co"}


def registrable_domain(host):
    """取可注册主域名。列表页与文章页常分居不同子域——
    北极星的列表在 qn.bjx.com.cn、文章在 news.bjx.com.cn，
    若按主机名严格比对会把这类正常站点误判成"零候选文章"。

    IP 地址必须原样返回：按点切最后两段会把 192.168.1.1 变成 "1.1"，
    于是 192.168.1.1 与 10.0.1.1 会被判成同一个"域名"。
    """
    if not host:
        return ""
    h = host.lower().strip("[]")
    try:
        ipaddress.ip_address(h)
        return h
    except ValueError:
        pass
    parts = h.lstrip(".").split(".")
    if len(parts) <= 2:
        return ".".join(parts)
    if parts[-2] in SECOND_LEVEL and len(parts) >= 3:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


# 198.18.0.0/15 是 RFC2544 基准测试段，真实内网服务不会用它；
# 而带代理/VPN 的运行环境常把**外网**域名映射到这一段。若照 is_private 一刀切，
# 会把 h2weilai / TED 这些正经源全部拦死——过度封锁比不封锁更糟。
BENCHMARK_NET = ipaddress.ip_network("198.18.0.0/15")
# 运营商级 NAT，Python 的 is_private 不覆盖，但确实是内网
CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")


def _ip_is_forbidden(ip):
    """只拦真正会被 SSRF 利用的地址段，不做无差别封锁。"""
    if ip.version == 6 and ip.ipv4_mapped is not None:
        return _ip_is_forbidden(ip.ipv4_mapped)
    if ip.version == 4:
        if ip in BENCHMARK_NET:
            return False
        if ip in CGNAT_NET:
            return True
    return (ip.is_loopback or ip.is_link_local or ip.is_unspecified
            or ip.is_multicast or ip.is_reserved or ip.is_private)


def _parse_literal_ip(host):
    """解析字面量 IP，兼容十进制 / 十六进制 / 八进制等非常规写法。

    ipaddress 只认点分十进制，而 2130706433、0x7f000001、0177.0.0.1
    都会被 socket 当成 127.0.0.1 使用——必须自己归一化，否则等于没拦。
    """
    h = host.strip("[]")
    try:
        return ipaddress.ip_address(h)
    except ValueError:
        pass
    try:                                   # 纯十进制 / 十六进制整数形式
        val = int(h, 16) if h.lower().startswith("0x") else int(h, 10)
        if 0 <= val <= 0xFFFFFFFF:
            return ipaddress.ip_address(val)
    except ValueError:
        pass
    parts = h.split(".")                    # 含前导零的八进制点分形式
    if len(parts) == 4:
        try:
            nums = [int(x, 8) if (x.startswith("0") and len(x) > 1) else int(x, 10)
                    for x in parts]
            if all(0 <= n <= 255 for n in nums):
                return ipaddress.ip_address(".".join(str(n) for n in nums))
        except ValueError:
            pass
    return None


def check_url_safe(url):
    """只允许 http/https，且不指向本机与内网——防止探测接口变成 SSRF 取回代理。

    必须真解析 IP 而不是比字符串前缀：2130706433、0x7f000001、0、
    [::ffff:127.0.0.1] 都是 127.0.0.1 的合法写法，前缀正则一个也拦不住。
    主机名还要过一次 DNS，否则攻击者自建一条指向内网的 A 记录即可绕过。
    """
    try:
        u = urlparse(url)
    except Exception:
        return False, "URL 无法解析"
    if u.scheme not in ("http", "https"):
        return False, f"只支持 http/https，收到 {u.scheme or '(空)'}"
    host = (u.hostname or "").strip()
    if not host:
        return False, "URL 缺少主机名"

    lit = _parse_literal_ip(host)
    if lit is not None:
        if _ip_is_forbidden(lit):
            return False, f"拒绝访问本机/内网地址 {host}"
        return True, ""

    try:                                  # 域名：解析出的每个地址都要过关
        infos = socket.getaddrinfo(host, None)
    except Exception as e:
        return False, f"域名解析失败 {host}（{type(e).__name__}）"
    for info in infos:
        addr = info[4][0].split("%")[0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if _ip_is_forbidden(ip):
            return False, f"域名 {host} 解析到内网地址 {addr}，拒绝访问"
    return True, ""


def _guess_article_pattern(article_paths, list_path=""):
    """归纳文章 URL 的形态。

    关键是要**排除列表页自己**：氢启未来的文章是 /cms/index/shows/...，
    列表页是 /cms/index/lists/...，若只取最常见前缀会得到 "/cms/"——
    那样列表页会被当成文章一起抓。所以优先找「文章路径里有、列表页路径里没有」
    的那个路径段。
    """
    segs = [p.strip("/").split("/") for p in article_paths if p]
    segs = [x for x in segs if x]
    if not segs:
        return ""
    list_segs = set(list_path.strip("/").split("/"))
    n = len(segs)

    # ① 找出现在多数文章路径里、但不在列表页路径里的段
    counter = Counter()
    for parts in segs:
        # 必须 sorted(set(...))：set 的迭代顺序随 PYTHONHASHSEED 变化，
        # Counter 并列时按插入序取胜者，会导致同一个网站每次探测猜出不同的
        # article_pattern——探测结论必须可复现，否则没法对客户交代。
        for part in sorted(set(parts)):
            if part and part not in list_segs and not part.isdigit():
                counter[part] += 1
    for part, cnt in sorted(counter.most_common(), key=lambda kv: (-kv[1], kv[0])):
        if cnt >= max(2, n * 2 // 3) and not part.endswith((".html", ".shtml")):
            return f"/{re.escape(part)}/"

    # ② 退而求其次：用文件扩展名形态（国际氢能网的 /html/h2-123.shtml 属这类）
    for ext in (".shtml", ".html", ".htm"):
        if sum(1 for p in article_paths if p.endswith(ext)) >= max(2, n * 2 // 3):
            if list_path.endswith(ext):
                # 列表页也是同扩展名，再叠一个共同前缀才能区分开
                firsts = [x[0] for x in segs if x and x[0] not in list_segs]
                if firsts:
                    top, c = Counter(firsts).most_common(1)[0]
                    if c >= max(2, n // 2):
                        return f"/{re.escape(top)}/"
                return ""
            return re.escape(ext) + "$"
    return ""


# 正文外围常见的样板词：出现得越多，说明选中的容器越靠外
BOILERPLATE_HINTS = ["写稿", "投稿", "所属栏目", "来源:", "作者:", "版权", "免责声明",
                     "相关阅读", "推荐阅读", "分享", "扫码", "关键词：", "上一篇", "下一篇"]


def _choose_selector_multi(soups):
    """跨多篇样本文章挑正文容器，而不是只看一篇、也不是挑文本最长的那个。

    只看一篇会踩坑：有的文章正好很短，干净容器不足百字被排除，
    于是选中带「写稿 投稿 所属栏目 来源:」样板的外层包裹层。
    跨样本聚合后，真正的正文容器会在多数样本上都稳定命中。

    评分：命中样本数越多越好 → 样板词越少越好 → 文本越短越好（越贴身）。
    """
    stats = {}
    for sel in CANDIDATE_SELECTORS:
        hits, total_len, bp = 0, 0, 0
        for soup in soups:
            t = _pick_container(soup, [sel])
            if len(t) >= 60:
                hits += 1
                total_len += len(t)
                bp += sum(1 for b in BOILERPLATE_HINTS if b in t)
        if hits:
            stats[sel] = (hits, bp / hits, total_len / hits)
    if not stats:
        return "", 0
    n = max(1, len(soups))
    # 覆盖率够用就行（≥60% 的样本命中），在这个门槛之上按"干净程度"排序。
    # 实测：氢启未来的 div.conts 命中 2/3 但样板词 0，div.content 命中 3/3 但样板词 9。
    # 若按命中率优先会选中带「写稿 投稿 所属栏目 来源:」的那个——
    # raw_text 是全站溯源的底座，宁可少命中一篇，也不要每篇都掺样板。
    need = max(1, int(n * 0.6 + 0.999))
    pool = {k: v for k, v in stats.items() if v[0] >= need} or stats
    best = sorted(pool.items(), key=lambda kv: (kv[1][1], -kv[1][0], kv[1][2]))[0]
    return best[0], int(best[1][2])


def _choose_selector(soup):
    """单篇版本，供采集期与自测使用。

    按最长取会选中最外层包裹层：氢启未来的 div.content 有 1669 字，
    里面混着「写稿 投稿 作者:官方 来源:互联网 所属栏目」等样板；
    真正干净的 div.conts 只有 951 字。若按长度取，探测会一直推荐更脏的那个，
    抓回来的 raw_text 里就永远带着导航与免责声明——而 raw_text 是全站溯源的底座。

    做法：先取各候选的文本，以最长者为参照，在"内容完整度足够"（≥55%）的候选里
    选样板词最少、其次长度最短的那个。
    """
    cands = []
    for sel in CANDIDATE_SELECTORS:
        t = _pick_container(soup, [sel])
        if len(t) >= 100:
            cands.append((sel, t))
    if not cands:
        return "", 0
    longest = max(len(t) for _, t in cands)
    keep = [(sel, t) for sel, t in cands if len(t) >= longest * 0.55]
    keep.sort(key=lambda kv: (sum(1 for b in BOILERPLATE_HINTS if b in kv[1]), len(kv[1])))
    sel, txt = keep[0]
    return sel, len(txt)


def picked_text_best(soup, selector):
    return _pick_container(soup, [selector]) if selector else ""


def probe_source(url, sample_limit=2):
    """探测 URL 能否作为采集源，返回一份可直接展示给用户的报告。

    不判断"用户给的是站点还是栏目页"——由结构自己说话：
    页面上有多少条命中氢能关键词的文章链接，就是它作为列表页的价值。
    """
    rep = {"url": url, "usable": False, "verdict": "", "detail": [],
           "http_ok": False, "page_bytes": 0, "anchors": 0, "keyword_links": 0,
           "article_pattern": "", "body_selectors": [], "samples": [],
           "same_domain_source": None, "suggest": ""}

    safe, why = check_url_safe(url)
    if not safe:
        rep["verdict"] = "URL 不可用"
        rep["detail"].append(why)
        return rep

    host = urlparse(url).hostname or ""
    root_domain = registrable_domain(host)
    for cfg in load_sources(only_enabled=False):
        base = cfg.get("base") or ""
        cfg_hosts = {registrable_domain(urlparse(base).hostname)} | {
            registrable_domain(urlparse(u).hostname) for u in (cfg.get("lists") or [])}
        if root_domain and root_domain in cfg_hosts:
            rep["same_domain_source"] = cfg["key"]
            break

    html, ok = fetch(url)
    rep["http_ok"] = ok
    rep["page_bytes"] = len(html)
    if not ok:
        rep["verdict"] = "抓不到"
        rep["detail"].append(
            "请求失败或命中人机验证。按项目规矩不绕过验证码，"
            "此类源只能记为停用并写明理由。")
        rep["suggest"] = "save_disabled"
        return rep

    soup = BeautifulSoup(html, "lxml")
    anchors = soup.find_all("a", href=True)
    rep["anchors"] = len(anchors)

    hits = []
    for a in anchors:
        txt = a.get_text(strip=True)
        if len(txt) < 8 or not hit_keyword(txt):
            continue
        href = a["href"]
        full = href if href.startswith("http") else urljoin(url, href)
        if registrable_domain(urlparse(full).hostname) != root_domain:
            continue          # 站外链接不算这个源的产出（允许跨子域）
        hits.append((full, txt))
    # 同一篇文章可能被列表页链多次
    seen, uniq = set(), []
    for full, txt in hits:
        if full in seen:
            continue
        seen.add(full)
        uniq.append((full, txt))
    rep["keyword_links"] = len(uniq)

    if len(uniq) < 3:
        rep["verdict"] = "不是氢能公告列表页"
        rep["detail"].append(
            f"页面共有 {len(anchors)} 个链接，但命中氢能关键词的同域文章链接只有 "
            f"{len(uniq)} 条（少于 3 条）。搜索引擎首页、公司官网首页、"
            f"纯图片列表都会是这个结果——它们能打开，但采集器抓不到公告。")
        rep["suggest"] = "reject"
        return rep

    rep["article_pattern"] = _guess_article_pattern(
        [urlparse(u).path for u, _ in uniq], urlparse(url).path)
    if not rep["article_pattern"]:
        rep["detail"].append("未能归纳出统一的文章 URL 形态，需人工填写 article_pattern。")

    # 取样正文：先把样本全抓回来，再跨样本统一挑容器
    soups = []
    for full, txt in uniq[:sample_limit]:
        ahtml, aok = fetch(full)
        time.sleep(SLEEP)
        if not aok:
            rep["samples"].append({"url": full, "title": txt, "ok": False,
                                   "chars": 0, "selector": "", "note": "抓取失败或命中验证"})
            continue
        asoup = BeautifulSoup(ahtml, "lxml")
        _, fallback_body, pub = extract_body(ahtml, tuple())
        if looks_like_challenge(fallback_body):
            rep["samples"].append({"url": full, "title": txt, "ok": False,
                                   "chars": 0, "selector": "",
                                   "note": "文章页返回人机验证占位，不是公告正文"})
            continue
        soups.append((full, txt, asoup, fallback_body, pub))

    best_sel, best_len = _choose_selector_multi([x[2] for x in soups]) if soups else ("", 0)
    for full, txt, asoup, fallback_body, pub in soups:
        picked_len = len(_pick_container(asoup, [best_sel])) if best_sel else 0
        note = ""
        if picked_len < 100:
            picked_len = len(fallback_body)
            note = "该篇未命中所选正文容器，回退整页文本——正文质量不可靠"
        rep["samples"].append({
            "url": full, "title": txt, "ok": True, "chars": picked_len,
            "selector": best_sel, "published": pub, "note": note})

    rep["body_selectors"] = [best_sel] if best_sel else []
    good = [x for x in rep["samples"] if x["ok"] and x["chars"] > 100]
    if not good:
        challenged = [x for x in rep["samples"] if "人机验证" in (x.get("note") or "")]
        if challenged:
            rep["verdict"] = "文章页有人机验证"
            rep["detail"].append(
                "列表页能读，但文章正文返回的是人机验证占位页。"
                "按项目规矩不绕过验证，此源只能记为停用并写明理由。")
        else:
            rep["verdict"] = "文章页读不出正文"
            rep["detail"].append("样本文章抓取失败或正文不足 100 字，入库也是废数据。")
        rep["suggest"] = "save_disabled"
        return rep
    if not best_sel:
        rep["verdict"] = "可用，但正文靠整页回退"
        rep["detail"].append(
            "找到了公告列表，但没命中已知正文容器，只能整页取文——"
            "会把导航栏和免责声明算进正文。建议人工补一个 CSS 选择器。")
        rep["usable"] = True
        rep["suggest"] = "save_enabled_warn"
        return rep

    rep["usable"] = True
    rep["verdict"] = "可用"
    rep["detail"].append(
        f"命中 {len(uniq)} 条氢能相关文章链接，样本正文 {best_len} 字，"
        f"正文容器 {best_sel}。")
    rep["suggest"] = "save_enabled"
    return rep


def run(max_new=None):
    """按 sources.yaml 逐源采集。

    配额语义：每个源的 quota = **本轮**最多新增几条，与库中已有存量无关。
    早先写成「全局 target 减去库存」是错的——库满 120 之后 room 恒为 0，
    第一个源就 break，整个采集变成零 HTTP 请求的空操作，
    新加的源永远拿不到预算。max_new 只作为防跑飞的总闸，默认不限。
    """
    init_db()
    conn = connect()
    have = conn.execute(
        "SELECT COUNT(*) c FROM signals WHERE length(raw_text)>100").fetchone()["c"]
    sources = load_sources()
    print(f"[crawler] 库中已有合格 signal {have} 条；"
          f"启用源 {len(sources)} 个：{'、'.join(x['key'] for x in sources)}")

    added = 0
    report = []
    for cfg in sources:
        key = cfg.get("key", "(未命名)")
        ok, problems = validate_source(cfg)
        if not ok:
            print(f"[{key}] 配置不合法，跳过本源（不影响其它源）：{'；'.join(problems)}")
            report.append({"source": key, "added": 0, "error": "；".join(problems)})
            continue
        quota = cfg.get("quota", 10)
        if quota <= 0:
            print(f"[{key}] 配额为 0，跳过本源（不影响其它源）")
            report.append({"source": key, "added": 0, "error": None})
            continue
        budget = quota
        if max_new is not None:
            budget = min(budget, max_new - added)
            # 只有总闸真的耗尽才 break；配额为 0 是上面单独处理的，
            # 否则一个 quota=0 的源会把排在它后面的所有源一起静默跳过
            if budget <= 0:
                print("[crawler] 已达本轮总闸，剩余源跳过")
                break
        # 一个源出意外只算它自己的账，绝不带崩整轮
        try:
            if cfg["kind"] == "ted_api":
                got = crawl_ted(conn, cfg, budget)
            else:
                art_re = re.compile(cfg["article_pattern"])
                sels = tuple(cfg.get("body_selectors") or ())
                if not sels:
                    # 没配容器就明说走整页回退，不要偷偷套用别的站点的选择器：
                    # 早先这里默认回落到 div.conts，那是氢启未来专用的，
                    # 用在别的站上要么抓空、要么抓错，而日志里看不出来
                    print(f"[{key}] 未配置 body_selectors，本源按整页取文（正文质量不可靠）")
                got = crawl_site(
                    conn, key, build_lists(cfg), cfg["base"],
                    lambda h, _r=art_re: bool(_r.search(h)), sels, budget)
            added += got
            report.append({"source": key, "added": got, "error": None})
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            print(f"[{key}] 采集异常，跳过本源：{msg}")
            report.append({"source": key, "added": 0, "error": msg})

    total = conn.execute(
        "SELECT COUNT(*) c FROM signals WHERE length(raw_text)>100").fetchone()["c"]
    by_src = conn.execute(
        "SELECT source, COUNT(*) c FROM signals WHERE length(raw_text)>100"
        " GROUP BY source ORDER BY c DESC").fetchall()
    conn.close()
    print(f"[crawler] 本次新增 {added} 条，合格 signal 合计 {total} 条")
    for r in by_src:
        print(f"           {r['source']}: {r['c']} 条")
    failed = [r for r in report if r["error"]]
    if failed:
        print(f"[crawler] 有 {len(failed)} 个源未成功：" +
              "；".join(f"{r['source']}({r['error'][:60]})" for r in failed))
    return total


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="按 sources.yaml 采集氢能公告")
    ap.add_argument("--max-new", type=int, default=None,
                    help="本轮最多新增多少条（防止一次点击拉起长时间全量爬取）")
    a = ap.parse_args()
    run(max_new=a.max_new)
