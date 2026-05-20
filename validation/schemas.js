const { z } = require('zod');
const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');

extendZodWithOpenApi(z);

const username = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/, 'Username may only contain letters, numbers, and underscores');
const password = z.string().min(8).max(200);
const email = z.string().trim().toLowerCase().email().max(254);
const uuid = z.string().uuid();

const registerSchema = z.object({ username, password, email }).openapi('RegisterRequest');
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
const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().min(64).max(200),
      auth: z.string().min(16).max(100),
    }),
  })
  .openapi('PushSubscribeRequest');

const pushUnsubscribeSchema = z
  .object({ endpoint: z.string().url().max(2048) })
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
  'odds-shifted',
  'kickoff-reminder',
  'friend-request',
];

const pushPreferencesSchema = z
  .object({
    prefs: z.record(z.enum(PUSH_NOTIFICATION_TYPES), z.boolean()),
  })
  .openapi('PushPreferencesRequest');

const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    visibility: z.enum(['private', 'public']).optional(),
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
const visibilitySchema = z
  .object({ visibility: z.enum(['private', 'public']) })
  .openapi('VisibilityRequest');
const commentSchema = z
  .object({ body: z.string().trim().min(1).max(500) })
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
  .refine((s) => !DANGEROUS_TEXT_CHARS.test(s), { message: NO_DANGEROUS_TEXT_MSG });
const bio = z
  .string()
  .trim()
  .max(280)
  .refine((s) => !DANGEROUS_TEXT_CHARS.test(s), { message: NO_DANGEROUS_TEXT_MSG });

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
  createGroupSchema,
  inviteSchema,
  pickSchema,
  resultSchema,
  friendRequestSchema,
  visibilitySchema,
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
