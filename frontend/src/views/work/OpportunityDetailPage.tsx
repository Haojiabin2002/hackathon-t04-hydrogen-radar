import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, Copy, ExternalLink, FileQuestion, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Lead, TraceStatus } from '../../api/types';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

const TRACE_LABELS: Record<TraceStatus, string> = {
  verified: '原文完整命中',
  partial: '部分原文命中',
  inferred: '系统推断',
  empty: '公告未载',
  unknown: '待核验',
};

function TraceBadge({ status }: { status: TraceStatus }) {
  const tone = status === 'verified' ? 'badge-success' : status === 'partial' || status === 'inferred' ? 'badge-warning' : 'badge-neutral';
  return <span className={`badge ${tone}`}>{TRACE_LABELS[status]}</span>;
}

function Field({ label, value, children }: { label: string; value?: string | number | null; children?: ReactNode }) {
  return (
    <div className="source-row">
      <span className="metric-label">{label}</span>
      <p>{value === null || value === undefined || value === '' ? '公告未提及' : value}</p>
      {children}
    </div>
  );
}

export default function OpportunityDetailPage() {
  const meta = useRouteMeta();
  const { leadId } = useParams();
  const numericId = Number(leadId);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const leads = useQuery({
    queryKey: ['leads'],
    queryFn: () => apiGet<Lead[]>('/api/leads'),
    enabled: Number.isInteger(numericId) && numericId > 0,
  });
  const lead = leads.data?.find((item) => item.id === numericId);
  const card = useQuery({
    queryKey: ['lead-card', numericId],
    queryFn: () => apiGet<string>(`/api/leads/${numericId}/card`),
    enabled: Boolean(lead?.has_card),
    retry: false,
  });

  const copyCard = async () => {
    if (!card.data) return;
    try {
      await navigator.clipboard.writeText(card.data);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return (
      <section className="page"><div className="error-state" role="alert"><FileQuestion size={26} /><h1>商机编号无效</h1><p>当前网址没有提供可识别的线索 ID。</p><Link className="btn btn-quiet" to="/opportunities">返回商机看板</Link></div></section>
    );
  }

  return (
    <section className="page">
      <ArtPageHead
        compact
        back={<Link className="btn btn-link" to="/opportunities"><ArrowLeft size={14} />返回商机看板</Link>}
        title={lead?.company || lead?.signal_title || meta?.title || '商机详情'}
        description={meta?.description}
        actions={lead ? (
          <>
            <Link className="btn btn-primary" to={`/assistant?lead=${lead.id}`}><Bot size={15} />带上下文提问</Link>
            <a className="btn btn-quiet" href={lead.source_url} target="_blank" rel="noreferrer">公告原文<ExternalLink size={14} /></a>
          </>
        ) : undefined}
      />

      {leads.isLoading && (
        <div className="panel loading-stack" aria-busy="true" aria-label="正在加载商机详情">
          <div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" />
        </div>
      )}
      {leads.isError && (
        <div className="error-state" role="alert">
          <FileQuestion size={25} /><h2>商机详情加载失败</h2><p>{leads.error instanceof Error ? leads.error.message : '无法读取商机列表。'}</p>
          <button className="btn btn-quiet" onClick={() => void leads.refetch()}><RefreshCw size={14} />重新加载</button>
        </div>
      )}
      {leads.isSuccess && !lead && (
        <div className="empty-state panel">
          <FileQuestion size={28} /><h2>找不到商机 #{numericId}</h2>
          <p>它可能已被重复归并，或不再属于当前可见商机。系统不会用另一条记录替代它。</p>
          <Link className="btn btn-quiet" to="/opportunities">查看当前商机</Link>
        </div>
      )}

      {lead && (
        <div className="stack">
          <div className="metric-grid">
            <div className="metric-card is-accent"><span>综合评分</span><strong>{lead.score ?? '—'}</strong><small>{lead.status === 'rejected' ? '已判定非商机' : '真实研判结果'}</small></div>
            <div className="metric-card"><span>当前阶段</span><strong>{lead.signal_type || '—'}</strong><small>来自结构化研判字段</small></div>
            <div className="metric-card"><span>推荐产品</span><strong>{lead.matched_product || '—'}</strong><small>{lead.matched_product ? '已完成产品匹配' : '尚未完成配型'}</small></div>
            <div className="metric-card"><span>作战卡</span><strong>{lead.has_card ? '已有' : '暂无'}</strong><small>{lead.has_card ? '可在下方查看和复制' : '后端尚未生成该材料'}</small></div>
          </div>

          <div className="dashboard-grid">
            <div className="stack">
              <section className="panel">
                <div className="panel-head"><div><h2>商机判断</h2><p>模型结果与产品匹配理由</p></div></div>
                <div className="panel-body form-grid">
                  <Field label="评分理由" value={lead.score_reason} />
                  <Field label="产品匹配理由" value={lead.match_reason} />
                  <Field label="采购规模" value={lead.amount || lead.power_range} />
                  <Field label="截止时间" value={lead.deadline} />
                  <Field label="所属行业" value={lead.industry} />
                  <Field label="交叉验证" value={lead.corroboration || '尚无独立来源佐证'} />
                </div>
              </section>

              <section className="panel">
                <div className="panel-head"><div><h2>字段可追溯性</h2><p>“系统推断”不等于公告实证</p></div><ShieldCheck size={17} /></div>
                <div className="panel-body form-grid">
                  <Field label="采购主体" value={lead.company}>
                    <TraceBadge status={lead.company_trace} />
                    {lead.company_unsourced.length > 0 && <small className="form-hint">未命中片段：{lead.company_unsourced.join('、')}</small>}
                  </Field>
                  <Field label="所在地区" value={lead.region}>
                    <TraceBadge status={lead.region_trace} />
                    {lead.region_unsourced.length > 0 && <small className="form-hint">未命中片段：{lead.region_unsourced.join('、')}</small>}
                  </Field>
                  <Field label="信号来源" value={lead.source}>
                    <div className="row-actions">
                      {lead.overseas && <span className="badge badge-info">海外来源</span>}
                      <a className="btn btn-link" href={lead.source_url} target="_blank" rel="noreferrer">回源核对<ExternalLink size={12} /></a>
                    </div>
                  </Field>
                  <Field label="发布时间" value={lead.published_at || '公告未载'}><small className="form-hint">抓取时间：{lead.fetched_at || '未记录'}</small></Field>
                </div>
              </section>
            </div>

            <aside className="stack">
              <section className="panel">
                <div className="panel-head"><div><h2>公告联系方式</h2><p>仅展示能在原文逐字核对的内容</p></div></div>
                <div className="panel-body source-list">
                  {lead.contact.length === 0 && <div className="notice">公告原文未载可确认的采购联系方式。</div>}
                  {lead.contact.map((contact) => (
                    <div className="source-row" key={`${contact.label}-${contact.value}`}>
                      <div className="source-row-head"><strong>{contact.label}</strong><span className={`badge ${contact.official ? 'badge-success' : 'badge-warning'}`}>{contact.official ? '官方字段' : '采购语境命中'}</span></div>
                      <p>{contact.value}</p><small className="form-hint">{contact.context}</small>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <section className="panel">
            <div className="panel-head">
              <div><h2>销售作战卡</h2><p>只有后端已生成的真实材料才会出现在这里</p></div>
              {card.data && <button className="btn btn-quiet" onClick={copyCard}><Copy size={14} />{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请重试' : '复制全文'}</button>}
            </div>
            {card.isLoading && <div className="loading-stack" aria-busy="true"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div>}
            {card.isError && <div className="notice notice-error">作战卡接口返回错误：{card.error instanceof Error ? card.error.message : '未知错误'}</div>}
            {card.data && <pre className="markdown-view">{card.data}</pre>}
            {!lead.has_card && <div className="empty-state"><FileQuestion size={25} /><h3>当前没有作战卡</h3><p>现有后端没有按按钮即时生成作战卡的接口，因此这里不会显示一个无效的“生成”按钮。</p><Link className="btn btn-quiet" to={`/assistant?lead=${lead.id}`}>向销售助手核对这条线索</Link></div>}
          </section>
        </div>
      )}
    </section>
  );
}
