// <PasswordInput> primitive — mirrors <Input> with a Show/Hide toggle button
// pinned to the top-right of the field row. Keeps the same label / helper /
// error / aria-describedby composition so it's a drop-in for any password
// field.

import { forwardRef, useId, useState } from 'react';
import { cn } from './cn';

const PasswordInput = forwardRef(function PasswordInput(
  { id: idProp, label, helper, error, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const helperId = helper || error ? `${id}-desc` : undefined;
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted"
          >
            {label}
          </label>
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="rounded text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
      ) : null}
      <input
        ref={ref}
        id={id}
        type={visible ? 'text' : 'password'}
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

export { PasswordInput };
export default PasswordInput;
