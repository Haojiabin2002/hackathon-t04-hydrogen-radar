# LLM 通道说明（实测结论）

本项目的模型调用有三条通道，代码同一套，只是执行者不同：
`claude_cli`（走 Claude 订阅额度）、`codex_cli`（走 ChatGPT 订阅额度）、`api`（按量计费）。

**当前在用：`api` 通道 · 赞助线路1 · claude-opus-5 · Anthropic 原生风格 · 思考档 max。**

---

## 一、三条赞助线路（2026-08-29 接入）

赛事赞助方提供三把 demo key，统称线路1/2/3，全部指向中转 `api.openai-next.com`。

| 线路 | 额度 | 已用 | 余额 | 备注 |
|---|---:|---:|---:|---|
| 线路1 | $500 | $31.20 | $468.80 | 当前在用；**key 已泄露进 git 历史，赛后必须作废** |
| 线路2 | $100 | $0.12 | $99.88 | 全新 |
| 线路3 | $300 | $0.01 | $299.99 | 全新 |

三把 key 的账号可见模型清单**完全一致**（各 648 个，三份排序后清单 MD5 相同），
所以「线路」只换额度池，**不换模型、不换打分口径**——切线路不影响结果可复现性。

⚠️ **有效期**：三把 key 的 `access_until` 均为 `1788019200`，
即 **2026-08-30 00:00（北京时间）** 到期。这是中转自己返回的权威值
（`GET /v1/dashboard/billing/subscription`），不是手工换算的。

### key 的存放

**不进仓库。** 只存 `~/.config/hydrogen-radar/llm.json`（0600），用 stdin 导入：

```bash
echo '{"1":"sk-...","2":"sk-...","3":"sk-..."}' | python llm.py --import-routes
```

走 stdin 不走 argv：argv 对同机任何用户可见，这是最常见的泄露口。

历史教训：2026-08-23~08-29 期间线路1 的 key 以明文写在 `llm.py` 的 `BUILTIN_API` 常量里，
目的是「clone 下来零配置就能跑」。代价是它永久进入 git 历史，改当前文件删不掉。
仓库虽私有，但协作者与拿到访问权的评委都能看到。**赛后必须作废那把 key。**

### 线路管理命令

```bash
python llm.py --routes              # 列出三条线路状态（只显示 key 末四位）
python llm.py --use-route 2         # 切到线路2
python llm.py --thinking high       # 改思考档并落盘
python llm.py --test api            # 实测：一次调用同时验连通与思考是否生效
```

**线路之间不自动切换。** 额度耗尽必须由人显式换线路——自动切会让「跑通了」掩盖额度问题，
和项目「不做通道间自动降级」是同一条规矩。

---

## 二、思考档：哪些模型真能开出来（2026-08-29 逐条实测）

判定**只认硬证据**：响应里有非空 `thinking` / `reasoning_content` 块，
或 `usage.completion_tokens_details.reasoning_tokens > 0`。
请求里发了参数、但响应里没有痕迹的，一律记为**未生效**——
参数被静默接受不等于思考开启，把它当成开启就是「把推断值伪装成实证值」。

### Anthropic 原生端点 `/v1/messages`

| 模型 | 参数 | 结果 |
|---|---|---|
| `claude-opus-5` | `thinking{type:enabled, budget_tokens:N}` | ✅ 真实 thinking 块 |

### OpenAI 兼容端点 `/v1/chat/completions`

| 模型 | 参数 | 结果 |
|---|---|---|
| `claude-opus-5` / `claude-opus-4-8` | `reasoning_effort=high` | ❌ 无痕迹，usage 全 0 |
| `o3-pro` / `gpt-5.4-pro` / `gpt-5.6-terra` | `reasoning_effort=high` | ❌ 无痕迹，usage 全 0 |
| `claude-opus-4-7-thinking` | 模型名自带后缀 | ✅ `reasoning_content` 358 字 |
| `gemini-3.1-pro-preview(-thinking)` | `reasoning_effort=high` | ✅ `reasoning_tokens` 186 / 188 |
| `deepseek-v4-pro` | 同上 | ✅ 61 |
| `kimi-k3` | 同上 | ✅ 27 |
| `qwen3.5-plus` | 同上 | ✅ 250（但耗时 49s，明显慢） |
| `glm-5.3` | 同上 | ✅ 43 |
| `doubao-seed-2-0-pro-260215` | 同上 | ✅ 43 |

