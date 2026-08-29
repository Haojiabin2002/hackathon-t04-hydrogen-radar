"""商机识别管线：抽取+评分（任务2）、产品匹配（任务3）、作战卡（任务4）。

全部依赖真实 claude 调用；LLM 不可用时直接失败退出，不产出任何未经模型验证的数据。
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import sys
from pathlib import Path

import yaml

from db import connect, init_db
from llm import ask, health_check, LLMUnavailable

KB_PATH = Path(__file__).parent / "knowledge.md"

# 全局互斥锁。管线一轮要跑几小时（每条 signal 一次抽取 + 一次打分，约 10 秒），
# 而「哪些 signal 还没做」是进程启动时取的一次快照——任何在这几小时里另起的
# 第二个进程，都会把第一个还没走到的 signal 从头再做一遍。
# 2026-08-19 与 08-20 各翻过一次车：api.py 的 /api/collect 起了一轮，
# 同时终端里又手敲了一次 pipeline.py extract，17 条公告被抽了两三遍。
# api.py 里的 _collect["running"] 是进程内内存标志，看不见终端里的进程，挡不住这个。
# 锁必须落在文件系统上，才能跨进程生效。
LOCK_PATH = Path(__file__).parent / ".pipeline.lock"


class AlreadyRunning(RuntimeError):
    """已有另一个管线进程持锁。带上持锁者的 pid 与启动时间，便于排查。"""


@contextlib.contextmanager
def exclusive_run(path=LOCK_PATH):
    """独占运行。抢不到锁就抛 AlreadyRunning，绝不并行——
    并行的代价不只是重复行，还有白烧掉的模型额度。"""
    # 不能用 open(path, "w")：那会先截断文件，把持锁者写的 pid 抹掉，
    # 于是报错信息里没法告诉用户是谁在跑。O_CREAT 不截断。
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    f = os.fdopen(fd, "r+")
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            holder = ""
            try:
                holder = f.read().strip()
            except OSError:
                pass
            raise AlreadyRunning(holder or "持锁者信息不可读")
        f.seek(0)
        f.truncate()
        f.write(f"pid={os.getpid()} started={now()}\n")
        f.flush()
        yield
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)
        f.close()

# 正文里必须存在的小节。缺任何一节都直接报错停做——
# 少一节意味着某个 prompt 会拿到空字符串，模型会在没有判据的情况下瞎猜，
# 那比报错严重得多。
REQUIRED_SECTIONS = ("产品谱系", "区域优先级", "商机判定规则", "评分口径")


def parse_kb(text):
    """把 knowledge.md 拆成 (frontmatter, {小节标题: 小节正文})。

    机器契约（权重、行业分类表）走 frontmatter，必须结构化；
    业务知识走正文，原样注入提示词——人怎么写，模型就怎么读。
    """
    if not text.startswith("---"):
        raise ValueError("knowledge.md 缺少 YAML frontmatter（文件须以 --- 开头）")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError("knowledge.md 的 frontmatter 没有闭合的 --- 分隔线")
    meta = yaml.safe_load(parts[1]) or {}
    body = parts[2]

    sections, cur, buf = {}, None, []
    for line in body.splitlines():
        if line.startswith("## "):
            if cur:
                sections[cur] = "\n".join(buf).strip()
            cur, buf = line[3:].strip(), []
        elif cur:
            buf.append(line)
    if cur:
        sections[cur] = "\n".join(buf).strip()
    return meta, sections


def validate_kb(meta, sections):
    """返回问题清单，空列表表示合法。保存前与加载时都走这一关。"""
    problems = []
    w = meta.get("scoring_weights")
    if not isinstance(w, dict):
        problems.append("frontmatter 缺少 scoring_weights")
    else:
        need = ["demand_certainty", "power_match", "customer_type", "region_timing"]
        missing = [k for k in need if not isinstance(w.get(k), int)]
        if missing:
            problems.append(f"scoring_weights 缺少或非整数：{'、'.join(missing)}")
        elif sum(w[k] for k in need) != 100:
            problems.append(f"四项权重之和必须为 100，当前为 {sum(w[k] for k in need)}")
    tx = meta.get("industry_taxonomy")
    if not isinstance(tx, list) or not tx or not all(isinstance(t, str) and t.strip() for t in tx):
        problems.append("industry_taxonomy 必须是非空的字符串列表")
    for s in REQUIRED_SECTIONS:
        if not sections.get(s):
            problems.append(f"正文缺少「## {s}」小节或该节为空")
    return problems


def load_kb():
    with open(KB_PATH, encoding="utf-8") as f:
        meta, sections = parse_kb(f.read())
    problems = validate_kb(meta, sections)
    if problems:
        raise ValueError("knowledge.md 不合法：" + "；".join(problems))
    return {"scoring_weights": meta["scoring_weights"],
            "industry_taxonomy": meta["industry_taxonomy"],
            "sections": sections}


def now():
    return dt.datetime.now().isoformat(timespec="seconds")



def _clean_industry(value, taxonomy):
    """只接受分类表内的取值。模型自造类目就丢弃，宁可留空也不入库脏数据。"""
    v = (value or "").strip()
    return v if v in taxonomy else ""


def _ask_retry(prompt, tries=2):
    """调模型；仅对"响应格式不合法"重试。通道类错误直接上抛，不重试也不降级。"""
    last = None
    for _ in range(tries):
        try:
            res = ask(prompt)
            if not isinstance(res, dict):
                # ask() 对 ```json 围栏内容直接 json.loads，模型输出围栏数组时
                # 会返回 list——下游 .get() 抛 AttributeError 逃出 except ValueError
                # 把整批带崩。在这里统一收口成 ValueError。
                raise ValueError(f"响应是合法 JSON 但不是对象（{type(res).__name__}）")
            return res
        except ValueError as e:
            last = e
    raise last


# ---------- 管线积压账本 ----------

def stage_backlog(threshold=80):
    """各环节待办量。纯 SQL / 纯代码，零模型调用。

    这里是「积压口径」的唯一来源：每个数字用的就是对应 task 函数开头
    圈待办队列的那条 SQL——两处口径若不一致，agent 汇报的数和实际要干的活
    就会打架，所以宁可 tools.py / harness.py 都来 import 这一个函数，
    也不许各自再写一遍查询。
    注意 backfill 与 dedup 不是收敛队列（没有「已处理」标记），
    它们的数字含义是「候选量」而非「未处理量」，调用方展示时要如实区分。
    """
    conn = connect()
    try:
        q = lambda sql, *p: conn.execute(sql, p).fetchone()[0]
        extract = q(
            "SELECT COUNT(*) FROM signals s WHERE length(s.raw_text)>100"
            " AND s.id NOT IN (SELECT signal_id FROM leads)")
        rows = conn.execute(
            "SELECT raw_text FROM signals WHERE length(raw_text)>100"
            " AND id IN (SELECT signal_id FROM leads)").fetchall()
        backfill = sum(1 for r in rows if r["raw_text"].count(DIGEST_MARK) >= 2)
        match = q(
            "SELECT COUNT(*) FROM leads WHERE status='new'"
            " AND (matched_product IS NULL OR matched_product='')")
        cards = q(
            "SELECT COUNT(*) FROM leads WHERE status='new' AND score>=?"
            " AND id NOT IN (SELECT lead_id FROM cards)", threshold)
        new_total = q("SELECT COUNT(*) FROM leads WHERE status='new'")
        signals_total = q("SELECT COUNT(*) FROM signals")
    finally:
        conn.close()
    return {
        "extract": extract,          # 待抽取公告（task2 队列）
        "backfill": backfill,        # 含多条目标记的汇总贴候选（非收敛队列）
        "match": match,              # 待配型线索（task3 队列）
        "cards": cards,              # 达标未出卡（task4 队列）
        "threshold": threshold,
        "new_total": new_total,      # 在研线索总数（dedup 每轮全量重扫这个面）
        "signals_total": signals_total,
    }


# ---------- 任务2：抽取 + 评分 ----------

EXTRACT_PROMPT = """你是氢能产业的商机分析师。下面是一条从氢能行业媒体抓取的公告正文。

