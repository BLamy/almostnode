import type { ChatThread } from '../features/project-db';

interface ChatThreadItemProps {
  thread: ChatThread;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ChatThreadItem({ thread, isActive, onSelect }: ChatThreadItemProps) {
  return (
    <button
      className={`almostnode-chat-item ${isActive ? 'is-active' : ''}`}
      onClick={() => onSelect(thread.id)}
    >
      {/* Chat icon */}
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flex: 'none', opacity: 0.5 }}>
        <path
          d="M2 3C2 2.44772 2.44772 2 3 2H13C13.5523 2 14 2.44772 14 3V10C14 10.5523 13.5523 11 13 11H5L2 14V3Z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
      <span className="almostnode-chat-item__title">{thread.title}</span>
      <span className="almostnode-chat-item__time">{formatRelativeTime(thread.lastMessageAt)}</span>
    </button>
  );
}
