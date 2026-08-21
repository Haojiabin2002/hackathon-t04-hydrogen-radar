import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ExternalLink, RefreshCw, Search, SignalZero } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '../api/client';
import type { Lead } from '../api/types';

type FilterKey = 'all' | 'high' | 'mid' | 'sea' | 'card' | 'rej';

const FILTERS: Array<{ key: FilterKey; label: string; test: (lead: Lead) => boolean }> = [
  { key: 'all', label: '全部在研', test: (lead) => lead.status !== 'rejected' },
  { key: 'high', label: '高分 ≥80', test: (lead) => lead.status !== 'rejected' && (lead.score ?? 0) >= 80 },
  { key: 'mid', label: '中分 60–79', test: (lead) => lead.status !== 'rejected' && (lead.score ?? 0) >= 60 && (lead.score ?? 0) < 80 },
  { key: 'sea', label: '海外', test: (lead) => lead.status !== 'rejected' && lead.overseas },
  { key: 'card', label: '有作战卡', test: (lead) => lead.status !== 'rejected' && Boolean(lead.has_card) },
  { key: 'rej', label: '判非商机', test: (lead) => lead.status === 'rejected' },
];

function scoreBadge(lead: Lead) {
  if (lead.status === 'rejected') return 'badge-neutral';
  if ((lead.score ?? 0) >= 80) return 'badge-success';
  if ((lead.score ?? 0) >= 60) return 'badge-warning';
  return 'badge-neutral';
}

function formatDate(value?: string | null) {
  if (!value) return '日期未载';
  return value.slice(0, 10);
}

