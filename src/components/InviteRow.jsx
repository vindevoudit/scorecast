import { useState } from 'react';

function InviteRow({ groupId, onInvite }) {
  const [inviteName, setInviteName] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (inviteName.trim()) {
          onInvite(groupId, inviteName.trim());
          setInviteName('');
        }
      }}
      className="rounded-3xl bg-slate-950/70 p-4"
    >
      <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Invite a friend</p>
      <div className="mt-3 flex gap-3">
        <input
          value={inviteName}
          onChange={(event) => setInviteName(event.target.value)}
          placeholder="Username"
          className="flex-1 rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400"
        />
        <button
          type="submit"
          className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-300 hover:bg-cyan-400"
        >
          Invite
        </button>
      </div>
    </form>
  );
}

export default InviteRow;