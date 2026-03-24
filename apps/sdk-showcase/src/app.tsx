import React, { useEffect, useMemo, useRef, useState } from "react"
import { createProcess } from "almostnode"
import { AlmostnodeProvider, EditorPane, PreviewPane, useWorkspace } from "almostnode-react"
import { createWorkspace } from "almostnode-sdk"

declare const __OPENTUI_WASM_URL__: string

type OpenCodeBrowserModule = typeof import("opencode-browser-tui")

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message
  }

  return String(error)
}

function ensureBrowserProcess(cwd = "/project"): void {
  const current = globalThis.process as typeof globalThis.process | undefined
  if (current && typeof current.on === "function" && typeof current.cwd === "function") {
    return
  }

  globalThis.process = createProcess({
    cwd,
    env: {
      ...current?.env,
    },
  })
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

function mapWorkspacePath(path: string): string {
  if (path === "/workspace") return "/project"
  if (path.startsWith("/workspace/")) return `/project${path.slice("/workspace".length)}`
  return path
}

function createWorkspaceBridge(workspace: ReturnType<typeof createWorkspace>) {
  const vfs = workspace.vfs

  return {
    exists(path: string): boolean {
      const mapped = mapWorkspacePath(path)
      return mapped === "/project" || vfs.existsSync(mapped)
    },
    mkdir(path: string): void {
      vfs.mkdirSync(mapWorkspacePath(path), { recursive: true })
    },
    readFile(path: string): string | undefined {
      const mapped = mapWorkspacePath(path)
      try {
        const stat = vfs.statSync(mapped)
        if (stat.isDirectory()) return undefined
        return String(vfs.readFileSync(mapped, "utf8"))
      } catch {
        return undefined
      }
    },
    writeFile(path: string, content: string): void {
      const mapped = mapWorkspacePath(path)
      const directory = mapped.slice(0, mapped.lastIndexOf("/"))
      if (directory) {
        vfs.mkdirSync(directory, { recursive: true })
      }
      vfs.writeFileSync(mapped, content)
    },
    readdir(path: string) {
      const mapped = mapWorkspacePath(path)
      if (!vfs.existsSync(mapped)) {
        return []
      }

      return (vfs.readdirSync(mapped) as string[]).map((name) => {
        const stat = vfs.statSync(`${mapped}/${name}`)
        return {
          name,
          isDirectory: () => stat.isDirectory(),
          isFile: () => stat.isFile(),
        }
      })
    },
    stat(path: string) {
      const mapped = mapWorkspacePath(path)
      try {
        return vfs.statSync(mapped)
      } catch {
        return undefined
      }
    },
    remove(path: string, opts?: { recursive?: boolean }) {
      const mapped = mapWorkspacePath(path)
      if (!vfs.existsSync(mapped)) {
        return
      }

      if (vfs.statSync(mapped).isDirectory()) {
        vfs.rmSync(mapped, { recursive: Boolean(opts?.recursive), force: true })
        return
      }

      vfs.unlinkSync(mapped)
    },
    rename(oldPath: string, newPath: string) {
      vfs.renameSync(mapWorkspacePath(oldPath), mapWorkspacePath(newPath))
    },
    listFiles(root = "/workspace"): string[] {
      const mapped = mapWorkspacePath(root)
      if (!vfs.existsSync(mapped)) {
        return []
      }

      const files: string[] = []
      const visit = (currentPath: string) => {
        const stat = vfs.statSync(currentPath)
        if (stat.isDirectory()) {
          for (const entry of vfs.readdirSync(currentPath) as string[]) {
            visit(`${currentPath}/${entry}`)
          }
          return
        }

        const relative = currentPath.slice("/project".length)
        files.push(`/workspace${relative}`)
      }

      visit(mapped)
      files.sort((left, right) => left.localeCompare(right))
      return files
    },
  }
}

function createProcessBridge(workspace: ReturnType<typeof createWorkspace>) {
  return {
    async exec(input: {
      command: string
      args: string[]
      cwd?: string
      signal?: AbortSignal
      shell?: boolean | string
    }) {
      const cwd = mapWorkspacePath(input.cwd || "/workspace")
      const commandString =
        input.shell || input.args.length === 0
          ? input.command
          : [quoteShellArg(input.command), ...input.args.map(quoteShellArg)].join(" ")

      const result = await workspace.container.run(commandString, {
        cwd,
        signal: input.signal,
      })

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.exitCode,
      }
    },
  }
}