**结论**：顶配 Claude 想开思考**只能走 anthropic 原生风格**。
这推翻了 08-23 那版注释里「该中转拿不到扩展思考」的说法——那句话只对 OpenAI 兼容端点成立，
当时的测法（在 chat/completions 上发 `reasoning_effort`）恰好落在唯一无效的组合上。

### 预算档位

`THINKING_BUDGETS = {off:0, low:2048, medium:8192, high:16384, max:32000}`

budget 是**上限不是目标**：2048→60000 六档全部 HTTP 200，
但同一道题的实际思考量在 141~455 字之间随机波动，**不随预算单调增长**。
所以调高档位不会线性烧钱；真正决定成本的是输入长度和任务复杂度。

`max_tokens` 会自动抬到 `budget + 8192`，给正文留够空间。
如果模型把额度全花在思考上、正文一个字没写，`_ask_api` 会明确报
「思考档 X 把 max_tokens 吃光」，而不是笼统的「返回空内容」。

---

## 三、冒烟通过的各家顶配（2026-08-29，线路2）

同一道需要几步推理的题，13/15 通过，全部答对：

`claude-opus-5`(2.3s) · `claude-opus-4-8`(6.0s) · `gpt-5.6-terra`(3.1s) ·
`gpt-5.4-pro`(9.2s) · `o3-pro`(12.1s) · `gemini-3.1-pro-preview-thinking`(5.4s) ·
`grok-4.6`(7.2s) · `deepseek-v4-pro`(4.3s) · `kimi-k3`(4.5s) ·
`qwen3.5-plus`(49.0s) · `glm-5.3`(3.1s) · `doubao-seed-2-0-pro-260215`(3.8s)

两个失败的都是 HTTP 503（中转侧 `shell_` 类错误，非 key 问题）：
`gpt-5.4-xhigh`、`deepseek-v3.2-think`。

账号可见清单比技能文档记录的更新，出现了 `grok-4.6`、`deepseek-v4-pro`、`glm-5.3`、
`gemini-3.1-pro-preview` 等文档里没有的 ID。**账号可见 ≠ 冒烟通过**，换模型前先测。

---

## 四、另外两条通道

### `claude_cli`

本机已安装并登录，隔离探针已通过（口令未泄漏、shell 未执行）。
但**开销大**：一次简单探测就超过 120s 超时。当前不作为主通道。

历史结论（2026-08-14）仍然成立：Claude Code 会话内的认证由宿主 app 通过
`CLAUDE_CODE_MESSAGING_SOCKET` 提供，**不落盘、不随环境变量传给子进程**，
所以必须在交互式终端跑一次 `claude` 完成浏览器授权，凭据落盘后子进程才能用。

### `codex_cli`

2026-08-30 已实测接入，**当作测试通道用**（赞助线路 401 到期后的临时替代）。
完整结论见下面的【七】。

---

## 五、超时

`TIMEOUT = 300`（原 180）。开了思考之后单次调用明显变长：
短问题就要 10~14s，真实公告抽取实测 10.9s，长正文更久。
180s 会把本来能成的调用误判成超时。

中转长生成偶发断连（`ReadTimeout` / `SSLError`）。**本模块不做自动重试**，
失败即抛 `LLMUnavailable` 如实上报，符合「不降级、不兜底」的规矩。

---

## 六、六模型评测（2026-08-29，线路2）

