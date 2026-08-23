"""氢能商机雷达 · Agent 循环。

与 pipeline.py 的区别：
  pipeline.py 是 **workflow** —— 代码写死 抽取→归并→匹配→出卡，模型只在固定点被调用。
  agent.py 是 **agent** —— 给定一个目标，由模型自己决定调哪个工具、调几次、何时收敛。

协议用 JSON 而非原生 function calling：我们的通道是 CLI 子进程（工具已被全部禁用），
拿不到原生工具调用。模型每轮输出一个动作对象，我们的代码执行后把观察喂回去。
这样任何通道都能跑，也不需要把工具能力还给子进程。

结构参考 pi（earendil-works/pi, MIT）与 deepseek-harness（deepseek-ai, MIT）：
技能与知识以目录形式进 system prompt，正文按需用工具取——渐进披露。

每一步都记进 trace，界面要能看到 agent 到底做了什么。
一个不能复盘的 agent，和一个编数据的模型一样不可信。
"""
import json
import re
import time

import harness
import tools
from llm import LLMUnavailable, ask

MAX_STEPS = 8

# 内置 API 中转「长生成偶发断连」（见 llm.py 文件头），而 agent 是多步循环——
# 任何一步抖一下整轮就废、已完成的步骤全丢。所以在**循环层**做有限重试。
#
# 注意这不是降级：llm.py 仍然不重试、不切通道、不兜底。这里只做两件事——
#   ① 瞬时故障在步边界重来一次，且**重试本身写进 trace**，界面上看得见；
#   ② 重试用尽或遇到永久故障时，带着已完成的步骤如实收场，不编结论。
_TRANSIENT = re.compile(
    r"ReadTimeout|ConnectTimeout|ConnectionError|SSLError|ChunkedEncoding|"
    r"RemoteDisconnected|Remote end closed|调用超时|API 返回 5\d\d",
    re.I)

# 配置缺失、未登录、401 这类重试一百次也一样，重试只会白烧时间和步数
MAX_TRANSIENT_RETRIES = 2

# 单次工具结果喂回模型的字符上限。给足余量：list_sources 全量约 1900 字符，
# get_lead 带原文摘录更长。超了会显式标注截断，不静默丢。
OBSERVATION_LIMIT = 4000


def _is_transient(detail: str) -> bool:
    return bool(_TRANSIENT.search(detail))

SYSTEM = """你是氢璞创能的销售研判 Agent，在「氢能商机雷达」系统里工作。

氢璞创能做燃料电池电堆与制氢装备。你的职责是基于**系统里已有的真实数据**回答销售的问题、
给出可执行的判断。你没有文件系统、没有 shell、不能上网——只能通过下面的工具访问本系统的数据。

{harness_context}
{focus}
{tool_catalog}

工作方式：
1. 先想清楚要回答什么，缺哪些事实。
2. 一次调一个工具补齐事实。不要凭记忆猜数字——数字一律用 get_stats / search_leads 取。
3. 事实够了就收敛，给出结论。

铁律：
- **不许编造**。工具没返回的东西就是不知道，直说"系统里没有"，不要补全。
- **不许自己数数**。工具返回里带 summary / 计数字段的，直接引用那个数字，
  不要去数清单里有几项——你会数错。没有现成计数的就说"清单如下"，不要硬给总数。
- 引用线索必须带 #ID，方便销售点开核对。
- 涉及具体公告事实时，优先用 get_lead 拿原文摘录核对，不要只依赖评分理由。
- 区分「公告实证」与「系统推断」：线索里 region_trace / company_trace 为 inferred 的字段
  是模型推断的，不是公告写的，引用时必须标明。
- trigger_collect 你不能自己执行，只能在 action 里提议。

每一轮**只输出一个 JSON 对象**，不要额外文字、不要代码块包裹：

调用工具：
{{"thought": "为什么要调这个", "tool": "工具名", "args": {{...}}}}

给出最终答复：
{{"thought": "收敛理由", "done": true, "answer": "给销售看的回答", "action": null}}

action 可选，用于建议界面执行一个动作，只允许：
  {{"type":"open_lead","id":13}} / {{"type":"filter_board","filter":"high"}} / {{"type":"collect"}}
不需要就填 null。

目标：{goal}
"""


