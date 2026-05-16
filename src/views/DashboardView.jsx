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
import { Button, Input } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';
import { useData } from '../hooks/useData';
import { useGames } from '../hooks/useGames';

const PicksHistory = lazy(() => import('../components/PicksHistory'));
const ProfileView = lazy(() => import('../components/ProfileView'));
const AdminPanel = lazy(() => import('../components/admin/AdminPanel'));

function LazyFallback({ label = 'Loading…' }) {
  return <p className="text-sm text-fg-muted">{label}</p>;
}

const BASE_TABS = [
  { id: 'games', kicker: 'Games', label: 'Upcoming Matches' },
  { id: 'mypicks', kicker: 'My Picks', label: 'Your History' },
  { id: 'groups', kicker: 'Groups', label: 'My Groups' },
  { id: 'leaderboard', kicker: 'Leaderboards', label: 'Rankings' },
  { id: 'profile', kicker: 'Profile', label: 'Your Stats' },
];
const ADMIN_TAB = { id: 'admin', kicker: 'Admin', label: 'Manage' };

// Tier 11 Chunk 2 — DashboardView tokenized. BANTRYX wordmark moved to the
// `text-shadow-brand-glow` utility; pill buttons in the top utility bar
// now use the Button primitive; all surfaces use elevated/overlay/default
// tokens.
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

  const onCreateGroupSubmit = async (event) => {
    event.preventDefault();
    await handleCreateGroup({ name: authData.groupName, visibility: authData.groupVisibility });
    setAuthData((prev) => ({ ...prev, groupName: '', groupVisibility: 'private' }));
  };

  const renderGameSection = (heading, list, emptyText) => (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">{heading}</h3>
      {list.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        list.map((game) => <GameCard key={game.id} game={game} />)
      )}
    </div>
  );

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] gap-4 lg:gap-6" aria-busy={loading}>
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
        {(() => {
          // Tier 11 Chunk 3 — Mobile top bar splits into 3 stacked rows
          // so the BANTRYX wordmark stops colliding with the icons on
          // narrow viewports. Desktop keeps the original 1-row grid.
          //   Row 1: hamburger | BANTRYX | primary right action
          //   Row 2: secondary actions (right-aligned)
          //   Row 3: SearchBar (full-width)
          // Components are mounted twice (once per layout) and CSS-hidden
          // via md:hidden / hidden md:flex; cost is negligible (Bell polls
          // both copies but the API is idempotent).
          const hamburger = (
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-default bg-elevated/80 text-fg transition-colors duration-200 hover:bg-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          );
          const brand = (
            <h2
              aria-hidden="true"
              className="text-shadow-brand-glow select-none text-sm font-normal uppercase tracking-[0.35em] text-accent/80"
            >
              BANTRYX
            </h2>
          );
          const homePill = (
            <button
              type="button"
              onClick={() => {
                setBrowseAsGuest(false);
                setShowAuth(false);
              }}
              aria-label="Back to landing page"
              className="inline-flex items-center gap-1.5 rounded-full border border-default bg-elevated/40 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-fg-muted transition duration-200 hover:border-strong hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          );
          // `flex-1 md:flex-none` lets the buttons stretch to fill row 2 on
          // mobile (Sign in pinned left, Sign up pinned right, with the gap
          // as the white space between them). On desktop they stay at
          // natural content width inside the right-column flex group.
          const signInBtn = (
            <Button
              variant="secondary"
              onClick={() => setShowAuth(true)}
              className="flex-1 md:flex-none"
            >
              Sign in
            </Button>
          );
          const signUpBtn = (
            <Button
              variant="primary"
              onClick={() => setShowAuth(true)}
              className="flex-1 md:flex-none"
            >
              Sign up
            </Button>
          );
          const search = (
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
          );

          return (
            <>
              {/* Mobile (< md:): 3 stacked rows */}
              <div className="flex flex-col gap-3 md:hidden">
                <div className="flex items-center justify-between gap-3">
                  {hamburger}
                  {brand}
                  {user ? <UserMenu /> : homePill}
                </div>
                <div className="flex items-center justify-end gap-3">
                  {user ? (
                    <NotificationBell />
                  ) : (
                    <>
                      {signInBtn}
                      {signUpBtn}
                    </>
                  )}
                </div>
                <div>{search}</div>
              </div>

              {/* Desktop (md+): original 1-row grid */}
              <div className="hidden grid-cols-[1fr_auto_1fr] items-center gap-3 md:grid">
                <div className="flex min-w-0 items-center gap-3">{search}</div>
                {brand}
                <div className="flex items-center justify-end gap-3">
                  {user ? (
                    <>
                      <NotificationBell />
                      <UserMenu />
                    </>
                  ) : (
                    <>
                      {homePill}
                      {signInBtn}
                      {signUpBtn}
                    </>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        <section className="space-y-6">
          {view === 'games' ? (
            // grid-cols-1 forces a `minmax(0, 1fr)` track on mobile so the
            // GameCards + leaderboard side-panel collapse to viewport width
            // instead of sizing to their min-content (which overflows at
            // 320px / iPhone SE).
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-6">
                <div className="rounded-3xl border border-default bg-elevated/80 p-6 shadow-glow">
                  <h2 className="text-2xl font-semibold text-fg">Games</h2>
                  <p className="mt-2 text-fg-muted">
                    Pick winners, earn more points for underdog upsets.
                  </p>
                </div>

                {liveGames.length > 0 ? renderGameSection('Live now', liveGames, '') : null}

                {renderGameSection(
                  'Upcoming',
                  upcomingGames,
                  'No upcoming games yet. Check back soon.',
                )}

                {completedGames.length > 0 ? (
                  <CompletedSection
                    completedGames={completedGames}
                    showCompleted={showCompleted}
                    setShowCompleted={setShowCompleted}
                  />
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
                  <h2 className="text-2xl font-semibold text-fg">Live leaderboard</h2>
                  <p className="mt-2 text-fg-muted">
                    Track your progress and compare with friends.
                  </p>
                  <div className="mt-5 space-y-4">
                    <div className="rounded-3xl bg-overlay/70 p-4">
                      <h3 className="text-sm uppercase tracking-[0.24em] text-accent/80">
                        Overall
                      </h3>
                      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                        {leaderboard.overall.length === 0 ? (
                          <p className="text-sm text-fg-muted">No data yet.</p>
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
                    <div className="rounded-3xl bg-overlay/70 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm uppercase tracking-[0.24em] text-accent/80">
                            Group leaderboard
                          </h3>
                          <p className="mt-2 text-sm text-fg-muted">
                            Select one group to view its ranking.
                          </p>
                        </div>
                        {groups.length > 0 ? (
                          <label className="sm:w-auto">
                            <span className="sr-only">Choose group</span>
                            <select
                              value={selectedGroupId}
                              onChange={handleGroupSelection}
                              className="w-full rounded-2xl border border-default bg-elevated/90 px-4 py-3 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent sm:w-auto"
                            >
                              {groups.map((group) => (
                                <option key={group.id} value={group.id}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <p className="text-sm text-fg-subtle">
                            Join or create a group to see member rankings.
                          </p>
                        )}
                      </div>
                      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                        {leaderboard.group.length === 0 ? (
                          <p className="text-sm text-fg-muted">No group leaderboard data yet.</p>
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
          ) : null}

          {view === 'mypicks' ? (
            <Suspense fallback={<LazyFallback label="Loading your picks…" />}>
              <PicksHistory picks={picks} games={games} />
            </Suspense>
          ) : null}

          {view === 'groups' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.95fr)]">
              <div className="rounded-3xl border border-default bg-elevated/80 p-6 shadow-glow">
                {user ? (
                  <>
                    <h2 className="text-2xl font-semibold text-fg">Create a new group</h2>
                    <p className="mt-2 text-fg-muted">
                      Invite friends and compare scores in your private pool.
                    </p>
                    <form onSubmit={onCreateGroupSubmit} className="mt-6 space-y-4">
                      <Input
                        id="group-name"
                        aria-label="Group name"
                        value={authData.groupName}
                        onChange={(event) =>
                          setAuthData((prev) => ({ ...prev, groupName: event.target.value }))
                        }
                        placeholder="Group name"
                      />
                      <fieldset className="rounded-3xl border border-default bg-overlay/50 px-4 py-3">
                        <legend className="px-2 text-xs uppercase tracking-[0.25em] text-fg-muted">
                          Visibility
                        </legend>
                        <div className="flex flex-wrap gap-3 pt-2 text-sm text-fg">
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
                      <Button type="submit" variant="primary" size="lg">
                        Create group
                      </Button>
                    </form>
                  </>
                ) : (
                  <InlineGatePanel
                    label="create a group"
                    description="Build a private league and invite your friends — sign up free or sign in."
                  />
                )}

                <div className="mt-6 space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
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
                        className="flex flex-col gap-3 rounded-2xl bg-overlay/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-fg">{group.name}</p>
                          <p className="text-xs text-fg-muted">
                            {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (!gate('join a group')) return;
                            handleJoinPublicGroup(group.id);
                          }}
                        >
                          Join
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-6">
                  <FriendsList />
                </div>
              </div>

              <div className="space-y-4">
                {pendingInvites.length > 0 ? (
                  <div className="rounded-3xl border border-warning/40 bg-warning/5 p-6 shadow-glow">
                    <h2 className="text-2xl font-semibold text-fg">Pending Invitations</h2>
                    <p className="mt-2 text-sm text-warning">
                      You have {pendingInvites.length} pending group invitation
                      {pendingInvites.length !== 1 ? 's' : ''}.
                    </p>
                    <div className="mt-4 space-y-3">
                      {pendingInvites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex flex-col gap-3 rounded-3xl bg-overlay/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-fg">Invited to join</p>
                            <p className="mt-1 truncate font-semibold text-fg">
                              {invite.groupName}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => handleAcceptInvite(invite.groupId, invite.id)}>
                              Accept
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => handleDeclineInvite(invite.groupId, invite.id)}
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

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
          ) : null}

          {view === 'profile' ? (
            <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
              {!ownProfile ? (
                <p className="text-sm text-fg-muted">Loading your profile…</p>
              ) : (
                <Suspense fallback={<LazyFallback label="Loading profile…" />}>
                  <ProfileView profile={ownProfile} editable />
                </Suspense>
              )}
            </div>
          ) : null}

          {view === 'leaderboard' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
          ) : null}

          {view === 'admin' && user?.role === 'admin' ? (
            <Suspense fallback={<LazyFallback label="Loading admin panel…" />}>
              <AdminPanel />
            </Suspense>
          ) : null}
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
        className="w-full rounded-3xl border border-default bg-elevated/60 px-5 py-4 text-left text-sm font-semibold uppercase tracking-[0.24em] text-fg transition duration-200 hover:border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-expanded={showCompleted}
      >
        {showCompleted ? 'Hide' : 'Show'} {completedGames.length} completed
      </button>
      {showCompleted ? completedGames.map((game) => <GameCard key={game.id} game={game} />) : null}
    </div>
  );
}

export default DashboardView;
