#!/bin/bash
# 氢能商机雷达 · 一键跑通：建库 → 爬取 → 抽取评分 → 重复归并 → 产品匹配 → 作战卡 → 起服务
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
PORT="${RADAR_PORT:-8000}"

echo "=========================================="
echo " 氢能商机雷达 MVP · 全链路"
echo "=========================================="

echo "[1/7] 初始化数据库"
$PY db.py

echo "[2/7] 抓取真实公告"
$PY crawler.py

echo "[3/7] LLM 通道健康检查"
if $PY llm.py | grep -q "LLM_MODE: live"; then
    LLM_OK=1
    echo "      通道可用"
else
    LLM_OK=0
    echo "      通道不可用——按任务书规矩，抽取/归并/匹配/作战卡 全部停做，不使用任何替代品"
    echo "      解除办法：在终端执行一次  claude /login"
fi

if [ "$LLM_OK" = "1" ]; then
    echo "[4/7] 商机抽取 + 四维评分"
    $PY pipeline.py extract
    echo "[5/7] 重复线索归并 + 交叉验证"
    $PY pipeline.py dedup
    echo "[6/7] 产品匹配"
    $PY pipeline.py match
    echo "[7/7] 生成作战卡"
    $PY pipeline.py cards
    # 把 PROGRESS.md 的 LLM_MODE 同步为 live
    sed -i '' 's/^LLM_MODE: .*/LLM_MODE: live/' PROGRESS.md
else
    echo "[4-7/7] 已跳过（LLM 阻塞）"
fi

echo "启动服务 http://127.0.0.1:${PORT}"
exec $PY -m uvicorn api:app --host 127.0.0.1 --port "$PORT"
