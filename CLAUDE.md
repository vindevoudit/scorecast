# ScoreCast

## Project Overview
ScoreCast is a full-stack football prediction web app built with React + Node/Express. Users make picks on games, join private or public groups, send friend requests, comment and react on games, earn badges, and compete on probability-based leaderboards with paginated/sortable group views. Admins manage games and users (individually or in bulk) from an in-app panel.

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind CSS + PostCSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (with Sequelize ORM)
- **Auth**: JWT tokens (7-day expiry) — passwords hashed with bcryptjs
- **Validation**: zod schemas on every POST/PUT body
- **Rate limiting**: express-rate-limit on auth endpoints
- **State Management**: React hooks (useState, useEffect, useMemo, useRef, useCallback)

## Project Structure
```
ScoreCast/
├── src/                              # React frontend source
│   ├── App.jsx                      # Main app: state, tabs, dashboard, 401 handling, profile drawer, admin tab
│   ├── main.jsx                     # React entry point
│   ├── index.css                    # Global styles
│   ├── components/
│   │   ├── GameCard.jsx             # Pick UI + outcome badge + countdown + undo-pick + per-game CommentThread
│   │   ├── GroupCard.jsx            # Group display + invite form + Public/Private badge + leave/transfer/delete menu
│   │   ├── GroupLeaderboardCard.jsx # Sort (points/winRate/username) + pagination + viewer-row anchor
│   │   ├── InviteRow.jsx
│   │   ├── LeaderboardCard.jsx      # Full leaderboard + LeaderboardRow (clickable → profile drawer, with Avatar)
│   │   ├── LoginForm.jsx
│   │   ├── RegisterForm.jsx
│   │   ├── PicksHistory.jsx         # "My Picks" tab with filters
│   │   ├── EmptyState.jsx           # Reusable empty-list placeholder
│   │   ├── Skeleton.jsx             # SkeletonGameCard + SkeletonLeaderboardRow
│   │   ├── ConfirmModal.jsx         # Generic confirm dialog (logout, deletes, bulk actions)
│   │   ├── Avatar.jsx               # Deterministic initial-on-color avatar (used everywhere a user appears)
│   │   ├── SearchBar.jsx            # Debounced search across users/groups/games (header)
│   │   ├── ProfileView.jsx          # Public profile: stats, badges, recent picks, friend button, edit form (own profile)
│   │   ├── ProfileDrawer.jsx        # Right-side drawer wrapping ProfileView
│   │   ├── BadgeWall.jsx            # Grid of earned / locked badges
│   │   ├── FriendsList.jsx          # Friends + incoming/outgoing requests inside Groups tab
│   │   ├── CommentThread.jsx        # Per-game comments with edit + 5-emoji reactions (collapsed by default)
│   │   ├── NotificationBell.jsx     # Header bell, polls /api/notifications every 30s
│   │   └── admin/
│   │       ├── AdminPanel.jsx       # Admin tab container
│   │       ├── GameManager.jsx      # CRUD + set/clear result + delete + bulk actions (checkbox column)
│   │       └── UserManager.jsx      # Promote / demote / delete + bulk actions (checkbox column)
│   └── utils/
│       ├── scoring.js               # scorePick() + pickStatus() — mirrors backend formula
│       └── time.js                  # formatCountdown(), useCountdown() hook, timeAgo()
├── models/                           # Sequelize models
│   ├── User.js                      # username, password (bcrypt-hashed), role, displayName, bio, id
│   ├── Game.js
│   ├── Group.js                     # + visibility ENUM('private'|'public')
│   ├── GroupMember.js
│   ├── GroupInvite.js
│   ├── Pick.js                      # Unique composite index on (userId, gameId)
│   ├── Badge.js                     # Tier 3: badges awarded by server hooks
│   ├── Friendship.js                # Tier 3: pending/accepted, pair-unique index
│   ├── Comment.js                   # Tier 3: per-game comments; editedAt (Tier 8)
│   ├── CommentReaction.js           # Tier 8: per-(comment, user, emoji) reactions
│   ├── Notification.js              # Tier 3: in-app notification feed
│   └── index.js                     # DB init + seeding + idempotent migrations
├── badges/
│   └── catalog.js                   # Tier 3: badge slugs + names + emojis (server-side)
├── validation/
│   ├── schemas.js                   # zod schemas for every POST/PUT body
│   └── middleware.js                # validate(schema) middleware factory
├── server.js                         # Express API + auth/admin middleware + static serving
├── db-config.js
├── data.json                         # Seed data (passwords get hashed on insert)
├── .env.example
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── README.md
├── ARCHITECTURE.md
├── DATABASE_SETUP.md
├── MIGRATION_GUIDE.md
└── dist/                             # Built production files (created by `npm run build`)
```

