export * from "../../../../vendor/opentui/packages/core/src/browser-core.ts";

export enum CliRenderEvents {
  RESIZE = "resize",
  FOCUS = "focus",
  BLUR = "blur",
  THEME_MODE = "theme_mode",
  CAPABILITIES = "capabilities",
  SELECTION = "selection",
  DEBUG_OVERLAY_TOGGLE = "debugOverlay:toggle",
  DESTROY = "destroy",
  MEMORY_SNAPSHOT = "memory:snapshot",
}
