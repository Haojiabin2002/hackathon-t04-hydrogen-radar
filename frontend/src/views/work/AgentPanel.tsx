import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Bot, CheckCircle2, CircleStop, Send, ShieldCheck, Wrench,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiMutation } from '../../api/client';
import { postSse } from '../../api/stream';
import type {
  AgentResult, AgentStep, AgentToolsResponse, ChatAction,
  CollectStartResult, Lead, MemoryCreateInput,
} from '../../api/types';
import { ArtAgentTrace } from '../../components/feedback/ArtAgentTrace';
import { CitedAnswer } from './CitedAnswer';

/**
 * Agent 模式面板。
 *
 * 与聊天模式的根本差别：agent 会跑 1-3 分钟并自己调工具。
 * 所以这里走 SSE，把每一步实时画出来——用户要能看见它在干什么，
 * 而不是对着空白等两分钟。
 */

type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'aborted';

interface AgentRun {
  goal: string;
  trace: AgentStep[];
  result?: AgentResult;
  status: RunStatus;
  error?: string;
  startedAt: number;
  elapsed?: number;
}

/**
 * 下一步的序号要看**最后一步的 step 字段**，不能用 trace.length。
 * 模型输出坏 JSON 时那一轮不进 trace，步号会出现 1,2,4 这样的跳号。
 */
function nextStepLabel(trace: AgentStep[]): string {
  if (!trace.length) return '正在读取上下文…';
  return `第 ${(trace[trace.length - 1].step ?? trace.length) + 1} 步…`;
}

function actionLabel(action: ChatAction) {
  if (action.type === 'collect') return '确认启动真实采集';
  if (action.type === 'open_lead') return `打开商机 #${action.id}`;
  if (action.type === 'filter_board') return '应用看板筛选';
  return '保存这条销售偏好';
}

const PRESET_GOALS = [
  '按我的偏好挑三条今天最该打电话的线索，说明理由',
  '评分最高的那条，我们的产品补的是它的哪个模块？',
  '找一条需要穿透中间层的线索，告诉我真正该联系谁',
  '当前漏斗哪一步损耗最大？给出可执行的改进建议',
];

