import type { WebIDEHost } from '../workbench/workbench-host';
import type { ConversationAdapter } from './conversation-types';
import type { ActiveAgentSession, AgentSessionRegistry } from './agent-session-registry';
import { ClaudeConversationAdapter } from './adapters/claude-conversation-adapter';
import { CodexConversationAdapter } from './adapters/codex-conversation-adapter';
import { OpenCodeConversationAdapter } from './adapters/opencode-conversation-adapter';
import { codexConversationBus } from './codex-conversation-bus';

/**
 * Build the conversation view for the active agent session. Returns null for
 * harnesses that do not have a synced adapter yet — chat falls back to
 * one-way stdin sends for those.
 */
export function createConversationAdapter(
  host: WebIDEHost,
  session: ActiveAgentSession,
  registry: AgentSessionRegistry,
): ConversationAdapter | null {
  if (session.harness === 'claude') {
    return new ClaudeConversationAdapter({
      vfs: host.getVfs(),
      session,
      registry,
    });
  }
  if (session.harness === 'codex') {
    return new CodexConversationAdapter({
      session,
      registry,
      bus: codexConversationBus,
    });
  }
  if (session.harness === 'opencode') {
    return new OpenCodeConversationAdapter({
      session,
      connect: () => host.createOpenCodeChatClient(),
    });
  }
  return null;
}
