# 氢能商机雷达 · 项目约定

> **这份文件是给 AI 编码助手（Claude Code / Codex 等）看的。开始改任何代码前，先读完。**
>
> 本项目由两人协作，**两人都不直接写代码**，所有改动都由 AI 助手完成。
> 因此下面的规矩不是风格建议，是硬性边界——违反了人是看不出来的，
> 但验收脚本会失败、或者会产出看起来很像真的假数据。

---

## 一、这个项目在做什么

从氢能行业公开网站抓取真实的招标/中标/项目公告 → 用大模型抽取商机字段并做四维打分
→ 匹配氢璞创能的产品型号 → 给高分商机生成销售作战卡 → 在网页看板上呈现，
**且每一个字段都能回到公告原文核对**。

核心价值是「可追溯」。一条编造的线索比没有线索更糟。

---

## 二、文件结构

```
hackathon-t04/
├── CLAUDE.md                          本文件 · 全项目唯一约定来源
├── README.md                          给人看的项目说明（含产品定位）
├── .gitignore                         哪些文件不进 git
│
├── radar_accept.sh                    ⛔ 验收脚本 · 任何人任何情况不得修改 · 位置不可移动
├── 资料/                              只读材料区 · 代码不依赖这里的任何文件
│   ├── 氢璞商机判断.txt                业务需求原文 · knowledge.md 的来源
│   ├── T04_氢能产业商机与精准获客Agent/  主办方给的企业资料包（6 个 PDF/DOC）
│   ├── 其他赛道摘录/                   其余赛道的企业痛点说明 · 跨赛道情报（见其 README）
│   └── VIDEO-SCRIPT.md                演示视频口播稿
│
└── radar/                             主程序
    ├── requirements.txt               依赖清单（锁定版本）
    ├── run.sh                         一键全链路：建库→爬取→抽取→匹配→出卡→起服务
    │
    ├── db.py                          ⛔ 数据契约 · 两人共有，改动需双方同意
    │
    ├── crawler.py                     【数据侧】抓公告 → 写入 signals 表
    ├── pipeline.py                    【数据侧】抽取打分 / 重复归并 / 产品匹配 / 作战卡
    ├── knowledge.md                   【数据侧】业务知识库本体：frontmatter 存机器契约，正文注入提示词
    ├── skills.py                      【数据侧】可装配技能的解析/校验/装填
    ├── skills/*.md                    【数据侧】技能文件：frontmatter 元数据 + 正文提示词
    ├── llm.py                         【数据侧】大模型调用通道
    │
    ├── agent.py                       【数据侧】Agent 循环：模型自主决定调哪个工具、何时收敛
    ├── tools.py                       【数据侧】工具注册表：白名单 + 参数校验 + 由我们的代码执行
    ├── harness.py                     【数据侧】Harness 状态：记忆 / 偏好 / 知识索引 / 技能目录
    │
    ├── api.py                         【呈现侧】FastAPI 接口 + 托管前端 + 版本号来源
    ├── backfill_published.py          【呈现侧】一次性修复脚本：回填公告发布时间
    ├── web/index.html                 【呈现侧】单文件兜底界面（React 构建缺失时回退）
    ├── web/react/                     ⛔ 前端构建产物 · 由 frontend/ 编译生成，不手改
    │
    ├── radar.db                       ⛔ 运行产物 · 不进 git，路径不得移动
    ├── PROGRESS.md                    ⛔ 进度记录 · 顶部 LLM_MODE 被验收读取
    ├── CHANNELS.md                    LLM 通道实测结论
    └── BLOCKED.md                     待裁决 / 阻塞清单
```

前端（【呈现侧】· React 19 + Vite，构建产出到 `radar/web/react/`）：

```
frontend/src/
├── main.tsx                           入口：SettingsProvider → QueryClient → Router
├── styles/                            样式分层，加载顺序即层级，见 index.css 头注释
│   ├── tokens.css                     样式令牌
│   ├── reset.css / utilities.css      归零 / 原子工具类
│   ├── layout.css                     壳骨架：侧栏 + 顶栏 + 多标签 + 内容区
│   ├── components.css                 全站共用组件
│   └── motion.css                     关键帧与过渡
├── config/setting.ts                  外观默认值与可选项的唯一来源
├── router/
│   ├── types.ts                       AppRouteRecord / RouteMeta
│   ├── modules/{work,intelligence,system}.ts   菜单来源
│   └── index.tsx                      由 modules 生成路由表，不手写页面清单
├── layouts/                           AppLayout + sidebar / header / worktab / settings / content
├── components/{base,cards,forms,tables,feedback,layouts}/   Art* 组件层
├── hooks/                             useTable / useSettings / useWorktab / useCollectStatus …
├── api/                               接口客户端与类型（改动需与 api.py 对齐）
└── views/{work,intelligence,system}/  页面，按业务域分组；页面私有 css 就近放
```

