# ScoreCast

A football prediction web app built with React, Vite, Tailwind CSS, and an Express backend using PostgreSQL for persistent data storage.

## Features

- Register and sign in with a username and password
- Create groups and invite other users by username
- View upcoming football matches with probability-based odds
- Submit picks for match winners and earn points when correct
- Leaderboards for overall and group rankings

## Tech Stack

- Frontend: `React`, `Vite`, `Tailwind CSS`
- Backend: `Node.js`, `Express`
- Database: `PostgreSQL` with `Sequelize` ORM
- Authentication: JWT tokens

## Setup

### Prerequisites
- Node.js (v14+)
- PostgreSQL database running locally or remotely

### Configuration

Create a `.env` file in the project root with your database credentials:

```bash
DATABASE_URL=postgres://username:password@localhost:5432/scorecast_db
JWT_SECRET=your-secret-key-here
PORT=3001
```

For local development with default PostgreSQL setup:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/scorecast_db
```

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the development server (runs both frontend on port 5173 and backend on port 3001):

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

3. Open `http://localhost:3001`

## Demo users

- Username: `alice`, Password: `secret`
- Username: `bob`, Password: `secret`

## Notes

- Correct picks score `100 - probability*100`, so underdog picks earn more points when right.
- Persistent data is stored in PostgreSQL tables managed by Sequelize ORM.
- The backend serves the built frontend from `dist/` in production.
- During development, Vite proxies API calls from port 5173 to the backend on port 3001.
