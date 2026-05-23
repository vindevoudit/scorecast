const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Game = sequelize.define(
    'Game',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      homeTeam: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      awayTeam: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      homeProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
      },
      drawProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
        defaultValue: 0,
      },
      awayProbability: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
      },
      result: {
        type: DataTypes.ENUM('home', 'away', 'draw'),
        allowNull: true,
      },
      // Tier 17 PR F — per-game Elo snapshot (taken at first capture, immutable
      // for the life of the game) + record of which result value has been
      // Elo-applied. PredictionService.onResultUpdated uses these to make
      // the cascade idempotent (re-capturing the same result no-ops) and
      // reversible (changing a captured result reverses the prior delta
      // against the snapshot then applies the new delta).
      homeEloPre: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
      },
      awayEloPre: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
      },
      appliedResult: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      // Tier 4b Chunk 1 — league/season/source attribution. leagueId stays
      // nullable until Chunk 3 backfills legacy rows and tightens it.
      leagueId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      seasonId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      sourceId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      // Tier 4b Chunk 1 — live-score columns + lifecycle status. The
      // live-score sync writes status transitions; result writes still go
      // through the existing scoring path.
      status: {
        type: DataTypes.ENUM('scheduled', 'in-progress', 'finished', 'postponed', 'cancelled'),
        allowNull: false,
        defaultValue: 'scheduled',
      },
      homeScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      awayScore: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      kickoffTz: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      // Tier 4b Chunk 2 follow-up — phase signals so the client can
      // produce a better "minute" estimate without paid upstream access.
      halfTimeReached: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      phase: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      // PWA Chunk 6 — set by lib/jobs/sendKickoffReminders.js after the
      // 15-min-before-kickoff push fan-out lands. Null = no reminder sent yet
      // (legacy rows + upcoming-but-not-yet-reached-window games).
      kickoffReminderSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'games',
      timestamps: false,
    },
  );

  return Game;
};
