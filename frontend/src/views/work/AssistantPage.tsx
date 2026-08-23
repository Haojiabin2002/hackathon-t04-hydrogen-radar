import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, MessageSquare, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiMutation } from '../../api/client';
import type { ChatAction, ChatInput, ChatResponse, CollectStartResult, Lead, MemoryCreateInput } from '../../api/types';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import { CitedAnswer } from './CitedAnswer';
import { AgentPanel } from './AgentPanel';
import { AgentSidebar } from './AgentSidebar';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  action?: ChatAction | null;
};

type ActionOutcome = { navigate?: string; message: string };

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function actionLabel(action: ChatAction) {
  if (action.type === 'collect') return '确认启动真实采集';
  if (action.type === 'open_lead') return `确认打开商机 #${action.id}`;
  if (action.type === 'filter_board') return '确认应用看板筛选';
  return '确认保存这条销售偏好';
}

export default function AssistantPage() {
  const meta = useRouteMeta();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [actionStatus, setActionStatus] = useState<{ messageId: string; message: string; error?: boolean } | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const mode = searchParams.get('mode') === 'agent' ? 'agent' : 'chat';
  const setMode = (next: 'chat' | 'agent') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'agent') params.set('mode', 'agent');
    else params.delete('mode');
    setSearchParams(params, { replace: true });
  };
  const rawLeadId = searchParams.get('lead');
  const leadId = rawLeadId && /^\d+$/.test(rawLeadId) ? Number(rawLeadId) : null;
  const leads = useQuery({ queryKey: ['leads'], queryFn: () => apiGet<Lead[]>('/api/leads') });
  const activeLead = leadId ? leads.data?.find((lead) => lead.id === leadId) : undefined;
  const invalidContext = Boolean(rawLeadId && leads.isSuccess && !activeLead);

  useEffect(() => {
    setMessages([]);
    setActionStatus(null);
  }, [rawLeadId]);

  const chat = useMutation({
    mutationFn: (input: ChatInput) => apiMutation<ChatResponse>('/api/chat', 'POST', input),
    onSuccess: (response) => {
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', text: response.answer, action: response.action }]);
    },
  });

  const runAction = useMutation({
    mutationFn: async (action: ChatAction): Promise<ActionOutcome> => {
      if (action.type === 'collect') {
        const result = await apiMutation<CollectStartResult>('/api/collect', 'POST');
        return { message: result.started ? '真实采集已经启动，可在顶部运行面板查看结果。' : `未启动：${result.reason || '后端没有返回原因'}` };
      }
      if (action.type === 'open_lead') {
        if (!(leads.data ?? []).some((lead) => lead.id === action.id)) throw new Error(`商机 #${action.id} 当前不可见，未执行跳转。`);
        return { navigate: `/opportunities/${action.id}`, message: `正在打开商机 #${action.id}` };
      }
      if (action.type === 'filter_board') {
        return { navigate: action.filter === 'all' ? '/opportunities' : `/opportunities?filter=${action.filter}`, message: '正在打开筛选后的看板。' };
      }
      await apiMutation('/api/memory', 'POST', { content: action.content } satisfies MemoryCreateInput);
      return { message: `已保存销售偏好：${action.content}` };
    },
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: ['collect-status'] });
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
      if (outcome.navigate) navigate(outcome.navigate);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = question.trim();
    if (!clean || chat.isPending || invalidContext) return;
    setQuestion('');
    setActionStatus(null);
    setMessages((current) => [...current, { id: messageId(), role: 'user', text: clean }]);
    chat.mutate(activeLead ? { lead_id: activeLead.id, question: clean } : { question: clean });
  };

  const executeAction = (message: Message) => {
    if (!message.action) return;
    setActionStatus(null);
    runAction.mutate(message.action, {
      onSuccess: (outcome) => setActionStatus({ messageId: message.id, message: outcome.message }),
      onError: (error) => setActionStatus({ messageId: message.id, message: error instanceof Error ? error.message : '动作执行失败', error: true }),
    });
  };

  const quickQuestions = activeLead
    ? ['这条线索为什么得出这个评分？', '产品匹配理由能在原文中核对吗？', '现在最需要核验的风险是什么？']
    : ['哪些线索值得今天跟进？', '海外高分商机有哪些？', '当前还有多少信号待研判？'];

  return (
    <section className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '研判助手'}
        description={meta?.description}
        actions={activeLead ? <Link className="btn btn-quiet" to={`/opportunities/${activeLead.id}`}>查看商机 #{activeLead.id}<ExternalLink size={14} /></Link> : undefined}
      />

      {leads.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle size={24} /><h2>助手上下文加载失败</h2><p>{leads.error instanceof Error ? leads.error.message : '无法读取商机索引。'}</p>
          <button className="btn btn-quiet" onClick={() => void leads.refetch()}><RefreshCw size={14} />重新加载</button>
        </div>
      )}

      {!leads.isError && (
        <div className="chat-layout">
          <section className="panel chat-panel">
            <div className="panel-head">
              <div>
                <h2>{mode === 'agent' ? 'Agent 模式' : activeLead ? `商机 #${activeLead.id} 溯源对话` : '全局看板对话'}</h2>
                <p>{mode === 'agent'
                  ? '给一个目标，它自己决定调哪些工具、何时收敛'
                  : activeLead ? activeLead.company || activeLead.signal_title : '回答可引用当前真实商机编号'}</p>
              </div>
              <div className="flex-c" style={{ gap: 8 }}>
                <div className="assistant-mode" role="group" aria-label="助手模式">
                  <button type="button" className={mode === 'chat' ? 'is-active' : ''}
                          aria-pressed={mode === 'chat'} disabled={agentRunning}
                          title={agentRunning ? 'Agent 正在运行，切走会丢掉整条执行轨迹' : undefined}
                          onClick={() => setMode('chat')}>
                    <MessageSquare size={13} aria-hidden="true" />问答
                  </button>
                  <button type="button" className={mode === 'agent' ? 'is-active' : ''}
                          aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>
                    <Bot size={13} aria-hidden="true" />Agent
                  </button>
                </div>
                {mode === 'chat' && activeLead && (
                  <button className="icon-btn" aria-label="退出商机上下文"
                          onClick={() => setSearchParams({}, { replace: true })}><X size={17} /></button>
                )}
              </div>
            </div>

            {mode === 'agent'
              ? <AgentPanel leads={leads.data ?? []} onRunningChange={setAgentRunning} />
              : (<>
            <div className="message-list" aria-live="polite">
              {messages.length === 0 && !chat.isPending && (
                <div className="empty-state">
                  <Bot size={29} /><h2>{activeLead ? '从这条商机的证据开始提问' : '直接询问当前真实看板'}</h2>
                  <p>{activeLead ? '助手会读取当前商机档案和公告原文；材料之外的问题会明确拒答。' : '助手不会自动操作系统。采集、筛选或保存偏好都需要你在回答下方确认。'}</p>
                </div>
              )}
              {messages.map((message) => (
                <div className={`message message-${message.role}`} key={message.id}>
                  {message.role === 'assistant' ? <CitedAnswer text={message.text} leads={leads.data ?? []} /> : message.text}
                  {message.action && (
                    <div className="inline-confirm">
                      <span>这是模型提出的动作，尚未执行。</span>
                      <button className="btn btn-primary" disabled={runAction.isPending} onClick={() => executeAction(message)}>{runAction.isPending ? '执行中…' : actionLabel(message.action)}</button>
                    </div>
                  )}
                  {actionStatus?.messageId === message.id && (
                    <div className={`notice ${actionStatus.error ? 'notice-error' : ''}`} role="status">
                      {actionStatus.error ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} {actionStatus.message}
                    </div>
                  )}
                </div>
              ))}
              {chat.isPending && <div className="message message-assistant" role="status">{activeLead ? '正在核对当前商机原文…' : '正在读取真实看板索引…'}</div>}
              {chat.isError && <div className="notice notice-error" role="alert">助手请求失败：{chat.error instanceof Error ? chat.error.message : '未知错误'}。你的问题未被伪造回答替代。</div>}
            </div>

            <form className="composer" onSubmit={submit}>
              <input
                aria-label="向销售助手提问"
                placeholder={invalidContext ? '请先移除无效商机上下文' : activeLead ? `询问商机 #${activeLead.id} 的证据…` : '询问整个看板，或提出一个待确认动作…'}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={chat.isPending || invalidContext}
                maxLength={500}
              />
              <button className="btn btn-primary" type="submit" disabled={!question.trim() || chat.isPending || invalidContext}><Send size={15} />发送</button>
            </form>
              </>)}
          </section>

          <aside className="stack">
            {mode === 'agent' && <AgentSidebar />}
            {mode === 'chat' && <>
            <section className="panel">
              <div className="panel-head"><div><h2>对话上下文</h2><p>通过 URL 保留，可直接分享</p></div></div>
              <div className="panel-body">
                {leads.isLoading ? <div className="skeleton skeleton-line" /> : (
                  <label className="field">
                    <span>选择范围</span>
                    <select
                      aria-label="选择销售助手上下文"
                      value={activeLead?.id ?? ''}
                      onChange={(event) => setSearchParams(event.target.value ? { lead: event.target.value } : {}, { replace: true })}
                    >
                      <option value="">整个看板</option>
                      {(leads.data ?? []).map((lead) => <option value={lead.id} key={lead.id}>#{lead.id} {lead.company || lead.signal_title}</option>)}
                    </select>
                  </label>
                )}
                {invalidContext && <div className="notice notice-error">网址中的商机 #{rawLeadId} 当前不存在或已被归并。<button className="btn btn-link" onClick={() => setSearchParams({}, { replace: true })}>回到全局</button></div>}
                {activeLead && (
                  <div className="source-row">
                    <div className="source-row-head"><span className={`badge ${(activeLead.score ?? 0) >= 80 ? 'badge-success' : 'badge-neutral'}`}>{activeLead.score ?? '—'} 分</span>{activeLead.overseas && <span className="badge badge-info">海外</span>}</div>
                    <p>{activeLead.company || '公告未提及采购主体'}</p>
                    <small className="form-hint">{activeLead.signal_type || '未分类'} · {activeLead.region || '地区未载'}</small>
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><div><h2>快速提问</h2><p>只会填入输入框，不会自动发送</p></div><Sparkles size={16} /></div>
              <div className="panel-body quick-list">
                {quickQuestions.map((prompt) => <button className="filter-chip" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}
              </div>
            </section>
            </>}
          </aside>
        </div>
      )}
    </section>
  );
}
