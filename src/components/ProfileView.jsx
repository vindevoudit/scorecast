// Tier 11 Chunk 2 — ProfileView tokenized.
// Tier 30 Phase 1 Chunk 1.1 — Account/Appearance/Notifications/Privacy
// panels moved to SettingsView (reached via UserMenu → Settings). The
// inline displayName/bio edit form is now an EditProfileModal triggered
// by the "Edit profile" button. ProfileView is read-mostly: identity +
// stats + badges + recent picks.

import { useState } from 'react';
import BadgeWall from './BadgeWall';
import Avatar from './Avatar';
import EditProfileModal from './EditProfileModal';
import { useData } from '../hooks/useData';
import { displayTeamName } from '../utils/teamNames';
import { Badge, Button } from './ui';

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

function ProfileView({ profile, onFriendAction, busy, editable }) {
  const { handleSaveProfile: onSaveProfile } = useData();

  const [editOpen, setEditOpen] = useState(false);

  if (!profile) return null;

  const winRatePct = Math.round((profile.winRate || 0) * 100);
  const friendBtn = friendButtonProps(profile.friendStatus);
  const showEdit = editable && profile.friendStatus === 'self';

  const submitEdit = async (payload) => {
    if (!onSaveProfile) return;
    await onSaveProfile(payload);
    setEditOpen(false);
  };

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

      {/* Bio sits below the header strip; edit happens in the modal so
          the surface stays read-mostly. */}
      {profile.bio ? (
        <p className="whitespace-pre-wrap rounded-3xl bg-overlay/70 p-4 text-sm text-fg">
          {profile.bio}
        </p>
      ) : null}

      {/* Modal mounts unconditionally so its open/close animates cleanly;
          Radix portal only renders Content while `open` is true. */}
      {showEdit ? (
        <EditProfileModal
          open={editOpen}
          profile={profile}
          onSave={submitEdit}
          onCancel={() => setEditOpen(false)}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Total points</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">{profile.totalPoints}</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Picks made</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">{profile.picksMade}</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Picks won</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">{profile.picksWon}</p>
        </div>
        <div className="rounded-3xl bg-overlay/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-fg-muted">Win rate</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">{winRatePct}%</p>
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

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">Badges</h3>
        <div className="mt-3">
          <BadgeWall catalog={profile.catalog} earned={profile.badges} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
          Recent picks
        </h3>
        <div className="mt-3 space-y-2">
          {profile.recentPicks.length === 0 ? (
            <p className="text-sm text-fg-muted">No picks yet.</p>
          ) : (
            profile.recentPicks.map((pick) => {
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
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileView;
