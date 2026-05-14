import { useEffect, useState } from 'react';
import { timeAgo } from '../utils/time';
import Avatar from './Avatar';
import { useRequest } from '../hooks/useRequest';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

function CommentRow({ comment, currentUserId, onEdit, onDelete, onToggleReaction }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const isAuthor = comment.userId === currentUserId;

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!draft.trim() || draft.trim() === comment.body) {
      setEditing(false);
      return;
    }
    await onEdit(comment.id, draft.trim());
    setEditing(false);
  };

  return (
    <li className="rounded-2xl bg-slate-950/70 px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
        <span className="flex items-center gap-2 font-semibold text-slate-200">
          <Avatar username={comment.username} size={20} />
          {comment.username}
        </span>
        <span>
          {timeAgo(comment.createdAt)}
          {comment.editedAt && <span className="ml-1 text-slate-500">(edited)</span>}
        </span>
      </div>

      {editing ? (
        <form onSubmit={submitEdit} className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              className="rounded-2xl border border-slate-600 bg-slate-900/90 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-2xl bg-cyan-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Save
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{comment.body}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {REACTION_EMOJIS.map((emoji) => {
          const count = comment.reactionCounts?.[emoji] || 0;
          const mine = (comment.yourReactions || []).includes(emoji);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggleReaction(comment.id, emoji, mine)}
              className={`rounded-full px-2 py-1 text-xs transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                mine
                  ? 'bg-cyan-500/20 text-cyan-100'
                  : count > 0
                    ? 'bg-slate-900/80 text-slate-200 hover:bg-slate-900'
                    : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {emoji}
              {count > 0 ? ` ${count}` : ''}
            </button>
          );
        })}
        {isAuthor && !editing && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-slate-500 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              className="text-xs text-slate-500 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function CommentThread({ gameId }) {
  // Tier 13 Chunk 5 — was driven by props; now reads request + currentUserId
  // + showStatus from the surrounding contexts directly.
  const request = useRequest();
  const { user } = useAuth();
  const { showStatus } = useNotifications();
  const currentUserId = user?.id;
  const onError = (msg) => {
    if (msg && msg !== 'Session expired') showStatus(msg);
  };
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

  const editComment = async (id, nextBody) => {
    try {
      const updated = await request(`/api/comments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ body: nextBody }),
      });
      setComments((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, body: updated.body, editedAt: updated.editedAt } : c,
        ),
      );
    } catch (error) {
      onError?.(error.message);
    }
  };

  const toggleReaction = async (commentId, emoji, currentlyMine) => {
    const setLocal = (mutator) => {
      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== commentId) return c;
          return mutator(c);
        }),
      );
    };
    if (currentlyMine) {
      setLocal((c) => ({
        ...c,
        yourReactions: (c.yourReactions || []).filter((e) => e !== emoji),
        reactionCounts: {
          ...c.reactionCounts,
          [emoji]: Math.max(0, (c.reactionCounts?.[emoji] || 1) - 1),
        },
      }));
      try {
        await request(`/api/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        onError?.(error.message);
        load();
      }
    } else {
      setLocal((c) => ({
        ...c,
        yourReactions: [...(c.yourReactions || []), emoji],
        reactionCounts: { ...c.reactionCounts, [emoji]: (c.reactionCounts?.[emoji] || 0) + 1 },
      }));
      try {
        await request(`/api/comments/${commentId}/reactions`, {
          method: 'POST',
          body: JSON.stringify({ emoji }),
        });
      } catch (error) {
        onError?.(error.message);
        load();
      }
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
            <label htmlFor={`comment-${gameId}`} className="sr-only">
              Comment
            </label>
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
                <CommentRow
                  key={c.id}
                  comment={c}
                  currentUserId={currentUserId}
                  onEdit={editComment}
                  onDelete={remove}
                  onToggleReaction={toggleReaction}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default CommentThread;
