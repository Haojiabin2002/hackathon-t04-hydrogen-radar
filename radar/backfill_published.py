"""回源补抓 signals 的公告发布时间。

背景：初版 crawler 的正文锚点切割把页面上的「发布时间:」切在正文之前丢掉了，
导致 signals 表只有 fetched_at（抓取时刻），前端时间列 60 条全是同一天。
本脚本回访每条 source_url，把真实发布时间抠出来回填。

用法：.venv/bin/python backfill_published.py
"""
import re
import sqlite3
import time

import requests

DB = "radar.db"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
PUB_RE = re.compile(r"发布时间[:：]\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)")


def fetch_published(url: str) -> str | None:
    """从公告页抓「发布时间」。取不到返回 None，绝不猜。"""
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
        r.encoding = r.apparent_encoding
        m = PUB_RE.search(r.text)
        return m.group(1).strip() if m else None
    except Exception as e:  # 网络波动不该中断整批回填
        print(f"  [err] {url} {e}")
        return None


def main() -> None:
    conn = sqlite3.connect(DB)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(signals)")}
    if "published_at" not in cols:
        conn.execute("ALTER TABLE signals ADD COLUMN published_at TEXT")
        conn.commit()
        print("[schema] signals.published_at 已添加")

    rows = conn.execute(
        "SELECT id, source_url FROM signals "
        "WHERE published_at IS NULL OR published_at=''"
    ).fetchall()
    print(f"[backfill] 待回填 {len(rows)} 条")

    ok = 0
    for sid, url in rows:
        pub = fetch_published(url)
        if pub:
            conn.execute("UPDATE signals SET published_at=? WHERE id=?", (pub, sid))
            conn.commit()
            ok += 1
            print(f"  [ok] #{sid} {pub}")
        else:
            print(f"  [--] #{sid} 页面未载发布时间，保持为空")
        time.sleep(0.4)

    print(f"[backfill] 成功 {ok}/{len(rows)}")
    old = conn.execute(
        "SELECT count(*) FROM signals WHERE published_at < '2026-01-01'"
    ).fetchone()[0]
    print(f"[backfill] 其中 2026 年前的历史存量：{old} 条")
    conn.close()


if __name__ == "__main__":
    main()
