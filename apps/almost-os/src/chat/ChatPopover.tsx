import { useEffect, useMemo, useRef, useState } from "react";
import { useKeychain } from "../keychain/keychain-store";
import { ChatIcon } from "../os/icons";
import { useSystem } from "../os/system";
import { useOsRuntime } from "../runtime/OsRuntimeProvider";
import { ApprovalModeMenu } from "./ApprovalModeMenu";
import { hasAnthropicApiKey, storeAnthropicApiKey } from "./agent/agent-runner";
import { createOpenCodeChatAdapter, type ChatMessage } from "./opencode-adapter";

interface ChatPopoverProps {
  open: boolean;
  onClose: () => void;
}

interface Activity {
  id: string;
  name: string;
  status: "running" | "ok" | "error";
}

export function ChatPopover({ open, onClose }: ChatPopoverProps) {
  const { keychain } = useKeychain();
  const { workspace } = useOsRuntime();
  const system = useSystem();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [approval, setApproval] = useState<{ summary: string; resolve: (ok: boolean) => void } | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(() => hasAnthropicApiKey(workspace));
  const idRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const authed = hasKey || keychain.hasSlotData("opencode");
  const adapter = useMemo(
    () => createOpenCodeChatAdapter({ authed, workspace, system }),
    [authed, workspace, system],
  );

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, activity, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setMessages((prev) => [...prev, { id: `m${(idRef.current += 1)}`, role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setActivity([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const assistantId = `m${(idRef.current += 1)}`;
    try {
      const reply = await adapter.respond(text, {
        signal: controller.signal,
        onText: (partial) => {
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantId);
            if (existing) {
              return prev.map((m) => (m.id === assistantId ? { ...m, content: partial } : m));
            }
            return [...prev, { id: assistantId, role: "assistant", content: partial }];
          });
        },
        onToolUse: (name) => {
          setActivity((prev) => [...prev, { id: `${name}-${prev.length}`, name, status: "running" }]);
        },
        onToolResult: (name, ok) => {
          setActivity((prev) => {
            const idx = [...prev].reverse().findIndex((a) => a.name === name && a.status === "running");
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            return prev.map((a, i) => (i === realIdx ? { ...a, status: ok ? "ok" : "error" } : a));
          });
        },
        requestApproval: (summary) =>
          new Promise<boolean>((resolve) => setApproval({ summary, resolve })),
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === assistantId)) {
          return prev.map((m) => (m.id === assistantId ? { ...m, content: reply } : m));
        }
        return [...prev, { id: assistantId, role: "assistant", content: reply }];
      });
    } finally {
      setBusy(false);
      setActivity([]);
      abortRef.current = null;
    }
  };

  const saveKey = () => {
    const key = keyDraft.trim();
    if (!key) return;
    storeAnthropicApiKey(key);
    setKeyDraft("");
    setHasKey(true);
  };

  return (
    <>
      {open && <div className="os-chat__scrim" onClick={onClose} />}
      <aside className={`os-chat${open ? " is-open" : ""}`} aria-hidden={!open}>
        <header className="os-chat__header">
          <span className="os-chat__brand">
            <span className="os-chat__brand-icon">
              <ChatIcon />
            </span>
            Assistant
            <span className={`os-chat__status${hasKey ? " is-on" : ""}`}>
              {hasKey ? "agent ready" : "no key"}
            </span>
          </span>
          <button type="button" className="os-chat__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="os-chat__toolbar">
          <ApprovalModeMenu />
        </div>

        <div className="os-chat__body" ref={feedRef}>
          {messages.length === 0 ? (
            <div className="os-chat__empty">
              <p>Ask the AlmostOS assistant to drive your desktop.</p>
              <span>“open executor.sh and add the Petstore API”, “make a stopwatch app”, “snapshot the finder”…</span>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`os-chat__bubble os-chat__bubble--${m.role}`}>
                {m.content}
              </div>
            ))
          )}
          {activity.length > 0 && (
            <div className="os-chat__activity">
              {activity.map((a) => (
                <span key={a.id} className={`os-chat__act os-chat__act--${a.status}`}>
                  {a.status === "running" ? "⋯" : a.status === "ok" ? "✓" : "✗"} {a.name}
                </span>
              ))}
            </div>
          )}
          {busy && activity.length === 0 && (
            <div className="os-chat__bubble os-chat__bubble--assistant is-typing">…</div>
          )}
        </div>

        {approval && (
          <div className="os-chat__approval">
            <div className="os-chat__approval-text">
              Approve <code>{approval.summary}</code>?
            </div>
            <div className="os-chat__approval-actions">
              <button
                type="button"
                onClick={() => {
                  approval.resolve(false);
                  setApproval(null);
                }}
              >
                Deny
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  approval.resolve(true);
                  setApproval(null);
                }}
              >
                Approve
              </button>
            </div>
          </div>
        )}

        {!hasKey && (
          <div className="os-chat__keyrow">
            <input
              className="os-chat__key"
              type="password"
              placeholder="Anthropic API key (sk-ant-…)"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveKey();
              }}
            />
            <button type="button" onClick={saveKey} disabled={!keyDraft.trim()}>
              Connect
            </button>
          </div>
        )}

        <div className="os-chat__composer">
          <input
            className="os-chat__input"
            placeholder={hasKey ? "Tell the assistant what to do…" : "Ask (local preview)…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="os-chat__send"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              className="os-chat__send"
              onClick={() => void send()}
              disabled={!input.trim()}
              aria-label="Send"
            >
              ▶
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
