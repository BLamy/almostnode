import type { ReturnTypeOfCreateContainer } from "./workbench-host";

export const WORKSPACE_ROOT = "/project";
export const DEFAULT_FILE = `${WORKSPACE_ROOT}/src/App.tsx`;
export const DEFAULT_RUN_COMMAND = "npm run dev";

const DIRECTORIES = [
  `${WORKSPACE_ROOT}/.vscode`,
  `${WORKSPACE_ROOT}/src`,
  `${WORKSPACE_ROOT}/src/components`,
  `${WORKSPACE_ROOT}/src/components/ui`,
  `${WORKSPACE_ROOT}/src/hooks`,
  `${WORKSPACE_ROOT}/src/lib`,
];

const FILES: Record<string, string> = {
  [`${WORKSPACE_ROOT}/package.json`]: JSON.stringify(
    {
      name: "almostnode-webide-tailwind-starter",
      private: true,
      version: "0.0.1",
      type: "module",
      scripts: {
        dev: "vite --port 3000",
        build: "vite build",
        preview: "vite preview",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
      devDependencies: {
        "@types/react": "^18.2.0",
        "@types/react-dom": "^18.2.0",
        typescript: "^5.9.3",
        vite: "^5.4.0",
      },
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/tsconfig.json`]: JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["DOM", "DOM.Iterable", "ES2022"],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
      },
      include: ["src"],
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/index.html`]: `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>almostnode tailwind starter</title>
    <script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.2.0?dev",
    "react/": "https://esm.sh/react@18.2.0&dev/",
    "react-dom": "https://esm.sh/react-dom@18.2.0?dev",
    "react-dom/": "https://esm.sh/react-dom@18.2.0&dev/",
    "@/": "./src/"
  }
}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`,
  [`${WORKSPACE_ROOT}/.vscode/settings.json`]: JSON.stringify(
    {
      "workbench.colorTheme": "Islands Dark",
      "editor.minimap.enabled": false,
      "files.autoSave": "onFocusChange",
      "search.exclude": {
        "**/.git": true,
      },
      "claudeCode.useTerminal": false,
      "claudeCode.preferredLocation": "sidebar",
      "claudeCode.claudeProcessWrapper": "/usr/local/bin/claude-wrapper",
      "terminal.integrated.profiles.osx": {
        "zsh (login)": {
          "path": "zsh",
        },
      },
      "terminal.integrated.fontFamily": "SauceCodePro Nerd Font Mono",
      "terminal.integrated.cursorStyle": "underline",
      "terminal.integrated.cursorBlinking": true,
      "git.ignoreMissingGitWarning": true,
      "editor.wordWrap": "wordWrapColumn",
      "editor.fontFamily": "IBM Plex Mono",
      "editor.fontLigatures": true,
      "editor.fontSize": 14,
      "editor.matchBrackets": "never",
      "terminal.integrated.fontSize": 14,
      "git.autofetch": true,
      "breadcrumbs.enabled": true,
      "javascript.updateImportsOnFileMove.enabled": "always",
      "javascript.validate.enable": false,
      "eslint.validate": [
        "javascript",
        "javascriptreact",
        "typescript",
        "typescriptreact",
      ],
      "typescript.reportStyleChecksAsWarnings": false,
      "editor.fontWeight": "500",
      "typescript.inlayHints.parameterNames.enabled": "literals",
      "typescript.inlayHints.parameterTypes.enabled": true,
      "javascript.inlayHints.parameterNames.enabled": "literals",
      "editor.formatOnSave": true,
      "editor.codeActionsOnSave": {
        "source.fixAll.eslint": "explicit",
      },
      "editor.renderWhitespace": "all",
      "editor.suggest.preview": true,
      "editor.bracketPairColorization.enabled": true,
      "editor.guides.bracketPairs": true,
      "editor.smoothScrolling": true,
      "editor.cursorSmoothCaretAnimation": "on",
      "editor.cursorBlinking": "phase",
      "editor.tabSize": 2,
      "editor.detectIndentation": false,
      "emmet.excludeLanguages": [
        "[typescriptreact]",
        "markdown",
      ],
      "workbench.colorCustomizations": {
        "[Islands Dark]": {
          "input.background": "#191a1c",
          "panel.background": "#191a1c",
          "editorWidget.background": "#191a1c",
          "statusBar.border": "#121216",
        },
        "[Islands Light]": {
          "input.background": "#ffffff",
          "panel.background": "#ffffff",
          "editorWidget.background": "#ffffff",
          "statusBar.border": "#e8e9eb",
        },
      },
      "editor.wordWrapColumn": 100,
      "material-icon-theme.folders.color": "#42a5f5",
      "explorer.sortOrder": "type",
      "autoimport.doubleQuotes": false,
      "typescript.format.insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces": false,
      "typescript.preferences.quoteStyle": "single",
      "explorer.confirmDelete": false,
      "terminal.integrated.gpuAcceleration": "on",
      "javascript.preferences.quoteStyle": "single",
      "workbench.editor.wrapTabs": true,
      "search.mode": "reuseEditor",
      "search.searchEditor.doubleClickBehaviour": "openLocationToSide",
      "files.defaultLanguage": "${activeEditorLanguage}",
      "workbench.editor.pinnedTabSizing": "shrink",
      "workbench.editor.tabSizing": "shrink",
      "editor.suggest.insertMode": "replace",
      "editor.suggest.showStatusBar": true,
      "autoimport.spaceBetweenBraces": false,
      "editor.suggestSelection": "first",
      "json.maxItemsComputed": 6000,
      "files.autoSaveDelay": 2,
      "eslint.quiet": false,
      "editor.hover.delay": 500,
      "editor.inlineSuggest.enabled": true,
      "typescript.disableAutomaticTypeAcquisition": true,
      "json.schemas": [],
      "terminal.integrated.env.osx": {
        "FIG_NEW_SESSION": "1",
        "Q_NEW_SESSION": "1",
      },
      "vim.insertModeKeyBindings": [
        {
          "before": ["j", "k"],
          "after": ["<Esc>"],
        },
      ],
      "editor.accessibilitySupport": "off",
      "editor.hover.enabled": "on",
      "window.commandCenter": true,
      "editor.largeFileOptimizations": false,
      "editor.foldingMaximumRegions": 6000,
      "custom-ui-style.font.monospace": "IBM Plex Mono",
      "editor.lineHeight": 1.8,
      "explorer.compactFolders": false,
      "workbench.tree.indent": 16,
      "workbench.tree.renderIndentGuides": "onHover",
      "editor.minimap.showSlider": "always",
      "gitlens.ai.model": "vscode",
      "gitlens.ai.vscode.model": "copilot:gpt-4.1",
      "custom-ui-style.stylesheet": {
        ".chat-input-container": {
          "background-color": "#191a1c !important",
        },
        ".chat-input-container .monaco-inputbox": {
          "background-color": "#191a1c !important",
        },
        ".monaco-workbench": {
          "background-color": "#121216 !important",
        },
        ".part.sidebar": {
          "font-family": "'Bear Sans UI', sans-serif !important",
          "margin": "8px 8px 4px 24px",
          "border-radius": "18px 8px 8px 18px !important",
          "overflow": "hidden !important",
          "border-top": "1px solid rgba(255,255,255,0.1) !important",
          "border-left": "1px solid rgba(255,255,255,0.06) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.02) !important",
          "border-right": "1px solid rgba(255,255,255,0.02) !important",
          "box-shadow": "0 2px 8px 0 rgba(0,0,0,0.3) !important",
        },
        ".part.sidebar .composite.title": {
          "display": "none !important",
        },
        ".part.sidebar .content": {
          "width": "100% !important",
          "padding": "0 !important",
          "margin": "0 !important",
        },
        ".part.sidebar .welcome-view-content": {
          "max-width": "100% !important",
          "box-sizing": "border-box !important",
        },
        ".part.sidebar .pane-header": {
          "display": "none !important",
        },
        ".explorer-viewlet .split-view-container": {
          "transform": "translateY(-22px) !important",
        },
        ".part.sidebar .header": {
          "padding-right": "20px !important",
        },
        ".part.sidebar .label-name": {
          "font-size": "13px !important",
        },
        ".part.sidebar .pane-header .title": {
          "font-size": "10px !important",
        },
        ".explorer-folders-view .monaco-list-rows": {
          "transform": "translate3d(0px, 0px, 0px) scaleY(1.15) !important",
          "transform-origin": "top left !important",
        },
        ".explorer-folders-view .monaco-tl-row": {
          "transform": "scaleY(0.87) !important",
          "transform-origin": "top left !important",
        },
        ".part.sidebar .monaco-list-row": {
          "border-radius": "6px !important",
          "margin-left": "4px !important",
          "margin-right": "4px !important",
          "width": "calc(100% - 8px) !important",
          "transition": "background 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important",
        },
        ".part.sidebar .monaco-list-row.selected, .part.sidebar .monaco-list-row.focused": {
          "background": "linear-gradient(135deg, rgba(49,50,56,0.6), rgba(37,38,44,0.4)) !important",
          "box-shadow": "inset 0 0 0 1px rgba(255,255,255,0.05) !important",
          "outline": "none !important",
        },
        ".part.sidebar .monaco-list-row.focused.selected": {
          "background": "linear-gradient(135deg, rgba(49,50,56,0.7), rgba(37,38,44,0.5)) !important",
          "box-shadow": "inset 0 0 0 1px rgba(255,255,255,0.07) !important",
          "outline": "none !important",
        },
        ".part.sidebar .monaco-list:focus .monaco-list-row.selected": {
          "background": "linear-gradient(135deg, rgba(49,50,56,0.8), rgba(37,38,44,0.6)) !important",
          "box-shadow": "inset 0 0 0 1px rgba(255,255,255,0.08) !important",
          "outline": "none !important",
        },
        ".part.sidebar .monaco-list:focus .monaco-list-row.focused": {
          "background": "linear-gradient(135deg, rgba(49,50,56,0.8), rgba(37,38,44,0.6)) !important",
          "box-shadow": "inset 0 0 0 1px rgba(255,255,255,0.08) !important",
          "outline": "none !important",
        },
        ".part.sidebar .monaco-list-row:hover": {
          "background": "linear-gradient(135deg, rgba(49,50,56,0.3), rgba(37,38,44,0.2)) !important",
          "border-radius": "6px !important",
          "outline": "none !important",
        },
        ".part.editor": {
          "margin": "8px 0 4px 0",
          "border-radius": "8px !important",
          "overflow": "hidden !important",
          "max-height": "calc(100% - 12px) !important",
          "border-top": "1px solid rgba(255,255,255,0.12) !important",
          "border-left": "1px solid rgba(255,255,255,0.08) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.03) !important",
          "border-right": "1px solid rgba(255,255,255,0.03) !important",
          "box-shadow": "0 2px 8px 0 rgba(0,0,0,0.3) !important",
        },
        ".editor-actions": {
          "padding-right": "20px !important",
          "background-image": "linear-gradient(to top, #25262a 1px, transparent 1px) !important",
          "background-repeat": "no-repeat !important",
          "background-position": "bottom !important",
        },
        ".tabs-container": {
          "background-image": "linear-gradient(to top, #25262a 1px, transparent 1px) !important",
          "background-repeat": "no-repeat !important",
          "background-position": "bottom !important",
        },
        ".tab": {
          "margin": "0 !important",
          "border-right": "none !important",
          "border-radius": "0px 0px 0 0 !important",
          "font-family": "'Bear Sans UI', sans-serif !important",
        },
        ".tab .tab-actions .action-label": {
          "border-radius": "50% !important",
        },
        ".tab.active": {
          "box-shadow": "inset -1px 0 0 0 #25262a, inset 1px 0 0 0 #25262a !important",
          "border-right": "none !important",
        },
        ".tab:not(.active)": {
          "box-shadow": "inset 0 -1px 0 0 #25262a !important",
        },
        ".tab.active:first-child": {
          "box-shadow": "inset -1px 0 0 0 #25262a !important",
        },
        ".tab:hover .label-name": {
          "text-shadow": "0 0 5px rgba(255,255,255,0.15) !important",
          "transition": "text-shadow 0.3s ease !important",
        },
        ".minimap canvas": {
          "opacity": "0.6 !important",
          "transition": "opacity 0.4s ease !important",
        },
        ".minimap:hover canvas": {
          "opacity": "1 !important",
        },
        ".monaco-hover": {
          "border-radius": "12px !important",
          "border": "1px solid rgba(255,255,255,0.08) !important",
          "box-shadow": "0 4px 16px 0 rgba(0,0,0,0.4) !important",
          "overflow": "hidden !important",
        },
        ".monaco-breadcrumbs": {
          "border-top": "none !important",
        },
        ".monaco-breadcrumbs *": {
          "opacity": "0 !important",
          "transition": "opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        },
        ".monaco-breadcrumbs:hover *": {
          "opacity": "1 !important",
        },
        ".split-view-view:has(.terminal-tabs-entry)": {
          "min-width": "220px !important",
        },
        ".split-view-view:has(.terminal-tabs-entry) .monaco-list-row": {
          "border-radius": "6px !important",
          "margin-right": "20px !important",
          "width": "calc(100% - 20px) !important",
        },
        ".viewpane-filter .monaco-inputbox": {
          "border-radius": "9999px !important",
        },
        ".search-widget .monaco-inputbox": {
          "border-radius": "9999px !important",
        },
        ".search-widget .replace-input .monaco-findInput": {
          "width": "228px !important",
          "height": "26px !important",
        },
        ".search-widget .search-container .monaco-findInput": {
          "width": "228px !important",
          "height": "26px !important",
        },
        ".results.show-file-icons": {
          "margin-bottom": "22px !important",
        },
        ".extensions-search-container": {
          "transform": "translateX(-6px) !important",
        },
        ".extensions-search-container .suggest-input-container": {
          "border-radius": "9999px !important",
          "overflow": "hidden !important",
          "font-size": "11px !important",
          "--editor-font-size": "11px !important",
        },
        ".extensions-search-container .suggest-input-placeholder": {
          "font-size": "11px !important",
        },
        ".scm-editor": {
          "border-radius": "9999px !important",
          "overflow": "hidden !important",
        },
        ".scm-input": {
          "border-radius": "9999px !important",
          "overflow": "hidden !important",
        },
        ".scm-input + .scm-editor-toolbar + .monaco-button": {
          "border-radius": "9999px !important",
        },
        ".part.sidebar .monaco-button": {
          "border-radius": "9999px !important",
        },
        ".part.panel.bottom": {
          "margin": "3px 1px 0px 1px",
          "border-radius": "10px",
          "border-top": "1px solid rgba(255,255,255,0.1) !important",
          "border-left": "1px solid rgba(255,255,255,0.06) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.02) !important",
          "border-right": "1px solid rgba(255,255,255,0.02) !important",
          "box-shadow": "0 2px 8px 0 rgba(0,0,0,0.3) !important",
        },
        ".part.panel.bottom .composite.title": {
          "display": "none !important",
        },
        ".part.panel.bottom .content": {
          "padding": "0 !important",
          "margin": "0 !important",
        },
        ".part.panel.bottom .pane-header": {
          "display": "none !important",
        },
        ".part.panel.bottom .message-box-container": {
          "border-radius": "10px !important",
          "margin": "4px !important",
          "width": "calc(100% - 34px) !important",
          "box-sizing": "border-box !important",
        },
        ".part.panel.bottom .welcome-view-content": {
          "border-radius": "10px !important",
          "margin": "4px !important",
          "width": "calc(100% - 34px) !important",
          "box-sizing": "border-box !important",
        },
        ".part.panel.bottom .monaco-table": {
          "border-radius": "10px !important",
          "width": "calc(100% - 14px) !important",
        },
        ".part.activitybar": {
          "background": "#121216 !important",
          "margin": "8px 20px 30px 12px",
          "width": "48px !important",
          "min-width": "48px !important",
        },
        ".part.activitybar .composite-bar": {
          "background": "#151518 !important",
          "border-radius": "9999px",
          "overflow": "visible !important",
          "padding": "8px 0",
          "display": "flex !important",
          "flex-direction": "column !important",
          "align-items": "center !important",
          "box-shadow": "inset 0 1px 0 0 rgba(255,255,255,0.1), inset 1px 0 0 0 rgba(255,255,255,0.05), inset 0 -1px 0 0 rgba(255,255,255,0.02), inset -1px 0 0 0 rgba(255,255,255,0.02), inset 0 1px 3px 0 rgba(255,255,255,0.04), 0 1px 4px 0 rgba(0,0,0,0.25) !important",
        },
        ".part.activitybar .content > div:last-child": {
          "transform": "translateY(-10px) !important",
        },
        ".part.activitybar .action-item .action-label": {
          "font-size": "18px !important",
          "width": "30px !important",
          "height": "30px !important",
          "line-height": "30px !important",
          "display": "flex !important",
          "align-items": "center !important",
          "justify-content": "center !important",
          "overflow": "visible !important",
        },
        ".part.activitybar .action-item .action-label .codicon": {
          "font-size": "18px !important",
        },
        ".part.activitybar .action-item .action-label img": {
          "max-width": "18px !important",
          "max-height": "18px !important",
        },
        ".part.activitybar .action-item .active-item-indicator": {
          "display": "none !important",
        },
        ".part.activitybar .action-item.checked .action-label": {
          "background": "linear-gradient(180deg, rgba(55,56,62,0.9), rgba(40,41,46,0.7)) !important",
          "border-radius": "50% !important",
          "width": "30px !important",
          "height": "30px !important",
          "box-shadow": "inset 0 1px 0 0 rgba(255,255,255,0.12), inset 1px 0 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 0 rgba(255,255,255,0.02), inset -1px 0 0 0 rgba(255,255,255,0.02), inset 0 1px 2px 0 rgba(255,255,255,0.05), 0 1px 3px 0 rgba(0,0,0,0.3) !important",
        },
        ".part.activitybar .actions-container": {
          "align-items": "center !important",
          "justify-content": "center !important",
          "width": "100% !important",
          "overflow": "visible !important",
        },
        ".part.activitybar .action-item": {
          "display": "flex !important",
          "justify-content": "center !important",
          "width": "100% !important",
          "overflow": "visible !important",
        },
        ".part.activitybar .badge": {
          "z-index": "10 !important",
          "overflow": "visible !important",
          "transform": "scale(0.8) !important",
          "transform-origin": "top right !important",
        },
        ".part.titlebar": {
          "height": "40px !important",
          "background-color": "#121216 !important",
        },
        ".part.statusbar": {
          "background-color": "#121216 !important",
          "font-family": "'Bear Sans UI', sans-serif !important",
        },
        "workbench.parts.statusbar": {
          "border-top": "0 !important",
        },
        ".part.statusbar .statusbar-item-label": {
          "transition": "color 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        },
        ".part.statusbar .codicon": {
          "transition": "color 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        },
        ".part.statusbar:hover .statusbar-item-label": {
          "color": "#9a9ea5 !important",
        },
        ".part.statusbar:hover .codicon": {
          "color": "#9a9ea5 !important",
        },
        ".part.statusbar .items-container": {
          "margin-top": "-2px !important",
        },
        ".monaco-icon-label.file-icon::before": {
          "filter": "drop-shadow(0 0 2.5px currentColor)",
          "opacity": "1 !important",
        },
        ".tab .monaco-icon-label.file-icon::before": {
          "filter": "drop-shadow(0 0 2.5px currentColor)",
          "opacity": "1 !important",
        },
        ".letterpress": {
          "opacity": "0.4 !important",
          "filter": "brightness(0) drop-shadow(2px 2px 1px rgba(255,255,255,0.12)) drop-shadow(-2px -2px 1px rgba(0,0,0,1)) !important",
        },
        ".part.titlebar .action-label": {
          "border-radius": "50% !important",
        },
        ".command-center-center": {
          "font-family": "'Bear Sans UI', sans-serif !important",
          "border-radius": "9999px !important",
          "height": "32px !important",
          "overflow": "hidden !important",
          "border": "none !important",
          "background": "#151518 !important",
          "box-shadow": "inset 0 1px 0 0 rgba(255,255,255,0.1), inset 1px 0 0 0 rgba(255,255,255,0.05), inset 0 -1px 0 0 rgba(255,255,255,0.02), inset -1px 0 0 0 rgba(255,255,255,0.02), inset 0 1px 3px 0 rgba(255,255,255,0.04), 0 1px 4px 0 rgba(0,0,0,0.25) !important",
        },
        ".command-center-center *": {
          "border-radius": "9999px !important",
        },
        ".notifications-toasts": {
          "margin-right": "8px !important",
          "margin-bottom": "8px !important",
        },
        ".notification-toast": {
          "border-radius": "14px !important",
          "overflow": "hidden !important",
          "border-top": "1px solid rgba(255,255,255,0.1) !important",
          "border-left": "1px solid rgba(255,255,255,0.06) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.02) !important",
          "border-right": "1px solid rgba(255,255,255,0.02) !important",
          "box-shadow": "0 4px 12px 0 rgba(0,0,0,0.4) !important",
        },
        ".notifications-center": {
          "border-radius": "14px !important",
          "overflow": "hidden !important",
          "border-top": "1px solid rgba(255,255,255,0.1) !important",
          "border-left": "1px solid rgba(255,255,255,0.06) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.02) !important",
          "border-right": "1px solid rgba(255,255,255,0.02) !important",
          "box-shadow": "0 4px 12px 0 rgba(0,0,0,0.4) !important",
        },
        ".notification-list-item-actions-container": {
          "border-radius": "8px !important",
        },
        ".notification-list-item": {
          "border-radius": "14px !important",
          "overflow": "hidden !important",
        },
        ".notification-list-item.focused": {
          "border-radius": "14px !important",
          "outline-offset": "-1px !important",
        },
        ".monaco-list-row:has(.notification-list-item)": {
          "border-radius": "14px !important",
          "overflow": "hidden !important",
        },
        ".part.auxiliarybar": {
          "margin": "8px 20px 0 8px",
          "border-radius": "10px 18px 18px 10px !important",
          "overflow": "hidden !important",
          "max-height": "calc(100% - 12px) !important",
          "border-top": "1px solid rgba(255,255,255,0.1) !important",
          "border-left": "1px solid rgba(255,255,255,0.06) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.02) !important",
          "border-right": "1px solid rgba(255,255,255,0.02) !important",
          "box-shadow": "0 2px 8px 0 rgba(0,0,0,0.3) !important",
        },
        ".part.auxiliarybar .composite.title": {
          "padding": "8px 0 0 20px !important",
        },
        ".part.auxiliarybar .content": {
          "width": "calc(100% - 20px) !important",
        },
        ".part.auxiliarybar .split-view-view": {
          "max-height": "calc(100% - 24px) !important",
        },
        ".part.auxiliarybar .header": {
          "padding-left": "20px !important",
        },
        ".quick-input-widget": {
          "border-radius": "16px !important",
          "overflow": "hidden !important",
          "border-top": "1px solid rgba(255,255,255,0.1) !important",
          "border-left": "1px solid rgba(255,255,255,0.06) !important",
          "border-bottom": "1px solid rgba(255,255,255,0.02) !important",
          "border-right": "1px solid rgba(255,255,255,0.02) !important",
          "box-shadow": "0 8px 24px 0 rgba(0,0,0,0.5) !important",
        },
        ".quick-input-widget .monaco-list-row": {
          "border-radius": "6px !important",
          "margin-left": "4px !important",
          "margin-right": "4px !important",
          "width": "calc(100% - 8px) !important",
          "transition": "background 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important",
        },
        ".quick-input-widget .monaco-list-row.focused": {
          "background": "linear-gradient(135deg, rgba(49,50,56,0.7), rgba(37,38,44,0.5)) !important",
          "box-shadow": "inset 0 0 0 1px rgba(255,255,255,0.06) !important",
        },
        ".scrollbar .slider": {
          "border-radius": "9999px !important",
          "transition": "opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important",
        },
        ".monaco-count-badge": {
          "border-radius": "9999px !important",
          "font-size": "12px !important",
          "padding": "0 6px !important",
          "min-height": "16px !important",
          "line-height": "16px !important",
          "transform": "scale(0.85) !important",
        },
        ".tab .tab-actions": {
          "opacity": "0 !important",
          "transition": "opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important",
        },
        ".tab:hover .tab-actions": {
          "opacity": "1 !important",
        },
        ".tab.active .tab-actions": {
          "opacity": "1 !important",
        },
        ".monaco-workbench *": {
          "border-color": "transparent !important",
        },
      },
      "workbench.iconTheme": "charmed-warm",
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/README.md`]: `# almostnode webide starter

This seeded workspace is already wired for Tailwind-style utility classes and shadcn aliases.

- edit \`src/App.tsx\`
- run \`npm run dev\`
- preview the app in the host pane
- use \`npx shadcn@latest add dropdown-menu\` once you want more components

Tailwind is served through the Vite preview via the CDN plus \`tailwind.config.ts\`, so the app starts without a build-time Tailwind install step.
`,
  [`${WORKSPACE_ROOT}/components.json`]: JSON.stringify(
    {
      "$schema": "https://ui.shadcn.com/schema.json",
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "tailwind.config.ts",
        css: "src/index.css",
        baseColor: "zinc",
        cssVariables: true,
        prefix: "",
      },
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
      iconLibrary: "lucide",
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/tailwind.config.ts`]: `export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', 'monospace'],
      },
    },
  },
};
`,
  [`${WORKSPACE_ROOT}/src/main.tsx`]: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  [`${WORKSPACE_ROOT}/src/App.tsx`]: `import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const PILLARS = [
  {
    title: 'Tailwind ready',
    detail: 'Utility classes are live immediately through the preview. No bootstrap command is required to start styling.',
  },
  {
    title: 'shadcn aliases',
    detail: 'The workspace already has components.json, @/ imports, CSS variables, and a local Button primitive wired up.',
  },
  {
    title: 'Terminal first',
    detail: 'Keep the preview open while you add packages or components from the same project root in the terminal panel.',
  },
];

const NOTES = [
  {
    title: 'Next useful command',
    body: 'Run npx shadcn@latest add dropdown-menu after you want a real shadcn component. The project is already configured for it.',
  },
  {
    title: 'Tailwind config',
    body: 'Edit tailwind.config.ts to extend colors, spacing, and radii. The Vite preview injects that config automatically.',
  },
  {
    title: 'Theme toggle',
    body: 'This starter uses the standard .dark class so shadcn-style color variables and utility classes stay aligned.',
  },
];

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_22rem]">
          <div className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-background/82 p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.65)] backdrop-blur-xl sm:p-8">
            <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.22),transparent_62%)]" />
            <div className="relative flex flex-col gap-6">
              <div className="space-y-4">
                <span className="inline-flex w-fit items-center rounded-full border border-border/60 bg-secondary/70 px-3 py-1 font-mono text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
                  Tailwind + shadcn starter
                </span>
                <div className="space-y-4">
                  <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                    Style the Web IDE app immediately instead of bootstrapping Tailwind by hand.
                  </h1>
                  <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                    The preview is already configured for Tailwind utility classes, CSS variables, and shadcn-style aliases.
                    Use this screen as a real starter instead of a plain CSS placeholder.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.hash = '#starter-notes';
                  }}
                >
                  Open starter notes
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {PILLARS.map((pillar) => (
                  <article
                    key={pillar.title}
                    className="rounded-3xl border border-border/60 bg-card/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                  >
                    <p className="text-sm font-semibold tracking-tight">{pillar.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{pillar.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-border/60 bg-card/82 p-5 shadow-[0_28px_90px_-45px_rgba(15,23,42,0.7)] backdrop-blur-xl">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Start here</p>
                <code className="mt-3 block rounded-2xl border border-border/70 bg-secondary/70 px-4 py-3 font-mono text-sm text-foreground">
                  npm run dev
                </code>
              </div>

              <div className="rounded-3xl border border-border/60 bg-background/70 p-4">
                <p className="text-sm font-semibold tracking-tight">Suggested next command</p>
                <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">
                  npx shadcn@latest add dropdown-menu
                </p>
              </div>

              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>The app already includes components.json, tailwind.config.ts, and a working @/ import map.</p>
                <p>Edit <span className="font-mono text-foreground">src/App.tsx</span> or drop new files into <span className="font-mono text-foreground">src/components</span>.</p>
              </div>

              <div className="rounded-3xl border border-border/60 bg-secondary/55 p-4">
                <p className="text-sm font-semibold tracking-tight">Aliases</p>
                <ul className="mt-3 space-y-2 font-mono text-xs text-muted-foreground">
                  <li>@/components</li>
                  <li>@/components/ui</li>
                  <li>@/lib/utils</li>
                </ul>
              </div>
            </div>
          </aside>
        </section>

        <section id="starter-notes" className="grid gap-4 md:grid-cols-3">
          {NOTES.map((note) => (
            <article
              key={note.title}
              className="rounded-[1.75rem] border border-border/60 bg-card/75 p-5 shadow-[0_22px_70px_-42px_rgba(15,23,42,0.65)] backdrop-blur-xl"
            >
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Starter note</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">{note.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{note.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[2rem] border border-border/60 bg-background/80 p-5 shadow-[0_28px_90px_-48px_rgba(15,23,42,0.72)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Preview stack</p>
              <h2 className="text-2xl font-semibold tracking-tight">A Vite-flavored workspace with Tailwind semantics built in.</h2>
            </div>
            <div className="rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
              Edit <span className="font-mono text-foreground">tailwind.config.ts</span> to extend the design tokens.
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm font-semibold tracking-tight">What changed from the old seed</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Tailwind utility classes work without a manual init step.</li>
                <li>shadcn aliases and CSS variables are already in place.</li>
                <li>The starter now looks like a real app instead of a plain CSS scaffold.</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm font-semibold tracking-tight">Useful files</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li><span className="font-mono text-foreground">src/App.tsx</span> for the landing surface.</li>
                <li><span className="font-mono text-foreground">src/components/ui/button.tsx</span> for a local shadcn-style primitive.</li>
                <li><span className="font-mono text-foreground">src/lib/utils.ts</span> for the shared cn helper.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
`,
  [`${WORKSPACE_ROOT}/src/lib/utils.ts`]: `export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs.filter(Boolean).join(' ');
}
`,
  [`${WORKSPACE_ROOT}/src/components/ui/button.tsx`]: `import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'outline';
type ButtonSize = 'default' | 'sm' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const baseStyles =
  'inline-flex items-center justify-center rounded-full font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60';

const variantStyles: Record<ButtonVariant, string> = {
  default:
    'bg-primary text-primary-foreground shadow-[0_20px_45px_-24px_rgba(249,115,22,0.85)] hover:-translate-y-0.5 hover:bg-primary/90',
  secondary:
    'bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:bg-secondary/80',
  outline:
    'border border-border bg-background/70 text-foreground hover:-translate-y-0.5 hover:bg-secondary/70',
};

const sizeStyles: Record<ButtonSize, string> = {
  default: 'h-11 px-5 text-sm',
  sm: 'h-9 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function Button({
  className,
  type = 'button',
  variant = 'default',
  size = 'default',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      {...props}
    />
  );
}
`,
  [`${WORKSPACE_ROOT}/src/index.css`]: `:root {
  --background: 36 40% 96%;
  --foreground: 222 39% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 39% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 39% 11%;
  --primary: 23 92% 58%;
  --primary-foreground: 24 28% 10%;
  --secondary: 210 32% 92%;
  --secondary-foreground: 222 39% 18%;
  --muted: 210 22% 89%;
  --muted-foreground: 222 15% 40%;
  --accent: 198 69% 47%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 72% 54%;
  --destructive-foreground: 0 0% 100%;
  --border: 215 25% 84%;
  --input: 215 25% 84%;
  --ring: 23 92% 58%;
  --radius: 1.4rem;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
}

.dark {
  --background: 224 36% 9%;
  --foreground: 36 43% 96%;
  --card: 223 33% 13%;
  --card-foreground: 36 43% 96%;
  --popover: 223 33% 13%;
  --popover-foreground: 36 43% 96%;
  --primary: 24 96% 63%;
  --primary-foreground: 20 28% 10%;
  --secondary: 222 24% 18%;
  --secondary-foreground: 36 43% 96%;
  --muted: 223 21% 17%;
  --muted-foreground: 218 19% 72%;
  --accent: 198 72% 54%;
  --accent-foreground: 224 36% 9%;
  --destructive: 0 74% 58%;
  --destructive-foreground: 0 0% 100%;
  --border: 222 17% 23%;
  --input: 222 17% 23%;
  --ring: 24 96% 63%;
}

* {
  box-sizing: border-box;
  border-color: hsl(var(--border));
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  color: hsl(var(--foreground));
  background-color: hsl(var(--background));
  background-image:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.22), transparent 28rem),
    radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.16), transparent 32rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0));
}

.dark body {
  background-image:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.2), transparent 28rem),
    radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.14), transparent 32rem),
    linear-gradient(180deg, rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0));
}

