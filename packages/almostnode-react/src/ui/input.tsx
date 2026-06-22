import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      className={cn(
        'almostnode-ui-input',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
