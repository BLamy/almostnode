import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let configured = false;

export function setupMonaco(): typeof monaco {
  if (configured) return monaco;
  configured = true;
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
    {
      getWorker(_workerId, label) {
        if (label === "json") return new JsonWorker();
        if (label === "css" || label === "scss" || label === "less")
          return new CssWorker();
        if (label === "html" || label === "handlebars" || label === "razor")
          return new HtmlWorker();
        if (label === "typescript" || label === "javascript")
          return new TsWorker();
        return new EditorWorker();
      },
    };
  return monaco;
}

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    md: "markdown",
    markdown: "markdown",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
  };
  return map[ext] ?? "plaintext";
}
