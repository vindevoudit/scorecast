'use strict';

// Phase 0 T29-1 — render a group name with its discriminator suffix so two
// groups with identical names ("Friday Football") stay visually distinct
// ("Friday Football #A3F2D1" vs "Friday Football #7BE091"). Server sets the
// discriminator on createGroup; this is a presentational mirror — keep the
// rendered shape in lockstep with lib/groupLabel.js formatGroupLabel.
//
// Usage:
//   <GroupNameDisplay group={group} />
//   <GroupNameDisplay group={group} className="text-xl font-bold" />
//
// The discriminator is rendered in a muted color so the name remains
// dominant. `truncate` is NOT applied here — callers handle truncation on
// the wrapping element so the discriminator never gets clipped before the
// name does.
function GroupNameDisplay({ group, className = '' }) {
  if (!group || !group.name) {
    return <span className={className}>Unknown group</span>;
  }
  return (
    <span className={className}>
      {group.name}
      {group.discriminator ? (
        <>
          {' '}
          <span className="font-mono text-[0.85em] text-fg-muted/80">#{group.discriminator}</span>
        </>
      ) : null}
    </span>
  );
}

export default GroupNameDisplay;
