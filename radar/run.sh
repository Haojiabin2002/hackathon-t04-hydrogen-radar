#!/bin/bash
# 氢能商机雷达 · 一键跑通：建库 → 爬取 → 抽取评分 → 产品匹配 → 作战卡 → 起服务
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
PORT="${RADAR_PORT:-8000}"

echo "=========================================="
echo " 氢能商机雷达 MVP · 全链路"
echo "=========================================="

echo "[1/6] 初始化数据库"
$PY db.py

echo "[2/6] 抓取真实公告"
$PY crawler.py

echo "[3/6] LLM 通道健康检查"
if $PY llm.py | grep -q "LLM_MODE: live"; then
    LLM_OK=1
    echo "      通道可用"
else
    LLM_OK=0
    echo "      通道不可用——按任务书规矩，抽取/匹配/作战卡 全部停做，不使用任何替代品"
    echo "      服务启动后可在「模型通道」页选择已登录的 Codex / Claude，或配置 API Key"
fi

if [ "$LLM_OK" = "1" ]; then
    echo "[4/6] 商机抽取 + 四维评分"
    $PY pipeline.py extract
    echo "[5/6] 产品匹配"
    $PY pipeline.py match
    echo "[6/6] 生成作战卡"
    $PY pipeline.py cards
    # 用 Python 改首行，兼容 macOS 与 Linux，且只在真实通道调用成功后标 live
    $PY -c 'from pathlib import Path; p=Path("PROGRESS.md"); s=p.read_text(); p.write_text(__import__("re").sub(r"^LLM_MODE: .*", "LLM_MODE: live", s, count=1), encoding="utf-8")'
else
    echo "[4-6/6] 已跳过（LLM 阻塞）"
    $PY -c 'from pathlib import Path; p=Path("PROGRESS.md"); s=p.read_text(); p.write_text(__import__("re").sub(r"^LLM_MODE: .*", "LLM_MODE: blocked", s, count=1), encoding="utf-8")'
fi

echo "启动服务 http://127.0.0.1:${PORT}"
exec .venv/bin/uvicorn api:app --host 127.0.0.1 --port "$PORT"