请按下面的判定规则，找出这一页里**全部**销售商机，并逐条抽取要素。

【判定规则】
{reject_rules}

【一页可能有多个标的】氢能媒体常发「招投标汇总 / 中标播报」贴：一页里罗列多个互不相干的
采购标的（不同采购方、不同标的物）。**每一个独立标的单独出一条**——
不要只报第一个，也不要把多个标的合并成一条。
但必须去重：同一个标的常在「导读」和正文里各出现一次，**那只算一条**。
判定规则逐条套用，不构成商机的标的直接不要出现在结果里。

【字段抽取的硬约束】company / region / amount / deadline 只能填公告原文中**逐字出现**的内容。
不要用行业常识补全：原文写"中原油田"就填"中原油田"，不要补成"河南濮阳"；
原文写"狮山"就填"狮山"，不要补成"佛山南海"。原文未提及的一律填空字符串。
理由：这些字段会参与区域维度打分并展示给销售回源核对，推断值会让分数虚高且无法验证。

严格只输出一个 JSON 对象，不要任何解释文字，字段如下：
{{
  "opportunities": [
    {{
      "company": "采购方/项目业主名称，未提及填空字符串",
      "subject": "这一条的标的物，一句话，须能和同页其他条目区分开，如：中原油田1000标方PEM电解槽 2套",
      "signal_type": "招标/中标/签约/投运/项目规划/政策 之一",
      "power_range": "涉及的功率或产氢规模，如 300kW、1MW、500Nm3/h；未提及填空字符串",
      "region": "省或城市；未提及填空字符串",
      "amount": "金额或数量，如 650万元、35辆；未提及填空字符串",
      "deadline": "截止或计划时间；未提及填空字符串",
      "industry": "采购方所属行业，**只能从下面这份清单里原样挑一项**：{taxonomy}"
    }}
  ],
  "reject_reason": "若 opportunities 是空数组，一句话说明整页为什么不含商机；否则填空字符串",
  "reject_company": "仅当 opportunities 为空时填：这一页的主体单位（发文机关 / 公司 / 项目业主），未提及填空字符串",
  "reject_signal_type": "仅当 opportunities 为空时填：招标/中标/签约/投运/项目规划/政策 之一"
}}

