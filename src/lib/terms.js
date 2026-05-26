// Tier 18 Chunk 6 — current Terms + Privacy Policy version on the client.
// MUST match `CURRENT_TERMS_VERSION` in validation/schemas.js (the server
// rejects registrations / acceptances posted with a mismatching version).
// Bumping this value re-prompts every user with an older recorded version
// on their next visit.
export const CURRENT_TERMS_VERSION = 1;

// True when the given user has not yet accepted the current version.
// Returns false for null/undefined users (anon visitors don't see the
// modal) and for users whose recorded acceptance is >= current version.
export function needsTermsAcceptance(user) {
  if (!user) return false;
  const recorded = Number(user.termsAcceptedVersion);
  if (!Number.isFinite(recorded)) return true;
  return recorded < CURRENT_TERMS_VERSION;
}
