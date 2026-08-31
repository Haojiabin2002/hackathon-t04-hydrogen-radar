import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Bot, Copy, ExternalLink, FileQuestion, FileText,
  Link2, RefreshCw, ShieldCheck, Users,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { LeadDetail, TraceStatus } from '../../api/types';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtContactBoard } from '../../components/cards/ArtContactBoard';
import { ArtMarkdown } from '../../components/base/ArtMarkdown';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import './opportunities.css';

/**
 * 商机详情 · 一条线索的完整可追溯链路
 *
 * 数据一次性来自 GET /api/leads/{id}：线索全字段 + 逐字段溯源 + 作战卡 +
 * 三类关键人 + 佐证来源 + 公告原文摘录。以前这页是从 /api/leads 整表里 find 一条，
 * 那样拿不到 trace 明细与关键人，被归并成 duplicate 的线索还会直接"找不到"。
 *
 * 呈现上的硬要求：**实证与推断必须分开显示**。trace 里只有 verified 是
 * 「公告原文完整命中」，partial / inferred 都掺了模型补的成分，界面上不许
 * 用同一个样式糊过去；关键人区块同理，见 ArtContactBoard。
 */

const TRACE_LABELS: Record<TraceStatus, string> = {
  verified: '原文完整命中',
  partial: '部分原文命中',
  inferred: '系统推断',
  empty: '公告未载',
  unknown: '待核验',
};

function traceTone(status: TraceStatus): string {
  if (status === 'verified') return 'badge-success';
  if (status === 'partial') return 'badge-warning';
  if (status === 'inferred') return 'badge-inferred';
  return 'badge-neutral';
}