def _focus_block(lead_id):
    """把用户在界面上选中的那条线索直接放进上下文。

    不这么做的话，模型得先花一步调 get_lead 才知道在说哪条——
    多一次模型往返（约 7 秒），而这条信息用户在界面上已经明确指定了。
    复用 get_lead 工具而不是自己写 SQL，保证和工具返回的是同一份数据。
    """
    out = tools.execute("get_lead", {"id": lead_id})
    if not out.get("ok"):
        return (f"\n<focus_lead>\n用户指定聚焦线索 #{lead_id}，但读取失败："
                f"{out.get('error')}。据实告知，不要猜这条线索的内容。\n</focus_lead>\n")
    d = out["result"]
    keep = ("id", "company", "region", "score", "score_reason", "matched_product",
            "match_reason", "signal_type", "power_range", "amount", "deadline",
            "industry", "signal_title", "source", "source_url", "published_at",
            "corroboration", "excerpt", "card")
    body = {k: d.get(k) for k in keep if d.get(k) not in (None, "")}
    return ("\n<focus_lead>\n用户在界面上选中了这条线索，优先围绕它回答；"
            "需要别的线索再用工具查。\n"
            + json.dumps(body, ensure_ascii=False, indent=1)
            + "\n</focus_lead>\n")


def run(goal, max_steps=MAX_STEPS, on_step=None, lead_id=None):
    """跑一轮 agent。返回 {answer, action, trace, steps}。

    on_step: 可选回调，每步执行完调用一次，用于流式展示。
    """
    goal = str(goal or "").strip()
    if not goal:
        raise ValueError("目标为空")

    base = SYSTEM.format(
        harness_context=harness.context_block(),
        focus=_focus_block(lead_id) if lead_id else "",
        tool_catalog=tools.catalog_block(),
        goal=goal[:600],
    )
    trace = []
    transcript = []
    proposed_action = None
    retries = 0

    for step in range(1, max_steps + 1):
        prompt = base
        if transcript:
            prompt += "\n\n已经做过的事（按顺序）：\n" + "\n".join(transcript)
            prompt += f"\n\n这是第 {step} 步，最多 {max_steps} 步。"
            if step >= max_steps:
                prompt += "\n**这是最后一步，必须输出 done:true 收敛。**"

        started = time.time()
        try:
            res = ask(prompt, expect_json=True)
        except LLMUnavailable as e:
            detail = str(e)
            if _is_transient(detail) and retries < MAX_TRANSIENT_RETRIES:
                retries += 1
                entry = {"step": step, "error": f"通道瞬时故障，重试（第 {retries} 次）：{detail}",
                         "retry": True, "elapsed_s": round(time.time() - started, 1)}
                trace.append(entry)
                if on_step:
                    on_step(entry)
                transcript.append(f"[第{step}步] 模型通道瞬时故障，本步重来。")
                continue
            # 永久故障或重试用尽：保住已完成的步骤，如实收场
            entry = {"step": step, "error": detail, "ok": False,
                     "elapsed_s": round(time.time() - started, 1)}
            trace.append(entry)
            if on_step:
                on_step(entry)
            used = [x["tool"] for x in trace if x.get("tool") and x.get("ok")]
            return {
                "answer": (
                    f"模型通道在第 {step} 步中断：{detail}\n\n"
                    f"中断前完成了 {len(used)} 次工具调用"
                    f"（{'、'.join(used) if used else '无'}），结果都在执行轨迹里。\n"
                    f"这里不给结论——已有的检索不足以支撑一个回答。"),
                "action": proposed_action,
                "trace": trace,
                "steps": step,
                "interrupted": True,
            }
        except ValueError as e:
            # 模型输出不是合法 JSON：记一笔并让它重来，不静默吞掉
            trace.append({"step": step, "error": f"输出非合法 JSON：{e}"})
            transcript.append(f"[第{step}步] 你的输出不是合法 JSON，请严格只输出一个 JSON 对象。")
            continue

        if not isinstance(res, dict):
            trace.append({"step": step, "error": "输出不是对象"})
            transcript.append(f"[第{step}步] 输出必须是 JSON 对象。")
            continue

        thought = str(res.get("thought") or "")[:400]

        # —— 收敛 ——
        if res.get("done"):
            answer = str(res.get("answer") or "").strip()
            if not answer:
                transcript.append(f"[第{step}步] done 了但 answer 是空的，请给出真正的回答。")
                continue
            action = _clean_action(res.get("action")) or proposed_action
            trace.append({"step": step, "thought": thought, "done": True,
                          "elapsed_s": round(time.time() - started, 1)})
            if on_step:
                on_step(trace[-1])
            return {"answer": answer, "action": action, "trace": trace, "steps": step}

        # —— 调工具 ——
        name = str(res.get("tool") or "")
        args = res.get("args") if isinstance(res.get("args"), dict) else {}
        if not name:
            transcript.append(f"[第{step}步] 既没有 done 也没有 tool，请二选一。")
            continue

        out = tools.execute(name, args)
        if name == "trigger_collect":
            proposed_action = {"type": "collect"}

        entry = {"step": step, "thought": thought, "tool": name, "args": args,
                 "ok": out.get("ok", False), "elapsed_s": round(time.time() - started, 1)}
        if out.get("ok"):
            payload = json.dumps(out["result"], ensure_ascii=False)
            entry["result_preview"] = payload[:600]
        else:
            entry["error"] = out.get("error")
            payload = f"失败：{out.get('error')}"
        trace.append(entry)
        if on_step:
            on_step(entry)

        # 观察截断必须**显式告知**。原来是静默切 1200 字符：
        # list_sources 返回 1887 字符，模型只看到前 3 个源、还是从 JSON 中间硬切的，
        # 然后把半份数据当全份用。截断本身难免（context 有限），
        # 但模型必须知道"这里被切了"，才会选择再查一次而不是照着残缺数据回答。
        if len(payload) > OBSERVATION_LIMIT:
            shown = (f"{payload[:OBSERVATION_LIMIT]}\n"
                     f"…〔结果过长，已截断；完整长度 {len(payload)} 字符。"
                     f"缺的部分请缩小查询范围重查，不要拿这半份当全部〕")
        else:
            shown = payload
        transcript.append(
            f"[第{step}步] 调用 {name}({json.dumps(args, ensure_ascii=False)})\n"
            f"        结果：{shown}")

    # 步数用完还没收敛，如实报告，不编一个结论出来
    return {
        "answer": f"在 {max_steps} 步内没有收敛出结论。已完成的检索见执行轨迹，"
                  f"可以把问题问得更具体一些再试。",
        "action": proposed_action, "trace": trace, "steps": max_steps, "exhausted": True,
    }


_ACTIONS = {"open_lead", "filter_board", "collect"}
_FILTERS = {"all", "high", "mid", "sea", "card", "rej"}


def _clean_action(a):
    if not isinstance(a, dict):
        return None
    t = a.get("type")
    if t not in _ACTIONS:
        return None
    if t == "collect":
        return {"type": "collect"}
    if t == "open_lead":
        try:
            return {"type": "open_lead", "id": int(a.get("id"))}
        except (TypeError, ValueError):
            return None
    f = a.get("filter")
    return {"type": "filter_board", "filter": f} if f in _FILTERS else None


if __name__ == "__main__":
    import sys
    goal = " ".join(sys.argv[1:]) or "现在最值得今天打电话的三条线索是哪几条？为什么？"
    print(f"目标：{goal}\n" + "=" * 60)
    out = run(goal, on_step=lambda e: print(
        f"  [{e['step']}] {e.get('tool','收敛')} "
        f"{'✓' if e.get('ok') or e.get('done') else '✗ ' + str(e.get('error',''))[:60]}"
        f"  {e.get('elapsed_s')}s"))
    print("=" * 60)
    print(out["answer"])
    if out.get("action"):
        print(f"\n[动作提案] {out['action']}")
