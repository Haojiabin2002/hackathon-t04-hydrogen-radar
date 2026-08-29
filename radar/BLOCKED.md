# 待裁决清单

## 【一】claude CLI / SDK 子进程通道未登录（已解决：2026-08-18 登录完成）

**证据（实测 2026-08-14）：**

```
$ claude -p "回复两个字:通了"
Not logged in · Please run /login
```

Python `claude-agent-sdk` 走同一条路（内部 spawn `claude` 子进程），实测同样失败：

```
AssistantMessage(content=[TextBlock(text='Not logged in · Please run /login')],
                 model='<synthetic>', error='authentication_failed')
```

已核对 SDK 源码 `_internal/transport/subprocess_cli.py:809`，它透传了除 `CLAUDECODE`
外的全部环境变量仍认证失败——**证明 host auth 不经环境变量传给子进程**，
而是宿主 app 通过 messaging socket 向当前会话进程注入，不落盘。

排查过的通道，全部不可用：CLI 继承完整环境、CLI 清除环境变量、`ANTHROPIC_API_KEY`（未设置）、
`~/.claude/.credentials.json`（不存在）、Python SDK。

**已采取的解决方式：** 任务2/3/4 改由**会话内子 Agent** 执行——真实 Claude 推理，
非 mock/预置应答/规则引擎。详见 CHANNELS.md。

**仍需领导操作（只为让 run.sh 脱离会话独立跑）：**

```
claude /login
```

完成浏览器授权后 `bash radar/run.sh` 即可从空库全自动复现全链路。

**结案（2026-08-18）：** 领导在终端完成 `claude /login` 浏览器授权，
`run.sh` 全链路已脱离会话独立真跑（含 dedup 的模型归并段）。
2026-08-19 起通道升级为三选一可配置，并钉死 `--model claude-opus-5`，
CLI 子进程加固与隔离探针见 PROGRESS.md 顶部。本项关闭。

---

## 【二】端口 8000 冲突（已解决）

原被领导另一个项目（Eaze 黑客松 call-service，PID 3856，已运行 2 天）占用。
经领导明确授权后停止该进程，8000 已释放，本项目服务正常运行并通过验收。

---

## 【三】管线环节的「提议→确认→执行」回路（待两侧对齐，2026-08-29 提出）

**目标**：让助手页的 Agent 能像调度采集那样调度单个管线环节
（抽取 / 补抽 / 配型 / 出卡），形成「给目标 → 员工查积压 → 提议跑环节 →
人点确认 → 执行 → 汇报」的完整体验。死规矩 4 判定：触发管线环节属外部副作用
（写业务三表 + 花模型额度），必须走 confirm 提案通道，与 trigger_collect 同型。

**数据侧待做（@Haojiabin2002，契约定稿后动工）：**
- tools.py 注册 4 个提案工具：`run_extract` / `run_backfill` / `run_match` / `run_cards`
  （`fn=None, confirm=True`，仿 trigger_collect 先例）
- agent.py：工具调用特判 → `proposed_action={"type":"run_stage","stage":…,"limit":…}`；
  `_ACTIONS` 增加 `run_stage`；SYSTEM 动作清单同步（注意 proposed_action 单槽位）

**呈现侧待做（@MristYun）：**
- api.py：新增单环节执行端点（建议 `POST /api/pipeline/{stage}`，
  复用现成的 `_run_stage` 子进程原语；需检查采集器状态防止与定时 `pipeline.py all` 撞车——
  两个进程并行消费同一待办队列会重复入库）
- frontend：`types.ts` 的 ChatAction 判别联合加 `run_stage` 型；
  AssistantPage / AgentPanel 两份 actionLabel / runAction 加分支
  （现状 else 兜底会把未知 action 误标成「保存偏好」并误发 /api/memory）；
  `ArtAgentTrace.isGated` 从硬编码 `trigger_collect` 改为按
  `/api/agent/tools` 的 `requires_confirm` 判定（否则新 confirm 工具被拦的步骤显示成红色失败）

**顺序约定**：先对齐本契约 → 呈现侧端点与渲染落地 → 数据侧再注册工具
（先注册会在界面上产生误导性红色失败步骤，演示期不可接受）。

**附：同批审查确认的一个结构性缺口（2026-08-29）**——多标的抽取引入的
`subject`（本条标的物）目前只喂给打分 prompt，**不落库**：配型、作战卡、归并
三个环节拿到的是整页正文，同页多标的时无法确定自己在处理哪一条。
根治要给 `leads` 加 `subject` 列，按 CLAUDE.md 三件套（SCHEMA + MIGRATIONS +
写入代码）走，**需两人同意**。加列前的缓解：打分已拼【本条标的】进摘要；
残余错配风险集中在同页多标的的高分线索出卡环节。

---

## 其它待裁决项

无。
