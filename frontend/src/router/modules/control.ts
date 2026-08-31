import { lazy } from 'react';
import {
  AlarmClock, Blocks, BookOpenText, Brain, Globe2, KeyRound,
  MessagesSquare, ShieldCheck, SlidersHorizontal, Sparkles, Wrench,
} from 'lucide-react';
import type { RouteGroup } from '../types';

/**
 * 控制层 · 「操纵 agent 与它的配置」的那一半界面
 *
 * 首页就是对话：agent 的一切工作都从这里发起（普通目标 / 调查任务），
 * 提案也在这里当场裁决。其余四项是它工作时读到的东西——知识库、数据源、
 * 能力（技能 / 记忆 / 自动任务 / 偏好）、模型密钥。
 *
 * 加页面请加在这里，侧栏、多标签、面包屑会自动跟上；不要在别处写第二份菜单。
 */
export const controlGroup: RouteGroup = {
  key: 'control',
  label: '控制层',
  routes: [
    {
      path: '/',
      component: lazy(() => import('../../views/work/AssistantPage')),
      meta: {
        title: '对话',
        icon: MessagesSquare,
        description: '给一个目标，agent 自己决定调哪些工具、何时收敛；需要出门查证时切到调查任务。涉及外部动作的一律只提议，由你确认。',
      },
    },
    {
      path: '/knowledge',
      component: lazy(() => import('../../views/intelligence/KnowledgePage')),
      meta: {
        title: '知识库',
        icon: BookOpenText,
        description: '一份契约主文件 knowledge.md 定义行业分类、评分权重与产品判断规则；其余是附加知识文档，不进提示词，由 agent 按需取用。',
      },
    },
    {
      // 契约主文件的编辑页。菜单里不单列——从知识库列表页的主文件卡片进。
      path: '/knowledge/main',
      component: lazy(() => import('../../views/intelligence/KnowledgeMainPage')),
      meta: {
        title: '主知识库',
        icon: BookOpenText,
        description: '正文里的产品谱系、区域优先级、商机判定规则、评分口径四节被打分链路直接消费。保存前由后端解析校验，不合法的内容不会覆盖现有知识。',
        hideInMenu: true,
        activePath: '/knowledge',
      },
    },
    {
      path: '/knowledge/files/new',
      component: lazy(() => import('../../views/intelligence/KnowledgeDocEditPage')),
      meta: {
        title: '新建知识文档',
        description: '附加知识文档存在 radar/knowledge/ 目录，不参与管线提示词装配，agent 用 read_knowledge 按需取用。',
        hideInMenu: true,
        activePath: '/knowledge',
      },
    },
    {
      path: '/knowledge/files/:docName/edit',
      component: lazy(() => import('../../views/intelligence/KnowledgeDocEditPage')),
      meta: {
        title: '编辑知识文档',
        description: '附加知识文档存在 radar/knowledge/ 目录，不参与管线提示词装配，agent 用 read_knowledge 按需取用。',
        hideInMenu: true,
        activePath: '/knowledge',
      },
    },
    {
      path: '/sources',
      component: lazy(() => import('../../views/intelligence/SourcesPage')),
      meta: {
        title: '数据源',
        icon: Globe2,
        description: '每个站点先经过真实抓取探测，确认列表页、文章正文与来源归属后才能加入雷达。',
      },
    },
    {
      path: '/settings/models',
      component: lazy(() => import('../../views/system/ModelsPage')),
      meta: {
        title: '密钥配置',
        icon: KeyRound,
        description: '页面加载只扫描本机安装和配置，不会发模型请求；密钥只显示掩码，明文永不回显。只有点击测试才会进行一次真实调用并检查 CLI 子进程隔离。',
      },
    },
    {
      // 共享口令的解锁状态页。菜单里不再单列（拍板：控制层只留五项），
      // 但 401 解锁浮层和密钥页都会指过来，所以路由保留。
      path: '/settings/account',
      component: lazy(() => import('../../views/system/AccountPage')),
      meta: {
        title: '账户与访问',
        icon: ShieldCheck,
        description: '后端是一把共享口令，不是账号体系。这里如实显示口令是否启用、本标签页是否解锁、以及口令具体保护了哪些写操作。',
        hideInMenu: true,
        activePath: '/settings/models',
      },
    },
  ],
  sections: [
    {
      key: 'capability',
      label: '能力配置',
      icon: Blocks,
      // 菜单顺序：对话 → 知识库 → 数据源 → 能力配置 → 密钥配置
      after: '/sources',
      routes: [
        {
          path: '/skills',
          component: lazy(() => import('../../views/intelligence/SkillsPage')),
          meta: {
            title: '技能面板',
            icon: Sparkles,
            description: '内置能力由代码实现、不可编辑；自定义技能只是一段基于单条线索运行的受约束提示词，不具备写数据库或调用工具的权限。',
          },
        },
        {
          path: '/settings/tools',
          component: lazy(() => import('../../views/system/ToolsPage')),
          meta: {
            title: '工具面板',
            icon: Wrench,
            description: 'agent 能调的全部工具按副作用分组列出，启停与确认要求由你定。自定义工具是本机执行的 Python 代码，一律需要人工确认、新上传默认停用；模型无权创建或修改工具。',
          },
        },
        {
          path: '/settings/memory',
          component: lazy(() => import('../../views/system/MemoryPage')),
          meta: {
            title: '记忆面板',
            icon: Brain,
            description: '记录稳定的关注偏好，例如重点区域、优先产品与不应推荐的情形。每轮销售对话都会读取这些真实配置。',
          },
        },
        {
          path: '/automation',
          component: lazy(() => import('../../views/system/AutomationPage')),
          meta: {
            title: '自动任务',
            icon: AlarmClock,
            description: '配置每天的采集小时与每周复盘的档期，或立即发起一轮。当前接口没有阶段百分比，因此运行时只展示确定状态；周复盘会真实消耗模型额度。',
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
          path: '/skills/new',
          component: lazy(() => import('../../views/intelligence/SkillEditPage')),
          meta: {
            title: '新建技能',
            description: '技能只读取一条线索的受限字段并输出分析文本。保存时后端会校验 frontmatter、作用域和占位符。',
            hideInMenu: true,
            activePath: '/skills',
          },
        },
        {
          path: '/skills/:skillKey/edit',
          component: lazy(() => import('../../views/intelligence/SkillEditPage')),
          meta: {
            title: '编辑技能',
            description: '技能只读取一条线索的受限字段并输出分析文本。保存时后端会校验 frontmatter、作用域和占位符。',
            hideInMenu: true,
            activePath: '/skills',
          },
        },
      ],
    },
  ],
};
