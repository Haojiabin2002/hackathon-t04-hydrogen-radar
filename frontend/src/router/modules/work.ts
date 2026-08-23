import { lazy } from 'react';
import { BriefcaseBusiness, Radar, RadioTower, Sparkles } from 'lucide-react';
import type { RouteGroup } from '../types';

export const workGroup: RouteGroup = {
  key: 'work',
  label: '销售工作',
  routes: [
    {
      path: '/',
      component: lazy(() => import('../../views/work/TodayPage')),
      meta: {
        title: '当日研判',
        icon: Radar,
        description: '按链路健康 → 选信号 → 核判断与证据的顺序推进当天工作',
        hideInWorktab: false,
      },
    },
    {
      path: '/opportunities',
      component: lazy(() => import('../../views/work/OpportunitiesPage')),
      meta: {
        title: '商机队列',
        icon: BriefcaseBusiness,
        description: '按评分、区域与作战卡状态筛选真实线索',
      },
    },
    {
      path: '/opportunities/:leadId',
      component: lazy(() => import('../../views/work/OpportunityDetailPage')),
      meta: {
        title: '商机详情',
        description: '字段证据、评分解释、产品匹配与公告原文集中在同一条可追溯链路中。',
        hideInMenu: true,
        activePath: '/opportunities',
      },
    },
    {
      path: '/signals',
      component: lazy(() => import('../../views/work/SignalsPage')),
      meta: {
        title: '信号证据',
        icon: RadioTower,
        description: '抓取入库的公开公告，标题始终链接原始来源',
      },
    },
    {
      path: '/assistant',
      component: lazy(() => import('../../views/work/AssistantPage')),
      meta: {
        title: '研判助手',
        icon: Sparkles,
        description: 'Agent 自己决定调哪些工具、何时收敛，每一步都可复盘；涉及外部动作的工具只会提议，由你确认。',
      },
    },
  ],
};
