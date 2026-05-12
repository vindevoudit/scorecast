const { z } = require('zod');

const username = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/, 'Username may only contain letters, numbers, and underscores');
const password = z.string().min(8).max(200);
const uuid = z.string().uuid();

const registerSchema = z.object({ username, password });
const loginSchema = z.object({ username, password: z.string().min(1).max(200) });

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  visibility: z.enum(['private', 'public']).optional(),
});
const inviteSchema = z.object({ username });
const pickSchema = z.object({ gameId: uuid, choice: z.enum(['home', 'away']) });
const resultSchema = z.object({ result: z.union([z.enum(['home', 'away']), z.null()]) });

const friendRequestSchema = z.object({ username });
const visibilitySchema = z.object({ visibility: z.enum(['private', 'public']) });
const commentSchema = z.object({ body: z.string().trim().min(1).max(500) });

const teamName = z.string().trim().min(1).max(80);
const probability = z.number().min(0).max(1);

const createGameSchema = z.object({
  homeTeam: teamName,
  awayTeam: teamName,
  date: z.string().datetime({ offset: true }),
  homeProbability: probability,
  awayProbability: probability,
}).refine(
  (g) => Math.abs(g.homeProbability + g.awayProbability - 1) <= 0.01,
  { message: 'homeProbability + awayProbability must sum to 1.0' }
);

const updateGameSchema = z.object({
  homeTeam: teamName.optional(),
  awayTeam: teamName.optional(),
  date: z.string().datetime({ offset: true }).optional(),
  homeProbability: probability.optional(),
  awayProbability: probability.optional(),
}).refine(
  (g) => g.homeProbability === undefined && g.awayProbability === undefined
    ? true
    : g.homeProbability !== undefined && g.awayProbability !== undefined
      && Math.abs(g.homeProbability + g.awayProbability - 1) <= 0.01,
  { message: 'When updating probabilities, both must be provided and sum to 1.0' }
);

const roleSchema = z.object({ role: z.enum(['user', 'admin']) });

const transferOwnerSchema = z.object({ newOwnerId: uuid });

const editProfileSchema = z.object({
  displayName: z.union([z.string().trim().max(60), z.literal('')]).optional(),
  bio: z.union([z.string().trim().max(280), z.literal('')]).optional(),
});

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];
const reactionSchema = z.object({ emoji: z.enum(ALLOWED_EMOJIS) });

const bulkGameSchema = z.object({
  ids: z.array(uuid).min(1).max(100),
  action: z.enum(['delete', 'setResult']),
  result: z.union([z.enum(['home', 'away']), z.null()]).optional(),
});

const bulkUserSchema = z.object({
  ids: z.array(uuid).min(1).max(100),
  action: z.enum(['promote', 'demote', 'delete']),
});

module.exports = {
  registerSchema,
  loginSchema,
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
  ALLOWED_EMOJIS,
};
