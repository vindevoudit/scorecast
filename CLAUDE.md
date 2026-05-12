# ScoreCast v0.1 - Project Handover

## Project Overview
ScoreCast is a full-stack football prediction web app built with React + Node/Express. Users can make picks on games, join groups with friends, and compete on leaderboards with probability-based scoring.

## Tech Stack
- **Frontend**: React 18 + Vite + Tailwind CSS + PostCSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (with Sequelize ORM)
- **Auth**: JWT tokens with 7-day expiry
- **State Management**: React hooks (useState, useEffect, useMemo)

## Project Structure
```
ScoreCast v0.1/
├── src/                           # React frontend source
│   ├── App.jsx                   # Main app component (dashboard + auth views)
│   ├── main.jsx                  # React entry point
│   ├── index.css                 # Global styles
│   └── components/
│       ├── GameCard.jsx          # Individual game pick component
│       ├── GroupCard.jsx         # Group display + invite form
│       ├── GroupLeaderboardCard.jsx
│       ├── InviteRow.jsx
│       ├── LeaderboardCard.jsx   # Leaderboard display
│       ├── LoginForm.jsx
│       └── RegisterForm.jsx
├── models/                        # Sequelize models
│   ├── User.js
│   ├── Game.js
│   ├── Group.js
│   ├── GroupMember.js
│   ├── GroupInvite.js
│   ├── Pick.js
│   └── index.js                  # Database initialization
├── server.js                      # Express API server + static file serving
├── db-config.js                   # Database configuration
├── vite.config.js                # Vite build config with API proxy
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── README.md
├── ARCHITECTURE.md
├── DATABASE_SETUP.md
├── MIGRATION_GUIDE.md
└── dist/                          # Built production files (created by `npm run build`)
```

## Key Features
1. **Authentication**: Register/login with JWT tokens stored in localStorage
2. **Game Predictions**: Pick home/away winners for upcoming games
3. **Probability-Based Scoring**: Points = (1 - probability) * 100 for correct picks (rewards upset picks)
4. **Groups**: Create private groups and invite friends by username
5. **Group Invites**: Accept/decline group invitations
6. **Leaderboards**: Overall leaderboard + group-specific leaderboards

## API Endpoints
- `POST /api/register` - Create account
- `POST /api/login` - Login, returns JWT token
- `GET /api/me` - Get current user + pending invites
- `GET /api/games` - Fetch all games
- `POST /api/picks` - Submit/update a pick
- `GET /api/picks` - Fetch user's picks
- `GET /api/groups` - Get user's groups
- `POST /api/groups` - Create a group
- `POST /api/groups/:groupId/invite` - Invite user to group
- `POST /api/groups/:groupId/invite/:inviteId/accept` - Accept invite
- `POST /api/groups/:groupId/invite/:inviteId/decline` - Decline invite
- `GET /api/leaderboard` - Get overall and group leaderboards
- `POST /api/games/:gameId/result` - Set game result (admin)

## Running the App

### Development
```bash
npm run dev          # Runs Vite dev server + needs separate server.js
```

### Production
```bash
npm start            # Builds React (vite build) then runs Express server on port 3000
npm run build        # Just builds the dist/ folder
```

## Configuration
- **JWT_SECRET**: Environment variable or defaults to `scorecast-demo-secret-2026`
- **PORT**: Environment variable or defaults to `3000`
- **Database**: Configured in `db-config.js` (PostgreSQL expected)

## Important Notes
- Port consistency: Both `server.js` and `vite.config.js` proxy target must match
- Vite config serves frontend files from `dist/` folder via Express static middleware
- All API routes require JWT authentication (except `/api/register` and `/api/login`)
- Picks can only be submitted for games before their start date
- Group leaderboards only include group members

## Database Models
- **User**: username, password, id
- **Game**: id, homeTeam, awayTeam, date, result, homeProbability, awayProbability
- **Group**: id, name, ownerId, createdAt
- **GroupMember**: groupId, userId
- **GroupInvite**: id, groupId, username, createdAt
- **Pick**: id, userId, gameId, choice (home/away), submittedAt

## Common Development Tasks
- Add new API endpoint: Create route in `server.js`
- Add new React component: Create `.jsx` file in `src/components/`
- Add new database model: Create model file in `models/`, update `models/index.js`
- Deploy: Run `npm run build` then deploy `dist/` folder + `server.js` + node_modules

## Known Issues / TODOs
- Passwords stored in plaintext (should use bcrypt)
- No rate limiting on auth endpoints
- No input validation/sanitization
- Admin endpoints (set game result) not protected with role-based auth
