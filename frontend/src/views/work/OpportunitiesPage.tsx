import { useMemo } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, SignalZero, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Lead } from '../../api/types';
import { useTable, type TableColumn, type TableFilter } from '../../hooks/useTable';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtLeadCard } from '../../components/cards/ArtLeadCard';
import { ArtFilterChips } from '../../components/forms/ArtFilterChips';
import { ArtPagination } from '../../components/forms/ArtPagination';
import { ArtTableHeader } from '../../components/tables/ArtTableHeader';
import { ArtEmpty, ArtError, ArtLoading } from '../../components/feedback/ArtStates';
import './opportunities.css';

/**
 * 客户信息卡看板 · 卡片网格
 *
 * 2026-08-30 由表格改为卡片：呈现形态换了，**能力一条都没换**——
 * 筛选 chip、关键词搜索、排序、分页全部保留，且仍然走同一个 useTable，
 * 所以 URL 里的 ?q= / ?filter= 也照旧能还原视图。
 *
 * 唯一去掉的是「列设置」：它是表格专有的（隐藏某一列），卡片上没有列可隐藏。
 * 排序原本挂在表头上，卡片没有表头，因此在工具条上补了一排显式排序按钮——
 * 不补的话排序就真丢了。
 */

const FILTERS: Array<TableFilter<Lead>> = [
  { key: 'all', label: '在研', test: (lead) => lead.status !== 'rejected' },
  { key: 'high', label: '高分 ≥80', test: (lead) => lead.status !== 'rejected' && (lead.score ?? 0) >= 80 },
  { key: 'mid', label: '中分 60–79', test: (lead) => lead.status !== 'rejected' && (lead.score ?? 0) >= 60 && (lead.score ?? 0) < 80 },
  { key: 'sea', label: '海外', test: (lead) => lead.status !== 'rejected' && lead.overseas },
  { key: 'card', label: '有作战卡', test: (lead) => lead.status !== 'rejected' && Boolean(lead.has_card) },
  { key: 'rej', label: '判非商机', test: (lead) => lead.status === 'rejected' },
];

/**
 * 排序维度。useTable 只消费 key / sortValue，卡片网格不走 column.render，
 * 所以这里的 render 恒为 null——留着是为了满足 TableColumn 契约，不是死代码。
 */
const SORTS: Array<TableColumn<Lead>> = [
  {
    key: 'score',
    label: '评分',
    sortable: true,
    sortValue: (lead) => (lead.status === 'rejected' ? -1 : lead.score ?? -1),
    render: () => null,
  },
  {
    key: 'deadline',
    label: '截止时间',
    sortable: true,
    // 没有截止时间的排在最后：空串在升序里会跑到最前面，那会把「未载截止」
    // 当成「最急」，是误导。
    sortValue: (lead) => lead.deadline || '9999-12-31',
    render: () => null,
  },
  {
    key: 'published',
    label: '发布时间',
    sortable: true,
    sortValue: (lead) => lead.published_at || '',
    render: () => null,
  },
  {
    key: 'contacts',
    label: '关键人数',
    sortable: true,
    sortValue: (lead) => lead.contacts_count ?? 0,
    render: () => null,
  },
  {
    // 换成卡片后一度漏掉这一维：原表格的「行业 / 地区」列是可排序的，
    // 换呈现形态不该丢功能。行业与地区拼在一起排，等于先按行业聚堆、
    // 再按地区聚堆——正是销售「今天集中打某个行业/某个省」的用法。
    key: 'industry',
    label: '行业 / 地区',
    sortable: true,
    sortValue: (lead) => `${lead.industry || '～'}${lead.region || ''}`,
    render: () => null,
  },
];

export default function OpportunitiesPage() {
  const meta = useRouteMeta();

  const searchFields = useMemo(
    () => (lead: Lead) => [
      lead.company, lead.subject, lead.signal_title, lead.signal_type,
      lead.region, lead.industry, lead.matched_product,
    ],
    [],
  );

  const table = useTable<Lead>({
    queryKey: ['leads'],
    queryFn: () => apiGet<Lead[]>('/api/leads'),
    columns: SORTS,
    filters: FILTERS,
    searchFields,
    pageSize: 24,
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

  /**
   * 回到默认顺序。useTable 只给了 toggleSort（升 → 降 → 无），没有 setSort，
   * 所以升序时要点两下才回得到"无"。这里替用户点完，别让人自己数圈数。
   * 两次调用都走函数式更新，队列里前一次的结果对后一次可见，不会互相吞掉。
   */
  const resetSort = () => {
    if (!table.sort) return;
    if (!table.sort.desc) table.toggleSort(table.sort.key);
    table.toggleSort(table.sort.key);
  };

  return (
    <section className="page art-full-height">
      <ArtPageHead
        compact
        title={meta?.title ?? '商机队列'}
        description={meta?.description}
        actions={<Link className="btn btn-quiet" to="/">去对话追问<ArrowRight size={15} /></Link>}
      />

      <div className="art-table-card">
        <div className="art-table-card-body">
          <ArtTableHeader
            search={{
              value: table.keyword,
              onChange: table.setKeyword,
              placeholder: '搜索主体、标的、地区、行业、产品…',
              label: '搜索商机主体、标的、地区、行业或产品',
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
                <span className="lead-sort" role="group" aria-label="排序">
                  <span className="lead-sort-label">排序</span>
                  {SORTS.map((column) => {
                    const active = table.sort?.key === column.key;
                    return (
                      <button
                        key={column.key}
                        type="button"
                        className={`lead-sort-btn${active ? ' is-active' : ''}`}
                        aria-pressed={active}
                        onClick={() => table.toggleSort(column.key)}
                        title={active
                          ? (table.sort?.desc ? '当前：降序，再点取消排序' : '当前：升序，再点改降序')
                          : `按${column.label}排序`}
                      >
                        {column.label}
                        {active && (table.sort?.desc
                          ? <ArrowDown size={11} aria-hidden="true" />
                          : <ArrowUp size={11} aria-hidden="true" />)}
                      </button>
                    );
                  })}
                  {table.sort && (
                    <button
                      type="button"
                      className="lead-sort-btn is-reset"
                      onClick={resetSort}
                      title="回到默认顺序（后端按评分从高到低返回）"
                    >
                      默认顺序
                    </button>
                  )}
                </span>
              </>
            }
            loading={table.isFetching}
            onRefresh={() => void table.refetch()}
          />

          <div className="lead-grid-scroll">
            {table.rows.length === 0 ? (
              <p className="lead-grid-empty">
                {table.keyword
                  ? `「${table.keyword}」在${activeFilterLabel}范围内没有命中，真实数据仍然保留。`
                  : '该筛选范围内暂无记录，真实数据仍然保留。'}
              </p>
            ) : (
              <div className="lead-grid">
                {table.rows.map((lead) => <ArtLeadCard key={lead.id} lead={lead} />)}
              </div>
            )}
          </div>

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
