import { useSidebar } from './sidebar-context';
import { ChatThreadItem } from './chat-thread-item';
import { Button } from '../ui/button';

interface ChatThreadListProps {
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
}

export function ChatThreadList({ onSelectThread, onCreateThread }: ChatThreadListProps) {
  const { state } = useSidebar();

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="almostnode-sidebar__section-label">
        <span>Chats</span>
        <Button variant="ghost" size="sm" onClick={onCreateThread} style={{ padding: '0.1rem 0.35rem' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </Button>
      </div>
      {state.chatThreads.length === 0 ? (
        <div style={{ padding: '0.35rem 0.75rem', fontSize: '0.74rem', color: 'var(--muted)', opacity: 0.6 }}>
          No chats yet
        </div>
      ) : (
        state.chatThreads.map((thread) => (
          <ChatThreadItem
            key={thread.id}
            thread={thread}
            isActive={thread.id === state.activeChatThreadId}
            onSelect={onSelectThread}
          />
        ))
      )}
    </div>
  );
}
