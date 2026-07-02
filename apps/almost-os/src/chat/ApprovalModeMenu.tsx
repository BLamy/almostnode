import { useEffect, useRef, useState } from "react";
import {
  APPROVAL_MODES,
  setApprovalMode,
  useApprovalMode,
  type ApprovalMode,
} from "../os/approval-store";

/** Monochrome line glyph per mode (raised hand / shield / warning circle). */
function ModeGlyph({ mode }: { mode: ApprovalMode }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (mode === "ask") {
    return (
      <svg {...common}>
        <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4a5 5 0 0 1-5 5h-1.2a4 4 0 0 1-2.9-1.25L6 16.5" />
        <path d="M9 11V8.5a1.5 1.5 0 0 0-3 0V13" />
      </svg>
    );
  }
  if (mode === "auto") {
    return (
      <svg {...common}>
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        <path d="M9.5 12.5l1.8 1.8 3.2-3.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/**
 * Approval-mode selector for the AI drawer — mirrors Codex's three-tier picker.
 * "Approve for me" is disabled ("Coming soon") until the guardian classifier
 * exists. Reads/writes the OS-wide approval-store.
 */
export function ApprovalModeMenu() {
  const mode = useApprovalMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = APPROVAL_MODES.find((m) => m.id === mode) ?? APPROVAL_MODES[2];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="os-approval" ref={ref}>
      <button
        type="button"
        className={`os-approval__trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="How should the assistant's actions be approved?"
      >
        <ModeGlyph mode={current.id} />
        <span className="os-approval__trigger-label">{current.label}</span>
        <span className="os-approval__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="os-approval__menu" role="listbox" aria-label="Approval mode">
          <div className="os-approval__title">How should actions be approved?</div>
          {APPROVAL_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === mode}
              disabled={m.disabled}
              title={m.disabled ? "Coming soon" : undefined}
              className={`os-approval__item${m.id === mode ? " is-selected" : ""}${
                m.disabled ? " is-disabled" : ""
              }`}
              onClick={() => {
                if (m.disabled) return;
                setApprovalMode(m.id);
                setOpen(false);
              }}
            >
              <span className="os-approval__item-glyph">
                <ModeGlyph mode={m.id} />
              </span>
              <span className="os-approval__item-text">
                <span className="os-approval__item-label">
                  {m.label}
                  {m.disabled && <span className="os-approval__soon">Coming soon</span>}
                </span>
                <span className="os-approval__item-desc">{m.description}</span>
              </span>
              {m.id === mode && (
                <span className="os-approval__check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
