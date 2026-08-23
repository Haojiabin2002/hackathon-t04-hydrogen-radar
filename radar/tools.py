"""Agent 工具注册表。

⚠️ 安全前提，改这个文件前必须先读懂：
llm.py 把 CLI 子进程的**全部工具和 MCP 都禁掉了**，并有隔离探针把关——
因为公告正文是从公开网站抓来的不可信数据，会原样进 prompt，
带工具能力的子进程等于给 prompt injection 开门。

所以这里的"工具"**不是**还给模型的文件系统/shell 能力，而是：
  模型只输出一个结构化工具调用（JSON）
    → 我们的代码按白名单校验参数
    → 我们的代码执行（只读本项目数据库与状态文件）
    → 结果作为观察喂回循环

模型自始至终碰不到文件系统、shell 或网络。新增工具时守住这条线：
只暴露本项目自己的数据，不要引入任何能执行外部命令或访问任意路径的能力。
"""
import json

from db import connect
import harness


class ToolError(ValueError):
    """工具执行失败。会被喂回模型作为观察，让它自己纠正。"""


# ---------------------------------------------------------------- 参数校验
def _need(args, key, kind, default=None, required=True):
    if key not in args or args[key] in (None, ""):
        if required and default is None:
            raise ToolError(f"缺少参数 {key}")
        return default
    v = args[key]
    if kind is int:
        try:
            return int(v)
        except (TypeError, ValueError):
            raise ToolError(f"参数 {key} 需要整数，收到 {v!r}")
    if kind is str:
        return str(v)[:200]
    return v


def _rows(cur):
    return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------- 工具实现
def t_get_stats(args):
    conn = connect()
    q = lambda s: conn.execute(s).fetchone()[0]
    out = {
        "signals": q("SELECT COUNT(*) FROM signals"),
        # 口径必须和 /api/stats 一致：在研只数 status='new'，
        # 归并为 duplicate 的单列。混进来 agent 报的数就和界面打架。
        "leads_active": q("SELECT COUNT(*) FROM leads WHERE status='new'"),
        "rejected": q("SELECT COUNT(*) FROM leads WHERE status='rejected'"),
        "duplicate": q("SELECT COUNT(*) FROM leads WHERE status='duplicate'"),
        "high_score": q("SELECT COUNT(*) FROM leads WHERE status='new' AND score>=80"),
        "cards": q("SELECT COUNT(*) FROM cards c JOIN leads l ON l.id=c.lead_id"
                   " WHERE l.status!='duplicate'"),
    }
    conn.close()
    return out


def t_search_leads(args):
    query = _need(args, "query", str, "", required=False)
    min_score = _need(args, "min_score", int, 0, required=False)
    limit = min(_need(args, "limit", int, 10, required=False) or 10, 30)
    has_card = args.get("has_card")

    sql = ("SELECT l.id, l.company, l.region, l.score, l.matched_product, l.industry,"
           " l.signal_type, s.title,"
           " (SELECT COUNT(*) FROM cards c WHERE c.lead_id=l.id) AS has_card"
           " FROM leads l JOIN signals s ON s.id=l.signal_id"
           " WHERE l.status='new' AND COALESCE(l.score,0)>=?")
    params = [min_score]
    if query:
        sql += (" AND (l.company LIKE ? OR l.region LIKE ? OR l.matched_product LIKE ?"
                " OR l.industry LIKE ? OR s.title LIKE ?)")
        params += [f"%{query}%"] * 5
    sql += " ORDER BY l.score DESC LIMIT ?"
    params.append(limit)

    conn = connect()
    rows = _rows(conn.execute(sql, params))
    conn.close()
    if has_card is True:
        rows = [r for r in rows if r["has_card"]]
    elif has_card is False:
        rows = [r for r in rows if not r["has_card"]]
    return {"count": len(rows), "leads": rows}


def t_get_lead(args):
    lid = _need(args, "id", int)
    conn = connect()
    row = conn.execute(
        "SELECT l.*, s.title AS signal_title, s.source, s.source_url,"
        " s.published_at, substr(s.raw_text,1,2500) AS excerpt"
        " FROM leads l JOIN signals s ON s.id=l.signal_id WHERE l.id=?", (lid,)).fetchone()
    if not row:
        conn.close()
        raise ToolError(f"线索 {lid} 不存在")
    card = conn.execute("SELECT content FROM cards WHERE lead_id=? ORDER BY id DESC LIMIT 1",
                        (lid,)).fetchone()
    conn.close()
    out = dict(row)
    out["card"] = card["content"][:3000] if card else None
    return out


def t_search_signals(args):
    query = _need(args, "query", str)
    limit = min(_need(args, "limit", int, 8, required=False) or 8, 20)
    conn = connect()
    rows = _rows(conn.execute(
        "SELECT id, title, source, source_url, published_at, length(raw_text) AS text_len"
        " FROM signals WHERE title LIKE ? OR raw_text LIKE ?"
        " ORDER BY id DESC LIMIT ?", (f"%{query}%", f"%{query}%", limit)))
    conn.close()
    return {"count": len(rows), "signals": rows}


def t_read_knowledge(args):
    return harness.read_knowledge(args.get("section") or None)


def t_list_skills(args):
    return {"skills": harness.skills_catalog()}


