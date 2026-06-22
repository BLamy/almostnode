import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentHarness,
  ConversationAdapter,
  ConversationState,
  ActiveAgentSession,
} from '@agent-wasm/chat-core';
import { agentSessionRegistry } from '@agent-wasm/chat-core';
import { TimelineFeed } from './timeline-feed';
import { ChatComposer } from './chat-composer';
import './chat.css';

const SELECTED_AGENT_KEY = 'almostnode-chat-agent';
/** How long to wait for a freshly launched CLI to register its session. */
const LAUNCH_TIMEOUT_MS = 60_000;
/**
 * Cap on waiting for the TUI readiness signal (cold installs download the
 * whole CLI package, which can take a while on first run).
 */
const READY_TIMEOUT_MS = 180_000;
/** Grace period before injecting the first message when no readiness signal exists. */
const FIRST_MESSAGE_DELAY_MS = 2_500;
/** Small settle delay after the readiness signal before typing. */
const POST_READY_DELAY_MS = 500;

function readSelectedAgent(): AgentHarness {
  try {
    const stored = localStorage.getItem(SELECTED_AGENT_KEY);
    if (stored === 'claude' || stored === 'codex' || stored === 'opencode') {
      return stored;
    }
  } catch {
    // Ignore storage failures.
  }
  return 'claude';
}

function waitForActiveSession(timeoutMs: number): Promise<ActiveAgentSession> {
  return new Promise((resolve, reject) => {
    const existing = agentSessionRegistry.getActive();
    if (existing) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('The agent session did not start in time.'));
    }, timeoutMs);
    const unsubscribe = agentSessionRegistry.subscribe((session) => {
      if (session) {
        clearTimeout(timer);
        unsubscribe();
        resolve(session);
      }
    });
  });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ChatScreenProps {
  /** Launch a CLI agent session for the given harness (host-provided). */
  startAgentSession: (harness: AgentHarness) => Promise<void>;
  /**
   * Build a synced conversation adapter for the active session. Host-specific
   * (binds the agent's transcript / JSON-RPC / SSE source); returns null for
   * harnesses without a synced view yet, in which case chat falls back to
   * one-way stdin sends.
   */
  createAdapter: (session: ActiveAgentSession) => ConversationAdapter | null;
}

export function ChatScreen({ startAgentSession, createAdapter }: ChatScreenProps) {
  const [session, setSession] = useState<ActiveAgentSession | null>(() =>
    agentSessionRegistry.getActive(),
  );
  const [selectedHarness, setSelectedHarness] = useState<AgentHarness>(readSelectedAgent);
  const [launching, setLaunching] = useState(false);
  const [conversation, setConversation] = useState<ConversationState | null>(null);
  const adapterRef = useRef<ConversationAdapter | null>(null);

  useEffect(() => agentSessionRegistry.subscribe(setSession), []);

  // (Re)build the conversation adapter whenever the active session changes.
  useEffect(() => {
    adapterRef.current?.dispose();
    adapterRef.current = null;
    setConversation(null);
    if (!session) {
      return;
    }
    const adapter = createAdapter(session);
    adapterRef.current = adapter;
    if (!adapter) {
      return;
    }
    const unsubscribe = adapter.subscribe(setConversation);
    return () => {
      unsubscribe();
      adapter.dispose();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [createAdapter, session]);

  const handleSelectHarness = useCallback((harness: AgentHarness) => {
    setSelectedHarness(harness);
    try {
      localStorage.setItem(SELECTED_AGENT_KEY, harness);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      let active = agentSessionRegistry.getActive();
      if (!active || !active.isRunning()) {
        setLaunching(true);
        try {
          // A launch may already be in flight (e.g. a thread resume from the
          // sidebar) — wait for it instead of starting a duplicate session.
          if (!agentSessionRegistry.isLaunching()) {
            // Resolves once the launch is initiated (it throws early for
            // missing credentials); the registry reports the running session.
            await startAgentSession(selectedHarness);
          }
          active = await waitForActiveSession(LAUNCH_TIMEOUT_MS);
          if (active.ready) {
            // Wait for the TUI's readiness signal — input injected while the
            // CLI boots is flushed by raw-mode init and silently lost.
            await Promise.race([active.ready, delay(READY_TIMEOUT_MS)]);
            await delay(POST_READY_DELAY_MS);
          } else {
            await delay(FIRST_MESSAGE_DELAY_MS);
          }
        } finally {
          setLaunching(false);
        }
      }
      const adapter = adapterRef.current;
      if (adapter) {
        await adapter.sendUserMessage(text);
      } else {
        await agentSessionRegistry.sendUserText(text);
      }
    },
    [startAgentSession, selectedHarness],
  );

  const handleRespondToElicitation = useCallback(
    async (requestId: string, answers: string[][]) => {
      const adapter = adapterRef.current;
      if (!adapter?.respondToElicitation) {
        throw new Error('This agent cannot answer requests from the chat yet.');
      }
      await adapter.respondToElicitation(requestId, answers);
    },
    [],
  );

  const handleRejectElicitation = useCallback(async (requestId: string) => {
    const adapter = adapterRef.current;
    if (!adapter?.rejectElicitation) {
      throw new Error('This agent cannot answer requests from the chat yet.');
    }
    await adapter.rejectElicitation(requestId);
  }, []);

  const emptyHint = useMemo(() => {
    if (!session) return null;
    if (!adapterRef.current && conversation === null) {
      return 'This agent does not have a synced chat view yet — replies appear in the workbench terminal.';
    }
    return null;
  }, [session, conversation]);

  return (
    <div className="webide-chat-screen" data-testid="chat-screen">
      <TimelineFeed
        messages={conversation?.messages ?? []}
        busy={conversation?.busy ?? false}
        emptyHint={emptyHint}
        onRespondToElicitation={handleRespondToElicitation}
        onRejectElicitation={handleRejectElicitation}
      />
      <ChatComposer
        activeHarness={session?.harness ?? null}
        selectedHarness={selectedHarness}
        onSelectHarness={handleSelectHarness}
        busy={conversation?.busy ?? false}
        launching={launching}
        contextTokens={conversation?.contextTokens ?? null}
        onSend={handleSend}
      />
    </div>
  );
}
