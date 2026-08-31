"""每周复盘：把本周真实发生的事整理成素材，让 agent 提优化点，一律进审批队列。

三条边界，写死在代码里：

1. **素材全部是代码统计，零模型调用**。数字由 SQL 与本机状态文件算出来，
   模型只负责归纳成「可执行的动作」。模型不数数，也就没有编数字的入口。
2. **提案只是建议，绝不自动生效**。产出一律走 reach.propose('weekly_review', ...)
   进审批队列；批准之后也只是「标记已采纳 + 告诉人去哪改」，不自动写任何文件。
   改 knowledge.md 会直接改变之后所有线索的打分口径，那一步必须由人亲手做。
3. **跑不成就如实中断**。LLM 通道不可用 / agent 中途断线 → 不产出任何提案，
   把失败原因原样记进状态文件。绝不用兜底文本凑一份看起来像样的复盘。

幂等：以 ISO 周号（如 2026-W35）为键。同一周只产出一次——
判据是状态文件里本周的成功记录，**外加**审批队列里 payload.week 命中本周的提案
（状态文件被删掉了也不会重复刷队列）。失败不占坑，下次还能重跑。

命令行：
    python weekly_review.py                # 真跑一轮（会消耗模型额度）
    python weekly_review.py --dry-run      # 只收集素材、只打印提示词，不调模型
    python weekly_review.py --material     # 只打印素材 JSON
    python weekly_review.py --force        # 无视本周已跑过，强制再跑一轮
"""
import argparse
import ast
import datetime as dt
import json
import os
import re
import sys
from urllib.parse import urlparse

import harness

STATE_DIR = os.path.expanduser("~/.config/hydrogen-radar")
STATE_PATH = os.path.join(STATE_DIR, "weekly_review.json")

PROPOSAL_KIND = "weekly_review"
PROPOSAL_TYPES = ("knowledge_edit", "preference_edit", "source_focus")

# —— 校验上限。超限一律丢弃并计数，不静默截断：
# 截断会把「模型写了一大段」伪装成「模型写得很克制」，那是替它掩饰。
MAX_PROPOSALS = 8
LIMITS = {"suggestion": 400, "evidence": 300, "section": 60, "direction": 80}

# agent 步数上限。素材已经全部喂进目标文本，正常一步就能收敛；
# 留几步是给它必要时用 get_stats / read_knowledge 复核用的。
# 本机通道每次调用约 2.3 万 token 固定开销，步数就是钱。
AGENT_MAX_STEPS = 4

# 目标文本字数闸。agent.run 默认按 600 字切目标（那是给「销售在输入框里打的一句话」
# 定的），周复盘的目标里带着整份素材（实测约 3.2 千字），按默认切等于把素材从中间
# 截断，模型只看到前几个数字就开始编。所以显式放宽到 20000。
#
# 超过这个数**不截断、直接判失败**：截断会让模型基于半份素材提建议，
# 而提案上还写着「依据：素材里的数字」——那是在生产看起来有据可依的假建议。
WEEKLY_GOAL_LIMIT = 20000

SCORE_BUCKETS = ((80, 100, "高分(≥80，出卡线)"), (60, 79, "中分(60-79)"),
                 (0, 59, "低分(<60)"))


# ---------------------------------------------------------------- 小工具
def _read_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def _write_json_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def week_key(day=None):
    """ISO 周号，形如 2026-W35。跨年周由 isocalendar 自己处理，不用自己算。

    槽位键必须含周号：只含日期的话「每周一」这个槽在下一个周一会被认成
    同一个键（旧实现的 fired 集合按 date 存），跨周复用直接出错。
    """
    d = day or dt.date.today()
    if isinstance(d, dt.datetime):
        d = d.date()
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _cutoff(days, today=None):
    """窗口起点。与 harness.source_coverage_lines 口径保持一致：
    date >= today-days，含今天，实际跨 days+1 个自然日。
    两处口径不一样比窗口宽一天更糟——数字对不上就没人再信这张表。"""
    today = today or dt.date.today()
    return (today - dt.timedelta(days=days)).isoformat()


def _now():
    return dt.datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- 素材收集
