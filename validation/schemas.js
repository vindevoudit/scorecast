const { z } = require('zod');
const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const { RegExpMatcher, englishDataset, englishRecommendedTransformers } = require('obscenity');

extendZodWithOpenApi(z);

// Tier 20 Chunk 2 — shared profanity matcher. Applied via .refine() to
// every free-text surface a user can submit: username, displayName, bio,
// comment body, group name, join-request message. Symmetric with the
// existing DANGEROUS_TEXT_CHARS refine pattern from Tier 5.5b L6.
// `englishDataset` includes whitelisting for collision-prone English
// words (Scunthorpe, etc.) so we don't generate false positives on
// legitimate place names / surnames. When ADDING a new free-text
// surface, plumb noProfanity() in via .refine() — that's the
// single source of truth.
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
const NO_PROFANITY_MSG = 'Please remove inappropriate language';
function noProfanity(val) {
  return !profanityMatcher.hasMatch(val ?? '');
}

const username = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/, 'Username may only contain letters, numbers, and underscores')
  .refine(noProfanity, { message: NO_PROFANITY_MSG });
const password = z.string().min(8).max(200);
const email = z.string().trim().toLowerCase().email().max(254);
const uuid = z.string().uuid();

// Tier 18 Chunk 6 — Terms of Service acceptance.
//
// CURRENT_TERMS_VERSION is the integer version of the Terms + Privacy
// Policy a user must agree to. Stored on users.termsAcceptedVersion.
// Bumping this value re-prompts every user with an older recorded
// version on their next sign-in — so when we change material terms,
// just bump it.
// Tier 20 Chunk 1 — bumped to 2 for the combined change set: dropped the
// $50 liability floor from §7 and added the 13+ age line to §3 Acceptable
// Use. Existing users re-prompted via the blocking modal on next visit.
const CURRENT_TERMS_VERSION = 2;
const acceptTermsSchema = z
  .object({ version: z.number().int().positive() })
  .openapi('AcceptTermsRequest');

const registerSchema = z
  .object({
    username,
    password,
    email,
    // Frontend RegisterForm gates submit on the checkbox; this is the
    // server-side enforcement. Must be literal `true` AND match the current
    // version — protects against a stale frontend bundle that posts an old
    // version after we bump the policy.
    acceptedTerms: z.literal(true),
    acceptedTermsVersion: z.literal(CURRENT_TERMS_VERSION),
    // Tier 20 Chunk 1 — COPPA-style age self-attestation. Literal-validated
    // like acceptedTerms; not persisted (existence of the registration row
    // IS the consent record alongside termsAcceptedAt). Bumping the minimum
    // age would require a new terms version bump to re-collect.
    confirmedAge: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm you are at least 13 years old' }),
    }),
  })
  .openapi('RegisterRequest');
const loginSchema = z
  .object({ username, password: z.string().min(1).max(200) })
  .openapi('LoginRequest');
const forgotPasswordSchema = z.object({ email }).openapi('ForgotPasswordRequest');
const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password })
  .openapi('ResetPasswordRequest');
// currentPassword required on identity-changing endpoints (email change, 2FA
// setup) so a stolen access JWT alone can't pivot into account takeover.
const currentPassword = z.string().min(1).max(200);

const setEmailSchema = z.object({ email, currentPassword }).openapi('SetEmailRequest');

const setPasswordSchema = z
  .object({ currentPassword, newPassword: password })
  .openapi('SetPasswordRequest');

const totpSetupSchema = z.object({ currentPassword }).openapi('TotpSetupRequest');

const totpConfirmSchema = z
  .object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') })
  .openapi('TotpConfirmRequest');
const totpVerifySchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().trim().min(8).max(60).optional(),
  })
  .refine((d) => Boolean(d.code) || Boolean(d.recoveryCode), {
    message: 'Provide either code or recoveryCode',
  })
  .openapi('TotpVerifyRequest');

