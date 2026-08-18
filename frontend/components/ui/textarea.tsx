import React from 'react';
import { cn } from '../lib/cn';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, label, error, helperText, id, 'aria-describedby': describedBy, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const textareaId = id || `textarea-${generatedId}`;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-control text-text-secondary"
          >
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [describedBy, error ? errorId : undefined, helperText ? helperId : undefined]
              .filter(Boolean)
              .join(' ') || undefined
          }
          className={cn(
            'control-field resize-none text-body',
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

Textarea.displayName = 'Textarea';

export { Textarea };
