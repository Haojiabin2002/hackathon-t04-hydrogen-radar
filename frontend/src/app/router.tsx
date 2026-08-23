import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './AppShell';
import TodayPage from '../pages/TodayPage';
import OpportunitiesPage from '../pages/OpportunitiesPage';
import OpportunityDetailPage from '../pages/OpportunityDetailPage';
import SignalsPage from '../pages/SignalsPage';
import SourcesPage from '../pages/SourcesPage';
import AssistantPage from '../pages/AssistantPage';
import KnowledgePage from '../pages/KnowledgePage';
import SkillsPage from '../pages/SkillsPage';
import SkillEditPage from '../pages/SkillEditPage';
import AutomationPage from '../pages/AutomationPage';
import MemoryPage from '../pages/MemoryPage';
import ModelsPage from '../pages/ModelsPage';

function RouteError() {
  return (
    <main className="route-error">
      <span className="route-error-code">404</span>
      <h1>这条路径不在雷达航线中</h1>
      <p>地址可能已经变化，或者对应对象已被归并。</p>
      <a className="btn btn-primary" href="/">返回今日工作台</a>
    </main>
  );
}

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <TodayPage /> },
        { path: 'opportunities', element: <OpportunitiesPage /> },
        { path: 'opportunities/:leadId', element: <OpportunityDetailPage /> },
        { path: 'signals', element: <SignalsPage /> },
        { path: 'sources', element: <SourcesPage /> },
        { path: 'assistant', element: <AssistantPage /> },
        { path: 'knowledge', element: <KnowledgePage /> },
        { path: 'skills', element: <SkillsPage /> },
        { path: 'skills/new', element: <SkillEditPage /> },
        { path: 'skills/:skillKey/edit', element: <SkillEditPage /> },
        { path: 'automation', element: <AutomationPage /> },
        { path: 'settings/memory', element: <MemoryPage /> },
        { path: 'settings/models', element: <ModelsPage /> },
        { path: 'today', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
