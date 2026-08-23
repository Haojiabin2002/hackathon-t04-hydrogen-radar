import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { matchRoute, routeGroups } from '../../router/modules';

/**
 * 面包屑 · 从路由 meta 与分组反推层级
 * 找不到匹配路由时只显示当前路径，不编造标题。
 */
export function ArtBreadcrumb() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname);

  if (!route) {
    return (
      <nav className="breadcrumb" aria-label="面包屑">
        <span className="breadcrumb-item is-current">{pathname}</span>
      </nav>
    );
  }

  const group = routeGroups.find((item) => item.routes.some((r) => r.path === route.path));
  const parent = route.meta.activePath
    ? routeGroups.flatMap((g) => g.routes).find((r) => r.path === route.meta.activePath)
    : undefined;

  const trail = [
    group ? { label: group.label, to: null as string | null } : null,
    parent ? { label: parent.meta.title, to: parent.path } : null,
    { label: route.meta.title, to: null as string | null },
  ].filter(Boolean) as Array<{ label: string; to: string | null }>;

  return (
    <nav className="breadcrumb" aria-label="面包屑">
      {trail.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 && <ChevronRight className="breadcrumb-sep" size={13} aria-hidden="true" />}
          {item.to
            ? <Link className="breadcrumb-item" to={item.to}>{item.label}</Link>
            : (
              <span
                className={`breadcrumb-item ${index === trail.length - 1 ? 'is-current' : ''}`}
                aria-current={index === trail.length - 1 ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
        </Fragment>
      ))}
    </nav>
  );
}
