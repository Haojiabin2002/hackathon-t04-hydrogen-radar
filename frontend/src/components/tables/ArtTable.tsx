import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TableColumn } from '../../hooks/useTable';

/**
 * 表格 · 列驱动渲染
 * 列定义（含排序、宽度、显隐）来自 useTable，页面不直接写 <th>/<td>。
 */
export function ArtTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  onToggleSort,
  emptyContent,
}: {
  rows: T[];
  columns: Array<TableColumn<T>>;
  rowKey: (row: T) => string | number;
  sort?: { key: string; desc: boolean } | null;
  onToggleSort?: (key: string) => void;
  emptyContent?: ReactNode;
}) {
  return (
    <div className="art-table-scroll">
      <table className="art-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const sortable = column.sortable && column.sortValue && onToggleSort;
              return (
                <th
                  key={column.key}
                  style={{ width: column.width, textAlign: column.align }}
                  className={sortable ? 'is-sortable' : undefined}
                  aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
                  onClick={sortable ? () => onToggleSort(column.key) : undefined}
                >
                  {sortable ? (
                    <span className="art-table-sort">
                      {column.label}
                      {active
                        ? (sort.desc
                          ? <ArrowDown size={12} aria-hidden="true" />
                          : <ArrowUp size={12} aria-hidden="true" />)
                        : <ChevronsUpDown size={12} aria-hidden="true" opacity={0.5} />}
                    </span>
                  ) : column.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="art-table-empty">
              <td colSpan={columns.length}>{emptyContent ?? '没有符合条件的记录'}</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
