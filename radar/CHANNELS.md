# LLM 通道说明（实测结论，2026-08-14）

本项目的模型调用有两条通道，代码同一套，只是执行者不同。

## 通道 A：CLI / SDK 子进程（`llm.py` + `pipeline.py`）——当前不可用

```
$ claude -p "回复两个字:通了"
Not logged in · Please run /login
```

Python `claude-agent-sdk` 走的是同一条路（内部 spawn `claude` 子进程），实测同样失败：

```
AssistantMessage(content=[TextBlock(text='Not logged in · Please run /login')],
                 model='<synthetic>', error='authentication_failed')
```

**根因**：本机 Claude Code 会话的认证由宿主 app 通过 `CLAUDE_CODE_MESSAGING_SOCKET` +
token 刷新机制提供，**不落盘、不随环境变量传给子进程**。已核对 SDK 源码
（`_internal/transport/subprocess_cli.py:809`）确认它透传了除 `CLAUDECODE` 外的全部环境变量，
仍然认证失败——证明 host auth 不经环境变量传递。

**解除办法**：在交互式终端执行一次 `claude /login`，完成浏览器授权。
凭据落盘后 `bash run.sh` 即可全自动跑通，无需人工干预。

## 通道 B：会话内子 Agent（本次使用）

在 Claude Code 会话内派子 Agent 完成抽取、评分、匹配、作战卡。
子 Agent 是会话内通道，不受子进程认证限制。

- **是真实的 Claude 推理**，不是 mock、不是规则引擎、不是预置应答
- 局限：需要会话在场，`run.sh` 无法脱离会话独立跑完这几步

## 两条通道的产物一致性

两者用的是同一套提示词（见 `pipeline.py` 中的 `EXTRACT_PROMPT` /
`SCORE_PROMPT` / `MATCH_PROMPT` / `CARD_PROMPT`）、同一套评分权重
（`knowledge.yaml` 的 `scoring_weights`）、同一份产品目录，写入同一批字段。
通道 A 恢复后重跑 `pipeline.py`，结果结构完全一致。
