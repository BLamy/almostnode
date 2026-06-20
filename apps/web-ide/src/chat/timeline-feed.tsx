import { useEffect, useRef } from 'react';
import { MarkdownContent } from '../features/docstream';
import type { ChatMessage } from './conversation-types';
import { ToolCallCard } from './tool-call-card';
import { ElicitationCard } from './elicitation-card';

interface TimelineFeedProps {
  messages: ChatMessage[];
  busy: boolean;
  emptyHint: string | null;
  onRespondToElicitation?: (requestId: string, answers: string[][]) => Promise<void>;
  onRejectElicitation?: (requestId: string) => Promise<void>;
}

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

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
    <div
      className="webide-chat-timeline"
      data-testid="chat-timeline"
      ref={scrollRef}
      onScroll={handleScroll}
    >
      {messages.map((message) =>
        message.kind === 'tool' && message.tool ? (
          <ToolCallCard key={message.id} tool={message.tool} />
        ) : message.kind === 'elicitation' && message.elicitation ? (
          <ElicitationCard
            key={message.id}
            elicitation={message.elicitation}
            onRespond={onRespondToElicitation ?? (async () => {})}
            onReject={onRejectElicitation ?? (async () => {})}
          />
        ) : (
          <div
            key={message.id}
            className={`webide-chat-message is-${message.role}${message.pending ? ' is-pending' : ''}`}
            data-role={message.role}
          >
            <div className="webide-chat-message-bubble">
              <MessageMarkdown text={message.text} />
            </div>
          </div>
        ),
      )}
      {busy ? (
        <div className="webide-chat-message is-assistant is-busy" aria-live="polite">
          <div className="webide-chat-message-bubble">
            <span className="webide-chat-busy-dots" aria-label="Agent is working">
              <span />
              <span />
              <span />
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
