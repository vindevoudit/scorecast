import { Suspense, useEffect, useMemo, useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { lazyWithReload } from '../lib/lazyWithReload';
import GamesCalendar from '../components/GamesCalendar';
import Footer from '../components/Footer';
import LeaderboardCard from '../components/LeaderboardCard';
import GroupCard from '../components/GroupCard';
import GroupLeaderboardCard from '../components/GroupLeaderboardCard';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import ProfileDrawer from '../components/ProfileDrawer';
import FriendsList from '../components/FriendsList';
import NotificationBell from '../components/NotificationBell';
import RefreshButton from '../components/RefreshButton';
import SearchBar from '../components/SearchBar';
import JoinGroupPasswordDialog from '../components/JoinGroupPasswordDialog';
import JoinRequestDialog from '../components/JoinRequestDialog';
import Sidebar from '../components/Sidebar';
import UserMenu from '../components/UserMenu';
import InlineGatePanel from '../components/InlineGatePanel';
import GroupNameDisplay from '../components/GroupNameDisplay';
import InstallPrompt from '../components/InstallPrompt';
import GameFiltersBar from '../components/GameFiltersBar';
import LeaderboardFiltersBar from '../components/LeaderboardFiltersBar';
import { Button, Input } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';
import { useData } from '../hooks/useData';
import { useGames } from '../hooks/useGames';

const PicksHistory = lazyWithReload(() => import('../components/PicksHistory'));
const ProfileView = lazyWithReload(() => import('../components/ProfileView'));
const AdminPanel = lazyWithReload(() => import('../components/admin/AdminPanel'));

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
    browseAsGuest,
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
    friends,
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
    leaderboardFilters,
    navigateToDeepLink,
  } = useData();
  const isLeaderboardFiltered = Boolean(leaderboardFilters.leagueId || leaderboardFilters.seasonId);
  const { games, byDay } = useGames();

  const tabs = useMemo(() => {
    if (!user) {
      return BASE_TABS.filter(
        (t) => t.id === 'games' || t.id === 'groups' || t.id === 'leaderboard',
      );
    }
    return user.role === 'admin' ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;
  }, [user]);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('sc_sidebar_collapsed') === '1';
  });
  useEffect(() => {
    window.localStorage.setItem('sc_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [invitesRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });
  // Tier 19 Chunks 1+3 — dialog-target state. Holds the group object the
  // user picked from search; the dialog component decides what to render
  // (password vs request-to-join) based on the kind we set.
  const [passwordDialogGroup, setPasswordDialogGroup] = useState(null);
  const [requestDialogGroup, setRequestDialogGroup] = useState(null);

  const onCreateGroupSubmit = async (event) => {
    event.preventDefault();
    // Tier 19 Chunks 1+3 — only send `password` when visibility is private.
    // Server-side schema rejects password+non-private combos with 400, so
    // matching the gate here keeps the request shape clean.
    const payload = {
      name: authData.groupName,
      visibility: authData.groupVisibility,
    };
    if (authData.groupVisibility === 'private' && authData.groupPassword) {
      payload.password = authData.groupPassword;
    }
    await handleCreateGroup(payload);
    setAuthData((prev) => ({
      ...prev,
      groupName: '',
      groupVisibility: 'secret',
      groupPassword: '',
    }));
  };

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

      <main id="main" className="flex min-w-0 flex-1 flex-col gap-6">
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
          // Tier 18 Chunk 1 — when authed (and not browsing as guest), the
          // wordmark doubles as a Home link back to the games view. Anon
          // visitors get the static `<h2>` and rely on the explicit
          // `homePill` for back-to-landing nav. On the games view itself
          // the wordmark drops its hover state since clicking it would
          // be a no-op refresh.
          const brandClass =
            'text-shadow-brand-glow select-none rounded text-sm font-normal uppercase tracking-[0.35em] text-accent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
          const brand =
            user && !browseAsGuest ? (
              <button
                type="button"
                onClick={() => setView('games')}
                aria-label="Go to games"
                className={`${brandClass} ${view === 'games' ? '' : 'hover:text-white'}`}
              >
                BANTRYX
              </button>
            ) : (
              <h2 aria-hidden="true" className={brandClass}>
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
                // Tier 19 — five-way action dispatch driven by the row's
                // flag set (see routes/users.js search response). Members
                // navigate; non-members get the most permissive available
                // join path. We prefer Password over Request because the
                // password is a deliberate "skip approval" path the owner
                // chose to enable.
                if (g.isMember) {
                  setView('groups');
                  return;
                }
                if (g.canJoin) {
                  if (!gate('join a group')) return;
                  await handleJoinPublicGroup(g.id);
                  setView('groups');
                  return;
                }
                if (g.canJoinWithPassword) {
                  if (!gate('join a group')) return;
                  setPasswordDialogGroup(g);
                  return;
                }
                if (g.canRequestJoin) {
                  if (!gate('join a group')) return;
                  setRequestDialogGroup(g);
                  return;
                }
                // hasPendingRequest, or secret-by-member fallthrough — no-op.
              }}
              onSelectGame={(game) => {
                // Tier 20 Chunk 3 — navigate the calendar to the selected
                // game's day. Reuses the existing Tier 18 Chunk 6a
                // deep-link infrastructure: navigateToDeepLink pushes
                // `?gameId=<id>` to history, then consumeDeepLinks
                // translates it into a synthetic `?date=YYYY-MM-DD` via
                // dayKey(game.date) and GamesCalendar reads `?date=` on
                // its first render (pre-shifting windowIndex if the
                // target falls outside the default 7-day window).
                setView('games');
                navigateToDeepLink(`/?gameId=${game.id}`);
              }}
            />
          );

          return (
            <>
              {/* Mobile (< md:): 3 stacked rows. Tier 18 Chunk 1 —
                  three-slot flex with the brand in a centered `flex-1`
                  middle so the wordmark sits true-center regardless of
                  whether the right slot is the (narrow) homePill or the
                  (wider) UserMenu. */}
              <div className="flex flex-col gap-3 md:hidden">
                <div className="flex items-center gap-3">
                  <div className="flex-none">{hamburger}</div>
                  <div className="flex flex-1 justify-center">{brand}</div>
                  <div className="flex-none">{user ? <UserMenu /> : homePill}</div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  {user ? (
                    <>
                      <RefreshButton />
                      <NotificationBell />
                    </>
                  ) : (
                    <>
                      <RefreshButton />
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
                      <RefreshButton />
                      <NotificationBell />
                      <UserMenu />
                    </>
                  ) : (
                    <>
                      {homePill}
                      <RefreshButton />
                      {signInBtn}
                      {signUpBtn}
                    </>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* PWA install banner — visible to both signed-in and anonymous-browse
            visitors. The component self-suppresses if already-installed, if
            dismissed, or (on non-iOS) if Chromium hasn't handed us a prompt. */}
        <InstallPrompt />

        <section className="space-y-6">
          {view === 'games' ? (
            // Phase 0 T29-3 — right-column "Live leaderboard" panel removed
            // (duplicated the Leaderboard tab + made the calendar narrower).
            // Calendar fills the full width.
            <div className="space-y-6 motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
              <div className="rounded-3xl border border-default bg-elevated/80 p-6 shadow-glow">
                <h2 className="text-2xl font-semibold text-fg">Games</h2>
                <p className="mt-2 text-fg-muted">
                  Pick winners, earn more points for underdog upsets.
                </p>
                <div className="mt-4">
                  <GameFiltersBar />
                </div>
              </div>

              {/* Tier 18 Chunk 3 — calendar viewer replaces the previous
                  Live + Upcoming + Completed-toggle cascade. Day strip +
                  grouped list keeps the screen scannable when the entire
                  season is loaded. The `liveGames` / `upcomingGames` /
                  `completedGames` selectors stay on useGames() for any
                  future surface that still wants the old buckets. */}
              <GamesCalendar byDay={byDay} />
            </div>
          ) : null}

          {view === 'mypicks' ? (
            <div className="motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
              <Suspense fallback={<LazyFallback label="Loading your picks…" />}>
                <PicksHistory picks={picks} games={games} />
              </Suspense>
            </div>
          ) : null}

          {view === 'groups' ? (
            <div className="grid grid-cols-1 gap-6 motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.95fr)]">
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
                      {/* Tier 19 — three-tier visibility. Each option gets
                          a one-line tagline explaining who can find +
                          join the group so the user can pick confidently
                          without reading docs. Order: most-open →
                          most-private. */}
                      <fieldset className="rounded-3xl border border-default bg-overlay/50 px-4 py-3">
                        <legend className="px-2 text-xs uppercase tracking-[0.25em] text-fg-muted">
                          Visibility
                        </legend>
                        <div className="flex flex-col gap-3 pt-2 text-sm text-fg">
                          {[
                            {
                              value: 'public',
                              label: 'Public',
                              description: 'Discoverable and free to join.',
                            },
                            {
                              value: 'private',
                              label: 'Private',
                              description:
                                'Discoverable. Join by request, invitation, or password.',
                            },
                            {
                              value: 'secret',
                              label: 'Secret',
                              description: 'Hidden. Invite-only.',
                            },
                          ].map((opt) => (
                            // eslint-disable-next-line jsx-a11y/label-has-associated-control
                            <label
                              key={opt.value}
                              htmlFor={`group-visibility-${opt.value}`}
                              className="flex items-start gap-2"
                            >
                              <input
                                id={`group-visibility-${opt.value}`}
                                type="radio"
                                name="group-visibility"
                                value={opt.value}
                                checked={authData.groupVisibility === opt.value}
                                onChange={() =>
                                  setAuthData((prev) => ({
                                    ...prev,
                                    groupVisibility: opt.value,
                                  }))
                                }
                                className="mt-1"
                              />
                              <span className="flex flex-col">
                                <span className="font-medium">{opt.label}</span>
                                <span className="text-xs text-fg-muted">{opt.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      {/* Tier 19 Chunk 1 — optional password input, only
                          rendered when the user picks Private. Min 4 chars
                          (enforced server-side too). */}
                      {authData.groupVisibility === 'private' ? (
                        <div className="rounded-3xl border border-default bg-overlay/50 px-4 py-3">
                          <label
                            htmlFor="group-password"
                            className="block text-xs uppercase tracking-[0.25em] text-fg-muted"
                          >
                            Password (optional)
                          </label>
                          <p className="mt-1 text-xs text-fg-muted">
                            Anyone with this password can join without owner approval. Leave blank
                            to require requests + invitations only.
                          </p>
                          <Input
                            id="group-password"
                            type="password"
                            aria-label="Group password"
                            value={authData.groupPassword}
                            onChange={(event) =>
                              setAuthData((prev) => ({
                                ...prev,
                                groupPassword: event.target.value,
                              }))
                            }
                            placeholder="Min 4 characters"
                            autoComplete="off"
                            className="mt-2"
                          />
                        </div>
                      ) : null}
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
                          <p className="truncate text-sm font-semibold text-fg">
                            <GroupNameDisplay group={group} />
                          </p>
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
                    <div ref={invitesRef} className="mt-4 space-y-3">
                      {pendingInvites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex flex-col gap-3 rounded-3xl bg-overlay/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-fg">Invited to join</p>
                            <p className="mt-1 truncate font-semibold text-fg">
                              <GroupNameDisplay
                                group={{
                                  name: invite.groupName,
                                  discriminator: invite.groupDiscriminator,
                                }}
                              />
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
            <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
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
            <div className="space-y-4 motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
              <LeaderboardFiltersBar />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <LeaderboardCard
                  title="Overall Leaderboard"
                  entries={leaderboard.overall}
                  currentUserId={user?.id}
                  onSelectUser={openProfile}
                  isFiltered={isLeaderboardFiltered}
                  // Tier 18 Chunk 3 — drives the compact view: top-3 + self
                  // + every accepted friend are always shown; the rest
                  // collapses into "… N more players" until expanded.
                  friendUserIds={(friends?.friends || []).map((f) => f.id)}
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
                  isFiltered={isLeaderboardFiltered}
                />
              </div>
            </div>
          ) : null}

          {view === 'admin' && user?.role === 'admin' ? (
            <div className="motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
              <Suspense fallback={<LazyFallback label="Loading admin panel…" />}>
                <AdminPanel />
              </Suspense>
            </div>
          ) : null}
        </section>

        <Footer />
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

      {/* Tier 19 Chunks 1+3 — join dialogs. Mounted at top level so they
          aren't unmounted when the user navigates between views. State
          lives in DashboardView; the dialogs themselves dispatch through
          DataContext handlers. */}
      {passwordDialogGroup ? (
        <JoinGroupPasswordDialog
          group={passwordDialogGroup}
          onClose={() => setPasswordDialogGroup(null)}
        />
      ) : null}
      {requestDialogGroup ? (
        <JoinRequestDialog group={requestDialogGroup} onClose={() => setRequestDialogGroup(null)} />
      ) : null}
    </div>
  );
}

export default DashboardView;
