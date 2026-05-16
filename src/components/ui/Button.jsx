// Tier 11 Chunk 1 — <Button> primitive.
//
// Variants cover the existing styles found across the codebase:
//   primary    — cyan-accent fill (the "Sign up" / submit pattern)
//   secondary  — outlined cyan-accent on slate (the "Sign in" / back pattern)
//   ghost      — bare text, hover bg-elevated (sidebar nav, UserMenu)
//   destructive — danger fill (delete / disable confirm)
//   link       — inline text-only with underline-on-hover
//
// Sizes:
//   sm — px-3 py-1.5 text-xs
//   md — px-4 py-2 text-sm (default)
//   lg — px-5 py-3 text-sm
//
// `asChild` lets a single child (e.g. an <a>) inherit Button styling without
// nesting <button> inside <a>. Built on Radix's Slot via cva.

import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';

const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold',
    'transition duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-strong',
        secondary:
          'border border-strong bg-elevated/80 text-accent-soft hover:border-strong hover:bg-elevated hover:text-fg',
        ghost: 'text-fg-muted hover:bg-elevated hover:text-fg',
        destructive: 'bg-danger text-accent-fg hover:opacity-90',
        link: 'rounded-none text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2 text-sm',
        lg: 'px-5 py-3 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

const Button = forwardRef(function Button(
  { variant, size, className, type = 'button', loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : null}
      {children}
    </button>
  );
});

export { Button, buttonStyles };
export default Button;
