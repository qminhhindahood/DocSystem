'use client';

import React, { useState } from 'react';
import { cn } from '@/components/lib/cn';
import { Eye, EyeOff } from 'lucide-react';

export interface PasswordFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: 'current-password' | 'new-password';
  placeholder?: string;
  disabled?: boolean;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete = 'current-password',
  placeholder,
  disabled,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id || label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="w-full">
      <label htmlFor={inputId} className="mb-1.5 block text-control text-text-secondary">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn(
            'control-field pr-12 text-body',
            error && 'border-error focus:border-error',
          )}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-compact text-text-secondary transition-colors hover:bg-surface-strong hover:text-text-primary"
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Eye aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} className="mt-1.5 text-metadata text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
