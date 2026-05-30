// Tier 11 Chunk 2 — AdminPanel tokenized.
// Tier 4b Chunk 1 — LeagueManager added above GameManager so the synced
// league + season context is visible when an admin scrolls down to games.
// Tier 4b Chunk 3 — AuditLog mounted at the bottom; non-mutating, paginated.
// Tier 30 Phase 1 Chunk 1.3 — vertical-stack restructured into SubTabs
// so each manager is a focused surface (Leagues / Games / Users / Audit)
// instead of one long scroll.

import LeagueManager from './LeagueManager';
import GameManager from './GameManager';
import UserManager from './UserManager';
import AuditLog from './AuditLog';
import SubTabs from '../SubTabs';

function AdminPanel() {
  const tabs = [
    { value: 'leagues', label: 'Leagues', content: <LeagueManager /> },
    { value: 'games', label: 'Games', content: <GameManager /> },
    { value: 'users', label: 'Users', content: <UserManager /> },
    { value: 'audit', label: 'Audit', content: <AuditLog /> },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-warning/40 bg-warning/5 p-5">
        <p className="text-xs uppercase tracking-[0.3em] text-warning">Admin tools</p>
        <p className="mt-2 text-sm text-fg">
          Changes here affect every user. Use the destructive actions carefully.
        </p>
      </div>
      {/* Games is the default — most admin work touches the GameManager
          (set results, create new games, sync from football-data.org). */}
      <SubTabs tabs={tabs} defaultValue="games" ariaLabel="Admin sections" />
    </div>
  );
}

export default AdminPanel;