// PWA Chunk 4 — Web Push. The browser's PushSubscription.toJSON() output is
// `{endpoint, keys: {p256dh, auth}}`. Endpoint URLs from FCM / Apple WebPush /
// Mozilla autopush range up to ~500 chars; the upper bound here is loose
// (2048) so a future provider doesn't break us. p256dh + auth are base64url
// fixed-length blobs.
//
// Tier 22 H4 — host allowlist. Without it the endpoint can point at any URL
// and web-push.sendNotification will POST encrypted payloads to it on every
// notification fan-out, turning the app into an unwitting HTTP client (SSRF
// against internal infra, request smuggling against third parties). The
// allowlist covers the four mainstream push providers; new providers need a
// schema bump. The .endsWith() check uses a leading dot so `evilfcm.googleapis.com`
// doesn't match `fcm.googleapis.com`.
const PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com',
];
const PUSH_ENDPOINT_HOST_SUFFIXES = [
  '.push.apple.com', // Apple uses sharded subdomains (web.push.apple.com is the public one but they rotate)
  '.notify.windows.com', // Edge / Windows Notification Service
];
function isAllowedPushEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (PUSH_ENDPOINT_HOSTS.includes(parsed.hostname)) return true;
  return PUSH_ENDPOINT_HOST_SUFFIXES.some((s) => parsed.hostname.endsWith(s));
}

const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048).refine(isAllowedPushEndpoint, {
      message: 'Endpoint host is not a recognized push provider',
    }),
    keys: z.object({
      p256dh: z.string().min(64).max(200),
      auth: z.string().min(16).max(100),
    }),
  })
  .openapi('PushSubscribeRequest');

const pushUnsubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048).refine(isAllowedPushEndpoint, {
      message: 'Endpoint host is not a recognized push provider',
    }),
  })
  .openapi('PushUnsubscribeRequest');

// PWA Chunk 4 — known notification types that the per-type preferences UI
// can toggle. New types should be added here AND in PushSettingsPanel.jsx
// (Chunk 5). Absent type in pushPreferences = implicitly enabled; only
// `false` opts out.
const PUSH_NOTIFICATION_TYPES = [
  'pick-scored',
  'badge',
  'invite',
  'group-join',
  // Tier 18 Chunk 5 — fan-out from CommentService.create when a member
  // posts in a group thread; every OTHER member of that group receives
  // one. PushSettingsPanel.NOTIFICATION_TYPES mirrors this enum.
  'group-comment',
  'odds-shifted',
  'kickoff-reminder',
  'friend-request',
  // Tier 19 Chunk 3 — request-to-join lifecycle for `private` groups.
  // 'join-request' → owner gets notified when someone requests.
  // 'join-request-approved' / 'join-request-declined' → requester gets
  // notified of the owner's decision.
  'join-request',
  'join-request-approved',
  'join-request-declined',
];

const PUSH_NOTIFICATION_TYPE_SET = new Set(PUSH_NOTIFICATION_TYPES);

// Zod 4's `z.record(z.enum([...]), z.boolean())` requires every enum key
// to be present in the object — incompatible with the documented "only
// specified keys flip" partial-update contract on PUT /api/me/push-preferences.
// Falling back to `z.record(z.string(), z.boolean())` + a refine that gates
// against PUSH_NOTIFICATION_TYPE_SET preserves the merge semantic while
// still rejecting unknown keys.
const pushPreferencesSchema = z
  .object({
    prefs: z
      .record(z.string(), z.boolean())
      .refine((obj) => Object.keys(obj).every((k) => PUSH_NOTIFICATION_TYPE_SET.has(k)), {
        message: 'Unknown notification type',
      }),
  })
  .openapi('PushPreferencesRequest');

// Tier 19 Chunks 1+3 — visibility enum + optional password (only allowed
// when visibility='private'). Password length window matches what we
// expect users to type out-of-band — 4-char floor catches typos, 64 ceiling
// is comfortably under bcrypt's 72-byte input limit.
const GROUP_VISIBILITY = ['public', 'private', 'secret'];
const groupPassword = z.string().min(4).max(64);
const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(60).refine(noProfanity, { message: NO_PROFANITY_MSG }),
    visibility: z.enum(GROUP_VISIBILITY).optional(),
    password: groupPassword.optional(),
  })
  .refine((data) => data.visibility !== 'private' || !data.password || data.password.length >= 4, {
    message: 'Password must be at least 4 characters',
    path: ['password'],
  })
  .refine((data) => data.visibility === 'private' || !data.password, {
    message: 'Password is only allowed for private groups',
    path: ['password'],
  })
  .openapi('CreateGroupRequest');
const inviteSchema = z.object({ username }).openapi('InviteRequest');
const pickSchema = z
  .object({ gameId: uuid, choice: z.enum(['home', 'away']) })
  .openapi('PickRequest');
