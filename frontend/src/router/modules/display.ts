import { lazy } from 'react';
import { BriefcaseBusiness, RadioTower, Stamp } from 'lucide-react';
import type { RouteGroup } from '../types';

/**
 * 展示层 · 「看 agent 产出了什么」的那一半界面
 *
 * 拍板只留三样：客户信息卡看板、信号证据、审批。
 * 原来的「当日研判」仪表盘（views/work/TodayPage.tsx）不再有入口——
 * 组件文件保留未删，需要时把这条记录加回来即可。
 */
export const displayGroup: RouteGroup = {
  key: 'display',
  label: '展示层',
  routes: [
    {
      path: '/opportunities',
      component: lazy(() => import('../../views/work/OpportunitiesPage')),
      meta: {
        title: '客户信息卡看板',
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
      path: '/approvals',
      component: lazy(() => import('../../views/display/ApprovalsPage')),
      meta: {
        title: '审批',
        icon: Stamp,
        description: '三种卡：新增信息源申请、拉黑确认、每周复盘建议。域名和网址单独醒目展示——批准一个源等于把它写进抓取名单；复盘建议看依据，批准只是标记已采纳，不会自动改任何文件。',
      },
    },
  ],
};
