import type { ComponentProps } from 'react';
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller';
import { cn } from '../ui/cn';

/**
 * Styled wrapper around the headless `@shadcn/react` message scroller.
 *
 * The behavior (turn anchoring, follow-output, prepend preservation, jump
 * commands, visibility tracking) lives entirely in the primitive. This file
 * only supplies the IDE's chat styling via the bespoke `.webide-message-*`
 * classes defined in `chat.css`, so the scroller themes with the rest of the
 * workbench instead of shadcn's theme tokens.
 */

function MessageScrollerProvider(
  props: ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn('webide-message-scroller', className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn('webide-message-scroller-viewport', className)}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('webide-message-scroller-content', className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn('webide-message-scroller-item', className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  className,
  children,
  direction = 'end',
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn('webide-message-scroller-button', className)}
      {...props}
    >
      {children ?? (
        <>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          <span className="webide-sr-only">
            {direction === 'end' ? 'Scroll to latest' : 'Scroll to start'}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
