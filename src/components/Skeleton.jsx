// Tier 11 Chunk 2 — per-shape Skeleton helpers. Compose the underlying
// <Skeleton> primitive (ui/Skeleton.jsx) for layout-specific placeholders.

import { Skeleton } from './ui';

export function SkeletonGameCard() {
  return (
    <div aria-hidden="true" className="rounded-3xl border border-default bg-elevated/60 p-5">
      <Skeleton className="h-3 w-32 rounded-full" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-24 rounded-3xl" />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-11 rounded-3xl" />
        <Skeleton className="h-11 rounded-3xl" />
      </div>
    </div>
  );
}

export function SkeletonLeaderboardRow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-between rounded-3xl bg-elevated/50 px-4 py-4"
    >
      <Skeleton className="h-3 w-32 rounded-full" />
      <Skeleton className="h-3 w-10 rounded-full" />
    </div>
  );
}

export function SkeletonCommentRow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-start gap-3 rounded-2xl border border-default bg-elevated/50 p-4"
    >
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-3 w-3/4 rounded-full" />
      </div>
    </div>
  );
}