export function AgentPanel({ leads, onRunningChange }: {
  leads: Lead[];
  /** 把运行状态报给外层，好让它在跑的时候禁掉模式切换 */
  onRunningChange?: (running: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  // 只为让 liveSeconds 每秒重算，值本身不读——所以丢掉 getter
  const [, forceTick] = useState(0);
  const [actionStatus, setActionStatus] = useState<{ message: string; error?: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tools = useQuery({
    queryKey: ['agent-tools'],
    queryFn: () => apiGet<AgentToolsResponse>('/api/agent/tools'),
    staleTime: 5 * 60_000,
  });

  // 跑起来后每秒刷一次，让计时器动起来（后端不给百分比，只给真实耗时）
  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = window.setInterval(() => forceTick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [run?.status]);

  // 只在真有新步骤时滚动。把 tick 放进依赖会导致运行中每秒强制滚到底，
  // 用户想往上翻看第 2 步的返回值都翻不了。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [run?.trace.length, run?.status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const running = run?.status === 'running';
  useEffect(() => { onRunningChange?.(running); }, [running, onRunningChange]);
  useEffect(() => () => onRunningChange?.(false), [onRunningChange]);

  const start = useCallback(async (rawGoal: string) => {
    const clean = rawGoal.trim();
    if (!clean) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setActionStatus(null);
    setGoal('');
    setRun({ goal: clean, trace: [], status: 'running', startedAt: Date.now() });

    try {
      await postSse<AgentStep | AgentResult | { detail: string }>(
        '/api/agent/stream',
        { goal: clean, max_steps: 8 },
        {
          onEvent: (event, data) => {
            if (event === 'step') {
              setRun((cur) => cur ? { ...cur, trace: [...cur.trace, data as AgentStep] } : cur);
            } else if (event === 'done') {
              const result = data as AgentResult;
              setRun((cur) => cur ? {
                ...cur, status: 'done', result, trace: result.trace ?? cur.trace,
                elapsed: (Date.now() - cur.startedAt) / 1000,
              } : cur);
              void queryClient.invalidateQueries({ queryKey: ['memory'] });
              void queryClient.invalidateQueries({ queryKey: ['preferences'] });
            } else if (event === 'error') {
              const detail = (data as { detail: string })?.detail ?? '未知错误';
              setRun((cur) => cur ? { ...cur, status: 'error', error: detail,
                elapsed: (Date.now() - cur.startedAt) / 1000 } : cur);
            }
          },
        },
        controller.signal,
      );
      // 流正常结束却没收到 done/error：连接被干净截断了。
      // 不收这个尾，run 会永远停在 running，输入框和按钮永久禁用。
      setRun((cur) => cur?.status === 'running'
        ? { ...cur, status: 'error', elapsed: (Date.now() - cur.startedAt) / 1000,
            error: '连接中断，未收到结论' }
        : cur);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRun((cur) => cur ? {
        ...cur, status: 'error',
        error: error instanceof Error ? error.message : '请求失败',
        elapsed: (Date.now() - cur.startedAt) / 1000,
      } : cur);
    }
  }, [queryClient]);

  const stop = () => {
    abortRef.current?.abort();
    setRun((cur) => cur ? { ...cur, status: 'aborted',
      elapsed: (Date.now() - cur.startedAt) / 1000 } : cur);
  };

  const runAction = useMutation({
    mutationFn: async (action: ChatAction) => {
      if (action.type === 'collect') {
        const r = await apiMutation<CollectStartResult>('/api/collect', 'POST');
        void queryClient.invalidateQueries({ queryKey: ['collect-status'] });
        return { message: r.started ? '真实采集已启动，可在顶栏运行面板查看。' : `未启动：${r.reason || '后端未给出原因'}` };
      }
      if (action.type === 'open_lead') {
        if (!leads.some((l) => l.id === action.id)) throw new Error(`商机 #${action.id} 当前不可见，未跳转。`);
        navigate(`/opportunities/${action.id}`);
        return { message: `正在打开商机 #${action.id}` };
      }
      if (action.type === 'filter_board') {
        navigate(action.filter === 'all' ? '/opportunities' : `/opportunities?filter=${action.filter}`);
        return { message: '正在打开筛选后的看板。' };
      }
      await apiMutation('/api/memory', 'POST', { content: action.content } satisfies MemoryCreateInput);
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
      return { message: `已保存销售偏好：${action.content}` };
    },
    onSuccess: (r) => setActionStatus({ message: r.message }),
    onError: (e) => setActionStatus({ message: e instanceof Error ? e.message : '动作执行失败', error: true }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (run?.status === 'running') return;
    void start(goal);
  };

  const liveSeconds = run ? (Date.now() - run.startedAt) / 1000 : 0;
  const confirmTools = tools.data?.tools.filter((t) => t.requires_confirm) ?? [];
  // 会改写本地状态的工具从接口推，不要在 JSX 里写死名字——REGISTRY 一改就过期
  const writingTools = (tools.data?.tools ?? [])
    .filter((t) => !t.requires_confirm && /^(remember|set_preference)$/.test(t.name))
    .map((t) => t.name);

  return (
    <>
      <div className="agent-hint">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>
          Agent 有 {tools.data?.tools.length ?? '—'} 个工具，全部由后端代码执行，模型碰不到文件系统、shell 或网络。
          {confirmTools.length > 0 && <>　<b>{confirmTools.map((t) => t.name).join('、')}</b> 需你确认后才执行；</>}
          {writingTools.length > 0 && (
            <>　其余工具直接执行，其中 <b>{writingTools.join('、')}</b> 会改写你的记忆与偏好——执行轨迹里能看到它调没调。</>
          )}
        </span>
      </div>

      <div className="message-list" ref={scrollRef} aria-live="polite">
        {!run && (
          <div className="empty-state">
            <Bot size={29} aria-hidden="true" />
            <h2>给 Agent 一个目标</h2>
            <p>它会自己决定调哪些工具、调几次、何时收敛，每一步都会显示出来供你复盘。通常需要 1–3 分钟。</p>
          </div>
        )}

        {run && (
          <>
            <div className="message message-user">{run.goal}</div>

            <ArtAgentTrace
              trace={run.trace}
              running={running}
              runningLabel={nextStepLabel(run.trace)}
              totalSeconds={running ? liveSeconds : run.elapsed}
            />

            {running && (
              <div className="notice tnum" role="status">
                已运行 {liveSeconds.toFixed(0)} 秒 · 最多 8 步
                <button type="button" className="btn btn-link" onClick={stop}>
                  <CircleStop size={13} aria-hidden="true" />停止
                </button>
              </div>
            )}

            {run.status === 'aborted' && (
              <div className="notice notice-warning" role="status">
                已停止。后端会在当前这一步结束后停下——上面是已真实完成的步骤，没有结论。
              </div>
            )}

            {run.status === 'error' && (
              <div className="notice notice-error" role="alert">
                Agent 失败：{run.error}。这里不会用编造的回答替代。
                {/^(LLMUnavailable|.*通道不可用)/.test(run.error ?? '') && (
                  <Link className="btn btn-link" to="/settings/models">去模型通道排查</Link>
                )}
              </div>
            )}

            {run.result && (
              <div className="message message-assistant">
                {run.result.exhausted && (
                  <div className="notice notice-warning">
                    步数用完仍未收敛——下面不是结论，是如实说明。
                  </div>
                )}
                {run.result.interrupted && (
                  <div className="notice notice-warning">
                    模型通道中断，已完成的步骤保留在上方轨迹里——下面不是结论。
                  </div>
                )}
                <CitedAnswer text={run.result.answer} leads={leads} />
                {run.result.action && (
                  <div className="inline-confirm">
                    <span>这是 Agent 提出的动作，尚未执行。</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={runAction.isPending}
                      onClick={() => runAction.mutate(run.result!.action!)}
                    >
                      {runAction.isPending ? '执行中…' : actionLabel(run.result.action)}
                    </button>
                  </div>
                )}
                {actionStatus && (
                  <div className={`notice ${actionStatus.error ? 'notice-error' : ''}`} role="status">
                    {actionStatus.error
                      ? <AlertTriangle size={13} aria-hidden="true" />
                      : <CheckCircle2 size={13} aria-hidden="true" />}
                    {' '}{actionStatus.message}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!run && (
        <div className="panel-body quick-list" style={{ paddingTop: 0 }}>
          {PRESET_GOALS.map((preset) => (
            <button type="button" className="filter-chip" key={preset} onClick={() => setGoal(preset)}>
              {preset}
            </button>
          ))}
        </div>
      )}

      <form className="composer is-agent" onSubmit={submit}>
        <textarea
          aria-label="给 Agent 一个目标"
          placeholder="例如：按我的偏好挑三条今天最该打电话的线索，说明理由"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          disabled={running}
          maxLength={600}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={!goal.trim() || running}>
          {running ? <Wrench size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {running ? '运行中' : '运行'}
        </button>
      </form>
    </>
  );
}
