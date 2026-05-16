// Tier 11 Chunk 2 — EmptyState. Tokenized + optional `icon` slot for the
// states pass in Wave F.

function EmptyState({ title, description, action, icon }) {
  return (
    <div className="rounded-3xl border border-dashed border-default bg-elevated/50 px-6 py-10 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-fg-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="mt-2 text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
