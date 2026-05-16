// Tier 11 Chunk 1 — <Popover> primitive. Wraps @radix-ui/react-popover.

import { forwardRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from './cn';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = forwardRef(function PopoverContent(
  { className, align = 'center', sideOffset = 8, ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-2xl border border-default bg-elevated p-4 shadow-glow',
          'focus:outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
export default Popover;
