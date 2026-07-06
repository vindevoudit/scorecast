// Tier 11 Chunk 2 — ProfileView tokenized.
// Tier 30 Phase 1 Chunk 1.1 — Account/Appearance/Notifications/Privacy
// panels moved to SettingsView (reached via UserMenu → Settings). The
// inline displayName/bio edit form is now an EditProfileModal triggered
// by the "Edit profile" button.
// Tier 30 Phase 1 Chunk 1.3 — body decomposed into Overview / Badges /
// Activity sub-tabs via the shared SubTabs primitive. Header (identity +
// edit button + friend action) stays above the sub-tabs since it isn't
// section-scoped.

import { lazy, Suspense, useState } from 'react';
import BadgeWall from './BadgeWall';
import Avatar from './Avatar';
import EditProfileModal from './EditProfileModal';
import EmptyState from './EmptyState';
import SubTabs from './SubTabs';
import { useData } from '../hooks/useData';
import { displayTeamName } from '../utils/teamNames';
import { Badge, Button } from './ui';

// Tier 30 Phase 3 C1 — Personal stats dashboard. React.lazy keeps the
// recharts 'charts' chunk (~15 KB gzip) out of the Profile tab's eager
// bundle; it only ships when the user clicks the Stats sub-tab.
const StatsDashboard = lazy(() => import('./StatsDashboard'));

// Trophy Cabinet — lazy-loaded so its chunk only ships when the sub-tab is
// opened. Shared with the sidebar TrophyCabinetView (Vite dedupes the chunk).
// Unlike Stats (self-only), the Cabinet mounts on ANY profile — the backend
// route already 404s a hidden profile before the fetch resolves.
const TrophyCabinet = lazy(() => import('./TrophyCabinet'));

// Tier 22 — TwoFactorSetup was removed. See routes/auth.js header for the
// revival recipe; this file's diff in the removal commit shows the original
// mount + handler wiring.

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium' });
}

function recentPickStatus(pick) {
  if (!pick.result) return { label: 'Pending', tone: 'neutral' };
  if (pick.result === 'draw') return { label: `Drew +${pick.points}`, tone: 'warning' };
  if (pick.choice === pick.result) {
    return { label: `Won +${pick.points}`, tone: 'success' };
  }
  return { label: 'Missed', tone: 'danger' };
}

function friendButtonProps(friendStatus) {
  switch (friendStatus) {
    case 'none':
      return { label: 'Add friend', action: 'request' };
    case 'pending-out':
      return { label: 'Cancel request', action: 'cancel' };
    case 'pending-in':
      return { label: 'Accept request', action: 'accept' };
    case 'friends':
      return { label: 'Unfriend', action: 'unfriend' };
    default:
      return null;
  }
}

// --- Sub-tab content sections ---------------------------------------------

