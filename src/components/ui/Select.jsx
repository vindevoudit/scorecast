// Tier 11 Chunk 1 — <Select> primitive. Wraps @radix-ui/react-select for
// keyboard nav + screen reader support. Use for the few existing dropdowns
// (group visibility selector, theme toggle if we want a Select rather than
// segmented control, etc.).

import { forwardRef } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from './cn';

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;
const SelectGroup = SelectPrimitive.Group;

const SelectTrigger = forwardRef(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-2xl border border-default bg-overlay/60 px-4 py-2.5 text-sm text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'data-[placeholder]:text-fg-subtle',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 opacity-60"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

const SelectContent = forwardRef(function SelectContent(
  { className, position = 'popper', ...props },
  ref,
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'z-50 max-h-[--radix-select-content-available-height] overflow-hidden rounded-2xl border border-default bg-elevated text-fg shadow-glow',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{props.children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

const SelectItem = forwardRef(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-xl px-3 py-2 text-sm text-fg outline-none',
        'data-[highlighted]:bg-overlay data-[highlighted]:text-fg',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

const SelectLabel = forwardRef(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn(
        'px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg-subtle',
        className,
      )}
      {...props}
    />
  );
});

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectLabel };
export default Select;
