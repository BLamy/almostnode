import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline';
}

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
      'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition',
      variant === 'outline' ? 'border border-border bg-background text-foreground' : 'bg-primary text-primary-foreground',
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
