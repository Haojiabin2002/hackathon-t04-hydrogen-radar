import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { routeGroups } from '../../router/modules';
import { useSettings } from '../../hooks/useSettings';
import { useCollectStatus } from '../../hooks/useCollectStatus';

/**
 * 侧栏菜单 · 完全由 router/modules 的 meta 派生
 * 想加菜单项请去改路由模块，不要在这里写死数组。
 */
export function ArtSidebarMenu() {
  const { settings, update } = useSettings();
  const { stats } = useCollectStatus();
  const collapsed = settings.sidebarCollapsed;

  return (
    <div className="sidebar">
      <NavLink className="sidebar-brand" to="/" aria-label="氢能商机雷达首页">
        <span className="sidebar-brand-mark"><span>H</span><sub>2</sub></span>
        <span className="sidebar-brand-copy">
          <strong>氢能商机雷达</strong>
          <small>v{stats.data?.version ?? '—'}</small>
        </span>
      </NavLink>

      <nav className="sidebar-scroll" aria-label="主导航">
        {routeGroups.map((group) => {
          const visible = group.routes.filter((route) => !route.meta.hideInMenu);
          if (!visible.length) return null;
          return (
            <div className="sidebar-group" key={group.key}>
              <p className="sidebar-group-label">{group.label}</p>
              {visible.map(({ path, meta }) => {
                const Icon = meta.icon;
                const pending = path === '/opportunities' ? stats.data?.pending : undefined;
                return (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === '/'}
                    title={collapsed ? meta.title : undefined}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}
                  >
                    {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden="true" />}
                    <span>{meta.title}</span>
                    {Boolean(pending) && <b className="sidebar-link-badge">{pending}</b>}
                  </NavLink>
                );
              })}
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
