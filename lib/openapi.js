const { OpenAPIRegistry, OpenApiGeneratorV3 } = require('@asteasolutions/zod-to-openapi');
const { z } = require('zod');
const pkg = require('../package.json');
const schemas = require('../validation/schemas');

let cachedDoc = null;

function buildOpenAPIDocument() {
  if (cachedDoc) return cachedDoc;

  const registry = new OpenAPIRegistry();

  // Schemas annotated via .openapi('Name') are auto-registered as named components
  // the first time they appear in a registered path's body/params/query.

  const tags = {
    auth: ['auth'],
    me: ['me'],
    games: ['games'],
    picks: ['picks'],
    groups: ['groups'],
    friends: ['friends'],
    leaderboard: ['leaderboard'],
    notifications: ['notifications'],
    admin: ['admin'],
    comments: ['comments'],
    misc: ['misc'],
  };

  const ok = { 200: { description: 'OK' } };
  const noContent = { 204: { description: 'No Content' } };
  const created = { 201: { description: 'Created' } };
  const cookieAuth = [{ cookieAuth: [] }];

  // ===== Auth =====
  registry.registerPath({
    method: 'post',
    path: '/api/register',
    tags: tags.auth,
    description: 'Create a new account. Sets auth cookies. Sends a verify-email link.',
    request: { body: { content: { 'application/json': { schema: schemas.registerSchema } } } },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/login',
    tags: tags.auth,
    description: 'Authenticate with username + password. Sets auth cookies.',
    request: { body: { content: { 'application/json': { schema: schemas.loginSchema } } } },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/refresh',
    tags: tags.auth,
    description: 'Rotate the refresh token; revokes the inbound row and issues a new pair.',
    responses: noContent,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout',
    tags: tags.auth,
    description: 'Revoke current refresh token and clear auth cookies.',
    security: cookieAuth,
    responses: noContent,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/forgot-password',
    tags: tags.auth,
    description:
      'Always returns 204 to prevent user enumeration. Sends a reset link if the email is verified and matches an account.',
    request: {
      body: { content: { 'application/json': { schema: schemas.forgotPasswordSchema } } },
    },
    responses: noContent,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/reset-password',
    tags: tags.auth,
    description:
      'Reset password using a token from the reset email. Revokes all refresh tokens for the user.',
    request: { body: { content: { 'application/json': { schema: schemas.resetPasswordSchema } } } },
    responses: noContent,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/verify-email',
    tags: tags.auth,
    description: 'Consume a verify-email token. Body { token } or query ?token=.',
    request: {
      body: {
        content: {
          'application/json': { schema: z.object({ token: z.string().min(20).max(500) }) },
        },
      },
    },
    responses: ok,
  });

  // ===== Me =====
  registry.registerPath({
    method: 'get',
    path: '/api/me',
    tags: tags.me,
    description: 'Current user, role, groups, pending invites, twoFactorEnabled, email status.',
    security: cookieAuth,
    responses: ok,
  });

  registry.registerPath({
    method: 'put',
    path: '/api/me',
    tags: tags.me,
    description: 'Update displayName / bio.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.editProfileSchema } } } },
    responses: ok,
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/me/email',
    tags: tags.me,
    description: 'Set or change email; sends a verification link.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.setEmailSchema } } } },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/me/password',
    tags: tags.me,
    description:
      'Change password while signed in. Verifies currentPassword, then revokes all refresh tokens and reissues a fresh pair for the calling session.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.setPasswordSchema } } } },
    responses: ok,
  });

  // ===== Games =====
  registry.registerPath({
    method: 'get',
    path: '/api/games',
    tags: tags.games,
    description: 'List all games with their probabilities, kickoff time, and result.',
    security: cookieAuth,
    responses: ok,
  });

  // ===== Picks =====
  registry.registerPath({
    method: 'get',
    path: '/api/picks',
    tags: tags.picks,
    description: "Caller's picks across all games.",
    security: cookieAuth,
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/picks',
    tags: tags.picks,
    description:
      'Submit or update a pick. Rejected after kickoff. Rate-limited; recalculates leaderboard.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.pickSchema } } } },
    responses: created,
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/picks/{id}',
    tags: tags.picks,
    description: 'Remove a pick. Rate-limited.',
    security: cookieAuth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: noContent,
  });

  // ===== Groups =====
  registry.registerPath({
    method: 'get',
    path: '/api/groups',
    tags: tags.groups,
    description: "Caller's groups (members + invites included).",
    security: cookieAuth,
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups',
    tags: tags.groups,
    description: 'Create a group (private or public).',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.createGroupSchema } } } },
    responses: created,
  });

  registry.registerPath({
    method: 'get',
    path: '/api/groups/discover',
    tags: tags.groups,
    description: 'List public groups the caller has not joined.',
    security: cookieAuth,
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups/{groupId}/invites',
    tags: tags.groups,
    description: 'Invite another user to a group.',
    security: cookieAuth,
    request: {
      params: z.object({ groupId: z.string().uuid() }),
      body: { content: { 'application/json': { schema: schemas.inviteSchema } } },
    },
    responses: created,
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/groups/{groupId}/visibility',
    tags: tags.groups,
    description: 'Change group visibility (owner only).',
    security: cookieAuth,
    request: {
      params: z.object({ groupId: z.string().uuid() }),
      body: { content: { 'application/json': { schema: schemas.visibilitySchema } } },
    },
    responses: ok,
  });

  // ===== Friends =====
  registry.registerPath({
    method: 'post',
    path: '/api/friends/request',
    tags: tags.friends,
    description: 'Send a friend request. Rate-limited.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.friendRequestSchema } } } },
    responses: created,
  });

  // ===== Leaderboard =====
  registry.registerPath({
    method: 'get',
    path: '/api/leaderboard',
    tags: tags.leaderboard,
    description: 'Overall leaderboard, plus group leaderboard when ?groupId= is supplied.',
    security: cookieAuth,
    request: {
      query: z.object({
        groupId: z.string().uuid().optional(),
        orderBy: z.enum(['points', 'winRate']).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: ok,
  });

  // ===== Comments =====
  registry.registerPath({
    method: 'get',
    path: '/api/games/{gameId}/comments',
    tags: tags.comments,
    description: 'Comments + reactions for a game.',
    security: cookieAuth,
    request: { params: z.object({ gameId: z.string().uuid() }) },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/games/{gameId}/comments',
    tags: tags.comments,
    description: 'Post a comment on a game. Rate-limited.',
    security: cookieAuth,
    request: {
      params: z.object({ gameId: z.string().uuid() }),
      body: { content: { 'application/json': { schema: schemas.commentSchema } } },
    },
    responses: created,
  });

  // ===== Admin =====
  registry.registerPath({
    method: 'post',
    path: '/api/admin/games',
    tags: tags.admin,
    description: 'Create a game. Admin only. homeProbability + awayProbability must sum to 1.0.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.createGameSchema } } } },
    responses: created,
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/admin/games/{id}',
    tags: tags.admin,
    description: 'Update an existing game. Admin only.',
    security: cookieAuth,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: schemas.updateGameSchema } } },
    },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/admin/games/{id}/result',
    tags: tags.admin,
    description: 'Set or clear a game result. Admin only. Triggers leaderboard recalculation.',
    security: cookieAuth,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: schemas.resultSchema } } },
    },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/admin/games/bulk',
    tags: tags.admin,
    description: 'Bulk delete games or set results. Admin only.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.bulkGameSchema } } } },
    responses: ok,
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/admin/users/{id}/role',
    tags: tags.admin,
    description: 'Promote/demote a user. Cannot demote self.',
    security: cookieAuth,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: schemas.roleSchema } } },
    },
    responses: ok,
  });

  registry.registerPath({
    method: 'post',
    path: '/api/admin/users/bulk',
    tags: tags.admin,
    description: 'Bulk promote/demote/delete users. Skips caller silently.',
    security: cookieAuth,
    request: { body: { content: { 'application/json': { schema: schemas.bulkUserSchema } } } },
    responses: ok,
  });

  // ===== Misc =====
  registry.registerPath({
    method: 'post',
    path: '/api/client-errors',
    tags: tags.misc,
    description:
      'Client-side error reporting endpoint. Anonymous, rate-limited, body capped at 8KB.',
    request: { body: { content: { 'application/json': { schema: schemas.clientErrorSchema } } } },
    responses: noContent,
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);

  cachedDoc = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'ScoreCast API',
      version: pkg.version,
      description:
        'Football-prediction social app. Authentication is via HttpOnly cookies (sc_access, sc_refresh); state-changing requests also require the sc_csrf cookie echoed in the X-CSRF-Token header.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local backend (express)' },
      { url: 'http://localhost:5173', description: 'Local dev (Vite proxied to backend)' },
    ],
    security: [{ cookieAuth: [] }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'sc_access',
          description: 'HttpOnly access JWT set by /api/login or /api/register.',
        },
      },
    },
  });

  return cachedDoc;
}

module.exports = { buildOpenAPIDocument };
