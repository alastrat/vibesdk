import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { initSentry } from './utils/sentry';
import { I18nProvider } from './lib/i18n';
import { localizeRoutes } from './lib/i18n/localize-routes';

import { routes } from './routes.tsx';
import './index.css';

// Initialize Sentry before rendering
initSentry();

// Type for React Router hydration data  
import type { RouterState } from 'react-router';

declare global {
  interface Window {
    __staticRouterHydrationData?: Partial<Pick<RouterState, 'loaderData' | 'actionData' | 'errors'>>;
  }
}

const router = createBrowserRouter(localizeRoutes(routes), {
	hydrationData: window.__staticRouterHydrationData,
});

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <RouterProvider router={router} />
  </I18nProvider>
);
