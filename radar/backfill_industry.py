"""一次性回填：给 industry 字段上线之前就已存在的线索补「所属行业」。

为什么要有这个脚本：radar.db 不进 git，库里的一切都必须能由仓库代码重建。
新字段上线后，新抽取的线索由 pipeline.py 直接写入；存量线索则由本脚本补齐——
**绝不允许手工对 radar.db 执行 SQL 补数据**。

industry 是归类字段（取值域见 knowledge.yaml industry_taxonomy），
不要求在公告原文里逐字出现，但必须落在清单内，模型自造类目一律丢弃。
"""
import sys

import yaml

from db import connect, init_db
from llm import health_check, LLMUnavailable
from pipeline import KB_PATH, _ask_retry, _clean_industry

PROMPT = """你是氢能产业分析师。请判断下面这条商机线索的**采购方所属行业**。

只能从这份清单里原样挑一项，不得自造类目；判不准就选「其他」：
{taxonomy}

采购方：{company}
标的/规模：{power_range}
信号类型：{signal_type}
区域：{region}
公告标题：{title}
公告摘要：{body}

严格只输出一个 JSON 对象，不要任何解释文字：
{{"industry": "清单中的某一项"}}
"""


def run():
    ok, detail = health_check()
    if not ok:
        print(f"LLM 通道不可用：{detail}", file=sys.stderr)
        print("按规矩停做，不使用任何替代品填充。", file=sys.stderr)
        return 2

    init_db()
    with open(KB_PATH, encoding="utf-8") as f:
        taxonomy = yaml.safe_load(f)["industry_taxonomy"]

    conn = connect()
    rows = conn.execute(
        "SELECT l.id, l.company, l.signal_type, l.power_range, l.region,"
        " s.title, s.raw_text FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.status='new' AND coalesce(l.industry,'')=''"
        " ORDER BY l.score DESC").fetchall()
    print(f"[backfill] 待补「所属行业」的线索 {len(rows)} 条")

    done = blank = 0
    for r in rows:
        try:
            res = _ask_retry(PROMPT.format(
                taxonomy="、".join(taxonomy), company=r["company"] or "未提及",
                power_range=r["power_range"] or "未提及",
                signal_type=r["signal_type"] or "未知", region=r["region"] or "未提及",
                title=r["title"], body=(r["raw_text"] or "")[:1200]))
        except LLMUnavailable:
            raise
        except ValueError as e:
            print(f"  [skip] lead#{r['id']} 响应格式异常，跳过: {str(e)[:70]}")
            continue
        val = _clean_industry(res.get("industry"), taxonomy)
        if not val:
            blank += 1
            print(f"  [blank] lead#{r['id']} 模型给出清单外类目，按规矩留空")
            continue
        conn.execute("UPDATE leads SET industry=? WHERE id=?", (val, r["id"]))
        conn.commit()
        done += 1
        print(f"  [ok] lead#{r['id']} {(r['company'] or '未提及')[:24]} -> {val}")

    conn.close()
    print(f"[backfill] 补齐 {done} 条，留空 {blank} 条")
    return 0


if __name__ == "__main__":
    sys.exit(run())
