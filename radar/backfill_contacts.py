"""一次性回填：把已入库线索的公告联系方式抽出来写进 contacts 表。

背景：联系方式抽取原本长在 api.py 里，每次请求实时跑正则、不落库。
改成落库之后，存量线索（contacts 表建起来之前入库的那些）里是空的，
本脚本把它们补上。

**这不是造数据**：数据源是 signals.raw_text —— 库里已有的真实 HTTP 响应正文，
抽取是纯正则逐字摘取（contacts.py），不调模型、不触网、不推断。
每一条落库记录的 evidence 都能回到原文里搜到。

幂等：同一条线索同一个值不会重复插，可以反复执行。

用法：
    .venv/bin/python backfill_contacts.py            # 只回填在研线索（status='new'）
    .venv/bin/python backfill_contacts.py --all      # 连 rejected/duplicate 一起
    .venv/bin/python backfill_contacts.py --dry-run  # 只看会落多少条，不写库
"""
import argparse

from contacts import save_announcement_contacts, extract_contact
from db import connect, init_db


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="连已判非商机/已归并的线索一起回填（默认只回填 status='new'）")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写库")
    args = ap.parse_args()

    # 先确保 contacts 表存在：老库跑这个脚本时表还没建出来
    init_db()

    conn = connect()
    where = "" if args.all else " WHERE l.status='new'"
    rows = conn.execute(
        "SELECT l.id AS lead_id, l.status, s.raw_text"
        " FROM leads l JOIN signals s ON s.id=l.signal_id" + where +
        " ORDER BY l.id").fetchall()
    scope = "全部" if args.all else "在研"
    print(f"[backfill] {scope}线索 {len(rows)} 条待扫描")

    added = touched = 0
    for r in rows:
        if args.dry_run:
            n = len(extract_contact(r["raw_text"] or ""))
        else:
            n = save_announcement_contacts(conn, r["lead_id"], r["raw_text"] or "",
                                           source_note="backfill_contacts")
        if n:
            added += n
            touched += 1
            print(f"  [+{n}] lead#{r['lead_id']}")
    if not args.dry_run:
        conn.commit()

    total = conn.execute(
        "SELECT COUNT(*) FROM contacts WHERE kind='announcement'").fetchone()[0]
    leads_with = conn.execute(
        "SELECT COUNT(DISTINCT lead_id) FROM contacts"
        " WHERE kind='announcement'").fetchone()[0]
    conn.close()
    verb = "将新增" if args.dry_run else "新增"
    print(f"[backfill] {verb} {added} 条联系人，覆盖 {touched} 条线索")
    print(f"[backfill] contacts 表现有 announcement 记录 {total} 条，"
          f"覆盖 {leads_with} 条线索")
    if not args.dry_run:
        print("[backfill] 幂等：再跑一次新增数应为 0")


if __name__ == "__main__":
    main()
