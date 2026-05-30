'use strict';

// Phase 0 T29-1 — formatGroupLabel contract. The server-side helper that
// renders group labels in notification text + email subjects + audit
// entries. Its output shape is mirrored by GroupNameDisplay on the
// frontend; both must produce `"<name> #<discriminator>"`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { formatGroupLabel } = require('../lib/groupLabel');

test('formatGroupLabel renders name + discriminator with the right separator', () => {
  assert.equal(
    formatGroupLabel({ name: 'Friday Football', discriminator: 'A3F2D1' }),
    'Friday Football #A3F2D1',
  );
});

test('formatGroupLabel falls back to bare name when discriminator missing', () => {
  // Defensive — pre-migration call sites in dev should still produce
  // readable text, just without the disambiguator.
  assert.equal(formatGroupLabel({ name: 'Friday Football' }), 'Friday Football');
  assert.equal(
    formatGroupLabel({ name: 'Friday Football', discriminator: null }),
    'Friday Football',
  );
  assert.equal(formatGroupLabel({ name: 'Friday Football', discriminator: '' }), 'Friday Football');
});

test('formatGroupLabel handles missing / nullish inputs without throwing', () => {
  assert.equal(formatGroupLabel(null), 'Unknown group');
  assert.equal(formatGroupLabel(undefined), 'Unknown group');
  assert.equal(formatGroupLabel({}), 'Unknown group');
  assert.equal(formatGroupLabel({ discriminator: 'A3F2D1' }), 'Unknown group');
});

test('formatGroupLabel preserves names with special characters', () => {
  // Unicode, quotes, hash chars — none get escaped or stripped. The label
  // is rendered into pre-tokenized text + the frontend treats it as a
  // string literal, not HTML.
  assert.equal(
    formatGroupLabel({ name: 'Friday "Football" — #1', discriminator: 'BEEF12' }),
    'Friday "Football" — #1 #BEEF12',
  );
});

test('formatGroupLabel accepts Sequelize-shaped objects', () => {
  // Real-world: callers pass either a plain object (lib/groups.js return
  // shapes) or a raw Sequelize Group instance (services/GroupService.js
  // notification paths). Both expose name + discriminator as own properties.
  const sequelizeShape = {
    name: 'Test Group',
    discriminator: 'ABCDEF',
    // ...other Sequelize fields would be here in practice
  };
  assert.equal(formatGroupLabel(sequelizeShape), 'Test Group #ABCDEF');
});
