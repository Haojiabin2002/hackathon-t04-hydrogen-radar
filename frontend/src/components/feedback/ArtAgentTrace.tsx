import { useState } from 'react';
import { AlertTriangle, ChevronDown, Cog, Flag, Loader2, Lock } from 'lucide-react';
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
 */
function isGated(step: AgentStep): boolean {
  return step.ok === false && step.tool === 'trigger_collect';
}

function StepIcon({ step, running }: { step: AgentStep; running?: boolean }) {
  if (running) return <Loader2 size={13} className="art-trace-spin" aria-hidden="true" />;
  if (step.done) return <Flag size={13} aria-hidden="true" />;
  if (isGated(step)) return <Lock size={13} aria-hidden="true" />;
  if (step.ok === false) return <AlertTriangle size={13} aria-hidden="true" />;
  return <Cog size={13} aria-hidden="true" />;
}

function stepState(step: AgentStep): string {
  if (step.done) return 'is-done';
  if (isGated(step)) return 'is-gated';
  if (step.ok === false) return 'is-failed';
  return 'is-ok';
}

function TraceRow({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const preview = step.result_preview;

  return (
    <li className={`art-trace-step ${stepState(step)}`}>
      <span className="art-trace-marker" aria-hidden="true"><StepIcon step={step} /></span>

      <div className="art-trace-body">
        <div className="art-trace-head">
          <b>
            {step.done ? '收敛' : step.tool ?? '（无工具）'}
            {isGated(step) && <span className="art-trace-tag is-gated">待确认</span>}
            {step.ok === false && !isGated(step) && <span className="art-trace-tag">失败</span>}
          </b>
          {step.elapsed_s !== undefined && <time>{step.elapsed_s}s</time>}
        </div>

        {step.thought && <p className="art-trace-thought">{step.thought}</p>}

        {step.args && Object.keys(step.args).length > 0 && (
          <code className="art-trace-args">{JSON.stringify(step.args)}</code>
        )}

        {step.error && (
          <p className={`art-trace-error ${isGated(step) ? 'is-gated' : ''}`}>{step.error}</p>
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
}: {
  trace: AgentStep[];
  /** 仍在跑：末尾追加一个"进行中"占位 */
  running?: boolean;
  runningLabel?: string;
  totalSeconds?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!trace.length && !running) return null;

  const toolSteps = trace.filter((s) => !s.done).length;

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
          {trace.map((step, index) => <TraceRow step={step} key={`${step.step}-${index}`} />)}
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