## Key Features

### User-facing
1. **Authentication**: Register/login with JWT in localStorage; bcrypt-hashed passwords; rate-limited (5 logins / 15 min, 3 registrations / hour per IP)
2. **Game Predictions**: Pick home/away winners for upcoming games; picks lock at kickoff; **undo a pick** before kickoff
3. **Probability-Based Scoring**: `points = round((1 − probability) × 100)` for correct picks; 0 on misses or no pick
4. **Game outcome display**: Once a game has a result, GameCard highlights the winning team and shows `✓ Correct +N pts` / `✗ Missed` / `No pick`
5. **Pick deadline countdown**: Each upcoming game shows a live `Picks lock in 2d 4h` chip (updates every 30s)
6. **Games filter sections**: Live / Upcoming / Completed (completed games collapsed behind a toggle)
7. **My Picks tab**: Pick history with `All / Wins / Losses / Pending` filter chips
8. **Full leaderboards**: Overall leaderboard scrolls fully; **group leaderboard supports sort (Points / Win rate / Name) and pagination**, always anchoring the viewer's row when off-page
9. **Avatars**: Deterministic initial-on-colored-circle avatars next to every username (leaderboards, group members, comments, profiles)
10. **Search**: Header search bar — type ≥2 chars to find users, groups (member or public), and games; debounced 250ms; result click opens profile / switches tab / joins public group
11. **Groups**: Create groups (private invite-only or public discoverable); invite by username; accept/decline; **leave / transfer ownership / delete** for members and owners
12. **Discover groups**: A "Discover" section in the Groups tab lists public groups the user isn't in, with member counts and a one-click Join
13. **Friends system**: Request / accept / decline / cancel / unfriend; friends section inside the Groups tab; head-to-head record on friend profiles
14. **User profiles**: Click any leaderboard row → drawer with stats (total points, picks made, picks won, win rate), badge wall, recent picks. Own profile shows an **Edit profile** form for `displayName` (≤60 chars) and `bio` (≤280 chars); display name takes precedence over username everywhere
15. **Badges**: Awarded automatically on first pick, first win, 10/25/50 correct lifetime picks, upset-specialist (5+ wins on picks below 40% probability), group-founder
16. **Per-game comments**: Collapsible comment thread under every GameCard. Author can **edit** (shows `(edited)` flag) and delete. **Five-emoji reactions** (👍 ❤️ 😂 😮 🔥) with per-viewer state
17. **In-app notifications**: Header bell with unread badge; polled every 30s; types: `invite`, `pick-scored`, `friend-request`, `group-join`, `badge`. Click to mark read or "Mark all read"
18. **Session expiry handling**: 401 from any endpoint clears the session and shows a toast prompting re-login
19. **Logout confirmation**: Click-outside / Esc-to-close modal before signing out
20. **Loading skeletons + empty states**: Initial load shows skeleton cards; every empty list has a dashed placeholder
21. **Accessibility floor**: `htmlFor`/`id` on every form field, `aria-current` on tabs, `aria-live` status toast, `aria-busy` on the dashboard during load, `focus-visible` rings on interactive elements

