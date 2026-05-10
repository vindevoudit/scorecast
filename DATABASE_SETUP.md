# PostgreSQL Setup Guide

## Prerequisites
Ensure PostgreSQL is installed on your machine.

### macOS
```bash
brew install postgresql
brew services start postgresql
```

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Windows
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

## Create Database and User

### Option 1: Using psql CLI
```bash
# Connect to PostgreSQL (may need password)
psql -U postgres

# Create database
CREATE DATABASE scorecast_db;

# Create user (optional - use postgres user by default)
CREATE USER scorecast WITH PASSWORD 'scorecast_pass';
ALTER ROLE scorecast WITH CREATEDB;

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE scorecast_db TO scorecast;

# Exit
\q
```

### Option 2: Using pgAdmin (GUI)
1. Open pgAdmin
2. Right-click "Databases" and create `scorecast_db`
3. Right-click and create a user if desired

## Environment Variables
The app uses `.env` file with:
```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/scorecast_db
JWT_SECRET=scorecast-demo-secret-2026
NODE_ENV=development
PORT=3000
```

Edit the `DATABASE_URL` if you used different credentials.

## Run the App
```bash
# Install dependencies (if not done)
npm install

# Build frontend
npm run build

# Start server (will auto-sync database schema)
npm start
```

The server will create tables automatically on first run and seed data from `data.json`.

## Verify Database
```bash
# Connect to database
psql -U postgres -d scorecast_db

# List tables
\dt

# View users
SELECT * FROM users;

# Exit
\q
```

## Troubleshooting

### Connection Error
- Ensure PostgreSQL service is running
- Check DATABASE_URL in .env
- Verify username/password

### Port in Use
- Change PORT in .env or `npm start` command
- Example: `PORT=3001 npm start`

### Tables Not Created
- Check server logs for migration errors
- Try `npm run build && npm start` again

## Production Deployment
For production, update DATABASE_URL to your cloud provider:
- AWS RDS: `postgres://user:pass@host:port/dbname`
- Heroku: Use `heroku config:set DATABASE_URL=...`
- Google Cloud SQL: Similar format with SSL requirements
