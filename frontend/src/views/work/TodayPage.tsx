import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  FileCheck2,
  FileSearch,
  Globe2,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { CollectStatus, Lead, RadarStats, Signal, SourceSummary, TraceStatus } from '../../api/types';
import './today.css';

const TRACE_LABELS: Record<TraceStatus, string> = {
  verified: '实证',
  partial: '部分实证',
  inferred: '系统推断',
  empty: '未载',
  unknown: '待核验',
};

function hasTextEncodingIssue(value?: string | null) {
  if (!value) return false;
  if (/\uFFFD|ï¿½|[\u0080-\u009f]|(?:Ã|Â|â|ð|ï|[äåæçèé])[\u0080-\u00bf€žœ™Ÿ]/u.test(value)) return true;
  const extendedCyrillic = value.match(/[\u0480-\u052f]/gu)?.length ?? 0;
  const latin1Artifacts = value.match(/[\u00a0-\u00bf]/gu)?.length ?? 0;
  return extendedCyrillic >= 8 && latin1Artifacts >= 3;
}

function TraceFact({ label, status, unsourced }: { label: string; status: TraceStatus; unsourced: string[] }) {
  const normalizedStatus = TRACE_LABELS[status] ? status : 'unknown';
  const missingFragments = Array.isArray(unsourced) ? unsourced : [];
  return (
    <p className="trade-review-provenance-item">
      <strong>{label}：</strong>
      <span className={`trade-review-trace trade-review-trace-${normalizedStatus}`}>{TRACE_LABELS[normalizedStatus]}</span>
      {missingFragments.length > 0 && (
        <small className="trade-review-unsourced">；未命中原文片段：{missingFragments.join('、')}</small>
      )}
    </p>
  );
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return '未载';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, withTime ? 16 : 10);
  return new Intl.DateTimeFormat('zh-CN', withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { month: '2-digit', day: '2-digit' }).format(date);
}

function LoadingLines({ count = 5 }: { count?: number }) {
  return (
    <div className="trade-loading" aria-busy="true" aria-label="正在读取真实数据">
      {Array.from({ length: count }, (_, index) => <i key={index} />)}
    </div>
  );
}

function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="trade-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div>
        <strong>真实数据暂时不可用</strong>
        <p>{error instanceof Error ? error.message : '无法连接数据服务。'}</p>
        <button type="button" onClick={retry}><RotateCcw size={14} aria-hidden="true" />重新读取</button>
      </div>
    </div>
  );
}

function leadStatusLabel(status?: string) {
  if (status === 'rejected') return '未达到商机标准';
  if (status === 'duplicate') return '重复信号';
  if (status === 'new') return '已形成商机';
  return status || '状态未载';
}

