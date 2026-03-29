import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectRecord } from '../features/project-db';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface ProjectItemProps {
  project: ProjectRecord;
  isActive: boolean;
  isExpanded: boolean;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  children?: ReactNode;
}

export function ProjectItem({
  project,
  isActive,
  isExpanded,
  onSelect,
  onToggleExpanded,
  onRename,
  onDelete,
  children,
}: ProjectItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(project.id, trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div className="almostnode-project-group">
      <div
        className={`almostnode-project-item ${isActive ? 'is-active' : ''}`}
        onClick={() => !isRenaming && onSelect(project.id)}
      >
        <button
          className="almostnode-project-item__chevron"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded(project.id);
          }}
          type="button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={isExpanded ? 'is-expanded' : ''}
          >
            <path
              d="m6 3 5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flex: 'none', opacity: 0.6 }}>
          <path
            d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6.29289C6.4255 2 6.55268 2.05268 6.64645 2.14645L7.85355 3.35355C7.94732 3.44732 8.0745 3.5 8.20711 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V13C14.5 13.5523 14.0523 14 13.5 14H2.5C1.94772 14 1.5 13.5523 1.5 13V3Z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>

        {isRenaming ? (
          <input
            ref={inputRef}
            className="almostnode-project-item__rename-input"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleRenameSubmit();
              if (event.key === 'Escape') setIsRenaming(false);
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <>
            <span className="almostnode-project-item__name">{project.name}</span>
            <span className="almostnode-project-item__badge">{project.templateId}</span>
          </>
        )}

        {!isRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="almostnode-project-item__menu-trigger"
                onClick={(event) => event.stopPropagation()}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(project.name);
                  setIsRenaming(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => onDelete(project.id)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isExpanded ? children : null}
    </div>
  );
}
