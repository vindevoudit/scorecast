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
};
