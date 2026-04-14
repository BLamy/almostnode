declare module "virtual:workbench-entrypoints" {
  import type { WorkbenchEntrypoint } from "./workbench/framework/types";

  const entrypoints: WorkbenchEntrypoint[];
  export default entrypoints;
}
