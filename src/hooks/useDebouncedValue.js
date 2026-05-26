// Tier 19 Chunk 2 — debounced-value hook extracted from SearchBar's inline
// pattern so FriendsList (and any future autocomplete surface) can reuse
// the same shape.

import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default useDebouncedValue;
