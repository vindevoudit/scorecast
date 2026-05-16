// Tier 11 Chunk 1 — <DropdownMenu> primitive. Wraps
// @radix-ui/react-dropdown-menu. UserMenu rebuilds on this in Chunk 2.

import { forwardRef } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from './cn';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuSeparator = forwardRef(function DropdownMenuSeparator(
  { className, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn('my-1 h-px bg-fg-subtle/30', className)}
      {...props}
    />
  );
});

const DropdownMenuContent = forwardRef(function DropdownMenuContent(
  { className, sideOffset = 6, align = 'end', ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-[12rem] overflow-hidden rounded-2xl border border-default bg-elevated p-1 shadow-glow',
          'focus:outline-none',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

const DropdownMenuItem = forwardRef(function DropdownMenuItem({ className, inset, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm text-fg outline-none',
        'data-[highlighted]:bg-overlay data-[highlighted]:text-fg',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
});

const DropdownMenuLabel = forwardRef(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={cn(
        'px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-fg-subtle',
        className,
      )}
      {...props}
    />
  );
});

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
};
export default DropdownMenu;
