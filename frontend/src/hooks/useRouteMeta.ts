import { useLocation } from 'react-router-dom';
import { matchRoute } from '../router/modules';
import type { RouteMeta } from '../router/types';

/**
 * 取当前路由的 meta。页面用它拿标题和说明，
 * 避免同一句话在路由模块和页面里各写一遍、改了一处忘另一处。
 */
export function useRouteMeta(): RouteMeta | undefined {
  const { pathname } = useLocation();
  return matchRoute(pathname)?.meta;
}
