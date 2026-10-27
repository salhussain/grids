import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Layout } from './Layout';
import { ContactPage } from './pages/Contact';
import { HomePage } from './pages/Home';
import { PricingPage } from './pages/Pricing';
import { ProductPage } from './pages/Product';

const rootRoute = createRootRoute({ component: Layout });
const page = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  page('/', HomePage),
  page('/product', ProductPage),
  page('/pricing', PricingPage),
  page('/contact', ContactPage),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