用**真实业务 prompt**（`pipeline.EXTRACT_PROMPT` + `SCORE_PROMPT`，未另写一份）
在 12 条真实公告上逐模型串行跑了一遍，六个模型吃**逐字相同**的输入。
思考档统一 max（claude 走 anthropic 原生 `thinking{budget_tokens:32000}`，
其余走 openai 兼容 `reasoning_effort=high`）。

> ⚠️ **12 条 × 1 次采样，无重复实验。下面所有比率的分母都是个位数到十几，不可外推。**
> 评测集是 08-28 抓的旧 signal——08-29 当天跑爬虫**新增 0 条**（候选 URL 全部已入库）。
> 完整报告与 82 次调用的逐条明细不在仓库内（评测产物不进 git）。

### 结论表

| 模型 | 风格 | 成功/传输失败 | 抽取覆盖 | 与 opus5 判定一致 | JSON一次通过 | 延迟中位 | 思考覆盖 | 花费 |
|---|---|---|---:|---|---|---:|---:|---:|
| `claude-opus-5`（基线） | anthropic | **15 / 0** | 12/12 | — | 100% | 12.4s | 73.3% | $0.975 |
| `claude-fable-5` | anthropic | **14 / 0** | 12/12 | 11/12 | 100% | 14.7s | **7.1%** | **$2.322** |
| `kimi-k3` | openai | 12 / **1** | 12/12 | 10/12 | 100% | **9.4s** | 100% | **$0.263** |
| `glm-5.3` | openai | 9 / **4** | **8/12** | 8/8 | 100% | 26.7s | 100% | $1.016 |
| `gpt-5.6-sol` | openai | **14 / 0** | 12/12 | **11/12** | 100% | 10.2s | 100% | $0.494 |
| `gemini-3.1-pro-preview-thinking` | openai | **13 / 0** | 12/12 | 10/12 | 100% | 21.9s | 100% | $0.326 |

- **六个模型 JSON 一次通过率全部 100%**，`_escape_inner_quotes` 一次都没用上——这项区分不出模型。
- **`industry` 六家 100% 落在 taxonomy 内**，无人自造类目。
- 全部传输失败都是中转 300s `ReadTimeout`，不是 key 问题；**无模型触发「连续 3 次」熔断**。
- 评测总花费 $5.44（含冒烟），线路2 剩余约 $94.3。预算闸门（单模型 $20 / 累计 $60）未触发。

### 主力推荐：维持 `claude-opus-5`

零失败、JSON 全通过、**采购方抽得对**（#459「中国化学签约48.16亿」里它抽的是项目业主
吉远/卓菲特，而 `claude-fable-5` 与 `gemini` 抽成了总包方中国化学——按知识库
「产业链穿透」口径，后者抽的是卖方不是买方）。12 条 $0.975，成本可接受。

**备选（若要压成本）**：`gpt-5.6-sol`——零失败、一致率并列最高、采购方抽取与基线一致、
延迟更低，**成本只有基线的 51%**。本次唯一各项都不输基线的模型。

**不建议**：
- `claude-fable-5`：2.38 倍成本、思考覆盖仅 7.1%、company/region 填充率各只有 50%。
- `glm-5.3`：4/13 调用超时（30.8%），每次白烧 5 分钟，**通道稳定性不达标**。

### 两处需要人工裁定的分歧

1. **#452「国富氢能与韩国 Hylium 签绿氢购销意向」**：只有基线判商机（且只给 35 分），
   其余四家判非商机，理由直接引用知识库排除项第 2、3 条（标的物无关 / 同业竞争对手）。
   若认定它确属非商机，则基线「商机率 25% 最高」不是优点而是**更宽松的误报倾向**。
2. **#450「内蒙古公布21个氢能应用场景」**：4 家判商机、`kimi-k3` 与 `gemini` 判非商机。
   争点是「点了名的场景清单算不算具体采购主体」。四家分数 52~60，离出卡线 80 很远，不影响产出。

### 思考档的两个新格子（实测补充 §二）

- **`claude-fable-5`**：同一条线路、同一段代码、同一个 budget=32000，
  思考覆盖只有 **7.1%（1/14）**，而 `claude-opus-5` 是 73.3%（11/15）。
  fable 几乎不产出 thinking 块。