# 纪律与 harness 一致：任何一段取不到就如实写「不可读：原因」，
# **绝不拿 0 顶替**——「本周 0 条新线索」和「我根本没读到库」对下一步的含义相反。

def _memory_window(cutoff):
    """本周新增记忆。口径：harness.read_memory() 的 created_at（写入时刻）前 10 位 >= cutoff。

    记忆条目形如 {id, content, created_at}，由界面 /api/memory 或 agent 的
    remember 工具写入 ~/.config/hydrogen-radar/memory.json。
    """
    items = harness.read_memory()
    new = [{"id": str(it.get("id") or ""), "content": str(it.get("content") or ""),
            "created_at": str(it.get("created_at") or "")}
           for it in items if str(it.get("created_at") or "")[:10] >= cutoff]
    return {"total": len(items), "new_count": len(new), "new_items": new}


def _db_window(cutoff):
    """本周运行数据。全部纯 SQL，口径逐条写明：

    · new_signals —— signals.fetched_at（**入库时刻**，不是公告发布时间）。
      复盘问的是「我们这周干了什么」，用 published_at 会把补抓的旧公告算进来。
    · new_leads   —— leads.created_at（抽取阶段写入的时刻）。
    · new_cards   —— cards.created_at。
    · 评分分布    —— 本周新增线索按 score 分档；score IS NULL 单列「未评分」。
    · 判非商机    —— 本周新增线索里 status='rejected' 的占比
      （pipeline 抽取阶段判定「这不是商机」的那一类）。
    · 各来源产出  —— 本周新增信号按 signals.source 分组；
      并给出这些信号派生出的线索数（leads JOIN signals），两个口径分开列。
    """
    from db import connect
    conn = connect()
    try:
        def scalar(sql, args=()):
            row = conn.execute(sql, args).fetchone()
            return row[0] if row else 0

        out = {
            "new_signals": scalar(
                "SELECT COUNT(*) FROM signals WHERE substr(fetched_at,1,10) >= ?",
                (cutoff,)),
            "new_leads": scalar(
                "SELECT COUNT(*) FROM leads WHERE substr(created_at,1,10) >= ?",
                (cutoff,)),
            "new_cards": scalar(
                "SELECT COUNT(*) FROM cards WHERE substr(created_at,1,10) >= ?",
                (cutoff,)),
            "db_total": {
                "signals": scalar("SELECT COUNT(*) FROM signals"),
                "leads": scalar("SELECT COUNT(*) FROM leads"),
                "cards": scalar("SELECT COUNT(*) FROM cards"),
            },
        }

        buckets = {}
        for lo, hi, label in SCORE_BUCKETS:
            buckets[label] = scalar(
                "SELECT COUNT(*) FROM leads WHERE substr(created_at,1,10) >= ?"
                " AND score IS NOT NULL AND score BETWEEN ? AND ?", (cutoff, lo, hi))
        buckets["未评分(score IS NULL)"] = scalar(
            "SELECT COUNT(*) FROM leads WHERE substr(created_at,1,10) >= ?"
            " AND score IS NULL", (cutoff,))
        out["score_buckets"] = buckets

        by_status = {}
        for r in conn.execute(
                "SELECT COALESCE(status,'(空)') AS s, COUNT(*) AS n FROM leads"
                " WHERE substr(created_at,1,10) >= ? GROUP BY s ORDER BY n DESC",
                (cutoff,)):
            by_status[r["s"]] = r["n"]
        out["by_status"] = by_status
        rejected = by_status.get("rejected", 0)
        total = out["new_leads"]
        out["rejected_ratio"] = (round(rejected / total, 3) if total else None)
        out["rejected_count"] = rejected

        out["by_source_signals"] = [
            {"source": r["source"] or "(未注明)", "signals": r["n"]}
            for r in conn.execute(
                "SELECT source, COUNT(*) AS n FROM signals"
                " WHERE substr(fetched_at,1,10) >= ? GROUP BY source ORDER BY n DESC",
                (cutoff,))]
        out["by_source_leads"] = [
            {"source": r["source"] or "(未注明)", "leads": r["n"],
             "rejected": r["rej"]}
            for r in conn.execute(
                "SELECT s.source AS source, COUNT(*) AS n,"
                " SUM(CASE WHEN l.status='rejected' THEN 1 ELSE 0 END) AS rej"
                " FROM leads l JOIN signals s ON s.id = l.signal_id"
                " WHERE substr(l.created_at,1,10) >= ?"
                " GROUP BY s.source ORDER BY n DESC", (cutoff,))]
        return out
    finally:
        conn.close()


