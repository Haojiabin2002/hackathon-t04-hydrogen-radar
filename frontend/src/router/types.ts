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

/**
 * 侧栏里的二级折叠菜单（如「能力配置」下面的技能 / 记忆 / 自动任务）。
 *
 * 它**只是呈现上的收纳**：子项各自仍是一条独立的一级路由，路径不变、
 * meta 不变，页面标题也仍由自己的 meta 提供。这样收纳一个页面不需要
 * 改页面代码，也不会出现「三个页面共用一个标题」。
 */
export interface RouteSection {
  key: string;
  label: string;
  icon?: LucideIcon;
  routes: AppRouteRecord[];
  /**
   * 插在分组里哪个一级菜单项之后（填那一项的 path）。
   * 不填、或指向一个不在菜单里的 path，就排在该分组末尾。
   */
  after?: string;
}

/**
 * 侧栏分组。分组只影响呈现，不影响路由层级。
 *
 * 现在只有两组：控制层（操纵 agent 与它的配置）与展示层（看它产出的东西）。
 * `routes` 是直接挂在分组下的一级项，`sections` 是二级折叠菜单。
 */
export interface RouteGroup {
  key: string;
  label: string;
  routes: AppRouteRecord[];
  sections?: RouteSection[];
}
