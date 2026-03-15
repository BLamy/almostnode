import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Auto-detect basepath when running inside almostnode's virtual server.
// The iframe URL may be /__virtual__/{port}/ (localhost) or /repo/__virtual__/{port}/ (GitHub Pages).
// TanStack Router needs everything up to and including the port as its basepath.
const basepath = typeof window !== 'undefined'
  && window.location.pathname.includes('/__virtual__/')
  ? (window.location.pathname.match(/^(.*\/__virtual__\/\d+)/)?.[1] || '')
  : '';

export function getRouter() {
  const router = createRouter({
    routeTree,
    basepath,
    defaultPreload: 'intent',
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
