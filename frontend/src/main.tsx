import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import './styles/index.css';
import { router } from './router';
import { queryClient } from './lib/query';
import { SettingsProvider } from './hooks/useSettings';

const root = document.getElementById('root');

if (!root) {
  throw new Error('应用挂载节点 #root 不存在');
}

createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SettingsProvider>
  </StrictMode>,
);
