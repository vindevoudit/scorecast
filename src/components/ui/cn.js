// Minimal class-name joiner. Keeps the primitive lib free of an extra
// `clsx` dep — `cva` already includes its own joining helper, but for
// non-cva primitives we want a simple `cn('a', cond && 'b', other)`.
export function cn(...args) {
  return args.filter(Boolean).join(' ');
}
