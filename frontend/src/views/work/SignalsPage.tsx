import { useMemo } from 'react';
import { ExternalLink, Globe2, RadioTower, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Signal } from '../../api/types';
import { useTable, type TableColumn, type TableFilter } from '../../hooks/useTable';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtFilterChips } from '../../components/forms/ArtFilterChips';
import { ArtPagination } from '../../components/forms/ArtPagination';
import { ArtTable } from '../../components/tables/ArtTable';
import { ArtTableHeader } from '../../components/tables/ArtTableHeader';
import { ArtEmpty, ArtError, ArtLoading } from '../../components/feedback/ArtStates';

const FILTERS: Array<TableFilter<Signal>> = [
  { key: 'all', label: '全部', test: () => true },
  { key: 'domestic', label: '境内来源', test: (signal) => !signal.overseas },
  { key: 'overseas', label: '海外来源', test: (signal) => signal.overseas },
  // 原本是一张不可点的指标卡。有用的是"哪些没载日期"——那是要去核的，
  // 做成筛选才有动作；只显示个数字是噪声。
  { key: 'undated', label: '原文未载日期', test: (signal) => !signal.published_at },
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
  const activeFilterLabel = FILTERS.find((item) => item.key === table.activeFilter)?.label ?? '全部';

  return (
    <section className="page art-full-height">
      <ArtPageHead
        compact
        title={meta?.title ?? '信号证据'}
        description={meta?.description}
        actions={<Link className="btn btn-quiet" to="/sources"><Globe2 size={15} />管理数据源</Link>}
      />

      <div className="art-table-card">
        <div className="art-table-card-body">
          <ArtTableHeader
            search={{
              value: table.keyword,
              onChange: table.setKeyword,
              placeholder: '搜索公告、来源、正文摘要…',
              label: '搜索公告标题、来源或正文摘要',
            }}
            left={
              <ArtFilterChips
                label="来源范围"
                filters={FILTERS}
                counts={table.filterCounts}
                active={table.activeFilter}
                onChange={table.setActiveFilter}
              />
            }
            status={
              <>
                <span>
                  {table.keyword && table.total !== table.scopeTotal
                    ? `${activeFilterLabel} 共 ${table.scopeTotal} 条，关键词命中 ${table.total} 条`
                    : `${activeFilterLabel} ${table.total} 条 · 覆盖 ${sourceCount} 个信源`}
                </span>
                {table.keyword && (
                  <span className="art-active-keyword">
                    关键词「{table.keyword}」
                    <button type="button" aria-label="清除关键词" onClick={() => table.setKeyword('')}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </>
            }
            loading={table.isFetching}
            onRefresh={() => void table.refetch()}
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
            emptyContent={table.keyword
              ? `「${table.keyword}」在${activeFilterLabel}范围内没有命中，数据库中的原始记录未被删除。`
              : '该范围内暂无记录，数据库中的原始记录未被删除。'}
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
