#!/bin/bash
# 氢能商机雷达 · 验收脚本 v1 · 执行者不得修改本文件
set -e
cd "$(dirname "$0")/radar"
fail(){ echo "FAIL: $1"; exit 1; }
[ -f radar.db ] || fail "radar.db 不存在"
S=$(sqlite3 radar.db "select count(*) from signals where length(raw_text)>100"); echo "signals(正文>100字)=$S"; [ "$S" -ge 10 ] || fail "signals<10"
L=$(sqlite3 radar.db "select count(*) from leads where score is not null and length(score_reason)>10"); echo "leads(含评分理由)=$L"; [ "$L" -ge 8 ] || fail "leads<8"
M=$(sqlite3 radar.db "select count(*) from leads where length(matched_product)>0 and length(match_reason)>5"); echo "matched=$M"; [ "$M" -ge 6 ] || fail "matched<6"
C=$(sqlite3 radar.db "select count(*) from cards"); echo "cards=$C"; [ "$C" -ge 3 ] || fail "cards<3"
for s in 时机 推荐配置 切入话术 下一步; do
  K=$(sqlite3 radar.db "select count(*) from cards where content like '%$s%'"); echo "卡含[$s]=$K"; [ "$K" -ge 3 ] || fail "作战卡缺[$s]"
done
grep -q "LLM_MODE: live" PROGRESS.md || fail "LLM_MODE 非 live"
echo "-- 来源URL抽样(人工核对状态码) --"
sqlite3 radar.db "select source_url from signals limit 5" | while read -r u; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u"); echo "$c $u"
done
A=$(curl -sf http://127.0.0.1:8000/api/leads) || fail "API /api/leads 不通"
echo "$A" | python3 -c "import sys,json;d=json.load(sys.stdin);assert len(d)>=8,'api leads<8';print('api leads=',len(d))"
ID=$(sqlite3 radar.db "select lead_id from cards limit 1")
curl -sf "http://127.0.0.1:8000/api/leads/$ID/card" | head -c 200; echo
echo "ACCEPT PASS"
