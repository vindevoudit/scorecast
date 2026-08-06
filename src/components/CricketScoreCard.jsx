// Tier 34 — post-match scoring breakdown for a T20 pick.
//
// A cricket pick has three independent legs and a 250-point ceiling, so a
// single "+222 pts" chip (which is all football needs) hides everything the
// user actually wants to know: which leg carried them, which one they blew,
// and how close the runs were. This renders the whole card.
//
// It reads scoreCricketBreakdown, which shares every code path with the
// scorer itself, so the per-leg figures here cannot disagree with the points
// that landed on the leaderboard.

import {
  scoreCricketBreakdown,
  CRICKET_WINNER_POINTS,
  CRICKET_RUNS_LEG_MAX,
} from '../utils/scoring';
import { displayTeamName } from '../utils/teamNames';

// Zero is the failure state worth colouring: on the runs legs it means the
// prediction was 100 or more out, and on the winner leg it means the wrong
// side was backed. A full-marks leg gets the positive tone; everything in
// between is neutral, so the eye goes to the extremes rather than to a wash
// of colour.
function toneFor(points, max) {
  if (points <= 0) return 'text-danger';
  if (points >= max) return 'text-success';
  return 'text-fg';
}

function Row({ label, detail, points, max, entered = true }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-fg">{label}</p>
        {detail ? <p className="mt-0.5 truncate text-[11px] text-fg-muted">{detail}</p> : null}
      </div>
      {entered ? (
        <p className={`font-led shrink-0 text-sm tabular-nums ${toneFor(points, max)}`}>
          +{points}
        </p>
      ) : (
        <p className="shrink-0 text-[11px] text-fg-subtle">not predicted</p>
      )}
    </div>
  );
}

function CricketScoreCard({ game, pick }) {
  const b = scoreCricketBreakdown(pick, game);
  if (!b.scored) return null;

  const home = displayTeamName(game.homeTeam);
  const away = displayTeamName(game.awayTeam);
  const backed = pick.choice === 'home' ? home : away;

  // "you 150 · 130 → 195" — the arrow only appears when proration actually
  // moved the number, so an unprorated innings stays uncluttered and the
  // arrow reliably signals "this was scaled".
  const runsDetail = (predicted, effective, rawScore) => {
    if (predicted == null) return null;
    if (effective == null) return `you ${predicted} · no result`;
    const scaled = rawScore != null && Number(rawScore) !== effective;
    return `you ${predicted} · ${scaled ? `${rawScore} → ${effective}` : effective}`;
  };

  const anyProrated =
    (pick.predictedHomeRuns != null && Number(game.homeScore) !== b.homeEffective) ||
    (pick.predictedAwayRuns != null && Number(game.awayScore) !== b.awayEffective);

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-default bg-divider">
      <p className="bg-overlay/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
        How you scored
      </p>
      <div className="grid gap-px">
        <div className="bg-overlay/70">
          <Row label="Winner" detail={backed} points={b.winner} max={CRICKET_WINNER_POINTS} />
        </div>
        <div className="bg-overlay/70">
          <Row
            label={`${home} runs`}
            detail={runsDetail(pick.predictedHomeRuns, b.homeEffective, game.homeScore)}
            points={b.homeRuns}
            max={CRICKET_RUNS_LEG_MAX}
            entered={pick.predictedHomeRuns != null}
          />
        </div>
        <div className="bg-overlay/70">
          <Row
            label={`${away} runs`}
            detail={runsDetail(pick.predictedAwayRuns, b.awayEffective, game.awayScore)}
            points={b.awayRuns}
            max={CRICKET_RUNS_LEG_MAX}
            entered={pick.predictedAwayRuns != null}
          />
        </div>
        <div className="flex items-baseline justify-between gap-3 bg-overlay/40 px-3 py-2.5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-fg">Total</p>
          <p className="font-led shrink-0 text-lg tabular-nums text-accent">+{b.total}</p>
        </div>
      </div>
      {anyProrated ? (
        <p className="bg-overlay/40 px-3 py-2 text-center text-[10px] font-medium text-fg-muted">
          → is the 20-over equivalent. A side that batted fewer overs is scaled up, unless it was
          bowled out.
        </p>
      ) : null}
    </div>
  );
}

export default CricketScoreCard;