function OverviewSection({ profile }) {
  const winRatePct = Math.round((profile.winRate || 0) * 100);
  const bestStreak = profile.streak?.longest ?? 0;
  // Tier 30 Phase 3 C1 follow-up — Orbitron (.font-led) on the stat
  // numerals so the Overview reads in the same scoreboard typography
  // as the StatsDashboard tiles. Headings keep the default UI font.
  const valueClass = 'mt-2 font-led text-2xl tabular-nums text-fg';
  return (
    <div className="space-y-5">
      {profile.bio ? (
        <p className="whitespace-pre-wrap rounded-3xl bg-overlay/70 p-4 text-sm text-fg">
          {profile.bio}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Total points</p>
          <p className={valueClass}>{profile.totalPoints}</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Picks made</p>
          <p className={valueClass}>{profile.picksMade}</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Picks won</p>
          <p className={valueClass}>{profile.picksWon}</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Win rate</p>
          <p className={valueClass}>{winRatePct}%</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Best streak</p>
          <p className={valueClass}>{bestStreak}</p>
        </div>
      </div>

      {profile.headToHead ? (
        <div className="rounded-3xl border border-default bg-elevated/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Head-to-head</p>
          <p className="mt-2 text-sm text-fg">
            You {profile.headToHead.viewerWins} — {profile.headToHead.targetWins}{' '}
            {profile.displayName || profile.username}
            {profile.headToHead.ties > 0
              ? ` (${profile.headToHead.ties} tie${profile.headToHead.ties === 1 ? '' : 's'})`
              : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function BadgesSection({ profile }) {
  // Tier 30 Phase 3 A2 — badgeProgress is only populated on self-view.
  // Passing it through unconditionally is safe: BadgeWall ignores it when
  // null, so other users' profiles still render plain earned/locked.
  return (
    <BadgeWall catalog={profile.catalog} earned={profile.badges} progress={profile.badgeProgress} />
  );
}

function ActivitySection({ profile }) {
  if (profile.recentPicks.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Make your first pick on the Matches tab — it'll show up here."
      />
    );
  }
  return (
    <div className="space-y-2">
      {profile.recentPicks.map((pick) => {
        const status = recentPickStatus(pick);
        const team = displayTeamName(pick.choice === 'home' ? pick.homeTeam : pick.awayTeam);
        return (
          <div
            key={pick.gameId}
            className="flex items-center justify-between gap-3 rounded-2xl bg-overlay/70 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-fg">
                {displayTeamName(pick.homeTeam)} <span className="text-fg-subtle">vs</span>{' '}
                {displayTeamName(pick.awayTeam)}
              </p>
              <p className="text-xs text-fg-subtle">
                Picked {team} · {formatDate(pick.date)}
              </p>
            </div>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        );
      })}
    </div>
  );
}

function ProfileView({ profile, onFriendAction, busy, editable }) {
  const { handleSaveProfile: onSaveProfile } = useData();

  const [editOpen, setEditOpen] = useState(false);

  if (!profile) return null;

  const friendBtn = friendButtonProps(profile.friendStatus);
  const showEdit = editable && profile.friendStatus === 'self';

  const submitEdit = async (payload) => {
    if (!onSaveProfile) return;
    await onSaveProfile(payload);
    setEditOpen(false);
  };

  // Tier 30 Phase 1 used "Overview" as the default tab id; "Summary" is
  // shorter so the 4-tab row (Summary / Badges / Activity / Stats) fits on
  // a 360 px viewport without horizontal scroll. Old links carrying
  // `?tab=overview` fall through SubTabs' defaultValue fallback to
  // `'summary'`, so this is a safe rename.
  const tabs = [
    { value: 'summary', label: 'Summary', content: <OverviewSection profile={profile} /> },
    { value: 'badges', label: 'Badges', content: <BadgesSection profile={profile} /> },
    { value: 'activity', label: 'Activity', content: <ActivitySection profile={profile} /> },
    {
      value: 'cabinet',
      label: 'Cabinet',
      content: (
        <Suspense
          fallback={
            <p className="rounded-3xl border border-default bg-elevated/40 px-4 py-8 text-center text-sm text-fg-muted">
              Loading trophy cabinet…
            </p>
          }
        >
          <TrophyCabinet username={profile.username} />
        </Suspense>
      ),
    },
  ];
  // Stats sub-tab is self-only — the StatsService gate scopes to the calling
  // user, and we don't want to expose another user's pick history through
  // a public profile view.
  if (profile.friendStatus === 'self') {
    tabs.push({
      value: 'stats',
      label: 'Stats',
      content: (
        <Suspense
          fallback={
            <p className="rounded-3xl border border-default bg-elevated/40 px-4 py-8 text-center text-sm text-fg-muted">
              Loading stats…
            </p>
          }
        >
          <StatsDashboard />
        </Suspense>
      ),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar username={profile.username} size={64} />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.25em] text-accent/80">Profile</p>
            <h2 className="mt-2 truncate text-3xl font-semibold text-fg">
              {profile.displayName || profile.username}
            </h2>
            {profile.displayName ? (
              <p className="truncate text-sm text-fg-muted">@{profile.username}</p>
            ) : null}
            <p className="mt-1 text-sm text-fg-muted">
              {profile.role === 'admin' ? (
                <Badge tone="warning" className="mr-2">
                  Admin
                </Badge>
              ) : null}
              Joined {formatDate(profile.joinedAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {showEdit ? (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit profile
            </Button>
          ) : null}
          {friendBtn ? (
            <Button
              variant="primary"
              size="lg"
              disabled={busy}
              onClick={() => onFriendAction?.(friendBtn.action)}
              className="shrink-0"
            >
              {friendBtn.label}
            </Button>
          ) : null}
        </div>
      </div>

      {showEdit ? (
        <EditProfileModal
          open={editOpen}
          profile={profile}
          onSave={submitEdit}
          onCancel={() => setEditOpen(false)}
        />
      ) : null}

      <SubTabs tabs={tabs} defaultValue="summary" ariaLabel="Profile sections" />
    </div>
  );
}

export default ProfileView;
