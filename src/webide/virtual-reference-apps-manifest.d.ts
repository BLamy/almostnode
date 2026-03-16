declare module "virtual:reference-apps-manifest" {
  import type { ReferenceAppEntry } from "./vite-plugin-reference-apps";

  const apps: ReferenceAppEntry[];
  export default apps;
}
