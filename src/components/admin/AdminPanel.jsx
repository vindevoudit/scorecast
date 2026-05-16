// Tier 11 Chunk 2 — AdminPanel tokenized.

import GameManager from './GameManager';
import UserManager from './UserManager';

function AdminPanel() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-warning/40 bg-warning/5 p-5">
        <p className="text-xs uppercase tracking-[0.3em] text-warning">Admin tools</p>
        <p className="mt-2 text-sm text-fg">
          Changes here affect every user. Use the destructive actions carefully.
        </p>
      </div>
      <GameManager />
      <UserManager />
    </div>
  );
}

export default AdminPanel;
