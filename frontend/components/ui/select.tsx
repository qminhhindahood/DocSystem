'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/components/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  ariaLabel?: string;
  options: SelectOption[];
  error?: boolean;
  size?: 'sm' | 'md' | 'lg';
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'min-h-10 text-control px-3 py-2',
  md: 'min-h-11 text-body px-3.5 py-2.5',
  lg: 'min-h-12 text-body px-4 py-3',
};

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      label,
      ariaLabel,
      options,
      error,
      size = 'md',
      value,
      defaultValue,
      onValueChange,
      placeholder = 'Chọn...',
      disabled,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const labelId = React.useId();

    return (
      <div className="w-full">
        {label && (
          <label
            id={labelId}
            className="mb-1.5 block text-control text-text-secondary"
          >
            {label}
          </label>
        )}
        <SelectPrimitive.Root
          open={open}
          onOpenChange={setOpen}
          value={value}
          defaultValue={defaultValue}
          onValueChange={onValueChange}
          disabled={disabled}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            aria-label={ariaLabel}
            aria-labelledby={label ? labelId : undefined}
            className={cn(
              'flex w-full appearance-none items-center justify-between rounded-control border bg-surface text-text-primary transition-colors duration-fast',
              'focus:outline-none focus:ring-2 focus:ring-focus focus:border-focus',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error ? 'border-error' : 'border-border-strong hover:border-text-muted',
              SIZE_CLASSES[size],
              className,
            )}
          >
            <SelectPrimitive.Value placeholder={placeholder} />
            <SelectPrimitive.Icon className="ml-2 text-text-muted">
              <ChevronDown className="w-4 h-4" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              className="z-popover min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-panel border border-hairline bg-surface shadow-floating"
              position="popper"
              sideOffset={4}
            >
              <SelectPrimitive.Viewport className="p-1 max-h-60 overflow-y-auto">
                {options.map((opt) => (
                  <SelectPrimitive.Item
                    key={opt.value}
                    value={opt.value}
                    className={cn(
                      'relative flex min-h-11 cursor-pointer items-center rounded-control px-3 py-2 text-body outline-none',
                      'data-[highlighted]:bg-action-tint data-[highlighted]:text-text-primary',
                      'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
                    )}
                  >
                    <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="ml-auto">
                      <Check className="w-4 h-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      </div>
    );
  },
);

Select.displayName = 'Select';
