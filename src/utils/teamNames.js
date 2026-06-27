// Display-only short forms for team names. The DB stores football-data.org's
// canonical "Wolverhampton Wanderers FC" etc.; this maps those to the casual
// names users actually say out loud ("Wolves").
//
// USAGE
//   import { displayTeamName } from '../utils/teamNames';
//   <span>{displayTeamName(game.homeTeam)}</span>
//
// Aliases apply everywhere team names show up for *display* — except the
// pick buttons in GameCard, where we keep the full name (the button is an
// action label, not a decoration; "Pick West Ham United FC" reads more
// deliberately than "Pick West Ham" when you're committing a vote).
//
// Add a new entry below by mapping the canonical DB name (right side of
// ml/scorecast_ml/reconcile/teams.json) to the display form you want.
// Unknown names fall through unchanged, so missing entries are safe.

const ALIASES = {
  // Premier League — canonical names from football-data.org
  'AFC Bournemouth': 'Bournemouth',
  'Arsenal FC': 'Arsenal',
  'Aston Villa FC': 'Aston Villa',
  'Brentford FC': 'Brentford',
  'Brighton & Hove Albion FC': 'Brighton',
  'Burnley FC': 'Burnley',
  'Chelsea FC': 'Chelsea',
  'Crystal Palace FC': 'Crystal Palace',
  'Everton FC': 'Everton',
  'Fulham FC': 'Fulham',
  'Ipswich Town FC': 'Ipswich',
  'Leeds United FC': 'Leeds',
  'Leicester City FC': 'Leicester',
  'Liverpool FC': 'Liverpool',
  'Luton Town FC': 'Luton',
  'Manchester City FC': 'Man City',
  'Manchester United FC': 'Man United',
  'Newcastle United FC': 'Newcastle',
  'Nottingham Forest FC': 'Nottingham Forest',
  'Sheffield United FC': 'Sheffield United',
  'Southampton FC': 'Southampton',
  'Sunderland AFC': 'Sunderland',
  'Tottenham Hotspur FC': 'Tottenham',
  'West Ham United FC': 'West Ham',
  'Wolverhampton Wanderers FC': 'Wolves',
};

export function displayTeamName(fullName) {
  if (!fullName) return fullName;
  return ALIASES[fullName] || fullName;
}

// Football-data.org returns placeholder team strings for knockout-stage
// fixtures whose participants haven't advanced yet — literal "TBD" (the
// fallback in lib/footballApi.js `homeTeam ?? 'TBD'`) plus the upstream
// "Winner of QF1" / "Loser of SF2" / "Group A 1st" patterns that show up
// during the 2026 World Cup sync. Match them so GameCard can hide the
// payout matrix + disable pick buttons until real teams populate.
// Mirror of lib/placeholderTeam.js PLACEHOLDER_PATTERN (backend) — keep in
// sync in the same commit.
const PLACEHOLDER_PATTERN = /^(tbd|winner|loser|group\s|placeholder|runner-up)/i;

export function isPlaceholderTeam(name) {
  if (!name) return true;
  return PLACEHOLDER_PATTERN.test(String(name).trim());
}

export function isPlaceholderGame(game) {
  if (!game) return false;
  return isPlaceholderTeam(game.homeTeam) || isPlaceholderTeam(game.awayTeam);
}
