"""商机识别管线：抽取+评分（任务2）、产品匹配（任务3）、作战卡（任务4）。

全部依赖真实 claude 调用；LLM 不可用时直接失败退出，不产出任何未经模型验证的数据。
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import yaml

from db import connect, init_db
from llm import ask, health_check, LLMUnavailable

KB_PATH = Path(__file__).parent / "knowledge.yaml"


def load_kb():
    with open(KB_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


# ---------- 任务2：抽取 + 评分 ----------

EXTRACT_PROMPT = """你是氢能产业的商机分析师。下面是一条从氢能行业媒体抓取的公告正文。

请判断它是否构成"氢燃料电池/制氢设备供应商的销售商机"，并抽取要素。
以下都不算商机：
1. 会展预告、政策解读、人事任免、行业综述、职业目录这类没有具体采购主体的内容；
2. 标的物与氢能/燃料电池/制氢设备无关的采购——即使它是格式完整、有预算有截止日的正式招标，也判 false；
3. 主角是同业竞争对手（其他燃料电池厂商、其他电解槽/制氢设备厂商）自身的产品发布或交付宣传，且未披露真实采购方。

【字段抽取的硬约束】company / region / amount / deadline 只能填公告原文中**逐字出现**的内容。
不要用行业常识补全：原文写"中原油田"就填"中原油田"，不要补成"河南濮阳"；
原文写"狮山"就填"狮山"，不要补成"佛山南海"。原文未提及的一律填空字符串。
理由：这些字段会参与区域维度打分并展示给销售回源核对，推断值会让分数虚高且无法验证。

严格只输出一个 JSON 对象，不要任何解释文字，字段如下：
{{
  "is_opportunity": true 或 false,
  "reject_reason": "若非商机，一句话说明原因；是商机则空字符串",
  "company": "采购方/项目业主名称，未提及填空字符串",
  "signal_type": "招标/中标/签约/投运/项目规划/政策 之一",
  "power_range": "涉及的功率或产氢规模，如 300kW、1MW、500Nm3/h；未提及填空字符串",
  "region": "省或城市；未提及填空字符串",
  "amount": "金额或数量，如 650万元、35辆；未提及填空字符串",
  "deadline": "截止或计划时间；未提及填空字符串"
}}

公告标题：{title}
公告正文：{body}
"""

SCORE_PROMPT = """你是氢燃料电池厂商（氢璞创能）的销售总监，要给一条商机线索打分。

评分维度与权重（满分100）：
- 需求确定性 {w_demand} 分：已招标/已中标/已签约 高于 规划或意向
- 功率匹配度 {w_power} 分：需求功率段与本公司产品谱系（2.2kW空冷/200kW/300kW/380kW/500kW/1MW电堆、250-1000Nm3/h PEM制氢）的贴合程度
- 客户类型 {w_customer} 分：系统集成商、整车厂、终端大用能企业、船厂、电站业主为高分；与本公司同业的竞争对手为低分
- 区域时机 {w_region} 分：京津冀/广东/河北/上海/河南 五大示范城市群内为高分；海外项目按可达性判断

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


def task2_extract_score(limit=None):
    kb = load_kb()
    w = kb["scoring_weights"]
    conn = connect()
    rows = conn.execute(
        "SELECT s.* FROM signals s WHERE length(s.raw_text)>100 "
        "AND s.id NOT IN (SELECT signal_id FROM leads) ORDER BY s.id"
    ).fetchall()
    if limit:
        rows = rows[:limit]
    print(f"[task2] 待处理 signal {len(rows)} 条")

    made = rejected = 0
    for s in rows:
        body = s["raw_text"][:2500]
        try:
            ext = ask(EXTRACT_PROMPT.format(title=s["title"], body=body))
        except (LLMUnavailable, ValueError) as e:
            print(f"  [fail] signal#{s['id']} 抽取失败: {e}")
            raise

        if not ext.get("is_opportunity"):
            reason = ext.get("reject_reason", "")[:200]
            conn.execute(
                "INSERT INTO leads (signal_id, company, signal_type, status,"
                " score_reason, created_at) VALUES (?,?,?,?,?,?)",
                (s["id"], ext.get("company", ""), ext.get("signal_type", ""),
                 "rejected", f"非商机：{reason}", now()))
            conn.commit()
            rejected += 1
            print(f"  [rejected] #{s['id']} {s['title'][:26]} — {reason[:40]}")
            continue

        sc = ask(SCORE_PROMPT.format(
            w_demand=w["demand_certainty"], w_power=w["power_match"],
            w_customer=w["customer_type"], w_region=w["region_timing"],
            company=ext.get("company", ""), signal_type=ext.get("signal_type", ""),
            power_range=ext.get("power_range", ""), region=ext.get("region", ""),
            amount=ext.get("amount", ""), title=s["title"], body=body[:1200]))

        conn.execute(
            "INSERT INTO leads (signal_id, company, signal_type, power_range, region,"
            " amount, deadline, score, score_reason, status, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (s["id"], ext.get("company", ""), ext.get("signal_type", ""),
             ext.get("power_range", ""), ext.get("region", ""), ext.get("amount", ""),
             ext.get("deadline", ""), int(sc.get("score", 0)),
             sc.get("score_reason", ""), "new", now()))
        conn.commit()
        made += 1
        print(f"  [lead] #{s['id']} {ext.get('company','?')[:18]} "
              f"score={sc.get('score')} {s['title'][:24]}")

    conn.close()
    print(f"[task2] 新增线索 {made} 条，判非商机 {rejected} 条")