### 数据是怎么流动的

```
公告网站  →  crawler.py  →  signals 表  →  pipeline.py  →  leads 表  →  cards 表
                                              ↑                ↓
                                        knowledge.md       api.py  →  web/index.html
```

三张表的定义全部在 `db.py` 里。**数据侧只往表里写，呈现侧只从表里读**，两边不互相调用代码。

---

## 三、绝对不能碰的三样东西

违反任何一条，验收脚本会直接 FAIL。

**1. `radar_accept.sh`**
一个字符都不许改。脚本头部自己写着「执行者不得修改本文件」。
如果它报错，说明代码有问题，去改代码，不要去改脚本让它通过。

**2. `db.py` 里 `SCHEMA` 的表名和字段名**
`signals` / `leads` / `cards` 三张表的字段名被验收脚本用 SQL 直接查询。
改字段名 = 验收失败。**加新字段可以**（要两人同意），**改名或删除绝对不行**。

> 加字段必须同时做三件事，缺一不可：
> ① 写进 `SCHEMA`；② 在 `MIGRATIONS` 里登记一行（否则先建过库的人升级后仍然缺字段）；
> ③ **写出往这个字段里写数据的代码**。
>
> 2026-08-16 就栽在第三件上：`dup_of` / `corroboration` 被手工 `ALTER TABLE` 加进本机数据库、
> 数据由一次性 SQL 写入，前端照着渲染，但 `SCHEMA` 和 `pipeline.py` 里什么都没有。
> 因为 `radar.db` 不进 git，别人 clone 下来从零建库直接 `no such column`，验收当场 FAIL。
> **绝对不许直接对 `radar.db` 执行 SQL 改结构或补数据**——数据库里的一切都必须能由仓库里的代码重建。

**3. `radar/radar.db` 的文件位置**
验收脚本写死了 `cd radar && sqlite3 radar.db`。
不许把数据库移到 `data/` 之类的子目录，不许改 `db.py` 里的 `DB_PATH`。
同理 `radar/PROGRESS.md` 也不能移动（验收会 grep 它）。

---

## 四、数据真实性的死规矩

这几条是整个项目的立身之本。AI 助手最容易在"想让流程跑通"的时候违反它们，
而产出的假数据人眼几乎分辨不出来。

**1. `raw_text` 必须来自真实 HTTP 响应**
不许手工粘贴、不许编造、不许用示例数据填充。

**2. 不绕过任何人机验证**
遇到 WAF / 验证码 / 登录墙，就跳过该来源并记录，不许想办法绕过。

**3. LLM 不可用时必须停做，不许降级**
`llm.py` 里**不许出现任何 mock、预置应答、规则引擎兜底、示例数据分支**。
通道不通就抛 `LLMUnavailable`，让上游任务失败并如实记录在 `BLOCKED.md`。
"先用假数据让 demo 跑起来"是本项目最严重的违规。

**4. Agent 的工具不许还给模型**

`llm.py` 把 CLI 子进程的全部工具和 MCP 都禁掉了，并有隔离探针把关——
公告正文是不可信数据、会原样进 prompt，带工具能力的子进程等于给 prompt injection 开门。

所以 `tools.py` 里的「工具」**不是**还给模型的文件系统 / shell 能力，而是：
模型只输出结构化调用 → 我们的代码按白名单校验 → 我们的代码执行 → 结果喂回循环。

**新增工具时守住这条线**：只暴露本项目自己的数据，
不要引入任何能执行外部命令、访问任意路径或发起任意网络请求的能力。
会产生外部副作用的工具（如触发采集）必须标 `confirm=True`，
由人确认后才执行，agent 不得自行发起。

**5. 模型推断的值不许伪装成实证值**
`api.py` 的 `trace_field()` 会逐片段核对每个字段能否在公告原文里找到。
比如「河南濮阳（中原油田）」里只有"中原油田"命中、"河南濮阳"没有，
整条就必须标成 `inferred`——因为这个地名正在参与区域打分。
**不许为了让界面好看而放宽这个判定**（比如把逐片段检查改成 `any()`）。

