// Badge catalog — single source of truth consumed by:
//   - services/BadgeService.evaluateBadges (decides when to award each)
//   - services/BadgeService.computeProgressForUser (per-metric current values)
//   - frontend BadgeWall (renders earned/locked + progress bars)
//
// Optional `threshold` + `metric` pair drives the progress-bar UX. When
// both are set, BadgeWall renders "current / threshold" with a bar.
// Badges without them render plain earned/locked tiles.
//
// `metric` keys must match what BadgeService.computeProgressForUser
// returns. New metric? Add it to both the catalog entry AND the
// progress-computation helper in the same commit.
//
// Tier 30 Phase 3 A2 — expanded catalog (12 new badges + Recruiter I/II/III
// tier). Coin Flip Master is reserved for A6 (Pick of the Day).

const BADGE_CATALOG = [
  {
    slug: 'beta-tester',
    name: 'Beta Tester',
    description: 'Was here before launch. Thank you for helping test Bantryx.',
    emoji: '🧪',
  },
  {
    slug: 'first-pick',
    name: 'First Pick',
    description: 'Made your first pick.',
    emoji: '🎯',
  },
  {
    slug: 'first-win',
    name: 'First Win',
    description: 'Won your first pick.',
    emoji: '🏆',
  },
  {
    slug: 'correct-10',
    name: '10 Correct',
    description: 'Won 10 lifetime picks.',
    emoji: '🔟',
    threshold: 10,
    metric: 'wins',
  },
  {
    slug: 'correct-25',
    name: '25 Correct',
    description: 'Won 25 lifetime picks.',
    emoji: '⭐',
    threshold: 25,
    metric: 'wins',
  },
  {
    slug: 'correct-50',
    name: '50 Correct',
    description: 'Won 50 lifetime picks.',
    emoji: '💎',
    threshold: 50,
    metric: 'wins',
  },
  {
    slug: 'centurion',
    name: 'Centurion',
    description: 'Made 100 lifetime picks.',
    emoji: '💯',
    threshold: 100,
    metric: 'picks',
  },
  {
    slug: 'upset-specialist',
    name: 'Upset Specialist',
    description: 'Won 5+ picks where the chosen team had under 40% probability.',
    emoji: '🦄',
    threshold: 5,
    metric: 'upsetWins',
  },
  {
    slug: 'margin-master',
    name: 'Margin Master',
    description: 'Won 10+ picks where the chosen team had over 60% probability.',
    emoji: '🧮',
    threshold: 10,
    metric: 'favoritesWon',
  },
  {
    slug: 'hot-hand',
    name: 'Hot Hand',
    description: 'Won 3+ picks in a row.',
    emoji: '🔥',
    threshold: 3,
    metric: 'consecutiveWins',
  },
  {
    slug: 'cold-plunge',
    name: 'Cold Plunge',
    description: 'Lost 3+ picks in a row. Badge of resilience — bad runs happen.',
    emoji: '🥶',
    threshold: 3,
    metric: 'consecutiveLosses',
  },
  {
    slug: 'crystal-ball',
    name: 'Crystal Ball',
    description: '75%+ win rate across 20+ scored picks.',
    emoji: '🔮',
  },
  {
    slug: 'globetrotter',
    name: 'Globetrotter',
    description: 'Made picks across 5+ different leagues.',
    emoji: '🌍',
    threshold: 5,
    metric: 'leagues',
  },
  {
    slug: 'roundsman',
    name: 'Roundsman',
    description: 'Made picks on 10+ different days.',
    emoji: '🎟️',
    threshold: 10,
    metric: 'pickDays',
  },
  {
    slug: 'loyalist',
    name: 'Loyalist',
    description: 'Made picks across 8+ different weeks.',
    emoji: '🛡️',
    threshold: 8,
    metric: 'pickWeeks',
  },
  {
    slug: 'streakmaster-1',
    name: 'Streakmaster I',
    description: 'Won 5 picks in a row.',
    emoji: '🌋',
    threshold: 5,
    metric: 'longestStreak',
  },
  {
    slug: 'streakmaster-2',
    name: 'Streakmaster II',
    description: 'Won 10 picks in a row.',
    emoji: '🌋',
    threshold: 10,
    metric: 'longestStreak',
  },
  {
    slug: 'streakmaster-3',
    name: 'Streakmaster III',
    description: 'Won 15 picks in a row.',
    emoji: '🌋',
    threshold: 15,
    metric: 'longestStreak',
  },
  {
    slug: 'conversationalist',
    name: 'Conversationalist',
    description: 'Posted 25+ comments.',
    emoji: '💬',
    threshold: 25,
    metric: 'comments',
  },
  {
    slug: 'friendly-five',
    name: 'Friendly Five',
    description: 'Made 5 friends on Bantryx.',
    emoji: '🤝',
    threshold: 5,
    metric: 'friends',
  },
  {
    slug: 'threes-a-crowd',
    name: "Three's a Crowd",
    description: 'Joined 3 groups.',
    emoji: '👥',
    threshold: 3,
    metric: 'groups',
  },
  {
    slug: 'group-founder',
    name: 'Group Founder',
    description: 'Created a group.',
    emoji: '🏗️',
  },
  {
    slug: 'recruiter-1',
    name: 'Recruiter I',
    description: 'Recruited 1 friend who made a scored pick.',
    emoji: '🎓',
    threshold: 1,
    metric: 'referrals',
  },
  {
    slug: 'recruiter-2',
    name: 'Recruiter II',
    description: 'Recruited 5 friends who made scored picks.',
    emoji: '🎓',
    threshold: 5,
    metric: 'referrals',
  },
  {
    slug: 'recruiter-3',
    name: 'Recruiter III',
    description: 'Recruited 25 friends who made scored picks.',
    emoji: '🎓',
    threshold: 25,
    metric: 'referrals',
  },
];

module.exports = { BADGE_CATALOG };
