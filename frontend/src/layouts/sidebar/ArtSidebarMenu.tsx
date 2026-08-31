import { Fragment, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Atom, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { routeGroups } from '../../router/modules';
import type { AppRouteRecord, RouteSection } from '../../router/types';
import { useSettings } from '../../hooks/useSettings';
import { useCollectStatus } from '../../hooks/useCollectStatus';
import { useProposalCount } from '../../hooks/useProposals';

/**
 * 侧栏菜单 · 完全由 router/modules 的 meta 派生
 * 想加菜单项请去改路由模块，不要在这里写死数组。
 *
 * 两层结构：分组（控制层 / 展示层）→ 菜单项；分组下还可以有二级折叠菜单
 * （group.sections，如「能力配置」）。二级只是收纳，子项仍是独立路由。
 */

function MenuLink({ route, collapsed, badge }: {
  route: AppRouteRecord;
  collapsed: boolean;
  badge?: number;
}) {
  const Icon = route.meta.icon;
  return (
    <NavLink
      to={route.path}
      end={route.path === '/'}
      title={collapsed ? route.meta.title : undefined}
      className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}
    >
      {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden="true" />}
      <span>{route.meta.title}</span>
      {Boolean(badge) && <b className="sidebar-link-badge">{badge}</b>}
    </NavLink>
  );
}

/**
 * 二级折叠菜单。默认展开与否看「当前页是不是它的子项」——
 * 用户点进技能编辑页时不该看见父菜单是收起的。
 */
function MenuSection({ section, collapsed, badgeOf }: {
  section: RouteSection;
  collapsed: boolean;
  badgeOf: (route: AppRouteRecord) => number | undefined;
}) {
  const { pathname } = useLocation();
  const visible = section.routes.filter((route) => !route.meta.hideInMenu);
  const holdsCurrent = section.routes.some(
    (route) => route.path === pathname || route.meta.activePath === pathname
      || pathname.startsWith(`${route.path}/`),
  );
  const [open, setOpen] = useState(holdsCurrent);
  if (!visible.length) return null;

  // 收起态只剩图标，二级缩进没有意义，直接摊平（图标 + title 提示仍在）
  if (collapsed) {
    return (
      <>
        {visible.map((route) => (
          <MenuLink key={route.path} route={route} collapsed badge={badgeOf(route)} />
        ))}
      </>
    );
  }

  const expanded = open || holdsCurrent;
  const Icon = section.icon;

  return (
    <div className={`sidebar-section ${expanded ? 'is-open' : ''}`}>
      <button
        type="button"
        className={`sidebar-link sidebar-section-toggle ${holdsCurrent ? 'holds-current' : ''}`}
        aria-expanded={expanded}
        onClick={() => setOpen((value) => !value)}
      >
        {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden="true" />}
        <span>{section.label}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="sidebar-section-caret" />
      </button>
      {expanded && (
        <div className="sidebar-section-body">
          {visible.map((route) => (
            <MenuLink key={route.path} route={route} collapsed={false} badge={badgeOf(route)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtSidebarMenu() {
  const { settings, update } = useSettings();
  const { stats } = useCollectStatus();
  const pendingProposals = useProposalCount();
  const collapsed = settings.sidebarCollapsed;

  /** 菜单项右侧的计数徽标。只在真读到数时显示，读不到就不画。 */
  const badgeOf = (route: AppRouteRecord): number | undefined => {
    if (route.path === '/opportunities') return stats.data?.pending;
    if (route.path === '/approvals') return pendingProposals ?? undefined;
    return undefined;
  };

  return (
    <div className="sidebar">
      <NavLink className="sidebar-brand" to="/" aria-label="氢能商机雷达首页">
        <span className="sidebar-brand-mark">
          <Atom size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="sidebar-brand-copy">
          <strong>氢能商机雷达</strong>
          <small>v{stats.data?.version ?? '—'}</small>
        </span>
      </NavLink>

      <nav className="sidebar-scroll" aria-label="主导航">
        {routeGroups.map((group) => {
          const visible = group.routes.filter((route) => !route.meta.hideInMenu);
          const sections = group.sections ?? [];
          if (!visible.length && !sections.length) return null;
          // section.after 指向哪一项就插在哪一项后面；指不到就排在分组末尾
          const anchored = new Set(
            sections.filter((s) => s.after && visible.some((r) => r.path === s.after)).map((s) => s.key),
          );
          const renderSection = (section: RouteSection) => (
            <MenuSection
              key={section.key}
              section={section}
              collapsed={collapsed}
              badgeOf={badgeOf}
            />
          );
          return (
            <div className="sidebar-group" key={group.key}>
              <p className="sidebar-group-label">{group.label}</p>
              {visible.map((route) => (
                // Fragment 不产生 DOM 节点，.sidebar-link + .sidebar-link 的相邻间距才不会断
                <Fragment key={route.path}>
                  <MenuLink route={route} collapsed={collapsed} badge={badgeOf(route)} />
                  {sections.filter((s) => anchored.has(s.key) && s.after === route.path).map(renderSection)}
                </Fragment>
              ))}
              {sections.filter((s) => !anchored.has(s.key)).map(renderSection)}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-link"
          onClick={() => update({ sidebarCollapsed: !collapsed })}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed
            ? <PanelLeftOpen size={17} strokeWidth={1.9} aria-hidden="true" />
            : <PanelLeftClose size={17} strokeWidth={1.9} aria-hidden="true" />}
          <span>收起侧栏</span>
        </button>
      </div>
    </div>
  );
}
