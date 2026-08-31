import { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { flatRoutes } from './modules';

/**
 * 路由表由 router/modules/* 生成 —— 不要在这里手写页面清单。
 * 加页面请改对应 module，侧栏菜单和多标签页会自动跟上。
 *
 * 唯一例外是下面的 /login：它必须渲染在 AppLayout **之外**（登录页不该套
 * 侧栏和多标签），而 modules 里的记录全部是 AppLayout 的子路由。
 * 它也不该进菜单，所以放 modules 里反而要额外加 hideInMenu + hideInWorktab。
 * 这个例外只此一处，不要拿它当在这里加页面的先例。
 */

const LoginPage = lazy(() => import('../views/auth/LoginPage'));

function RouteFallback() {
  return (
    <div className="loading-stack panel" aria-busy="true" aria-label="正在载入页面">
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
    </div>
  );
}

/**
 * 老地址回家。`/assistant?lead=12` 这类链接（商机详情页发出去过）必须**带着
 * query 一起**落到新首页，否则点过去会丢掉聚焦的那条线索，看起来像个 bug。
 */
function RedirectHome() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

function RouteError() {
  return (
    <main className="route-error">
      <span className="route-error-code">404</span>
      <h1>这条路径不在雷达航线中</h1>
      <p>地址可能已经变化，或者对应对象已被归并。</p>
      <a className="btn btn-primary" href="/">返回对话首页</a>
    </main>
  );
}

export const router = createBrowserRouter(
  [
    {
      path: '/login',
      element: (
        <Suspense fallback={<RouteFallback />}>
          <LoginPage />
        </Suspense>
      ),
      errorElement: <RouteError />,
    },
    {
      path: '/',
      element: <AppLayout />,
      errorElement: <RouteError />,
      children: [
        ...flatRoutes.map(({ path, component: Component }) => ({
          // createBrowserRouter 的子路由用相对路径，根路由用 index
          ...(path === '/' ? { index: true as const } : { path: path.replace(/^\//, '') }),
          element: (
            <Suspense fallback={<RouteFallback />}>
              <Component />
            </Suspense>
          ),
        })),
        // 历史地址：/today 是首页的旧路径，/assistant 是对话升为首页之前的路径。
        // 两条都只做重定向，不是在这里加页面。
        { path: 'today', element: <RedirectHome /> },
        { path: 'assistant', element: <RedirectHome /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
