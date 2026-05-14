import { SkeletonGameCard, SkeletonLeaderboardRow } from '../components/Skeleton';

// Tier 13 Chunk 6 — placeholder shown while the initial dashboard fetch
// is in flight (bootDone === false, or a refresh that wipes games).
function SkeletonView() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]" aria-busy="true">
      <div className="space-y-4">
        <SkeletonGameCard />
        <SkeletonGameCard />
        <SkeletonGameCard />
      </div>
      <div className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/85 p-6">
        <SkeletonLeaderboardRow />
        <SkeletonLeaderboardRow />
        <SkeletonLeaderboardRow />
        <SkeletonLeaderboardRow />
      </div>
    </div>
  );
}

export default SkeletonView;
