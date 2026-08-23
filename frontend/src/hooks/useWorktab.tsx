import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { matchRoute } from '../router/modules';

/**
 * 多标签页 · 状态与路由联动
 *
 * 规则：
 *  · 首页固定，不可关闭
 *  · meta.hideInWorktab 的页面不进标签
 *  · 动态路由（/opportunities/:id）按完整 path 各占一个标签，标题带上编号
 *  · 关掉当前标签后落到左邻，没有左邻就回首页
 */

export interface WorkTabItem {
  path: string;
  title: string;
  fixed: boolean;
}

interface WorktabContextValue {
  tabs: WorkTabItem[];
  activePath: string;
  closeTab: (path: string) => void;
  closeOthers: (path: string) => void;
  closeAll: () => void;
}

const WorktabContext = createContext<WorktabContextValue | null>(null);
const STORAGE_KEY = 'hydrogen-radar-worktabs';
const HOME: WorkTabItem = { path: '/', title: '当日研判', fixed: true };

/**
 * 动态路由带上参数值，避免两条商机详情挤成同一个标签看不出区别。
 *
 * 注意取的是**动态段对应位置**的值，不是 pathname 末段：
 * /skills/:skillKey/edit 的末段是字面量 'edit'，取末段会得到「编辑技能 #edit」。
 */
function resolveTitle(pathname: string): string | null {
  const route = matchRoute(pathname);
  if (!route || route.meta.hideInWorktab) return null;
  if (!route.path.includes(':')) return route.meta.title;

  const pattern = route.path.split('/');
  const actual = pathname.split('/');
  const values = pattern
    .map((segment, index) => (segment.startsWith(':') ? actual[index] : null))
    .filter((value): value is string => Boolean(value));

  return values.length ? `${route.meta.title} #${values.join('/')}` : route.meta.title;
}

function readStored(): WorkTabItem[] {
  if (typeof window === 'undefined') return [HOME];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [HOME];
    const parsed = JSON.parse(raw) as WorkTabItem[];
    if (!Array.isArray(parsed) || !parsed.length) return [HOME];
    return parsed.some((tab) => tab.path === '/') ? parsed : [HOME, ...parsed];
  } catch {
    return [HOME];
  }
}

export function WorktabProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<WorkTabItem[]>(readStored);

  useEffect(() => {
    const title = resolveTitle(location.pathname);
    if (!title) return;
    setTabs((prev) => {
      if (prev.some((tab) => tab.path === location.pathname)) return prev;
      return [...prev, { path: location.pathname, title, fixed: location.pathname === '/' }];
    });
  }, [location.pathname]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // 会话存储不可用时标签只活在当前页面生命周期里
    }
  }, [tabs]);

  const closeTab = useCallback((path: string) => {
    if (path === '/') return;
    // 先算好落点再改状态：navigate 是副作用，不能写在 setState 的更新函数里
    const index = tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const next = tabs.filter((tab) => tab.path !== path);
    setTabs(next.length ? next : [HOME]);
    if (path === location.pathname) {
      navigate(next[index - 1]?.path ?? next[next.length - 1]?.path ?? '/');
    }
  }, [tabs, location.pathname, navigate]);

  const closeOthers = useCallback((path: string) => {
    setTabs((prev) => prev.filter((tab) => tab.path === path || tab.fixed));
    if (location.pathname !== path) navigate(path);
  }, [location.pathname, navigate]);

  const closeAll = useCallback(() => {
    setTabs([HOME]);
    navigate('/');
  }, [navigate]);

  const value = useMemo(
    () => ({ tabs, activePath: location.pathname, closeTab, closeOthers, closeAll }),
    [tabs, location.pathname, closeTab, closeOthers, closeAll],
  );

  return <WorktabContext.Provider value={value}>{children}</WorktabContext.Provider>;
}

export function useWorktab(): WorktabContextValue {
  const ctx = useContext(WorktabContext);
  if (!ctx) throw new Error('useWorktab 必须在 WorktabProvider 内使用');
  return ctx;
}