### Admin-facing (Admin tab, visible only when `user.role === 'admin'`)
22. **Game manager**: Create / edit / delete games inline; set or clear result; ConfirmModal-gated delete; **bulk-select** with action bar (Result → Home/Away/Clear, Delete)
23. **User manager**: List all users with pick + group counts; promote / demote between `user` and `admin`; delete user (cascades to picks, comments, owned groups, friendships, memberships); **bulk-select** with action bar (Promote / Demote / Delete) — self always auto-skipped
24. **Self-protection**: Admin cannot demote or delete themselves (400 from server, both individual and bulk endpoints)

### Roles
- `user` (default) — can pick, join groups, view leaderboards
- `admin` — additionally can set game results, full game CRUD, and user moderation (all gated by `requireAdmin` middleware)
- Seed user `vo123` is bootstrapped as an admin via [data.json](data.json)

## API Endpoints

All endpoints require JWT auth except `/api/register` and `/api/login`.

### Auth + identity
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/register` | — | Rate-limited (3/hr/IP); zod-validated |
| POST | `/api/login` | — | Rate-limited (5/15min/IP); bcrypt compare |
| GET | `/api/me` | user | Returns `{id, username, role, displayName, bio, joinedGroups, pendingInvites}` |
| PUT | `/api/me` | user | Body `{displayName?, bio?}`; empty string clears, missing leaves alone |
| GET | `/api/users/:username/profile` | user | Stats, badges, recent picks, friendStatus, head-to-head (when friends); now includes `displayName` + `bio` |
| GET | `/api/search?q=&type=all\|users\|groups\|games` | user | Min 2 chars; up to 5 per type; group results limited to caller-member or public |

### Games + picks + leaderboard
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/games` | user | All games sorted by date |
| POST | `/api/picks` | user | zod-validated; locked once `game.date <= now` or `result != null`; awards first-pick badge |
| GET | `/api/picks` | user | Current user's picks |
| DELETE | `/api/picks/:id` | user (owner) | Undo a pick; rejected (400) if game has started or has a result |
| GET | `/api/leaderboard?groupId=&orderBy=&offset=&limit=` | user | `orderBy` ∈ `points\|winRate\|username` (default `points`); pagination on group block; response includes `groupMeta.viewerRow` so the caller's row is always retrievable |
| POST | `/api/games/:gameId/result` | **admin** | Sets `'home' / 'away' / null`; fires `pick-scored` notifications + badge eval per affected user |

### Groups
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/groups` | user | Groups the user belongs to |
| GET | `/api/groups/discover` | user | Public groups the user isn't in (capped at 20) |
| GET | `/api/groups/:groupId` | user (member) | 404 if non-member |
| POST | `/api/groups` | user | Body `{name, visibility?}`; creator auto-joins; awards group-founder badge |
| POST | `/api/groups/:groupId/invite` | user (member) | Invite by username; notifies invitee |
| POST | `/api/groups/:groupId/invite/:inviteId/accept` | user | Notifies group owner |
| POST | `/api/groups/:groupId/invite/:inviteId/decline` | user | |
| POST | `/api/groups/:groupId/join` | user | Only succeeds if `visibility='public'`; notifies owner |
| POST | `/api/groups/:groupId/leave` | user (member) | 400 if owner; notifies owner |
| POST | `/api/groups/:groupId/transfer` | user (owner) | Body `{newOwnerId}`; new owner must be a member; notifies new owner |
| DELETE | `/api/groups/:groupId` | user (owner) | Cascades members + invites; notifies former members |
| POST | `/api/groups/:groupId/visibility` | user (owner) | Toggles `'private' \| 'public'` |

### Friends
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/friends` | user | `{friends, incoming, outgoing}` |
| POST | `/api/friends/request` | user | Body `{username}`; rejects self / duplicate / already-friends; notifies addressee |
| POST | `/api/friends/:id/accept` | user (addressee) | Notifies requester |
| POST | `/api/friends/:id/decline` | user (addressee) | Deletes the row |
| DELETE | `/api/friends/:id` | user (either party) | Unfriend / cancel-outgoing |