整页都不含商机时输出 {{"opportunities": [], "reject_reason": "……"}}。
一页最多输出 20 条；真的超过 20 个标的时，保留最像氢燃料电池 / 制氢设备采购的前 20 条。

【关于 industry 的说明】它与上面四个字段性质不同：它是**归类**，
由采购方性质与标的用途判定，不要求在原文里逐字出现，但必须落在给定清单内，
不得自造类目。判不准就填「其他」。

公告标题：{title}
公告正文：{body}
"""

SCORE_PROMPT = """你是氢燃料电池厂商（氢璞创能）的销售总监，要给一条商机线索打分。

评分维度与权重（满分100）：
- 需求确定性 {w_demand} 分
- 功率匹配度 {w_power} 分
- 客户类型 {w_customer} 分
- 区域时机 {w_region} 分

【产品谱系】（功率匹配维度的判据，注意产氢类需求看 Nm³/h、电堆类看 kW）
{catalog}

【评分口径】
{scoring_rubric}

【区域优先级】
{region_table}

线索信息：
公司：{company}
信号类型：{signal_type}
功率/规模：{power_range}
区域：{region}
金额/数量：{amount}
公告标题：{title}
公告摘要：{body}

严格只输出一个 JSON 对象：
{{
  "score": 0到100的整数（四个维度得分之和）,
  "score_reason": "四句话，每句对应一个维度的得分与理由，用；分隔"
}}
"""


MAX_ITEMS_PER_PAGE = 20

# 「一页多标的」的条目分隔标记。氢启未来的汇总贴用 ➤ 分隔，是目前实测到的唯一形态；
# 其他源用别的排版时改 --pattern 即可。
DIGEST_MARK = "➤"

# 切块阈值：条目数达到 CHUNK_MARKS 就把整页切成每块 CHUNK_SIZE 个条目分别抽。
# 依据是实测——中转站对长输出的失败率明显更高，而且是概率性的不是必然的：
# signal#36（11 条目）整页抽三次里失败两次、成功一次用了 49.1s；
# 同一页切成 3 块则 11.8s / 34.2s / 26.2s 全部成功，抽出的标的完全一致。
# 所以切块不是为了更快（合计反而更慢），是为了把单次输出压短、把失败率压下去。
CHUNK_MARKS = 6
CHUNK_SIZE = 4


def _split_page(raw, mark=DIGEST_MARK):
    """把汇总贴按条目标记切块。条目不够多就原样返回单块，不做无谓拆分。"""
    if raw.count(mark) < CHUNK_MARKS:
        return [raw]
    segs = [x.strip() for x in raw.split(mark) if x.strip()]
    if len(segs) <= CHUNK_SIZE:
        return [raw]
    sep = "\n" + mark + " "
    return [mark + " " + sep.join(segs[i:i + CHUNK_SIZE])
            for i in range(0, len(segs), CHUNK_SIZE)]


def _norm(v):
    """归一化：去掉空白与标点，用于页内去重和「是否已入库」比对。"""
    return re.sub(r"[\s　·、,，。.；;：:（）()【】\[\]-]+", "", str(v or "")).lower()


def _extract_page(s_row, kb, taxonomy):
    """抽一页里的全部标的。返回 (items, reject_reason)。

    页内去重在代码里兜一道底——提示词已经要求模型去重了，但去重是确定性判断，
    代码兜底比多信模型一次划算（导读与正文重复罗列同一标的是这类汇总贴的常态）。
    """
    chunks = _split_page(s_row["raw_text"])
    if len(chunks) > 1:
        print(f"  [切块] signal#{s_row['id']} {s_row['raw_text'].count(DIGEST_MARK)} 个条目"
              f" → 切成 {len(chunks)} 块分别抽取")
    items, seen = [], set()
    reject = {"reason": "", "company": "", "signal_type": ""}
    for ck in chunks:
        ext = _ask_retry(EXTRACT_PROMPT.format(
            title=s_row["title"], body=ck[:2500],
            taxonomy="、".join(taxonomy),
            reject_rules=kb["sections"]["商机判定规则"]))
        raw_items = ext.get("opportunities")
        if not isinstance(raw_items, list):
            raise ValueError(f"opportunities 不是数组：{str(raw_items)[:120]}")
        for it in raw_items:
            if not isinstance(it, dict):
                continue
            k = (_norm(it.get("company")), _norm(it.get("subject")))
            if k in seen:
                continue
            seen.add(k)
            items.append(it)
            if len(items) >= MAX_ITEMS_PER_PAGE:
                break
        # 整页判非商机时才用得上；取第一个给出理由的块
        if not reject["reason"]:
            reject = {"reason": str(ext.get("reject_reason", ""))[:200],
                      "company": str(ext.get("reject_company", ""))[:120],
                      "signal_type": str(ext.get("reject_signal_type", ""))[:20]}
        if len(items) >= MAX_ITEMS_PER_PAGE:
            break
    return items, reject


def _score_and_insert(conn, s_row, item, kb, w, taxonomy):
    """给单个标的打分并入库，返回分数。打分响应坏了抛 ValueError，由调用方计 skipped。"""
    sc = _ask_retry(SCORE_PROMPT.format(
        w_demand=w["demand_certainty"], w_power=w["power_match"],
        w_customer=w["customer_type"], w_region=w["region_timing"],
        catalog=kb["sections"]["产品谱系"],
        scoring_rubric=kb["sections"]["评分口径"],
        region_table=kb["sections"]["区域优先级"],
        company=item.get("company", ""), signal_type=item.get("signal_type", ""),
        power_range=item.get("power_range", ""), region=item.get("region", ""),
        amount=item.get("amount", ""), title=s_row["title"],
        # 同页多标的时必须把本条标的物拼进摘要，否则打分模型分不清在给哪一条打分
        body=(f"【本条标的】{item.get('subject', '')}\n"
              + s_row["raw_text"][:1200])))
    try:
        score = int(sc.get("score") or 0)
    except (TypeError, ValueError) as e:
        # score:null / "八十" / 列表——一律按格式异常走 ValueError 路径，不崩批
        raise ValueError(f"score 不是整数: {sc.get('score')!r}") from e
    # subject 必须落库：同一页抽出的多个标的，company 常常相同或为空、标题完全一样，
    # subject 是唯一能把它们区分开的东西。不存它，归并阶段就会把它们误并成一条。
    conn.execute(
        "INSERT INTO leads (signal_id, company, subject, signal_type, power_range, region,"
        " amount, deadline, score, score_reason, industry, status, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (s_row["id"], item.get("company", ""), str(item.get("subject", ""))[:200],
         item.get("signal_type", ""),
         item.get("power_range", ""), item.get("region", ""), item.get("amount", ""),
         item.get("deadline", ""), score,
         sc.get("score_reason", ""), _clean_industry(item.get("industry"), taxonomy),
         "new", now()))
    conn.commit()
    return score


def task2_extract_score(limit=None):
    kb = load_kb()
    w = kb["scoring_weights"]
    taxonomy = kb["industry_taxonomy"]
    conn = connect()
    rows = conn.execute(
        "SELECT s.* FROM signals s WHERE length(s.raw_text)>100 "
        "AND s.id NOT IN (SELECT signal_id FROM leads) ORDER BY s.id"
    ).fetchall()
    if limit:
        rows = rows[:limit]
    print(f"[task2] 待处理 signal {len(rows)} 条")

    made = rejected = skipped = raced = 0
    for s in rows:
        # 第二道闸门。上面那句 NOT IN 是进程启动时的一次性快照，而这个循环要跑几小时；
        # exclusive_run 已经挡住了并行，这里再复查一次，是为了挡住锁之外的路径
        # （比如有人改了别的入口、或者锁文件被误删）。代价是一次本地 SELECT，
        # 收益是省下一次抽取 + 一次打分的模型调用，很划算。
        # 注意只在 extract 路径这么判：汇总贴的多行是同一次 _extract_page 之后
        # 连续插入的，不经过这里；backfill 路径针对的本来就是已有 lead 的 signal。
        if conn.execute("SELECT 1 FROM leads WHERE signal_id=? LIMIT 1",
                        (s["id"],)).fetchone():
            print(f"  [已存在] signal#{s['id']} 已有线索，跳过（快照取出后被另一路写入）")
            raced += 1
            continue
        # 通道断了必须整体停做（死规矩）；单条响应格式坏了则重试一次后跳过，
        # 不能让一条畸形 JSON 把整批任务带崩——跳过的条数最后如实汇报。
        try:
            items, reject = _extract_page(s, kb, taxonomy)
        except LLMUnavailable:
            raise
        except ValueError as e:
            print(f"  [skip] signal#{s['id']} 抽取响应格式异常，跳过: {str(e)[:90]}")
            skipped += 1
            continue

        if not items:
            conn.execute(
                "INSERT INTO leads (signal_id, company, signal_type, status,"
                " score_reason, created_at) VALUES (?,?,?,?,?,?)",
                (s["id"], reject["company"], reject["signal_type"], "rejected",
                 f"非商机：{reject['reason']}", now()))
            conn.commit()
            rejected += 1
            print(f"  [rejected] #{s['id']} {s['title'][:26]} — {reject['reason'][:40]}")
            continue

        if len(items) > 1:
            print(f"  [汇总贴] signal#{s['id']} 识别出 {len(items)} 个标的")
        for it in items:
            try:
                score = _score_and_insert(conn, s, it, kb, w, taxonomy)
            except LLMUnavailable:
                raise
            except ValueError as e:
                print(f"  [skip] signal#{s['id']} 「{str(it.get('subject', ''))[:20]}」"
                      f"评分响应格式异常，跳过: {str(e)[:70]}")
                skipped += 1
                continue
            made += 1
            print(f"  [lead] #{s['id']} {str(it.get('company', '?'))[:18]} "
                  f"score={score} {str(it.get('subject', ''))[:24]}")

    conn.close()
    msg = f"[task2] 新增线索 {made} 条，判非商机 {rejected} 条"
    if skipped:
        msg += f"，因响应格式异常跳过 {skipped} 条（未产出任何未经模型判定的数据）"
    if raced:
        msg += f"，{raced} 条在本轮开跑后已被另一路写入、未重复处理"
    print(msg)


# ---------- 任务2.6：汇总贴增量补抽 ----------

def _norm_overlap(a, b, n=8):
    """归一化后的 a、b 是否存在长度≥n 的公共片段（短串退化为整体包含）。"""
    if not a or not b:
        return False
    if len(a) < n or len(b) < n:
        return a in b or b in a
    return any(a[i:i + n] in b for i in range(len(a) - n + 1))


def _same_target(exist, item):
    """判断新抽出的标的是否就是库里已有的那条。exist=(company, amount, power_range)。

    v3（2026-08-29 二次修正）。v1 只凭采购方子串判同，吞掉同一买家的第二个
    标段（俊瑞绿氢 84 台电解槽实证）；v2 一律要求文本佐证，结果两边公司名
    都为空的行没有任何可走路径、短数量相等也被拒——同一轮实测插出 13 条重复。
    v3 的口径：
      1. 数量串两边都有：完全相等 = 强同源（同页语境），除非采购方明确冲突
         （同页可能有两个「1台」，靠公司区分）；不等但共享 ≥6 字数字片段
         且公司命中（同一金额的两种写法）也算同源；否则是另一个标段。
      2. 数量缺失：公司命中后拿标的物与旧行粘连片段 / power_range 做重叠佐证。
      3. 双方都没点名采购方：只能靠标的物与旧行参数重叠。
    佐证不足宁可放进来——残余重复交 task_dedup，漏真商机比留重复严重。
    """
    ec, ea = _norm(exist[0]), _norm(exist[1])
    ep = _norm(exist[2] if len(exist) > 2 else "")
    ic, ia = _norm(item.get("company")), _norm(item.get("amount"))
    isub = _norm(item.get("subject"))
    company_hit = bool(ic and ec and (ic in ec or ec in ic))
    company_conflict = bool(ic and ec and not company_hit)
    if ia and ea:
        if ia == ea:
            return not company_conflict
        if company_hit and _norm_overlap(ia, ea, 6):
            return True
        return False
    if company_hit:
        glue = ec.replace(ic, "") if ic in ec else ""
        return _norm_overlap(isub, glue, 6) or _norm_overlap(isub, ep, 6)
    if not ic and not ec:
        return _norm_overlap(isub, ep, 6)
    if not ic and ec and len(ec) >= 12 and isub and len(isub) >= 6 \
            and (ec[:12] in isub or isub[:12] in ec):
        return True
    return False


def task_backfill_digests(min_marks=2, limit=None, pattern=DIGEST_MARK):
    """对已入库的汇总贴做增量补抽：只追加本页尚未入库的标的。

    已有线索一条不动——不重新打分、不改 ID、不删不改任何既有行。
    「已入库」按 (采购方, 金额/数量) 归一化后比对，比中即跳过。
    """
    kb = load_kb()
    w = kb["scoring_weights"]
    taxonomy = kb["industry_taxonomy"]
    conn = connect()
    rows = conn.execute(
        "SELECT s.* FROM signals s WHERE length(s.raw_text)>100"
        " AND s.id IN (SELECT signal_id FROM leads) ORDER BY s.id").fetchall()

    cands = [r for r in rows if r["raw_text"].count(pattern) >= min_marks]
    print(f"[backfill] 已入库 signal {len(rows)} 条，其中含 ≥{min_marks} 个"
          f"「{pattern}」的候选汇总贴 {len(cands)} 条；"
          f"其余 {len(rows) - len(cands)} 条不含该标记，本轮不处理")
    if limit:
        cands = cands[:limit]
        print(f"[backfill] --limit 生效，本轮只处理前 {len(cands)} 条")

    added = existed = skipped = 0
    for s in cands:
        # rejected 是页级「非商机」占位行，company 里常是发文机关——
        # 拿它参与判重会把同名机构的真标的压掉，排除（duplicate 保留：标的确实在库）
        have = [(r["company"], r["amount"], r["power_range"]) for r in conn.execute(
            "SELECT company, amount, power_range FROM leads"
            " WHERE signal_id=? AND status!='rejected'", (s["id"],))]
        try:
            items, _reject = _extract_page(s, kb, taxonomy)
        except LLMUnavailable:
            raise
        except ValueError as e:
            print(f"  [skip] signal#{s['id']} 抽取响应格式异常，跳过: {str(e)[:90]}")
            skipped += 1
            continue
        print(f"  signal#{s['id']} {s['title'][:24]} → 识别 {len(items)} 个标的，"
              f"库中已有 {len(have)} 条")
        for it in items:
            hit = next((h for h in have if _same_target(h, it)), None)
            if hit:
                existed += 1
                print(f"    [已有] 「{str(it.get('subject', ''))[:26]}」"
                      f"→ 命中已入库标的（{str(hit[0])[:16]}），不重复插入")
                continue
            try:
                score = _score_and_insert(conn, s, it, kb, w, taxonomy)
            except LLMUnavailable:
                raise
            except ValueError as e:
                print(f"    [skip] 「{str(it.get('subject', ''))[:20]}」评分异常: {str(e)[:60]}")
                skipped += 1
                continue
            have.append((it.get("company", ""), it.get("amount", ""),
                         it.get("power_range", "")))
            added += 1
            print(f"    [new] {str(it.get('company', '?'))[:18]} score={score} "
                  f"{str(it.get('subject', ''))[:28]}")

    conn.close()
    msg = f"[backfill] 补入新线索 {added} 条；{existed} 条判定为已入库、未重复插入"
    if skipped:
        msg += f"；因响应格式异常跳过 {skipped} 条"
    print(msg)


# ---------- 任务2.5：重复线索归并 ----------

DEDUP_PROMPT = """你是氢能产业的商机分析师。下面是 {count} 条已识别的商机线索，
它们来自不同媒体的公告，其中有一些其实指向**同一个采购标的**（同一个项目的同一次采购）。

