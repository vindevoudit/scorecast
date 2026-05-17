// Tier 11 Chunk 2 — AdminPanel tokenized.
// Tier 4b Chunk 1 — LeagueManager added above GameManager so the synced
// league + season context is visible when an admin scrolls down to games.
// Tier 4b Chunk 3 — AuditLog mounted at the bottom; non-mutating, paginated.

import LeagueManager from './LeagueManager';
import GameManager from './GameManager';
import UserManager from './UserManager';
import AuditLog from './AuditLog';

function AdminPanel() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-warning/40 bg-warning/5 p-5">
        <p className="text-xs uppercase tracking-[0.3em] text-warning">Admin tools</p>
        <p className="mt-2 text-sm text-fg">
          Changes here affect every user. Use the destructive actions carefully.
        </p>
      </div>
      <LeagueManager />
      <GameManager />
      <UserManager />
      <AuditLog />
    </div>
  );
}

export default AdminPanel;
