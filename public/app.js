const state = {
  token: null,
  user: null,
  games: [],
  groups: [],
  picks: [],
};

const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const userWidget = document.getElementById('user-widget');
const gamesView = document.getElementById('games-view');
const groupsView = document.getElementById('groups-view');
const leaderboardView = document.getElementById('leaderboard-view');
const gamesContainer = document.getElementById('games-container');
const groupsContainer = document.getElementById('groups-container');
const leaderboardSummary = document.getElementById('leaderboard-summary');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const groupForm = document.getElementById('group-form');
const showGamesButton = document.getElementById('show-games');
const showGroupsButton = document.getElementById('show-groups');
const showLeaderboardButton = document.getElementById('show-leaderboard');
const logoutButton = document.getElementById('logout-button');

const gameTemplate = document.getElementById('game-row-template');
const groupTemplate = document.getElementById('group-card-template');
const leaderboardTemplate = document.getElementById('leaderboard-template');

function setToken(token) {
  state.token = token;
  localStorage.setItem('scorecastToken', token || '');
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  return headers;
}

async function request(path, options = {}) {
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
}

function showMessage(message) {
  alert(message);
}

function showView(view) {
  gamesView.classList.toggle('hidden', view !== 'games');
  groupsView.classList.toggle('hidden', view !== 'groups');
  leaderboardView.classList.toggle('hidden', view !== 'leaderboard');
}

function formatDate(dateText) {
  const date = new Date(dateText);
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatProbability(value) {
  return `${Math.round(value * 100)}%`;
}

function buildScoreEstimate(probability) {
  return `${100 - Math.round(probability * 100)} points if correct`;
}

function isUpcomingGame(game) {
  return !game.result && new Date(game.date) > new Date();
}

function renderUserWidget() {
  userWidget.innerHTML = `
    <div class="card">
      <strong>Logged in as ${state.user.username}</strong>
      <div class="small-form">
        <span>${state.user.joinedGroups.length} groups</span>
      </div>
    </div>
  `;
}

function renderGames() {
  gamesContainer.innerHTML = '';
  state.games.forEach((game) => {
    const clone = gameTemplate.content.cloneNode(true);
    const card = clone.querySelector('.game-row');
    clone.querySelector('.home-team').textContent = game.homeTeam;
    clone.querySelector('.away-team').textContent = game.awayTeam;
    clone.querySelector('.home-prob').textContent = formatProbability(game.homeProbability);
    clone.querySelector('.away-prob').textContent = formatProbability(game.awayProbability);
    clone.querySelector('.game-date').textContent = formatDate(game.date);
    const upcoming = isUpcomingGame(game);
    clone.querySelector('.game-result').textContent = game.result
      ? `Result: ${game.result === 'home' ? game.homeTeam : game.awayTeam} won`
      : upcoming
        ? 'Status: upcoming'
        : 'Status: closed';
    clone.querySelector('.game-forecast').textContent =
      `Correct home pick: ${buildScoreEstimate(game.homeProbability)} · correct away pick: ${buildScoreEstimate(game.awayProbability)}`;

    const homeButton = clone.querySelector('.home-pick');
    const awayButton = clone.querySelector('.away-pick');
    homeButton.disabled = !upcoming;
    awayButton.disabled = !upcoming;
    if (upcoming) {
      homeButton.addEventListener('click', () => submitPick(game.id, 'home'));
      awayButton.addEventListener('click', () => submitPick(game.id, 'away'));
    }

    const existingPick = state.picks.find((pick) => pick.gameId === game.id);
    if (existingPick) {
      const status = document.createElement('div');
      status.textContent = `Your pick: ${existingPick.choice === 'home' ? game.homeTeam : game.awayTeam}`;
      status.style.marginTop = '10px';
      card.appendChild(status);
    }

    gamesContainer.appendChild(clone);
  });
}

function renderGroups() {
  groupsContainer.innerHTML = '';
  if (state.groups.length === 0) {
    groupsContainer.innerHTML =
      '<p class="card">You have no groups yet. Create one to start inviting friends.</p>';
    return;
  }

  state.groups.forEach((group) => {
    const clone = groupTemplate.content.cloneNode(true);
    clone.querySelector('h3').textContent = group.name;
    clone.querySelector('.group-members').textContent = `${group.members.length} members`;
    clone.querySelector('.group-id').textContent = `Group ID: ${group.id}`;

    const inviteForm = clone.querySelector('.invite-form');
    const inviteInput = inviteForm.querySelector('input');
    const inviteStatus = clone.querySelector('.invite-status');

    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await request(`/api/groups/${group.id}/invite`, {
          method: 'POST',
          body: JSON.stringify({ username: inviteInput.value.trim() }),
        });
        inviteStatus.textContent = `${inviteInput.value.trim()} invited successfully.`;
        inviteInput.value = '';
        await refreshGroups();
      } catch (error) {
        inviteStatus.textContent = error.message;
      }
    });

    groupsContainer.appendChild(clone);
  });
}

