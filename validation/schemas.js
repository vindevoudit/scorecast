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
const setEmailSchema = z.object({ email }).openapi('SetEmailRequest');

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
  .object({ result: z.union([z.enum(['home', 'away']), z.null()]) })
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
    awayProbability: probability,
  })
  .refine((g) => Math.abs(g.homeProbability + g.awayProbability - 1) <= 0.01, {
    message: 'homeProbability + awayProbability must sum to 1.0',
  })
  .openapi('CreateGameRequest');

const updateGameSchema = z
  .object({
    homeTeam: teamName.optional(),
    awayTeam: teamName.optional(),
    date: z.string().datetime({ offset: true }).optional(),
    homeProbability: probability.optional(),
    awayProbability: probability.optional(),
  })
  .refine(
    (g) =>
      g.homeProbability === undefined && g.awayProbability === undefined
        ? true
        : g.homeProbability !== undefined &&
          g.awayProbability !== undefined &&
          Math.abs(g.homeProbability + g.awayProbability - 1) <= 0.01,
    { message: 'When updating probabilities, both must be provided and sum to 1.0' },
  )
  .openapi('UpdateGameRequest');

const roleSchema = z.object({ role: z.enum(['user', 'admin']) }).openapi('RoleRequest');

const transferOwnerSchema = z.object({ newOwnerId: uuid }).openapi('TransferOwnerRequest');

const editProfileSchema = z
  .object({
    displayName: z.union([z.string().trim().max(60), z.literal('')]).optional(),
    bio: z.union([z.string().trim().max(280), z.literal('')]).optional(),
    profileVisibility: z.enum(['public', 'friends', 'private']).optional(),
  })
  .openapi('EditProfileRequest');

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];
const reactionSchema = z.object({ emoji: z.enum(ALLOWED_EMOJIS) }).openapi('ReactionRequest');

const bulkGameSchema = z
  .object({
    ids: z.array(uuid).min(1).max(100),
    action: z.enum(['delete', 'setResult']),
    result: z.union([z.enum(['home', 'away']), z.null()]).optional(),
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

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  setEmailSchema,
  totpConfirmSchema,
  totpVerifySchema,
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
  ALLOWED_EMOJIS,
};
