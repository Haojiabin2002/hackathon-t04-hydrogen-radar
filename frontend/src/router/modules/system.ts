import { lazy } from 'react';
import { AlarmClock, Brain, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { RouteGroup } from '../types';

export const systemGroup: RouteGroup = {
  key: 'system',
  label: '系统运行',
  routes: [
    {
      path: '/settings/account',
      component: lazy(() => import('../../views/system/AccountPage')),
      meta: {
        title: '账户与访问',
        icon: ShieldCheck,
        description: '后端是一把共享口令，不是账号体系。这里如实显示口令是否启用、本标签页是否解锁、以及口令具体保护了哪些写操作。',
      },
    },
    {
      path: '/automation',
      component: lazy(() => import('../../views/system/AutomationPage')),
      meta: {
        title: '自动任务',
        icon: AlarmClock,
        description: '配置每天的采集小时，或立即发起一轮真实采集。当前接口没有阶段百分比，因此运行时只展示确定状态。',
      },
    },
    {
      path: '/settings/memory',
      component: lazy(() => import('../../views/system/MemoryPage')),
      meta: {
        title: '销售记忆',
        icon: Brain,
        description: '记录稳定的关注偏好，例如重点区域、优先产品与不应推荐的情形。每轮销售对话都会读取这些真实配置。',
      },
    },
    {
      path: '/settings/preferences',
      component: lazy(() => import('../../views/system/PreferencesPage')),
      meta: {
        title: '销售偏好',
        icon: SlidersHorizontal,
        description: '结构化偏好，每轮注入 Agent 上下文，直接影响它的检索条件',
      },
    },
    {
      path: '/settings/models',
      component: lazy(() => import('../../views/system/ModelsPage')),
      meta: {
        title: '模型通道',
        icon: Settings2,
        description: '页面加载只扫描本机安装和配置，不会发模型请求。只有点击测试才会进行一次真实调用并检查 CLI 子进程隔离。',
      },
    },
  ],
};