def _reach_window(cutoff):
    """撞墙与额度。素材来自 reach 的审计日志（只追加的 jsonl）与本机账本。

    口径：只看审计日志**尾部**（harness.AUDIT_TAIL_LINES 行）里 ts 落在窗口内的记录。
    尾部读不到早期记录是事实，如实写在 note 里，不假装是全量。
    """
    out = {"note": f"仅统计触网审计日志尾部 {harness.AUDIT_TAIL_LINES} 行内、"
                   f"ts >= {cutoff} 的记录"}
    recs = harness._audit_tail_records()          # 读不到就抛，由调用方记 errors
    win = [r for r in recs if str(r.get("ts") or "")[:10] >= cutoff]
    out["records_in_window"] = len(win)
    out["search_count"] = sum(1 for r in win if r.get("kind") == "search")
    out["fetch_count"] = sum(1 for r in win if r.get("kind") == "fetch")
    out["search_fail_count"] = sum(1 for r in win if r.get("kind") == "search_fail")

    tally = {}
    for r in win:
        if r.get("kind") != "dead_end":
            continue
        host = (urlparse(str(r.get("url") or "")).hostname or "未知域").lower()
        key = (harness._reason_key(r.get("reason")), host)
        tally[key] = tally.get(key, 0) + 1
    out["dead_ends"] = [{"reason": k[0], "host": k[1], "count": n}
                        for k, n in sorted(tally.items(), key=lambda kv: -kv[1])[:10]]
    out["dead_end_total"] = sum(tally.values())
    out["queries"] = [str(r.get("query") or "")[:80]
                      for r in win if r.get("kind") == "search"][-12:]
    return out


def collect_material(days=7, today=None):
    """收集复盘素材。**零模型调用**，全部是代码统计。

    返回结构化 dict；每一段独立降级，失败原因写进 errors，不影响其余几段。
    """
    today = today or dt.date.today()
    cutoff = _cutoff(days, today)
    mat = {
        "window": {"days": days, "from": cutoff, "to": today.isoformat(),
                   "week": week_key(today),
                   "note": "窗口口径：日期 >= today-days（含今天），"
                           "与 harness 源覆盖快照一致"},
        "generated_at": _now(),
        "errors": {},
    }

    for name, fn in (("memory", lambda: _memory_window(cutoff)),
                     ("db", lambda: _db_window(cutoff)),
                     ("reach", lambda: _reach_window(cutoff))):
        try:
            mat[name] = fn()
        except Exception as e:
            mat[name] = None
            mat["errors"][name] = f"{type(e).__name__}: {e}"

    try:
        mat["knowledge"] = {"sections": harness.knowledge_sections(),
                            "docs": harness.knowledge_docs()}
    except Exception as e:
        mat["knowledge"] = None
        mat["errors"]["knowledge"] = f"{type(e).__name__}: {e}"

    try:
        mat["preferences"] = harness.read_prefs()
    except Exception as e:
        mat["preferences"] = None
        mat["errors"]["preferences"] = f"{type(e).__name__}: {e}"

    try:
        import reach
        mat["quota"] = {"bocha_remaining": reach.bocha_remaining(),
                        "bocha_total": reach.BOCHA_TOTAL,
                        "proposals_pending": len(reach.list_proposals("pending"))}
    except Exception as e:
        mat["quota"] = None
        mat["errors"]["quota"] = f"{type(e).__name__}: {e}"

    return mat


