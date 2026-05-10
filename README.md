# ScoreCast

A football prediction web app built with React, Vite, Tailwind CSS, and an Express backend using NeDB for local persistence.

## Features

- Register and sign in with a username and password
- Create groups and invite other users by username
- View upcoming football matches with probability-based odds
- Submit picks for match winners and earn points when correct
- Leaderboards for overall and group rankings

## Tech Stack

- Frontend: `React`, `Vite`, `Tailwind CSS`
- Backend: `Node.js`, `Express`
- Persistence: `nedb-promises` with local `.db` files
- Authentication: JWT tokens

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open `http://localhost:5173`

## Production build

1. Build the frontend:

```bash
npm run build
```

2. Start the production server:

```bash
npm start
```

3. Open `http://localhost:3000`

## Demo users

- Username: `alice`, Password: `secret`
- Username: `bob`, Password: `secret`

## Notes

- Correct picks score `100 - probability*100`, so underdog picks earn more points when right.
- Persistent data is stored in local NeDB files: `users.db`, `groups.db`, `games.db`, and `picks.db`.
- The backend serves the built frontend from `dist/` in production.