请把指向同一标的的线索分到一组。判定标准从严：

【算同一标的】
- 采购方与标的物一致，只是不同媒体转载或跟进报道（例：招标公告 + 后续中标公告）
- 同一项目的同一批次设备，功率/规模一致

【不算同一标的】
- 同一家公司的不同项目、不同批次、不同标段
- 采购方相同但标的物不同（例：都是中石化，但一个买电解槽一个买燃料电池车）
- 仅仅是行业、区域或产品类型相同
- **标着「同页第 N/M 条」的线索来自同一篇招投标汇总贴，它们是这一页里互不相干的
  多个标的，绝不能互相归并**。这类线索的标题一字不差、采购方还常常为空，
  请只看「标的」字段来区分它们。

只有证据明确时才归并。**拿不准就不要归组**——错误归并会让销售漏掉一个真实商机，
比放过一条重复线索严重得多。

线索清单：
{listing}

严格只输出一个 JSON 对象，不要任何解释文字：
{{
  "groups": [
    {{
      "subject": "这一组共同指向的标的，一句话，须包含采购方与标的物，如：中原油田 PEM电解槽 1000Nm³/h",
      "lead_ids": [上面清单里的 id，至少 2 个],
      "evidence": "一句话说明凭什么判定它们是同一标的"
    }}
  ]
}}

