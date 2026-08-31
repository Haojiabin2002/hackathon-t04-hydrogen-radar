import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Bot, CheckCircle2, CircleStop, Compass, MessageSquarePlus,
  Send, Target, Wrench, X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiMutation } from '../../api/client';
import { postSse } from '../../api/stream';
import type {
  AgentHistoryEntry, AgentResult, AgentStep, AgentToolsResponse, ChatAction, CollectStartResult,
  InvestigationSummary, Lead, MemoryCreateInput, PreferenceInput, Proposal,
  ProposalResolveResult, ProposedAction,
} from '../../api/types';
import { AGENT_HISTORY_LIMIT, isDeferredWrite } from '../../api/types';
import { ArtAgentTrace } from '../../components/feedback/ArtAgentTrace';
import { ArtProposalCard } from '../../components/cards/ArtProposalCard';
import { PROPOSALS_KEY, useProposals } from '../../hooks/useProposals';
import { CitedAnswer } from './CitedAnswer';
import { HomeHero } from './HomeHero';

/**
 * 与 Agent 的对话。
 *
 * 这是首页的全部——问答模式已经下掉，能力上它早被 Agent 覆盖。
 *
 * 与从前那个"一次性任务器"的根本差别：**轮次会累积**。
 * 每发一条就往 turns 里追加一轮，旧轮次原样留在上面（轨迹默认折叠），
 * 并且把此前的问答按 AGENT_HISTORY_LIMIT 条截好、随下一次请求发给后端的
 * `history` 参数——后端会把它压成一个 `<对话上文>` 块注进 SYSTEM。
 * 所以「那条线索的推荐产品是什么」这种没有主语的追问是**真的**能解出来的，
 * 不是前端把气泡堆起来装样子。
 *
 * 触网不再由界面开关决定（2026-08-30 拍板：由对话控制）。每一轮都挂着受控
 * 触网会话，**要不要出门是模型自己的判断**——它在 system 里被告知本地三张表
 * 够用就别碰检索、额度硬且全天共用。出没出门看气泡徽标，那是按真实用量标的。
 *
 * 会话不落盘：刷新即清空。对话内容是业务信息，不写进 localStorage——
 * 空态里把这句话明写出来，不让人以为它会留着。
 */

type RunStatus = 'running' | 'done' | 'error' | 'aborted';

interface AgentTurn {
  id: string;
  goal: string;
  investigate: boolean;
  taskId: string;
  maxSteps: number;
  trace: AgentStep[];
  result?: AgentResult;
  status: RunStatus;
  error?: string;
  startedAt: number;
  /** 跑完（含失败/中止）的时刻，用来判断审批队列的哪一次刷新是这轮之后的 */
  finishedAt?: number;
  elapsed?: number;
  /**
   * 开跑前那一刻的待审提案 id。跑完拿它做差集，才能说「这几张是这轮新提的」。
   * null = 开跑时还没读到审批队列，那就不许声称哪张是新的。
   */
  proposalBaseline: string[] | null;
  /**
   * 这一轮之后新出现的待审提案 id。undefined = 还没结算（队列还没刷新回来）。
   * 结算一次就定死，不再跟着后面几轮的队列变化漂移——否则第 3 轮提的卡
   * 会追溯地长到第 1 轮的气泡下面。
   */
  freshProposalIds?: string[];
}

/**
 * 下一步的序号要看**最后一步的 step 字段**，不能用 trace.length。
 * 模型输出坏 JSON 时那一轮不进 trace，步号会出现 1,2,4 这样的跳号。
 */
function nextStepLabel(trace: AgentStep[]): string {
  if (!trace.length) return '正在读取上下文…';
  return `第 ${(trace[trace.length - 1].step ?? trace.length) + 1} 步…`;
}

