import { useEffect, useMemo, useState } from 'react';
import GameCard from './components/GameCard';
import LeaderboardCard from './components/LeaderboardCard';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import GroupCard from './components/GroupCard';
import GroupLeaderboardCard from './components/GroupLeaderboardCard';

const initialAuthData = {
  loginUsername: '',
  loginPassword: '',
  registerUsername: '',
  registerPassword: '',
  groupName: '',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const [token, setToken] = useState(localStorage.getItem('scorecastToken') || '');
  const [user, setUser] = useState(null);
  const [games, setGames] = useState([]);
  const [groups, setGroups] = useState([]);
  const [picks, setPicks] = useState([]);
  const [leaderboard, setLeaderboard] = useState({ overall: [], group: [] });
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [view, setView] = useState('games');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [authData, setAuthData] = useState(initialAuthData);

  const currentGroupId = useMemo(() => groups[0]?.id || '', [groups]);
  const pickMap = useMemo(
    () => new Map(picks.map((pick) => [pick.gameId, pick.choice])),
    [picks]
  );

  const authHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const showStatus = async (message) => {
    setStatus(message);
    await delay(3500);
    setStatus('');
  };

  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: { ...(options.headers || {}), ...authHeaders() },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  };

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
      setUser(me);
      await refreshGames();
      const groupData = await refreshGroups();
      const initialGroupId = selectedGroupId && groupData.some((group) => group.id === selectedGroupId)
        ? selectedGroupId
        : groupData[0]?.id || '';
      setSelectedGroupId(initialGroupId);
      await Promise.all([refreshPicks(), refreshLeaderboard(initialGroupId)]);
      setView('games');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    localStorage.setItem('scorecastToken', token);
    loadDashboard().catch((error) => showStatus(error.message));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    localStorage.setItem('scorecastToken', token);
    loadDashboard().catch((error) => showStatus(error.message));
  }, []);

  const handleLogout = () => {
    setToken('');
    setUser(null);
    setGames([]);
    setGroups([]);
    setPicks([]);
    setLeaderboard({ overall: [], group: [] });
    localStorage.removeItem('scorecastToken');
    setView('games');
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
      showStatus(error.message);
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
        body: JSON.stringify({ name: authData.groupName }),
      });
      setAuthData((prev) => ({ ...prev, groupName: '' }));
      await Promise.all([refreshGroups(), refreshLeaderboard()]);
      showStatus('Group created successfully');
    } catch (error) {
      showStatus(error.message);
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
      showStatus(error.message);
    }
  };

  const dashboard = (
    <div className="space-y-6">
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
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid auto-cols-fr gap-3 sm:grid-cols-3">
          {['games', 'groups', 'leaderboard'].map((tab) => (
            <button
              key={tab}
              onClick={() => setView(tab)}
              className={`rounded-3xl border px-5 py-4 text-left transition-all duration-300 ${view === tab ? 'border-cyan-400 bg-cyan-500/10 text-white shadow-[0_10px_30px_rgba(6,182,212,0.18)]' : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-900/95'}`}
            >
              <span className="block text-sm uppercase tracking-[0.24em] text-slate-400">{tab === 'games' ? 'Games' : tab === 'groups' ? 'Groups' : 'Leaderboards'}</span>
              <span className="mt-2 block text-lg font-semibold text-white">
                {tab === 'games' ? 'Upcoming Matches' : tab === 'groups' ? 'My Groups' : 'Rankings'}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={handleLogout}
          className="inline-flex items-center justify-center rounded-3xl bg-slate-800 px-6 py-4 text-sm font-semibold text-cyan-300 transition duration-300 hover:bg-cyan-500/20"
        >
          Logout
        </button>
      </section>

      <section className="space-y-6">
        {view === 'games' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold text-white">Upcoming Games</h2>
                    <p className="mt-2 text-slate-400">Pick winners, earn more points for underdog upsets.</p>
                  </div>
                  <span className="rounded-full bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300">Future-proof picks only</span>
                </div>
              </div>

              <div className="space-y-4">
                {games.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      existingPick={pickMap.get(game.id)}
                      onPickSubmit={submitPick}
                    />
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.4)]">
                <h2 className="text-2xl font-semibold text-white">Live leaderboard</h2>
                <p className="mt-2 text-slate-400">Track your progress and compare with friends.</p>
                <div className="mt-5 space-y-4">
                  <div className="rounded-3xl bg-slate-950/70 p-4">
                    <h3 className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">Overall</h3>
                    <div className="mt-4 space-y-3">
                      {leaderboard.overall.slice(0, 3).map((entry, index) => (
                        <div key={entry.userId} className="flex items-center justify-between rounded-2xl bg-slate-900/80 px-4 py-3">
                          <div className="text-sm text-slate-300">{index + 1}. {entry.username}</div>
                          <div className="text-sm font-semibold text-white">{entry.points}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-3xl bg-slate-950/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">Group leaderboard</h3>
                        <p className="mt-2 text-sm text-slate-400">Select one group to view its ranking.</p>
                      </div>
                      {groups.length > 0 ? (
                        <select
                          value={selectedGroupId}
                          onChange={handleGroupSelection}
                          className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400 sm:w-auto"
                        >
                          {groups.map((group) => (
                            <option key={group.id} value={group.id}>{group.name}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-sm text-slate-500">Join or create a group to see member rankings.</p>
                      )}
                    </div>
                    <div className="mt-4 space-y-3">
                      {leaderboard.group.length === 0 ? (
                        <p className="rounded-3xl bg-slate-950/70 px-4 py-5 text-sm text-slate-400">No group leaderboard data yet.</p>
                      ) : (
                        leaderboard.group.slice(0, 3).map((entry, index) => (
                          <div key={entry.userId} className="flex items-center justify-between rounded-2xl bg-slate-900/80 px-4 py-3">
                            <div className="text-sm text-slate-300">{index + 1}. {entry.username}</div>
                            <div className="text-sm font-semibold text-white">{entry.points}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'groups' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,0.95fr)]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
              <h2 className="text-2xl font-semibold text-white">Create a new group</h2>
              <p className="mt-2 text-slate-400">Invite friends and compare scores in your private pool.</p>
              <form onSubmit={handleCreateGroup} className="mt-6 space-y-4">
                <input
                  value={authData.groupName}
                  onChange={(event) => setAuthData((prev) => ({ ...prev, groupName: event.target.value }))}
                  placeholder="Group name"
                  className="w-full rounded-3xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-white outline-none transition duration-200 focus:border-cyan-400"
                />
                <button type="submit" className="inline-flex rounded-3xl bg-cyan-500 px-6 py-4 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400">
                  Create group
                </button>
              </form>
            </div>

            <div className="space-y-4">
              {groups.map((group) => (
                <GroupCard key={group.id} group={group} onInvite={handleInvite} />
              ))}
            </div>
          </div>
        )}

        {view === 'leaderboard' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <LeaderboardCard title="Overall Leaderboard" entries={leaderboard.overall} />
            <GroupLeaderboardCard
              groups={groups}
              selectedGroupId={selectedGroupId}
              onGroupSelection={handleGroupSelection}
              leaderboardGroup={leaderboard.group}
            />
          </div>
        )}
      </section>
    </div>
  );

  const authPanel = (
    <div className="grid gap-6 lg:grid-cols-2">
      <LoginForm authData={authData} setAuthData={setAuthData} onSubmit={handleLogin} />
      <RegisterForm authData={authData} setAuthData={setAuthData} onSubmit={handleRegister} />
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
                Beautiful football predictions for your group.
              </h1>
              <p className="mt-4 max-w-2xl text-slate-400 sm:text-lg">
                Pick match winners, manage groups, and earn points for risky calls with a polished responsive interface.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-5 text-center shadow-[0_24px_80px_rgba(15,23,42,0.4)]">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Predict & Win</p>
              <p className="mt-3 text-2xl font-semibold text-white">ScoreCast</p>
              <p className="mt-2 text-sm text-slate-400">Make smart picks, earn points, dominate leaderboards.</p>
            </div>
          </div>

          {status && (
            <div className="rounded-3xl border border-cyan-500/30 bg-slate-950/90 px-5 py-4 text-sm text-cyan-200 shadow-[0_20px_60px_rgba(6,182,212,0.12)] transition duration-300">
              {status}
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid min-h-[40vh] place-items-center rounded-3xl border border-slate-800 bg-slate-900/85 p-10 text-slate-300 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
            <div className="flex items-center gap-3 text-lg font-medium">
              <div className="h-3 w-3 animate-pulse rounded-full bg-cyan-400" />
              Loading your dashboard...
            </div>
          </div>
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

