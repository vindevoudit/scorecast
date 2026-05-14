import GameManager from './GameManager';
import UserManager from './UserManager';

// Tier 13 Chunk 5 — AdminPanel is now a layout shell. GameManager and
// UserManager each consume request + showStatus + (for GameManager) the
// DataContext refreshers via hooks.
function AdminPanel() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-amber-800/50 bg-amber-950/30 p-5">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">Admin tools</p>
        <p className="mt-2 text-sm text-amber-100/80">
          Changes here affect every user. Use the destructive actions carefully.
        </p>
      </div>
      <GameManager />
      <UserManager />
    </div>
  );
}

export default AdminPanel;