若没有任何一组构成重复，输出 {{"groups": []}}。
"""


def refresh_corroboration(conn, keep_id, subject):
    """按**当前全部** dup_of 关系重算留用行的佐证，返回不同来源链接数。

    两个坑都在这里堵掉：
    ① 计数必须按不同 source_url 算，不能按行数算。同一条公告被管线抽了两遍时，
       两行的链接一模一样，按行数算就是把一个来源数了两遍——那是给销售看的
       假佐证强度（2026-08-29 查出 lead#213/358/369 三条都有这个毛病）。
       留用行自己的链接也要排除，否则「另有」不成立。
    ② 必须全量重算，不能只算本轮归并的那几行。旧写法每轮把整段文案覆盖掉，
       于是一条线索被两轮 dedup 先后吸收时，第一轮的佐证来源就此消失
       （lead#13 实际有 3 个来源，文案里只剩 1 个）——那是低报，
       同样是文案与数据对不上。
    """
    own = conn.execute(
        "SELECT s.source_url FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.id=?", (keep_id,)).fetchone()
    urls = sorted({r["source_url"] for r in conn.execute(
        "SELECT s.source_url FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.dup_of=?", (keep_id,)).fetchall()} - {own["source_url"]})
    # 没有第二个来源就留空：宁可留白，也不写一句站不住的「另有 N 个独立来源」。
    text = (f"同一标的「{subject}」另有 {len(urls)} 个独立来源佐证：" + " ".join(urls)
            ) if urls else None
    conn.execute("UPDATE leads SET corroboration=? WHERE id=?", (text, keep_id))
    return len(urls)


def _apply_groups(conn, groups, valid_ids):
    """把模型给出的分组落库。留分数最高的一条，其余标 duplicate。

    与模型调用分离，便于单独验证落库逻辑；只接受清单内的 id，
    模型若返回清单外的 id 一律丢弃，不做任何猜测性补全。
    """
    seen = set()
    merged = 0
    for g in groups:
        ids = [i for i in g.get("lead_ids", []) if i in valid_ids and i not in seen]
        if len(ids) < 2:
            continue
        seen.update(ids)
        # 只取仍是 new 的：已归并过的不再参与，重复执行本函数不会二次吸收
        rows = conn.execute(
            "SELECT l.id, l.score, l.signal_id, s.source_url FROM leads l"
            " JOIN signals s ON s.id=l.signal_id"
            f" WHERE l.status='new' AND l.id IN ({','.join('?' * len(ids))})", ids).fetchall()
        if len(rows) < 2:
            continue

        subject = (g.get("subject") or "").strip()[:120]

        # 同一条公告里抽出的多个标的，按定义就是**不同**标的——页内去重在
        # _extract_page 里已经做过了。模型把它们归成一组，只能说明它在这一组上
        # 分不清谁是谁（汇总贴的 12 条线索标题完全相同，极易看串）。
        # 此时整组丢弃，不做部分归并：DEDUP_PROMPT 自己写着「拿不准就不要归组，
        # 错误归并会让销售漏掉一个真实商机」，那就照办。
        by_signal = {}
        for r in rows:
            by_signal.setdefault(r["signal_id"], []).append(r["id"])
        clashes = {k: v for k, v in by_signal.items() if len(v) > 1}
        if clashes:
            print(f"  [拒并] 组「{subject[:34]}」内含同一公告的多个标的 {clashes}，"
                  f"整组不归并（同页多标的不是重复）")
            continue

        # 留分最高的；同分留 id 最小的（最早抓到的）
        keep = max(rows, key=lambda r: ((r["score"] or 0), -r["id"]))
        dups = [r for r in rows if r["id"] != keep["id"]]
        if not dups:
            continue

        for r in dups:
            conn.execute("UPDATE leads SET status='duplicate', dup_of=? WHERE id=?",
                         (keep["id"], r["id"]))
        # 改指完再重算，这样本轮吸收的行也算得进去
        n_urls = refresh_corroboration(conn, keep["id"], subject)
        if not n_urls:
            print(f"  [注意] lead#{keep['id']} 吸收的 {len(dups)} 条与它同源，"
                  f"无独立来源佐证，corroboration 留空")
        conn.commit()
        merged += len(dups)
        print(f"  [merge] lead#{keep['id']} 吸收 {[r['id'] for r in dups]} — {subject[:40]}")
    return merged


def task_dedup():
    conn = connect()
    rows = conn.execute(
        "SELECT l.id, l.company, l.subject, l.signal_type, l.power_range, l.region,"
        " l.amount, l.signal_id, s.title FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status='new' ORDER BY l.id").fetchall()
    print(f"[dedup] 待查重线索 {len(rows)} 条")
    if len(rows) < 2:
        conn.close()
        return

    # 清单里必须带 subject 和「同页编号」。一条汇总贴能拆出十几条线索，
    # 它们的 title 一字不差、company 还常常为空——只喂 title 的话，
    # 模型看到的就是十几行长得一样的东西，必然乱并。
    same_page = {}
    for r in rows:
        same_page.setdefault(r["signal_id"], []).append(r["id"])

    def _page_tag(r):
        peers = same_page[r["signal_id"]]
        if len(peers) < 2:
            return ""
        return f"｜同页第{peers.index(r['id']) + 1}/{len(peers)}条(公告#{r['signal_id']})"

    listing = "\n".join(
        f"id={r['id']}｜采购方:{r['company'] or '未提及'}"
        f"｜标的:{(r['subject'] or '未记录')[:60]}"
        f"｜类型:{r['signal_type'] or '未知'}｜规模:{r['power_range'] or '未提及'}"
        f"｜区域:{r['region'] or '未提及'}｜金额:{r['amount'] or '未提及'}"
        f"｜标题:{r['title'][:60]}{_page_tag(r)}" for r in rows)

    res = ask(DEDUP_PROMPT.format(count=len(rows), listing=listing))
    merged = _apply_groups(conn, res.get("groups", []), {r["id"] for r in rows})
    conn.close()
    print(f"[dedup] 归并重复线索 {merged} 条")


# ---------- 任务3：产品匹配 ----------

MATCH_PROMPT = """你是氢璞创能的产品经理。根据下面的产品目录，为这条商机线索推荐最合适的产品型号。

