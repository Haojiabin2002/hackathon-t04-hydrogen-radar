import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FileSearch, Globe2, RefreshCw, RadioTower } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '../api/client';
import type { Signal } from '../api/types';

type Scope = 'all' | 'domestic' | 'overseas';

function formatDate(value?: string | null) {
  return value ? value.slice(0, 10) : '公告未载';
}

export default function SignalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') ?? '');
  const signals = useQuery({ queryKey: ['signals'], queryFn: () => apiGet<Signal[]>('/api/signals') });
  const rawScope = searchParams.get('scope');
  const scope: Scope = rawScope === 'domestic' || rawScope === 'overseas' ? rawScope : 'all';
  const query = searchParams.get('q')?.trim().toLocaleLowerCase('zh-CN') ?? '';
  const allSignals = signals.data ?? [];
  const sourceCount = new Set(allSignals.map((signal) => signal.source)).size;
  const overseasCount = allSignals.filter((signal) => signal.overseas).length;
  const datedCount = allSignals.filter((signal) => Boolean(signal.published_at)).length;
  const visible = allSignals.filter((signal) => {
    if (scope === 'domestic' && signal.overseas) return false;
    if (scope === 'overseas' && !signal.overseas) return false;
    if (!query) return true;
    return [signal.title, signal.source, signal.excerpt]
      .some((value) => value?.toLocaleLowerCase('zh-CN').includes(query));
  });

  const updateScope = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete('scope');
    else next.set('scope', value);
    setSearchParams(next, { replace: true });
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (draftQuery.trim()) next.set('q', draftQuery.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-kicker">SOURCE EVIDENCE</span>
          <h1 className="page-title">信号证据</h1>
          <p className="page-intro">这里展示抓取入库的公开公告，不把待研判信号提前包装成商机。标题始终链接到原始来源。</p>
        </div>
        <Link className="btn btn-quiet" to="/sources"><Globe2 size={15} />管理数据源</Link>
      </header>

      {signals.isLoading && (
        <div className="panel loading-stack" aria-busy="true" aria-label="正在加载公开信号">
          <div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" />
        </div>
      )}
      {signals.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle size={25} /><h2>信号证据加载失败</h2><p>{signals.error instanceof Error ? signals.error.message : '无法读取信号接口。'}</p>
          <button className="btn btn-quiet" onClick={() => void signals.refetch()}><RefreshCw size={14} />重新加载</button>
        </div>
      )}

      {signals.isSuccess && (
        <>
          <div className="metric-grid">
            <div className="metric-card is-accent"><span>入库信号</span><strong>{allSignals.length}</strong><small>全部来自真实 HTTP 抓取</small></div>
            <div className="metric-card"><span>公开信源</span><strong>{sourceCount}</strong><small>当前结果覆盖的来源数</small></div>
            <Link className="metric-card" to="/signals?scope=overseas"><span>海外信号</span><strong>{overseasCount}</strong><small>由数据源配置判定</small></Link>
            <div className="metric-card"><span>载明发布日期</span><strong>{datedCount}</strong><small>{allSignals.length - datedCount} 条原文未载日期</small></div>
          </div>

          {allSignals.length === 0 ? (
            <div className="empty-state panel">
              <RadioTower size={28} /><h2>数据库中还没有公开信号</h2>
              <p>当前接口返回真实空列表。请先检查数据源，再从顶部“启动雷达”发起实际采集。</p>
              <Link className="btn btn-primary" to="/sources">检查数据源</Link>
            </div>
          ) : (
            <section className="panel">
              <div className="panel-head"><div><h2>公告原始记录</h2><p>显示 {visible.length} / {allSignals.length} 条，按接口返回顺序排列</p></div></div>
              <div className="panel-body">
                <form className="toolbar" aria-label="信号筛选" onSubmit={submitSearch}>
                  <input
                    className="search-field"
                    type="search"
                    aria-label="搜索公告标题、来源或摘要"
                    placeholder="搜索公告、来源、正文摘要…"
                    value={draftQuery}
                    onChange={(event) => setDraftQuery(event.target.value)}
                  />
                  <button className="btn btn-quiet" type="submit">搜索</button>
                  <span className="toolbar-spacer" />
                  {([
                    ['all', '全部信号'],
                    ['domestic', '境内来源'],
                    ['overseas', '海外来源'],
                  ] as const).map(([key, label]) => (
                    <button className={`filter-chip ${scope === key ? 'is-active' : ''}`} type="button" key={key} onClick={() => updateScope(key)} aria-pressed={scope === key}>{label}</button>
                  ))}
                </form>
              </div>

              {visible.length === 0 ? (
                <div className="empty-state"><FileSearch size={25} /><h3>没有匹配的真实信号</h3><p>当前搜索词或来源范围没有结果，数据库中的原始记录未被删除。</p><button className="btn btn-quiet" onClick={() => setSearchParams({}, { replace: true })}>清除筛选</button></div>
              ) : (
                <div className="table-shell">
                  <table className="data-table">
                    <thead><tr><th>ID / 公告标题</th><th>来源</th><th>正文长度</th><th>发布时间</th><th>抓取日期</th></tr></thead>
                    <tbody>
                      {visible.map((signal) => (
                        <tr key={signal.id}>
                          <td className="table-title">
                            <a href={signal.source_url} target="_blank" rel="noreferrer">{signal.title}<ExternalLink size={12} /></a>
                            <small>#{signal.id} · {signal.excerpt || '未生成正文摘要'}</small>
                          </td>
                          <td><span className={`badge ${signal.overseas ? 'badge-info' : 'badge-neutral'}`}>{signal.source}</span></td>
                          <td>{signal.text_len.toLocaleString('zh-CN')} 字</td>
                          <td>{formatDate(signal.published_at)}{!signal.published_at && <><br /><span className="badge badge-warning">未推断日期</span></>}</td>
                          <td className="cell-muted">{formatDate(signal.fetched_at)}</td>
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