# ---------------------------------------------------------------- 提示词
_PROMPT_HEAD = """这是「氢能商机雷达」的每周复盘（{week}，窗口 {frm} ~ {to}）。

下面 <material> 里的每一个数字都是系统**代码统计**出来的真实值，不是估算。
你的任务只有一件：读这些数字，提出**下周可以立刻执行的优化动作**。

<material>
{material}
</material>

硬规矩（违反的条目会被系统直接丢弃，不会进审批队列）：
1. 提案类型只有三种，别的一律不收：
   - knowledge_edit：建议往 knowledge.md 的某一节补一句或改一句
     （section 必须写清是哪一节，可用小节名见素材 knowledge.sections）
   - preference_edit：建议调整销售偏好（focus_regions / focus_products /
     min_score / exclude_regions / tone）或调整长期记忆
   - source_focus：建议下周把检索/采集重心放在哪个方向
2. **每条必须带依据（evidence）**，依据里要出现素材中的具体数字、来源名、
   或记忆条目 id。写不出依据的想法就不要提。
3. **不要泛泛而谈**。「加强数据质量」「提升线索精准度」「持续优化」这类话
   一条都不要。每条 suggestion 必须是一个具体动作：改哪一节、加哪句话、
   把哪个偏好调成什么值、下周搜哪个方向。
4. 数字读不出来（素材里写着「不可读」或为 null）就**不要**基于它提建议，
   也不要猜它是多少。宁可少提几条。
5. 最多 {max_n} 条。宁缺毋滥——每一条都要人来审批，凑数是在浪费人的时间。

收敛时（done:true）的 answer 字段必须是**一个 JSON 对象**，除此之外不要写别的：
{{"proposals":[
  {{"type":"knowledge_edit","section":"小节名","suggestion":"具体改什么","evidence":"依据（带数字）"}},
  {{"type":"preference_edit","suggestion":"具体调什么","evidence":"依据（带数字或记忆 id）"}},
  {{"type":"source_focus","direction":"方向","suggestion":"具体怎么做","evidence":"依据（带数字）"}}
]}}
一条都提不出来就给 {{"proposals":[]}}，那是合法答案，比编一条强。
"""


def build_prompt(material):
    """把素材拼成给 agent 的目标文本。素材原样以 JSON 给出——
    模型看到的和审批人看到的是同一份数字，事后能逐条对得上。"""
    win = material.get("window") or {}
    return _PROMPT_HEAD.format(
        week=win.get("week", "?"), frm=win.get("from", "?"), to=win.get("to", "?"),
        material=json.dumps(material, ensure_ascii=False, indent=1),
        max_n=MAX_PROPOSALS)


# ---------------------------------------------------------------- 提案解析与校验
_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.S)


def _extract_json(text):
    """从 answer 里抠出提案对象。抠不出来就抛 ValueError——绝不「猜」模型想说什么。

    认这几种写法：
      · 已经是 dict/list —— 上游解析过了，直接用；
      · 裸 JSON 文本 / ```json 围栏 / 夹在一段话中间的 JSON；
      · **Python repr**（单引号那种）—— 这不是模型的锅：模型把一个 JSON 对象
        放进了 answer 字段，agent 循环在 agent.py:453 对它做了 str()，
        {"a": 1} 就变成了 "{'a': 1}"。用 ast.literal_eval 认回来。
        literal_eval 只认字面量、不执行代码，喂进来的是模型输出也不会越界。
    """
    if isinstance(text, (dict, list)):
        return text
    text = str(text or "").strip()
    if not text:
        raise ValueError("answer 为空")

    cands = [text] + [m.strip() for m in _FENCE.findall(text)]
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        cands.append(text[start:end + 1])

    for cand in cands:
        try:
            return json.loads(cand)
        except ValueError:
            pass
    for cand in cands:
        try:
            got = ast.literal_eval(cand)
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            continue
        if isinstance(got, (dict, list)):
            return got
    raise ValueError("answer 里找不到合法 JSON 对象")


_NUMBER_OR_ID = re.compile(r"\d|m\d{6,}")