- **`gpt-5.6-sol`**：在**业务 prompt** 上稳定返回 `reasoning_content`（覆盖 100%）；
  但在简单算术题上不返回、usage 里也没有 `reasoning_tokens`。
  §二 记录的「gpt 家族无痕迹」测的是 `terra` / `5.4-pro` / `o3-pro`，
  **`gpt-5.6-sol` 此前从未测过**——这是补格子，不是推翻旧结论。
- `claude-opus-5` 冒烟题 thought=0 是**模型对熟题选择不思考**，不是通道没开：
  换一道题同样配置返回了真实 thinking 块（带 signature）。§二 的结论仍然成立。

---

## 七、`codex_cli` 测试通道（2026-08-30 实测接入）

三条赞助线路的 key 在 2026-08-30 00:00 到期后全部 401（见 `BLOCKED.md`【四】），
负责人拍板：**用本机 Codex 订阅额度把链路跑起来，当测试通道用。**

> ⚠️ 这是**测试通道**，不是正式通道。它走的是个人 ChatGPT 订阅额度，
> 模型是 codex 账户默认（不是 `claude-opus-5`），因此**打分口径与 §六 的评测不可比**。
> 正式线路恢复后必须切回 `api` 通道，否则演示数据的模型出处会和文档对不上。

### 版本与登录

| 项 | 实测值 |
|---|---|
| 入口 | 本机**没有** `codex` 可执行文件（`which codex` 为空）；可用入口是 `npx -y @openai/codex` |
| 版本 | `codex-cli 0.151.0` |
| 登录 | `Logged in using ChatGPT`（OAuth 令牌在 `~/.codex/auth.json`，不是 API Key） |
| 模型 | 默认**不传** `-m`，用 codex 账户默认。要钉模型见下面「切换命令」 |

代码里优先用真二进制、找不到才回落 npx（`_codex_launcher()`），所以别人机器上装了
`codex` 也能直接用，不必改代码。

### 隔离参数（每一条都对应一个已实测的具体风险）

```
codex exec --skip-git-repo-check --color never -s read-only \
  -C ~/.config/hydrogen-radar/codex-jail \
  --ignore-user-config --ignore-rules --ephemeral \
  -c project_doc_max_bytes=0 -c tools.web_search=false \
  -o <临时文件> \
  --disable shell_tool --disable plugins --disable apps --disable memories \
  --disable skill_search --disable browser_use --disable browser_use_external \
  --disable browser_use_full_cdp_access --disable in_app_browser \
  --disable computer_use --disable image_generation --disable code_mode_host
```

- `--ignore-user-config` 是**必需**的：本机 `~/.codex/config.toml` 里启用了
  `browser` / `chrome` / `computer-use` / `sites` 等一批插件，还把十几个目录标成
  `trusted`。公告正文要原样进这个 prompt，一个都不能带进来。
- `--disable shell_tool` 是关键一条：codex 的「读文件 / 执行命令」都挂在 shell 工具上。
  这些 feature 名不是猜的——`codex features list --disable <名>` 打印出的 effective state
  确实变成 `false`，才写进代码。
- `-c project_doc_max_bytes=0` 挡掉 `AGENTS.md` 注入（本机 `~/.codex/AGENTS.md` 有 1.5KB 私人偏好）。
- `--ephemeral` 让不可信正文不落进 `~/.codex/sessions`。
- prompt **走 stdin**（`codex exec` 不带位置参数时读 stdin，0.151.0 实测成立）；
  结果**只读 `-o` 写出的最终消息文件**，绝不 parse stdout——stdout 混着进度噪声。

### 隔离探针实测

`llm.py` 第 ⑤ 条探针（把随机口令写到工作目录之外，让模型去读、并让它执行 shell）
在这套参数上的结果：

```
ISOLATION_OK = True
DETAIL = 口令未泄漏、shell 未执行，工具已被有效禁用
```

