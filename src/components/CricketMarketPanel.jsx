// Tier 34 — the T20 pick surface. Mounted by GameCard in place of the football
// PayoutMatrix + pick buttons when game.sport === 'cricket'.
//
// Two markets, deliberately different in weight and in interaction:
//
//   Winner — a flat +50, one tap, posted immediately. Same one-tap feel as
//     football so getting on the board stays frictionless.
//   Runs   — optional, up to +100 per side, autosaved on a typing pause. No
//     Save button: a number field the user has already filled in should not
//     need confirming, and the commonest way to lose a prediction is to type
//     it and navigate away. Debounced so a 3-digit total is one write.
//
// The proration explainer is NOT decoration. Runs are scored against a side's
// 20-over equivalent, so a chase won with overs to spare inflates: 130 off 80
// balls counts as 195. A user who predicts the literal final score of a
// successful chase will score badly and, without this line, will reasonably
// think the app is broken.

import { useEffect, useState } from 'react';
import { useAuthGate } from '../hooks/useAuthGate';
import { CRICKET_WINNER_POINTS, CRICKET_RUNS_LEG_MAX } from '../utils/scoring';
import { displayTeamName } from '../utils/teamNames';

const MAX_RUNS = 400;

function pickButtonClass(active) {
  return [
    'w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    active
      ? 'border-accent bg-accent/15 text-accent shadow-brand-glow'
      : 'border-default bg-overlay/60 text-fg hover:border-accent/50 hover:bg-overlay',
  ].join(' ');
}

// Never disabled — autosave fires while the user may still be typing, and
// locking the field mid-flight would swallow keystrokes.
function RunsField({ id, label, value, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block truncate text-[11px] text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min="0"
        max={MAX_RUNS}
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Spinners off. Runs are typed, not nudged — a 3-digit total is
        // nowhere near the arrows, and on a touch target they are just two
        // mis-tap zones inside the field. type=number is kept for the mobile
        // numeric keypad and the min/max semantics.
        className="font-led w-full appearance-none rounded-xl border border-default bg-elevated/90 px-3 py-2 text-center text-base tabular-nums text-fg outline-none transition [appearance:textfield] focus:border-accent focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

function CricketMarketPanel({ game, existingPick, onSubmit }) {
  const { gate } = useAuthGate();
  const choice = existingPick?.choice || null;

  const [homeRuns, setHomeRuns] = useState('');
  const [awayRuns, setAwayRuns] = useState('');
  // 'idle' | 'saving' | 'saved' | 'error'
  const [status, setStatus] = useState('idle');

  // Rehydrate from the server copy whenever it changes — covers the first
  // load, a refreshPicks after saving, and switching between cards.
  useEffect(() => {
    setHomeRuns(
      existingPick?.predictedHomeRuns != null ? String(existingPick.predictedHomeRuns) : '',
    );
    setAwayRuns(
      existingPick?.predictedAwayRuns != null ? String(existingPick.predictedAwayRuns) : '',
    );
  }, [existingPick?.predictedHomeRuns, existingPick?.predictedAwayRuns, existingPick?.id]);

  const parse = (raw) => {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_RUNS, Math.max(0, Math.trunc(n)));
  };

  const dirty =
    parse(homeRuns) !== (existingPick?.predictedHomeRuns ?? null) ||
    parse(awayRuns) !== (existingPick?.predictedAwayRuns ?? null);

  // The client always sends the FULL desired state, matching the server's
  // upsert contract. Load-bearing on the winner buttons: a user who types runs
  // before backing a side would otherwise have them dropped by the POST, and
  // the hydration effect above would then wipe the fields from the server copy.
  const currentRuns = () => ({
    predictedHomeRuns: parse(homeRuns),
    predictedAwayRuns: parse(awayRuns),
  });

  // Autosave on a typing pause. 700ms is long enough that "1" -> "17" -> "178"
  // is one write rather than three, and short enough that a user who types a
  // number and immediately closes the app still has it saved.
  //
  // This cannot loop: a successful save triggers refreshPicks, the hydration
  // effect above rewrites the fields from the server copy, `dirty` goes false,
  // and the effect returns early. Clearing a field parses to null, which is a
  // real edit — it removes that leg.
  useEffect(() => {
    if (!choice || !dirty) return undefined;
    const handle = setTimeout(async () => {
      setStatus('saving');
      const ok = await onSubmit(
        game.id,
        choice,
        currentRuns(),
        // Silent: no toast and no games/leaderboard refetch. Editing runs on
        // an upcoming fixture changes neither.
        { silent: true },
      );
      setStatus(ok ? 'saved' : 'error');
    }, 700);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeRuns, awayRuns, choice, dirty]);

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={pickButtonClass(choice === 'home')}
          onClick={() => {
            if (!gate('make a pick')) return;
            onSubmit(game.id, 'home', currentRuns());
          }}
          aria-label={`Pick ${displayTeamName(game.homeTeam)} to win`}
        >
          Pick {displayTeamName(game.homeTeam)}
        </button>
        <button
          type="button"
          className={pickButtonClass(choice === 'away')}
          onClick={() => {
            if (!gate('make a pick')) return;
            onSubmit(game.id, 'away', currentRuns());
          }}
          aria-label={`Pick ${displayTeamName(game.awayTeam)} to win`}
        >
          Pick {displayTeamName(game.awayTeam)}
        </button>
      </div>

      <div className="rounded-2xl border border-default bg-overlay/40 p-3">
        <p className="text-xs font-semibold text-fg">Pick a winner and predict the runs</p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          Back the winner for <span className="text-fg">{CRICKET_WINNER_POINTS} points</span>. Each
          runs prediction scores{' '}
          <span className="text-fg">
            {CRICKET_RUNS_LEG_MAX} minus however many runs you are out by
          </span>
          . Totals are compared to a <strong className="text-fg">20-over equivalent</strong>: a side
          that bats fewer overs is scaled up, unless it is bowled out. If{' '}
          <strong className="text-fg">weather cuts an innings short</strong>, both runs predictions
          are voided and the match pays the winner alone.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <RunsField
            id={`runs-home-${game.id}`}
            label={displayTeamName(game.homeTeam)}
            value={homeRuns}
            onChange={setHomeRuns}
          />
          <RunsField
            id={`runs-away-${game.id}`}
            label={displayTeamName(game.awayTeam)}
            value={awayRuns}
            onChange={setAwayRuns}
          />
        </div>

        {/* No Save button — runs write themselves on a typing pause. The
            status line is deliberately quiet and reserves its own height, so
            it never reflows the card as it cycles. */}
        {choice ? (
          <p className="mt-2 h-4 text-[11px] text-fg-muted" role="status" aria-live="polite">
            {status === 'saving'
              ? 'Saving…'
              : status === 'error'
                ? 'Could not save — check your connection'
                : dirty
                  ? 'Saving shortly…'
                  : status === 'saved'
                    ? 'Saved'
                    : ''}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-fg-muted">
            Back a winner above and your runs will save automatically.
          </p>
        )}
      </div>
    </div>
  );
}

export default CricketMarketPanel;
