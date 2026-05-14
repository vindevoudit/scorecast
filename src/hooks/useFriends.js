'use strict';

import { useData } from './useData';

export function useFriends() {
  const {
    friends,
    handleSendFriendRequest,
    handleAcceptFriend,
    handleDeclineFriend,
    handleUnfriend,
  } = useData();
  return {
    friends,
    handleSendFriendRequest,
    handleAcceptFriend,
    handleDeclineFriend,
    handleUnfriend,
  };
}
