# Bantryx — "Rating Engine" commercial (Three.js)

A standalone, self-contained cinematic that showcases Bantryx's signature asset —
the per-nation Elo rating engine — using **real production data**. ~42 s, loops.

It is deliberately **not** wired into the Vite app: no new npm dependency (Three.js
loads via CDN import-map), nothing imported by `src/`, zero impact on the app bundle,
CI, or Docker image.

## What's on screen (all real)

Every number is pulled from production (or reproduced from the committed archive):

- **49,215 matches** of international football (1872–2026) replayed to rate
- **333 national teams**, shown as a live Elo world ranking
  (Spain 2127 · France 2109 · Argentina 2104 · England 2047 · Morocco 1976 …)
- the real **World Cup semi-final** the model is currently pricing —
  **France vs Spain**, a dead-even **31 / 38 / 31** on a neutral pitch
- **104 fixtures**, `neutralVenue`, **K×3.0** World Cup weighting

## Files

| File                   | Role                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `index.html`           | Shell: import-map, brand fonts/CSS, DOM caption overlay, PLAY gate, boot  |
| `scene.js`             | Three.js world — arena-grid floor, nation particle-field, Elo bars, bloom |
| `timeline.js`          | Director — 5-beat scheduler syncing the WebGL scene + DOM captions        |
| `commercial-data.json` | **Frozen real production numbers** (the page `fetch()`es this)            |
| `fetch-data.mjs`       | Regenerates the JSON (live-prod primary, archive-replay fallback)         |

## Run it

Three.js ES modules need an http origin (not `file://`):

```bash
npx --yes serve marketing/commercial      # or: python -m http.server -d marketing/commercial 8080
# open the printed URL, click "Play the film"
```

## Regenerate the data

```bash
# 1) Live production (authoritative "so far" snapshot; needs `az login`)
node marketing/commercial/fetch-data.mjs

#    If `az containerapp exec` can't be captured through the spawn on your host,
#    capture the two read-only operator scripts to files first, then feed them in:
az containerapp exec -n scorecast-app -g scorecast-prod \
  --command "node scripts/list-wc-team-elo.mjs"  > /tmp/live_list.txt
az containerapp exec -n scorecast-app -g scorecast-prod \
  --command "node scripts/inspect-wc-state.mjs"  > /tmp/live_inspect.txt
LIVE_LIST_FILE=/tmp/live_list.txt LIVE_INSPECT_FILE=/tmp/live_inspect.txt \
  node marketing/commercial/fetch-data.mjs

# 2) Offline (deterministic; reproduces the pre-tournament table, no secrets)
node marketing/commercial/fetch-data.mjs --offline
```

The `source` field in `commercial-data.json` records which path produced it
(`live-prod` vs `archive-replay`). The offline path replays
`international_match_archive/results.csv` through `lib/ml/eloMath.js` (the same
function the seeder + runtime cascade use) and prices the featured fixture with the
genuine `lib/ml/models/INT_elo.json` booster via `lib/ml/xgboostInference.js`,
neutral-venue symmetrized exactly like `services/PredictionService.js`.

## Notes

- CDN import-map means the first view needs internet (Three.js + fonts). For a fully
  offline variant, vendor `three.module.js` + self-host the fonts.
- `prefers-reduced-motion` snaps each beat to its final composed frame.
- The current data is the 2026 World Cup **as it stands in production** — re-run
  `fetch-data.mjs` any time to refresh the ranking as more results land.