/**
 * 动作按钮上的字。
 *
 * default 分支是刻意留的兜底：数据侧随时可能新增动作类型
 * （BLOCKED.md【三】里的 run_stage 就是），漏了兜底会掉进最后一个分支，
 * 把一个陌生动作标成「保存偏好」——那是在界面上说谎。
 */
function actionLabel(action: ChatAction): string {
  switch (action.type) {
    case 'collect': return '确认启动真实采集';
    case 'open_lead': return `打开商机 #${action.id}`;
    case 'filter_board': return '应用看板筛选';
    case 'remember': return '保存这条销售偏好';
    default: return `确认执行「${String((action as { type?: unknown }).type ?? '未知')}」`;
  }
}

function deferredLabel(item: ProposedAction): string {
  if (!isDeferredWrite(item)) return actionLabel(item);
  if (item.type === 'remember') return '确认写入记忆';
  if (item.type === 'set_preference') return '确认保存偏好';
  return `确认执行「${item.type}」`;
}

function proposedSummary(item: ProposedAction): string {
  if (isDeferredWrite(item)) return item.summary;
  return actionLabel(item);
}

/** 每个动作卡的稳定 key：轮次 id + 序号 + 类型（同一轮里同类动作可能有多条） */
function actionKey(turnId: string, item: ProposedAction, index: number): string {
  return `${turnId}:${index}-${item.type}`;
}

