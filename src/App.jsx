import { lazy, Suspense, useMemo, useState } from 'react';
import GameCard from './components/GameCard';
import LeaderboardCard, { LeaderboardRow } from './components/LeaderboardCard';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import ForgotPasswordForm from './components/ForgotPasswordForm';
import ResetPasswordForm from './components/ResetPasswordForm';
import TwoFactorChallenge from './components/TwoFactorChallenge';
import GroupCard from './components/GroupCard';
import GroupLeaderboardCard from './components/GroupLeaderboardCard';
import ConfirmModal from './components/ConfirmModal';
import EmptyState from './components/EmptyState';
import { SkeletonGameCard, SkeletonLeaderboardRow } from './components/Skeleton';
import ProfileDrawer from './components/ProfileDrawer';
import FriendsList from './components/FriendsList';
import NotificationBell from './components/NotificationBell';
import SearchBar from './components/SearchBar';

import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import { useNotifications } from './hooks/useNotifications';
import { useGames } from './hooks/useGames';
import { usePicks } from './hooks/usePicks';

const PicksHistory = lazy(() => import('./components/PicksHistory'));
const ProfileView = lazy(() => import('./components/ProfileView'));
const AdminPanel = lazy(() => import('./components/admin/AdminPanel'));

function LazyFallback({ label = 'Loading…' }) {
  return <p className="text-sm text-slate-400">{label}</p>;
}

const BASE_TABS = [
  { id: 'games', kicker: 'Games', label: 'Upcoming Matches' },
  { id: 'mypicks', kicker: 'My Picks', label: 'Your History' },
  { id: 'groups', kicker: 'Groups', label: 'My Groups' },
  { id: 'leaderboard', kicker: 'Leaderboards', label: 'Rankings' },
  { id: 'profile', kicker: 'Profile', label: 'Your Stats' },
];
const ADMIN_TAB = { id: 'admin', kicker: 'Admin', label: 'Manage' };

