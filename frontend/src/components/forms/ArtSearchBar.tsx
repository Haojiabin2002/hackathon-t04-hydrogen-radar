import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { RotateCcw, Search } from 'lucide-react';

/**
 * 搜索栏 · 列表页三段式的第一段
 *
 * 约定：
 *  · 输入不即时触发请求，按「查询」或回车才生效
 *  · 条件写进 URL，刷新和分享都能还原当前视图
 *  · 显隐由 ArtTableHeader 上的搜索按钮控制（open 受控），与 art-design-pro 一致
 */
export function ArtSearchBar({
  open = true,
  keyword,
  onSearch,
  onReset,
  placeholder = '搜索关键词',
  children,
}: {
  open?: boolean;
  keyword: string;
  onSearch: (value: string) => void;
  onReset?: () => void;
  placeholder?: string;
  /** 额外的筛选字段，放进同一套栅格 */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(keyword);

  // URL 里的关键词被外部改动（比如从别处跳进来带了 ?q=）时同步回输入框
  useEffect(() => { setDraft(keyword); }, [keyword]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(draft);
  };

  const reset = () => {
    setDraft('');
    onSearch('');
    onReset?.();
  };

  return (
    <form className="art-search-bar art-card" onSubmit={submit} role="search">
      <div className="art-search-grid">
        <div className="art-search-field">
          <label htmlFor="art-search-keyword">关键词</label>
          <input
            id="art-search-keyword"
            type="search"
            className="search-field"
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        {children}
      </div>

      <div className="art-search-actions">
        <button type="button" className="btn btn-quiet" onClick={reset}>
          <RotateCcw size={15} aria-hidden="true" />重置
        </button>
        <button type="submit" className="btn btn-primary">
          <Search size={15} aria-hidden="true" />查询
        </button>
      </div>
    </form>
  );
}
