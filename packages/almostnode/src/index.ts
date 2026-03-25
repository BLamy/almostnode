/**
 * Mini WebContainers MVP - Main Entry Point
 *
 * Provides a browser-based Node.js-like environment
 * with virtual file system and CommonJS module support
 */

export { VirtualFS } from "./virtual-fs";
export type {
  FSNode,
  Stats,
  FSWatcher,
  WatchListener,
  WatchEventType,
} from "./virtual-fs";
export { Runtime, execute } from "./runtime";
export type { Module, RuntimeOptions, RequireFunction } from "./runtime";
export { createRuntime, WorkerRuntime, SandboxRuntime } from "./create-runtime";
export type {
  IRuntime,
  IExecuteResult,
  CreateRuntimeOptions,
  IRuntimeOptions,
  VFSSnapshot,
} from "./runtime-interface";
export {
  generateSandboxFiles,
  getSandboxHtml,
  getSandboxVercelConfig,
  SANDBOX_SETUP_INSTRUCTIONS,
} from "./sandbox-helpers";
export { createFsShim } from "./shims/fs";
export type { FsShim } from "./shims/fs";
export { createProcess } from "./shims/process";
export type { Process, ProcessEnv } from "./shims/process";
export type {
  ShellCommandContext,
  ShellCommandDefinition,
  ShellCommandExecOptions,
  ShellCommandResult,
} from "./shell-commands";
export * as path from "./shims/path";
export * as http from "./shims/http";
export * as net from "./shims/net";
export * as events from "./shims/events";
export * as stream from "./shims/stream";
export * as url from "./shims/url";
export * as querystring from "./shims/querystring";
export * as util from "./shims/util";
export * as npm from "./npm";
export { PackageManager, install } from "./npm";
export type { InstallMode } from "./npm";
export {
  ServerBridge,
  getServerBridge,
  resetServerBridge,
} from "./server-bridge";
export type { InitServiceWorkerOptions } from "./server-bridge";
// Dev servers
export { DevServer } from "./dev-server";
export type { DevServerOptions, ResponseData, HMRUpdate } from "./dev-server";
export { ViteDevServer } from "./frameworks/vite-dev-server";
export type { ViteDevServerOptions } from "./frameworks/vite-dev-server";
export { NextDevServer } from "./frameworks/next-dev-server";
export type { NextDevServerOptions } from "./frameworks/next-dev-server";
// New shims for Vite support
export * as chokidar from "./shims/chokidar";
export * as ws from "./shims/ws";
export * as fsevents from "./shims/fsevents";
export * as readdirp from "./shims/readdirp";
export * as module from "./shims/module";
export * as perf_hooks from "./shims/perf_hooks";
export * as worker_threads from "./shims/worker_threads";
export * as esbuild from "./shims/esbuild";
export * as rollup from "./shims/rollup";
export * as assert from "./shims/assert";

// Demo exports
export {
  createConvexAppProject,
  initConvexAppDemo,
  startConvexAppDevServer,
  PACKAGE_JSON as CONVEX_APP_PACKAGE_JSON,
  DEMO_PACKAGES as CONVEX_APP_DEMO_PACKAGES,
} from "../examples/convex-app-demo";
export { createContainer, default } from "./container";
export type {
  ContainerInstance,
  ContainerOptions,
  GitAuthOptions,
  MutableGitAuth,
  RunOptions,
  RunResult,
  TerminalSession,
  TerminalSessionOptions,
  TerminalSessionRunOptions,
  TerminalSessionState,
  WorkspaceSearchFileResult,
  WorkspaceSearchMatch,
  WorkspaceSearchOptions,
  WorkspaceSearchProvider,
  WorkspaceSearchResult,
} from "./container";