def validate_proposals(raw, sections=None):
    """逐条校验模型给的提案。返回 (accepted, report)。

    丢弃规则（每一条都记进 report.dropped，如实汇报丢了几条、为什么丢）：
      · 整体不是列表 → 全部丢弃；
      · 单条不是对象 / type 不在三种之内 / 缺 evidence / 缺必填字段 → 丢；
      · 任一文本字段超长 → 丢（不截断：截断等于替模型掩饰）；
      · 超过 MAX_PROPOSALS 条的部分 → 丢。

    不丢但打标记的（交给审批人看，不替他判断）：
      · evidence 里没有任何数字或记忆 id → flag "依据里没有出现数字或记忆 id"；
      · knowledge_edit 的 section 不在现有小节清单里 → flag（可能是提议新增小节）。
    """
    report = {"received": 0, "accepted": 0, "dropped": 0, "reasons": [], "flags": []}
    if not isinstance(raw, list):
        report["dropped"] = 1
        report["reasons"].append(f"proposals 不是列表（实际 {type(raw).__name__}），整体丢弃")
        return [], report

    report["received"] = len(raw)
    known = set(sections or [])
    out = []
    for i, item in enumerate(raw):
        def drop(why):
            report["dropped"] += 1
            report["reasons"].append(f"第 {i + 1} 条：{why}")

        if not isinstance(item, dict):
            drop(f"不是对象（{type(item).__name__}）")
            continue
        ptype = str(item.get("type") or "").strip()
        if ptype not in PROPOSAL_TYPES:
            drop(f"type「{ptype or '(空)'}」不在 {'/'.join(PROPOSAL_TYPES)} 之内")
            continue
        evidence = str(item.get("evidence") or "").strip()
        if not evidence:
            drop("缺 evidence（依据）")
            continue
        if len(evidence) > LIMITS["evidence"]:
            drop(f"evidence 超长（{len(evidence)} > {LIMITS['evidence']}）")
            continue
        suggestion = str(item.get("suggestion") or "").strip()
        if len(suggestion) > LIMITS["suggestion"]:
            drop(f"suggestion 超长（{len(suggestion)} > {LIMITS['suggestion']}）")
            continue

        rec = {"type": ptype, "suggestion": suggestion, "evidence": evidence}
        if ptype == "knowledge_edit":
            section = str(item.get("section") or "").strip()
            if not section:
                drop("knowledge_edit 缺 section（要改哪一节）")
                continue
            if len(section) > LIMITS["section"]:
                drop(f"section 超长（{len(section)} > {LIMITS['section']}）")
                continue
            if not suggestion:
                drop("knowledge_edit 缺 suggestion（要补/改什么）")
                continue
            rec["section"] = section
            if known and section not in known:
                rec.setdefault("flags", []).append(
                    f"小节「{section}」不在当前 knowledge.md 小节清单里，可能是提议新增")
        elif ptype == "preference_edit":
            if not suggestion:
                drop("preference_edit 缺 suggestion（要调什么）")
                continue
        else:  # source_focus
            direction = str(item.get("direction") or "").strip()
            if not direction:
                drop("source_focus 缺 direction（方向）")
                continue
            if len(direction) > LIMITS["direction"]:
                drop(f"direction 超长（{len(direction)} > {LIMITS['direction']}）")
                continue
            rec["direction"] = direction

        if not _NUMBER_OR_ID.search(evidence):
            rec.setdefault("flags", []).append("依据里没有出现数字或记忆 id，审批时请回素材核对")
        if rec.get("flags"):
            report["flags"].extend(f"第 {i + 1} 条：{f}" for f in rec["flags"])
        out.append(rec)

    if len(out) > MAX_PROPOSALS:
        extra = len(out) - MAX_PROPOSALS
        out = out[:MAX_PROPOSALS]
        report["dropped"] += extra
        report["reasons"].append(f"超过上限 {MAX_PROPOSALS} 条，丢弃末尾 {extra} 条")
    report["accepted"] = len(out)
    return out, report


# ---------------------------------------------------------------- 幂等状态
def read_state():
    st = _read_json(STATE_PATH, {})
    return st if isinstance(st, dict) else {}


def _record_run(rec):
    st = read_state()
    runs = st.get("runs")
    runs = runs if isinstance(runs, list) else []
    runs.append(rec)
    st["runs"] = runs[-30:]              # 只留最近 30 次，状态文件不当日志用
    st["last"] = rec
    _write_json_atomic(STATE_PATH, st)
    return rec


