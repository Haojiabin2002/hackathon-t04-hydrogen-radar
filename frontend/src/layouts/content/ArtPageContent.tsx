import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

/**
 * 内容区 · 限宽容器 + 路由切换过渡 + 焦点管理
 * 限宽由 --container-max 控制（设置面板可切「限宽 / 铺满」）。
 */
export function ArtPageContent() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // 换页后把焦点交给内容区，键盘用户不用从头 Tab 一遍侧栏
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <main
      id="main-content"
      className="layout-content"
      ref={mainRef}
      tabIndex={-1}
    >
      <div className="route-transition" key={`${location.pathname}${location.search}`}>
        <Outlet />
      </div>
    </main>
  );
}
