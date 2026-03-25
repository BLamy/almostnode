import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

const basepath = import.meta.env.BASE_URL === '/'
  ? ''
  : import.meta.env.BASE_URL.replace(/\/$/, '');

export function getRouter() {
  const router = createRouter({
    routeTree,
    basepath,
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
