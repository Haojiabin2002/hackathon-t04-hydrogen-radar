# 氢能商机雷达

**v0.1.0** · 氢璞创能 · 黑客松赛题 T04「氢能产业商机与精准获客 Agent」

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
bash radar/run.sh
```

跑完打开 http://127.0.0.1:8000 就是看板。

> **前置条件**：本机装有 `python3.11`、`uv`、`sqlite3`，并至少配置一个真实模型通道。
> 如果通道不可用，`run.sh` 会跳过模型任务并明确提示；按项目规矩此时
> **不使用任何替代数据**。

## 模型通道

看板的「模型通道」页会自动检测并允许选择：

- **Codex（GPT）CLI**：复用本机 ChatGPT/Codex 登录与订阅额度；
- **Claude CLI**：复用本机 Claude 登录；
- **OpenAI SDK**：使用 `OPENAI_API_KEY` 或页面保存的 Key，API 用量单独计费；
- **OpenAI-compatible API**：填写 HTTPS Base URL、模型和 Key。

默认仍是原来的 Claude CLI，未主动保存设置时不会改变历史行为。选定通道失败会直接停止，
不会静默换到其他模型。页面输入的 Key 不回显，保存在仓库外的
`~/.config/hydrogen-radar/llm.json`（权限 `0600`）；部署环境优先使用环境变量。
Codex 通道会显式关闭 shell、浏览器、应用连接器、插件等代理工具，只保留文本推理，
避免公告正文中的提示注入借机读取本机或云端数据；不支持这些禁用开关的旧版 CLI 会安全失败。

公网部署模型设置页时必须配置 `RADAR_SETTINGS_TOKEN`，并在请求中使用
`Authorization: Bearer <token>` 或 `X-Radar-Settings-Token`。未配置口令时设置接口仅允许
从 `localhost` 访问。兼容 API 默认只允许公网 HTTPS；确需连接本地模型服务时显式设置
`RADAR_ALLOW_PRIVATE_LLM_URL=1`。

## 验收

```bash
bash radar_accept.sh
```

看到 `ACCEPT PASS` 才算通过。这个脚本会直接查数据库做断言，并抽样回访公告 URL 核对状态码。
**它不允许被修改**——报错就去改代码，不要改脚本。

## 协作与文件结构

完整的文件结构说明、两人的分工边界、以及所有硬性规矩，
**统一写在 [CLAUDE.md](CLAUDE.md) 里，那是本项目唯一的约定来源**。

本项目由两人协作，代码全部通过 AI 编码助手完成。开工前请先读完 `CLAUDE.md`。

## 目录速览

| 路径 | 说明 |
|---|---|
| `radar/` | 主程序 |
| `radar_accept.sh` | 验收脚本（不可修改） |
| `T04_氢能产业商机与精准获客Agent/` | 主办方企业资料包（只读） |
| `氢璞商机判断.txt` | 业务需求原文 |
| `prototype-v0.1.html` | 早期静态原型，不再维护 |
