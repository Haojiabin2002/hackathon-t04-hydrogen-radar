# 氢能商机雷达

**v0.5.0** · 氢璞创能 · 黑客松赛题 T04「氢能产业商机与精准获客 Agent」

从氢能行业公开网站抓取真实招标 / 中标 / 项目公告，用大模型抽取商机字段并做四维打分，
匹配氢璞创能的产品型号，为高分商机生成销售作战卡，最后在网页看板上呈现——
**且每一个字段都能回到公告原文核对**。

---

## 快速开始

仓库里**不包含**虚拟环境和数据库（体积太大、且二进制文件无法做版本合并），
所以第一次 clone 下来需要自己建一次：

```bash
cd radar && uv venv --python 3.11 && uv pip install -r requirements.txt
```

然后一键跑通全链路（建库 → 爬取 → 抽取评分 → 产品匹配 → 生成作战卡 → 起服务）：

```bash
npm --prefix frontend ci
npm --prefix frontend run build
bash radar/run.sh
```

前两条命令会把 React 生产界面构建到 `radar/web/react/`；后端会在同一域名下
托管界面和 `/api/*`，因此无需额外配置 API 地址。跑完打开
http://127.0.0.1:8000 就是看板。仓库也保留已构建产物，未安装 Node.js 时仍可直接启动后端。

只开发前端时，可先按默认端口让后端监听 `127.0.0.1:8000`，再启动 Vite：

```bash
npm --prefix frontend run dev
```

如后端使用其他端口，可在启动 Vite 时设置
`VITE_DEV_API_TARGET=http://127.0.0.1:你的端口`。

> **前置条件**：本机装有 `python3.11`、`uv`、`sqlite3`，构建前端时另需 Node.js 20+，
> 以及已登录的 `claude` CLI。
> 如果 CLI 未登录，`run.sh` 会跳过任务 2/3/4 并明确提示——
> 按项目规矩此时**不使用任何替代数据**，在终端执行一次 `claude /login` 即可解除。

## 验收

```bash
bash radar_accept.sh
```

看到 `ACCEPT PASS` 才算通过。这个脚本会直接查数据库做断言，并抽样回访公告 URL 核对状态码。
**它不允许被修改**——报错就去改代码，不要改脚本。

## Railway 公网部署

仓库根目录包含 `Dockerfile`、`railway.json` 与 `deploy/entrypoint.sh`。生产服务需要：

- 挂载持久卷到 `/data`，保存 SQLite、数据源、知识库、技能和本机状态；
- 配置随机生成的 `RADAR_ADMIN_TOKEN`，保护所有 `/api/*` 写操作；
- 将服务端口交给平台注入的 `PORT`，健康检查使用 `/healthz`；
- 将自定义子域名指向 Railway 返回的 CNAME，HTTPS 证书由平台签发。

看板读取保持公开。用户触发采集、修改配置或调用模型时，前端会要求管理员口令，
口令仅保存在当前浏览器会话中，不写入仓库或生产构建。

## 协作与文件结构

完整的文件结构说明、两人的分工边界、以及所有硬性规矩，
**统一写在 [CLAUDE.md](CLAUDE.md) 里，那是本项目唯一的约定来源**。

本项目由两人协作，代码全部通过 AI 编码助手完成。开工前请先读完 `CLAUDE.md`。

## 目录速览

| 路径 | 说明 |
|---|---|
| `radar/` | 主程序 |
| `frontend/` | React + TypeScript 前端源码；生产构建由 FastAPI 同域托管 |
| `radar/web/react/` | 可直接部署的前端生产构建 |
| `radar_accept.sh` | 验收脚本（不可修改） |
| `T04_氢能产业商机与精准获客Agent/` | 主办方企业资料包（只读） |
| `氢璞商机判断.txt` | 业务需求原文 |
| `prototype-v0.1.html` | 早期静态原型，不再维护 |
