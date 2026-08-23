import type { AppRouteRecord, RouteGroup } from '../types';
import { workGroup } from './work';
import { intelligenceGroup } from './intelligence';
import { systemGroup } from './system';

/** 侧栏分组顺序即菜单顺序 */
export const routeGroups: RouteGroup[] = [workGroup, intelligenceGroup, systemGroup];

/** 全部路由拍平，供 createBrowserRouter 与面包屑查找使用 */
export const flatRoutes: AppRouteRecord[] = routeGroups.flatMap((group) => group.routes);

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
