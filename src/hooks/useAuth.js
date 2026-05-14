'use strict';

// Tier 13 Chunk 3 — useAuth re-export. The hook itself lives next to its
// provider in src/contexts/AuthContext.jsx; this barrel keeps imports
// stable for consumers.
export { useAuth } from '../contexts/AuthContext';
