"""Team-name reconciliation: manual hits, exact canonical, fuzzy fallback,
and the loud-error path for unknown names."""

from __future__ import annotations

import pytest

from scorecast_ml.reconcile.team_mapping import (
    UnknownTeamError,
    aliases_for,
    canonical_set,
    canonicalize,
)


def test_pl_aliases_file_loads():
    aliases = aliases_for("PL")
    assert "Man United" in aliases
    assert aliases["Man United"] == "Manchester United FC"


def test_canonicalize_exact_alias_hit():
    canonical, score = canonicalize("Wolves", "PL")
    assert canonical == "Wolverhampton Wanderers FC"
    assert score is None  # exact


def test_canonicalize_exact_canonical_hit():
    canonical, score = canonicalize("Arsenal FC", "PL")
    assert canonical == "Arsenal FC"
    assert score is None


def test_canonicalize_unknown_loud_error():
    with pytest.raises(UnknownTeamError) as exc:
        canonicalize("Some Brand New Team Nobody Knows", "PL")
    assert "PL" in str(exc.value)
    assert "Some Brand New Team Nobody Knows" in str(exc.value)


def test_canonicalize_handles_typo_via_fuzzy(tmp_path, monkeypatch):
    # Force the _proposed.json file into a tmp dir so the test doesn't
    # pollute the package directory.
    import scorecast_ml.reconcile.team_mapping as tm

    monkeypatch.setattr(tm, "_PROPOSED_FILE", tmp_path / "_proposed.json")
    # "Manchster United FC" is a typo of "Manchester United FC" — high
    # WRatio score; should auto-match.
    canonical, score = canonicalize("Manchster United FC", "PL")
    assert canonical == "Manchester United FC"
    assert score is not None
    assert score >= 92


def test_canonical_set_includes_every_alias_target():
    canonicals = canonical_set("PL")
    for raw, target in aliases_for("PL").items():
        assert target in canonicals, (raw, target)


def test_unknown_league_raises():
    with pytest.raises(KeyError):
        aliases_for("NOPE")
