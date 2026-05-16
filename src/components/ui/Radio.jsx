// Tier 11 Chunk 1 — <Radio> primitive. Native radio styled to match.

import { forwardRef, useId } from 'react';
import { cn } from './cn';

const Radio = forwardRef(function Radio({ id: idProp, label, className, ...props }, ref) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2', className)}>
      <input
        ref={ref}
        id={id}
        type="radio"
        className={cn(
          'h-4 w-4 border border-default bg-overlay accent-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
        {...props}
      />
      {label ? <span className="text-sm text-fg">{label}</span> : null}
    </label>
  );
});

export { Radio };
export default Radio;
