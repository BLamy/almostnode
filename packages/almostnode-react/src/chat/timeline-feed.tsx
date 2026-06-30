import { MarkdownContent } from './docstream';
import type { ChatMessage } from '@agent-wasm/chat-core';
import { ToolCallCard } from './tool-call-card';
import { ElicitationCard } from './elicitation-card';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './message-scroller';

interface TimelineFeedProps {
  messages: ChatMessage[];
  busy: boolean;
  emptyHint: string | null;
  onRespondToElicitation?: (requestId: string, answers: string[][]) => Promise<void>;
  onRejectElicitation?: (requestId: string) => Promise<void>;
}

/** Keep a slice of the previous turn visible above a newly anchored turn. */
const PREVIOUS_TURN_PEEK = 64;

function MessageMarkdown({ text }: { text: string }) {
  return (
    <div className="webide-chat-markdown" data-docstream="">
      <MarkdownContent markdown={text} />
    </div>
  );
}

export function TimelineFeed({
  messages,
  busy,
  emptyHint,
  onRespondToElicitation,
  onRejectElicitation,
}: TimelineFeedProps) {
  if (messages.length === 0 && !busy) {
    return (
      <div className="webide-chat-timeline is-empty" data-testid="chat-timeline">
        <div className="webide-chat-empty-hint">
          {emptyHint ?? 'Send a message to start a conversation with your coding agent.'}
        </div>
      </div>
    );
  }

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={PREVIOUS_TURN_PEEK}
    >
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent data-testid="chat-timeline" aria-busy={busy}>
            {messages.map((message) =>
              message.kind === 'tool' && message.tool ? (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <ToolCallCard tool={message.tool} />
                </MessageScrollerItem>
              ) : message.kind === 'elicitation' && message.elicitation ? (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <ElicitationCard
                    elicitation={message.elicitation}
                    onRespond={onRespondToElicitation ?? (async () => {})}
                    onReject={onRejectElicitation ?? (async () => {})}
                  />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === 'user'}
                  className={`webide-chat-message is-${message.role}${message.pending ? ' is-pending' : ''}`}
                  data-role={message.role}
                >
                  <div className="webide-chat-message-bubble">
                    <MessageMarkdown text={message.text} />
                  </div>
                </MessageScrollerItem>
              ),
            )}
            {busy ? (
              <MessageScrollerItem
                className="webide-chat-message is-assistant is-busy"
                aria-live="polite"
              >
                <div className="webide-chat-message-bubble">
                  <span className="webide-chat-busy-dots" aria-label="Agent is working">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
