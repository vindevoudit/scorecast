// Tier 11 Chunk 1 — <Tooltip> primitive. Wraps @radix-ui/react-tooltip.
//
// Usage:
//   <TooltipProvider>
//     <Tooltip>
//       <TooltipTrigger asChild><button>...</button></TooltipTrigger>
//       <TooltipContent>Hint text</TooltipContent>
//     </Tooltip>
//   </TooltipProvider>
//
// TooltipProvider is best mounted near the app root so all tooltips share
// a single delay-timing context.

import { forwardRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = forwardRef(function TooltipContent(
  { className, sideOffset = 6, ...props },
  ref,
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-xl border border-default bg-elevated px-3 py-1.5 text-xs text-fg shadow-glow',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
export default Tooltip;
