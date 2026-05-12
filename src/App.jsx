import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameCard from './components/GameCard';
import LeaderboardCard, { LeaderboardRow } from './components/LeaderboardCard';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import GroupCard from './components/GroupCard';
import GroupLeaderboardCard from './components/GroupLeaderboardCard';
import PicksHistory from './components/PicksHistory';
import ConfirmModal from './components/ConfirmModal';
import EmptyState from './components/EmptyState';
import { SkeletonGameCard, SkeletonLeaderboardRow } from './components/Skeleton';
import ProfileView from './components/ProfileView';
import ProfileDrawer from './components/ProfileDrawer';
import FriendsList from './components/FriendsList';
import NotificationBell from './components/NotificationBell';

const initialAuthData = {
  loginUsername: '',
  loginPassword: '',
  registerUsername: '',
  registerPassword: '',
  groupName: '',
  groupVisibility: 'private',
};

const TABS = [
  { id: 'games', kicker: 'Games', label: 'Upcoming Matches' },
  { id: 'mypicks', kicker: 'My Picks', label: 'Your History' },
  { id: 'groups', kicker: 'Groups', label: 'My Groups' },
  { id: 'leaderboard', kicker: 'Leaderboards', label: 'Rankings' },
  { id: 'profile', kicker: 'Profile', label: 'Your Stats' },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const [token, setToken] = useState(localStorage.getItem('scorecastToken') || '');
  const [user, setUser] = useState(null);
  const [games, setGames] = useState([]);
  const [groups, setGroups] = useState([]);
  const [picks, setPicks] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [leaderboard, setLeaderboard] = useState({ overall: [], group: [] });
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [view, setView] = useState('games');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [authData, setAuthData] = useState(initialAuthData);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [profileUsername, setProfileUsername] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [] });
  const [discoverGroups, setDiscoverGroups] = useState([]);
  const [ownProfile, setOwnProfile] = useState(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const pickMap = useMemo(
    () => new Map(picks.map((pick) => [pick.gameId, pick.choice])),
    [picks]
  );

  const { upcomingGames, liveGames, completedGames } = useMemo(() => {
    const now = Date.now();
    const upcoming = [];
    const live = [];
    const completed = [];
    for (const game of games) {
      if (game.result) {
        completed.push(game);
      } else if (new Date(game.date).getTime() > now) {
        upcoming.push(game);
      } else {
        live.push(game);
      }
    }
    return { upcomingGames: upcoming, liveGames: live, completedGames: completed };
  }, [games]);

  const showStatus = async (message) => {
    setStatus(message);
    await delay(3500);
    setStatus('');
  };

  const handleSessionExpired = () => {
    setToken('');
    setUser(null);
    setGames([]);
    setGroups([]);
    setPicks([]);
    setLeaderboard({ overall: [], group: [] });
    setPendingInvites([]);
    setSelectedGroupId('');
    setView('games');
    localStorage.removeItem('scorecastToken');
    showStatus('Session expired — please sign in again.');
  };

  const request = useCallback(async (path, options = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;

    const response = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: { ...(options.headers || {}), ...headers },
    });

    if (response.status === 401 && tokenRef.current) {
      handleSessionExpired();
      throw new Error('Session expired');
    }

    if (response.status === 204) return null;
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error((data && data.error) || 'Request failed');
    }
    return data;
  }, []);

  const refreshPicks = async () => {
    const data = await request('/api/picks');
    setPicks(data);
  };

  const refreshGames = async () => {
    const data = await request('/api/games');
    setGames(data.sort((a, b) => new Date(a.date) - new Date(b.date)));
  };

  const refreshGroups = async () => {
    const data = await request('/api/groups');
    setGroups(data);
    if (!selectedGroupId && data.length > 0) {
      setSelectedGroupId(data[0].id);
    }
    return data;
  };

  const refreshFriends = async () => {
    try {
      const data = await request('/api/friends');
      setFriends(data);
    } catch (error) {
      if (error.message !== 'Session expired') console.warn(error.message);
    }
  };

  const refreshDiscover = async () => {
    try {
      const data = await request('/api/groups/discover');
      setDiscoverGroups(data);
    } catch (error) {
      if (error.message !== 'Session expired') console.warn(error.message);
    }
  };

  const refreshLeaderboard = async (groupId = '') => {
    const effectiveGroupId = groupId || selectedGroupId || groups[0]?.id || '';
    const query = effectiveGroupId ? `?groupId=${effectiveGroupId}` : '';
    const data = await request(`/api/leaderboard${query}`);
    setLeaderboard(data);
  };

  const handleGroupSelection = async (event) => {
    const groupId = event.target.value;
    setSelectedGroupId(groupId);
    await refreshLeaderboard(groupId);
  };

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const me = await request('/api/me');
      const { pendingInvites: invites, ...userData } = me;
      setUser(userData);
      setPendingInvites(invites || []);
      await refreshGames();
      const groupData = await refreshGroups();
      const initialGroupId = selectedGroupId && groupData.some((group) => group.id === selectedGroupId)
        ? selectedGroupId
        : groupData[0]?.id || '';
      setSelectedGroupId(initialGroupId);
      await Promise.all([
        refreshPicks(),
        refreshLeaderboard(initialGroupId),
        refreshFriends(),
        refreshDiscover(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    localStorage.setItem('scorecastToken', token);
    loadDashboard().catch((error) => {
      if (error.message !== 'Session expired') showStatus(error.message);
    });
  }, [token]);

  useEffect(() => {
    if (view !== 'profile' || !user?.username) return;
    request(`/api/users/${encodeURIComponent(user.username)}/profile`)
      .then(setOwnProfile)
      .catch((error) => {
        if (error.message !== 'Session expired') showStatus(error.message);
      });
  }, [view, user?.username, picks, games, request]);

  const performLogout = () => {
    setToken('');
    setUser(null);
    setGames([]);
    setGroups([]);
    setPicks([]);
    setLeaderboard({ overall: [], group: [] });
    setPendingInvites([]);
    setSelectedGroupId('');
    localStorage.removeItem('scorecastToken');
    setView('games');
    setConfirmingLogout(false);
  };

  const submitPick = async (gameId, choice) => {
    try {
      await request('/api/picks', {
        method: 'POST',
        body: JSON.stringify({ gameId, choice }),
      });
      await Promise.all([refreshGames(), refreshPicks(), refreshLeaderboard()]);
      await showStatus('Pick saved successfully');
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      const data = await request('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: authData.loginUsername, password: authData.loginPassword }),
      });
      setToken(data.token);
      setUser(data.user);
      setAuthData(initialAuthData);
    } catch (error) {
      showStatus(error.message);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    try {
      const data = await request('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: authData.registerUsername, password: authData.registerPassword }),
      });
      setToken(data.token);
      setUser(data.user);
      setAuthData(initialAuthData);
    } catch (error) {
      showStatus(error.message);
    }
  };

  const handleCreateGroup = async (event) => {
    event.preventDefault();
    try {
      await request('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: authData.groupName,
          visibility: authData.groupVisibility,
        }),
      });
      setAuthData((prev) => ({ ...prev, groupName: '', groupVisibility: 'private' }));
      await Promise.all([refreshGroups(), refreshLeaderboard(), refreshDiscover()]);
      showStatus('Group created successfully');
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const fetchProfile = useCallback(async (username) => {
    if (!username) return;
    setProfileLoading(true);
    try {
      const data = await request(`/api/users/${encodeURIComponent(username)}/profile`);
      setProfile(data);
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, [request]);

  const openProfile = (username) => {
    setProfileUsername(username);
    setProfile(null);
    fetchProfile(username);
  };

  const closeProfile = () => {
    setProfileUsername('');
    setProfile(null);
  };

  const handleFriendAction = async (action) => {
    if (!profile) return;
    setProfileBusy(true);
    try {
      if (action === 'request') {
        await request('/api/friends/request', {
          method: 'POST',
          body: JSON.stringify({ username: profile.username }),
        });
        showStatus(`Friend request sent to ${profile.username}`);
      } else if (action === 'cancel' && profile.friendship) {
        await request(`/api/friends/${profile.friendship.id}`, { method: 'DELETE' });
        showStatus('Request cancelled');
      } else if (action === 'accept' && profile.friendship) {
        await request(`/api/friends/${profile.friendship.id}/accept`, { method: 'POST' });
        showStatus(`You are now friends with ${profile.username}`);
      } else if (action === 'unfriend' && profile.friendship) {
        await request(`/api/friends/${profile.friendship.id}`, { method: 'DELETE' });
        showStatus(`Unfriended ${profile.username}`);
      }
      await Promise.all([fetchProfile(profile.username), refreshFriends()]);
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    } finally {
      setProfileBusy(false);
    }
  };

  const handleSendFriendRequest = async (username) => {
    try {
      await request('/api/friends/request', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      await refreshFriends();
      showStatus(`Friend request sent to ${username}`);
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleAcceptFriend = async (id) => {
    try {
      await request(`/api/friends/${id}/accept`, { method: 'POST' });
      await refreshFriends();
      showStatus('Friend request accepted');
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleDeclineFriend = async (id) => {
    try {
      await request(`/api/friends/${id}/decline`, { method: 'POST' });
      await refreshFriends();
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleUnfriend = async (id) => {
    try {
      await request(`/api/friends/${id}`, { method: 'DELETE' });
      await refreshFriends();
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleJoinPublicGroup = async (groupId) => {
    try {
      await request(`/api/groups/${groupId}/join`, { method: 'POST' });
      await Promise.all([refreshGroups(), refreshDiscover(), refreshLeaderboard()]);
      showStatus('Joined group');
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleInvite = async (groupId, username) => {
    try {
      await request(`/api/groups/${groupId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      await Promise.all([refreshGroups(), refreshLeaderboard()]);
      showStatus(`${username} invited successfully`);
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleAcceptInvite = async (groupId, inviteId) => {
    try {
      await request(`/api/groups/${groupId}/invite/${inviteId}/accept`, {
        method: 'POST',
      });
      await Promise.all([loadDashboard()]);
      showStatus('Invitation accepted!');
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleDeclineInvite = async (groupId, inviteId) => {
    try {
      await request(`/api/groups/${groupId}/invite/${inviteId}/decline`, {
        method: 'POST',
      });
      await Promise.all([loadDashboard()]);
      showStatus('Invitation declined');
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    }
  };

  const handleCommentError = (message) => {
    if (message && message !== 'Session expired') showStatus(message);
  };

  const renderGameSection = (heading, list, emptyText) => (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">{heading}</h3>
      {list.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        list.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            existingPick={pickMap.get(game.id)}
            onPickSubmit={submitPick}
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
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-400/80">ScoreCast</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold text-white sm:text-4xl">
              Football predictions with groups, invites, and probability-based scoring.
            </h1>
          </div>
          <div className="rounded-3xl bg-slate-950/90 px-5 py-4 shadow-inner shadow-slate-950/20">
            <p className="text-sm text-slate-400">Logged in as</p>
            <p className="mt-1 text-xl font-semibold text-white">{user?.username}</p>
            <p className="mt-2 text-sm text-slate-400">Joined groups: {user?.joinedGroups?.length || 0}</p>
            {pendingInvites.length > 0 && (
              <p className="mt-2 text-sm text-amber-300">Pending invites: {pendingInvites.length}</p>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="-mx-1 flex flex-1 gap-3 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Dashboard sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={view === tab.id}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
              className={`min-w-[10rem] shrink-0 rounded-3xl border px-5 py-4 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${view === tab.id ? 'border-cyan-400 bg-cyan-500/10 text-white shadow-[0_10px_30px_rgba(6,182,212,0.18)]' : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-900/95'}`}
            >
              <span className="block text-sm uppercase tracking-[0.24em] text-slate-400">{tab.kicker}</span>
              <span className="mt-2 block text-lg font-semibold text-white">{tab.label}</span>
            </button>
          ))}
        </div>

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
                    <p className="mt-2 text-slate-400">Pick winners, earn more points for underdog upsets.</p>
                  </div>
                  <span className="rounded-full bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300">Future-proof picks only</span>
                </div>
              </div>

              {liveGames.length > 0 && renderGameSection('Live now', liveGames, '')}

              {renderGameSection('Upcoming', upcomingGames, 'No upcoming games yet. Check back soon.')}

              {completedGames.length > 0 && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setShowCompleted((prev) => !prev)}
                    className="w-full rounded-3xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-left text-sm font-semibold uppercase tracking-[0.24em] text-slate-300 transition duration-200 hover:border-slate-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    aria-expanded={showCompleted}
                  >
                    {showCompleted ? 'Hide' : 'Show'} {completedGames.length} completed
                  </button>
                  {showCompleted && completedGames.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      existingPick={pickMap.get(game.id)}
                      onPickSubmit={submitPick}
                      currentUserId={user?.id}
                      request={request}
                      onError={handleCommentError}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.4)]">
                <h2 className="text-2xl font-semibold text-white">Live leaderboard</h2>
                <p className="mt-2 text-slate-400">Track your progress and compare with friends.</p>
                <div className="mt-5 space-y-4">
                  <div className="rounded-3xl bg-slate-950/70 p-4">
                    <h3 className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">Overall</h3>
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
                        <h3 className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">Group leaderboard</h3>
                        <p className="mt-2 text-sm text-slate-400">Select one group to view its ranking.</p>
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
                              <option key={group.id} value={group.id}>{group.name}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p className="text-sm text-slate-500">Join or create a group to see member rankings.</p>
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
          <PicksHistory picks={picks} games={games} />
        )}

        {view === 'groups' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.95fr)]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
              <h2 className="text-2xl font-semibold text-white">Create a new group</h2>
              <p className="mt-2 text-slate-400">Invite friends and compare scores in your private pool.</p>
              <form onSubmit={handleCreateGroup} className="mt-6 space-y-4">
                <label htmlFor="group-name" className="sr-only">Group name</label>
                <input
                  id="group-name"
                  value={authData.groupName}
                  onChange={(event) => setAuthData((prev) => ({ ...prev, groupName: event.target.value }))}
                  placeholder="Group name"
                  className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
                />
                <fieldset className="rounded-3xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                  <legend className="px-2 text-xs uppercase tracking-[0.25em] text-slate-400">Visibility</legend>
                  <div className="flex flex-wrap gap-3 pt-2 text-sm text-slate-200">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="group-visibility"
                        value="private"
                        checked={authData.groupVisibility === 'private'}
                        onChange={() => setAuthData((prev) => ({ ...prev, groupVisibility: 'private' }))}
                      />
                      Private (invite-only)
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="group-visibility"
                        value="public"
                        checked={authData.groupVisibility === 'public'}
                        onChange={() => setAuthData((prev) => ({ ...prev, groupVisibility: 'public' }))}
                      />
                      Public (discoverable)
                    </label>
                  </div>
                </fieldset>
                <button type="submit" className="inline-flex rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                  Create group
                </button>
              </form>

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Discover public groups</h3>
                {discoverGroups.length === 0 ? (
                  <EmptyState
                    title="No public groups right now"
                    description="Check back later, or invite friends to a private group."
                  />
                ) : (
                  discoverGroups.map((group) => (
                    <div key={group.id} className="flex flex-col gap-3 rounded-2xl bg-slate-950/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{group.name}</p>
                        <p className="text-xs text-slate-400">{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</p>
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
                  <p className="mt-2 text-sm text-amber-200/80">You have {pendingInvites.length} pending group invitation{pendingInvites.length !== 1 ? 's' : ''}.</p>
                  <div className="mt-4 space-y-3">
                    {pendingInvites.map((invite) => (
                      <div key={invite.id} className="flex flex-col gap-3 rounded-3xl bg-slate-950/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-300">Invited to join</p>
                          <p className="mt-1 truncate font-semibold text-white">{invite.groupName}</p>
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
                  <GroupCard key={group.id} group={group} onInvite={handleInvite} />
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
              <ProfileView profile={ownProfile} />
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
            />
          </div>
        )}
      </section>

      <ConfirmModal
        open={confirmingLogout}
        title="Log out of ScoreCast?"
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

  const authPanel = (
    <div className="grid gap-6 lg:grid-cols-2">
      <LoginForm authData={authData} setAuthData={setAuthData} onSubmit={handleLogin} />
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
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-400/80">ScoreCast</p>
              <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Join groups, make picks, and climb the leaderboards!
              </h1>
              <p className="mt-4 max-w-2xl text-slate-400 sm:text-lg">
                Pick your match winners, compete against your friends and the world, earn points for risky calls and underdog upsets, and see how you stack up on the live leaderboards. It's football prediction made social, competitive, and fun!
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-5 text-center shadow-[0_24px_80px_rgba(15,23,42,0.4)]">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Predict & Win</p>
              <p className="mt-3 text-2xl font-semibold text-white">ScoreCast</p>
              <p className="mt-2 text-sm text-slate-400">Pick smart, earn points, dominate leaderboards.</p>
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

        {loading && (!user || games.length === 0) ? (
          skeletonView
        ) : token && user ? (
          dashboard
        ) : (
          authPanel
        )}
      </div>
    </div>
  );
}

export default App;
