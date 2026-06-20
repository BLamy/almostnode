import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'outline';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:opacity-90',
  outline: 'border border-border bg-background text-foreground hover:bg-secondary',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  type = 'button',
  variant = 'default',
  ...props
}, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
      variants[variant],
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
