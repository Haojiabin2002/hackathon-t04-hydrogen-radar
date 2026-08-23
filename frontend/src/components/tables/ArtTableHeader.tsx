import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlignRight, Check, RefreshCw, Search, X } from 'lucide-react';
import type { TableColumn } from '../../hooks/useTable';

/**
 * 列表工具条 · 列表页的唯一筛选控件
 *
 * 约定（不要调换）：
 *   上排左 = 常驻关键词框 + 筛选 chip
 *   上排右 = 表格工具（刷新、列设置）
 *   下排   = 结果计数与生效中的关键词
 *
 * 为什么关键词框常驻而不是收在折叠面板里：
 * 折叠面板是给六到八个字段准备的，我们只有一个字段。收起来的直接后果是
 * URL 带着 ?q= 进来时，界面上没有任何地方显示"有关键词在过滤"，
 * 用户看见 3 条结果却不知道为什么。
 */
export function ArtTableHeader<T>({
  left,
  status,
  loading,
  onRefresh,
  search,
  columns,
  hiddenColumns,
  onToggleColumn,
}: {
  left?: ReactNode;
  /** 结果计数那一行 */
  status?: ReactNode;
  loading?: boolean;
  onRefresh?: () => void;
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    label?: string;
  };
  columns?: Array<TableColumn<T>>;
  hiddenColumns?: Set<string>;
  onToggleColumn?: (key: string) => void;
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [draft, setDraft] = useState(search?.value ?? '');
  const anchorRef = useRef<HTMLDivElement>(null);

  // URL 里的关键词被外部改动（从别处带 ?q= 跳进来）时同步回输入框
  useEffect(() => { setDraft(search?.value ?? ''); }, [search?.value]);

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

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    search?.onChange(draft.trim());
  };

  return (
    <div className="art-list-toolbar">
      <div className="art-table-header">
        <div className="art-table-header-left">
          {search && (
            <form className="art-inline-search" onSubmit={submitSearch} role="search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={draft}
                aria-label={search.label ?? '搜索'}
                placeholder={search.placeholder ?? '搜索关键词'}
                onChange={(event) => setDraft(event.target.value)}
              />
              {draft && (
                <button
                  type="button"
                  className="art-inline-search-clear"
                  aria-label="清除关键词"
                  onClick={() => { setDraft(''); search.onChange(''); }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </form>
          )}
          {left}
        </div>

        <div className="art-table-header-right">
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

      {status && <p className="art-list-status" aria-live="polite">{status}</p>}
    </div>
  );
}