function renderLeaderboards(data) {
  leaderboardSummary.innerHTML = '';

  const overall = data.overall;
  const group = data.group;

  const overallClone = leaderboardTemplate.content.cloneNode(true);
  overallClone.querySelector('h3').textContent = 'Overall Leaderboard';
  const overallBody = overallClone.querySelector('tbody');
  overall.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${index + 1}</td><td>${entry.username}</td><td>${entry.points}</td>`;
    overallBody.appendChild(row);
  });
  leaderboardSummary.appendChild(overallClone);

  if (group.length > 0) {
    const groupClone = leaderboardTemplate.content.cloneNode(true);
    groupClone.querySelector('h3').textContent = 'Group Leaderboard';
    const groupBody = groupClone.querySelector('tbody');
    group.forEach((entry, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${index + 1}</td><td>${entry.username}</td><td>${entry.points}</td>`;
      groupBody.appendChild(row);
    });
    leaderboardSummary.appendChild(groupClone);
  }
}

async function refreshGames() {
  const data = await request('/api/games');
  state.games = data.sort((a, b) => new Date(a.date) - new Date(b.date));
  renderGames();
}

async function refreshGroups() {
  const data = await request('/api/groups');
  state.groups = data;
  renderGroups();
}

async function refreshPicks() {
  state.picks = await request('/api/picks');
}

async function refreshLeaderboard() {
  const groupId = state.groups[0]?.id;
  const data = await request(`/api/leaderboard${groupId ? `?groupId=${groupId}` : ''}`);
  renderLeaderboards(data);
}

async function submitPick(gameId, choice) {
  try {
    await request('/api/picks', {
      method: 'POST',
      body: JSON.stringify({ gameId, choice }),
    });
    showMessage('Pick saved successfully');
    await refreshPicks();
    renderGames();
  } catch (error) {
    showMessage(error.message);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  try {
    const data = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    state.user = data.user;
    await initializeDashboard();
  } catch (error) {
    showMessage(error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value.trim();
  try {
    const data = await request('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    state.user = data.user;
    await initializeDashboard();
  } catch (error) {
    showMessage(error.message);
  }
}

async function handleCreateGroup(event) {
  event.preventDefault();
  const name = document.getElementById('group-name').value.trim();
  if (!name) return;
  try {
    await request('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    document.getElementById('group-name').value = '';
    await refreshGroups();
    showMessage('Group created successfully');
  } catch (error) {
    showMessage(error.message);
  }
}

function showAuthenticatedUI() {
  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  renderUserWidget();
  showView('games');
}

async function initializeDashboard() {
  try {
    const me = await request('/api/me');
    state.user = me;
    if (!state.token) {
      const saved = localStorage.getItem('scorecastToken');
      if (saved) setToken(saved);
    }
    showAuthenticatedUI();
    await Promise.all([refreshGames(), refreshGroups(), refreshPicks(), refreshLeaderboard()]);
  } catch (error) {
    setToken(null);
    state.user = null;
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
  }
}

function handleLogout() {
  setToken(null);
  state.user = null;
  authSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
  showView('games');
}

loginForm.addEventListener('submit', handleLogin);
registerForm.addEventListener('submit', handleRegister);
groupForm.addEventListener('submit', handleCreateGroup);
showGamesButton.addEventListener('click', () => showView('games'));
showGroupsButton.addEventListener('click', () => showView('groups'));
showLeaderboardButton.addEventListener('click', async () => {
  showView('leaderboard');
  await refreshLeaderboard();
});
logoutButton.addEventListener('click', handleLogout);

window.addEventListener('load', async () => {
  const savedToken = localStorage.getItem('scorecastToken');
  if (savedToken) {
    setToken(savedToken);
    await initializeDashboard();
  }
});