button,
input,
textarea,
select {
  font: inherit;
}

code {
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
}

::selection {
  background: rgba(249, 115, 22, 0.24);
}
`,
};

const CLAUDE_WRAPPER_PATH = '/usr/local/bin/claude-wrapper';
const CLAUDE_WRAPPER_SCRIPT = '#!/bin/sh\nexec claude "$@"\n';
const SETTINGS_PATH = `${WORKSPACE_ROOT}/.vscode/settings.json`;

function ensureDirectory(
  container: ReturnTypeOfCreateContainer,
  path: string,
): void {
  if (!container.vfs.existsSync(path)) {
    container.vfs.mkdirSync(path, { recursive: true });
  }
}

export function seedWorkspace(container: ReturnTypeOfCreateContainer): void {
  for (const directory of DIRECTORIES) {
    ensureDirectory(container, directory);
  }

  for (const [path, content] of Object.entries(FILES)) {
    // Guard settings file: only seed if it doesn't already exist (preserve user changes on IDB-backed sessions)
    if (path === SETTINGS_PATH && container.vfs.existsSync(path)) {
      continue;
    }
    container.vfs.writeFileSync(path, content);
  }

  // Write Claude wrapper executable
  ensureDirectory(container, '/usr/local/bin');
  container.vfs.writeFileSync(CLAUDE_WRAPPER_PATH, CLAUDE_WRAPPER_SCRIPT);
}