function OpenCodePane(): React.ReactElement {
  const workspace = useWorkspace()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState("booting")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let activeSession: Awaited<ReturnType<OpenCodeBrowserModule["mountOpenCodeTui"]>> | null = null
    let disposed = false

    ensureBrowserProcess("/project")

    void import("opencode-browser-tui")
      .then(async ({ mountOpenCodeTui }) => {
        setStatus("starting")
        const session = await mountOpenCodeTui({
          container: host,
          wasmUrl: __OPENTUI_WASM_URL__,
          directory: "/workspace",
          workspaceBridge: createWorkspaceBridge(workspace),
          processBridge: createProcessBridge(workspace),
          env: {
            copy: async (text) => navigator.clipboard.writeText(text),
            openUrl: (url) => window.open(url, "_blank", "noopener,noreferrer"),
            setTitle: (title) => {
              document.title = title || "almostnode SDK Showcase"
            },
            themeMode: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          },
        })

        if (disposed) {
          session.dispose()
          return
        }

        activeSession = session
        ;(window as any).__OPENCODE_BROWSER_TUI__ = session
        setStatus("running")
        void session.exited.catch((mountError) => {
          if (!disposed) {
            setError(formatError(mountError))
          }
        })
      })
      .catch((mountError) => {
        setStatus("error")
        setError(formatError(mountError))
      })

    return () => {
      disposed = true
      if ((window as any).__OPENCODE_BROWSER_TUI__ === activeSession) {
        delete (window as any).__OPENCODE_BROWSER_TUI__
      }
      activeSession?.dispose()
      host.replaceChildren()
    }
  }, [workspace])

  return (
    <section style={paneStyle}>
      <header style={paneHeaderStyle}>
        <strong>Terminal</strong>
        <span style={captionStyle}>opencode · {status}</span>
      </header>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, background: "#020617" }} />
      {error ? <pre style={errorStyle}>{error}</pre> : null}
    </section>
  )
}

export function App(
  props: {
    autoStartPreview?: boolean
    enableAgent?: boolean
    showPreview?: boolean
    showTerminal?: boolean
  } = {},
): React.ReactElement {
  const workspace = useMemo(() => {
    return createWorkspace({
      autoStartPreview: props.autoStartPreview ?? true,
      shellCommands: [
        {
          name: "sdk:hello",
          interceptShellParsing: true,
          execute: async (args, context) => {
            context.writeStdout(`hello from almostnode-sdk ${args.join(" ")}\n`)
            return { stdout: "", stderr: "", exitCode: 0 }
          },
        },
        {
          name: "sdk:files",
          execute: async (_args, context) => {
            const list = await context.exec("ls /project && ls /project/src")
            return {
              stdout: list.stdout,
              stderr: list.stderr,
              exitCode: list.exitCode,
            }
          },
        },
      ],
      browserEnv: {
        copy: async (text) => navigator.clipboard.writeText(text),
        openUrl: (url) => window.open(url, "_blank", "noopener,noreferrer"),
      },
    })
  }, [props.autoStartPreview])

  useEffect(() => {
    return () => workspace.destroy()
  }, [workspace])

  return (
    <AlmostnodeProvider workspace={workspace}>
      <main className="showcase-shell">
        <section className="hero">
          <div>
            <p className="eyebrow">Sandpack-like SDK</p>
            <h1>almostnode with the real OpenCode TUI running in-browser.</h1>
            <p className="lede">
              The editor and preview are backed by <code>almostnode-sdk</code>, and the bottom pane is the actual
              OpenCode terminal UI mounted through OpenTUI’s browser renderer against the same in-memory workspace.
            </p>
          </div>
        </section>

        <section className="layout-grid">
          <div className="editor-cell">
            <EditorPane />
          </div>
          <div className="preview-cell">
            {props.showPreview ?? true ? <PreviewPane /> : <EditorPane />}
          </div>
          <div className="terminal-cell">
            {(props.showTerminal ?? true) && (props.enableAgent ?? true) ? <OpenCodePane /> : <EditorPane />}
          </div>
        </section>
      </main>
    </AlmostnodeProvider>
  )
}

const paneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
  border: "1px solid rgba(148,163,184,.35)",
  borderRadius: "18px",
  overflow: "hidden",
  background: "#f8fafc",
}

const paneHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  borderBottom: "1px solid rgba(148,163,184,.3)",
  background: "#e2e8f0",
}

const captionStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#475569",
}

const errorStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px 14px",
  fontSize: "12px",
  lineHeight: 1.5,
  color: "#b91c1c",
  background: "#fef2f2",
  borderTop: "1px solid rgba(248,113,113,.35)",
  whiteSpace: "pre-wrap",
}
