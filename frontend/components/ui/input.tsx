import React from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, label, error, helperText, id, 'aria-describedby': describedBy, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id || `input-${generatedId}`;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-control text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [describedBy, error ? errorId : undefined, helperText ? helperId : undefined]
              .filter(Boolean)
              .join(' ') || undefined
          }
          className={cn(
            'control-field text-body',
            error && 'border-error focus:border-error',
            className,
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1.5 text-metadata text-error">
            {error}
          </p>
        )}
        {helperText && (
          <p id={helperId} className="mt-1.5 text-metadata text-text-muted">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

export { Input };
