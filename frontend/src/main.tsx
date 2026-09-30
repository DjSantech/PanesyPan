// (sin cambios de comportamiento; solo para forzar un nuevo despliegue)
import '@fontsource-variable/nunito-sans';
import '@fontsource-variable/playfair-display';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { RootErrorBoundary } from './components/RouteErrorBoundary';
import { Toaster } from 'sonner';
import { router } from './app/router';
import { queryClient } from './lib/query-client';
import { setupServiceWorker } from './lib/register-sw';
import { initTheme } from './lib/theme';

initTheme();
setupServiceWorker();

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('No se encontró el elemento #root');
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="top-center" richColors closeButton />
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
