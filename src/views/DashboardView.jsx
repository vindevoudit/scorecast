import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import GameCard from '../components/GameCard';
import LeaderboardCard, { LeaderboardRow } from '../components/LeaderboardCard';
import GroupCard from '../components/GroupCard';
import GroupLeaderboardCard from '../components/GroupLeaderboardCard';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import ProfileDrawer from '../components/ProfileDrawer';
import FriendsList from '../components/FriendsList';
import NotificationBell from '../components/NotificationBell';
import SearchBar from '../components/SearchBar';
import Sidebar from '../components/Sidebar';
import UserMenu from '../components/UserMenu';
import InlineGatePanel from '../components/InlineGatePanel';
import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';
import { useData } from '../hooks/useData';
import { useGames } from '../hooks/useGames';

const PicksHistory = lazy(() => import('../components/PicksHistory'));
const ProfileView = lazy(() => import('../components/ProfileView'));
const AdminPanel = lazy(() => import('../components/admin/AdminPanel'));

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

// Tier 13 Chunk 6 — the authenticated UI. Was inline in App.jsx; extracted
// here so App.jsx is purely the layout chrome + the auth/skeleton/dashboard
// switch. Everything else flows from the contexts the file sits inside.
function DashboardView() {
  const {
    user,
    authData,
    setAuthData,
    setConfirmingLogout,
    confirmingLogout,
    performLogout,
    setBrowseAsGuest,
    setShowAuth,
  } = useAuth();
  const { gate } = useAuthGate();
  const {
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
    discoverGroups,
    ownProfile,
    picks,
    handleCreateGroup,
    handleLeaveGroup,
    handleTransferGroup,
    handleDeleteGroup,
    handleJoinPublicGroup,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,
    openProfile,
    handleChangeGroupOrder,
    handleChangeGroupOffset,
    handleGroupSelection,
  } = useData();
  const { games, upcomingGames, liveGames, completedGames } = useGames();

  const tabs = useMemo(() => {
    if (!user) {
      // Anonymous visitors: hide private tabs (My Picks, Profile) and Admin.
      // Only Games / Groups / Rankings make sense without an account.
      return BASE_TABS.filter(
        (t) => t.id === 'games' || t.id === 'groups' || t.id === 'leaderboard',
      );
    }
    return user.role === 'admin' ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;
  }, [user]);
  const [showCompleted, setShowCompleted] = useState(false);

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('sc_sidebar_collapsed') === '1';
  });
  useEffect(() => {
    window.localStorage.setItem('sc_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hoist the Create-Group form submit into a small adapter so the form
  // keeps its event signature but routes the body through DataContext.
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
        list.map((game) => <GameCard key={game.id} game={game} />)
      )}
    </div>
  );

  return (
    <div className="flex min-h-[calc(100vh-3rem)] gap-4 lg:gap-6" aria-busy={loading}>
      <Sidebar
        tabs={tabs}
        activeView={view}
        onSelectView={setView}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-slate-300 transition-colors duration-200 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 md:hidden"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <SearchBar
              onSelectGroup={async (g) => {
                if (g.isMember) {
                  setView('groups');
                } else if (g.visibility === 'public') {
                  if (!gate('join a group')) return;
                  await handleJoinPublicGroup(g.id);
                  setView('groups');
                }
              }}
              onSelectGame={() => setView('games')}
            />
          </div>

          <h2
            aria-hidden="true"
            className="select-none text-sm font-normal uppercase tracking-[0.35em] text-cyan-400/80"
            style={{
              textShadow:
                '0 0 12px rgba(56, 189, 248, 0.9), 0 0 24px rgba(56, 189, 248, 0.65), 0 0 48px rgba(56, 189, 248, 0.4)',
            }}
          >
            BANTRYX
          </h2>

          <div className="flex items-center justify-end gap-3">
            {user ? (
              <>
                <NotificationBell />
                <UserMenu />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setBrowseAsGuest(false);
                    setShowAuth(false);
                  }}
                  aria-label="Back to landing page"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400 transition duration-200 hover:border-slate-600 hover:bg-slate-900 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Home
                </button>
                <button
                  type="button"
                  onClick={() => setShowAuth(true)}
                  className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-cyan-300 transition duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setShowAuth(true)}
                  className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  Sign up
                </button>
              </>
            )}
          </div>
        </div>

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
                    showCompleted={showCompleted}
                    setShowCompleted={setShowCompleted}
                  />
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.4)]">
                  <h2 className="text-2xl font-semibold text-white">Live leaderboard</h2>
                  <p className="mt-2 text-slate-400">
                    Track your progress and compare with friends.
                  </p>
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
                {user ? (
                  <>
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
                  </>
                ) : (
                  <InlineGatePanel
                    label="create a group"
                    description="Build a private league and invite your friends — sign up free or sign in."
                  />
                )}

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
                          onClick={() => {
                            if (!gate('join a group')) return;
                            handleJoinPublicGroup(group.id);
                          }}
                          className="rounded-2xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          Join
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-6">
                  <FriendsList />
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
                  <ProfileView profile={ownProfile} editable />
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
              <AdminPanel />
            </Suspense>
          )}
        </section>
      </main>

      <ConfirmModal
        open={confirmingLogout}
        title="Log out of Bantryx?"
        description="You'll need to sign back in to make picks or view your leaderboards."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        onConfirm={performLogout}
        onCancel={() => setConfirmingLogout(false)}
      />

      <ProfileDrawer />
    </div>
  );
}

function CompletedSection({ completedGames, showCompleted, setShowCompleted }) {
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
      {showCompleted && completedGames.map((game) => <GameCard key={game.id} game={game} />)}
    </div>
  );
}

export default DashboardView;