### Comments
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/games/:gameId/comments` | user | Newest-first, capped at 50. Each row carries `editedAt`, `reactionCounts: {emoji: N}`, `yourReactions: [emoji]` |
| POST | `/api/games/:gameId/comments` | user | Body `{body}` (1–500 chars) |
| PUT | `/api/comments/:id` | author | Edit body; sets `editedAt` |
| DELETE | `/api/comments/:id` | author or admin | Cascades reactions |
| POST | `/api/comments/:id/reactions` | user | Body `{emoji}` from the fixed palette 👍 ❤️ 😂 😮 🔥; duplicates are idempotent no-ops |
| DELETE | `/api/comments/:id/reactions/:emoji` | user | Removes the caller's reaction with that emoji |

### Notifications
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/notifications` | user | `?unreadOnly=true` filter; returns `{items, unreadCount}` |
| POST | `/api/notifications/:id/read` | user | Mark one as read |
| POST | `/api/notifications/read-all` | user | Mark all as read |

### Admin (all gated by `authMiddleware` + `requireAdmin`)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/admin/games` | Create game; probabilities must sum to 1.0 ±0.01 |
| PUT | `/api/admin/games/:id` | Partial update; probability-sum check still applies when both are sent |
| DELETE | `/api/admin/games/:id` | Cascades picks + comments on the game |
| POST | `/api/admin/games/bulk` | Body `{ids, action: 'delete' \| 'setResult', result?}`; fires per-user `pick-scored` + badge eval when `setResult` |
| GET | `/api/admin/users` | List users with `picksCount`, `groupsCount` |
| POST | `/api/admin/users/:id/role` | Body `{role}`; rejects self-demote |
| DELETE | `/api/admin/users/:id` | Rejects self-delete; cascades through owned groups, picks, comments, friendships, memberships, invites |
| POST | `/api/admin/users/bulk` | Body `{ids, action: 'promote' \| 'demote' \| 'delete'}`; caller's own row is auto-skipped (returned in `skipped`) |

## Running the App

### Development
```bash
npm run dev          # Vite dev server (frontend hot-reload). Run server.js separately for the API.
node server.js       # Run backend (uses .env)
```

### Production
```bash
npm start            # Runs `vite build` then `node server.js` on port 3000
npm run build        # Just builds dist/
```

## Configuration

Copy [.env.example](.env.example) to `.env` and fill in:

- **JWT_SECRET** — **required in production**. Server throws on startup if missing while `NODE_ENV=production`; in development it warns and falls back to an insecure dev value.
- **DATABASE_URL** — optional. Defaults to local Postgres at `postgres://postgres:postgres@localhost/scorecast_db` (see [models/index.js](models/index.js)).
- **PORT** — defaults to `3000`.
- **NODE_ENV** — `development` or `production`. Gates the JWT_SECRET enforcement.

## Database

