"""一次性修复脚本：清掉「同一条公告被管线抽了多遍」留下的重复线索行。

背景（2026-08-29 查实）：
  pipeline.py 的 extract 闸门是进程启动时取的一次快照（`NOT IN (SELECT signal_id
  FROM leads)`），而一轮要跑几小时。2026-08-19 与 08-20 各有一次两个管线进程
  同时在跑——api.py 的 /api/collect 起了一轮，终端里又手敲了一次——于是
  17 条公告被各抽了两三遍，多出 22 行。根因已在 pipeline.py 修掉（文件锁 +
  插入前复查），这个脚本只负责把存量清干净。

必须和「一条公告合法地拆出多条商机」区分开：招投标汇总贴（氢启未来那批）
一页里就是有十几个互不相干的标的，那些行一条都不能动。所以删除判据取三条，
**全部满足**才删：
  ① 同一 signal 下有多行；
  ② 该公告不是汇总贴（正文里的条目标记少于 pipeline.CHUNK_MARKS 个）；
  ③ 组内各行的业务字段（采购方/类型/规模/区域/金额）归一化后完全相同——
     即确实是同一个标的被抽了多遍，而不是同页的不同标的。
第 ③ 条是安全阀：只要两行代表不同标的，就一定留下来。删错一条真实商机，
比留着一条重复行严重得多。

顺带修一处由这些重复行造成的假数据：留用行的 corroboration 写着
「另有 N 个独立来源佐证」，N 是按**行数**算的，而重复行来自同一条公告、
URL 一模一样——等于把一个来源数了两遍。重算成按不同链接计数。

用法（默认只看不改）：
    python dedupe_leads.py                      # 列出将要删除的行，不写库
    python dedupe_leads.py --apply              # 真正执行
    python dedupe_leads.py --same-buyer         # 另列汇总贴内同采购方的行（只列不删）
    python dedupe_leads.py --drop-ids 1,2 --apply   # 删人核对过的指定行
"""
import argparse
import re
import sys
from collections import defaultdict

from db import connect, init_db
from pipeline import CHUNK_MARKS, DIGEST_MARK, _norm, refresh_corroboration

# status 的保留优先级：数字小的优先留下。
# new 必须排第一——signal#347 就是 duplicate / new / duplicate 三行，
# 留 id 最小的会把唯一那条可见商机删掉。
STATUS_RANK = {"new": 0, "rejected": 1, "duplicate": 2}

# corroboration 旧文案形如：同一标的「XXX」另有 2 个独立来源佐证：http... http...
CORRO_SUBJECT = re.compile(r"同一标的「(.*?)」")


def _fingerprint(row):
    """业务指纹。两行指纹相同 = 同一个标的被抽了多遍。"""
    return tuple(_norm(row[k]) for k in
                 ("company", "signal_type", "power_range", "region", "amount"))


def find_redundant(conn):
    """返回 [(signal_id, keep_row, [drop_row, ...]), ...]。只含确认可删的组。"""
    marks_expr = (f"(LENGTH(s.raw_text)-LENGTH(REPLACE(s.raw_text,'{DIGEST_MARK}','')))"
                  f"/LENGTH('{DIGEST_MARK}')")
    rows = conn.execute(
        "SELECT l.id, l.signal_id, l.company, l.signal_type, l.power_range,"
        " l.region, l.amount, l.status, l.score, l.dup_of, l.corroboration,"
        f" {marks_expr} AS marks"
        " FROM leads l JOIN signals s ON s.id=l.signal_id"
        " WHERE l.signal_id IN (SELECT signal_id FROM leads"
        "                       GROUP BY signal_id HAVING COUNT(*)>1)"
        " ORDER BY l.signal_id, l.id").fetchall()

    by_signal = defaultdict(list)
    for r in rows:
        by_signal[r["signal_id"]].append(r)

    plans, skipped_digest, skipped_distinct = [], [], []
    for sid, group in by_signal.items():
        if group[0]["marks"] >= CHUNK_MARKS:
            skipped_digest.append((sid, len(group), group[0]["marks"]))
            continue
        # 按业务指纹分桶：只有桶内 >1 行才是「同一标的抽了多遍」
        buckets = defaultdict(list)
        for r in group:
            buckets[_fingerprint(r)].append(r)
        for fp, bucket in buckets.items():
            if len(bucket) < 2:
                skipped_distinct.append((sid, bucket[0]["id"]))
                continue
            ordered = sorted(bucket, key=lambda r: (STATUS_RANK.get(r["status"], 9),
                                                    r["id"]))
            plans.append((sid, ordered[0], ordered[1:]))
    return plans, skipped_digest, skipped_distinct


