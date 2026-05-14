import { useState } from 'react';
import EmptyState from './EmptyState';

function FriendsList({
  friends,
  incoming,
  outgoing,
  onSendRequest,
  onAccept,
  onDecline,
  onCancel,
  onUnfriend,
  onSelectUser,
}) {
  const [username, setUsername] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!username.trim()) return;
    await onSendRequest(username.trim());
    setUsername('');
  };

  const renderRow = (entry, actions) => (
    <div
      key={entry.id}
      className="flex flex-col gap-2 rounded-2xl bg-slate-950/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        onClick={() => onSelectUser?.(entry.username)}
        className="min-w-0 truncate text-left text-sm font-semibold text-white hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        {entry.username}
      </button>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );

  const primaryBtn = (label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      {label}
    </button>
  );

  const ghostBtn = (label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-600 bg-slate-900/90 px-4 py-2 text-xs font-semibold text-slate-200 transition duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <h2 className="text-2xl font-semibold text-white">Friends</h2>
      <p className="mt-2 text-sm text-slate-400">
        Send a request by username. Once accepted, you'll see head-to-head records on profiles.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="friend-username" className="sr-only">
          Username
        </label>
        <input
          id="friend-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          className="flex-1 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        />
        <button
          type="submit"
          className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Send request
        </button>
      </form>

      {incoming.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
            Incoming requests
          </h3>
          <div className="mt-3 space-y-2">
            {incoming.map((entry) =>
              renderRow(entry, [
                primaryBtn('Accept', () => onAccept(entry.id)),
                ghostBtn('Decline', () => onDecline(entry.id)),
              ]),
            )}
          </div>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
            Outgoing requests
          </h3>
          <div className="mt-3 space-y-2">
            {outgoing.map((entry) =>
              renderRow(entry, [ghostBtn('Cancel', () => onCancel(entry.id))]),
            )}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
          Friends
        </h3>
        <div className="mt-3 space-y-2">
          {friends.length === 0 ? (
            <EmptyState title="No friends yet" description="Send a request above to get started." />
          ) : (
            friends.map((entry) =>
              renderRow(entry, [ghostBtn('Unfriend', () => onUnfriend(entry.id))]),
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default FriendsList;
