"""Agent Harness 的状态部件：记忆、偏好、知识索引、技能目录。

参考 pi（earendil-works/pi, MIT）与 deepseek-harness（deepseek-ai, MIT）的组织方式：
技能以 Markdown + frontmatter 存放，system prompt 里只放**目录**（名字+描述），
模型判断相关时再用工具读全文——渐进披露，避免把所有技能正文塞满上下文。

这里只管**存取**，不调模型。工具的执行在 tools.py，循环在 agent.py。
"""
import json
import os
import re
import time

STATE_DIR = os.path.expanduser("~/.config/hydrogen-radar")
MEMORY_PATH = os.path.join(STATE_DIR, "memory.json")
PREFS_PATH = os.path.join(STATE_DIR, "preferences.json")
HERE = os.path.dirname(os.path.abspath(__file__))
KNOWLEDGE_PATH = os.path.join(HERE, "knowledge.md")

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


def read_knowledge(section=None):
    """读知识库。不给 section 就返回标题目录；给了就返回该节正文。"""
    try:
        text = open(KNOWLEDGE_PATH, encoding="utf-8").read()
    except OSError as e:
        raise ValueError(f"知识库不可读：{e}")
    body = text.split("---", 2)[-1] if text.startswith("---") else text
    if not section:
        return {"sections": knowledge_sections()}
    blocks = re.split(r"^## ", body, flags=re.M)
    for b in blocks:
        title = b.split("\n", 1)[0].strip()
        if title and (title == section or section in title):
            return {"section": title, "content": ("## " + b).strip()[:4000]}
    raise ValueError(f"知识库没有「{section}」这一节；可用：{', '.join(knowledge_sections())}")


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

    lines.append("<knowledge_sections>")
    lines.append("、".join(knowledge_sections()) or "（知识库不可读）")
    lines.append("用 read_knowledge 工具按节取用。")
    lines.append("</knowledge_sections>")
    return "\n".join(lines)