---

## 五、文件归属：两人并行开发的边界

两人各开一个分支同时开发。**只改自己名下的文件**，这样 git 合并时不会撞车。

| | 数据侧 | 呈现侧 |
|---|---|---|
| 负责人 | @Haojiabin2002 | @MristYun |
| 可以改 | `crawler.py`<br>`pipeline.py`<br>`knowledge.md`<br>`skills.py`<br>`skills/*.md`<br>`llm.py`<br>`agent.py`<br>`tools.py`<br>`harness.py` | `api.py`<br>`backfill_published.py`<br>`web/index.html`<br>`frontend/**` |
| 只读不改 | `db.py`、呈现侧的所有文件 | `db.py`、数据侧的所有文件 |
| 交界面 | 往 `leads` 表**写** | 从 `leads` 表**读** |

> 归属分配开工前两人确认一次，确认后改这张表。上面是默认建议。

**唯一需要两人打招呼的场景**：要给 `leads` 表加字段的时候。
这时候两人对一下，一起改 `db.py`，立刻合进 main，然后各自继续。

**给 AI 助手的指令**：如果你发现需要修改不属于当前分支的文件，**停下来告诉用户**，
不要自己动手。跨界修改是本项目 merge 冲突的唯一来源。

> 2026-08-29 精简：`DESIGN.md` 及其前端硬约束已废止（用户拍板）；
> `PRODUCT.md` 并入 `README.md`；公网部署配置（`Dockerfile` / `railway.json` / `deploy/`）
> 已删除，线上旧实例仍在运行，需重新部署时执行
> `git checkout 6a65611 -- Dockerfile railway.json deploy/` 恢复。

---

## 六、不要提交进 git 的东西

```
radar/.venv/                    虚拟环境，372MB
radar/radar.db                  SQLite 二进制，git 无法合并，两人各跑一遍必冲突
radar/__pycache__/              编译缓存
frontend/node_modules/          前端依赖
```

`.gitignore` 已经挡住了这些。**不要用 `git add -A` 之后就不检查**，
提交前先看一眼 `git status`，确认没有 `.db` 或 `.venv` 混进去。

因为 `radar.db` 不进 git，**同学 clone 下来之后必须先跑一次 `bash radar/run.sh`**
把数据库建起来、把链路跑通，才能做验收。这是对的——验收本来就该验"能不能从零跑出来"。

---

## 七、版本号

**全项目唯一来源是 `radar/api.py` 里的 `VERSION` 常量。**

升版本只改那一行，OpenAPI 文档、`/api/stats` 接口、看板右上角角标三处会一起变。
`web/index.html` 里那个硬编码的 `v0.0.1` 只是接口没通时的兜底，**不要把它当第二个版本号来维护**。

当前版本：`1.0.0`

---

## 八、改完代码必须做的验证

不许只凭"看起来对"就宣称完成。改完之后：

```bash
# 1. 起服务（验收脚本要调接口）
# 用 python -m 启动，不要用 .venv/bin/uvicorn：
# 那个包装脚本里写死了创建时的绝对路径，项目目录一改名就 bad interpreter。
cd radar && .venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8000

# 2. 另开一个终端跑验收
bash radar_accept.sh
```

看到 `ACCEPT PASS` 才算通过。任何一条 `FAIL:` 都要如实报告，不许绕过。

---

## 九、分支与提交

- **不许直接 push 到 `main`**，一律开分支 + Pull Request
- 分支命名：`data/xxx`（数据侧）、`view/xxx`（呈现侧）、`fix/xxx`（修 bug）
- 每天至少一次 `git fetch origin && git rebase origin/main`，不要攒几天再合
- `main` 分支必须永远能跑通 `run.sh`
- 提交信息用中文，一句话说清改了什么

---

## 十、给 AI 助手的收尾提醒

1. **不确定的时候停下来问**，不要猜。这个项目的两位负责人不读代码，
   你自作主张的改动他们发现不了，但验收和演示会当场翻车。
2. **不要"顺手"重构**。看到不属于你的文件写得不好，忍住。
3. **不要为了让流程跑通而制造数据**。宁可报错、宁可停做、宁可写进 `BLOCKED.md`。