def week_attempted(now=None, week=None):
    """本周是否**已经尝试过**（不论成败）。给定时调度用。

    与 week_done 的区别正是这轮修的那个洞：week_done 只认成功，
    失败的一周不占坑——这在「人手动重跑」时是对的（失败了当然要能再来）。
    但定时调度的 weekly_fired 只活在进程内存里，服务一重启就清空；
    两者相乘，某周跑失败之后每重启一次就再真跑一轮模型，
    在无人值守时就是一条重复烧额度的路（2026-08-31 对抗审查指出）。
    所以调度路径改用这个更严的判据：本周只要尝试过就不再自动跑，
    要重跑走界面上的强制按钮——那是人的明确意愿，不是重启的副作用。
    """
    week = week or week_key(now)
    for r in read_state().get("runs") or []:
        if isinstance(r, dict) and r.get("week") == week:
            return True
    done, _ = week_done(week)
    return done


def week_done(week=None):
    """本周是否已经产出过复盘。返回 (bool, 说明)。

    两个来源都查：
      ① 状态文件里本周的成功记录（ok=True）；
      ② 审批队列里 payload.week 命中本周的 weekly_review 提案——
         状态文件被删了也不会重复往队列里刷。
    失败的记录不算「已完成」，下次可以重跑。
    """
    week = week or week_key()
    for r in read_state().get("runs") or []:
        if isinstance(r, dict) and r.get("week") == week and r.get("ok"):
            return True, f"状态文件记录本周（{week}）已于 {r.get('finished_at')} 跑过"
    try:
        import reach
        for p in reach.list_proposals(None):
            if not isinstance(p, dict):
                continue
            payload = p.get("payload")
            if (p.get("kind") == PROPOSAL_KIND and isinstance(payload, dict)
                    and payload.get("week") == week):
                return True, f"审批队列里已有本周（{week}）的复盘提案 {p.get('id')}"
    except Exception as e:
        # 队列读不出来不等于没跑过，如实说明，交由调用方决定
        return False, f"（审批队列不可读：{type(e).__name__}: {e}；仅以状态文件为准）"
    return False, f"本周（{week}）尚未产出复盘"


# ---------------------------------------------------------------- 主流程
def run_weekly_review(force=False, dry_run=False, days=7, agent_run=None,
                      max_steps=AGENT_MAX_STEPS):
    """跑一轮周复盘。返回结果摘要 dict（不抛异常，失败也如实返回）。

    agent_run: 仅供测试注入；默认用 agent.run。生产路径不传。
    """
    from llm import LLMUnavailable

    week = week_key()
    started = _now()
    if not force:
        done, why = week_done(week)
        if done:
            return {"ok": True, "skipped": True, "week": week, "reason": why,
                    "proposals": [], "proposal_ids": []}

    material = collect_material(days=days)
    prompt = build_prompt(material)
    if dry_run:
        return {"ok": True, "dry_run": True, "week": week, "material": material,
                "prompt": prompt, "proposals": [], "proposal_ids": []}

    if agent_run is None:
        import agent
        agent_run = agent.run

    def fail(reason, **extra):
        rec = {"week": week, "ok": False, "started_at": started,
               "finished_at": _now(), "error": reason, "proposal_ids": [],
               "proposals": []}
        rec.update(extra)
        _record_run(rec)
        rec["skipped"] = False
        return rec

    if len(prompt) > WEEKLY_GOAL_LIMIT:
        # 宁可这周不出复盘，也不让模型基于半份素材提"有据可依"的建议。
        return fail(f"素材过长（提示词 {len(prompt)} 字 > 上限 {WEEKLY_GOAL_LIMIT}），"
                    "截断后提出的建议依据不可信，本周复盘未产出")

    try:
        # readonly=True 是这一轮的关键闸：复盘的产物是**给人审批的建议**，
        # 所以它自己不该有任何直写通道。不加这个参数时，目录里明摆着
        # set_preference 与 remember（confirm 都是 False），模型完全可以
        # 在提案进队列之前先把偏好改了——「提案只是建议」当场落空
        # （2026-08-31 对抗审查实证）。
        out = agent_run(prompt, max_steps=max_steps,
                        goal_limit=WEEKLY_GOAL_LIMIT, readonly=True)
    except LLMUnavailable as e:
        # 通道不通就是跑不成。不产出任何提案，不用兜底文本凑数。
        return fail(f"LLM 通道不可用，本周复盘未产出：{type(e).__name__}: {e}")
    except Exception as e:
        return fail(f"agent 运行失败，本周复盘未产出：{type(e).__name__}: {e}")

    if not isinstance(out, dict):
        return fail(f"agent 返回了 {type(out).__name__}，不是结果对象")
    if out.get("interrupted"):
        return fail("agent 中途被模型通道中断，未产出提案。"
                    f"中断说明：{str(out.get('answer'))[:300]}")
    if out.get("exhausted"):
        return fail(f"agent 在 {out.get('steps')} 步内没有收敛，未产出提案。")

    try:
        parsed = _extract_json(out.get("answer"))
    except ValueError as e:
        return fail(f"agent 的回答不是可解析的 JSON：{e}",
                    answer_head=str(out.get("answer"))[:300])

    sections = (material.get("knowledge") or {}).get("sections") or []
    accepted, report = validate_proposals(
        parsed.get("proposals") if isinstance(parsed, dict) else parsed, sections)

    ids, propose_errors = [], []
    try:
        import reach
    except Exception as e:
        return fail(f"审批队列模块不可用，提案无处可放：{type(e).__name__}: {e}",
                    validation=report)

    digest = _material_digest(material)
    for rec in accepted:
        payload = dict(rec)
        payload.update({"week": week, "generated_at": started,
                        "window": material.get("window"), "material_digest": digest})
        try:
            ids.append(reach.propose(PROPOSAL_KIND, payload)["id"])
        except Exception as e:
            propose_errors.append(f"{rec.get('type')}：{type(e).__name__}: {e}")

    result = {"week": week, "ok": True, "started_at": started, "finished_at": _now(),
              "steps": out.get("steps"), "validation": report,
              "proposal_ids": ids, "proposals": accepted,
              "propose_errors": propose_errors,
              "material_digest": digest,
              "material_errors": material.get("errors") or {}}
    _record_run(result)
    result["skipped"] = False
    return result


