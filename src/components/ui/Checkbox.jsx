// Tier 11 Chunk 1 — <Checkbox> primitive. Native checkbox styled to match
// the rest of the form vocabulary.

import { forwardRef, useId } from 'react';
import { cn } from './cn';

const Checkbox = forwardRef(function Checkbox({ id: idProp, label, className, ...props }, ref) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border border-default bg-overlay accent-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
        {...props}
      />
      {label ? <span className="text-sm text-fg">{label}</span> : null}
    </label>
  );
});

export { Checkbox };
export default Checkbox;
