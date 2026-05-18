// Tier 11 Chunk 2 — ProfileView tokenized. ThemeToggle is mounted in the
// "Account" footer for the editable (own-profile) view so users can pick
// System / Light / Dark.

import { useState } from 'react';
import BadgeWall from './BadgeWall';
import Avatar from './Avatar';
import TwoFactorSetup from './TwoFactorSetup';
import ChangePasswordPanel from './ChangePasswordPanel';
import ThemeToggle from './ThemeToggle';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { displayTeamName } from '../utils/teamNames';
import { Badge, Button, Input, Radio, Textarea } from './ui';

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can view your profile, picks, and badges.',
  },
  {
    value: 'friends',
    label: 'Friends only',
    description: 'Only accepted friends see your profile. Leaderboard rank stays visible.',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Only you (and admins) see your profile. Leaderboard rank stays visible.',
  },
];

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
  const { user, handle2faSetup, handle2faConfirm, handle2faDisable, handleChangePassword } =
    useAuth();
  const { handleSaveProfile: onSaveProfile } = useData();
  const twoFactorEnabled = Boolean(user?.twoFactorEnabled);
  const on2faSetup = handle2faSetup;
  const on2faConfirm = handle2faConfirm;
  const on2faDisable = handle2faDisable;

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');

  if (!profile) return null;

  const winRatePct = Math.round((profile.winRate || 0) * 100);
  const friendBtn = friendButtonProps(profile.friendStatus);
  const showEdit = editable && profile.friendStatus === 'self';

  const startEdit = () => {
    setDisplayName(profile.displayName || '');
    setBio(profile.bio || '');
    setEditing(true);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!onSaveProfile) return;
    await onSaveProfile({
      displayName: displayName.trim(),
      bio: bio.trim(),
    });
    setEditing(false);
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
          {showEdit && !editing ? (
            <Button variant="secondary" onClick={startEdit}>
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

      {editing ? (
        <form onSubmit={submitEdit} className="space-y-3 rounded-3xl bg-overlay/70 p-4">
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            placeholder={profile.username}
          />
          <div>
            <Textarea
              label="Bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Tell people who you are…"
            />
            <span className="mt-1 block text-right text-xs tabular-nums text-fg-subtle">
              {bio.length} / 280
            </span>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : profile.bio ? (
        <p className="whitespace-pre-wrap rounded-3xl bg-overlay/70 p-4 text-sm text-fg">
          {profile.bio}
        </p>
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

      {showEdit ? <ChangePasswordPanel onChangePassword={handleChangePassword} /> : null}

      {showEdit && on2faSetup ? (
        <TwoFactorSetup
          enabled={Boolean(twoFactorEnabled)}
          busy={busy}
          onSetupRequest={on2faSetup}
          onConfirm={on2faConfirm}
          onDisable={on2faDisable}
        />
      ) : null}

      {showEdit ? (
        <div className="rounded-3xl border border-default bg-elevated/70 p-5">
          {/* Stack on narrow viewports — the segmented toggle is ~190px wide
              and forced the row to overflow on iPhone SE. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
                Appearance
              </h3>
              <p className="mt-1 text-sm text-fg">Pick the theme that suits your eyes.</p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      ) : null}

      {/* Tier 8.6 — Privacy panel. Edits flush immediately via PUT /api/me
          (handleSaveProfile); the radio reflects the current value. */}
      {showEdit ? (
        <div className="rounded-3xl border border-default bg-elevated/70 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
            Privacy
          </h3>
          <p className="mt-1 text-sm text-fg">Who can see your profile?</p>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Profile visibility</legend>
            {VISIBILITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                htmlFor={`profile-visibility-${opt.value}`}
                className="flex cursor-pointer items-start gap-3 rounded-2xl bg-overlay/70 p-3 hover:bg-overlay"
              >
                <Radio
                  id={`profile-visibility-${opt.value}`}
                  name="profileVisibility"
                  value={opt.value}
                  checked={(profile.profileVisibility || 'public') === opt.value}
                  disabled={busy}
                  onChange={() => onSaveProfile?.({ profileVisibility: opt.value }).catch(() => {})}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{opt.label}</span>
                  <span className="text-xs text-fg-muted">{opt.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
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
            <p className="text-sm text-fg-subtle">No picks yet.</p>
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
