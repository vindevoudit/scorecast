'use strict';

// Rain-shortened cricket matches void their runs legs.
//
// WHY A STORED FLAG RATHER THAN A DERIVATION
// ------------------------------------------
// lib/scoring.js `scorePick(pick, game)` is a pure function of its two
// arguments and has no access to the provider's status string — which is the
// only place "reduced to 8 overs due to rain" is ever expressed. So the
// judgement has to be made once, at capture, and stored. Same reasoning as
// games.sport being denormalised.
//
// WHY THE RUNS LEGS VOID AT ALL
// -----------------------------
// A runs prediction is made pre-match and is therefore inherently on a 20-over
// scale. lib/scoring.js normalises every innings to that scale so the
// comparison is like-for-like, which works fine for a chase that ends early.
// It breaks under DLS: a side chasing a REVISED target over a REDUCED
// allocation produces a total that no 20-over projection can be fairly
// compared against — 54 off 46 balls extrapolates to 141 from a sample the
// batting side never intended to maximise. Scaling to the real allocation is
// not the fix either; it yields the literal truncated score, which nobody could
// have forecast, and it is unimplementable anyway because the feed does not
// publish per-side allocations (they differ between the two innings under DLS,
// and the only mention is prose inside the status string).
//
// So the runs legs void and the match pays the flat +50 winner alone. Neutral:
// nobody is rewarded for landing near an extrapolated number, nobody is
// punished for a forecast the weather invalidated.
//
// DEFAULT FALSE IS WHAT MAKES THIS NON-RETROACTIVE. Every existing row keeps
// normal scoring, so no settled pick is rescored by this migration. Only
// matches captured (or corrected) after it takes effect can be flagged.
//
// No "updatedAt" — models/Game.js is timestamps:false.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS "rainAffected" BOOLEAN NOT NULL DEFAULT FALSE
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE games
        DROP COLUMN IF EXISTS "rainAffected"
    `);
  },
};