function Field({ label, value, children }: {
  label: string;
  value?: string | number | null;
  children?: ReactNode;
}) {
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
  const valid = Number.isInteger(numericId) && numericId > 0;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const detail = useQuery({
    queryKey: ['lead-detail', numericId],
    queryFn: () => apiGet<LeadDetail>(`/api/leads/${numericId}`),
    enabled: valid,
    retry: false,
  });

  const data = detail.data;
  const lead = data?.lead;

  const copyCard = async () => {
    if (!data?.card) return;
    try {
      await navigator.clipboard.writeText(data.card.content);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  if (!valid) {
    return (
      <section className="page">
        <div className="error-state" role="alert">
          <FileQuestion size={26} aria-hidden="true" />
          <h1>商机编号无效</h1>
          <p>当前网址没有提供可识别的线索 ID。</p>
          <Link className="btn btn-quiet" to="/opportunities">返回商机看板</Link>
        </div>
      </section>
    );
  }

  const notFound = detail.isError
    && (detail.error as { status?: number } | null)?.status === 404;

  return (
    <section className="page">
      <ArtPageHead
        compact
        back={<Link className="btn btn-link" to="/opportunities"><ArrowLeft size={14} aria-hidden="true" />返回商机看板</Link>}
        title={lead?.company || lead?.subject || lead?.signal_title || meta?.title || '商机详情'}
        description={meta?.description}
        actions={lead ? (
          <>
            <Link className="btn btn-primary" to={`/?lead=${lead.id}`}>
              <Bot size={15} aria-hidden="true" />去对话追问这条
            </Link>
            <a className="btn btn-quiet" href={lead.source_url} target="_blank" rel="noreferrer">
              公告原文<ExternalLink size={14} aria-hidden="true" />
            </a>
          </>
        ) : undefined}
      />

      {detail.isLoading && (
        <div className="panel loading-stack" aria-busy="true" aria-label="正在加载商机详情">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </div>
      )}

      {notFound && (
        <div className="empty-state panel">
          <FileQuestion size={28} aria-hidden="true" />
          <h2>找不到商机 #{numericId}</h2>
          <p>后端明确返回它不存在。系统不会用另一条记录替代它。</p>
          <Link className="btn btn-quiet" to="/opportunities">查看当前商机</Link>
        </div>
      )}

      {detail.isError && !notFound && (
        <div className="error-state" role="alert">
          <FileQuestion size={25} aria-hidden="true" />
          <h2>商机详情加载失败</h2>
          <p>{detail.error instanceof Error ? detail.error.message : '无法读取商机详情。'}</p>
          <button className="btn btn-quiet" onClick={() => void detail.refetch()}>
            <RefreshCw size={14} aria-hidden="true" />重新加载
          </button>
        </div>
      )}

      {data && lead && (
        <div className="stack">
          <div className="metric-grid">
            <div className="metric-card is-accent">
              <span>综合评分</span>
              <strong>{lead.score ?? '—'}</strong>
              <small>{lead.status === 'rejected' ? '已判定非商机' : '真实研判结果'}</small>
            </div>
            <div className="metric-card">
              <span>信号类型</span>
              <strong>{lead.signal_type || '—'}</strong>
              <small>{lead.siblings > 1 ? `同一公告拆出 ${lead.siblings} 条标的` : '来自结构化研判字段'}</small>
            </div>
            <div className="metric-card">
              <span>推荐产品</span>
              <strong>{lead.matched_product || '—'}</strong>
              <small>{lead.matched_product ? '已完成产品匹配' : '尚未完成配型'}</small>
            </div>
            <div className="metric-card">
              <span>关键人</span>
              <strong>{data.contacts.total}</strong>
              <small>
                实证 {data.contacts.counts.announcement ?? 0} ·
                {' '}推断 {data.contacts.counts.inferred_path ?? 0} ·
                {' '}人工 {data.contacts.counts.manual ?? 0}
              </small>
            </div>
          </div>

          <div className="dashboard-grid lead-detail-grid">
            <div className="stack">
              <section className="panel">
                <div className="panel-head"><div><h2>商机判断</h2><p>模型结果与产品匹配理由</p></div></div>
                <div className="panel-body form-grid">
                  <Field label="标的" value={lead.subject} />
                  <Field label="评分理由" value={lead.score_reason} />
                  <Field label="产品匹配理由" value={lead.match_reason}>
                    <small className="form-hint">
                      产品匹配是我们自己的结论，本来就不会出现在公告里，因此不参与下方的逐字段溯源。
                    </small>
                  </Field>
                  <Field label="采购规模" value={lead.amount || lead.power_range} />
                  <Field label="截止时间" value={lead.deadline} />
                  <Field label="所属行业" value={lead.industry} />
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div><h2>字段可追溯性</h2><p>只有「原文完整命中」是公告实证，其余都掺了模型补的成分</p></div>
                  <ShieldCheck size={17} aria-hidden="true" />
                </div>
                <div className="panel-body form-grid">
                  {data.trace.map((entry) => (
                    <Field key={entry.field} label={entry.label} value={entry.value}>
                      <span className={`badge ${traceTone(entry.status)}`}>{TRACE_LABELS[entry.status]}</span>
                      {entry.unsourced.length > 0 && (
                        <small className="form-hint">
                          原文里找不到的片段：{entry.unsourced.join('、')}
                        </small>
                      )}
                    </Field>
                  ))}
                  <Field label="信号来源" value={lead.source}>
                    <div className="row-actions">
                      {lead.overseas && <span className="badge badge-sea">海外来源</span>}
                      <a className="btn btn-link" href={lead.source_url} target="_blank" rel="noreferrer">
                        回源核对<ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </div>
                  </Field>
                  <Field label="发布时间" value={lead.published_at || '公告未载'}>
                    <small className="form-hint">抓取时间：{lead.fetched_at || '未记录'}</small>
                  </Field>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>销售作战卡</h2>
                    <p>只有后端已生成的真实材料才会出现在这里</p>
                  </div>
                  {data.card && (
                    <button className="btn btn-quiet" onClick={copyCard}>
                      <Copy size={14} aria-hidden="true" />
                      {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请重试' : '复制全文'}
                    </button>
                  )}
                </div>
                {data.card ? (
                  <>
                    <ArtMarkdown className="markdown-view" source={data.card.content} />
                    {data.card.created_at && (
                      <p className="form-hint card-stamp">生成于 {data.card.created_at.replace('T', ' ')}</p>
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    <FileQuestion size={25} aria-hidden="true" />
                    <h3>当前没有作战卡</h3>
                    <p>现有后端没有按按钮即时生成作战卡的接口，因此这里不会显示一个无效的「生成」按钮。</p>
                    <Link className="btn btn-quiet" to={`/?lead=${lead.id}`}>向销售助手核对这条线索</Link>
                  </div>
                )}
              </section>
            </div>

            <aside className="stack">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>关键人</h2>
                    <p>三种来源分区显示，不混为一谈</p>
                  </div>
                  <Users size={17} aria-hidden="true" />
                </div>
                <div className="panel-body">
                  <ArtContactBoard leadId={lead.id} contacts={data.contacts} />
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div><h2>佐证来源</h2><p>归并阶段判为同一标的的其他报道</p></div>
                  <Link2 size={17} aria-hidden="true" />
                </div>
                <div className="panel-body source-list">
                  {/* 佐证说明里带着几条完整网址，是一长串不可断的字符——
                      不给它 overflow-wrap，整个侧栏会被撑出横向滚动条 */}
                  {data.corroboration.note && (
                    <div className="notice corroboration-note">{data.corroboration.note}</div>
                  )}
                  {data.corroboration.duplicates.length === 0 ? (
                    <p className="contact-section-empty">
                      目前只有这一篇报道。「只有一家报」不等于线索有问题，但它确实还没有第二个独立来源印证。
                    </p>
                  ) : (
                    data.corroboration.duplicates.map((dup) => (
                      <div className="source-row" key={dup.id}>
                        <div className="source-row-head">
                          <strong>{dup.source}</strong>
                          <Link className="btn btn-link" to={`/opportunities/${dup.id}`}>#{dup.id}</Link>
                        </div>
                        <p>{dup.signal_title}</p>
                        <small className="form-hint">
                          {dup.company || dup.subject || '未提及主体'}
                          {dup.published_at ? ` · ${dup.published_at.slice(0, 10)}` : ''}
                        </small>
                        <a className="btn btn-link" href={dup.source_url} target="_blank" rel="noreferrer">
                          原文<ExternalLink size={12} aria-hidden="true" />
                        </a>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </aside>
          </div>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>公告原文摘录</h2>
                <p>抓取入库的真实 HTTP 响应正文，上面每一个「原文完整命中」都能在这里搜到</p>
              </div>
              <FileText size={17} aria-hidden="true" />
            </div>
            <div className="panel-body">
              <p className="form-hint">
                信号 #{data.signal.id} · {data.signal.source} · 全文 {data.signal.text_len} 字
                {data.signal.published_at ? ` · 发布 ${data.signal.published_at.slice(0, 10)}` : ' · 发布时间未载'}
                {data.signal.fetched_at ? ` · 抓取 ${data.signal.fetched_at.slice(0, 10)}` : ''}
              </p>
              {data.signal.excerpt
                ? <pre className="signal-excerpt">{data.signal.excerpt}</pre>
                : <div className="notice notice-warning">这条信号的正文为空，字段无从核对。</div>}
              {data.signal.truncated && (
                <div className="notice">
                  正文过长，这里只显示前 {data.signal.excerpt.length} 字。
                  {' '}
                  <a href={data.signal.source_url} target="_blank" rel="noreferrer">到原站看全文</a>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
