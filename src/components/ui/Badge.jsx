// Tier 11 Chunk 1 — <Badge> primitive. Status pills + count badges.

import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';

const badgeStyles = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.12em]',
  {
    variants: {
      tone: {
        neutral: 'bg-overlay text-fg-muted',
        accent: 'bg-accent/15 text-accent',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
        info: 'bg-info/15 text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const Badge = forwardRef(function Badge({ tone, className, ...props }, ref) {
  return <span ref={ref} className={badgeStyles({ tone, className })} {...props} />;
});

export { Badge, badgeStyles };
export default Badge;
