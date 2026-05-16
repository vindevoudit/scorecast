// Tier 11 Chunk 1 — <Avatar> primitive.
//
// Re-exports the existing src/components/Avatar.jsx for the ui/ barrel so
// consumers can `import { Avatar } from './ui'` uniformly. The avatar's
// deterministic-hash color logic stays in the existing file (Chunk 2 will
// tokenize border + ring colors there). Keeping the existing module avoids
// the cross-cutting noise of moving the file mid-Chunk-1.

export { default as Avatar } from '../Avatar';
export { default } from '../Avatar';