- Tables auto-created on first boot via `sequelize.sync({ alter: false })`.
- Idempotent migrations run on every boot (`runMigrations()` in [models/index.js](models/index.js)):
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS role …`
  - `CREATE UNIQUE INDEX IF NOT EXISTS picks_user_game_unique ON picks ("userId", "gameId")`
  - `CREATE TYPE enum_groups_visibility` + `ALTER TABLE groups ADD COLUMN IF NOT EXISTS visibility …`
  - `CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique ON friendships (LEAST(...), GREATEST(...))` — guarantees one row per unordered pair
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS "displayName" VARCHAR(60)` (Tier 8)
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT` (Tier 8)
  - `ALTER TABLE comments ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP WITH TIME ZONE` (Tier 8)
  - `comment_reactions` table is created automatically by `sequelize.sync({alter:false})` on first boot — no explicit ALTER needed
  - Re-hashes any seed user with a plaintext password (matched against [data.json](data.json))
- If the `users` table is empty on boot, the seed in [data.json](data.json) is inserted (passwords hashed via Sequelize `beforeCreate` hook).

### Database Models
- **User**: id, username (unique), password (bcrypt hash), `role` (`'user'|'admin'`, default `user`), `displayName` (≤60 chars, nullable), `bio` (TEXT ≤280 chars, nullable), createdAt
- **Game**: id, homeTeam, awayTeam, date, result (`'home'|'away'|null`), homeProbability, awayProbability
- **Group**: id, name, ownerId, `visibility` (`'private'|'public'`, default `private`), createdAt
- **GroupMember**: groupId, userId (composite PK)
- **GroupInvite**: id, groupId, username, createdAt
- **Pick**: id, userId, gameId, choice (`'home'|'away'`), submittedAt — **unique (userId, gameId)**
- **Badge**: id, userId, slug, awardedAt — **unique (userId, slug)**. Slugs defined in [badges/catalog.js](badges/catalog.js): `first-pick`, `first-win`, `correct-10`, `correct-25`, `correct-50`, `upset-specialist`, `group-founder`
- **Friendship**: id, requesterId, addresseeId, status (`'pending'|'accepted'`), createdAt, acceptedAt — **unique on `LEAST(requesterId, addresseeId), GREATEST(...)`**
- **Comment**: id, gameId, userId, body, createdAt, `editedAt` (nullable) — indexed by gameId
- **CommentReaction**: id, commentId, userId, emoji, createdAt — **unique (commentId, userId, emoji)**, indexed by commentId
- **Notification**: id, userId, type, title, body, link, read, createdAt — indexed by `(userId, read, createdAt)`

## Important Notes

- Vite config serves the built frontend from `dist/` via Express static middleware
- Picks can only be submitted for games before their start date AND before a result is set
- Group leaderboards only include group members
- The `request()` helper in [src/App.jsx](src/App.jsx) auto-detects 401 responses and clears the session — frontend never needs to manually log out on token expiry
- **Scoring formula is duplicated** in two places intentionally: [server.js](server.js) (`scorePick`, authoritative, used for leaderboard) and [src/utils/scoring.js](src/utils/scoring.js) (client-side preview for GameCard outcome + My Picks). **They must stay in sync.**
- **Badge + notification side effects**: any code path that sets a game result, creates a pick, creates a group, or accepts an invite must trigger the existing `evaluateBadges()` and `notify()` helpers in [server.js](server.js) — they are wired into `POST /api/picks`, `POST /api/games/:gameId/result`, `POST /api/groups`, group invite/accept, friend request/accept, and public-group join
- **Route order matters**: `/api/groups/discover` is registered *before* `/api/groups/:groupId` so Express doesn't treat `discover` as a path param. Keep this order when adding sibling routes
- **Notification bell polling**: [NotificationBell.jsx](src/components/NotificationBell.jsx) polls `/api/notifications` every 30s. Same pattern can be reused for any future near-real-time feature
- **Reaction emoji palette is fixed**: the only allowed values are 👍 ❤️ 😂 😮 🔥 (defined as `ALLOWED_EMOJIS` in [validation/schemas.js](validation/schemas.js)). Adding a new emoji means editing both the zod enum and the `REACTION_EMOJIS` array in [CommentThread.jsx](src/components/CommentThread.jsx)
- **Bulk admin endpoints share helpers with the single-item versions**: `cascadeDeleteUser()` and `cascadeDeleteGame()` in [server.js](server.js) are used by both. Self-protection on bulk-user actions returns `skipped: [{id, reason: 'self'}]` rather than erroring out — the UI surfaces it as a "skipped N" toast
- **`pickMap` shape**: in [App.jsx](src/App.jsx) the `pickMap` stores full pick objects keyed by `gameId` (not just `choice`) so GameCard can pass the pick's id to the undo handler. If you change the shape, audit [GameCard.jsx](src/components/GameCard.jsx) (`existingChoice` / `existingPickId`)
- **Avatars are deterministic**: [Avatar.jsx](src/components/Avatar.jsx) hashes the username via FNV-1a → HSL. Same username always → same color, no backend state. Display name does **not** affect the color (we seed on lowercased username) so renaming doesn't shuffle avatars

## Common Development Tasks
- **Add a new API endpoint**: route in [server.js](server.js); add `validate(schema)` middleware + a schema in [validation/schemas.js](validation/schemas.js); gate with `authMiddleware` and optionally `requireAdmin`. If admin-only, prefix the path with `/api/admin/` for consistency
- **Add a new React component**: create `.jsx` file in [src/components/](src/components/); reuse existing card shell `rounded-3xl border border-slate-800 bg-slate-900/85` and `focus-visible:ring-2 focus-visible:ring-cyan-400` for a11y
- **Add a new database model**: create file in [models/](models/), wire it up + associations in [models/index.js](models/index.js); if you change an existing model's schema, add an idempotent statement in `runMigrations()` (use `ALTER TABLE … ADD COLUMN IF NOT EXISTS` and `DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object THEN null; END $$;` for new enums). Brand-new tables don't need a manual migration — `sequelize.sync({alter:false})` creates them
- **Add a new badge**: append to [badges/catalog.js](badges/catalog.js), then add the unlock condition inside `evaluateBadges()` in [server.js](server.js)
- **Add a new notification type**: just call `notify(userId, type, title, body?, link?)` from wherever — no schema change needed (the `type` column is a free-form string). Frontend rendering in [NotificationBell.jsx](src/components/NotificationBell.jsx) is type-agnostic
- **Add a new comment reaction emoji**: edit both `ALLOWED_EMOJIS` in [validation/schemas.js](validation/schemas.js) and `REACTION_EMOJIS` in [src/components/CommentThread.jsx](src/components/CommentThread.jsx). Existing rows in `comment_reactions` are unaffected — emojis are free-form strings at the DB layer
- **Add a bulk admin action**: extend `bulkGameSchema` or `bulkUserSchema` in [validation/schemas.js](validation/schemas.js), then the switch inside the relevant `/api/admin/*/bulk` handler. Wrap in a future `sequelize.transaction()` once Tier 5.3 lands
- **Promote a user to admin**: use the Admin tab → User Manager → Promote (no SQL needed)
- **Deploy**: `npm run build` then deploy `dist/` + `server.js` + `models/` + `badges/` + `validation/` + `node_modules` + `.env`

## Known Issues / TODOs

### Still outstanding
- **CORS too permissive** — `cors({ origin: true })` in [server.js](server.js). Tighten before any non-localhost deployment.
- **No real migrations framework** — using `sync({ alter: false })` + an ad-hoc `runMigrations()`. Tier 5 candidate (sequelize-cli).
- **Leaderboard not cached** — O(users × picks × games) per `GET /api/leaderboard` request. Tier 5 candidate.
- **Multi-step deletes not transactional** — `cascadeDeleteUser`, `cascadeDeleteGame`, the bulk endpoints, and `runMigrations()` all run outside a transaction. Tier 5 candidate.
- **No real football data source** — games still come from manual entry via Admin UI or seed JSON; no external provider sync. Deferred Tier 4b item.
- **No live scores / leagues / seasons / new pick types** — deferred Tier 4b items.
- **No "game starting soon" notification** — needs a cron/scheduler. Tier 7 candidate.
- **No password reset / account lockout / CSRF protection** — Tier 6 items, blocks safe public deployment.
- **No profile privacy** — every authenticated user can view every profile. Item 8.6 from the Tier 8 plan was carved out and parked.
- **No real-time updates** — everything is HTTP polling at 30s (notifications). Live scores and reaction count syncing across viewers are Tier 7.

### Tracked in the tier plan
The current forward roadmap lives in `C:\Users\vinde\.claude\plans\can-you-confirm-that-reflective-kay.md` (Tiers 4b, 5, 6, 7, 8.6, 9). The original master plan at `C:\Users\vinde\.claude\plans\go-through-this-codebase-warm-cloud.md` is retained for historical context on shipped Tiers 1–3.