def recompute_corroboration(conn, apply):
    """用 pipeline.refresh_corroboration 重算全部留用行的佐证条数。

    刻意复用管线里的那一份实现，不在这里另写一套——两份逻辑迟早会漂移，
    而这条文案是直接摆在销售面前的佐证强度，漂了就是假数据。

    会改动两类行，都是文案与数据对不上：
      · 虚报：重复行让同一个来源被数了两遍（lead#213 等）；
      · 低报：旧写法每轮覆盖整段文案，早先归并进来的来源被抹掉（lead#13 等）。
    """
    fixed = 0
    for keep in conn.execute(
            "SELECT id, corroboration FROM leads"
            " WHERE corroboration IS NOT NULL AND corroboration != ''").fetchall():
        m = CORRO_SUBJECT.search(keep["corroboration"])
        subject = m.group(1) if m else ""
        old_n = re.search(r"另有 (\d+) 个", keep["corroboration"])
        before = int(old_n.group(1)) if old_n else None

        # 先在事务里算出结果；不 --apply 就写回原值，保证预演绝不改库
        n = refresh_corroboration(conn, keep["id"], subject)
        after = conn.execute("SELECT corroboration FROM leads WHERE id=?",
                             (keep["id"],)).fetchone()["corroboration"]
        if (after or "") == (keep["corroboration"] or ""):
            continue
        if before is None or n == before:
            trend = "整理"      # 条数没变，只是链接去重后重排
        else:
            trend = "虚报" if n < before else "低报"
        print(f"  lead#{keep['id']}：{trend} — 文案写 {before} 个，"
              f"实际 {n} 个不同链接" + ("（清空）" if after is None else ""))
        if not apply:
            conn.execute("UPDATE leads SET corroboration=? WHERE id=?",
                         (keep["corroboration"], keep["id"]))
        fixed += 1
    return fixed


def _same_buyer(a, b):
    """两行的采购方是否为同一家（归一化后互为子串）。

    刻意**不复用** pipeline._same_target：那个函数是抽取管线的判重口径，
    正在被反复调参（v1 只凭采购方子串判同会吞掉同一买家的第二个标的，
    v3 又在修），签名和语义都会变。清理脚本要的是一个不随管线漂移的
    稳定判据——这里只回答「是不是同一家买方」，够不够格算重复由调用方
    连同打印出来的字段一起交给人判断。
    """
    ca, cb = _norm(a["company"]), _norm(b["company"])
    return bool(ca and cb and (ca in cb or cb in ca))


