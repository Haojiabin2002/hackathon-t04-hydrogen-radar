import { useState } from 'react';
import { AlertTriangle, ChevronDown, Cog, Flag, Loader2, Lock, RotateCcw } from 'lucide-react';
import type { AgentStep } from '../../api/types';

/**
 * Agent 执行轨迹时间线。
 *
 * 这是 Agent 界面的核心：一个不能复盘的 agent 和一个编数据的模型一样不可信。
 * 每一步都要看得见——它想了什么、调了哪个工具、参数是什么、拿回了什么。
 *
 * 结果预览默认折叠：展开后是后端截断过的原始 JSON，用于核对 agent
 * 有没有拿着真数据说话。
 */

/**
 * 需人工确认的工具被拦下时后端返回 ok:false——那是**设计上的正确路径**（确认闸），
 * 不是执行失败。标成红色错误会让人以为 agent 崩了。
 *
 * 哪些工具算确认闸，按 /api/agent/tools 的 `requires_confirm` 判定，
 * 由调用方传进来。**不要退回硬编码 trigger_collect**：数据侧一旦再注册一个
 * confirm 工具（BLOCKED.md【三】里的 run_extract 等），硬编码会让它被拦下的
 * 那一步在界面上变成红色失败步骤，看起来像 agent 崩了。
 *
 * confirmTools 读不到时（工具目录接口挂了）宁可显示成失败：那一步自带后端
 * 原文「需要人工确认，已作为动作提案记录」，比谎称一切正常强。
 */
function isGated(step: AgentStep, confirmTools: readonly string[]): boolean {
  return step.ok === false && Boolean(step.tool) && confirmTools.includes(step.tool as string);
}

/**
 * 模型输出非法 JSON 的那一轮，后端只 push {step, error}——**没有 ok、没有 tool**。
 * 只判 `ok === false` 会漏掉它（undefined === false 为假），于是被画成品牌色的成功步骤。
 */
function isInvalidOutput(step: AgentStep): boolean {
  return Boolean(step.error) && !step.tool && !step.done && step.ok === undefined;
}

function isFailure(step: AgentStep, confirmTools: readonly string[]): boolean {
  if (step.retry) return false;      // 重试步是"这步重来"，不是失败
  return (step.ok === false && !isGated(step, confirmTools)) || isInvalidOutput(step);
}

function StepIcon({ step, running, confirmTools = [] }: {
  step: AgentStep;
  running?: boolean;
  confirmTools?: readonly string[];
}) {
  if (running) return <Loader2 size={13} className="art-trace-spin" aria-hidden="true" />;
  if (step.done) return <Flag size={13} aria-hidden="true" />;
  if (isGated(step, confirmTools)) return <Lock size={13} aria-hidden="true" />;
  if (step.retry) return <RotateCcw size={13} aria-hidden="true" />;
  if (isFailure(step, confirmTools)) return <AlertTriangle size={13} aria-hidden="true" />;
  return <Cog size={13} aria-hidden="true" />;
}

function stepState(step: AgentStep, confirmTools: readonly string[]): string {
  if (step.done) return 'is-done';
  if (isGated(step, confirmTools)) return 'is-gated';
  if (step.retry) return 'is-retry';
  if (isFailure(step, confirmTools)) return 'is-failed';
  return 'is-ok';
}

function TraceRow({ step, confirmTools }: { step: AgentStep; confirmTools: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const preview = step.result_preview;
  const gated = isGated(step, confirmTools);
  const failed = isFailure(step, confirmTools);

  return (
    <li className={`art-trace-step ${stepState(step, confirmTools)}`}>
      <span className="art-trace-marker" aria-hidden="true">
        <StepIcon step={step} confirmTools={confirmTools} />
      </span>

      <div className="art-trace-body">
        <div className="art-trace-head">
          <b>
            {step.done ? '收敛'
              : step.retry ? '通道抖动，本步重来'
              : step.tool ?? (isInvalidOutput(step) ? '模型输出无效' : '（无工具）')}
            {gated && <span className="art-trace-tag is-gated">待确认</span>}
            {step.retry && <span className="art-trace-tag is-gated">重试</span>}
            {failed && <span className="art-trace-tag">失败</span>}
          </b>
          {step.elapsed_s !== undefined && <time>{step.elapsed_s}s</time>}
        </div>

        {step.thought && <p className="art-trace-thought">{step.thought}</p>}

        {step.args && Object.keys(step.args).length > 0 && (
          <code className="art-trace-args">{JSON.stringify(step.args)}</code>
        )}

        {step.error && (
          <p className={`art-trace-error ${gated || step.retry ? 'is-gated' : ''}`}>{step.error}</p>
        )}

        {preview && (
          <>
            <button
              type="button"
              className={`art-trace-toggle ${open ? 'is-open' : ''}`}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown size={12} aria-hidden="true" />
              {open ? '收起返回值' : '查看返回值'}
            </button>
            {open && <pre className="art-trace-preview">{preview}</pre>}
          </>
        )}
      </div>
    </li>
  );
}

export function ArtAgentTrace({
  trace,
  running,
  runningLabel,
  totalSeconds,
  confirmTools = [],
  defaultCollapsed = false,
}: {
  trace: AgentStep[];
  /** 仍在跑：末尾追加一个"进行中"占位 */
  running?: boolean;
  runningLabel?: string;
  totalSeconds?: number;
  /**
   * 需人工确认的工具名，来自 /api/agent/tools 的 requires_confirm。
   * 它们被拦下的那一步是确认闸，不是失败——见 isGated 的注释。
   */
  confirmTools?: readonly string[];
  /**
   * 初始是否折叠。对话流里已经跑完的那几轮默认折叠——不然翻旧消息要滚过
   * 几十步轨迹。只是**初始值**：用户点开之后由组件自己的状态说了算。
   */
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (!trace.length && !running) return null;

  const toolSteps = trace.filter((s) => s.tool).length;

  return (
    <section className="art-trace" aria-label="Agent 执行轨迹">
      <header className="art-trace-header">
        <div>
          <strong>执行轨迹</strong>
          <span>
            {trace.length ? `${trace.length} 步` : '准备中'}
            {toolSteps > 0 && ` · 调用工具 ${toolSteps} 次`}
            {totalSeconds !== undefined && !running && ` · 用时 ${totalSeconds.toFixed(1)}s`}
          </span>
        </div>
        {trace.length > 0 && (
          <button
            type="button"
            className="art-trace-collapse"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? '展开' : '收起'}
          </button>
        )}
      </header>

      {!collapsed && (
        <ol className="art-trace-list">
          {trace.map((step) => (
            <TraceRow step={step} confirmTools={confirmTools} key={step.step} />
          ))}
          {running && (
            <li className="art-trace-step is-running">
              <span className="art-trace-marker" aria-hidden="true">
                <StepIcon step={{ step: 0 }} running />
              </span>
              <div className="art-trace-body">
                <div className="art-trace-head">
                  <b>{runningLabel ?? '思考中…'}</b>
                </div>
                <p className="art-trace-thought">
                  模型正在决定下一步。后端不提供阶段百分比，这里只显示真实到达的步骤。
                </p>
              </div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
