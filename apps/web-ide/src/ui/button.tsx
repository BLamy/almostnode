import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'icon';
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]',
          'disabled:pointer-events-none disabled:opacity-50',
          variant === 'default' && 'bg-[var(--accent)] text-[#071018] hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]',
          variant === 'ghost' && 'hover:bg-[rgba(255,255,255,0.06)] text-[var(--muted)] hover:text-[var(--text)]',
          variant === 'outline' && 'border border-[var(--panel-border)] bg-transparent hover:bg-[rgba(255,255,255,0.06)] text-[var(--text)]',
          size === 'default' && 'h-8 px-3 py-1.5',
          size === 'sm' && 'h-7 px-2 text-xs',
          size === 'icon' && 'h-8 w-8',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
