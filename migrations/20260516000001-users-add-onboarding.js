'use strict';

// Tier 11 Chunk 4 — onboarding tour completion timestamp.
// Backs the first-run 4-step tour rendered by <OnboardingTour /> on the
// games view. NULL = tour hasn't been shown / completed yet; non-NULL =
// tour was either finished or explicitly skipped (we don't distinguish —
// both routes through PATCH /api/me/onboarding-completed).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP WITH TIME ZONE`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS "onboardingCompletedAt"`,
    );
  },
};
