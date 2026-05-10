# ScoreCast Architecture Summary

## Overview
ScoreCast is a football prediction web application built with:
- `React` for the frontend UI with componentized architecture
- `Vite` for frontend development, bundling, and API proxying
- `Tailwind CSS` for utility-based styling
- `Node.js` and `Express` for the backend REST API
- `PostgreSQL` for persistent storage with `Sequelize` ORM
- JWT-based authentication via bearer tokens and cookies

The app supports user registration/login, group management with invites, probability-based match predictions, and real-time leaderboards.

## File Structure
- `server.js` - Express backend, API routes, database initialization, auth middleware, and production static serving.
- `package.json` - project dependencies and npm scripts.
- `data.json` - initial seed data for users, groups, games, and picks.
- `models/` - Sequelize ORM models and database initialization:
  - `models/User.js` - User model
  - `models/Group.js` - Group model
  - `models/Game.js` - Game model
  - `models/Pick.js` - Pick model
  - `models/GroupMember.js` - Group membership model
  - `models/GroupInvite.js` - Group invite model
  - `models/index.js` - Database connection, associations, and seeding logic
- `src/` - React application source:
  - `src/main.jsx` - React app bootstrap.
  - `src/App.jsx` - main application UI, state management, API integration, and business logic.
  - `src/index.css` - global CSS and Tailwind utilities.
  - `src/components/` - Reusable React components:
    - `GameCard.jsx` - Game display with pick submission
    - `GroupCard.jsx` - Group display with member list and invite form
    - `GroupLeaderboardCard.jsx` - Group leaderboard selector and display
    - `LeaderboardCard.jsx` - Leaderboard entry list
    - `LoginForm.jsx` - Login form component
    - `RegisterForm.jsx` - Registration form component
    - `InviteRow.jsx` - Invite submission form
- `public/` - static assets and HTML template used by Vite.
- `dist/` - production build output served by `server.js` after `npm run build`.

## Backend Architecture

### Persistence Layer
- Uses `PostgreSQL` as the database with `Sequelize` ORM for data modeling and queries.
- Database tables:
  - `users`
  - `groups`
  - `games`
  - `picks`
  - `group_members`
  - `group_invites`
- Startup syncs the database schema and seeds initial data from `data.json` if no users exist.
- Environment configuration via `.env` file (e.g., `DATABASE_URL`).

### Authentication
- JWT tokens are created with a shared secret and expire in 7 days.
- Tokens may be supplied via a `token` cookie or `Authorization: Bearer <token>` header.
- `authMiddleware` verifies the token and attaches the authenticated user to `req.user`.

### API Endpoints
- `POST /api/register`
  - Creates a new user record.
  - Returns a JWT token and authenticated user info.
- `POST /api/login`
  - Verifies username/password and returns a JWT token.
- `GET /api/me`
  - Returns current user metadata and joined group IDs.
- `GET /api/games`
  - Returns the full game schedule and probabilities.
- `GET /api/groups`
  - Returns groups that include the current user.
- `GET /api/groups/:groupId`
  - Returns detailed group metadata for members only.
- `POST /api/groups`
  - Creates a new group owned by the current user.
- `POST /api/groups/:groupId/invite`
  - Sends an invite to another username to join the group.
- `POST /api/picks`
  - Saves or updates a user pick for an upcoming game.
  - Enforces that picks may not be created or edited for completed games.
- `GET /api/picks`
  - Returns the current user's picks.
- `GET /api/leaderboard`
  - Returns the overall leaderboard and, optionally, a group leaderboard.
- `POST /api/games/:gameId/result`
  - Sets the result for a game and enables scoring.

### Business Logic
- A pick earns points only after the associated game result is recorded.
- Correct picks score `100 - probability*100`, so underdog selections score more.
- Group leaderboards compute points only for picks made by group members.
- Access controls ensure only authenticated users can fetch private group data.
- Group membership is validated before returning details for `GET /api/groups/:groupId`.

## Frontend Architecture

### Technology Stack
- `React` with functional components and hooks.
- `Vite` for fast development server and build process with configured API proxy.
- `Tailwind CSS` for utility-based styling.
- `fetch` API for backend communication with Bearer token authentication.

### Application State
- Main state values managed in `src/App.jsx`:
  - `token`
  - `user`
  - `games`
  - `groups`
  - `picks`
  - `leaderboard`
  - `view`
  - `status` and `loading`
- Authentication token is persisted in `localStorage` as `scorecastToken`.

### API Integration
- A `request(path, options)` helper sends JSON requests with Authorization headers.
- During development, Vite's proxy redirects `/api/*` calls to the backend at `http://localhost:3000`.
- Dashboard data is loaded after login via `/api/me`, `/api/games`, `/api/groups`, `/api/picks`, and `/api/leaderboard`.

### UI Workflows
- Sign in and registration are handled by dedicated forms.
- Authenticated users can:
  - view upcoming matches
  - submit or update pick choices
  - create groups
  - invite other users into groups
  - view overall and group leaderboards
- Users can only submit picks for upcoming games as determined by `isUpcomingGame(game)`.

### Rendering and Interaction
- The UI exposes tabbed navigation for `Games`, `Groups`, and `Leaderboards`.
- Game cards display match odds and pick status.
- Group controls show existing members and allow invite submission.
- Leaderboard screens show sorted scores for users and selected group rankings.

## Data Model

### User
- `id`
- `username`
- `password`
- `createdAt`

### Group
- `id`
- `name`
- `ownerId`
- `members` (ordered list of user IDs)
- `invites` (invite records)
- `createdAt`

### Game
- `id`
- `homeTeam`
- `awayTeam`
- `date`
- `homeProbability`
- `awayProbability`
- `result` (`home`, `away`, or `null`)

### Pick
- `id`
- `userId`
- `gameId`
- `choice` (`home` or `away`)
- `submittedAt`

## Startup and Deployment

### Development
- Install dependencies with `npm install`.
- Configure `.env` with PostgreSQL credentials (see README for setup).
- Run development mode with `npm run dev` (starts both frontend dev server on 5173 and backend on 3001).
- Vite proxy at `vite.config.js` routes `/api` calls to the backend.

### Production
- Build frontend assets with `npm run build` (outputs to `dist/`).
- Start production server with `npm start`.
- `server.js` serves the built frontend from `dist/` and handles all API requests.
- Backend runs on configured PORT (default 3001).

## Current Limitations
- Passwords are stored in plain text rather than hashed (security risk).
- The game result endpoint is not protected by role-based admin authorization.
- Frontend validation and error handling are minimal.
- No rate limiting on API endpoints.

## Recommended Improvements
- Add password hashing with `bcrypt` or similar library.
- Implement role-based access control (RBAC) for admin operations (result management).
- Add comprehensive frontend validation for registration, group invites, and pick submission.
- Implement rate limiting and DDoS protection.
- Add end-to-end tests for auth flows, picks, group membership, and leaderboard scoring.
- Add request logging and monitoring.
- Implement email notifications for group invites and game results.
