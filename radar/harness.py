"""Agent Harness 的状态部件：记忆、偏好、知识索引、技能目录。

参考 pi（earendil-works/pi, MIT）与 deepseek-harness（deepseek-ai, MIT）的组织方式：
技能以 Markdown + frontmatter 存放，system prompt 里只放**目录**（名字+描述），
模型判断相关时再用工具读全文——渐进披露，避免把所有技能正文塞满上下文。

这里只管**存取**，不调模型。工具的执行在 tools.py，循环在 agent.py。
"""
import datetime as dt
import json
import os
import re
import time
from urllib.parse import urlparse

STATE_DIR = os.path.expanduser("~/.config/hydrogen-radar")
MEMORY_PATH = os.path.join(STATE_DIR, "memory.json")
PREFS_PATH = os.path.join(STATE_DIR, "preferences.json")
AUDIT_PATH = os.path.join(STATE_DIR, "reach_audit.jsonl")
HERE = os.path.dirname(os.path.abspath(__file__))
KNOWLEDGE_PATH = os.path.join(HERE, "knowledge.md")
# 附加知识文档目录。knowledge.md 是被 pipeline 提示词直接消费的**契约主文件**；
# 这里的 *.md 不参与提示词装配，是给 agent 按需取用、也给人看的资料。
KNOWLEDGE_DIR = os.path.join(HERE, "knowledge")

# 偏好白名单。键是固定的——模型不能自己发明偏好项，否则下轮注入的上下文
# 会越长越乱，且没人知道某个键是谁写的。
PREF_SCHEMA = {
    "focus_regions":   {"type": "list", "desc": "优先关注的区域，如 ['广东','河北']"},
    "focus_products":  {"type": "list", "desc": "优先关注的产品线，如 ['撬装式PEM制氢']"},
    "min_score":       {"type": "int",  "desc": "只看评分不低于该值的线索，0-100"},
    "exclude_regions": {"type": "list", "desc": "明确不看的区域"},
    "tone":            {"type": "str",  "desc": "作战卡与回答的口吻偏好"},
}

DEFAULT_PREFS = {
    "focus_regions": [],
    "focus_products": [],
    "min_score": 0,
    "exclude_regions": [],
    "tone": "",
}


def _read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return fallback


def _write_json_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


# ---------------------------------------------------------------- 记忆
def read_memory():
    """返回记忆条目列表，每条 {id, content, created_at}。"""
    items = _read_json(MEMORY_PATH, [])
    return items if isinstance(items, list) else []


