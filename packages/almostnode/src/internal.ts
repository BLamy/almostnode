/**
 * Internal exports for the web-ide app.
 * These are NOT part of the public API and may change without notice.
 */

export { createNodeError } from './virtual-fs';
export type { PlaywrightCommandListener, PlaywrightSelectorContext } from './shims/playwright-command';
export type { RequestMiddleware } from './server-bridge';
export type {
  OxcDiagnostic,
  OxcFileAccessor,
  ResolvedOxcConfig,
  RunOxcOnSourceOptions,
  RunOxcOnSourceResult,
} from './oxc/runtime';
export {
  formatOxcDiagnosticsForTerminal,
  isSupportedOxcPath,
  resolveOxcConfigForFile,
  resolveOxcParserExtension,
  runOxcOnSource,
} from './oxc/runtime';
