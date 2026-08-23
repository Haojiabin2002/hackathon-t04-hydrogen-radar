import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 路由记录 · 菜单的唯一真源
 *
 * 规矩：侧栏、面包屑、多标签页全部从这里派生，**不许再维护第二份菜单数组**。
 * 加一个页面 = 在 router/modules/ 下加一条记录，三处会一起出现。
 */
export interface RouteMeta {
  /** 菜单项与标签页显示的名字 */
  title: string;
  /** 侧栏图标 */
  icon?: LucideIcon;
  /** 页头下方的一句话说明 */
  description?: string;
  /** 不进侧栏菜单：详情页、编辑页这类由列表进入的页面 */
  hideInMenu?: boolean;
  /** 不进多标签页 */
  hideInWorktab?: boolean;
  /** 隐藏页在侧栏里要高亮哪个父菜单 */
  activePath?: string;
}

export interface AppRouteRecord {
  /** 相对 basename 的绝对路径，以 / 开头 */
  path: string;
  component: LazyExoticComponent<ComponentType> | ComponentType;
  meta: RouteMeta;
}

/** 侧栏分组。分组只影响呈现，不影响路由层级。 */
export interface RouteGroup {
  key: string;
  label: string;
  routes: AppRouteRecord[];
}
