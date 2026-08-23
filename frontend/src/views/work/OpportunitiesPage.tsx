import { useMemo } from 'react';
import { ArrowRight, ExternalLink, SignalZero, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Lead } from '../../api/types';
import { useTable, type TableColumn, type TableFilter } from '../../hooks/useTable';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtFilterChips } from '../../components/forms/ArtFilterChips';
import { ArtPagination } from '../../components/forms/ArtPagination';
import { ArtTable } from '../../components/tables/ArtTable';
import { ArtTableHeader } from '../../components/tables/ArtTableHeader';
import { ArtEmpty, ArtError, ArtLoading } from '../../components/feedback/ArtStates';

const FILTERS: Array<TableFilter<Lead>> = [
  { key: 'all', label: '在研', test: (lead) => lead.status !== 'rejected' },
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

const columns: Array<TableColumn<Lead>> = [
  {
    key: 'company',
    label: '商机主体',
    fixed: true,
    width: 280,
    render: (lead) => (
      <div className="table-title">
        <Link to={`/opportunities/${lead.id}`}>{lead.company || '公告未提及采购主体'}</Link>
        <small>#{lead.id} · {lead.signal_type || lead.signal_title || '未分类信号'}</small>
      </div>
    ),
  },
  {
    key: 'score',
    label: '评分',
    width: 96,
    sortable: true,
    sortValue: (lead) => (lead.status === 'rejected' ? -1 : lead.score ?? 0),
    render: (lead) => (
      <span className={`badge ${scoreBadge(lead)}`}>
        {lead.status === 'rejected' ? '非商机' : `${lead.score ?? '—'} 分`}
      </span>
    ),
  },
  {
    key: 'region',
    label: '行业 / 地区',
    sortable: true,
    sortValue: (lead) => lead.industry ?? '',
    render: (lead) => (
      <>
        {lead.industry || <span className="cell-muted">未归类</span>}
        <br />
        <small className="cell-muted">{lead.region || '公告未提及地区'}</small>
      </>
    ),
  },
  {
    key: 'scale',
    label: '规模 / 截止',
    render: (lead) => (
      <>
        {lead.amount || lead.power_range || <span className="cell-muted">公告未提及</span>}
        <br />
        <small className="cell-muted">{lead.deadline ? `截止 ${formatDate(lead.deadline)}` : '截止日期未载'}</small>
      </>
    ),
  },
  {
    key: 'product',
    label: '产品匹配',
    render: (lead) => (
      <>
        {lead.matched_product || <span className="cell-muted">尚未配型</span>}
        <br />
        {lead.has_card ? <span className="badge badge-success">有作战卡</span> : null}
      </>
    ),
  },
  {
    key: 'evidence',
    label: '证据',
    width: 200,
    render: (lead) => (
      <div className="row-actions">
        {lead.overseas && <span className="badge badge-info">海外</span>}
        {lead.corroboration && <span className="badge badge-success">交叉验证</span>}
        <a
          className="btn btn-link"
          href={lead.source_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`回源核对 ${lead.company || lead.signal_title}`}
        >
          原文<ExternalLink size={12} />
        </a>
      </div>
    ),
  },
];

export default function OpportunitiesPage() {
  const meta = useRouteMeta();

  const searchFields = useMemo(
    () => (lead: Lead) => [
      lead.company, lead.signal_title, lead.signal_type,
      lead.region, lead.industry, lead.matched_product,
    ],
    [],
  );

  const table = useTable<Lead>({
    queryKey: ['leads'],
    queryFn: () => apiGet<Lead[]>('/api/leads'),
    columns,
    filters: FILTERS,
    searchFields,
    pageSize: 20,
  });

  if (table.loading) return <ArtLoading label="正在加载商机" />;
  if (table.error) {
    return <ArtError title="商机列表加载失败" error={table.error} onRetry={() => void table.refetch()} />;
  }

  // 接口返回真实空列表 —— 这不是"加载中"，要给出真实的下一步
  if (table.allRows.length === 0) {
    return (
      <section className="page">
        <ArtPageHead compact title={meta?.title ?? '商机队列'} description={meta?.description} />
        <ArtEmpty
          icon={<SignalZero size={28} aria-hidden="true" />}
          title="还没有进入研判的商机"
          description="这不是演示数据缺失：当前 /api/leads 返回空列表。先查看是否已有真实信号，再检查模型通道并启动采集。"
          actions={
            <>
              <Link className="btn btn-primary" to="/signals">查看信号证据</Link>
              <Link className="btn btn-quiet" to="/settings/models">检查模型通道</Link>
            </>
          }
        />
      </section>
    );
  }

  const activeFilterLabel = FILTERS.find((item) => item.key === table.activeFilter)?.label ?? '在研';

  return (
    <section className="page art-full-height">
      <ArtPageHead
        compact
        title={meta?.title ?? '商机队列'}
        description={meta?.description}
        actions={<Link className="btn btn-quiet" to="/assistant">询问研判助手<ArrowRight size={15} /></Link>}
      />

      <div className="art-table-card">
        <div className="art-table-card-body">
          <ArtTableHeader
            search={{
              value: table.keyword,
              onChange: table.setKeyword,
              placeholder: '搜索主体、地区、行业、产品…',
              label: '搜索商机主体、地区、行业或产品',
            }}
            left={
              <ArtFilterChips
                label="商机筛选"
                filters={FILTERS}
                counts={table.filterCounts}
                active={table.activeFilter}
                onChange={table.setActiveFilter}
                separateLast
              />
            }
            status={
              <>
                <span>
                  {table.keyword && table.total !== table.scopeTotal
                    ? `${activeFilterLabel} 共 ${table.scopeTotal} 条，关键词命中 ${table.total} 条`
                    : `${activeFilterLabel} ${table.total} 条`}
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
            rowKey={(lead) => lead.id}
            sort={table.sort}
            onToggleSort={table.toggleSort}
            emptyContent={table.keyword
              ? `「${table.keyword}」在${activeFilterLabel}范围内没有命中，真实数据仍然保留。`
              : '该筛选范围内暂无记录，真实数据仍然保留。'}
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