function App() {
  const {
    user,
    authData,
    setAuthData,
    authView,
    setAuthView,
    forgotSent,
    setForgotSent,
    confirmingLogout,
    setConfirmingLogout,
    handleLogin: authLogin,
    handleRegister: authRegister,
    handleForgotPassword,
    handleResetPassword,
    handle2faVerify: auth2faVerify,
    handle2faSetup,
    handle2faConfirm,
    handle2faDisable,
    performLogout,
    initialAuthData,
  } = useAuth();

  const {
    request,
    bootDone,
    loading,
    view,
    setView,
    groups,
    pendingInvites,
    leaderboard,
    groupOrderBy,
    groupOffset,
    groupLimit,
    selectedGroupId,
    friends,
    discoverGroups,
    ownProfile,
    profileUsername,
    profile,
    profileLoading,
    profileBusy,
    handleCreateGroup,
    handleLeaveGroup,
    handleTransferGroup,
    handleDeleteGroup,
    handleJoinPublicGroup,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,
    handleSendFriendRequest,
    handleAcceptFriend,
    handleDeclineFriend,
    handleUnfriend,
    openProfile,
    closeProfile,
    handleFriendAction,
    handleSaveProfile,
    handleChangeGroupOrder,
    handleChangeGroupOffset,
    handleGroupSelection,
    refreshGames,
    refreshPicks,
    refreshLeaderboard,
    loadDashboard,
  } = useData();

  // Compose auth handlers with loadDashboard so post-login the dashboard
  // boots immediately. AuthContext only manages the user JWT; DataContext
  // owns the data fetch — the two cross paths here in the consumer.
  const handleLogin = async (event) => {
    const result = await authLogin(event);
    if (result?.user) {
      await loadDashboard().catch(() => {});
    }
  };

  const handleRegister = async (event) => {
    const result = await authRegister(event);
    if (result?.user) {
      await loadDashboard().catch(() => {});
    }
  };

  const handle2faVerify = async (payload) => {
    const result = await auth2faVerify(payload);
    if (result?.user) {
      await loadDashboard().catch(() => {});
    }
  };

  const { status, showStatus } = useNotifications();
  const { games, upcomingGames, liveGames, completedGames } = useGames();
  const { picks, pickMap, submitPick, removePick } = usePicks();

  const tabs = useMemo(
    () => (user?.role === 'admin' ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS),
    [user?.role],
  );

  const showCompleted = useShowCompletedToggle();
  const handleCommentError = (message) => {
    if (message && message !== 'Session expired') showStatus(message);
  };

  // Hoist the Create-Group form submit into a small adapter so the form
  // continues to take an event (e.preventDefault) but routes the body
  // through DataContext.handleCreateGroup.
  const onCreateGroupSubmit = async (event) => {
    event.preventDefault();
    await handleCreateGroup({ name: authData.groupName, visibility: authData.groupVisibility });
    setAuthData((prev) => ({ ...prev, groupName: '', groupVisibility: 'private' }));
  };

  const renderGameSection = (heading, list, emptyText) => (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
        {heading}
      </h3>
      {list.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        list.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            existingPick={pickMap.get(game.id)}
            onPickSubmit={submitPick}
            onPickRemove={removePick}
            currentUserId={user?.id}
            request={request}
            onError={handleCommentError}
          />
        ))
      )}
    </div>
  );

  const dashboard = (
    <div className="space-y-6" aria-busy={loading}>
      <section className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.55)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-400/80">Bantryx</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold text-white sm:text-4xl">
              Football predictions with groups, invites, and probability-based scoring.
            </h1>
          </div>
          <div className="rounded-3xl bg-slate-950/90 px-5 py-4 shadow-inner shadow-slate-950/20">
            <p className="text-sm text-slate-400">Logged in as</p>
            <p className="mt-1 text-xl font-semibold text-white">{user?.username}</p>
            <p className="mt-2 text-sm text-slate-400">
              Joined groups: {user?.joinedGroups?.length || 0}
            </p>
            {pendingInvites.length > 0 && (
              <p className="mt-2 text-sm text-amber-300">
                Pending invites: {pendingInvites.length}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div
          className="-mx-1 flex flex-1 gap-3 overflow-x-auto px-1 pb-1"
          role="tablist"
          aria-label="Dashboard sections"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={view === tab.id}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
              className={`min-w-[10rem] shrink-0 rounded-3xl border px-5 py-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${view === tab.id ? 'border-cyan-400 bg-cyan-500/10 text-white shadow-[0_10px_30px_rgba(6,182,212,0.18)]' : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-900/95'}`}
            >
              <span className="block text-sm uppercase tracking-[0.24em] text-slate-400">
                {tab.kicker}
              </span>
              <span className="mt-2 block text-lg font-semibold text-white">{tab.label}</span>
            </button>
          ))}
        </div>

        <SearchBar
          request={request}
          onSelectUser={openProfile}
          onSelectGroup={async (g) => {
            if (g.isMember) {
              setView('groups');
            } else if (g.visibility === 'public') {
              await handleJoinPublicGroup(g.id);
              setView('groups');
            }
          }}
          onSelectGame={() => setView('games')}
          onError={handleCommentError}
        />

        <NotificationBell request={request} onError={handleCommentError} />

        <button
          onClick={() => setConfirmingLogout(true)}
          className="inline-flex shrink-0 items-center justify-center rounded-3xl bg-slate-800 px-6 py-4 text-sm font-semibold text-cyan-300 transition duration-300 hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Logout
        </button>
      </section>

      <section className="space-y-6">
        {view === 'games' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold text-white">Games</h2>
                    <p className="mt-2 text-slate-400">
                      Pick winners, earn more points for underdog upsets.
                    </p>
                  </div>
                  <span className="rounded-full bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300">
                    Future-proof picks only
                  </span>
                </div>
              </div>

              {liveGames.length > 0 && renderGameSection('Live now', liveGames, '')}

              {renderGameSection(
                'Upcoming',
                upcomingGames,
                'No upcoming games yet. Check back soon.',
              )}

              {completedGames.length > 0 && (
                <CompletedSection
                  completedGames={completedGames}
                  pickMap={pickMap}
                  submitPick={submitPick}
                  request={request}
                  currentUserId={user?.id}
                  onError={handleCommentError}
                  showCompleted={showCompleted.value}
                  setShowCompleted={showCompleted.set}
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.4)]">
                <h2 className="text-2xl font-semibold text-white">Live leaderboard</h2>
                <p className="mt-2 text-slate-400">Track your progress and compare with friends.</p>
                <div className="mt-5 space-y-4">
                  <div className="rounded-3xl bg-slate-950/70 p-4">
                    <h3 className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">
                      Overall
                    </h3>
                    <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                      {leaderboard.overall.length === 0 ? (
                        <p className="text-sm text-slate-400">No data yet.</p>
                      ) : (
                        leaderboard.overall.map((entry, index) => (
                          <LeaderboardRow
                            key={entry.userId}
                            entry={entry}
                            rank={index + 1}
                            isCurrentUser={entry.userId === user?.id}
                            onSelectUser={openProfile}
                          />
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-3xl bg-slate-950/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">
                          Group leaderboard
                        </h3>
                        <p className="mt-2 text-sm text-slate-400">
                          Select one group to view its ranking.
                        </p>
                      </div>
                      {groups.length > 0 ? (
                        <label className="sm:w-auto">
                          <span className="sr-only">Choose group</span>
                          <select
                            value={selectedGroupId}
                            onChange={handleGroupSelection}
                            className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400 sm:w-auto"
                          >
                            {groups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p className="text-sm text-slate-500">
                          Join or create a group to see member rankings.
                        </p>
                      )}
                    </div>
                    <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                      {leaderboard.group.length === 0 ? (
                        <p className="text-sm text-slate-400">No group leaderboard data yet.</p>
                      ) : (
                        leaderboard.group.map((entry, index) => (
                          <LeaderboardRow
                            key={entry.userId}
                            entry={entry}
                            rank={index + 1}
                            isCurrentUser={entry.userId === user?.id}
                            onSelectUser={openProfile}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'mypicks' && (
          <Suspense fallback={<LazyFallback label="Loading your picks…" />}>
            <PicksHistory picks={picks} games={games} />
          </Suspense>
        )}

        {view === 'groups' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.95fr)]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
              <h2 className="text-2xl font-semibold text-white">Create a new group</h2>
              <p className="mt-2 text-slate-400">
                Invite friends and compare scores in your private pool.
              </p>
              <form onSubmit={onCreateGroupSubmit} className="mt-6 space-y-4">
                <label htmlFor="group-name" className="sr-only">
                  Group name
                </label>
                <input
                  id="group-name"
                  value={authData.groupName}
                  onChange={(event) =>
                    setAuthData((prev) => ({ ...prev, groupName: event.target.value }))
                  }
                  placeholder="Group name"
                  className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
                />
                <fieldset className="rounded-3xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                  <legend className="px-2 text-xs uppercase tracking-[0.25em] text-slate-400">
                    Visibility
                  </legend>
                  <div className="flex flex-wrap gap-3 pt-2 text-sm text-slate-200">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="group-visibility"
                        value="private"
                        checked={authData.groupVisibility === 'private'}
                        onChange={() =>
                          setAuthData((prev) => ({ ...prev, groupVisibility: 'private' }))
                        }
                      />
                      Private (invite-only)
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="group-visibility"
                        value="public"
                        checked={authData.groupVisibility === 'public'}
                        onChange={() =>
                          setAuthData((prev) => ({ ...prev, groupVisibility: 'public' }))
                        }
                      />
                      Public (discoverable)
                    </label>
                  </div>
                </fieldset>
                <button
                  type="submit"
                  className="inline-flex rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  Create group
                </button>
              </form>

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
                  Discover public groups
                </h3>
                {discoverGroups.length === 0 ? (
                  <EmptyState
                    title="No public groups right now"
                    description="Check back later, or invite friends to a private group."
                  />
                ) : (
                  discoverGroups.map((group) => (
                    <div
                      key={group.id}
                      className="flex flex-col gap-3 rounded-2xl bg-slate-950/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{group.name}</p>
                        <p className="text-xs text-slate-400">
                          {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleJoinPublicGroup(group.id)}
                        className="rounded-2xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                      >
                        Join
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-6">
                <FriendsList
                  friends={friends.friends}
                  incoming={friends.incoming}
                  outgoing={friends.outgoing}
                  onSendRequest={handleSendFriendRequest}
                  onAccept={handleAcceptFriend}
                  onDecline={handleDeclineFriend}
                  onCancel={handleUnfriend}
                  onUnfriend={handleUnfriend}
                  onSelectUser={openProfile}
                />
              </div>
            </div>

            <div className="space-y-4">
              {pendingInvites.length > 0 && (
                <div className="rounded-3xl border border-amber-800/50 bg-amber-950/30 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.32)]">
                  <h2 className="text-2xl font-semibold text-white">Pending Invitations</h2>
                  <p className="mt-2 text-sm text-amber-200/80">
                    You have {pendingInvites.length} pending group invitation
                    {pendingInvites.length !== 1 ? 's' : ''}.
                  </p>
                  <div className="mt-4 space-y-3">
                    {pendingInvites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex flex-col gap-3 rounded-3xl bg-slate-950/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-slate-300">Invited to join</p>
                          <p className="mt-1 truncate font-semibold text-white">
                            {invite.groupName}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAcceptInvite(invite.groupId, invite.id)}
                            className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleDeclineInvite(invite.groupId, invite.id)}
                            className="rounded-2xl border border-slate-600 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-300 transition duration-300 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {groups.length === 0 ? (
                <EmptyState
                  title="No groups yet"
                  description="Create your first group on the left, or accept an invite when one arrives."
                />
              ) : (
                groups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    currentUserId={user?.id}
                    onInvite={handleInvite}
                    onLeave={handleLeaveGroup}
                    onTransfer={handleTransferGroup}
                    onDelete={handleDeleteGroup}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {view === 'profile' && (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
            {!ownProfile ? (
              <p className="text-sm text-slate-400">Loading your profile…</p>
            ) : (
              <Suspense fallback={<LazyFallback label="Loading profile…" />}>
                <ProfileView
                  profile={ownProfile}
                  editable
                  onSaveProfile={handleSaveProfile}
                  twoFactorEnabled={Boolean(user?.twoFactorEnabled)}
                  on2faSetup={handle2faSetup}
                  on2faConfirm={handle2faConfirm}
                  on2faDisable={handle2faDisable}
                />
              </Suspense>
            )}
          </div>
        )}

        {view === 'leaderboard' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <LeaderboardCard
              title="Overall Leaderboard"
              entries={leaderboard.overall}
              currentUserId={user?.id}
              onSelectUser={openProfile}
            />
            <GroupLeaderboardCard
              groups={groups}
              selectedGroupId={selectedGroupId}
              onGroupSelection={handleGroupSelection}
              leaderboardGroup={leaderboard.group}
              currentUserId={user?.id}
              onSelectUser={openProfile}
              groupMeta={leaderboard.groupMeta}
              orderBy={groupOrderBy}
              offset={groupOffset}
              limit={groupLimit}
              onChangeOrder={handleChangeGroupOrder}
              onChangeOffset={handleChangeGroupOffset}
            />
          </div>
        )}

        {view === 'admin' && user?.role === 'admin' && (
          <Suspense fallback={<LazyFallback label="Loading admin panel…" />}>
            <AdminPanel
              request={request}
              currentUserId={user?.id}
              onAfterGameChange={async () => {
                await Promise.all([refreshGames(), refreshPicks(), refreshLeaderboard()]);
              }}
              onError={(msg) => msg && msg !== 'Session expired' && showStatus(msg)}
              onSuccess={(msg) => msg && showStatus(msg)}
            />
          </Suspense>
        )}
      </section>

      <ConfirmModal
        open={confirmingLogout}
        title="Log out of Bantryx?"
        description="You'll need to sign back in to make picks or view your leaderboards."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        onConfirm={performLogout}
        onCancel={() => setConfirmingLogout(false)}
      />

      <ProfileDrawer
        open={Boolean(profileUsername)}
        profile={profile}
        loading={profileLoading}
        busy={profileBusy}
        onClose={closeProfile}
        onFriendAction={handleFriendAction}
      />
    </div>
  );

  const authPanel =
    authView === 'twofa' ? (
      <TwoFactorChallenge
        onSubmit={handle2faVerify}
        onCancel={() => {
          setAuthView('auth');
          setAuthData(initialAuthData);
        }}
      />
    ) : authView === 'reset' ? (
      <div className="mx-auto max-w-lg">
        <ResetPasswordForm
          authData={authData}
          setAuthData={setAuthData}
          onSubmit={handleResetPassword}
          onCancel={() => {
            setAuthData((prev) => ({ ...prev, resetPassword: '', resetToken: '' }));
            setAuthView('auth');
          }}
        />
      </div>
    ) : authView === 'forgot' ? (
      <div className="mx-auto max-w-lg">
        <ForgotPasswordForm
          authData={authData}
          setAuthData={setAuthData}
          onSubmit={handleForgotPassword}
          sent={forgotSent}
          onCancel={() => {
            setForgotSent(false);
            setAuthData((prev) => ({ ...prev, forgotEmail: '' }));
            setAuthView('auth');
          }}
        />
      </div>
    ) : (
      <div className="grid gap-6 lg:grid-cols-2">
        <LoginForm
          authData={authData}
          setAuthData={setAuthData}
          onSubmit={handleLogin}
          onForgotPassword={() => {
            setForgotSent(false);
            setAuthView('forgot');
          }}
        />
        <RegisterForm authData={authData} setAuthData={setAuthData} onSubmit={handleRegister} />
      </div>
    );

  const skeletonView = (
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_48%),linear-gradient(180deg,_#020617_0%,_#050b18_100%)] px-4 py-10 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-400/80">Bantryx</p>
              <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Join groups, make picks, and climb the leaderboards!
              </h1>
              <p className="mt-4 max-w-2xl text-slate-400 sm:text-lg">
                Pick your match winners, compete against your friends and the world, earn points for
                risky calls and underdog upsets, and see how you stack up on the live leaderboards.
                It's football prediction made social, competitive, and fun!
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-5 text-center shadow-[0_24px_80px_rgba(15,23,42,0.4)]">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Predict & Win</p>
              <p className="mt-3 text-2xl font-semibold text-white">Bantryx</p>
              <p className="mt-2 text-sm text-slate-400">
                Pick smart, earn points, dominate leaderboards.
              </p>
            </div>
          </div>

          {status && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-3xl border border-cyan-500/30 bg-slate-950/90 px-5 py-4 text-sm text-cyan-200 shadow-[0_20px_60px_rgba(6,182,212,0.12)] transition duration-300"
            >
              {status}
            </div>
          )}
        </div>

        {!bootDone || (loading && (!user || games.length === 0))
          ? skeletonView
          : user
            ? dashboard
            : authPanel}
      </div>
    </div>
  );
}

// Small local hook for the "show completed games" toggle. Living inline
// keeps it scoped to the games view; doesn't justify a context entry.
function useShowCompletedToggle() {
  const [value, set] = useState(false);
  return { value, set: (next) => set((prev) => (typeof next === 'function' ? next(prev) : next)) };
}

function CompletedSection({
  completedGames,
  pickMap,
  submitPick,
  request,
  currentUserId,
  onError,
  showCompleted,
  setShowCompleted,
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setShowCompleted((prev) => !prev)}
        className="w-full rounded-3xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-left text-sm font-semibold uppercase tracking-[0.24em] text-slate-300 transition duration-200 hover:border-slate-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        aria-expanded={showCompleted}
      >
        {showCompleted ? 'Hide' : 'Show'} {completedGames.length} completed
      </button>
      {showCompleted &&
        completedGames.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            existingPick={pickMap.get(game.id)}
            onPickSubmit={submitPick}
            currentUserId={currentUserId}
            request={request}
            onError={onError}
          />
        ))}
    </div>
  );
}

export default App;
