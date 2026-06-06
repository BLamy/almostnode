/**
 * Minimal ambient type for `jsdom` so the orchestrator test can `import { JSDOM }`
 * without pulling in `@types/jsdom` (which isn't part of the project's
 * dev-dependency closure). Only the constructor + `.window` are used here.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window & typeof globalThis;
  }
}
