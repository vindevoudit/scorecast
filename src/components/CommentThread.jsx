// Tier 11 Chunk 2 — CommentThread migrated. Reaction toggle preserves its
// gate('react') wiring; the post composer (authed) becomes a tokenized
// Textarea + Button; anon visitors still get the InlineGatePanel fallback.

import { useEffect, useState } from 'react';
import { timeAgo } from '../utils/time';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import InlineGatePanel from './InlineGatePanel';
import { SkeletonCommentRow } from './Skeleton';
import { useRequest } from '../hooks/useRequest';
import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';
import { useNotifications } from '../hooks/useNotifications';
import { Button, Textarea } from './ui';

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
    <li className="rounded-2xl bg-overlay/70 px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span className="flex items-center gap-2 font-semibold text-fg">
          <Avatar username={comment.username} size={20} />
          {comment.username}
        </span>
        <span>
          {timeAgo(comment.createdAt)}
          {comment.editedAt ? <span className="ml-1 text-fg-subtle">(edited)</span> : null}
        </span>
      </div>

      {editing ? (
        <form onSubmit={submitEdit} className="mt-2 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{comment.body}</p>
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
              className={`rounded-full px-2 py-1 text-xs transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                mine
                  ? 'bg-accent/20 text-accent'
                  : count > 0
                    ? 'bg-elevated/80 text-fg hover:bg-elevated'
                    : 'text-fg-subtle hover:text-fg'
              }`}
            >
              {emoji}
              {count > 0 ? ` ${count}` : ''}
            </button>
          );
        })}
        {isAuthor && !editing ? (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-fg-subtle hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              className="text-xs text-fg-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CommentThread({ gameId }) {
  const request = useRequest();
  const { user } = useAuth();
  const { gate } = useAuthGate();
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
    if (!gate('react')) return;
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
    <div className="mt-4 border-t border-default pt-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="text-xs font-semibold uppercase tracking-[0.25em] text-accent transition duration-200 hover:text-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Show'} comments {comments.length > 0 ? `(${comments.length})` : ''}
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          {user ? (
            <form onSubmit={submit} className="space-y-2">
              <Textarea
                id={`comment-${gameId}`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Add some banter…"
                aria-label="Comment"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={submitting || !body.trim()}>
                  Post
                </Button>
              </div>
            </form>
          ) : (
            <InlineGatePanel
              label="comment"
              description="Join the conversation — sign up free or sign in to post."
            />
          )}

          {loading ? (
            <div className="space-y-2">
              <SkeletonCommentRow />
              <SkeletonCommentRow />
            </div>
          ) : comments.length === 0 ? (
            <EmptyState
              title="No comments yet"
              description={user ? 'Be the first to say something.' : 'Sign in to start the chat.'}
            />
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
      ) : null}
    </div>
  );
}

export default CommentThread;
