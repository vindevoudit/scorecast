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

async function buildUserSummary() {
  const users = await User.findAll();
  const picks = await Pick.findAll();
  const games = await Game.findAll();

  const userScores = {};
  users.forEach((user) => {
    userScores[user.id] = {
      userId: user.id,
      username: user.username,
      displayName: user.displayName || null,
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
