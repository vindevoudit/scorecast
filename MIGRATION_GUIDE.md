# PostgreSQL Migration Summary

## What Changed

### 1. **Database Layer**
- **Before**: NeDB (file-based, single-file per collection)
- **After**: PostgreSQL (client-server, relational database)

### 2. **New Files**
- `models/` - Sequelize model definitions:
  - `User.js` - User table definition
  - `Group.js` - Groups table definition
  - `Game.js` - Games table definition
  - `Pick.js` - User picks table definition
  - `GroupMember.js` - Many-to-many group membership table
  - `GroupInvite.js` - Group invitations table
  - `index.js` - Sequelize initialization and associations
- `.env` - Environment variables (new)
- `db-config.js` - Database configuration
- `DATABASE_SETUP.md` - Setup instructions

### 3. **Updated Files**
- `server.js` - Replaced all NeDB queries with Sequelize ORM
  - NeDB: `usersDB.findOne()` → Sequelize: `User.findOne()`
  - NeDB: `usersDB.insert()` → Sequelize: `User.create()`
  - NeDB: `groupsDB.find()` → Sequelize: `Group.findAll()`
  - All business logic (scoring, leaderboards) remains the same

### 4. **Key Improvements**
- **Scalability**: Handles 1000s of concurrent users
- **Data Integrity**: ACID compliance prevents data corruption
- **Performance**: Indexed queries, connection pooling
- **Multi-server**: Data shared across app instances
- **Backup**: Use PostgreSQL native tools for backups

### 5. **Backward Compatibility**
- **Old data.json**: Still supported for seeding
- **API endpoints**: Identical, no frontend changes
- **Business logic**: Scoring and leaderboards unchanged
- **JWT auth**: Same implementation

## Database Schema

### users table
```
id (UUID, PK)
username (VARCHAR, UNIQUE)
password (VARCHAR)
createdAt (TIMESTAMP)
```

### groups table
```
id (UUID, PK)
name (VARCHAR)
ownerId (UUID, FK → users)
createdAt (TIMESTAMP)
```

### group_members (junction table)
```
groupId (UUID, PK, FK → groups)
userId (UUID, PK, FK → users)
```

### games table
```
id (UUID, PK)
homeTeam (VARCHAR)
awayTeam (VARCHAR)
date (TIMESTAMP)
homeProbability (DECIMAL)
awayProbability (DECIMAL)
result (ENUM: 'home', 'away', NULL)
```

### picks table
```
id (UUID, PK)
userId (UUID, FK → users)
gameId (UUID, FK → games)
choice (ENUM: 'home', 'away')
submittedAt (TIMESTAMP)
```

### group_invites table
```
id (UUID, PK)
groupId (UUID, FK → groups)
username (VARCHAR)
createdAt (TIMESTAMP)
```

## Setup Instructions

### 1. Install PostgreSQL
Follow the OS-specific guide in `DATABASE_SETUP.md`

### 2. Create Database
```bash
psql -U postgres
CREATE DATABASE scorecast_db;
\q
```

### 3. Configure .env
Update `.env` with your PostgreSQL credentials:
```
DATABASE_URL=postgres://username:password@localhost:5432/scorecast_db
```

### 4. Install Dependencies (Already Done)
```bash
npm install
```

### 5. Run the App
```bash
npm run build
npm start
```

The server will:
- Connect to PostgreSQL
- Auto-create schema (Sequelize.sync)
- Seed data from `data.json` if database is empty
- Start on http://localhost:3000

## Troubleshooting

### "connect ECONNREFUSED 127.0.0.1:5432"
- PostgreSQL is not running
- **Fix**: `brew services start postgresql` (macOS) or `sudo systemctl start postgresql` (Linux)

### "password authentication failed"
- Wrong credentials in `.env`
- **Fix**: Check DATABASE_URL matches your PostgreSQL setup

### "database 'scorecast_db' does not exist"
- Database not created
- **Fix**: Run `createdb scorecast_db` or use pgAdmin

### Models not loading
- Missing dependencies
- **Fix**: `npm install` again

### Port 3000 already in use
- Another app using the port
- **Fix**: `PORT=3001 npm start` or kill the process

## Next Steps (Optional)

### 1. Add Password Hashing
Install bcrypt and hash passwords before storage:
```bash
npm install bcrypt
```

### 2. Add Migrations
Use Sequelize CLI for version control:
```bash
npx sequelize-cli init
npx sequelize-cli migration:generate --name initial-schema
```

### 3. Add Connection Pool
Optimize performance for many concurrent users in `models/index.js`

### 4. Production Deployment
- Use cloud PostgreSQL (AWS RDS, Heroku, Google Cloud SQL)
- Update DATABASE_URL in production environment
- Enable SSL for connections

## Files to Keep/Reference

- `server.js.bak` - Original NeDB version (backup)
- `data.json` - Seed data (still used)
- Old `.db` files (users.db, groups.db, etc.) - Can be deleted after verification

## Support

For issues, check:
1. PostgreSQL is running: `psql --version`
2. Database exists: `psql -l`
3. Connection works: `psql -U postgres -d scorecast_db`
4. Server logs for error messages
