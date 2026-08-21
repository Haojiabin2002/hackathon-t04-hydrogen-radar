import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import '@fontsource-variable/ibm-plex-sans';
import './styles.css';
import { router } from './app/router';
import { queryClient } from './lib/query';

const root = document.getElementById('root');

if (!root) {
  throw new Error('应用挂载节点 #root 不存在');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
