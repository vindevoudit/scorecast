// Tier 11 Chunk 1 — <Input> primitive.
//
// Wraps the bare HTML input with label + helper + error slot composition.
// When `id` is omitted, a stable random id is generated so the <label>
// htmlFor still binds. Forwards ref so RHF / focus management work.

import { forwardRef, useId } from 'react';
import { cn } from './cn';

const Input = forwardRef(function Input(
  { id: idProp, label, helper, error, className, type = 'text', ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const helperId = helper || error ? `${id}-desc` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted"
        >
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={id}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={helperId}
        className={cn(
          'rounded-2xl border border-default bg-overlay/60 px-4 py-2.5 text-sm text-fg placeholder:text-fg-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          error ? 'border-danger' : '',
          className,
        )}
        {...props}
      />
      {helper || error ? (
        <p id={helperId} className={cn('text-xs', error ? 'text-danger' : 'text-fg-subtle')}>
          {error || helper}
        </p>
      ) : null}
    </div>
  );
});

export { Input };
export default Input;