def find_same_buyer(conn):
    """找汇总贴内「同一采购方被抽了两遍」的行。**必须显式 --same-buyer 才启用。**

    单独开一个模式而不是并进 find_redundant，是因为判据弱得多、风险高得多：
    这里只比采购方，不要求业务字段全同——所以**同一家在一页里真有两个
    不同标的时，会被误判为重复**。

    之所以还是要有它：2026-08-29 那轮 backfill 在 6 篇汇总贴里重复抽出了
    6 组同采购方同标的的行（如 #503/#531 中煤平朔的同一批电解槽，
    只是金额写法从「中标金额5976.00万元（主供）」变成「主供5976.00万元」），
    业务字段不全同，find_redundant 的安全阀正好放过它们。

    所以这个模式的产物是**候选清单，不是判决**：每组都打印双方字段，
    人核对完再决定加不加 --apply。
    """
    marks_expr = (f"(LENGTH(s.raw_text)-LENGTH(REPLACE(s.raw_text,'{DIGEST_MARK}','')))"
                  f"/LENGTH('{DIGEST_MARK}')")
    rows = conn.execute(
        "SELECT l.id, l.signal_id, l.company, l.subject, l.signal_type, l.power_range,"
        " l.region, l.amount, l.status, l.score"
        " FROM leads l JOIN signals s ON s.id=l.signal_id"
        f" WHERE {marks_expr} >= {CHUNK_MARKS}"
        " ORDER BY l.signal_id, l.id").fetchall()

    by_signal = defaultdict(list)
    for r in rows:
        by_signal[r["signal_id"]].append(r)

    plans = []
    for sid, group in by_signal.items():
        used = set()
        for i, a in enumerate(group):
            if a["id"] in used or not (a["company"] or "").strip():
                continue
            # 采购方为空的行不参与：没有采购方就没有比对依据，宁可放过
            peers = [b for b in group[i + 1:]
                     if b["id"] not in used and (b["company"] or "").strip()
                     and _same_buyer(a, b)]
            if not peers:
                continue
            bucket = [a] + peers
            ordered = sorted(bucket, key=lambda r: (STATUS_RANK.get(r["status"], 9), r["id"]))
            used.update(r["id"] for r in bucket)
            plans.append((sid, ordered[0], ordered[1:]))
    return plans


