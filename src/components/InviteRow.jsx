// Tier 11 Chunk 2 — InviteRow migrated.

import { useId, useState } from 'react';
import { Button } from './ui';

function InviteRow({ groupId, onInvite }) {
  const [inviteName, setInviteName] = useState('');
  const inputId = useId();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (inviteName.trim()) {
          onInvite(groupId, inviteName.trim());
          setInviteName('');
        }
      }}
      className="rounded-3xl bg-overlay/70 p-4"
    >
      <label htmlFor={inputId} className="text-sm uppercase tracking-[0.24em] text-fg-muted">
        Invite a friend
      </label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id={inputId}
          value={inviteName}
          onChange={(event) => setInviteName(event.target.value)}
          placeholder="Username"
          autoComplete="off"
          className="flex-1 rounded-2xl border border-default bg-elevated/90 px-4 py-3 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button type="submit" size="lg">
          Invite
        </Button>
      </div>
    </form>
  );
}

export default InviteRow;