const resultSchema = z
  .object({ result: z.union([z.enum(['home', 'away', 'draw']), z.null()]) })
  .openapi('SetResultRequest');

const friendRequestSchema = z.object({ username }).openapi('FriendRequest');
// Tier 19 Chunks 1+3 — visibility flip optionally accepts a password (only
// when target='private'). Setting/clearing the password independently uses
// `setGroupPasswordSchema` instead.
const visibilitySchema = z
  .object({
    visibility: z.enum(GROUP_VISIBILITY),
    password: groupPassword.optional(),
  })
  .refine((data) => data.visibility === 'private' || !data.password, {
    message: 'Password is only allowed when target visibility is private',
    path: ['password'],
  })
  .openapi('VisibilityRequest');
const setGroupPasswordSchema = z
  .object({
    // `null` clears the password. Otherwise a 4-64 char string sets it.
    password: z.union([groupPassword, z.null()]),
  })
  .openapi('SetGroupPasswordRequest');
const joinWithPasswordSchema = z
  .object({ password: z.string().min(1).max(64) })
  .openapi('JoinGroupWithPasswordRequest');
const joinRequestSchema = z
  .object({
    message: z
      .string()
      .trim()
      .max(160)
      .refine(noProfanity, { message: NO_PROFANITY_MSG })
      .optional(),
  })
  .openapi('GroupJoinRequest');
const commentSchema = z
  .object({
    body: z.string().trim().min(1).max(500).refine(noProfanity, { message: NO_PROFANITY_MSG }),
  })
  .openapi('CommentRequest');

const teamName = z.string().trim().min(1).max(80);
const probability = z.number().min(0).max(1);

const createGameSchema = z
  .object({
    homeTeam: teamName,
    awayTeam: teamName,
    date: z.string().datetime({ offset: true }),
    homeProbability: probability,
    drawProbability: probability.optional(),
    awayProbability: probability,
    // Optional — when omitted, GameService.createGame falls back to the
    // Legacy / Imported league (migration 20260518000007). The admin form
    // now surfaces a picker so the common path supplies it directly.
    leagueId: uuid.optional(),
  })
  .refine(
    (g) => Math.abs(g.homeProbability + (g.drawProbability ?? 0) + g.awayProbability - 1) <= 0.01,
    { message: 'home + draw + away probabilities must sum to 1.0' },
  )
  .openapi('CreateGameRequest');

const updateGameSchema = z
  .object({
    homeTeam: teamName.optional(),
    awayTeam: teamName.optional(),
    date: z.string().datetime({ offset: true }).optional(),
    homeProbability: probability.optional(),
    drawProbability: probability.optional(),
    awayProbability: probability.optional(),
  })
  .refine(
    (g) => {
      // No probability fields touched → fine.
      if (
        g.homeProbability === undefined &&
        g.drawProbability === undefined &&
        g.awayProbability === undefined
      ) {
        return true;
      }
      // Once any prob is supplied, home + away must both be present. draw
      // is optional and defaults to 0 (matches the DB default for legacy
      // rows that haven't been touched since the draw-scoring tier).
      if (g.homeProbability === undefined || g.awayProbability === undefined) return false;
      return Math.abs(g.homeProbability + (g.drawProbability ?? 0) + g.awayProbability - 1) <= 0.01;
    },
    { message: 'home + draw + away probabilities must sum to 1.0' },
  )
  .openapi('UpdateGameRequest');

const roleSchema = z.object({ role: z.enum(['user', 'admin']) }).openapi('RoleRequest');

const transferOwnerSchema = z.object({ newOwnerId: uuid }).openapi('TransferOwnerRequest');

// Bidi overrides + zero-width spaces + ASCII/C1 controls. Rejected on free-
// text profile fields so a malicious displayName / bio can't impersonate
// another user on the leaderboard via right-to-left override (U+202E) or
// hide tracking marks via invisible characters. Username is unaffected —
// `username` already pins `[A-Za-z0-9_]+`. ZWJ (U+200D) is deliberately
// NOT in the set so ZWJ-emoji like 👨‍💻 still work.
const DANGEROUS_TEXT_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200E\u200F\uFEFF\u0000-\u001F\u007F-\u009F]/u;
const NO_DANGEROUS_TEXT_MSG = 'Invisible or control characters are not allowed';

const displayName = z
  .string()
  .trim()
  .max(60)
  .refine((s) => !DANGEROUS_TEXT_CHARS.test(s), { message: NO_DANGEROUS_TEXT_MSG })
  .refine(noProfanity, { message: NO_PROFANITY_MSG });
