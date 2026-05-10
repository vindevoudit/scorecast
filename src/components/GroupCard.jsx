import InviteRow from './InviteRow';

function GroupCard({ group, onInvite }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">{group.name}</h2>
          <p className="text-sm text-slate-400">{group.members.length} member{group.members.length === 1 ? '' : 's'}</p>
        </div>
        <p className="rounded-full bg-slate-950/80 px-4 py-2 text-sm text-cyan-300">{group.id}</p>
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-3xl bg-slate-950/70 p-4">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Members</p>
          <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            {group.members.map((member) => {
              const userId = (member && typeof member === 'object' ? member.userId : member) || member;
              const username = (member && typeof member === 'object' ? member.username : member) || member;
              return (
                <span key={userId} className="rounded-2xl bg-slate-900/80 px-3 py-2">{username}</span>
              );
            })}
          </div>
        </div>

        <InviteRow groupId={group.id} onInvite={onInvite} />
      </div>
    </div>
  );
}

export default GroupCard;