def t_run_skill(args):
    key = _need(args, "key", str)
    lid = _need(args, "lead_id", int)
    import skills as sk
    conn = connect()
    row = conn.execute(
        "SELECT l.*, s.title, s.raw_text, s.source_url FROM leads l"
        " JOIN signals s ON s.id=l.signal_id WHERE l.id=?", (lid,)).fetchone()
    conn.close()
    if not row:
        raise ToolError(f"线索 {lid} 不存在")
    try:
        _meta, prompt = sk.build_prompt(key, row)
    except sk.SkillError as e:
        raise ToolError(str(e))
    from llm import ask
    return {"skill": key, "lead_id": lid, "answer": ask(prompt, expect_json=False)[:3000]}


def t_read_memory(args):
    return {"memory": [m.get("content") for m in harness.read_memory()]}


def t_remember(args):
    try:
        return harness.remember(_need(args, "content", str))
    except ValueError as e:
        raise ToolError(str(e))


def t_get_preferences(args):
    return harness.read_prefs()


def t_set_preference(args):
    try:
        return harness.set_preference(_need(args, "key", str), args.get("value"))
    except ValueError as e:
        raise ToolError(str(e))


# ---------------------------------------------------------------- 注册表
# confirm=True 的工具 agent 不会自己执行，只会作为动作提案返回给界面，
# 由人点一下才生效。触发采集会真的去外部网站抓取，不能让模型自主发起。
REGISTRY = {
    "get_stats": {
        "fn": t_get_stats, "confirm": False,
        "desc": "看整体漏斗：信号数、在研商机数、判非数、高分数、作战卡数。不需要参数。",
        "args": {},
    },
    "search_leads": {
        "fn": t_search_leads, "confirm": False,
        "desc": "按关键词/最低分检索在研商机，返回摘要列表。想看某条详情再调 get_lead。",
        "args": {"query": "可选，匹配主体/区域/产品/行业/标题",
                 "min_score": "可选整数 0-100", "has_card": "可选布尔，是否已有作战卡",
                 "limit": "可选，默认 10，上限 30"},
    },
    "get_lead": {
        "fn": t_get_lead, "confirm": False,
        "desc": "取单条线索全部字段，含评分理由、匹配理由、公告原文摘录、作战卡正文。",
        "args": {"id": "线索 ID，整数"},
    },
    "search_signals": {
        "fn": t_search_signals, "confirm": False,
        "desc": "在原始公告库里按关键词检索，用于核对某个说法是否有原文出处。",
        "args": {"query": "关键词", "limit": "可选，默认 8，上限 20"},
    },
    "read_knowledge": {
        "fn": t_read_knowledge, "confirm": False,
        "desc": "读业务知识库某一节（产品谱系/区域优先级/商机判定规则/产业链穿透/评分口径）。不给 section 则返回目录。",
        "args": {"section": "可选，节标题"},
    },
    "list_skills": {
        "fn": t_list_skills, "confirm": False,
        "desc": "列出当前可用的分析技能。",
        "args": {},
    },
    "run_skill": {
        "fn": t_run_skill, "confirm": False,
        "desc": "在某条线索上执行一个技能，返回分析文本。会真实调一次模型，别滥用。",
        "args": {"key": "技能 key", "lead_id": "线索 ID"},
    },
    "read_memory": {
        "fn": t_read_memory, "confirm": False,
        "desc": "读销售的长期记忆条目。",
        "args": {},
    },
    "remember": {
        "fn": t_remember, "confirm": False,
        "desc": "把一条值得长期记住的销售偏好/结论写进记忆。只在用户明确表达长期意图时用。",
        "args": {"content": "要记住的内容，200 字以内"},
    },
    "get_preferences": {
        "fn": t_get_preferences, "confirm": False,
        "desc": "读销售的结构化偏好。",
        "args": {},
    },
    "set_preference": {
        "fn": t_set_preference, "confirm": False,
        "desc": f"设置一项偏好。可用键：{', '.join(harness.PREF_SCHEMA)}。",
        "args": {"key": "偏好键", "value": "值"},
    },
    "trigger_collect": {
        "fn": None, "confirm": True,
        "desc": "发起一轮真实采集。这是外部网络动作，agent 不会自己执行，只会提议，由人确认。",
        "args": {},
    },
}


def catalog_block():
    """工具目录，注入 system prompt。"""
    lines = ["<tools>"]
    for name, spec in REGISTRY.items():
        arg = json.dumps(spec["args"], ensure_ascii=False) if spec["args"] else "{}"
        tag = "（需人工确认，你只能提议）" if spec["confirm"] else ""
        lines.append(f"- {name}{tag}：{spec['desc']}")
        lines.append(f"  参数：{arg}")
    lines.append("</tools>")
    return "\n".join(lines)


def execute(name, args):
    """按白名单执行。未注册、需确认、执行失败都返回结构化错误，喂回模型自纠。"""
    spec = REGISTRY.get(name)
    if not spec:
        return {"ok": False, "error": f"没有名为 {name} 的工具；可用：{', '.join(REGISTRY)}"}
    if spec["confirm"]:
        return {"ok": False, "error": f"{name} 需要人工确认，已作为动作提案记录，本轮不执行"}
    if not isinstance(args, dict):
        return {"ok": False, "error": "args 必须是对象"}
    try:
        return {"ok": True, "result": spec["fn"](args)}
    except ToolError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
