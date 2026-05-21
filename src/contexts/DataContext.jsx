'use strict';

// Tier 13 Chunk 3 — DataContext. Owns games / picks / groups / leaderboard
// / friends / discoverGroups / pendingInvites / profile state plus every
// mutation handler. Used to live as 20+ useState slots in App.jsx.
//
// Triggers loadDashboard when `user` flips from null → set; clears its own
// slots when `user` flips back to null (so logout / session-expired tear
// down the cached data without needing AuthContext to know about it).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useNotifications } from './NotificationContext';
import { useRequest } from '../hooks/useRequest';

const DataContext = createContext(null);

const emptyLeaderboard = { overall: [], group: [], groupMeta: null };
const emptyFriends = { friends: [], incoming: [], outgoing: [] };

export function DataProvider({ children }) {
  const { user, setUser } = useAuth();
  const { showStatus } = useNotifications();
  const request = useRequest();

  const [bootDone, setBootDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('games');

  // Tier 4b Chunk 3 — league/season picker state. Sits in DataContext so
  // refreshGames (called from many places after picks/admin mutations)
  // preserves the active filter instead of clobbering it.
  const [gameFilters, setGameFiltersState] = useState({ leagueId: '', seasonId: '' });
  // Leaderboard filter (shared by Leaderboard + My Picks). Separate state
  // slot from gameFilters so picking a league for stats doesn't also scope
  // the games view (and vice versa). URL keys are `?lbLeague=` / `?lbSeason=`
  // (LeaderboardFiltersBar handles parse/write).
  const [leaderboardFilters, setLeaderboardFiltersState] = useState({
    leagueId: '',
    seasonId: '',
  });
  const [games, setGames] = useState([]);
  const [groups, setGroups] = useState([]);
  const [picks, setPicks] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [leaderboard, setLeaderboard] = useState(emptyLeaderboard);
  const [groupOrderBy, setGroupOrderBy] = useState('points');
  const [groupOffset, setGroupOffset] = useState(0);
  const groupLimit = 20;
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [friends, setFriends] = useState(emptyFriends);
  const [discoverGroups, setDiscoverGroups] = useState([]);
  const [ownProfile, setOwnProfile] = useState(null);

  const [profileUsername, setProfileUsername] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  // Tier 8.6 — distinguishes "fetch in flight" from "fetch resolved but the
  // viewer doesn't have visibility access" so ProfileDrawer can render a
  // private sheet instead of a perpetual loading state.
  const [profileError, setProfileError] = useState(null);

  // --- Refreshers --------------------------------------------------------

  const refreshPicks = useCallback(async () => {
    const data = await request('/api/picks');
    setPicks(data);
  }, [request]);

  const refreshGames = useCallback(
    async (overrideFilters) => {
      const filters = overrideFilters || gameFilters;
      const params = new URLSearchParams();
      if (filters.leagueId) params.set('leagueId', filters.leagueId);
      if (filters.seasonId) params.set('seasonId', filters.seasonId);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await request(`/api/games${qs}`);
      setGames(data.sort((a, b) => new Date(a.date) - new Date(b.date)));
    },
    [request, gameFilters],
  );

  // Setter that triggers a refresh with the new filters atomically. Wrapping
  // the two together means a stale fetch can't race the state update.
  const applyGameFilters = useCallback(
    async (next) => {
      const normalized = { leagueId: next.leagueId || '', seasonId: next.seasonId || '' };
      setGameFiltersState(normalized);
      await refreshGames(normalized);
    },
    [refreshGames],
  );

  const refreshGroups = useCallback(async () => {
    const data = await request('/api/groups');
    setGroups(data);
    setSelectedGroupId((curr) => (!curr && data.length > 0 ? data[0].id : curr));
    return data;
  }, [request]);

  const refreshFriends = useCallback(async () => {
    try {
      const data = await request('/api/friends');
      setFriends(data);
    } catch (error) {
      if (error.message !== 'Session expired') console.warn(error.message);
    }
  }, [request]);

  const refreshDiscover = useCallback(async () => {
    try {
      const data = await request('/api/groups/discover');
      setDiscoverGroups(data);
    } catch (error) {
      if (error.message !== 'Session expired') console.warn(error.message);
    }
  }, [request]);

  const refreshLeaderboard = useCallback(
    async (groupId = '', overrides = {}) => {
      const effectiveGroupId = groupId || selectedGroupId || groups[0]?.id || '';
      const orderBy = overrides.orderBy ?? groupOrderBy;
      const offset = overrides.offset ?? groupOffset;
      // Allow callers to override filters atomically (used by
      // applyLeaderboardFilters so we don't race state-set vs. fetch). Falls
      // back to the current slot otherwise.
      const filters = overrides.leaderboardFilters ?? leaderboardFilters;
      const params = new URLSearchParams();
      if (effectiveGroupId) params.set('groupId', effectiveGroupId);
      if (orderBy) params.set('orderBy', orderBy);
      if (offset) params.set('offset', String(offset));
      params.set('limit', String(groupLimit));
      if (filters.leagueId) params.set('leagueId', filters.leagueId);
      if (filters.seasonId) params.set('seasonId', filters.seasonId);
      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await request(`/api/leaderboard${query}`);
      setLeaderboard({
        overall: data.overall,
        group: data.group,
        groupMeta: data.groupMeta || null,
      });
    },
    [request, selectedGroupId, groups, groupOrderBy, groupOffset, leaderboardFilters],
  );

  // Atomic state-set + refresh. Mirrors applyGameFilters' guarantee that a
  // stale fetch can't race the state update.
  const applyLeaderboardFilters = useCallback(
    async (next) => {
      const normalized = { leagueId: next.leagueId || '', seasonId: next.seasonId || '' };
      setLeaderboardFiltersState(normalized);
      await refreshLeaderboard('', { leaderboardFilters: normalized });
    },
    [refreshLeaderboard],
  );

  const handleChangeGroupOrder = useCallback(
    async (next) => {
      setGroupOrderBy(next);
      setGroupOffset(0);
      await refreshLeaderboard('', { orderBy: next, offset: 0 });
    },
    [refreshLeaderboard],
  );

  const handleChangeGroupOffset = useCallback(
    async (next) => {
      setGroupOffset(next);
      await refreshLeaderboard('', { offset: next });
    },
    [refreshLeaderboard],
  );

  const handleGroupSelection = useCallback(
    async (event) => {
      const groupId = event.target.value;
      setSelectedGroupId(groupId);
      setGroupOffset(0);
      await refreshLeaderboard(groupId, { offset: 0 });
    },
    [refreshLeaderboard],
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const me = await request('/api/me');
      const { pendingInvites: invites, ...userData } = me;
      setUser(userData);
      setPendingInvites(invites || []);
      await refreshGames();
      const groupData = await refreshGroups();
      const initialGroupId =
        selectedGroupId && groupData.some((g) => g.id === selectedGroupId)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    request,
    setUser,
    refreshGames,
    refreshGroups,
    refreshPicks,
    refreshFriends,
    refreshDiscover,
  ]);

  // Anonymous boot path — fetch only the public endpoints. Used when /api/me
  // 401s on first load, and after logout to repopulate the public slots.
  const loadAnonDashboard = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([refreshGames(), refreshLeaderboard(''), refreshDiscover()]);
    } finally {
      setLoading(false);
    }
  }, [refreshGames, refreshLeaderboard, refreshDiscover]);

  // Initial boot. Try the authed path first; on 401 (no session) fall back to
  // the anonymous path so visitors land on a populated browse-mode dashboard.
  useEffect(() => {
    loadDashboard()
      .catch(async (error) => {
        if (
          error.status === 401 ||
          error.message === 'Session expired' ||
          error.message === 'Authentication required'
        ) {
          try {
            await loadAnonDashboard();
          } catch (anonError) {
            if (anonError.message !== 'Session expired') showStatus(anonError.message);
          }
          return;
        }
        showStatus(error.message);
      })
      .finally(() => setBootDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user flips back to null (logout / session-expired), clear only
  // the user-specific slots — public slots (games / leaderboard / discover)
  // stay populated so the anon browse view picks up where they left off.
  useEffect(() => {
    if (user) return;
    setGroups([]);
    setPicks([]);
    setPendingInvites([]);
    setSelectedGroupId('');
    setView('games');
    setFriends(emptyFriends);
    setOwnProfile(null);
  }, [user]);

  // Profile (own profile view) refetch when picks/games change.
  useEffect(() => {
    if (view !== 'profile' || !user?.username) return;
    request(`/api/users/${encodeURIComponent(user.username)}/profile`)
      .then(setOwnProfile)
      .catch((error) => {
        if (error.message !== 'Session expired') showStatus(error.message);
      });
  }, [view, user?.username, picks, games, request, showStatus]);

  // Background revalidation. The app used to be a one-shot snapshot at boot —
  // friend requests, group invites, scored picks, and live game state stayed
  // frozen until the user logged out/in. Now we re-fetch the user-scoped slots
  // when (a) the tab/PWA becomes visible (user returns from another app) and
  // (b) the service worker tells us a push just landed. Both signals are
  // debounced to once per 30s and skipped during anon browse to avoid 401s.
  const lastRevalidateRef = useRef(Date.now());
  const revalidatingRef = useRef(false);

  const revalidate = useCallback(async () => {
    if (!user) return;
    if (revalidatingRef.current) return;
    revalidatingRef.current = true;
    lastRevalidateRef.current = Date.now();
    try {
      const me = await request('/api/me');
      const { pendingInvites: invites, ...userData } = me;
      setUser(userData);
      setPendingInvites(invites || []);
      await Promise.all([
        refreshGames(),
        refreshGroups(),
        refreshPicks(),
        refreshLeaderboard(),
        refreshFriends(),
        refreshDiscover(),
      ]);
      // Tell the bell (and any other DOM-event listeners) to reload their
      // own state. Keeps the bell's poll lifecycle decoupled from this hook.
      window.dispatchEvent(new CustomEvent('scorecast:revalidate'));
    } catch (error) {
      if (error.message !== 'Session expired' && error.status !== 401) {
        console.warn('revalidate failed:', error.message);
      }
    } finally {
      revalidatingRef.current = false;
    }
  }, [
    user,
    request,
    setUser,
    refreshGames,
    refreshGroups,
    refreshPicks,
    refreshLeaderboard,
    refreshFriends,
    refreshDiscover,
  ]);

  useEffect(() => {
    if (!user) return undefined;

    const REVALIDATE_DEBOUNCE_MS = 30 * 1000;
    const maybeRevalidate = () => {
      if (Date.now() - lastRevalidateRef.current < REVALIDATE_DEBOUNCE_MS) return;
      revalidate();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') maybeRevalidate();
    };
    // SW push messages bypass the debounce — a push is a strong signal that
    // something the user cares about just changed; latency matters more than
    // a possible duplicate refresh against the visibilitychange handler.
    const onSwMessage = (event) => {
      if (event.data?.type === 'scorecast:push') {
        lastRevalidateRef.current = 0;
        revalidate();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', maybeRevalidate);
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', maybeRevalidate);
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
    };
  }, [user, revalidate]);

  // --- Pick mutations ----------------------------------------------------

  const submitPick = useCallback(
    async (gameId, choice) => {
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
    },
    [request, refreshGames, refreshPicks, refreshLeaderboard, showStatus],
  );

  const removePick = useCallback(
    async (pickId) => {
      try {
        await request(`/api/picks/${pickId}`, { method: 'DELETE' });
        await Promise.all([refreshPicks(), refreshLeaderboard()]);
        await showStatus('Pick removed');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshPicks, refreshLeaderboard, showStatus],
  );

  // --- Group mutations ---------------------------------------------------

  const handleCreateGroup = useCallback(
    async ({ name, visibility }) => {
      try {
        await request('/api/groups', {
          method: 'POST',
          body: JSON.stringify({ name, visibility }),
        });
        await Promise.all([refreshGroups(), refreshLeaderboard(), refreshDiscover()]);
        showStatus('Group created successfully');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshGroups, refreshLeaderboard, refreshDiscover, showStatus],
  );

  const handleLeaveGroup = useCallback(
    async (groupId) => {
      try {
        await request(`/api/groups/${groupId}/leave`, { method: 'POST' });
        await Promise.all([refreshGroups(), refreshLeaderboard(), refreshDiscover()]);
        showStatus('Left the group');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshGroups, refreshLeaderboard, refreshDiscover, showStatus],
  );

  const handleTransferGroup = useCallback(
    async (groupId, newOwnerId) => {
      try {
        await request(`/api/groups/${groupId}/transfer`, {
          method: 'POST',
          body: JSON.stringify({ newOwnerId }),
        });
        await refreshGroups();
        showStatus('Ownership transferred');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshGroups, showStatus],
  );

  const handleDeleteGroup = useCallback(
    async (groupId) => {
      try {
        await request(`/api/groups/${groupId}`, { method: 'DELETE' });
        await Promise.all([refreshGroups(), refreshLeaderboard(), refreshDiscover()]);
        showStatus('Group deleted');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshGroups, refreshLeaderboard, refreshDiscover, showStatus],
  );

  const handleJoinPublicGroup = useCallback(
    async (groupId) => {
      try {
        await request(`/api/groups/${groupId}/join`, { method: 'POST' });
        await Promise.all([refreshGroups(), refreshDiscover(), refreshLeaderboard()]);
        showStatus('Joined group');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshGroups, refreshDiscover, refreshLeaderboard, showStatus],
  );

  const handleInvite = useCallback(
    async (groupId, username) => {
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
    },
    [request, refreshGroups, refreshLeaderboard, showStatus],
  );

  const handleAcceptInvite = useCallback(
    async (groupId, inviteId) => {
      try {
        await request(`/api/groups/${groupId}/invite/${inviteId}/accept`, { method: 'POST' });
        await loadDashboard();
        showStatus('Invitation accepted!');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, loadDashboard, showStatus],
  );

  const handleDeclineInvite = useCallback(
    async (groupId, inviteId) => {
      try {
        await request(`/api/groups/${groupId}/invite/${inviteId}/decline`, { method: 'POST' });
        await loadDashboard();
        showStatus('Invitation declined');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, loadDashboard, showStatus],
  );

  // --- Friend mutations --------------------------------------------------

  const handleSendFriendRequest = useCallback(
    async (username) => {
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
    },
    [request, refreshFriends, showStatus],
  );

  const handleAcceptFriend = useCallback(
    async (id) => {
      try {
        await request(`/api/friends/${id}/accept`, { method: 'POST' });
        await refreshFriends();
        showStatus('Friend request accepted');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshFriends, showStatus],
  );

  const handleDeclineFriend = useCallback(
    async (id) => {
      try {
        await request(`/api/friends/${id}/decline`, { method: 'POST' });
        await refreshFriends();
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshFriends, showStatus],
  );

  const handleUnfriend = useCallback(
    async (id) => {
      try {
        await request(`/api/friends/${id}`, { method: 'DELETE' });
        await refreshFriends();
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, refreshFriends, showStatus],
  );

  // --- Profile -----------------------------------------------------------

  const fetchProfile = useCallback(
    async (username) => {
      if (!username) return;
      setProfileLoading(true);
      setProfileError(null);
      try {
        const data = await request(`/api/users/${encodeURIComponent(username)}/profile`);
        setProfile(data);
      } catch (error) {
        if (error.message === 'Session expired') {
          setProfile(null);
        } else {
          // Tier 8.6 — surface the 404 (private profile / not-friend) inline
          // in the drawer instead of toasting. Toasts feel like a network
          // error; the private-sheet is a deliberate UX state.
          setProfile(null);
          setProfileError(error.message || 'This profile is unavailable.');
        }
      } finally {
        setProfileLoading(false);
      }
    },
    [request],
  );

  const openProfile = useCallback(
    (username) => {
      setProfileUsername(username);
      setProfile(null);
      setProfileError(null);
      fetchProfile(username);
    },
    [fetchProfile],
  );

  const closeProfile = useCallback(() => {
    setProfileUsername('');
    setProfile(null);
    setProfileError(null);
  }, []);

  const handleFriendAction = useCallback(
    async (action) => {
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
    },
    [profile, request, fetchProfile, refreshFriends, showStatus],
  );

  const handleSaveProfile = useCallback(
    async (payload) => {
      try {
        const updated = await request('/api/me', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setUser((prev) =>
          prev
            ? {
                ...prev,
                displayName: updated.displayName,
                bio: updated.bio,
                profileVisibility: updated.profileVisibility,
              }
            : prev,
        );
        setOwnProfile((prev) =>
          prev
            ? {
                ...prev,
                displayName: updated.displayName,
                bio: updated.bio,
                profileVisibility: updated.profileVisibility,
              }
            : prev,
        );
        showStatus('Profile updated');
      } catch (error) {
        if (error.message !== 'Session expired') showStatus(error.message);
      }
    },
    [request, setUser, showStatus],
  );

  const value = {
    // request hook is also re-exported here so legacy consumers that imported
    // `request` from App.jsx as a prop can call useData().request instead.
    request,

    // UI state
    bootDone,
    loading,
    view,
    setView,

    // Data slots
    games,
    groups,
    picks,
    pendingInvites,
    leaderboard,
    groupOrderBy,
    groupOffset,
    groupLimit,
    selectedGroupId,
    setSelectedGroupId,
    friends,
    discoverGroups,
    ownProfile,
    profileUsername,
    profile,
    profileLoading,
    profileBusy,
    profileError,

    // Pick mutations
    submitPick,
    removePick,

    // Group mutations
    handleCreateGroup,
    handleLeaveGroup,
    handleTransferGroup,
    handleDeleteGroup,
    handleJoinPublicGroup,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,

    // Friend mutations
    handleSendFriendRequest,
    handleAcceptFriend,
    handleDeclineFriend,
    handleUnfriend,

    // Profile
    openProfile,
    closeProfile,
    handleFriendAction,
    handleSaveProfile,

    // Leaderboard tuning
    handleChangeGroupOrder,
    handleChangeGroupOffset,
    handleGroupSelection,

    // Reload all
    loadDashboard,
    loadAnonDashboard,

    // Refreshers (exposed for AdminPanel + niche callers)
    refreshGames,
    refreshPicks,
    refreshLeaderboard,

    // Tier 4b Chunk 3 — league/season picker
    gameFilters,
    applyGameFilters,

    // Leaderboard filter (shared by Leaderboard tab + My Picks tab)
    leaderboardFilters,
    applyLeaderboardFilters,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
