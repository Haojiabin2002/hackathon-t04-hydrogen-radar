import { lazy } from 'react';
import { Blocks, BookOpenText, Globe2 } from 'lucide-react';
import type { RouteGroup } from '../types';

export const intelligenceGroup: RouteGroup = {
  key: 'intelligence',
  label: '情报配置',
  routes: [
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
      path: '/knowledge',
      component: lazy(() => import('../../views/intelligence/KnowledgePage')),
      meta: {
        title: '研判知识库',
        icon: BookOpenText,
        description: '这里定义行业分类、评分权重与产品判断规则。保存前由后端解析校验，不合法的内容不会覆盖现有知识。',
      },
    },
    {
      path: '/skills',
      component: lazy(() => import('../../views/intelligence/SkillsPage')),
      meta: {
        title: '能力技能',
        icon: Blocks,
        description: '内置能力由代码实现、不可编辑；自定义技能只是一段基于单条线索运行的受约束提示词，不具备写数据库或调用工具的权限。',
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
};
