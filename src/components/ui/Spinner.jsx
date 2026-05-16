// Tier 11 Chunk 1 — <Spinner> primitive. Simple aria-labeled spinner for
// inline / page-level loading states.

import { cn } from './cn';

function Spinner({ className, size = 'md', label = 'Loading', ...props }) {
  const dims =
    size === 'sm' ? 'h-3 w-3 border-2' : size === 'lg' ? 'h-6 w-6 border-2' : 'h-4 w-4 border-2';
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-r-transparent',
        dims,
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
export default Spinner;
