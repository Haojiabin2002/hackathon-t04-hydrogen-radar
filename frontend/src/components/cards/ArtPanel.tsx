import type { ReactNode } from 'react';

/** 面板 · 标题区 + 内容区。页面里的分区一律用它，不要各写各的卡片。 */
export function ArtPanel({
  title,
  description,
  actions,
  children,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="row-actions">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName ?? 'panel-body'}>{children}</div>
    </section>
  );
}
