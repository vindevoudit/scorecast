// Tier 11 Chunk 1 — <Skeleton> primitive. Replaces the ad-hoc per-component
// SkeletonGameCard / SkeletonLeaderboardRow loaders. Chunk 2 will refactor
// the existing skeleton helpers to compose this primitive.

import { cn } from './cn';

function Skeleton({ className, ...props }) {
  return (
    <div
      role="status"
      aria-hidden="true"
      className={cn('animate-pulse rounded-xl bg-overlay/70', className)}
      {...props}
    />
  );
}

export { Skeleton };
export default Skeleton;
