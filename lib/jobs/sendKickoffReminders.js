'use strict';

// PWA Chunk 6 — Kickoff reminder cron.
//
// Every 15 min, finds games kicking off in the next 15-30 minutes where:
//   - status === 'scheduled'
//   - kickoffReminderSentAt IS NULL (idempotency)
// For each game, looks up every Pick on it and fires a 'kickoff-reminder'
// notification through NotificationService.notify(). That puts a row in the
// bell AND (via Chunk 4's PushService fan-out) delivers a push to every
// subscribed device whose pushPreferences['kickoff-reminder'] !== false.
//
// Idempotency: after the per-pick notify dispatches, the game's
// kickoffReminderSentAt is stamped. Subsequent ticks that re-see the same
// game (clock drift, missed ticks recovered) skip it.

const { Op } = require('sequelize');
const { Game, Pick } = require('../../models');
const NotificationService = require('../../services/NotificationService');
const logger = require('../logger');

// 15-min lead time = lower bound on how far ahead a game can be when we fire.
// 30-min ceiling = upper bound (the 15-min job cadence covers 15..30 each tick).
const LEAD_MIN = 15;
const LEAD_MAX = 30;

async function run() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + LEAD_MIN * 60 * 1000);
  const windowEnd = new Date(now.getTime() + LEAD_MAX * 60 * 1000);

  const games = await Game.findAll({
    where: {
      status: 'scheduled',
      kickoffReminderSentAt: null,
      date: { [Op.gte]: windowStart, [Op.lt]: windowEnd },
    },
  });
  if (games.length === 0) {
    return { processed: 0 };
  }

  let totalPicks = 0;
  for (const game of games) {
    const picks = await Pick.findAll({ where: { gameId: game.id } });
    if (picks.length === 0) {
      // No one picked this game — still stamp it so we don't keep re-checking.
      game.kickoffReminderSentAt = new Date();
      await game.save();
      continue;
    }

    const title = `Kickoff in 15 min: ${game.homeTeam} vs ${game.awayTeam}`;
    for (const pick of picks) {
      const pickedTeam = pick.choice === 'home' ? game.homeTeam : game.awayTeam;
      // Fire-and-forget per the NotificationService contract. notify() never
      // throws; PushService.sendToUser handles the per-user opt-out check.
      NotificationService.notify(
        pick.userId,
        'kickoff-reminder',
        title,
        `Your pick: ${pickedTeam}`,
        `/?gameId=${game.id}`,
      ).catch(() => {});
      totalPicks += 1;
    }

    // Stamp AFTER the notify loop dispatches so a mid-loop crash leaves the
    // game un-stamped and the next tick can resume safely (notify() is
    // idempotent — duplicate DB rows in the bell, but never throws).
    game.kickoffReminderSentAt = new Date();
    await game.save();
  }

  logger.info(
    { games: games.length, totalPicks },
    'sendKickoffReminders: dispatched kickoff reminders',
  );
  return { processed: games.length, totalPicks };
}

module.exports = { run };
