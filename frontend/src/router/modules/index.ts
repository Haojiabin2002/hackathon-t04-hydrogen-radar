import type { AppRouteRecord, RouteGroup } from '../types';
import { controlGroup } from './control';
import { displayGroup } from './display';

/**
 * 侧栏分组顺序即菜单顺序。
 *
 * 界面分两层（2026-08-30 拍板）：
 *   控制层 —— 对话（首页）/ 知识库 / 数据源 / 能力配置 / 密钥配置
 *   展示层 —— 客户信息卡看板 / 信号证据 / 审批
 */
export const routeGroups: RouteGroup[] = [controlGroup, displayGroup];

/**
 * 全部路由拍平，供 createBrowserRouter 与面包屑查找使用。
 * 二级折叠菜单（sections）里的记录也在其中——收纳只影响侧栏怎么画，不影响路由。
 */
export const flatRoutes: AppRouteRecord[] = routeGroups.flatMap((group) => [
  ...group.routes,
  ...(group.sections ?? []).flatMap((section) => section.routes),
]);

/**
 * 按 pathname 找到对应路由记录。支持 /opportunities/:leadId 这类动态段。
 * 找不到返回 undefined —— 调用方要自己处理 404，不许兜个假标题。
 */
export function matchRoute(pathname: string): AppRouteRecord | undefined {
  const exact = flatRoutes.find((route) => route.path === pathname);
  if (exact) return exact;

  return flatRoutes.find((route) => {
    if (!route.path.includes(':')) return false;
    const pattern = new RegExp(
      `^${route.path.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/')}$`,
    );
    return pattern.test(pathname);
  });
}