export default function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') ?? '');
  const leads = useQuery({ queryKey: ['leads'], queryFn: () => apiGet<Lead[]>('/api/leads') });
  const requestedFilter = searchParams.get('filter') as FilterKey | null;
  const activeFilter = FILTERS.some(({ key }) => key === requestedFilter) ? requestedFilter! : 'all';
  const query = searchParams.get('q')?.trim().toLocaleLowerCase('zh-CN') ?? '';

  const updateFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete('filter');
    else next.set('filter', value);
    setSearchParams(next, { replace: true });
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (draftQuery.trim()) next.set('q', draftQuery.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const allLeads = leads.data ?? [];
  const filter = FILTERS.find(({ key }) => key === activeFilter) ?? FILTERS[0];
  const visible = allLeads.filter((lead) => {
    if (!filter.test(lead)) return false;
    if (!query) return true;
    return [lead.company, lead.signal_title, lead.signal_type, lead.region, lead.industry, lead.matched_product]
      .some((value) => value?.toLocaleLowerCase('zh-CN').includes(query));
  });

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-kicker">OPPORTUNITY PIPELINE</span>
          <h1 className="page-title">商机看板</h1>
          <p className="page-intro">按评分、区域与作战卡状态筛选真实线索。筛选条件会保留在网址中，可刷新或分享。</p>
        </div>
        <Link className="btn btn-quiet" to="/assistant">询问销售助手<ArrowRight size={15} /></Link>
      </header>

      {leads.isLoading && (
        <div className="panel loading-stack" aria-busy="true" aria-label="正在加载商机">
          <div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" />
        </div>
      )}
      {leads.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle size={24} /><h2>商机列表加载失败</h2>
          <p>{leads.error instanceof Error ? leads.error.message : '无法连接商机接口。'}</p>
          <button className="btn btn-quiet" onClick={() => void leads.refetch()}><RefreshCw size={15} />重新加载</button>
        </div>
      )}

      {leads.isSuccess && (
        <>
          <div className="metric-grid" aria-label="商机分组">
            {[
              { key: 'all' as const, label: '在研线索', note: '进入销售判断的线索' },
              { key: 'high' as const, label: '高价值', note: '评分不低于 80' },
              { key: 'sea' as const, label: '海外线索', note: '来自海外配置源' },
              { key: 'card' as const, label: '有作战卡', note: '已有可执行材料' },
            ].map((item) => (
              <Link
                className={`metric-card ${activeFilter === item.key ? 'is-accent' : ''}`}
                key={item.key}
                to={item.key === 'all' ? '/opportunities' : `/opportunities?filter=${item.key}`}
              >
                <span>{item.label}</span>
                <strong>{allLeads.filter(FILTERS.find(({ key }) => key === item.key)!.test).length}</strong>
                <small>{item.note}</small>
              </Link>
            ))}
          </div>

          {allLeads.length === 0 ? (
            <div className="empty-state panel">
              <SignalZero size={28} />
              <h2>还没有进入研判的商机</h2>
              <p>这不是演示数据缺失：当前 `/api/leads` 返回空列表。先查看是否已有真实信号，再检查模型通道并启动采集。</p>
              <div className="row-actions">
                <Link className="btn btn-primary" to="/signals">查看信号证据</Link>
                <Link className="btn btn-quiet" to="/settings/models">检查模型通道</Link>
              </div>
            </div>
          ) : (
            <section className="panel">
              <div className="panel-head">
                <div><h2>{filter.label}</h2><p>当前显示 {visible.length} / {allLeads.length} 条记录</p></div>
              </div>
              <div className="panel-body">
                <form className="toolbar" aria-label="商机筛选" onSubmit={submitSearch}>
                  <label className="toolbar-group">
                    <Search size={15} aria-hidden="true" />
                    <input
                      className="search-field"
                      aria-label="搜索采购主体、地区或产品"
                      value={draftQuery}
                      onChange={(event) => setDraftQuery(event.target.value)}
                      placeholder="搜索主体、地区、行业、产品…"
                    />
                  </label>
                  <button className="btn btn-quiet" type="submit">搜索</button>
                  <span className="toolbar-spacer" />
                  {FILTERS.map((item) => (
                    <button
                      className={`filter-chip ${activeFilter === item.key ? 'is-active' : ''}`}
                      key={item.key}
                      onClick={() => updateFilter(item.key)}
                      type="button"
                      aria-pressed={activeFilter === item.key}
                    >
                      {item.label}（{allLeads.filter(item.test).length}）
                    </button>
                  ))}
                </form>
              </div>

              {visible.length === 0 ? (
                <div className="empty-state">
                  <Search size={25} /><h3>没有符合当前条件的线索</h3>
                  <p>真实数据仍然保留，只是被当前筛选或搜索词隐藏。</p>
                  <button className="btn btn-quiet" onClick={() => setSearchParams({}, { replace: true })}>清除筛选</button>
                </div>
              ) : (
                <div className="table-shell">
                  <table className="data-table">
                    <thead><tr><th>商机主体</th><th>评分</th><th>行业 / 地区</th><th>规模 / 截止</th><th>产品匹配</th><th>证据</th></tr></thead>
                    <tbody>
                      {visible.map((lead) => (
                        <tr key={lead.id}>
                          <td className="table-title">
                            <Link to={`/opportunities/${lead.id}`}>{lead.company || '公告未提及采购主体'}</Link>
                            <small>#{lead.id} · {lead.signal_type || lead.signal_title || '未分类信号'}</small>
                          </td>
                          <td><span className={`badge ${scoreBadge(lead)}`}>{lead.status === 'rejected' ? '非商机' : `${lead.score ?? '—'} 分`}</span></td>
                          <td>{lead.industry || <span className="cell-muted">未归类</span>}<br /><small className="cell-muted">{lead.region || '公告未提及地区'}</small></td>
                          <td>{lead.amount || lead.power_range || <span className="cell-muted">公告未提及</span>}<br /><small className="cell-muted">{lead.deadline ? `截止 ${formatDate(lead.deadline)}` : '截止日期未载'}</small></td>
                          <td>{lead.matched_product || <span className="cell-muted">尚未配型</span>}<br />{lead.has_card ? <span className="badge badge-success">有作战卡</span> : null}</td>
                          <td>
                            <div className="row-actions">
                              {lead.overseas && <span className="badge badge-info">海外</span>}
                              {lead.corroboration && <span className="badge badge-success">交叉验证</span>}
                              <a className="btn btn-link" href={lead.source_url} target="_blank" rel="noreferrer" aria-label={`回源核对 ${lead.company || lead.signal_title}`}>原文<ExternalLink size={12} /></a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