产品谱系（只能从中选择，不得虚构型号）：
{catalog}

商机线索：
公司：{company}
信号类型：{signal_type}
功率/规模：{power_range}
区域：{region}
金额/数量：{amount}
公告标题：{title}
公告摘要：{body}

严格只输出一个 JSON 对象：
{{
  "matched_product": "产品目录中的型号名称；若确实无合适产品填 无匹配",
  "match_reason": "一到两句话说明为什么推荐它，要引用功率段或应用场景的具体依据"
}}
"""


def task3_match(limit=None):
    kb = load_kb()
    catalog = kb["sections"]["产品谱系"]
    conn = connect()
    rows = conn.execute(
        "SELECT l.*, s.title, s.raw_text FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status='new' AND (l.matched_product IS NULL OR l.matched_product='')"
        " ORDER BY l.score DESC").fetchall()
    if limit:
        rows = rows[:limit]
    print(f"[task3] 待匹配线索 {len(rows)} 条")

    done = skipped = 0
    for l in rows:
        # 通道断了整体停做（死规矩）；单条响应格式坏了重试一次后跳过，
        # 不能让一条畸形 JSON 把整批匹配带崩——与 task2 的约定一致。
        try:
            res = _ask_retry(MATCH_PROMPT.format(
                catalog=catalog, company=l["company"], signal_type=l["signal_type"],
                power_range=l["power_range"], region=l["region"], amount=l["amount"],
                title=l["title"], body=l["raw_text"][:1500]))
        except LLMUnavailable:
            raise
        except ValueError as e:
            print(f"  [skip] lead#{l['id']} 匹配响应格式异常，跳过: {str(e)[:90]}")
            skipped += 1
            continue
        conn.execute("UPDATE leads SET matched_product=?, match_reason=? WHERE id=?",
                     (res.get("matched_product", ""), res.get("match_reason", ""), l["id"]))
        conn.commit()
        done += 1
        print(f"  [match] lead#{l['id']} -> {res.get('matched_product','?')}")
    conn.close()
    msg = f"[task3] 完成匹配 {done} 条"
    if skipped:
        msg += f"，因响应格式异常跳过 {skipped} 条（留在队列，下轮重试）"
    print(msg)


# ---------- 任务4：作战卡 ----------

CARD_PROMPT = """你是氢璞创能的销售支持。基于下面的线索信息，写一张给销售用的「商机作战卡」。