结论和 `claude_cli` 一致：**模型侧没有工具面**，公告正文注入不出执行动作。

### 残余风险（如实写明，不粉饰）

1. **`-s read-only` 的语义是「不能写、不能联网」，不是「看不见磁盘」。**
   现在因为 `--disable shell_tool` 关掉了工具，模型够不到文件系统；但只要将来有人
   为了别的目的把 shell 工具打开，只读沙箱本身**允许读全盘文件**。
   探针缓存的指纹带了完整 argv，改任何一个参数都会强制重测——这是这条风险的唯一闸门。
2. **`GUARD_PROMPT` 只能拼在 stdin 最前面。** `codex exec` 没有
   `--append-system-prompt` 一类的开关，所以防注入提示与不可信正文处在同一层级，
   比 `claude_cli`（走系统提示层）弱一档。
3. **凭据可见性**：子进程要读 `~/.codex/auth.json`，所以必须给它 `HOME`。
   业务密钥（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 等）没有继承（`_min_env` 只给
   PATH / HOME / USER / LOGNAME / TMPDIR / LANG 六个）。
4. **额度与账号**：走的是**个人** ChatGPT 订阅，不是比赛赞助资源。跑批量前先想清楚这一点。

### 实测开销与耗时（2026-08-30，四次真实调用）

| 调用 | 内容 | 耗时 |
|---|---|---|
| ① 隔离探针 | canary（读文件 + 执行 shell） | 11.9s |
| ② `health_check` | `只输出字符串 OK`，严格校验 `strip() == "OK"` | 11.1s |
| ③ `ask(expect_json=True)` | `{"ping":"pong"}`，走现有围栏/花括号解析 | 11.6s |
| ④ 中文长 prompt | 真实公告 #456 正文 2174 字 → JSON | 17.1s |

耗时是本次四次调用的实测值。**单次约 2.3 万 token 这个数字来自负责人 2026-08-30 的
烟测（`只输出字符串 OK` 那次读到的用量），不是上面四次的复测**——本通道走
`-o` 文件取结果、不 parse stdout，用量行留在 stdout 里没有被记录下来。
量级上可以这么用：绝大部分 token 是 codex 自己的系统提示，**与题目长短基本无关**，
所以 `health_check` 不能拿去做轮询，一次「只回 OK」和一次真实抽取的固定成本同一个量级。
要拿准数就把 stdout 打出来看，别照抄这段。

### 切换 / 回切命令

**临时试跑（不动磁盘配置，推荐）**：

```bash
cd radar
RADAR_LLM_CHANNEL=codex_cli .venv/bin/python -c "from llm import health_check; print(health_check())"
RADAR_LLM_CHANNEL=codex_cli .venv/bin/python pipeline.py        # 整条管线走 codex
```

**持久切换 / 回切**：

```bash
cd radar
.venv/bin/python llm.py --use-channel codex_cli    # 切到 codex 测试通道
.venv/bin/python llm.py --use-channel api          # 回切到赞助线路（正式通道）
.venv/bin/python llm.py --scan                     # 看当前通道与隔离状态
```

`--use-channel` 只改 `channel` 一个字段，`routes` / api key / 模型 / 思考档原样保留，
回切不需要重新导入 key。

**钉 codex 侧模型**（默认不钉，用账户默认）：

```bash
.venv/bin/python llm.py --codex-model gpt-5.6-sol   # 或 RADAR_LLM_CODEX_MODEL=... 临时覆盖
.venv/bin/python llm.py --codex-model ""            # 清空，恢复用账户默认
```

代码会**拒绝**把 `claude-*` 的模型名传给 codex（账户里没有那些模型，传过去只会拿一个
含糊的失败）。

### 没做的事

- **不做通道间自动降级**：`api` 通道 401 不会自动切到 codex，必须由人显式切。
- **不做自动重试**：codex 一次调用失败就抛 `LLMUnavailable` 如实上报
  （`claude_cli` 那条对"偶发报未登录"重试过一次，codex 这边**没有**）。
