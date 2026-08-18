// Tier 34 — T20 result entry. Football results are a single click ("Home won");
// cricket needs a full scorecard, because the runs legs are scored against each
// side's 20-over-equivalent total and that cannot be derived from the winner.
//
// Posts to POST /api/admin/games/:gameId/cricket-result, a separate route from
// the football result path so the football wire format stays frozen.

import { useState } from 'react';
import { Button, Input } from '../ui';
import { oversToBalls } from '../../utils/sports';
import { displayTeamName } from '../../utils/teamNames';

const EMPTY_INNINGS = { runs: '', wickets: '', overs: '20.0', allOut: false };

function InningsFields({ idPrefix, label, value, onChange, disabled }) {
  // Ten wickets IS all out — a side has eleven players. Derive it so the
  // operator does not have to think about it, but leave the checkbox editable
  // because a side can legitimately be all out at 9 down with a batter absent
  // hurt or retired out. allOut is what suppresses proration, so getting it
  // wrong silently inflates or deflates that side's runs leg.
  const setWickets = (raw) => {
    const next = { ...value, wickets: raw };
    if (raw === '10') next.allOut = true;
    else if (value.wickets === '10' && value.allOut) next.allOut = false;
    onChange(next);
  };

  const ballsPreview = oversToBalls(value.overs);
  const oversInvalid = value.overs !== '' && ballsPreview == null;

  return (
    <div className="rounded-xl border border-default bg-overlay/40 p-3">
      <p className="mb-2 truncate text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor={`${idPrefix}-runs`} className="mb-1 block text-[11px] text-fg-subtle">
            Runs
          </label>
          <Input
            id={`${idPrefix}-runs`}
            type="number"
            min="0"
            max="999"
            inputMode="numeric"
            value={value.runs}
            onChange={(e) => onChange({ ...value, runs: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-wickets`} className="mb-1 block text-[11px] text-fg-subtle">
            Wickets
          </label>
          <Input
            id={`${idPrefix}-wickets`}
            type="number"
            min="0"
            max="10"
            inputMode="numeric"
            value={value.wickets}
            onChange={(e) => setWickets(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-overs`} className="mb-1 block text-[11px] text-fg-subtle">
            Overs
          </label>
          <Input
            id={`${idPrefix}-overs`}
            type="text"
            inputMode="decimal"
            placeholder="18.4"
            value={value.overs}
            onChange={(e) => onChange({ ...value, overs: e.target.value })}
            disabled={disabled}
            aria-invalid={oversInvalid || undefined}
          />
        </div>
      </div>
      {oversInvalid ? (
        <p className="mt-1 text-[11px] text-danger">
          Overs must look like 18.4 — an over has six balls, so .6 to .9 are not valid.
        </p>
      ) : null}
      <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={value.allOut}
          onChange={(e) => onChange({ ...value, allOut: e.target.checked })}
          disabled={disabled}
          className="h-3.5 w-3.5 accent-accent"
        />
        All out
        <span className="text-fg-subtle">(no proration — the score stands as-is)</span>
      </label>
    </div>
  );
}

function CricketResultForm({ game, onSubmit, onCancel, busy }) {
  const [result, setResult] = useState(game.result ?? 'home');
  const [home, setHome] = useState(EMPTY_INNINGS);
  const [away, setAway] = useState(EMPTY_INNINGS);
  // Seeded from the game so correcting an auto-captured rain match does not
  // silently un-void it. The server defaults this to false when absent, so
  // whatever is ticked here is authoritative.
  const [rainAffected, setRainAffected] = useState(Boolean(game.rainAffected));
  const [error, setError] = useState('');

  const validate = () => {
    for (const [side, v] of [
      ['Home', home],
      ['Away', away],
    ]) {
      if (v.runs === '' || Number.isNaN(Number(v.runs))) return `${side} runs is required`;
      if (v.wickets === '' || Number.isNaN(Number(v.wickets))) return `${side} wickets is required`;
      if (oversToBalls(v.overs) == null) return `${side} overs must look like 18.4`;
      if (Number(v.wickets) === 10 && !v.allOut) {
        return `${side} side is 10 wickets down, so it must be marked all out`;
      }
    }
    return '';
  };

  const submit = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const pack = (v) => ({
      runs: Number(v.runs),
      wickets: Number(v.wickets),
      // Sent as entered; the server re-parses to balls so the conversion has
      // exactly one authoritative implementation.
      overs: String(v.overs).trim(),
      allOut: Boolean(v.allOut),
    });
    onSubmit({
      result: result === 'none' ? null : result,
      home: pack(home),
      away: pack(away),
      rainAffected: Boolean(rainAffected),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <InningsFields
          idPrefix={`ck-${game.id}-home`}
          label={displayTeamName(game.homeTeam)}
          value={home}
          onChange={setHome}
          disabled={busy}
        />
        <InningsFields
          idPrefix={`ck-${game.id}-away`}
          label={displayTeamName(game.awayTeam)}
          value={away}
          onChange={setAway}
          disabled={busy}
        />
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-default bg-overlay/40 p-3 text-sm text-fg">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={rainAffected}
          onChange={(e) => setRainAffected(e.target.checked)}
          disabled={busy}
        />
        <span>
          Weather cut an innings short (DLS / reduced overs)
          <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-subtle">
            Voids both runs legs — the match pays the winner only. Tick this when overs were lost,
            not for a rain delay that still played its full twenty each. A runs prediction is made
            pre-match on a 20-over scale, and a DLS total cannot be fairly measured against it.
          </span>
        </span>
      </label>

      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="sr-only">Match result</legend>
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Winner</span>
        {[
          { value: 'home', label: displayTeamName(game.homeTeam) },
          { value: 'away', label: displayTeamName(game.awayTeam) },
          // No draw option: a cricket tie is settled by a super over, and a
          // drawn cricket game would award no winner points while the runs
          // legs still scored. The server rejects it too.
          { value: 'none', label: 'No result' },
        ].map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-sm text-fg">
            <input
              type="radio"
              name={`cricket-result-${game.id}`}
              value={opt.value}
              checked={result === opt.value || (opt.value === 'none' && result === null)}
              onChange={() => setResult(opt.value)}
              disabled={busy}
              className="accent-accent"
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy}>
          Save result
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default CricketResultForm;
