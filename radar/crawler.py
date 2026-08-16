"""信号监听层：从氢能行业垂直站抓取真实招标/中标/项目公告。

死规矩：raw_text 必须来自真实 HTTP 响应，不得手工粘贴或编造。
不绕过任何人机验证（WAF/验证码）——遇到即跳过该源并记录。
"""
import re
import time
import datetime as dt

import requests
from bs4 import BeautifulSoup

from db import connect, init_db

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
HEADERS = {"User-Agent": UA}
TIMEOUT = 30
SLEEP = 1.2  # 控频，避免给源站造成压力

# 氢能商机关键词——只做粗筛，真正的商机判断交给 LLM（任务2）
KEYWORDS = ["氢", "燃料电池", "电解槽", "加氢", "制氢", "电堆"]

# 氢启未来（h2weilai.com）：正文可正常获取，无人机验证
H2W_BASE = "https://www.h2weilai.com"
H2W_LISTS = [
    "https://www.h2weilai.com/cms/index/lists/catid/28.html",   # 市场动态
    "https://www.h2weilai.com/cms/index/lists/catid/29.html",   # 行业新闻
    "https://www.h2weilai.com/",
] + [
    # 市场动态翻页（实测分页格式为 ?page=N，共 300+ 页），扩大真实样本池
    f"https://www.h2weilai.com/cms/index/lists/catid/28.html?page={p}"
    for p in range(2, 12)
]

# 商机类标题特征——优先抓这些（招标/中标/采购/签约/订单是最强商机信号）
BIZ_MARKERS = ["招标", "中标", "采购", "签约", "订单", "交付", "投运", "开标", "成交", "台", "辆"]

WAF_MARKERS = ["安全验证", "CF_APP_WAF", "快速验证", "请开启JavaScript"]


def fetch(url):
    """返回 (html, ok)；命中人机验证返回 ok=False，绝不尝试绕过。"""
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    except Exception as e:
        print(f"  [warn] 请求失败 {url} -> {type(e).__name__}")
        return "", False
    if r.status_code != 200:
        print(f"  [warn] HTTP {r.status_code} {url}")
        return "", False
    r.encoding = r.apparent_encoding or "utf-8"
    html = r.text
    if any(m in html for m in WAF_MARKERS) and len(html) < 8000:
        print(f"  [skip] 命中人机验证，按规矩不绕过：{url}")
        return "", False
    return html, True


PUB_RE = re.compile(r"发布时间[:：]\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)")


def clean_text(soup):
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    for sel in ["div.nav", "div.uhead", "div.foot", "div.links"]:
        for tag in soup.select(sel):
            tag.decompose()
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text)


def extract_body(html):
    """抽正文、标题与公告发布时间。

    正文优先取文章容器 div.conts；取不到才回退到"整页去样板 + 锚点切割"，
    避免把免责声明、相关文章、友情链接算进正文长度。
    """
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else ""

    # 发布时间要在切正文之前抠，否则会被锚点切割丢掉
    m = PUB_RE.search(soup.get_text(" ", strip=True))
    published = m.group(1).strip() if m else ""

    node = soup.select_one("div.conts")
    if node:
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
    else:
        text = clean_text(soup)
        for anchor in ["[ 导读 ]", "导读", "发布时间:"]:
            idx = text.find(anchor)
            if idx > 0:
                text = text[idx:]
                break
    return title, text[:6000], published


def collect_links():
    """从多个列表页汇总文章链接。"""
    found = {}
    for lurl in H2W_LISTS:
        html, ok = fetch(lurl)
        if not ok:
            continue
        soup = BeautifulSoup(html, "lxml")
        for a in soup.find_all("a", href=True):
            txt = a.get_text(strip=True)
            href = a["href"]
            if "/shows/" not in href or len(txt) < 8:
                continue
            if not any(k in txt for k in KEYWORDS):
                continue
            full = href if href.startswith("http") else H2W_BASE + href
            found[full] = txt
        print(f"  [list] {lurl} -> 累计候选 {len(found)}")
        time.sleep(SLEEP)
    # 商机类标题排前面：招标/中标/签约类的信息密度远高于会展与综述
    return dict(sorted(found.items(),
                       key=lambda kv: -sum(m in kv[1] for m in BIZ_MARKERS)))


def run(target=14):
    init_db()
    conn = connect()
    have = conn.execute(
        "SELECT COUNT(*) c FROM signals WHERE length(raw_text)>100").fetchone()["c"]
    print(f"[crawler] 库中已有合格 signal {have} 条，目标 {target} 条")

    links = collect_links()
    print(f"[crawler] 候选文章 {len(links)} 条，开始抓正文")

    saved = 0
    for url, title in links.items():
        if have + saved >= target:
            break
        exists = conn.execute(
            "SELECT 1 FROM signals WHERE source_url=?", (url,)).fetchone()
        if exists:
            continue
        html, ok = fetch(url)
        time.sleep(SLEEP)
        if not ok:
            continue
        page_title, body, published = extract_body(html)
        if len(body) <= 100:
            print(f"  [skip] 正文过短({len(body)}字) {title[:24]}")
            continue
        conn.execute(
            "INSERT INTO signals (source, source_url, title, raw_text, fetched_at, published_at)"
            " VALUES (?,?,?,?,?,?)",
            ("氢启未来", url, title, body,
             dt.datetime.now().astimezone().isoformat(timespec="seconds"), published),
        )
        conn.commit()
        saved += 1
        print(f"  [ok] {saved:2d}. {title[:34]} ({len(body)}字)")

    total = conn.execute(
        "SELECT COUNT(*) c FROM signals WHERE length(raw_text)>100").fetchone()["c"]
    conn.close()
    print(f"[crawler] 本次新增 {saved} 条，合格 signal 合计 {total} 条")
    return total


if __name__ == "__main__":
    run()
