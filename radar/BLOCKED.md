# 待裁决清单

## 【一】claude CLI / SDK 子进程通道未登录（已绕过，不影响验收）

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

---

## 【二】端口 8000 冲突（已解决）

原被领导另一个项目（Eaze 黑客松 call-service，PID 3856，已运行 2 天）占用。
经领导明确授权后停止该进程，8000 已释放，本项目服务正常运行并通过验收。

---

## 其它待裁决项

无。