严格要求：
1. 必须包含四个二级标题，一字不差：## 时机、## 推荐配置、## 切入话术、## 下一步
2. 卡片里的每个事实只能来自下面给出的线索信息与推荐产品，不得编造联系人姓名、电话、邮箱、职务
3. 输出纯 markdown，不要代码块包裹，不要额外说明
4. 【产业链穿透】氢璞卖的多数是**部件**（电堆、车用/船用系统），而公告的采购主体常常买的是
   **整机或工程**（整车、船、EPC 总承包）。这两者不是同一个客户。所以「## 下一步」的第一条
   必须先回答清楚：
     · 公告主体买的是整机/工程，还是可以直接采购部件？
     · 如果是前者，氢璞的**直接客户不是公告主体**，而是那个会中标整机/工程合同的中间层
       （整车厂、系统集成商、船厂、EPC 总包）——把这一层的名字或识别路径写出来。
     · 如果公告里已经点名了链条上的各方（货主 / 车队 / 整车厂 / 业主 / 总包），
       逐个标明角色，并指出氢璞该打给哪一个。
   判断不了就直说"公告未载，需回源核实"，不许编一个中间商出来。
5. 【客户画像两栏】卡片开头的要点行里，必须并列给出**所属行业**与**应用场景**两项，
   它们是氢璞样例客户信息表里的两个不同字段，不许合并、不许互相顶替：
     · 所属行业 = 采购方是谁（如「钢铁冶金」「船舶与航运」），直接用下面给定的值，不要自造；
     · 应用场景 = 这批货拿去干什么（如「氢能重卡替换」「内河船舶动力清洁化」
       「绿电制氢」「加氢站现场制氢」「厂内物流零碳化」），
       用**动作或用途**表述，不许填行业名顶替。
   应用场景只能由公告里的标的用途推出；公告没交代用途就写「公告未载」，不许猜。
   理由：氢璞内部按应用场景归类客户，不按行业身份——对他们说话要用应用场景的语言。

