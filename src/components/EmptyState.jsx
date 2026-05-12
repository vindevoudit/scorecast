function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 px-6 py-10 text-center">
      <p className="text-base font-semibold text-slate-200">{title}</p>
      {description && <p className="mt-2 text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export default EmptyState;
