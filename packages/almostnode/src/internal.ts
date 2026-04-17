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
export {
  createAppBuildingMachine,
  DEFAULT_APP_BUILDING_IMAGE_REF,
  destroyFlyMachine,
  fetchAppBuildingEvents,
  fetchAppBuildingLogs,
  fetchAppBuildingStatus,
  DEFAULT_FLY_LOG_BUFFER_LIMIT,
  fetchFlyLogsPage,
  fetchFlyLogsSince,
  formatFlyLogEntry,
  getFlyMachine,
  infisicalLogin,
  listFlyVolumes,
  mergeFlyLogDelta,
  parseAddTaskLogMessage,
  pollFlyLogs,
  postAppBuildingMessage,
  postAppBuildingStop,
  setInfisicalGlobalSecret,
  waitForFlyMachineStarted,
  waitForWorkerReady,
} from './shims/app-building-remote';
export type {
  FlyLogsEntry,
  FlyLogsPage,
  ParsedAddTaskSubtask,
} from './shims/app-building-remote';