def remember(content):
    content = str(content or "").strip()[:200]
    if not content:
        raise ValueError("记忆内容为空")
    items = read_memory()
    if any(it.get("content") == content for it in items):
        return {"skipped": "已存在相同记忆", "count": len(items)}
    items.append({
        "id": f"m{int(time.time()*1000)}",
        "content": content,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    _write_json_atomic(MEMORY_PATH, items)
    return {"saved": content, "count": len(items)}


# ---------------------------------------------------------------- 偏好
def read_prefs():
    stored = _read_json(PREFS_PATH, {})
    prefs = dict(DEFAULT_PREFS)
    if isinstance(stored, dict):
        for k in PREF_SCHEMA:
            if k in stored:
                prefs[k] = stored[k]
    return prefs


def set_preference(key, value):
    """只接受白名单里的键，并按声明的类型强制转换。"""
    if key not in PREF_SCHEMA:
        raise ValueError(f"未知偏好项 {key}；可用：{', '.join(PREF_SCHEMA)}")
    kind = PREF_SCHEMA[key]["type"]
    if kind == "list":
        if isinstance(value, str):
            value = [v.strip() for v in re.split(r"[、,，/]", value) if v.strip()]
        if not isinstance(value, list):
            raise ValueError(f"{key} 需要列表")
        value = [str(v)[:40] for v in value][:12]
    elif kind == "int":
        try:
            value = max(0, min(100, int(value)))
        except (TypeError, ValueError):
            raise ValueError(f"{key} 需要 0-100 的整数")
    else:
        value = str(value)[:80]
    prefs = read_prefs()
    prefs[key] = value
    _write_json_atomic(PREFS_PATH, prefs)
    return {"saved": {key: value}}


# ---------------------------------------------------------------- 知识
def knowledge_sections():
    """返回 knowledge.md 的二级标题清单，供模型按需取用。"""
    try:
        text = open(KNOWLEDGE_PATH, encoding="utf-8").read()
    except OSError:
        return []
    return re.findall(r"^## (.+)$", text, flags=re.M)


KNOWLEDGE_DOC_CHARS = 8000   # 单篇文档注入上限；超了如实标注截断，不静默吞掉


def knowledge_docs():
    """附加知识文档清单（knowledge/ 目录下的 *.md），条目名即文件名（去掉 .md）。

    与「小节」是两回事：小节来自契约主文件 knowledge.md、参与 pipeline 提示词装配；
    文档只是资料，按需取用。目录不存在或不可读时返回空列表——没有文档不是错误。
    """
    try:
        names = os.listdir(KNOWLEDGE_DIR)
    except OSError:
        return []
    return sorted(n[:-3] for n in names
                  if n.endswith(".md") and not n.startswith("."))


def _read_knowledge_doc(name):
    """按条目名读一篇文档。文件名来自模型输入，只允许目录内直接子文件。"""
    if name.endswith(".md"):
        name = name[:-3]
    if name not in knowledge_docs():     # 白名单：只认列表里真实存在的条目
        return None
    path = os.path.join(KNOWLEDGE_DIR, f"{name}.md")
    # 双保险：拼完路径再复核确实落在 knowledge 目录内（挡符号链接等）
    if os.path.dirname(os.path.realpath(path)) != os.path.realpath(KNOWLEDGE_DIR):
        return None
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as e:
        raise ValueError(f"知识文档「{name}」不可读：{e}")
    out = {"doc": name, "content": text[:KNOWLEDGE_DOC_CHARS]}
    if len(text) > KNOWLEDGE_DOC_CHARS:
        out["truncated"] = f"原文 {len(text)} 字，此处只给前 {KNOWLEDGE_DOC_CHARS} 字"
    return out


def read_knowledge(section=None):
    """读知识库。不给 section 就返回目录（小节 + 文档）；给了就返回对应正文。

    查找顺序：先按 knowledge.md 的小节名匹配（保持原有行为不变），
    没命中再按 knowledge/ 目录下的文档名匹配。
    """
    try:
        text = open(KNOWLEDGE_PATH, encoding="utf-8").read()
    except OSError as e:
        raise ValueError(f"知识库不可读：{e}")
    body = text.split("---", 2)[-1] if text.startswith("---") else text
    if not section:
        return {"sections": knowledge_sections(), "docs": knowledge_docs()}
    blocks = re.split(r"^## ", body, flags=re.M)
    for b in blocks:
        title = b.split("\n", 1)[0].strip()
        if title and (title == section or section in title):
            return {"section": title, "content": ("## " + b).strip()[:4000]}
    doc = _read_knowledge_doc(section)
    if doc is not None:
        return doc
    docs = knowledge_docs()
    raise ValueError(
        f"知识库没有「{section}」这一节，也没有同名文档；"
        f"可用小节：{', '.join(knowledge_sections()) or '（无）'}；"
        f"可用文档：{', '.join(docs) or '（无）'}")


# ---------------------------------------------------------------- 技能目录
def skills_catalog():
    """技能目录：只给名字和描述，正文要模型自己用 run_skill 触发。"""
    try:
        import skills as sk
        data = sk.load_all()          # 返回 list，不是 dict
    except Exception:
        return []
    out = []
    for s in data:
        if s.get("enabled") and not s.get("problems"):
            out.append({"key": s["key"], "name": s.get("name") or s["key"],
                        "description": s.get("description") or "", "scope": s.get("scope", "lead")})
    return out


# ---------------------------------------------------------------- 源覆盖快照
# 这一节全部是代码统计，零模型调用：告诉 agent「已经搜过什么、哪些源在产出、
# 哪些路撞过墙、还剩多少额度」。目的是让它别把预算浪费在重复的搜索上。
#
# 纪律：任何一段取不到，就如实打「不可读：原因」。绝不静默填 0——
# 「这个源近 7 天 0 条」和「我根本没读到日志」对下一步决策的含义完全相反。

AUDIT_TAIL_LINES = 2000       # 只读尾部：审计日志只追加，会长到很大
AUDIT_TAIL_BYTES = 2_000_000  # 尾部字节窗口，够装下 2000 行常规记录


def _tail_lines(path, max_lines=AUDIT_TAIL_LINES, max_bytes=AUDIT_TAIL_BYTES):
    """读文件尾部若干行。文件不存在 / 不可读时抛异常，由调用方如实上报。"""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
            f.readline()          # 丢掉被切断的半行
        chunk = f.read()
    text = chunk.decode("utf-8", errors="replace")
    return [ln for ln in text.splitlines()[-max_lines:] if ln.strip()]


def _audit_tail_records():
    """审计日志尾部的 JSON 记录。坏行跳过（只追加的日志允许有半行残留）。"""
    out = []
    for ln in _tail_lines(AUDIT_PATH):
        try:
            rec = json.loads(ln)
        except ValueError:
            continue
        if isinstance(rec, dict):
            out.append(rec)
    return out


def _within_days(ts, days=7):
    """审计 ts 是 isoformat；库里 fetched_at/published_at 前 10 位都是 YYYY-MM-DD。"""
    cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    return str(ts or "")[:10] >= cutoff


def _source_output_7d():
    """启用源近 7 天产出：按 source 分组计数。
    发布时间优先（公告本身的时间轴），缺失时退回抓取时间。"""
    from db import connect
    cutoff = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT source, COUNT(*) AS n FROM signals "
            "WHERE substr(COALESCE(NULLIF(published_at,''), fetched_at), 1, 10) >= ? "
            "GROUP BY source ORDER BY n DESC", (cutoff,)).fetchall()
        newest = conn.execute(
            "SELECT MAX(COALESCE(NULLIF(published_at,''), fetched_at)) AS m "
            "FROM signals").fetchone()
        total = conn.execute("SELECT COUNT(*) AS n FROM signals").fetchone()
    finally:
        conn.close()
    return ([(r["source"], r["n"]) for r in rows],
            (newest["m"] if newest else None), (total["n"] if total else 0))


def _reason_key(reason):
    """撞墙原因归一到前缀：'安全校验拒绝：xxx' / '抓取失败（…）' 归成同一类。"""
    head = re.split(r"[：:（(，,]", str(reason or "").strip(), maxsplit=1)[0]
    return (head or "未注明原因")[:20]


def _recent_searches(recs, limit=20):
    out = []
    for r in recs:
        if r.get("kind") != "search":
            continue
        doms = r.get("domains") or []
        out.append({"ts": str(r.get("ts", ""))[:16],
                    "query": str(r.get("query", ""))[:80],
                    "hits": r.get("hits"),
                    "domains": [str(d) for d in doms][:6]})
    return out[-limit:]


def _dead_end_top(recs, top=5):
    tally = {}
    for r in recs:
        if r.get("kind") != "dead_end" or not _within_days(r.get("ts")):
            continue
        host = (urlparse(str(r.get("url") or "")).hostname or "未知域").lower()
        key = (_reason_key(r.get("reason")), host)
        tally[key] = tally.get(key, 0) + 1
    return sorted(tally.items(), key=lambda kv: -kv[1])[:top]


def source_coverage_lines():
    """<source_coverage> 块的正文行。每一段独立降级：一段读不到不拖垮其余几段。"""
    lines = []

    # 1. 启用源近 7 天产出
    try:
        rows, newest, total = _source_output_7d()
        if rows:
            lines.append("近 7 天入库（按源）：" +
                         "｜".join(f"{s or '未注明'} {n}" for s, n in rows))
        else:
            lines.append(f"近 7 天入库：0 条（库内共 {total} 条，最新一条 {newest or '无'}）——"
                         "源可能已停更或采集未跑，不等于该源无货。")
    except Exception as e:
        lines.append(f"（源产出不可读：{type(e).__name__}: {e}）")

    # 2/3. 审计日志派生：最近搜过什么 + 撞墙汇总
    try:
        recs = _audit_tail_records()
    except Exception as e:
        recs = None
        lines.append(f"（覆盖账不可读：{type(e).__name__}: {e}；"
                     "触网审计日志尚未生成或读不到，不代表没搜过）")
    if recs is not None:
        searches = _recent_searches(recs)
        if searches:
            lines.append(f"最近 {len(searches)} 次检索（避免重复搜同一句）：")
            for s in searches:
                dom = "、".join(s["domains"]) or "无命中域"
                lines.append(f"- [{s['ts']}] 「{s['query']}」→ {s['hits']} 条：{dom}")
        else:
            lines.append(f"最近检索：审计日志尾部（≤{AUDIT_TAIL_LINES} 行）内没有检索记录。")

        walls = _dead_end_top(recs)
        if walls:
            lines.append("近 7 天撞墙 Top5（同样的墙不必再撞）：")
            for (reason, host), n in walls:
                lines.append(f"- {host}：{reason} ×{n}")
        else:
            lines.append("近 7 天撞墙：审计日志尾部内无 dead_end 记录。")

    # 4/5. 博查余额与待审提案：reach 在函数内 import，缺依赖不影响 harness 可用
    try:
        import reach
        lines.append(f"博查检索余额：{reach.bocha_remaining()}/{reach.BOCHA_TOTAL} 次"
                     "（体验包总量，省着用）。")
        lines.append(f"待人工审批的提案：{len(reach.list_proposals('pending'))} 条"
                     "（新增常驻源 / 拉黑确认，agent 无权自批）。")
    except Exception as e:
        lines.append(f"（触网额度与提案不可读：{type(e).__name__}: {e}）")

    return lines


# ---------------------------------------------------------------- 上下文装配
def context_block():
    """每轮都注入的 harness 上下文：偏好 + 记忆 + 技能目录 + 知识目录。"""
    prefs = read_prefs()
    active = {k: v for k, v in prefs.items() if v not in ([], "", 0)}
    mem = read_memory()
    lines = []

    lines.append("<preferences>")
    lines.append(json.dumps(active, ensure_ascii=False) if active else "（销售尚未设置偏好）")
    lines.append("</preferences>")

    lines.append("<memory>")
    if mem:
        for it in mem[-12:]:
            lines.append(f"- {it.get('content','')}")
    else:
        lines.append("（暂无记忆）")
    lines.append("</memory>")

    cat = skills_catalog()
    lines.append("<available_skills>")
    if cat:
        for s in cat:
            lines.append(f"- {s['key']}：{s['name']} —— {s['description']}")
        lines.append("需要时用 run_skill 工具在某条线索上执行，不要凭空复述技能内容。")
    else:
        lines.append("（无已启用技能）")
    lines.append("</available_skills>")

    lines.append("<pipeline_status>")
    try:
        # 惰性 import：harness 被 agent/api/tools 加载时不拖起 pipeline→llm 链。
        # 口径唯一来源是 pipeline.stage_backlog（与 get_pipeline_status 工具同源），
        # 这里不许自己写 SQL——两处数字打架比没有数字更糟。
        from pipeline import stage_backlog
        b = stage_backlog()
        lines.append(
            f"开场快照：待抽取公告 {b['extract']} 条｜汇总贴候选 {b['backfill']} 篇｜"
            f"待配型 {b['match']} 条｜达标未出卡 {b['cards']} 条（≥{b['threshold']}分）｜"
            f"在研 {b['new_total']} 条。此为对话开始时代码查库所得；"
            "行动前用 get_pipeline_status 复核，不要凭这行快照下最终结论。")
    except Exception as e:
        # 查库失败如实说，绝不静默填 0——编一个数字比没有数字更糟。
        lines.append(f"（管线状态不可读：{type(e).__name__}，需要时用 get_pipeline_status 重查）")
    lines.append("</pipeline_status>")

    lines.append("<source_coverage>")
    try:
        lines.extend(source_coverage_lines())
    except Exception as e:
        # 整节兜底：同 pipeline_status 的口径，读不到就说读不到，不装 0。
        lines.append(f"（源覆盖不可读：{type(e).__name__}: {e}）")
    lines.append("</source_coverage>")

    # 小节与文档分开列：小节来自契约主文件、参与打分口径；文档只是资料。
    # 混成一行会让模型以为改文档就能改判断标准。
    lines.append("<knowledge_sections>")
    lines.append("主文件小节（knowledge.md，参与研判口径）：" +
                 ("、".join(knowledge_sections()) or "（知识库不可读）"))
    lines.append("附加文档（knowledge/ 目录，按需取用的资料，不参与打分）：" +
                 ("、".join(knowledge_docs()) or "（暂无文档）"))
    lines.append("用 read_knowledge 工具按小节名或文档名取用。")
    lines.append("</knowledge_sections>")
    return "\n".join(lines)
