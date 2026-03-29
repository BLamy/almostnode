import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      className={cn(
        'flex h-8 w-full rounded-md px-3 py-1 text-sm',
        'border border-[var(--panel-border)] bg-[rgba(255,255,255,0.04)]',
        'text-[var(--text)] placeholder:text-[var(--muted)]',
        'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
