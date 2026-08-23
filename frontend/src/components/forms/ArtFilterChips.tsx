import type { TableFilter } from '../../hooks/useTable';

/**
 * 筛选 chip 组 · 列表页唯一的筛选入口
 *
 * 计数一律取 useTable 的 filterCounts（含当前关键词），
 * 保证 chip 上写的数字就是点下去会看到的行数。
 *
 * separateLast：把最后一项当作**另一个范围**而不是同级筛选。
 * 商机页的"判非商机"就是这种情况——它不在"在研"工作面里，
 * 和"高分/海外"并列会让分母打架。
 */
export function ArtFilterChips<T>({
  filters,
  counts,
  active,
  onChange,
  label,
  separateLast = false,
}: {
  filters: Array<TableFilter<T>>;
  counts: Record<string, number>;
  active: string;
  onChange: (key: string) => void;
  label: string;
  separateLast?: boolean;
}) {
  const main = separateLast ? filters.slice(0, -1) : filters;
  const aside = separateLast ? filters.slice(-1) : [];

  const chip = (filter: TableFilter<T>) => (
    <button
      key={filter.key}
      type="button"
      className={`filter-chip ${filter.key === active ? 'is-active' : ''}`}
      aria-pressed={filter.key === active}
      onClick={() => onChange(filter.key)}
    >
      {filter.label}
      <b>{counts[filter.key] ?? 0}</b>
    </button>
  );

  return (
    <div className="art-filter-chips" role="group" aria-label={label}>
      {main.map(chip)}
      {aside.length > 0 && (
        <>
          <span className="art-filter-divider" aria-hidden="true" />
          {aside.map(chip)}
        </>
      )}
    </div>
  );
}
