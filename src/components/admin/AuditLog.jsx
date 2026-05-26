// Tier 4b Chunk 3 — AuditLog admin panel. Paginated read-only view of
// every admin mutation. Payload preview is opt-in per row (collapsed by
// default) so the table stays scannable.

import { useEffect, useState } from 'react';
import { Badge, Button } from '../ui';
import { useRequest } from '../../hooks/useRequest';
import { useNotifications } from '../../hooks/useNotifications';

const PAGE_SIZE = 25;

function statusTone(statusCode) {
  if (statusCode == null) return 'neutral';
  if (statusCode >= 500) return 'danger';
  if (statusCode >= 400) return 'warning';
  if (statusCode >= 200) return 'success';
  return 'neutral';
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
}

function PayloadPreview({ value, label }) {
  const [open, setOpen] = useState(false);
  if (!value) return null;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-2xl bg-overlay/60 px-3 py-2"
    >
      <summary className="cursor-pointer text-xs uppercase tracking-[0.18em] text-fg-muted">
        {label}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto text-xs text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function AuditRow({ entry }) {
  return (
    <div className="rounded-2xl bg-overlay/70 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-overlay px-2 py-0.5 font-mono text-xs text-fg-muted">
              {entry.action}
            </span>
            <Badge tone={statusTone(entry.statusCode)}>{entry.statusCode ?? '—'}</Badge>
            {entry.entityId ? (
              <span className="rounded-full bg-overlay px-2 py-0.5 font-mono text-xs text-fg-muted">
                {entry.entityType}:{entry.entityId.slice(0, 8)}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">
            {entry.actor ? entry.actor.username : 'unknown actor'} ·{' '}
            <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
            {entry.requestId ? ` · req ${entry.requestId.slice(0, 8)}` : ''}
          </p>
        </div>
      </div>
      {entry.before || entry.after ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <PayloadPreview value={entry.before} label="before" />
          <PayloadPreview value={entry.after} label="after" />
        </div>
      ) : null}
    </div>
  );
}

function AuditLog() {
  const request = useRequest();
  const { showStatus } = useNotifications();
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async (nextOffset = 0) => {
    setLoading(true);
    try {
      const data = await request(`/api/admin/audit-log?limit=${PAGE_SIZE}&offset=${nextOffset}`);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
      setOffset(data.offset ?? nextOffset);
    } catch (error) {
      if (error.message !== 'Session expired') showStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-fg">Audit log</h3>
          <p className="text-sm text-fg-muted">
            Every admin mutation, newest first. Payloads ≤ 4KB; larger bodies are truncated with a
            sentinel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => load(offset)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {loading ? 'Loading audit log…' : 'No audit entries yet.'}
          </p>
        ) : (
          entries.map((entry) => <AuditRow key={entry.id} entry={entry} />)
        )}
      </div>

      {entries.length > 0 ? (
        <div className="mt-4 flex items-center justify-between text-xs text-fg-muted">
          <span>
            Showing {offset + 1}–{Math.min(offset + entries.length, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev || loading}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => load(offset + PAGE_SIZE)}
              disabled={!hasNext || loading}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AuditLog;