线索信息：
公司：{company}
所属行业：{industry}
信号类型：{signal_type}
功率/规模：{power_range}
区域：{region}
金额/数量：{amount}
时间：{deadline}
评分：{score}（理由：{score_reason}）
推荐产品：{matched_product}
推荐理由：{match_reason}
公告标题：{title}
公告摘要：{body}
来源链接：{source_url}
"""


def task4_cards(threshold=80):
    conn = connect()
    rows = conn.execute(
        "SELECT l.*, s.title, s.raw_text, s.source_url FROM leads l"
        " JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status='new' AND l.score>=?"
        " AND l.id NOT IN (SELECT lead_id FROM cards) ORDER BY l.score DESC",
        (threshold,)).fetchall()
    print(f"[task4] score>={threshold} 待出卡 {len(rows)} 条")

    made = 0
    for l in rows:
        md = ask(CARD_PROMPT.format(
            company=l["company"], industry=l["industry"] or "未归类",
            signal_type=l["signal_type"], power_range=l["power_range"],
            region=l["region"], amount=l["amount"], deadline=l["deadline"],
            score=l["score"], score_reason=l["score_reason"],
            matched_product=l["matched_product"], match_reason=l["match_reason"],
            title=l["title"], body=l["raw_text"][:1500], source_url=l["source_url"]),
            expect_json=False)
        missing = [h for h in ["时机", "推荐配置", "切入话术", "下一步"] if h not in md]
        if missing:
            print(f"  [warn] lead#{l['id']} 作战卡缺小节 {missing}，跳过入库")
            continue
        conn.execute("INSERT INTO cards (lead_id, content, created_at) VALUES (?,?,?)",
                     (l["id"], md, now()))
        conn.commit()
        made += 1
        print(f"  [card] lead#{l['id']} {l['company'][:20]} ({len(md)}字)")
    conn.close()
    print(f"[task4] 生成作战卡 {made} 张")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["extract", "backfill-digests", "dedup",
                                     "match", "cards", "all"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--threshold", type=int, default=80)
    args = ap.parse_args()

    ok, detail = health_check()
    if not ok:
        print(f"LLM 通道不可用：{detail}", file=sys.stderr)
        print("按任务书规矩，任务2/3/4 停做，不使用任何替代品。", file=sys.stderr)
        sys.exit(2)

    # 抢锁要在 health_check 之后、任何写库之前。抢不到就退出，不排队等待——
    # 排队等于把两轮串起来跑，用户在界面上点了「采集」却要等几小时才动，
    # 不如当场说清楚「已有一轮在跑」。退出码 3 与「通道不可用」的 2 区分开。
    try:
        with exclusive_run():
            init_db()
            if args.stage in ("extract", "all"):
                task2_extract_score(args.limit)
            if args.stage == "backfill-digests":
                task_backfill_digests(limit=args.limit)
            if args.stage in ("dedup", "all"):
                task_dedup()
            if args.stage in ("match", "all"):
                task3_match(args.limit)
            if args.stage in ("cards", "all"):
                task4_cards(args.threshold)
    except AlreadyRunning as e:
        print(f"已有另一个管线进程在跑（{e}），本次不启动。", file=sys.stderr)
        print("并行会让同一条公告被抽两遍，既产生重复线索也白烧模型额度。",
              file=sys.stderr)
        sys.exit(3)
