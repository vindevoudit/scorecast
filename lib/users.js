'use strict';

// Tier 13 Chunk 1 — user-related helpers extracted from server.js.
const { Op } = require('sequelize');
const { User, Pick, Game } = require('../models');
const { scorePick } = require('./scoring');

async function getUserById(id) {
  return User.findByPk(id);
}

async function getUserByUsername(username) {
  return User.findOne({ where: { username: { [Op.iLike]: username } } });
}

async function buildUserSummary({ leagueId, seasonId } = {}) {
  const users = await User.findAll();
  const picks = await Pick.findAll();
  // Same WHERE-clause pattern as buildGroupLeaderboard — filter games at
  // the DB layer so picks on out-of-scope games naturally fall out of the
  // in-memory join below. Users with zero in-scope picks stay listed at
  // points: 0 (no member drop).
  const gameWhere = {};
  if (leagueId) gameWhere.leagueId = leagueId;
  if (seasonId) gameWhere.seasonId = seasonId;
  const games = await Game.findAll({ where: gameWhere });

  const userScores = {};
  users.forEach((user) => {
    userScores[user.id] = {
      userId: user.id,
      username: user.username,
      displayName: user.displayName || null,
      // Tier 8.6 — included so the viewer-aware masking layer in
      // LeaderboardService can decide whether to redact this row without
      // a second DB round-trip per row.
      profileVisibility: user.profileVisibility,
      points: 0,
    };
  });

  picks.forEach((pick) => {
    const game = games.find((g) => g.id === pick.gameId);
    if (!game) return;
    userScores[pick.userId].points += scorePick(pick, game);
  });

  return Object.values(userScores).sort((a, b) => b.points - a.points);
}

module.exports = { getUserById, getUserByUsername, buildUserSummary };
