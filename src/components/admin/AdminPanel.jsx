import GameManager from './GameManager';
import UserManager from './UserManager';

function AdminPanel({ request, currentUserId, onAfterGameChange, onError, onSuccess }) {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-amber-800/50 bg-amber-950/30 p-5">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">Admin tools</p>
        <p className="mt-2 text-sm text-amber-100/80">
          Changes here affect every user. Use the destructive actions carefully.
        </p>
      </div>
      <GameManager
        request={request}
        onAfterChange={onAfterGameChange}
        onError={onError}
        onSuccess={onSuccess}
      />
      <UserManager
        request={request}
        currentUserId={currentUserId}
        onError={onError}
        onSuccess={onSuccess}
      />
    </div>
  );
}

export default AdminPanel;
