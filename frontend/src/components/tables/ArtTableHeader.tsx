import { useEffect, useRef, useState } from 'react';
import { AlignRight, Check, RefreshCw, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TableColumn } from '../../hooks/useTable';

/**
 * 表格头工具条 · 列表页三段式的第二段
 *
 * 约定（来自 art-design-pro，不要调换）：
 *   左侧 = 业务动作（新增、导出、批量…）
 *   右侧 = 表格工具（刷新、列设置）
 */
export function ArtTableHeader<T>({
  left,
  count,
  loading,
  onRefresh,
  searchOpen,
  onToggleSearch,
  columns,
  hiddenColumns,
  onToggleColumn,
}: {
  left?: ReactNode;
  count?: ReactNode;
  loading?: boolean;
  onRefresh?: () => void;
  /** 传了才渲染搜索开关；开关控制 ArtSearchBar 的显隐 */
  searchOpen?: boolean;
  onToggleSearch?: () => void;
  columns?: Array<TableColumn<T>>;
  hiddenColumns?: Set<string>;
  onToggleColumn?: (key: string) => void;
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!columnsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setColumnsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setColumnsOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [columnsOpen]);

  return (
    <div className="art-table-header">
      <div className="art-table-header-left">
        {left}
        {count !== undefined && <span className="art-table-header-count">{count}</span>}
      </div>

      <div className="art-table-header-right">
        {onToggleSearch && (
          <button
            type="button"
            className={`art-tool-btn ${searchOpen ? 'is-active' : ''}`}
            onClick={onToggleSearch}
            aria-expanded={searchOpen}
            aria-label={searchOpen ? '收起搜索栏' : '展开搜索栏'}
            title={searchOpen ? '收起搜索栏' : '展开搜索栏'}
          >
            <Search size={15} aria-hidden="true" />
          </button>
        )}

        {onRefresh && (
          <button
            type="button"
            className={`art-tool-btn ${loading ? 'is-spinning' : ''}`}
            onClick={onRefresh}
            aria-label="重新读取"
            title="重新读取"
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        )}

        {columns && onToggleColumn && (
          <div className="art-tool-anchor" ref={anchorRef}>
            <button
              type="button"
              className={`art-tool-btn ${columnsOpen ? 'is-active' : ''}`}
              onClick={() => setColumnsOpen((value) => !value)}
              aria-expanded={columnsOpen}
              aria-label="列设置"
              title="列设置"
            >
              <AlignRight size={15} aria-hidden="true" />
            </button>
            {columnsOpen && (
              <div className="art-column-panel" role="group" aria-label="选择显示的列">
                {columns.map((column) => {
                  const visible = !hiddenColumns?.has(column.key);
                  return (
                    <button
                      key={column.key}
                      type="button"
                      className="art-column-option"
                      aria-pressed={visible}
                      disabled={column.fixed}
                      onClick={() => onToggleColumn(column.key)}
                    >
                      <Check size={14} opacity={visible ? 1 : 0.15} aria-hidden="true" />
                      {column.label}
                      {column.fixed && <small style={{ marginLeft: 'auto', opacity: .6 }}>固定</small>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
