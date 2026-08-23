/** 分页器 · 总数来自真实数据长度，没有数据就不显示 */
export function ArtPagination({
  page, pageCount, total, pageSize, onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (next: number) => void;
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // 页码窗口：当前页前后各两页，首尾始终可达
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, Math.max(page + 2, 5));
  for (let i = start; i <= end; i += 1) pages.push(i);

  return (
    <nav className="art-pagination" aria-label="分页">
      <span className="art-pagination-info">
        第 {from}–{to} 条，共 {total} 条
      </span>
      {pageCount > 1 && (
        <span className="art-pagination-pages">
          <button
            type="button"
            className="art-page-btn"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
          >
            上一页
          </button>
          {pages.map((item) => (
            <button
              key={item}
              type="button"
              className={`art-page-btn ${item === page ? 'is-active' : ''}`}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className="art-page-btn"
            disabled={page >= pageCount}
            onClick={() => onChange(page + 1)}
          >
            下一页
          </button>
        </span>
      )}
    </nav>
  );
}
