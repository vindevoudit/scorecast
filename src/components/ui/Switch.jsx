// Tier 11 Chunk 1 — <Switch> primitive. Native checkbox under the hood for
// form / a11y compatibility; visually a toggle. Both track + thumb are
// siblings of the input so Tailwind's `peer-checked:` modifier applies.

import { forwardRef, useId } from 'react';
import { cn } from './cn';

const Switch = forwardRef(function Switch(
  { id: idProp, checked, defaultChecked, onChange, label, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-2', className)}>
      <span className="relative inline-flex h-5 w-9 items-center">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={onChange}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-full bg-overlay transition duration-200',
            'peer-checked:bg-accent',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-0.5 h-4 w-4 rounded-full bg-elevated transition-transform duration-200',
            'peer-checked:translate-x-4',
          )}
        />
      </span>
      {label ? <span className="text-sm text-fg">{label}</span> : null}
    </label>
  );
});

export { Switch };
export default Switch;
