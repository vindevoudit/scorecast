import { useEffect, useState } from 'react';
import { timeAgo } from '../utils/time';

function CommentThread({ gameId, currentUserId, request, onError }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await request(`/api/games/${gameId}/comments`);
      setComments(data);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && comments.length === 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const created = await request(`/api/games/${gameId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: body.trim() }),
      });
      setComments((prev) => [created, ...prev]);
      setBody('');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id) => {
    try {
      await request(`/api/comments/${id}`, { method: 'DELETE' });
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (error) {
      onError?.(error.message);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300 transition duration-200 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Show'} comments {comments.length > 0 && `(${comments.length})`}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <form onSubmit={submit} className="space-y-2">
            <label htmlFor={`comment-${gameId}`} className="sr-only">Comment</label>
            <textarea
              id={`comment-${gameId}`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Add some banter…"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition duration-200 focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !body.trim()}
                className="rounded-2xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition duration-200 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Post
              </button>
            </div>
          </form>

          {loading ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-slate-500">No comments yet — be the first.</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-2xl bg-slate-950/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{c.username}</span>
                    <span>{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{c.body}</p>
                  {c.userId === currentUserId && (
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        className="text-xs text-slate-500 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default CommentThread;
