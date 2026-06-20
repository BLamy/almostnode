import { cloneElement, forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'outline';

type ButtonOwnProps = {
  variant?: ButtonVariant;
  asChild?: boolean;
};

type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactElement | ReactElement[] | string;
};

const variants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:opacity-90',
  outline: 'border border-border bg-background text-foreground hover:bg-secondary',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  type = 'button',
  variant = 'default',
  asChild = false,
  children,
  ...props
}, ref) => {
  const classes = cn(
    'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    className,
  );

  if (asChild && isSingleElement(children)) {
    const child = children;
    return cloneElement(child, {
      ...(child.props as AnchorHTMLAttributes<HTMLAnchorElement>),
      className: cn(classes, (child.props as AnchorHTMLAttributes<HTMLAnchorElement>).className),
    });
  }

  return (
    <button ref={ref} type={type} className={classes} {...props}>
      {children}
    </button>
  );
});
Button.displayName = 'Button';

function isSingleElement(value: unknown): value is ReactElement {
  return typeof value === 'object' && value !== null && 'props' in value;
}