def _material_digest(material):
    """随提案一起存的关键数字，供审批人当场核对依据，不必回头再查一遍库。"""
    db = material.get("db") or {}
    reach_m = material.get("reach") or {}
    mem = material.get("memory") or {}
    return {"new_signals": db.get("new_signals"), "new_leads": db.get("new_leads"),
            "new_cards": db.get("new_cards"),
            "rejected_ratio": db.get("rejected_ratio"),
            "dead_end_total": reach_m.get("dead_end_total"),
            "new_memories": mem.get("new_count")}


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="每周复盘：收集素材 → agent 提优化点 → 进审批队列")
    ap.add_argument("--dry-run", action="store_true",
                    help="只收集素材并打印提示词，不调模型、不产出提案")
    ap.add_argument("--material", action="store_true", help="只打印素材 JSON")
    ap.add_argument("--force", action="store_true", help="无视本周已跑过，强制再跑一轮")
    ap.add_argument("--days", type=int, default=7, help="回看窗口天数，默认 7")
    args = ap.parse_args(argv)

    if args.material:
        print(json.dumps(collect_material(days=args.days), ensure_ascii=False, indent=1))
        return 0

    out = run_weekly_review(force=args.force, dry_run=args.dry_run, days=args.days)
    if args.dry_run:
        print(out["prompt"])
        return 0
    if out.get("skipped"):
        print(f"[weekly] 跳过：{out['reason']}")
        return 0
    if not out.get("ok"):
        print(f"[weekly] 失败：{out['error']}")
        return 1
    rep = out["validation"]
    print(f"[weekly] {out['week']} 完成：模型给 {rep['received']} 条，"
          f"收 {rep['accepted']} 条，丢 {rep['dropped']} 条")
    for why in rep["reasons"]:
        print(f"  [丢弃] {why}")
    for f in rep["flags"]:
        print(f"  [存疑] {f}")
    for pid, p in zip(out["proposal_ids"], out["proposals"]):
        print(f"  [{pid}] {p['type']}：{p.get('section') or p.get('direction') or ''} "
              f"{p['suggestion'][:80]}")
        print(f"        依据：{p['evidence'][:120]}")
    for e in out["propose_errors"]:
        print(f"  [入队失败] {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
