// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("web-ide vite config", () => {
  it("keeps the OpenCode browser tree-sitter and opentui shims wired for dev", { timeout: 15000 }, async () => {
    const originalVitest = process.env.VITEST;
    delete process.env.VITEST;
    const configUrl = new URL(`../vite.config.ts?test=${Date.now()}`, import.meta.url).href;
    const imported = await import(/* @vite-ignore */ configUrl);
    if (originalVitest === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitest;
    }
    const configFactory = imported.default;
    const config =
      typeof configFactory === "function"
        ? await configFactory({
            command: "serve",
            isPreview: false,
            isSsrBuild: false,
            mode: "test",
          })
        : configFactory;

    const aliases = Array.isArray(config.resolve?.alias) ? config.resolve.alias : [];
    const excluded = Array.isArray(config.optimizeDeps?.exclude) ? config.optimizeDeps.exclude : [];
    const stubPlugin = config.plugins?.find(
      (plugin) =>
        plugin
        && typeof plugin === "object"
        && "name" in plugin
        && plugin.name === "stub-module-prefixes",
    );
    const stripPolyfillPlugin = config.plugins?.find(
      (plugin) =>
        plugin
        && typeof plugin === "object"
        && "name" in plugin
        && plugin.name === "strip-node-polyfill-self-inject",
    );

    expect(config.optimizeDeps?.noDiscovery).toBe(true);

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find instanceof RegExp
          && entry.find.test("almostnode")
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("packages/almostnode/src/browser.ts"),
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "commonjs-node-modules-interop",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-module-import",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-opencode-ripgrep-imports",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-opencode-browser-imports",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-opencode-cors-proxy-imports",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-opencode-bash-tree-sitter-runtime",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-opencode-bash-tree-sitter-wasm",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "redirect-resolved-node-module-paths",
      ),
    ).toBe(true);

    expect(
      config.plugins?.some(
        (plugin) =>
          plugin
          && typeof plugin === "object"
          && "name" in plugin
          && plugin.name === "patch-opencode-bash-tool",
      ),
    ).toBe(true);

    expect(stubPlugin && typeof stubPlugin === "object" && "resolveId" in stubPlugin).toBe(true);
    expect(
      typeof stubPlugin?.resolveId === "function"
        ? stubPlugin.resolveId("@ai-sdk/openai")
        : null,
    ).toBeNull();
    expect(
      typeof stubPlugin?.resolveId === "function"
        ? stubPlugin.resolveId("@aws-sdk/credential-providers")
        : null,
    ).toEqual(expect.any(String));
    expect(
      typeof stubPlugin?.resolveId === "function"
        ? stubPlugin.resolveId("gray-matter")
        : null,
    ).toBeNull();

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find instanceof RegExp
          && entry.find.test("almostnode/internal")
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("packages/almostnode/src/internal.ts"),
      ),
    ).toBe(true);

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find === "events"
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("packages/almostnode/src/shims/events.ts"),
      ),
    ).toBe(true);

    const eventsShimPath = aliases.find(
      (entry) =>
        typeof entry === "object"
        && "find" in entry
        && entry.find === "events"
        && typeof entry.replacement === "string",
    )?.replacement;

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find === "@opentui/core/testing"
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("src/shims/opentui-testing.ts"),
      ),
    ).toBe(true);

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find === "gray-matter"
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("apps/web-ide/src/shims/gray-matter.browser.ts"),
      ),
    ).toBe(true);

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find instanceof RegExp
          && entry.find.test("web-tree-sitter")
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("shims/web-tree-sitter.browser.ts"),
      ),
    ).toBe(false);

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find === "tree-sitter-bash/tree-sitter-bash.wasm"
          && typeof entry.replacement === "string"
          && entry.replacement.endsWith("shims/wasm-asset.browser.ts"),
      ),
    ).toBe(false);

    expect(excluded).toEqual(
      expect.arrayContaining([
        "web-tree-sitter",
        "tree-sitter-bash",
        "@codingame/monaco-vscode-log-service-override",
        "opentui-spinner",
        "opentui-spinner/solid",
      ]),
    );

    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object"
          && "find" in entry
          && entry.find === "process",
      ),
    ).toBe(false);

    expect(
      stripPolyfillPlugin && typeof stripPolyfillPlugin === "object" && "transform" in stripPolyfillPlugin,
    ).toBe(true);

    const polyfillPrelude = [
      'import __buffer_polyfill from "/buffer"',
      'globalThis.Buffer = globalThis.Buffer || __buffer_polyfill',
      'import __global_polyfill from "/global"',
      'globalThis.global = globalThis.global || __global_polyfill',
      'import __process_polyfill from "/process"',
      'globalThis.process = globalThis.process || __process_polyfill',
      '',
      'export class EventEmitter {}',
    ].join("\n");

    const strippedEvents = typeof stripPolyfillPlugin?.transform === "function"
      && typeof eventsShimPath === "string"
      ? stripPolyfillPlugin.transform(
          polyfillPrelude,
          eventsShimPath,
        )
      : null;

    expect(strippedEvents).toEqual({
      code: "export class EventEmitter {}",
      map: null,
    });
  });
});
