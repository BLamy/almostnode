import type { ResumableThreadRecord } from '../features/project-db';

interface ResumableThreadItemProps {
  thread: ResumableThreadRecord;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

function HarnessIcon({ harness }: { harness: ResumableThreadRecord['harness'] }) {
  if (harness === 'claude') {
    return (
      <span className="almostnode-thread-item__harness almostnode-thread-item__harness--claude">
        C
      </span>
    );
  }

  return (
    <span className="almostnode-thread-item__harness almostnode-thread-item__harness--opencode">
      O
    </span>
  );
}

export function ResumableThreadItem({
  thread,
  isActive,
  onSelect,
}: ResumableThreadItemProps) {
  return (
    <button
      className={`almostnode-thread-item ${isActive ? 'is-active' : ''}`}
      onClick={() => onSelect(thread.id)}
      type="button"
    >
      <HarnessIcon harness={thread.harness} />
      <span className="almostnode-thread-item__title">{thread.title}</span>
      <span className="almostnode-thread-item__time">
        {formatRelativeTime(thread.updatedAt)}
      </span>
    </button>
  );
}