export default function TodayPage() {
  const [selectedSignalId, setSelectedSignalId] = useState<number | null>(null);
  const decisionPanelRef = useRef<HTMLElement | null>(null);
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => apiGet<RadarStats>('/api/stats') });
  const leads = useQuery({ queryKey: ['leads'], queryFn: () => apiGet<Lead[]>('/api/leads') });
  const signals = useQuery({ queryKey: ['signals'], queryFn: () => apiGet<Signal[]>('/api/signals') });
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => apiGet<SourceSummary[]>('/api/sources') });
  const collectStatus = useQuery({
    queryKey: ['collect-status'],
    queryFn: () => apiGet<CollectStatus>('/api/collect/status'),
    refetchInterval: (query) => query.state.data?.running ? 2500 : 15_000,
  });

  const sortedSignals = [...(signals.data ?? [])]
    .sort((a, b) => String(b.published_at || b.fetched_at || '').localeCompare(String(a.published_at || a.fetched_at || '')));
  const visibleSignals = sortedSignals.slice(0, 18);
  const selectedSignal = sortedSignals.find((signal) => signal.id === selectedSignalId) ?? visibleSignals[0] ?? null;
  const selectedLead = selectedSignal
    ? (leads.data ?? []).find((lead) => lead.signal_id === selectedSignal.id) ?? null
    : null;
  const selectedExcerptHasEncodingIssue = hasTextEncodingIssue(selectedSignal?.excerpt);
  const rankedLeads = [...(leads.data ?? [])]
    .filter((lead) => lead.status !== 'rejected' && lead.status !== 'duplicate')
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, 6);
  const sourceHealth = [...(sources.data ?? [])]
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.signals - a.signals)
    .slice(0, 6);

  const collect = collectStatus.data;
  const pipelineMessage = collect?.last_result?.pipeline || '';
  const crawlerMessage = collect?.last_result?.crawler_error || '';
  const channelBlocked = Boolean(
    pipelineMessage
    && (/blocked|阻塞|模型|通道|llm/i.test(pipelineMessage) || /\brc=(?!0\b)-?\d+\b/i.test(pipelineMessage)),
  );
  const hasCollectionError = Boolean(
    collect?.last_error || crawlerMessage || collect?.last_result?.source_errors?.length,
  );
  const evidenceCount = (signals.data ?? []).filter((signal) => Boolean(signal.source_url)).length;
  const reviewedCount = stats.data ? Math.max(0, stats.data.signals - stats.data.pending) : null;
  const currentDate = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).format(new Date());

  const traceStages = [
    {
      label: '公开信号',
      value: stats.data?.signals,
      unit: '条入库',
      state: hasCollectionError ? 'warning' : stats.data?.signals ? 'ready' : 'empty',
      detail: hasCollectionError ? '部分来源异常' : collect?.running ? '正在采集' : '采集入口',
    },
    {
      label: '证据',
      value: signals.data ? evidenceCount : undefined,
      unit: '条可回源',
      state: evidenceCount > 0 ? 'ready' : 'empty',
      detail: '原文链接',
    },
    {
      label: '模型研判',
      value: reviewedCount ?? undefined,
      unit: '条已处理',
      state: channelBlocked ? 'blocked' : stats.data?.pending ? 'waiting' : reviewedCount ? 'ready' : 'empty',
      detail: channelBlocked ? '通道受阻' : stats.data?.pending ? `${stats.data.pending} 条待处理` : '研判完成',
    },
    {
      label: '商机',
      value: stats.data?.leads,
      unit: '条进入队列',
      state: stats.data?.leads ? 'ready' : channelBlocked ? 'blocked' : 'waiting',
      detail: stats.data?.high ? `${stats.data.high} 条高价值` : '等待命中',
    },
    {
      label: '作战卡',
      value: stats.data?.cards,
      unit: '张已生成',
      state: stats.data?.cards ? 'ready' : stats.data?.leads ? 'waiting' : 'empty',
      detail: stats.data?.cards_orphan ? `${stats.data.cards_orphan} 张待关联` : '交付出口',
    },
  ].map((stage, index, all) => ({
    ...stage,
    // 第一环节永远显示绝对值；之后与上一环节相等且非零，视为"无损耗"
    carriedOver:
      index > 0 &&
      typeof stage.value === 'number' &&
      stage.value > 0 &&
      stage.value === all[index - 1].value,
  }));

  const selectSignal = (signalId: number) => {
    setSelectedSignalId(signalId);
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 900px)').matches) return;
    window.requestAnimationFrame(() => {
      const decisionPanel = decisionPanelRef.current;
      if (!decisionPanel) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      decisionPanel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      decisionPanel.focus({ preventScroll: true });
    });
  };

  return (
    <div className="trade-page" aria-labelledby="trade-page-title">
      <header className="trade-heading">
        <div>
          <p className="trade-date">{currentDate}</p>
          <h1 id="trade-page-title">今日出口商情</h1>
        </div>
        <p className="trade-heading-note">从公开来源到销售动作，每一步都保留原文与处理状态。</p>
      </header>

      <section className="trade-trace" aria-labelledby="trade-trace-title">
        <header className="trade-trace-heading">
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <h2 id="trade-trace-title">完整追溯链</h2>
          </div>
          <span>{collect?.running ? '采集中' : `上次运行 ${formatDate(collect?.last_at, true)}`}</span>
        </header>
        {stats.isLoading || signals.isLoading ? <LoadingLines count={2} /> : (
          <ol className="trade-trace-list">
            {traceStages.map((stage, index) => (
              <li className={`trade-trace-node trade-trace-${stage.state}`} key={stage.label}>
                <div className="trade-trace-marker" aria-hidden="true">
                  {stage.state === 'ready' ? <CheckCircle2 size={17} aria-hidden="true" /> : stage.state === 'blocked' || stage.state === 'warning' ? <CircleAlert size={17} aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}
                </div>
                <div className="trade-trace-copy">
                  <span>{stage.label}</span>
                  {stage.carriedOver ? (
                    // 与上一环节数量相同 = 这一步没有损耗。
                    // 再写一遍同样的数字只会让链路看起来像三个重复的大数，
                    // 真正该看的是"从哪一步开始收窄"。
                    // 单位串本身带量词（"条可回源"），跟在"全部"后面会读成
                    // "全部条可回源"，所以去掉打头的量词
                    <strong>全部 <small>{stage.unit.replace(/^[条张]/, '')}</small></strong>
                  ) : (
                    <strong>{stage.value ?? '—'} <small>{stage.unit}</small></strong>
                  )}
                  <em>{stage.carriedOver ? `${stage.value} 条 · ${stage.detail}` : stage.detail}</em>
                </div>
                {index < traceStages.length - 1 && <ArrowRight className="trade-trace-arrow" size={18} aria-hidden="true" />}
              </li>
            ))}
          </ol>
        )}
        <span className="trade-trace-mobile-hint" aria-hidden="true">横向滑动查看完整链路 →</span>
      </section>

      <div className="trade-workbench">
        <section className="trade-panel trade-manifest" aria-labelledby="trade-manifest-title">
          <header className="trade-panel-heading">
            <div>
              <span className="trade-panel-icon"><RadioTower size={16} aria-hidden="true" /></span>
              <div>
                <h2 id="trade-manifest-title">信号舱单</h2>
                <p>按发布时间排列的公开来源</p>
              </div>
            </div>
            <Link to="/signals">全部 {signals.data?.length ?? '—'} 条<ArrowUpRight size={14} aria-hidden="true" /></Link>
          </header>

          {signals.isLoading && <LoadingLines count={9} />}
          {signals.error && <PanelError error={signals.error} retry={() => { void signals.refetch(); }} />}
          {!signals.isLoading && !signals.error && (
            <ul className="trade-manifest-list" aria-label="真实信号列表">
              {visibleSignals.length === 0 && (
                <li className="trade-manifest-entry">
                  <div className="trade-empty">
                    <Database size={20} aria-hidden="true" />
                    <strong>还没有真实信号</strong>
                    <p>请先确认数据源与采集任务。</p>
                    <Link to="/sources">检查数据源</Link>
                  </div>
                </li>
              )}
              {visibleSignals.map((signal) => (
                <li className="trade-manifest-entry" key={signal.id}>
                  <button
                    type="button"
                    className={`trade-manifest-item ${selectedSignal?.id === signal.id ? 'trade-selected' : ''}`}
                    onClick={() => selectSignal(signal.id)}
                    aria-pressed={selectedSignal?.id === signal.id}
                  >
                    <span className="trade-manifest-index">{String(signal.id).padStart(3, '0')}</span>
                    <span className="trade-manifest-copy">
                      <span className="trade-manifest-meta">
                        <time>{formatDate(signal.published_at || signal.fetched_at)}</time>
                        <span>{signal.source || '来源未标注'}</span>
                        {signal.overseas && <b>海外</b>}
                      </span>
                      <strong>{signal.title || '标题未载'}</strong>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          ref={decisionPanelRef}
          className="trade-panel trade-decision"
          aria-labelledby="trade-decision-title"
          tabIndex={-1}
        >
          <header className="trade-panel-heading">
            <div>
              <span className="trade-panel-icon"><FileCheck2 size={16} aria-hidden="true" /></span>
              <div>
                <h2 id="trade-decision-title">选中信号研判单</h2>
                <p>信号、判断与商机记录一一对应</p>
              </div>
            </div>
            <Link to="/opportunities">商机看板<ArrowUpRight size={14} aria-hidden="true" /></Link>
          </header>

          {signals.isLoading || leads.isLoading ? <LoadingLines count={7} /> : null}
          {(signals.error || leads.error) && (
            <PanelError error={signals.error || leads.error} retry={() => { void signals.refetch(); void leads.refetch(); }} />
          )}
          {!signals.isLoading && !leads.isLoading && !signals.error && !leads.error && !selectedSignal && (
            <div className="trade-empty">
              <FileSearch size={20} aria-hidden="true" />
              <strong>没有可研判的信号</strong>
              <p>系统不会用示例企业填充这里。</p>
            </div>
          )}
          {!signals.isLoading && !leads.isLoading && !signals.error && !leads.error && selectedSignal && (
            <div className="trade-decision-body">
              <article
                key={`trade-review-${selectedSignal.id}`}
                className={`trade-review-sheet trade-signal-sync trade-signal-sync-${selectedSignal.id}`}
                aria-live="polite"
              >
                <header className="trade-review-heading">
                  <div>
                    <span>信号 #{selectedSignal.id}</span>
                    <h3>{selectedSignal.title || '标题未载'}</h3>
                  </div>
                  <span className={`trade-review-status ${selectedLead ? `trade-review-${selectedLead.status}` : channelBlocked ? 'trade-review-blocked' : 'trade-review-pending'}`}>
                    {selectedLead ? leadStatusLabel(selectedLead.status) : channelBlocked ? '研判受阻' : '未形成商机'}
                  </span>
                </header>

                {selectedLead ? (
                  <>
                    <dl className="trade-review-facts">
                      <div><dt>采购主体</dt><dd>{selectedLead.company || '公告未明确'}</dd></div>
                      <div><dt>综合评分</dt><dd>{selectedLead.score ?? '未评分'}</dd></div>
                      <div><dt>目标区域</dt><dd>{selectedLead.region || '尚未识别'}</dd></div>
                      <div><dt>匹配产品</dt><dd>{selectedLead.matched_product || '尚未配型'}</dd></div>
                    </dl>
                    <div className="trade-review-reason trade-review-provenance" aria-label="字段溯源状态">
                      <span>字段溯源</span>
                      <TraceFact label="采购主体" status={selectedLead.company_trace} unsourced={selectedLead.company_unsourced} />
                      <TraceFact label="目标区域" status={selectedLead.region_trace} unsourced={selectedLead.region_unsourced} />
                    </div>
                    <div className="trade-review-reason">
                      <span>判断依据</span>
                      <p>{selectedLead.score_reason || selectedLead.match_reason || '接口未返回判断依据，请打开商机详情核查。'}</p>
                    </div>
                    <Link className="trade-primary-action" to={`/opportunities/${selectedLead.id}`}>
                      打开完整商机记录<ArrowUpRight size={15} aria-hidden="true" />
                    </Link>
                  </>
                ) : (
                  <div className="trade-review-notice">
                    {channelBlocked ? <CircleAlert size={19} aria-hidden="true" /> : <Clock3 size={19} aria-hidden="true" />}
                    <div>
                      <strong>{channelBlocked ? '模型通道阻止了后续研判' : '这条信号当前没有关联商机'}</strong>
                      <p>{channelBlocked
                        ? pipelineMessage
                        : '这表示数据库中尚未生成对应商机记录，不代表正在后台处理，也不会显示虚构的完成进度。'}</p>
                    </div>
                    <Link to={channelBlocked ? '/settings/models' : '/signals'}>
                      {channelBlocked ? '恢复模型通道' : '查看完整信号'}<ChevronRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </article>

              <section className="trade-queue" aria-labelledby="trade-queue-title">
                <header>
                  <div>
                    <h3 id="trade-queue-title">优先商机队列</h3>
                    <span>按真实评分降序</span>
                  </div>
                  <strong>{rankedLeads.length} 条可推进</strong>
                </header>
                {rankedLeads.length === 0 ? (
                  <div className="trade-queue-empty">当前没有符合推进条件的商机。</div>
                ) : (
                  <ol className="trade-queue-list">
                    {rankedLeads.map((lead, index) => (
                      <li key={lead.id}>
                        <Link to={`/opportunities/${lead.id}`}>
                          <span className="trade-queue-rank">{String(index + 1).padStart(2, '0')}</span>
                          <span className="trade-queue-copy">
                            <strong>{lead.company || '采购主体未明确'}</strong>
                            <small>{lead.signal_type || lead.signal_title || '信号尚未分类'} · {lead.matched_product || '产品尚未配型'}</small>
                          </span>
                          <span className="trade-queue-score">{lead.score ?? '—'}<small>分</small></span>
                          <ChevronRight size={15} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </section>

        <aside className="trade-panel trade-context" aria-labelledby="trade-context-title">
          <header className="trade-panel-heading">
            <div>
              <span className="trade-panel-icon"><ShieldCheck size={16} aria-hidden="true" /></span>
              <div>
                <h2 id="trade-context-title">证据与恢复动作</h2>
                <p>随左侧信号实时切换</p>
              </div>
            </div>
          </header>

          <div className="trade-context-body">
            <section className="trade-context-section" aria-labelledby="trade-evidence-title">
              <header>
                <h3 id="trade-evidence-title"><FileSearch size={15} aria-hidden="true" />原始证据</h3>
                {selectedSignal?.source_url && !selectedExcerptHasEncodingIssue && <span className="trade-verified"><CheckCircle2 size={13} aria-hidden="true" />可回源</span>}
                {selectedSignal && selectedExcerptHasEncodingIssue && <span className="trade-evidence-encoding-status"><CircleAlert size={13} aria-hidden="true" />正文编码异常</span>}
              </header>
              {signals.isLoading && <LoadingLines count={4} />}
              {!signals.isLoading && selectedSignal ? (
                <article
                  key={`trade-evidence-${selectedSignal.id}`}
                  className={`trade-evidence-card trade-signal-sync trade-signal-sync-${selectedSignal.id}`}
                >
                  <p className={selectedExcerptHasEncodingIssue ? 'trade-evidence-encoding-warning' : undefined}>
                    {selectedExcerptHasEncodingIssue
                      ? '正文编码异常，请打开原始公告核验'
                      : selectedSignal.excerpt || '接口未返回正文摘录，请打开原始公告核对。'}
                  </p>
                  <dl>
                    <div><dt>来源</dt><dd>{selectedSignal.source || '未标注'}</dd></div>
                    <div><dt>发布时间</dt><dd>{formatDate(selectedSignal.published_at)}</dd></div>
                    <div><dt>抓取时间</dt><dd>{formatDate(selectedSignal.fetched_at, true)}</dd></div>
                    <div><dt>正文长度</dt><dd>{selectedSignal.text_len ? `${selectedSignal.text_len} 字` : '未载'}</dd></div>
                  </dl>
                  {selectedSignal.source_url ? (
                    <a className="trade-source-link" href={selectedSignal.source_url} target="_blank" rel="noreferrer">
                      打开原始公告<ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : <p className="trade-source-missing">该条记录没有原文链接。</p>}
                </article>
              ) : !signals.isLoading ? <p className="trade-muted">请先从左侧选择一条真实信号。</p> : null}
            </section>

            <section className="trade-context-section" aria-labelledby="trade-runtime-title">
              <header><h3 id="trade-runtime-title"><Database size={15} aria-hidden="true" />管线状态</h3></header>
              {collectStatus.isLoading && <LoadingLines count={3} />}
              {collectStatus.error && <PanelError error={collectStatus.error} retry={() => { void collectStatus.refetch(); }} />}
              {collect && (
                <div className={`trade-runtime ${collect.running ? 'trade-runtime-running' : channelBlocked || hasCollectionError ? 'trade-runtime-warning' : 'trade-runtime-ready'}`}>
                  <span className="trade-runtime-icon">
                    {collect.running ? <RefreshCw className="trade-spin" size={17} aria-hidden="true" /> : channelBlocked || hasCollectionError ? <CircleAlert size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
                  </span>
                  <div>
                    <strong>{collect.running ? '正在采集真实信号' : channelBlocked ? '模型研判通道受阻' : collect.last_error ? '上次运行失败' : hasCollectionError ? '上次运行部分成功' : collect.last_result ? '上次运行已完成' : '尚无运行结果'}</strong>
                    <p>{collect.running
                      ? '后端未提供阶段百分比，因此仅显示真实运行状态。'
                      : collect.last_error || (channelBlocked ? pipelineMessage : '') || collect.last_skip || `上次运行：${formatDate(collect.last_at, true)}`}</p>
                  </div>
                </div>
              )}
              <nav className="trade-recovery-actions" aria-label="管线恢复动作">
                {channelBlocked && <Link to="/settings/models"><Settings2 size={14} aria-hidden="true" /><span>检查模型通道</span><ChevronRight size={14} aria-hidden="true" /></Link>}
                <Link to="/automation"><Clock3 size={14} aria-hidden="true" /><span>查看采集任务</span><ChevronRight size={14} aria-hidden="true" /></Link>
                <Link to="/signals"><FileSearch size={14} aria-hidden="true" /><span>核查全部信号</span><ChevronRight size={14} aria-hidden="true" /></Link>
              </nav>
            </section>

            <section className="trade-context-section" aria-labelledby="trade-sources-title">
              <header>
                <h3 id="trade-sources-title"><Globe2 size={15} aria-hidden="true" />数据源</h3>
                <Link to="/sources">管理<ArrowUpRight size={13} aria-hidden="true" /></Link>
              </header>
              {sources.isLoading && <LoadingLines count={5} />}
              {sources.error && <PanelError error={sources.error} retry={() => { void sources.refetch(); }} />}
              {!sources.isLoading && !sources.error && (
                <ul className="trade-source-list">
                  {sourceHealth.length === 0 && <li className="trade-muted">尚未配置数据源。</li>}
                  {sourceHealth.map((source) => (
                    <li key={source.key} title={source.reason}>
                      <i className={source.enabled ? 'trade-source-online' : 'trade-source-offline'} aria-hidden="true" />
                      <span>{source.name}</span>
                      <b>{source.enabled ? `${source.signals} 条` : '停用'}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
