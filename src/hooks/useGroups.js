'use strict';

import { useData } from './useData';

export function useGroups() {
  const {
    groups,
    discoverGroups,
    pendingInvites,
    selectedGroupId,
    setSelectedGroupId,
    handleCreateGroup,
    handleLeaveGroup,
    handleTransferGroup,
    handleDeleteGroup,
    handleJoinPublicGroup,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,
  } = useData();
  return {
    groups,
    discoverGroups,
    pendingInvites,
    selectedGroupId,
    setSelectedGroupId,
    handleCreateGroup,
    handleLeaveGroup,
    handleTransferGroup,
    handleDeleteGroup,
    handleJoinPublicGroup,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,
  };
}