/** 后端限 ^[A-Za-z0-9_.:-]{1,64}$，这里生成的形如 ui-1756500000000-k3f9a */
function makeTaskId(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 把已经跑完的轮次压成后端要的 history。
 *
 * 只收**真出了结论**的轮次：失败、被中止、步数耗尽的那几轮没有可被指代的答案，
 * 塞进上文只会让模型把"我没跑完"当成上一轮的结论。
 * 顺序是时间从旧到新，末尾截 AGENT_HISTORY_LIMIT 条——和后端同一个口径。
 */
function buildHistory(turns: AgentTurn[]): AgentHistoryEntry[] {
  const entries: AgentHistoryEntry[] = [];
  for (const turn of turns) {
    const answer = turn.status === 'done' ? turn.result?.answer?.trim() : '';
    if (!answer) continue;
    entries.push({ role: 'user', content: turn.goal });
    entries.push({ role: 'assistant', content: answer });
  }
  return entries.slice(-AGENT_HISTORY_LIMIT);
}

/** 调查任务的账。读不到的字段不许拿 0 顶替，所以这里只画后端真给了的东西。 */
function InvestigationCard({ summary }: { summary: InvestigationSummary }) {
  const b = summary.budget;
  const gray = Object.entries(b?.gray_pages ?? {});
  const challenges = Object.entries(b?.challenge_hits ?? {});
  return (
    <section className="investigation-card" aria-label="调查任务汇总">
      <header><Compass size={14} aria-hidden="true" /><b>本次调查的账</b></header>
      <dl className="investigation-facts">
        <div><dt>检索</dt><dd>{b?.search_used ?? '—'} 次</dd></div>
        <div><dt>抓页</dt><dd>{b?.fetch_used ?? '—'} 页</dd></div>
        <div><dt>工具调用</dt><dd>{summary.tool_calls} 次</dd></div>
        <div><dt>撞墙</dt><dd>{summary.dead_ends} 次</dd></div>
        <div><dt>新落库公告</dt><dd>{summary.saved_signals?.length ?? 0} 条</dd></div>
        <div><dt>新线索</dt><dd>{summary.new_leads?.length ?? 0} 条</dd></div>
        <div><dt>全天已抓</dt><dd>{b?.daily_used ?? '—'}</dd></div>
        <div><dt>检索余额</dt><dd>{b?.bocha_left ?? '—'}</dd></div>
      </dl>

      {(summary.new_leads?.length ?? 0) > 0 && (
        <p className="investigation-line">
          新线索：
          {summary.new_leads.map((id) => (
            <Link key={id} className="btn-link" to={`/opportunities/${id}`}>#{id}</Link>
          ))}
        </p>
      )}

      {(summary.saved_signals?.length ?? 0) > 0 && (
        <div className="investigation-line">
          <b>落库的公告 / 取证页</b>
          <ul className="investigation-signals">
            {summary.saved_signals.map((item) => (
              <li key={`${item.signal_id}-${item.url}`}>
                <span className="badge badge-neutral">#{item.signal_id} {item.kind}</span>
                {/* 外部网址按纯文本给，不做成链接：这一串是抓来的，不该一点就走 */}
                <code>{item.url}</code>
              </li>
            ))}
          </ul>
          <small className="form-hint">
            标题与原文可在 <Link className="btn-link" to="/signals">信号证据</Link> 页逐条核对。
          </small>
        </div>
      )}

      {gray.length > 0 && (
        <p className="form-hint">
          陌生域用量：{gray.map(([domain, n]) => `${domain} ${n} 页`).join('、')}
        </p>
      )}
      {challenges.length > 0 && (
        <p className="form-hint">
          撞上人机验证：{challenges.map(([domain, n]) => `${domain} ${n} 次`).join('、')}
          （同域第二次会生成一张拉黑审批卡，不自动拉黑）
        </p>
      )}
    </section>
  );
}

export function AgentPanel({ leads, focusLead, onClearFocus }: {
  leads: Lead[];
  /** 界面上选中的线索。给了就直接进 agent 上下文，省掉一次 get_lead 往返 */
  focusLead?: Lead;
  onClearFocus?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState('');
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  // 只为让计时器每秒重算，值本身不读——所以丢掉 getter
  const [, forceTick] = useState(0);
  const [actionStatus, setActionStatus] = useState<Record<string, { message: string; error?: boolean }>>({});
  const [proposalOutcome, setProposalOutcome] = useState<Record<string, { message: string; error?: boolean }>>({});
  /**
   * 见过的提案快照。裁决之后那张卡会从 pending 队列里消失，
   * 只从队列渲染的话卡片连同刚出的裁决结果一起闪没——用户看不见自己批的是什么。
   */
  const [seenProposals, setSeenProposals] = useState<Record<string, Proposal>>({});
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** start 里要读"发这条时已经有哪些轮次"，用 ref 躲开闭包里的旧值 */
  const turnsRef = useRef<AgentTurn[]>(turns);
  turnsRef.current = turns;

  const tools = useQuery({
    queryKey: ['agent-tools'],
    queryFn: () => apiGet<AgentToolsResponse>('/api/agent/tools'),
    staleTime: 5 * 60_000,
  });
  const proposals = useProposals('pending');

  const activeTurn = turns.find((t) => t.status === 'running');
  const running = Boolean(activeTurn);

  /**
   * 「今日雷达」只在空态出现（且不在聚焦某条线索时）。发出第一条消息后播 180ms
   * 退场再卸载，让位给消息流；「新建对话」把 turns 清空，它自己就回来了。
   * prefers-reduced-motion 下不播动画，直接卸载。
   */
  const hasTurns = turns.length > 0;
  const [heroMounted, setHeroMounted] = useState(true);
  useEffect(() => {
    if (!hasTurns) { setHeroMounted(true); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHeroMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setHeroMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [hasTurns]);

  const patchTurn = useCallback((id: string, patch: Partial<AgentTurn>) => {
    setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // 跑起来后每秒刷一次，让计时器动起来（后端不给百分比，只给真实耗时）
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => forceTick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // 只在真有新消息/新步骤时滚动。把每秒的 tick 放进依赖会导致运行中被强制
  // 钉在底部，想往上翻看第 2 步的返回值都翻不了。
  // 空态没有消息可对齐，钉到底部只会把「今日雷达」的大标题顶出可视区。
  const traceLength = activeTurn?.trace.length ?? 0;
  useEffect(() => {
    if (turns.length === 0) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, traceLength, running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * 结算每一轮的"新提审批卡"。
   *
   * 只认**这一轮跑完之后**才刷新回来的队列（dataUpdatedAt >= finishedAt），
   * 拿开跑前的 baseline 做差集。结算一次就定死，后面几轮再提卡也不会倒灌回旧气泡。
   */
  useEffect(() => {
    if (!proposals.isSuccess) return;
    const pending = proposals.data?.proposals ?? [];
    setSeenProposals((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const p of pending) {
        if (next[p.id] !== p) { next[p.id] = p; changed = true; }
      }
      return changed ? next : cur;
    });
    setTurns((cur) => {
      let changed = false;
      const next = cur.map((turn) => {
        if (turn.status !== 'done' || turn.freshProposalIds !== undefined) return turn;
        if (!turn.proposalBaseline || !turn.finishedAt) return turn;
        if (proposals.dataUpdatedAt < turn.finishedAt) return turn;
        changed = true;
        const baseline = turn.proposalBaseline;
        return { ...turn, freshProposalIds: pending.filter((p) => !baseline.includes(p.id)).map((p) => p.id) };
      });
      return changed ? next : cur;
    });
  }, [proposals.isSuccess, proposals.dataUpdatedAt, proposals.data]);

  const start = useCallback(async (rawGoal: string, asInvestigation: boolean) => {
    const clean = rawGoal.trim();
    if (!clean) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGoal('');

    // 调查任务默认 40 步（上限也是 40），普通目标 8 步。写死在请求里是为了
    // 让下面「最多 N 步」那句话说的是真数，而不是猜后端的默认值。
    const maxSteps = asInvestigation ? 40 : 8;
    const taskId = makeTaskId();
    const turnId = `${taskId}-turn`;
    const baseline = proposals.isSuccess
      ? (proposals.data?.proposals ?? []).map((p) => p.id)
      : null;
    // 上文取的是**这条消息之前**已经跑完的轮次，所以要在追加本轮之前算
    const history = buildHistory(turnsRef.current);

    const turn: AgentTurn = {
      id: turnId, goal: clean, investigate: asInvestigation, taskId, maxSteps,
      trace: [], status: 'running', startedAt: Date.now(), proposalBaseline: baseline,
    };
    setTurns((cur) => [...cur, turn]);

    try {
      await postSse<AgentStep | AgentResult | { detail: string }>(
        '/api/agent/stream',
        {
          goal: clean,
          max_steps: maxSteps,
          lead_id: focusLead?.id ?? null,
          investigate: asInvestigation,
          task_id: taskId,
          ...(history.length ? { history } : {}),
        },
        {
          onEvent: (event, data) => {
            if (event === 'step') {
              setTurns((cur) => cur.map((t) => (
                t.id === turnId ? { ...t, trace: [...t.trace, data as AgentStep] } : t
              )));
            } else if (event === 'done') {
              const result = data as AgentResult;
              setTurns((cur) => cur.map((t) => (t.id === turnId ? {
                ...t, status: 'done' as RunStatus, result, trace: result.trace ?? t.trace,
                finishedAt: Date.now(), elapsed: (Date.now() - t.startedAt) / 1000,
              } : t)));
              void queryClient.invalidateQueries({ queryKey: ['memory'] });
              void queryClient.invalidateQueries({ queryKey: ['preferences'] });
              // 调查过程里可能提了新源/拉黑卡，队列要立刻重读
              void queryClient.invalidateQueries({ queryKey: [PROPOSALS_KEY] });
              void queryClient.invalidateQueries({ queryKey: ['signals'] });
              void queryClient.invalidateQueries({ queryKey: ['leads'] });
            } else if (event === 'error') {
              const detail = (data as { detail: string })?.detail ?? '未知错误';
              setTurns((cur) => cur.map((t) => (t.id === turnId ? {
                ...t, status: 'error' as RunStatus, error: detail,
                finishedAt: Date.now(), elapsed: (Date.now() - t.startedAt) / 1000,
              } : t)));
            }
          },
        },
        controller.signal,
      );
      // 流正常结束却没收到 done/error：连接被干净截断了。
      // 不收这个尾，这一轮会永远停在 running，输入框和按钮永久禁用。
      setTurns((cur) => cur.map((t) => (t.id === turnId && t.status === 'running' ? {
        ...t, status: 'error' as RunStatus, error: '连接中断，未收到结论',
        finishedAt: Date.now(), elapsed: (Date.now() - t.startedAt) / 1000,
      } : t)));
    } catch (error) {
      if (controller.signal.aborted) return;
      setTurns((cur) => cur.map((t) => (t.id === turnId ? {
        ...t, status: 'error' as RunStatus,
        error: error instanceof Error ? error.message : '请求失败',
        finishedAt: Date.now(), elapsed: (Date.now() - t.startedAt) / 1000,
      } : t)));
    }
  }, [queryClient, focusLead?.id, proposals.isSuccess, proposals.data]);

  const stop = () => {
    abortRef.current?.abort();
    if (!activeTurn) return;
    patchTurn(activeTurn.id, {
      status: 'aborted', finishedAt: Date.now(),
      elapsed: (Date.now() - activeTurn.startedAt) / 1000,
    });
  };

  /** 新建对话：停掉在跑的那轮，清空累积的轮次与本地状态。上文也随之归零。 */
  const resetThread = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setActionStatus({});
    setProposalOutcome({});
    setGoal('');
    composerRef.current?.focus();
  };

  /** 界面动作。default 是刻意兜底——陌生类型宁可报错，也不许猜着执行。 */
  const applyChatAction = async (action: ChatAction): Promise<string> => {
    switch (action.type) {
      case 'collect': {
        const r = await apiMutation<CollectStartResult>('/api/collect', 'POST');
        void queryClient.invalidateQueries({ queryKey: ['collect-status'] });
        return r.started ? '真实采集已启动，可在顶栏运行面板查看。' : `未启动：${r.reason || '后端未给出原因'}`;
      }
      case 'open_lead': {
        if (!leads.some((l) => l.id === action.id)) throw new Error(`商机 #${action.id} 当前不可见，未跳转。`);
        navigate(`/opportunities/${action.id}`);
        return `正在打开商机 #${action.id}`;
      }
      case 'filter_board': {
        navigate(action.filter === 'all' ? '/opportunities' : `/opportunities?filter=${action.filter}`);
        return '正在打开筛选后的看板。';
      }
      case 'remember': {
        await apiMutation('/api/memory', 'POST', { content: action.content } satisfies MemoryCreateInput);
        void queryClient.invalidateQueries({ queryKey: ['memory'] });
        return `已保存销售偏好：${action.content}`;
      }
      default: {
        const type = String((action as { type?: unknown }).type ?? '未知');
        throw new Error(`界面还不认识动作「${type}」，未执行。升级前端后再试，不要猜着执行。`);
      }
    }
  };

  /** 触网任务里被拦下的写盘动作，人点了才真的落盘。 */
  const applyDeferred = async (item: ProposedAction): Promise<string> => {
    if (!isDeferredWrite(item)) return applyChatAction(item);
    if (item.type === 'remember') {
      const content = String(item.payload.content ?? '').trim();
      if (!content) throw new Error('这条提案没有内容，未写入。');
      await apiMutation('/api/memory', 'POST', { content } satisfies MemoryCreateInput);
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
      return `已写入记忆：${content}`;
    }
    if (item.type === 'set_preference') {
      const key = String(item.payload.key ?? '').trim();
      if (!key) throw new Error('这条提案没有偏好键，未保存。');
      await apiMutation('/api/preferences', 'PUT', {
        key, value: item.payload.value,
      } as PreferenceInput);
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      return `已保存偏好 ${key}`;
    }
    throw new Error(`界面还不认识提案类型「${item.type}」，未执行。`);
  };

  const runAction = useMutation({
    mutationFn: async ({ item }: { key: string; item: ProposedAction }) => applyDeferred(item),
    onSuccess: (message, variables) =>
      setActionStatus((cur) => ({ ...cur, [variables.key]: { message } })),
    onError: (error, variables) => setActionStatus((cur) => ({
      ...cur,
      [variables.key]: { message: error instanceof Error ? error.message : '动作执行失败', error: true },
    })),
  });

  const resolveProposal = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      apiMutation<ProposalResolveResult>(`/api/proposals/${encodeURIComponent(id)}/resolve`, 'POST', { approve }),
    onSuccess: (result, variables) => {
      setProposalOutcome((cur) => ({ ...cur, [variables.id]: { message: result.message } }));
      void queryClient.invalidateQueries({ queryKey: [PROPOSALS_KEY] });
    },
    onError: (error, variables) => setProposalOutcome((cur) => ({
      ...cur,
      [variables.id]: { message: error instanceof Error ? error.message : '裁决失败', error: true },
    })),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (running) return;
    void start(goal, true);
  };

  // 轨迹里要给需确认的工具打标，所以这份名单仍然要拿（从接口推，不在 JSX 里写死
  // 名字——REGISTRY 一改就过期）。原先还派生过 writingTools 给顶部提示条用，
  // 提示条已移除，那份派生一并删掉。
  const confirmToolNames = (tools.data?.tools ?? [])
    .filter((t) => t.requires_confirm)
    .map((t) => t.name);

  const pendingNow: Proposal[] = useMemo(
    () => proposals.data?.proposals ?? [],
    [proposals.data],
  );
  /** 这轮之后没读到过队列（开跑时队列就没读到）时的兜底提示 */
  const carriedTurns = buildHistory(turns).length / 2;

  return (
    <>
      {/* 工具能力提示条已移除（2026-08-30 负责人圈掉）：它对天天用的人是背景噪音，
          每开一次对话读一遍同样的话。同样的信息在「能力配置 → 工具面板」里有完整版
          （逐个工具的参数、副作用分档、需不需要确认），那里才是它该待的地方。
          真正需要当场知道的事仍然会出现：某个工具要人确认时，轨迹里就地弹确认卡。 */}
      {focusLead && (
        <div className="agent-focus">
          <Target size={13} aria-hidden="true" />
          <span>
            聚焦 <b>#{focusLead.id}</b> {focusLead.company || focusLead.signal_title}
            <small>档案与公告原文已在上下文里</small>
          </span>
          {onClearFocus && (
            <button type="button" onClick={onClearFocus} aria-label="退出聚焦，回到全局">
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="message-list agent-thread" ref={scrollRef} aria-live="polite">
        {/* 全局空态：换成「今日雷达」。说明文字原样留着，交给 hero 排在底部小字里 */}
        {!focusLead && heroMounted && (
          <HomeHero collapsing={hasTurns} />
        )}

        {turns.length === 0 && focusLead && (
          <div className="empty-state">
            <Bot size={29} aria-hidden="true" />
            <h2>围绕商机 #{focusLead.id} 开始对话</h2>
            <p>
              它会自己决定调哪些工具、调几次、何时收敛，每一步都能展开复盘。一轮通常 1–3 分钟。
              可以接着追问——最近 {AGENT_HISTORY_LIMIT / 2} 轮问答会作为上文一起发过去，
              所以「那条线索」「它」这类指代它听得懂。
            </p>
            <p className="form-hint">对话只存在这个标签页里，刷新即清空，不会写进浏览器存储。</p>
          </div>
        )}

        {turns.map((turn) => {
          const isRunning = turn.status === 'running';
          const liveSeconds = (Date.now() - turn.startedAt) / 1000;
          const proposedActions: ProposedAction[] = turn.result?.proposed_actions
            ?? (turn.result?.action ? [turn.result.action] : []);
          const freshProposals = (turn.freshProposalIds ?? [])
            .map((id) => seenProposals[id])
            .filter((p): p is Proposal => Boolean(p));
          // 开跑时没读到队列 ⇒ 无法判断哪几张是这一轮提的，只在触网轮次上如实说明
          const blindPending = turn.status === 'done' && turn.investigate
            && !turn.proposalBaseline && pendingNow.length > 0;

          return (
            <article className="agent-turn" key={turn.id}>
              <div className="message message-user">
                {/* 按**真实用量**标，不按模式标：每轮都能出门，但多数轮次不会。
                    标了就说明这一轮确实检索或抓了页，账在下面的调查汇总里。 */}
                {((turn.result?.investigation?.budget?.search_used ?? 0) > 0
                  || (turn.result?.investigation?.budget?.fetch_used ?? 0) > 0) && (
                  <span className="badge badge-info">已联网查证</span>
                )}
                {turn.goal}
              </div>

              <div className="agent-turn-reply">
                <ArtAgentTrace
                  // 跑完那一刻重挂一次，让轨迹默认收起来——保持对话干净，要复盘再展开
                  key={`${turn.id}-${isRunning ? 'live' : 'settled'}`}
                  defaultCollapsed={!isRunning}
                  trace={turn.trace}
                  running={isRunning}
                  runningLabel={nextStepLabel(turn.trace)}
                  totalSeconds={isRunning ? liveSeconds : turn.elapsed}
                  confirmTools={confirmToolNames}
                />

                {isRunning && (
                  <div className="notice tnum" role="status">
                    已运行 {liveSeconds.toFixed(0)} 秒 · 最多 {turn.maxSteps} 步
                    <button type="button" className="btn btn-link" onClick={stop}>
                      <CircleStop size={13} aria-hidden="true" />停止
                    </button>
                  </div>
                )}

                {turn.status === 'aborted' && (
                  <div className="notice notice-warning" role="status">
                    已停止。后端会在当前这一步结束后停下——上面是已真实完成的步骤，没有结论。
                    这一轮不会进入后续追问的上文。
                  </div>
                )}

                {turn.status === 'error' && (
                  <div className="notice notice-error" role="alert">
                    Agent 失败：{turn.error}。这里不会用编造的回答替代。
                    {/^(LLMUnavailable|.*通道不可用)/.test(turn.error ?? '') && (
                      <Link className="btn btn-link" to="/settings/models">去密钥配置排查</Link>
                    )}
                  </div>
                )}

                {turn.result?.investigation && (
                  <InvestigationCard summary={turn.result.investigation} />
                )}

                {turn.result && (
                  <div className="message message-assistant">
                    {turn.result.exhausted && (
                      <div className="notice notice-warning">
                        步数用完仍未收敛——下面不是结论，是如实说明。
                      </div>
                    )}
                    {turn.result.interrupted && (
                      <div className="notice notice-warning">
                        模型通道中断，已完成的步骤保留在上方轨迹里——下面不是结论。
                      </div>
                    )}
                    <CitedAnswer text={turn.result.answer} leads={leads} />

                    {proposedActions.map((item, index) => {
                      const key = actionKey(turn.id, item, index);
                      const status = actionStatus[key];
                      const busy = runAction.isPending && runAction.variables?.key === key;
                      return (
                        <div key={key}>
                          <div className="inline-confirm">
                            <span>{proposedSummary(item)}　—— 这是 Agent 提出的动作，尚未执行。</span>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={runAction.isPending || Boolean(status && !status.error)}
                              onClick={() => runAction.mutate({ key, item })}
                            >
                              {busy ? '执行中…' : deferredLabel(item)}
                            </button>
                          </div>
                          {status && (
                            <div className={`notice ${status.error ? 'notice-error' : ''}`} role="status">
                              {status.error
                                ? <AlertTriangle size={13} aria-hidden="true" />
                                : <CheckCircle2 size={13} aria-hidden="true" />}
                              {' '}{status.message}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(freshProposals.length > 0 || blindPending) && (
                  <section className="proposal-stream" aria-label="待你裁决的提案">
                    <p className="form-hint">
                      {freshProposals.length > 0
                        ? '这一轮新提了下面的审批卡。批准前请先看清域名本身——理由是抓来的文本，不是证据。'
                        : '审批队列里还有待裁决的卡（开跑时没读到队列，无法判断哪几张是这一轮提的）。'}
                      {' '}也可以去 <Link className="btn-link" to="/approvals">审批</Link> 页集中处理。
                    </p>
                    {(freshProposals.length > 0 ? freshProposals : pendingNow).map((proposal) => (
                      <ArtProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        busy={resolveProposal.isPending && resolveProposal.variables?.id === proposal.id}
                        outcome={proposalOutcome[proposal.id]}
                        onResolve={(approve) => resolveProposal.mutate({ id: proposal.id, approve })}
                      />
                    ))}
                  </section>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* 预设问题、数字块、当前重点卡与那段说明都已移除（负责人圈定：留白）。
          对话页现在是标题 + 一行最新动态 + 大片留白 + 输入框。 */}

      {/* 「调查任务」开关已删（2026-08-30 负责人拍板：改由对话控制）。
          现在每一轮都挂着受控触网会话，**要不要出门由模型自己判断**——
          它在 system 里被告知：本地三张表够用就别碰检索，额度是硬的、全天共用。
          于是「库里评分最高的是哪条」不会触网，「查一下最近有哪些库里没有的招标」
          才会。做完之后这一轮到底出没出门，看气泡上的徽标（按真实用量标，不是按模式）。 */}
      {turns.length > 0 && (
        <div className="agent-mode-row">
          <button type="button" className="btn btn-quiet" onClick={resetThread}>
            <MessageSquarePlus size={14} aria-hidden="true" />新建对话
          </button>
        </div>
      )}

      <form className="composer is-agent" onSubmit={submit}>
        <textarea
          ref={composerRef}
          aria-label={turns.length ? '接着问' : '给 Agent 一个目标'}
          placeholder={running
            ? 'Agent 正在跑这一轮，跑完再问下一句…'
            : focusLead
              ? `围绕商机 #${focusLead.id} 提问，例如：这条为什么得 ${focusLead.score ?? '这个'} 分？`
              : turns.length
                ? '接着问，例如：那它匹配的推荐产品是什么？'
                : '问点什么，需要时它会自己出门查证'}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          disabled={running}
          maxLength={600}
          onKeyDown={(event) => {
            // Enter 发送 / Shift+Enter 换行。中文输入法选词时的 Enter 属于
            // 组字确认，isComposing 时放过去，否则每选一次词就发一条。
            if (event.key !== 'Enter') return;
            if (event.nativeEvent.isComposing) return;
            if (event.shiftKey) return;
            submit(event);
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={!goal.trim() || running}>
          {running ? <Wrench size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {running ? '运行中' : '发送'}
        </button>
        <small className="form-hint composer-hint">
          Enter 发送 · Shift+Enter 换行。
          {/* 空态原来写「跑失败或被中止的轮次不进上文」，全新对话里一次都没失败过，
              读起来像刚才出过错。另外后端对单条还有字数截断（问题 400 字 / 回答 800 字），
              只说轮数不说截断，等于让人以为长问题会被完整带上。 */}
          {carriedTurns > 0
            ? `　下一条会带上最近 ${carriedTurns} 轮问答作为上文（上限 ${AGENT_HISTORY_LIMIT / 2} 轮；`
              + '单条超长会被截断：问题留前 400 字、回答留前 800 字）。'
            : '　这是第一句，没有上文。'}
        </small>
      </form>
    </>
  );
}
