import { useEffect, useRef } from 'react';
import { Streamdown } from 'streamdown';
import type { ChatMessage } from './conversation-types';
import { ToolCallCard } from './tool-call-card';

interface TimelineFeedProps {
  messages: ChatMessage[];
  busy: boolean;
  emptyHint: string | null;
}

function MessageMarkdown({ text }: { text: string }) {
  return (
    <Streamdown
      className="webide-chat-markdown"
      lineNumbers={false}
      mode="static"
    >
      {text}
    </Streamdown>
  );
}

export function TimelineFeed({ messages, busy, emptyHint }: TimelineFeedProps) {
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
