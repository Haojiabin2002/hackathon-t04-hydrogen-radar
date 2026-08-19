"""LLM 通道：subprocess 调用本机 claude CLI（走订阅额度，无需 API key）。

死规矩：本文件不含任何预置应答/mock 分支。CLI 不可用时直接抛错，
让上游任务失败并如实记录，绝不用假数据冒充模型输出。
"""
import json
import os
import sys
import re
import shutil
import subprocess

CLAUDE_BIN = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
TIMEOUT = 180


class LLMUnavailable(RuntimeError):
    """CLI 未安装或未登录——上游必须停做，不得降级。"""


def health_check():
    """返回 (ok, detail)。run.sh 开跑前调用。"""
    if not os.path.exists(CLAUDE_BIN):
        return False, f"claude CLI 不存在: {CLAUDE_BIN}"
    try:
        out = subprocess.run([CLAUDE_BIN, "-p", "回复两个字:通了"],
                             capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return False, "claude -p 超时"
    combined = (out.stdout + out.stderr).strip()
    if "Not logged in" in combined or "/login" in combined:
        return False, "claude CLI 未登录，请在终端执行一次 `claude /login`"
    if out.returncode != 0 or not out.stdout.strip():
        return False, f"claude -p 异常 rc={out.returncode}: {combined[:200]}"
    return True, combined[:60]


def _escape_inner_quotes(text):
    """把 JSON 字符串值内部未转义的半角双引号补上反斜杠。

    判定依据：串内遇到 " 时向后跳过空白，若下一个有效字符不是 , } ] : 也不是结尾，
    说明它不是收尾引号，而是内容里的引号——转义它。纯语法修复，不触碰内容。
    """
    out, in_str, i, n = [], False, 0, len(text)
    while i < n:
        ch = text[i]
        if not in_str:
            out.append(ch)
            if ch == '"':
                in_str = True
            i += 1
            continue
        if ch == "\\":
            out.append(text[i:i + 2])
            i += 2
            continue
        if ch == '"':
            j = i + 1
            while j < n and text[j] in " \t\r\n":
                j += 1
            if j >= n or text[j] in ",}]:":
                out.append(ch)
                in_str = False
            else:
                out.append('\\"')
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def ask(prompt, expect_json=True):
    """调用 claude 并返回文本或解析后的 JSON。"""
    if not os.path.exists(CLAUDE_BIN):
        raise LLMUnavailable(f"claude CLI 不存在: {CLAUDE_BIN}")
    try:
        proc = subprocess.run([CLAUDE_BIN, "-p", prompt],
                              capture_output=True, text=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise LLMUnavailable(f"claude 调用超时 (>{TIMEOUT}s)") from e

    raw = proc.stdout.strip()
    err = proc.stderr.strip()
    if "Not logged in" in raw + err:
        raise LLMUnavailable("claude CLI 未登录，请执行 `claude /login`")
    if proc.returncode != 0 or not raw:
        raise LLMUnavailable(f"claude 返回异常 rc={proc.returncode}: {(raw+err)[:200]}")

    if not expect_json:
        return raw

    text = raw
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    else:
        brace = re.search(r"\{.*\}", text, re.S)
        if brace:
            text = brace.group(0)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 模型最常见的一种破损：字符串值内部夹了未转义的半角双引号，例如
    #   "score_reason": "标的为"租赁并附购买选择权"，属实单"
    # 只做转义修复，不改动任何字面内容；修不好照常抛错，绝不猜测或补全。
    try:
        fixed = _escape_inner_quotes(text)
        out = json.loads(fixed)
    except json.JSONDecodeError as e:
        raise ValueError(f"模型输出非合法JSON: {raw[:300]}") from e
    # 修复动作必须留痕：静默改写模型输出，改坏了没人知道。
    print(f"[llm] 注意：模型输出的 JSON 含未转义引号，已做纯语法修复"
          f"（原 {len(text)} 字 → {len(fixed)} 字）。原始片段：{text[:120]}",
          file=sys.stderr)
    return out


if __name__ == "__main__":
    ok, detail = health_check()
    print(f"LLM_MODE: {'live' if ok else 'blocked'} | {detail}")
