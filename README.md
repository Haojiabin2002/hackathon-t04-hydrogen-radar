# 氢能商机雷达

**v1.0.0** · 氢璞创能 · 浦发·IGNITE 黑客松赛题 T04「氢能产业商机与精准获客 Agent」

从氢能行业公开网站抓取真实招标 / 中标 / 项目公告，用大模型抽取商机字段并做四维打分，
匹配氢璞创能的产品型号，为高分商机生成销售作战卡，最后在网页看板上呈现——
**且每一个字段都能回到公告原文核对**。

面向的用户是氢能设备企业的销售、销售运营与行业情报人员（氢璞官方痛点：市场推广人员不足）。
两条产品原则贯穿始终：**证据先于结论**（每个关键判断可回源，模型推断与公告实证严格区分）、
**阻塞也是真实结果**（模型不可用就如实报错停做，全链路无 mock、无预置应答、无规则引擎兜底）。

---

## 快速开始

仓库里**不包含**虚拟环境和数据库（体积太大、且二进制文件无法做版本合并），
第一次 clone 下来需要自己建一次：

```bash
cd radar && uv venv --python 3.11 && uv pip install -r requirements.txt
```

然后一键跑通全链路（建库 → 爬取 → 抽取评分 → 产品匹配 → 生成作战卡 → 起服务）：

```bash
npm --prefix frontend ci
npm --prefix frontend run build
bash radar/run.sh
```

前两条命令把 React 界面构建到 `radar/web/react/`；后端在同一域名下托管界面和 `/api/*`。
跑完打开 http://127.0.0.1:8000 就是看板。仓库保留了已构建产物，未装 Node.js 也能直接起后端。

只开发前端时，先让后端监听 `127.0.0.1:8000`，再 `npm --prefix frontend run dev`；
后端用其他端口时设 `VITE_DEV_API_TARGET=http://127.0.0.1:你的端口`。

> **前置条件**：`python3.11`、`uv`、`sqlite3`；构建前端另需 Node.js 20+；模型通道三选一
> （本机 `claude` CLI / Codex CLI / OpenAI 兼容 API），在看板「模型通道」页配置与实测。
> 通道不通时 `run.sh` 会跳过抽取/匹配/作战卡并明确提示——按项目规矩**不使用任何替代数据**。

## 验收

```bash
bash radar_accept.sh
```

看到 `ACCEPT PASS` 才算通过。脚本直接查数据库做断言，并抽样回访公告 URL 核对状态码。
**它不允许被修改**——报错就去改代码，不要改脚本。

## 目录速览

| 路径 | 说明 |
|---|---|
| `radar/` | 主程序：采集、研判、Agent、接口、数据库 |
| `frontend/` | React + TypeScript 前端源码；构建产物由 FastAPI 同域托管 |
| `radar_accept.sh` | 验收脚本（不可修改，位置不可移动） |
| `资料/` | 只读材料区：业务需求原文、主办方 T04 企业资料包、其他赛道企业痛点摘录、演示口播稿 |
| `CLAUDE.md` | 给 AI 编码助手的项目约定，**唯一约定来源**，开工前必读 |

## 部署说明

公网部署配置（`Dockerfile` / `railway.json` / `deploy/entrypoint.sh`）已于 2026-08-29 精简移除；
线上既有 Railway 实例不受影响仍在运行。如需重新部署，从 git 历史恢复：

```bash
git checkout 6a65611 -- Dockerfile railway.json deploy/
```

## 协作

本项目由两人协作，代码全部通过 AI 编码助手完成。完整的文件结构、分工边界与全部硬性规矩
写在 **[CLAUDE.md](CLAUDE.md)**。
