import type { ReactNode } from 'react';

/**
 * 页头 · 标题 + 一句话说明 + 右侧动作
 *
 * 两种形态：
 *  · 默认（大页头）：当日研判、详情页用，展示字体 + 渐变画布
 *  · compact：列表页用。面包屑与多标签已经交代了位置，这里只留一行标题，
 *    把纵向空间还给表格。
 *
 * 标题与说明默认取自路由 meta，页面不用重复写一遍。
 */
export function ArtPageHead({
  title,
  description,
  actions,
  back,
  compact = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** 返回上一层的链接，详情页与编辑页用 */
  back?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={`page-head ${compact ? 'is-compact' : ''}`}>
      <div>
        {back}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-intro">{description}</p>}
      </div>
      {actions && <div className="row-actions">{actions}</div>}
    </header>
  );
}
