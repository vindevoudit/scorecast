'use strict';

// Phase 0 T29-1 — server-side group label helper.
//
// Renders a group label as `"<name> #<discriminator>"` for use in
// notification text + email subjects + audit-log entries. Mirrors the
// frontend GroupNameDisplay component verbatim so the wire format and the
// rendered UI stay in lockstep.
//
// Accepts either a Sequelize Group instance or any plain object that
// carries `{name, discriminator}`. Falls back to bare name if discriminator
// is missing (defensive — DB-level NOT NULL means this branch should never
// fire post-migration, but keeps pre-migration call sites unbroken in dev).
function formatGroupLabel(group) {
  if (!group || !group.name) return 'Unknown group';
  if (!group.discriminator) return group.name;
  return `${group.name} #${group.discriminator}`;
}

module.exports = { formatGroupLabel };
