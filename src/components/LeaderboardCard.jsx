function LeaderboardCard({ title, entries }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-slate-400">Top performers based on correct picks and probability scoring.</p>
      <div className="mt-6 space-y-3">
        {entries.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/70 px-4 py-5 text-sm text-slate-400">No leaderboard data yet.</p>
        ) : (
          entries.map((entry, index) => (
            <div key={entry.userId} className="flex items-center justify-between rounded-3xl bg-slate-950/70 px-4 py-4 transition duration-300 hover:bg-slate-900/95">
              <div className="text-sm text-slate-300">{index + 1}. {entry.username}</div>
              <div className="text-sm font-semibold text-white">{entry.points}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LeaderboardCard;