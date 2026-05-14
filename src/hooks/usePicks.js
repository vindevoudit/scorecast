'use strict';

import { useMemo } from 'react';
import { useData } from './useData';

export function usePicks() {
  const { picks, submitPick, removePick } = useData();
  const pickMap = useMemo(() => new Map(picks.map((pick) => [pick.gameId, pick])), [picks]);
  return { picks, pickMap, submitPick, removePick };
}
