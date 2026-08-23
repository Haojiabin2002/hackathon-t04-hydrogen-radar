import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * 列表页统一 hook · 对齐 art-design-pro 的 useTable 契约
 *
 * 与原版的差别：后端接口一次返回全量数组（没有服务端分页），
 * 所以筛选、搜索、排序、分页都在前端做。**不许为了凑分页而伪造 total。**
 *
 * 关键词与筛选写进 URL，刷新和分享都能还原当前视图。
 */

export interface TableColumn<T> {
  /** 列标识，也是列显隐的存储键 */
  key: string;
  label: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  /** 可排序列必须给 sortValue */
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  /** 固定列不可隐藏 */
  fixed?: boolean;
  defaultHidden?: boolean;
}

export interface TableFilter<T> {
  key: string;
  label: string;
  test: (row: T) => boolean;
}

interface UseTableOptions<T> {
  queryKey: unknown[];
  queryFn: () => Promise<T[]>;
  columns: Array<TableColumn<T>>;
  /** 参与关键词搜索的字段，返回 null/undefined 的项会被跳过 */
  searchFields?: (row: T) => Array<string | null | undefined>;
  filters?: Array<TableFilter<T>>;
  pageSize?: number;
  /** URL 参数前缀，同页面有两张表时用来区分 */
  paramPrefix?: string;
}

type SortState = { key: string; desc: boolean } | null;

export function useTable<T>({
  queryKey,
  queryFn,
  columns,
  searchFields,
  filters = [],
  pageSize = 20,
  paramPrefix = '',
}: UseTableOptions<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const qKey = `${paramPrefix}q`;
  const fKey = `${paramPrefix}filter`;

  const query = useQuery({ queryKey, queryFn });

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(columns.filter((column) => column.defaultHidden).map((column) => column.key)),
  );

  const keyword = searchParams.get(qKey)?.trim() ?? '';
  const requestedFilter = searchParams.get(fKey);
  const activeFilter = filters.some((filter) => filter.key === requestedFilter)
    ? (requestedFilter as string)
    : (filters[0]?.key ?? '');

  const writeParam = useCallback((key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
    setPage(1);
  }, [setSearchParams]);

  const setKeyword = useCallback((value: string) => writeParam(qKey, value.trim()), [writeParam, qKey]);

  const setActiveFilter = useCallback((value: string) => {
    writeParam(fKey, value === filters[0]?.key ? '' : value);
  }, [writeParam, fKey, filters]);

  const allRows = useMemo(() => query.data ?? [], [query.data]);

  const filteredRows = useMemo(() => {
    const filter = filters.find((item) => item.key === activeFilter);
    const lowered = keyword.toLocaleLowerCase('zh-CN');
    return allRows.filter((row) => {
      if (filter && !filter.test(row)) return false;
      if (!lowered) return true;
      if (!searchFields) return true;
      return searchFields(row).some((value) =>
        value?.toLocaleLowerCase('zh-CN').includes(lowered),
      );
    });
  }, [allRows, filters, activeFilter, keyword, searchFields]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return filteredRows;
    const getValue = column.sortValue;
    return [...filteredRows].sort((a, b) => {
      const left = getValue(a);
      const right = getValue(b);
      if (left === right) return 0;
      const order = left > right ? 1 : -1;
      return sort.desc ? -order : order;
    });
  }, [filteredRows, sort, columns]);

  const total = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(
    () => sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedRows, safePage, pageSize],
  );

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.has(column.key)),
    [columns, hiddenColumns],
  );

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, desc: false };
      if (!prev.desc) return { key, desc: true };
      return null;
    });
  }, []);

  return {
    // 数据
    rows,
    allRows,
    filteredRows: sortedRows,
    total,
    // 状态
    loading: query.isLoading,
    error: query.isError ? query.error : null,
    refetch: query.refetch,
    isFetching: query.isFetching,
    // 列
    columns,
    visibleColumns,
    hiddenColumns,
    toggleColumn,
    // 排序
    sort,
    toggleSort,
    // 搜索与筛选
    keyword,
    setKeyword,
    filters,
    activeFilter,
    setActiveFilter,
    // 分页
    page: safePage,
    pageCount,
    pageSize,
    setPage,
  };
}
