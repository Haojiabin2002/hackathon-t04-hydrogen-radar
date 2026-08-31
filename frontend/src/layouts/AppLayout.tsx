import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArtSidebarMenu } from './sidebar/ArtSidebarMenu';
import { ArtHeaderBar } from './header/ArtHeaderBar';
import { ArtWorkTab } from './worktab/ArtWorkTab';
import { ArtSettingsDrawer } from './settings/ArtSettingsDrawer';
import { ArtPageContent } from './content/ArtPageContent';
import { ArtAuthChallenge } from '../components/auth/ArtAuthChallenge';
import { useSettings } from '../hooks/useSettings';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { WorktabProvider } from '../hooks/useWorktab';

/**
 * 布局壳 · 结构对齐 art-design-pro 的 views/index/index.vue
 *
 *   .app-layout
 *     #app-sidebar   侧栏菜单（由路由 meta 派生）
 *     #app-main
 *       #app-header  面包屑 / 链路状态 / 启动雷达 / 明暗 / 设置
 *       #app-worktab 多标签页
 *       #app-content 限宽内容区
 */
export function AppLayout() {
  const { settings, update } = useSettings();
  const location = useLocation();
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 换页后关掉移动端抽屉
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  const sidebarState = isNarrow
    ? (mobileNavOpen ? 'open' : 'closed')
    : (settings.sidebarCollapsed ? 'collapsed' : 'expanded');

  const toggleSidebar = () => {
    if (isNarrow) setMobileNavOpen((value) => !value);
    else update({ sidebarCollapsed: !settings.sidebarCollapsed });
  };

  const worktabVisible = settings.showWorktab && !isNarrow;

  return (
    <WorktabProvider>
      <div className="app-layout" data-sidebar={sidebarState} data-worktab={worktabVisible ? 'on' : 'off'}>
        <a className="skip-link" href="#main-content">跳到主要内容</a>

        <aside id="app-sidebar">
          <ArtSidebarMenu />
        </aside>

        {isNarrow && mobileNavOpen && (
          <button
            type="button"
            className="sidebar-scrim"
            onClick={() => setMobileNavOpen(false)}
            aria-label="关闭导航"
          />
        )}

        <div id="app-main">
          <header id="app-header">
            <ArtHeaderBar
              onToggleSidebar={toggleSidebar}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </header>

          {worktabVisible && <div id="app-worktab"><ArtWorkTab /></div>}

          <div id="app-content"><ArtPageContent /></div>
        </div>

        <ArtSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ArtAuthChallenge />
      </div>
    </WorktabProvider>
  );
}
