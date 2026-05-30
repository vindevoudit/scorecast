// Tier 30 Phase 1 Chunk 1.3 — GroupsView. Lifts the in-line Groups
// surface out of DashboardView and into a dedicated view with three
// sub-tabs:
//
//   My Groups → cards for groups the user is a member of
//   Discover  → public groups + Join CTA (only surface anon visitors get)
//   Invites   → pending invites accept/decline
//
// "Create a new group" is no longer a side-by-side form: a `+ New group`
// pill in the My Groups sub-tab opens CreateGroupModal. Anon visitors
// still hit InlineGatePanel for create + invites; Discover is the only
// part anon sees populated.

import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import EmptyState from '../components/EmptyState';
import GroupCard from '../components/GroupCard';
import GroupNameDisplay from '../components/GroupNameDisplay';
import InlineGatePanel from '../components/InlineGatePanel';
import CreateGroupModal from '../components/CreateGroupModal';
import SubTabs from '../components/SubTabs';
import { Button } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useAuthGate } from '../hooks/useAuthGate';
import { useData } from '../hooks/useData';

function MyGroupsSection({ user, groups, currentUserId, handlers, onOpenCreate }) {
  if (!user) {
    return (
      <InlineGatePanel
        label="create or join a group"
        description="Build a private league and invite your friends — sign up free or sign in."
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Groups you own or have joined. Each one has its own leaderboard.
        </p>
        <Button onClick={onOpenCreate} variant="primary" size="sm">
          + New group
        </Button>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          description="Create your first group, or check Discover for a public group to join."
        />
      ) : (
        groups.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            currentUserId={currentUserId}
            onInvite={handlers.onInvite}
            onLeave={handlers.onLeave}
            onTransfer={handlers.onTransfer}
            onDelete={handlers.onDelete}
          />
        ))
      )}
    </div>
  );
}

function DiscoverSection({ discoverGroups, gate, onJoinPublic }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        Public groups that anyone can join. Owners can switch a group to private at any time.
      </p>
      {discoverGroups.length === 0 ? (
        <EmptyState
          title="No public groups right now"
          description="Check back later, or invite friends to a private group of your own."
        />
      ) : (
        discoverGroups.map((group) => (
          <div
            key={group.id}
            className="flex flex-col gap-3 rounded-2xl bg-overlay/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">
                <GroupNameDisplay group={group} />
              </p>
              <p className="text-xs text-fg-muted">
                {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (!gate('join a group')) return;
                onJoinPublic(group.id);
              }}
            >
              Join
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

function InvitesSection({ user, pendingInvites, onAccept, onDecline }) {
  const [invitesRef] = useAutoAnimate({ duration: 180, easing: 'ease-out' });
  if (!user) {
    return (
      <InlineGatePanel
        label="see your invites"
        description="Sign in to view group invitations and accept the ones you want."
      />
    );
  }
  if (pendingInvites.length === 0) {
    return (
      <EmptyState
        title="No pending invitations"
        description="Group invites from other members will show up here."
      />
    );
  }
  return (
    <div ref={invitesRef} className="space-y-3">
      {pendingInvites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-col gap-3 rounded-3xl bg-overlay/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm text-fg">Invited to join</p>
            <p className="mt-1 truncate font-semibold text-fg">
              <GroupNameDisplay
                group={{
                  name: invite.groupName,
                  discriminator: invite.groupDiscriminator,
                }}
              />
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onAccept(invite.groupId, invite.id)}>Accept</Button>
            <Button variant="secondary" onClick={() => onDecline(invite.groupId, invite.id)}>
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupsView() {
  const { user } = useAuth();
  const { gate } = useAuthGate();
  const {
    groups,
    pendingInvites,
    discoverGroups,
    handleCreateGroup,
    handleLeaveGroup,
    handleTransferGroup,
    handleDeleteGroup,
    handleJoinPublicGroup,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,
  } = useData();

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const onCreate = async (payload) => {
    setCreating(true);
    try {
      await handleCreateGroup(payload);
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const myGroupsLabel = `My Groups${groups.length > 0 ? ` (${groups.length})` : ''}`;
  const invitesLabel = `Invites${pendingInvites.length > 0 ? ` (${pendingInvites.length})` : ''}`;

  const tabs = [
    {
      value: 'my',
      label: myGroupsLabel,
      content: (
        <MyGroupsSection
          user={user}
          groups={groups}
          currentUserId={user?.id}
          handlers={{
            onInvite: handleInvite,
            onLeave: handleLeaveGroup,
            onTransfer: handleTransferGroup,
            onDelete: handleDeleteGroup,
          }}
          onOpenCreate={() => {
            if (!gate('create a group')) return;
            setCreateOpen(true);
          }}
        />
      ),
    },
    {
      value: 'discover',
      label: 'Discover',
      content: (
        <DiscoverSection
          discoverGroups={discoverGroups}
          gate={gate}
          onJoinPublic={handleJoinPublicGroup}
        />
      ),
    },
    {
      value: 'invites',
      label: invitesLabel,
      content: (
        <InvitesSection
          user={user}
          pendingInvites={pendingInvites}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      ),
    },
  ];

  // Anon visitors land on Discover by default (the only sub-tab with
  // populated content for them); authed users land on My Groups.
  const defaultValue = user ? 'my' : 'discover';

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <div className="mb-5 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.25em] text-accent/80">Community</p>
        <h2 className="text-2xl font-semibold text-fg">Groups</h2>
        <p className="text-sm text-fg-muted">
          Compete inside private leagues, or discover a public group to join.
        </p>
      </div>
      <SubTabs tabs={tabs} defaultValue={defaultValue} ariaLabel="Groups sections" />

      <CreateGroupModal
        open={createOpen}
        busy={creating}
        onCreate={onCreate}
        onCancel={() => setCreateOpen(false)}
      />
    </div>
  );
}

export default GroupsView;