const bio = z
  .string()
  .trim()
  .max(280)
  .refine((s) => !DANGEROUS_TEXT_CHARS.test(s), { message: NO_DANGEROUS_TEXT_MSG })
  .refine(noProfanity, { message: NO_PROFANITY_MSG });

const editProfileSchema = z
  .object({
    displayName: z.union([displayName, z.literal('')]).optional(),
    bio: z.union([bio, z.literal('')]).optional(),
    profileVisibility: z.enum(['public', 'friends', 'private']).optional(),
  })
  .openapi('EditProfileRequest');

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];
const reactionSchema = z.object({ emoji: z.enum(ALLOWED_EMOJIS) }).openapi('ReactionRequest');

// Bumped from 100 → 500 in Tier 4b Chunk 1. A full Premier League season
// is ~380 fixtures; the original cap turned "Select all + Delete" into a
// cryptic 400 once sync was wired up. 500 leaves headroom for WC or
// future single-league bulk operations without unbounded request sizes.
const bulkGameSchema = z
  .object({
    ids: z.array(uuid).min(1).max(500),
    action: z.enum(['delete', 'setResult']),
    result: z.union([z.enum(['home', 'away', 'draw']), z.null()]).optional(),
  })
  .openapi('BulkGameRequest');

const bulkUserSchema = z
  .object({
    ids: z.array(uuid).min(1).max(100),
    action: z.enum(['promote', 'demote', 'delete']),
  })
  .openapi('BulkUserRequest');

const clientErrorSchema = z
  .object({
    message: z.string().min(1).max(500),
    stack: z.string().max(8192).optional(),
    componentStack: z.string().max(8192).optional(),
    url: z.string().max(500).optional(),
    reqId: z.string().max(200).optional(),
    userAgent: z.string().max(500).optional(),
    level: z.enum(['error', 'warn']).optional(),
  })
  .openapi('ClientErrorRequest');

// Tier 4b Chunk 1 — league management. Provider is restricted to the one
// we support today; expanding to API-Football or a custom source is a
// schema bump.
const leagueProviderEnum = z.enum(['football-data.org']);
const createLeagueSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    sourceProvider: leagueProviderEnum.optional(),
    sourceLeagueId: z.string().trim().min(1).max(40),
    country: z.string().trim().max(80).optional(),
    logoUrl: z.string().trim().url().max(500).optional(),
    active: z.boolean().optional(),
  })
  .openapi('CreateLeagueRequest');

const updateLeagueSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    country: z.string().trim().max(80).nullable().optional(),
    logoUrl: z.string().trim().url().max(500).nullable().optional(),
    active: z.boolean().optional(),
  })
  .openapi('UpdateLeagueRequest');

// Leaderboard filtering — both group block (when groupId supplied) and
// overall (when omitted) accept the optional leagueId/seasonId pair. When
// either is set, the builder's Game.findAll() inherits a WHERE clause and
// the leaderboard rows only count picks on in-scope games (winRate scopes
// naturally via the same filtered game set).
const leaderboardQuerySchema = z
  .object({
    groupId: uuid.optional(),
    orderBy: z.enum(['points', 'winRate', 'username']).optional(),
    offset: z.coerce.number().int().min(0).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    leagueId: uuid.optional(),
    seasonId: uuid.optional(),
  })
  .openapi('LeaderboardQuery');

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  setEmailSchema,
  setPasswordSchema,
  totpSetupSchema,
  totpConfirmSchema,
  totpVerifySchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  pushPreferencesSchema,
  PUSH_NOTIFICATION_TYPES,
  CURRENT_TERMS_VERSION,
  acceptTermsSchema,
  createGroupSchema,
  inviteSchema,
  pickSchema,
  resultSchema,
  friendRequestSchema,
  visibilitySchema,
  GROUP_VISIBILITY,
  setGroupPasswordSchema,
  joinWithPasswordSchema,
  joinRequestSchema,
  commentSchema,
  createGameSchema,
  updateGameSchema,
  roleSchema,
  transferOwnerSchema,
  editProfileSchema,
  reactionSchema,
  bulkGameSchema,
  bulkUserSchema,
  clientErrorSchema,
  createLeagueSchema,
  updateLeagueSchema,
  leaderboardQuerySchema,
  ALLOWED_EMOJIS,
};
