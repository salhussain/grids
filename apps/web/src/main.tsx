import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, AutoRefreshProvider, ToastProvider } from '@grids/ui';
import { router } from './router';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AutoRefreshProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>
  </StrictMode>,
);