# ---------- 任务3：产品匹配 ----------

MATCH_PROMPT = """你是氢璞创能的产品经理。根据下面的产品目录，为这条商机线索推荐最合适的产品型号。

产品目录（只能从中选择，不得虚构型号）：
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
    catalog = "\n".join(
        f"- {p['name']}｜参数:{p['spec']}｜适用场景:{p['scene']}｜目标客户:{p['customer_type']}"
        for p in kb["products"])
    conn = connect()
    rows = conn.execute(
        "SELECT l.*, s.title, s.raw_text FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status!='rejected' AND (l.matched_product IS NULL OR l.matched_product='')"
        " ORDER BY l.score DESC").fetchall()
    if limit:
        rows = rows[:limit]
    print(f"[task3] 待匹配线索 {len(rows)} 条")

    done = 0
    for l in rows:
        res = ask(MATCH_PROMPT.format(
            catalog=catalog, company=l["company"], signal_type=l["signal_type"],
            power_range=l["power_range"], region=l["region"], amount=l["amount"],
            title=l["title"], body=l["raw_text"][:1500]))
        conn.execute("UPDATE leads SET matched_product=?, match_reason=? WHERE id=?",
                     (res.get("matched_product", ""), res.get("match_reason", ""), l["id"]))
        conn.commit()
        done += 1
        print(f"  [match] lead#{l['id']} -> {res.get('matched_product','?')}")
    conn.close()
    print(f"[task3] 完成匹配 {done} 条")


# ---------- 任务4：作战卡 ----------

CARD_PROMPT = """你是氢璞创能的销售支持。基于下面的线索信息，写一张给销售用的「商机作战卡」。

严格要求：
1. 必须包含四个二级标题，一字不差：## 时机、## 推荐配置、## 切入话术、## 下一步
2. 卡片里的每个事实只能来自下面给出的线索信息与推荐产品，不得编造联系人姓名、电话、邮箱、职务
3. 输出纯 markdown，不要代码块包裹，不要额外说明

线索信息：
公司：{company}
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
        " WHERE l.status!='rejected' AND l.score>=?"
        " AND l.id NOT IN (SELECT lead_id FROM cards) ORDER BY l.score DESC",
        (threshold,)).fetchall()
    print(f"[task4] score>={threshold} 待出卡 {len(rows)} 条")

    made = 0
    for l in rows:
        md = ask(CARD_PROMPT.format(
            company=l["company"], signal_type=l["signal_type"], power_range=l["power_range"],
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
    ap.add_argument("stage", choices=["extract", "match", "cards", "all"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--threshold", type=int, default=80)
    args = ap.parse_args()

    ok, detail = health_check()
    if not ok:
        print(f"LLM 通道不可用：{detail}", file=sys.stderr)
        print("按任务书规矩，任务2/3/4 停做，不使用任何替代品。", file=sys.stderr)
        sys.exit(2)

    init_db()
    if args.stage in ("extract", "all"):
        task2_extract_score(args.limit)
    if args.stage in ("match", "all"):
        task3_match(args.limit)
    if args.stage in ("cards", "all"):
        task4_cards(args.threshold)
