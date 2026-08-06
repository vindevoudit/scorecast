// Tier 34 — the T20 pick surface. Mounted by GameCard in place of the football
// PayoutMatrix + pick buttons when game.sport === 'cricket'.
//
// Two markets, deliberately different in weight and in interaction:
//
//   Winner — a flat +50, one tap, posted immediately. Same one-tap feel as
//     football so getting on the board stays frictionless.
//   Runs   — optional, up to +100 per side, with an explicit Save. Typing two
//     numbers is not a tap, so it should not fire a request per keystroke.
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

function RunsField({ id, label, value, onChange, disabled }) {
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
        disabled={disabled}
        className="font-led w-full rounded-xl border border-default bg-elevated/90 px-3 py-2 text-center text-base tabular-nums text-fg outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      />
    </div>
  );
}

function CricketMarketPanel({ game, existingPick, onSubmit }) {
  const { gate } = useAuthGate();
  const choice = existingPick?.choice || null;

  const [homeRuns, setHomeRuns] = useState('');
  const [awayRuns, setAwayRuns] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Rehydrate from the server copy whenever it changes — covers the first
  // load, a refreshPicks after saving, and switching between cards.
  useEffect(() => {
    setHomeRuns(
      existingPick?.predictedHomeRuns != null ? String(existingPick.predictedHomeRuns) : '',
    );
    setAwayRuns(
      existingPick?.predictedAwayRuns != null ? String(existingPick.predictedAwayRuns) : '',
    );
    setSaved(false);
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

  async function saveRuns() {
    if (!gate('predict the runs')) return;
    // The runs legs ride on the same pick row as the winner, and choice is
    // NOT NULL, so there is nothing to attach them to until a side is backed.
    if (!choice) return;
    setSaving(true);
    try {
      await onSubmit(game.id, choice, {
        predictedHomeRuns: parse(homeRuns),
        predictedAwayRuns: parse(awayRuns),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={pickButtonClass(choice === 'home')}
          onClick={() => {
            if (!gate('make a pick')) return;
            onSubmit(game.id, 'home');
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
            onSubmit(game.id, 'away');
          }}
          aria-label={`Pick ${displayTeamName(game.awayTeam)} to win`}
        >
          Pick {displayTeamName(game.awayTeam)}
        </button>
      </div>

      <div className="rounded-2xl border border-default bg-overlay/40 p-3">
        <p className="text-xs font-semibold text-fg">Pick a winner and predict the runs</p>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          Back the winner for <span className="text-fg">+{CRICKET_WINNER_POINTS}</span>. Each runs
          prediction scores{' '}
          <span className="text-fg">
            {CRICKET_RUNS_LEG_MAX} minus however many runs you are out by
          </span>
          . Totals are compared to a <strong className="text-fg">20-over equivalent</strong>: a side
          that bats fewer overs is scaled up, unless it is bowled out.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <RunsField
            id={`runs-home-${game.id}`}
            label={displayTeamName(game.homeTeam)}
            value={homeRuns}
            onChange={setHomeRuns}
            disabled={saving}
          />
          <RunsField
            id={`runs-away-${game.id}`}
            label={displayTeamName(game.awayTeam)}
            value={awayRuns}
            onChange={setAwayRuns}
            disabled={saving}
          />
        </div>

        {choice ? (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={saveRuns}
              disabled={saving || !dirty}
              className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save runs'}
            </button>
            {saved && !dirty ? (
              <span className="text-[11px] text-success">Saved</span>
            ) : dirty ? (
              <span className="text-[11px] text-fg-muted">Unsaved changes</span>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-fg-muted">Back a winner first to save your runs.</p>
        )}
      </div>
    </div>
  );
}

export default CricketMarketPanel;
