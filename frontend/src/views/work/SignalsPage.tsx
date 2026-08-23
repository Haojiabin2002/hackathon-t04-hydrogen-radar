import { useMemo, useState } from 'react';
import { ExternalLink, Globe2, RadioTower } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Signal } from '../../api/types';
import { useTable, type TableColumn, type TableFilter } from '../../hooks/useTable';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtSearchBar } from '../../components/forms/ArtSearchBar';
import { ArtPagination } from '../../components/forms/ArtPagination';
import { ArtTable } from '../../components/tables/ArtTable';
import { ArtTableHeader } from '../../components/tables/ArtTableHeader';
import { ArtEmpty, ArtError, ArtLoading } from '../../components/feedback/ArtStates';

const FILTERS: Array<TableFilter<Signal>> = [
  { key: 'all', label: '全部信号', test: () => true },
  { key: 'domestic', label: '境内来源', test: (signal) => !signal.overseas },
  { key: 'overseas', label: '海外来源', test: (signal) => signal.overseas },
];

function formatDate(value?: string | null) {
  return value ? value.slice(0, 10) : '公告未载';
}

const columns: Array<TableColumn<Signal>> = [
  {
    key: 'title',
    label: 'ID / 公告标题',
    fixed: true,
    width: 420,
    render: (signal) => (
      <div className="table-title">
        <a href={signal.source_url} target="_blank" rel="noreferrer">
          {signal.title}<ExternalLink size={12} />
        </a>
        <small>#{signal.id} · {signal.excerpt || '未生成正文摘要'}</small>
      </div>
    ),
  },
  {
    key: 'source',
    label: '来源',
    width: 160,
    sortable: true,
    sortValue: (signal) => signal.source,
    render: (signal) => (
      <span className={`badge ${signal.overseas ? 'badge-info' : 'badge-neutral'}`}>{signal.source}</span>
    ),
  },
  {
    key: 'text_len',
    label: '正文长度',
    width: 110,
    align: 'right',
    sortable: true,
    sortValue: (signal) => signal.text_len,
    render: (signal) => <span className="tnum">{signal.text_len.toLocaleString('zh-CN')} 字</span>,
  },
  {
    key: 'published_at',
    label: '发布时间',
    width: 130,
    sortable: true,
    sortValue: (signal) => signal.published_at ?? '',
    render: (signal) => (
      <>
        <span className="tnum">{formatDate(signal.published_at)}</span>
        {!signal.published_at && <><br /><span className="badge badge-warning">未推断日期</span></>}
      </>
    ),
  },
  {
    key: 'fetched_at',
    label: '抓取日期',
    width: 120,
    sortable: true,
    sortValue: (signal) => signal.fetched_at ?? '',
    render: (signal) => <span className="cell-muted tnum">{formatDate(signal.fetched_at)}</span>,
  },
];

export default function SignalsPage() {
  const meta = useRouteMeta();
  const [searchOpen, setSearchOpen] = useState(false);

  const searchFields = useMemo(
    () => (signal: Signal) => [signal.title, signal.source, signal.excerpt],
    [],
  );

  const table = useTable<Signal>({
    queryKey: ['signals'],
    queryFn: () => apiGet<Signal[]>('/api/signals'),
    columns,
    filters: FILTERS,
    searchFields,
    pageSize: 20,
  });

  if (table.loading) return <ArtLoading label="正在加载公开信号" />;
  if (table.error) {
    return <ArtError title="信号证据加载失败" error={table.error} onRetry={() => void table.refetch()} />;
  }

  if (table.allRows.length === 0) {
    return (
      <section className="page">
        <ArtPageHead compact title={meta?.title ?? '信号证据'} description={meta?.description} />
        <ArtEmpty
          icon={<RadioTower size={28} aria-hidden="true" />}
          title="数据库中还没有公开信号"
          description="当前接口返回真实空列表。请先检查数据源，再从顶栏「启动雷达」发起实际采集。"
          actions={<Link className="btn btn-primary" to="/sources">检查数据源</Link>}
        />
      </section>
    );
  }

  const sourceCount = new Set(table.allRows.map((signal) => signal.source)).size;
  const overseasCount = table.allRows.filter((signal) => signal.overseas).length;
  const datedCount = table.allRows.filter((signal) => Boolean(signal.published_at)).length;

  return (
    <section className="page art-full-height">
      <ArtPageHead
        compact
        title={meta?.title ?? '信号证据'}
        description={meta?.description}
        actions={<Link className="btn btn-quiet" to="/sources"><Globe2 size={15} />管理数据源</Link>}
      />

      <div className="metric-grid" aria-label="信号概览">
        <div className="metric-card is-accent">
          <span>入库信号</span><strong>{table.allRows.length}</strong><small>全部来自真实 HTTP 抓取</small>
        </div>
        <div className="metric-card">
          <span>公开信源</span><strong>{sourceCount}</strong><small>当前结果覆盖的来源数</small>
        </div>
        <Link className="metric-card" to="/signals?filter=overseas">
          <span>海外信号</span><strong>{overseasCount}</strong><small>由数据源配置判定</small>
        </Link>
        <div className="metric-card">
          <span>载明发布日期</span><strong>{datedCount}</strong>
          <small>{table.allRows.length - datedCount} 条原文未载日期</small>
        </div>
      </div>

      <ArtSearchBar
        open={searchOpen}
        keyword={table.keyword}
        onSearch={table.setKeyword}
        onReset={() => table.setActiveFilter(FILTERS[0].key)}
        placeholder="搜索公告、来源、正文摘要…"
      />

      <div className="art-table-card">
        <div className="art-table-card-body">
          <ArtTableHeader
            left={
              <div className="toolbar-group" role="group" aria-label="来源范围">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`filter-chip ${filter.key === table.activeFilter ? 'is-active' : ''}`}
                    aria-pressed={filter.key === table.activeFilter}
                    onClick={() => table.setActiveFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            }
            count={`显示 ${table.total} / ${table.allRows.length} 条`}
            loading={table.isFetching}
            onRefresh={() => void table.refetch()}
            searchOpen={searchOpen}
            onToggleSearch={() => setSearchOpen((value) => !value)}
            columns={table.columns}
            hiddenColumns={table.hiddenColumns}
            onToggleColumn={table.toggleColumn}
          />

          <ArtTable
            rows={table.rows}
            columns={table.visibleColumns}
            rowKey={(signal) => signal.id}
            sort={table.sort}
            onToggleSort={table.toggleSort}
            emptyContent="当前搜索词或来源范围没有结果，数据库中的原始记录未被删除。"
          />

          <ArtPagination
            page={table.page}
            pageCount={table.pageCount}
            total={table.total}
            pageSize={table.pageSize}
            onChange={table.setPage}
          />
        </div>
      </div>
    </section>
  );
}
