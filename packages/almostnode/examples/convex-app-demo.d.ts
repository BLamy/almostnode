/**
 * Next.js + Convex Todo App Demo
 *
 * A simple todo list app using Next.js App Router and Convex for real-time data sync,
 * running entirely in the browser.
 */
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';
import { NextDevServer } from '../src/frameworks/next-dev-server';
/**
 * Package.json for a realistic Next.js + Convex app
 */
declare const PACKAGE_JSON: {
    name: string;
    version: string;
    private: boolean;
    scripts: {
        dev: string;
        build: string;
        start: string;
    };
    dependencies: {
        next: string;
        react: string;
        "react-dom": string;
    };
    devDependencies: {
        "@types/node": string;
        "@types/react": string;
        "@types/react-dom": string;
        typescript: string;
    };
};
/**
 * Minimal packages to install for demo (others loaded from CDN)
 */
declare const DEMO_PACKAGES: string[];
/**
 * Create the project structure in the virtual filesystem
 */
export declare function createConvexAppProject(vfs: VirtualFS): void;
/**
 * Initialize the Convex App demo
 */
export declare function initConvexAppDemo(outputElement: HTMLElement, options?: {
    installPackages?: boolean;
}): Promise<{
    vfs: VirtualFS;
    runtime: Runtime;
}>;
/**
 * Start the dev server for Convex App demo
 */
export declare function startConvexAppDevServer(vfs: VirtualFS, options?: {
    port?: number;
    log?: (message: string) => void;
}): Promise<{
    server: NextDevServer;
    url: string;
    stop: () => void;
}>;
export { PACKAGE_JSON, DEMO_PACKAGES };
//# sourceMappingURL=convex-app-demo.d.ts.map