def _print_pairs(plans):
    """把每组的双方字段并排打出来，供人核对——这是 --same-buyer 的核心产物。"""
    for sid, keep, drops in plans:
        print(f"  ── signal#{sid} ──")
        for r, tag in [(keep, "保留")] + [(d, "删除") for d in drops]:
            print(f"    [{tag}] #{r['id']:<4} {(r['company'] or '(空)')[:20]:<22}"
                  f" 规模={(r['power_range'] or '-')[:20]:<22}"
                  f" 量={(r['amount'] or '-')[:26]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="真正写库；不加则只打印计划")
    ap.add_argument("--same-buyer", action="store_true",
                    help="只列出汇总贴内同一采购方的多行，供人核对。永不删除")
    ap.add_argument("--drop-ids", default="",
                    help="逗号分隔的 lead id，删除这些行（配合 --apply 生效）。"
                         "给 --same-buyer 的清单用：人核对完把确认是重复的 id 填进来")
    args = ap.parse_args()

    init_db()
    conn = connect()
    plans, skipped_digest, skipped_distinct = find_redundant(conn)

    # --same-buyer 只出清单、绝不自动删。判据只有「采购方互为子串」这一条，
    # 实测 11 组候选里有 5 组是误判：华旺青岛 1692.5万 vs 624万 是两个标段；
    # 国华赤城一个是制氢规模一个是运氢量，像制氢标段与运输标段；
    # lead#39/#42 是旧版抽取的「合集行」，company 粘着整页多个买方，
    # 子串一比就误命中。这种误判删掉的是真实商机，比留一行重复严重得多，
    # 所以删哪几行必须由人看过字段之后用 --drop-ids 点名。
    if args.same_buyer:
        extra = find_same_buyer(conn)
        if extra:
            print(f"[same-buyer] 汇总贴内同采购方的行共 {len(extra)} 组。"
                  f"**这只是候选，不是判决**——逐组核对字段，确认是同一标的的，"
                  f"把要删的 id 用 --drop-ids 传进来：")
            _print_pairs(extra)
        else:
            print("[same-buyer] 没有同采购方的多行")
        print()

    # 人点名要删的行：走和自动清理完全相同的删除路径（cards 检查、dup_of 改指）
    if args.drop_ids:
        want = {int(x) for x in args.drop_ids.replace("，", ",").split(",") if x.strip()}
        for r in conn.execute(
                "SELECT id, signal_id, company, status, score FROM leads"
                f" WHERE id IN ({','.join('?' * len(want))})", sorted(want)).fetchall():
            # 每个点名的行单独成组，保留目标取同 signal 里 id 最小的另一行
            keep = conn.execute(
                "SELECT id, signal_id, company, status, score FROM leads"
                " WHERE signal_id=? AND id!=? ORDER BY id LIMIT 1",
                (r["signal_id"], r["id"])).fetchone()
            if not keep:
                print(f"[drop-ids] #{r['id']} 是 signal#{r['signal_id']} 的唯一一行，跳过")
                continue
            plans.append((r["signal_id"], keep, [r]))
        missing = want - {d["id"] for _, _, drops in plans for d in drops}
        if missing:
            print(f"[drop-ids] 这些 id 不存在或已被跳过：{sorted(missing)}")

    if skipped_digest:
        print(f"[跳过] {len(skipped_digest)} 条汇总贴，一页多标的是设计如此，一行不动：")
        for sid, n, marks in skipped_digest:
            print(f"  signal#{sid}：{n} 条线索 / 正文 {marks} 个「{DIGEST_MARK}」条目标记")
    if skipped_distinct:
        print(f"[跳过] {len(skipped_distinct)} 条线索虽与同公告的其他行并存，"
              f"但业务字段不同（是不同标的），保留")

    total_drop = sum(len(d) for _, _, d in plans)
    if not plans:
        print("[结果] 没有发现「同一标的被抽多遍」的重复行。")
    else:
        print(f"\n[计划] {len(plans)} 组重复，将删除 {total_drop} 行：")
        for sid, keep, drops in plans:
            print(f"  signal#{sid} 保留 lead#{keep['id']}({keep['status']}"
                  f",score={keep['score']})，删除 "
                  + "、".join(f"#{d['id']}({d['status']})" for d in drops)
                  + f" — {(keep['company'] or '采购方未提及')[:24]}")

    # 引用完整性：作战卡指向将被删的行时，绝不能静默删掉——
    # 卡是任务4 的交付物，丢一张就是丢一份销售材料。
    drop_ids = [d["id"] for _, _, drops in plans for d in drops]
    if drop_ids:
        ph = ",".join("?" * len(drop_ids))
        orphan_cards = conn.execute(
            f"SELECT c.id, c.lead_id FROM cards c WHERE c.lead_id IN ({ph})",
            drop_ids).fetchall()
        if orphan_cards:
            print(f"\n[中止] {len(orphan_cards)} 张作战卡挂在将被删的线索上：")
            for c in orphan_cards:
                print(f"  card#{c['id']} → lead#{c['lead_id']}")
            print("请先人工决定这些卡的去向，本脚本不替你改卡的归属。")
            conn.close()
            sys.exit(1)

    if args.apply and plans:
        for sid, keep, drops in plans:
            for d in drops:
                # 别的行若把被删行当作留用目标，改指到本组保留的那行，
                # 否则 dup_of 会变成悬空引用，界面点进去就是 404
                conn.execute("UPDATE leads SET dup_of=? WHERE dup_of=?",
                             (keep["id"], d["id"]))
                conn.execute("DELETE FROM leads WHERE id=?", (d["id"],))
        conn.commit()
        print(f"[执行] 已删除 {total_drop} 行")

    print("\n[佐证条数复核] 按不同来源链接重算：")
    fixed = recompute_corroboration(conn, args.apply)
    if not fixed:
        print("  没有需要修正的行")
    elif args.apply:
        conn.commit()
        print(f"[执行] 已修正 {fixed} 行 corroboration")

    if not args.apply:
        print("\n以上为预演，未写库。确认无误后加 --apply 执行。")
    conn.close()


if __name__ == "__main__":
    main()
