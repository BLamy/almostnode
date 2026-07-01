import { useEffect, useMemo, useRef, useState } from "react";
import { useKeychain } from "../keychain/keychain-store";
import { ChatIcon } from "../os/icons";
import { useSystem } from "../os/system";
import { useOsRuntime } from "../runtime/OsRuntimeProvider";
import { createOpenCodeChatAdapter, type ChatMessage } from "./opencode-adapter";

interface ChatPopoverProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPopover({ open, onClose }: ChatPopoverProps) {
  const { keychain } = useKeychain();
  const { workspace } = useOsRuntime();
  const system = useSystem();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const authed = keychain.hasSlotData("opencode");
  const adapter = useMemo(
    () => createOpenCodeChatAdapter({ authed, workspace }),
    [authed, workspace],
  );

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: ChatMessage = {
      id: `m${(idRef.current += 1)}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const reply = await adapter.respond(text);
      setMessages((prev) => [
        ...prev,
        { id: `m${(idRef.current += 1)}`, role: "assistant", content: reply },
      ]);
    } finally {
      setBusy(false);
    }
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
            OpenCode
            <span className={`os-chat__status${authed ? " is-on" : ""}`}>
              {authed ? "connected" : "signed out"}
            </span>
          </span>
          <button type="button" className="os-chat__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="os-chat__body" ref={feedRef}>
          {messages.length === 0 ? (
            <div className="os-chat__empty">
              <p>Ask OpenCode about your workspace.</p>
              <span>Try "list files" or "read package.json".</span>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`os-chat__bubble os-chat__bubble--${m.role}`}>
                {m.content}
              </div>
            ))
          )}
          {busy && <div className="os-chat__bubble os-chat__bubble--assistant is-typing">…</div>}
        </div>

        {!authed && (
          <button
            type="button"
            className="os-chat__signin"
            onClick={() => {
              system.openApp("keychain");
              onClose();
            }}
          >
            Sign in via Keychain →
          </button>
        )}

        <div className="os-chat__composer">
          <input
            className="os-chat__input"
            placeholder="Ask OpenCode…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="os-chat__send"
            onClick={() => void send()}
            disabled={!input.trim() || busy}
            aria-label="Send"
          >
            ▶
          </button>
        </div>
      </aside>
    </>
  );
}
