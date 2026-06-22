import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgentHarness } from '@agent-wasm/chat-core';
import {
  CHAT_EFFORT_LABELS,
  CHAT_MODEL_OPTIONS,
  readChatEffort,
  readChatModel,
  readChatPlanMode,
  writeChatEffort,
  writeChatModel,
  writeChatPlanMode,
  type ChatEffort,
} from '@agent-wasm/chat-core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const AGENT_LABELS: Record<AgentHarness, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** Claude context window used for the composer occupancy marker. */
const CONTEXT_WINDOW_TOKENS = 200_000;

interface ChatComposerProps {
  /** The agent currently running, or null when no session is active. */
  activeHarness: AgentHarness | null;
  selectedHarness: AgentHarness;
  onSelectHarness: (harness: AgentHarness) => void;
  busy: boolean;
  launching: boolean;
  /** Context window occupancy in tokens, when the harness reports usage. */
  contextTokens?: number | null;
  onSend: (text: string) => Promise<void>;
}

function ClaudeMark() {
  return (
    <span className="webide-chat-picker-mark" aria-hidden="true">
      ✺
    </span>
  );
}

function PickerChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Searchable model picker. The selection applies when the next agent
 * session launches (a running CLI keeps the model it started with).
 */
function ModelPicker({ disabled }: { disabled: boolean }) {
  const [modelId, setModelId] = useState<string | null>(readChatModel);
  const [query, setQuery] = useState('');

  const selected =
    CHAT_MODEL_OPTIONS.find((option) => option.id === modelId) ??
    CHAT_MODEL_OPTIONS[0]!;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return CHAT_MODEL_OPTIONS;
    return CHAT_MODEL_OPTIONS.filter((option) =>
      `${option.label} ${option.provider}`.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <DropdownMenu onOpenChange={(open) => open && setQuery('')}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="webide-chat-picker-button"
          data-testid="chat-model-picker"
          disabled={disabled}
          title="Model for the next session launch"
        >
          <ClaudeMark />
          {selected.label}
          <PickerChevron />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="webide-chat-model-menu">
        <div className="webide-chat-model-search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={query}
            placeholder="Search models..."
            onChange={(event) => setQuery(event.target.value)}
            // Keep typing from triggering the menu's typeahead/arrow nav.
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Escape') {
                event.stopPropagation();
              }
            }}
          />
        </div>
        {filtered.length === 0 ? (
          <div className="webide-chat-model-empty">No models found.</div>
        ) : (
          filtered.map((option) => (
            <DropdownMenuItem
              key={option.id ?? 'default'}
              className="webide-chat-model-item"
              onSelect={() => {
                setModelId(option.id);
                writeChatModel(option.id);
              }}
            >
              <span className="webide-chat-model-item-copy">
                <span className="webide-chat-model-item-label">{option.label}</span>
                <span className="webide-chat-model-item-provider">
                  <ClaudeMark />
                  {option.provider}
                </span>
              </span>
              {option.id === selected.id ? (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="m3.5 8.5 3 3 6-7"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortPicker({ disabled }: { disabled: boolean }) {
  const [effort, setEffort] = useState<ChatEffort>(readChatEffort);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="webide-chat-picker-button"
          data-testid="chat-effort-picker"
          disabled={disabled}
          title="Thinking effort for the next session launch"
        >
          {CHAT_EFFORT_LABELS[effort]}
          <PickerChevron />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(Object.keys(CHAT_EFFORT_LABELS) as ChatEffort[]).map((level) => (
          <DropdownMenuItem
            key={level}
            onSelect={() => {
              setEffort(level);
              writeChatEffort(level);
            }}
          >
            {CHAT_EFFORT_LABELS[level]}
            {level === effort ? ' ✓' : ''}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlanModeToggle({ disabled }: { disabled: boolean }) {
  const [enabled, setEnabled] = useState<boolean>(readChatPlanMode);

  return (
    <button
      type="button"
      className={`webide-chat-picker-button${enabled ? ' is-active' : ''}`}
      data-testid="chat-plan-toggle"
      aria-pressed={enabled}
      disabled={disabled}
      title="Start the next session in plan mode"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        writeChatPlanMode(next);
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5.5 2.5h5l3 3v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M6 8h4M6 10.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      Plan
    </button>
  );
}

function ContextMarker({ tokens }: { tokens: number }) {
  const fraction = Math.min(1, tokens / CONTEXT_WINDOW_TOKENS);
  const percent = Math.round(fraction * 100);
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      className="webide-chat-context-marker"
      data-testid="chat-context-marker"
      title={`${tokens.toLocaleString()} of ${CONTEXT_WINDOW_TOKENS.toLocaleString()} context tokens used (${percent}%)`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 7 7)"
        />
      </svg>
      {Math.round(tokens / 1000)}k
    </span>
  );
}

export function ChatComposer({
  activeHarness,
  selectedHarness,
  onSelectHarness,
  busy,
  launching,
  contextTokens,
  onSend,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || sendingRef.current || launching) return;
    sendingRef.current = true;
    setError(null);
    setValue('');
    try {
      await onSend(text);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
      setValue(text);
    } finally {
      sendingRef.current = false;
    }
  }, [value, launching, onSend]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const placeholder = launching
    ? `Starting ${AGENT_LABELS[selectedHarness]}… (first run can take a minute)`
    : activeHarness
      ? busy
        ? `${AGENT_LABELS[activeHarness]} is working — your message will queue`
        : `Message ${AGENT_LABELS[activeHarness]}`
      : `Message ${AGENT_LABELS[selectedHarness]} (starts a session)`;

  const showClaudePickers = (activeHarness ?? selectedHarness) === 'claude';

  return (
    <div className="webide-chat-composer" data-testid="chat-composer">
      {error ? <div className="webide-chat-composer-error">{error}</div> : null}
      <div className="webide-chat-composer-box">
        <textarea
          className="webide-chat-composer-input"
          data-testid="chat-composer-input"
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={launching}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="webide-chat-composer-actions">
          <div className="webide-chat-composer-pickers">
            {activeHarness === null ? (
              <select
                className="webide-chat-agent-select"
                data-testid="chat-agent-select"
                value={selectedHarness}
                disabled={launching}
                onChange={(event) => onSelectHarness(event.target.value as AgentHarness)}
                aria-label="Coding agent"
              >
                {(Object.keys(AGENT_LABELS) as AgentHarness[]).map((harness) => (
                  <option key={harness} value={harness}>
                    {AGENT_LABELS[harness]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="webide-chat-agent-chip" data-testid="chat-agent-chip">
                {AGENT_LABELS[activeHarness]}
              </span>
            )}
            {showClaudePickers ? (
              <>
                <ModelPicker disabled={launching} />
                <EffortPicker disabled={launching} />
                <PlanModeToggle disabled={launching} />
              </>
            ) : null}
          </div>
          <div className="webide-chat-composer-meta">
            {typeof contextTokens === 'number' && contextTokens > 0 ? (
              <ContextMarker tokens={contextTokens} />
            ) : null}
            <button
              type="button"
              className="webide-chat-send-button"
              data-testid="chat-send-button"
              disabled={!value.trim() || launching}
              onClick={() => void submit()}
              aria-label="Send message"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 12.5v-9M4 7l4-3.5L12 7"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
