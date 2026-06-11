# Bantryx Graphics — Maintainer Reference

> The build-and-modify guide for the marketing kit + the live site's brand assets.
> For the post-it-to-social side (asset list, captions, hashtags, cadence) see
> [README.md](README.md).

This is the reference point for **modifying existing graphics or creating new ones**.
Everything is generated from code + committed SVG templates, so there is no Figma/Canva
round-trip — you edit a `.mjs` file and re-run one command.

---

## 1. What exists

### Two generators, one shared brand

| Generator                                                                           | Output                                                                                                                             | Serves                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`scripts/generate-marketing-assets.mjs`](../scripts/generate-marketing-assets.mjs) | `marketing/out/*.png` (34 files)                                                                                                   | Social campaign — **not** served by the site; you post these manually |
| [`scripts/generate-pwa-assets.mjs`](../scripts/generate-pwa-assets.mjs)             | `public/favicon.ico`, `public/pwa-*.png`, `public/apple-touch-icon-*.png`, `public/maskable-*.png`, `public/og-image-1200x630.png` | **Live site** — favicon, installed-app icons, link-share card         |

Both rasterize hand-authored SVG → PNG with [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js)
and both load the **same bundled fonts** ([`marketing/fonts/`](fonts/)), so the marketing
kit and the live site stay visually identical.

### File map

```
marketing/
  lib/brand.mjs        # shared SVG fragment library (tokens, wordmark, icons, helpers)
  lib/product.mjs      # faithful GameCard + Leaderboard UI mockups (real app tokens)
  fonts/*.ttf          # bundled OFL fonts (Orbitron, Bebas Neue, Inter ×5) — fed to resvg
  out/*.png            # generated campaign graphics (committed)
  README.md            # posting playbook (asset index, captions, hashtags, cadence)
  GRAPHICS.md          # this file
scripts/
  generate-marketing-assets.mjs   # content arrays + layout renderers for the kit
  generate-pwa-assets.mjs         # favicon / PWA / OG rasterizer
public/
  logo.svg             # LIVE favicon source — Orbitron "B" glyph as a PATH (self-contained)
  og-template.svg      # OG card source — Orbitron "BANTRYX" wordmark (rasterized to og-image)
```

### Commands

```bash
npm run assets:marketing     # rebuild marketing/out/*.png
npm run generate-pwa-assets  # rebuild public/ favicon + PWA icons + og-image
```

Both are deterministic — re-running produces byte-identical output until you change a
template. Re-run `generate-pwa-assets` only when `logo.svg` / `og-template.svg` change.

---

## 2. Brand tokens — [`marketing/lib/brand.mjs`](lib/brand.mjs)

Change these once and every graphic follows.

### Colours — `COLOR`

| Token             | Hex                   | Use                                           |
| ----------------- | --------------------- | --------------------------------------------- |
| `navy0` / `navy1` | `#0f172a` / `#020617` | Background gradient (top-left → bottom-right) |
| `cyan`            | `#06b6d4`             | Primary accent, kicker, icon fills            |
| `cyanSoft`        | `#67e8f9`             | Wordmark top-gradient, taglines, glow         |
| `textHi`          | `#e2e8f0`             | Body copy                                     |
| `muted`           | `#94a3b8`             | Secondary copy, footer tagline                |
| `dim` / `border`  | `#475569` / `#1e293b` | Hairlines, card strokes                       |

The cyan gradient `id="mark"` (`cyanSoft → cyan`, top→bottom) is what the wordmark, big
numbers, and icon glows fill with.

### Fonts — `FONT`

| Token                                | Family                                            | Used for                                                  |
| ------------------------------------ | ------------------------------------------------- | --------------------------------------------------------- |
| `brand`                              | `Orbitron` (700)                                  | **BANTRYX wordmark + B mark + bantryx.com**               |
| `display`                            | `Bebas Neue`                                      | Headlines, big stat numbers, step numbers, "HOW IT WORKS" |
| `body`                               | `Inter`                                           | Body copy                                                 |
| `bodyMed` / `bodySemi` / `bodyBlack` | `Inter Medium` / `Inter SemiBold` / `Inter Black` | Emphasis, chips, CTA label                                |

> ⚠️ **Fontsource family-name quirk**: the static Inter weights register Medium/SemiBold/
> Black as their **own families** (`"Inter Medium"` etc.), so we select by exact family
> name, **not** `font-weight`. Orbitron Bold registers as plain `"Orbitron"`. If you swap a
> font, re-check the embedded family name (`python -c "from fontTools.ttLib import TTFont; ..."`)
> and update `FONT`.

---

## 3. Fragment library API — [`marketing/lib/brand.mjs`](lib/brand.mjs)

Every renderer composes from these pure functions (each returns an SVG string).

| Function                                                         | Purpose                                                                                                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svgDoc({w, h, body, glow})`                                     | Wraps a body in `<svg>` + `baseDefs`. `glow` sets the radial-glow centre (`glowCx/Cy/R`, 0–1).                                                                                      |
| `background(w, h, {grid})`                                       | Gradient + cyan glow (+ optional arena grid).                                                                                                                                       |
| `arenaGrid(w, h, {step, opacity})`                               | Faint pitch-grid lines.                                                                                                                                                             |
| `wordmark({x, y, size, anchor, fill, text})`                     | Orbitron BANTRYX (or any `text`).                                                                                                                                                   |
| `wordmarkWidth(size, text)`                                      | Predicts rendered width — used to fit/centre.                                                                                                                                       |
| `topMark(cx, y, size)`                                           | (in the generator) **centred** Orbitron BANTRYX at the top of a graphic — the current header convention.                                                                            |
| `kicker(cx, y, size)`                                            | (in the generator) "PREDICT · COMPETE · CLIMB" eyebrow.                                                                                                                             |
| `centeredBlockBaseline(top, bottom, n, size, lh)`                | (in the generator) baseline that vertically centres an n-line block in a gap (feature headlines).                                                                                   |
| `brandTag({x, y, size})` · `chip(...)` · `chipWidth(...)`        | **Retired** — old corner diamond+wordmark tag and top-right category chips. Kept in brand.mjs but no longer used; headers now use centred `topMark` and features dropped the chips. |
| `ctaPill({cx, y, label, size})`                                  | Filled cyan call-to-action button.                                                                                                                                                  |
| `iconBadge({name, cx, cy, badgeR, iconSize, color, disc})`       | Glowing icon centred in a disc (see §4).                                                                                                                                            |
| `lucideIcon(name, {cx, cy, size, color})`                        | Raw icon, no glow/disc.                                                                                                                                                             |
| `textBlock({x, y, lines, size, lineHeight, anchor, font, fill})` | Multi-line text (one `<text>` per line).                                                                                                                                            |
| `wrapLines(text, maxChars)`                                      | Word-wrap into a `lines[]` array by character budget.                                                                                                                               |
| `rule({x, y, w})`                                                | Horizontal pitch-line, fades at both ends.                                                                                                                                          |
| `footer({cx, y, w})`                                             | rule + "NO BETTING, JUST BANTRYX" + bantryx.com.                                                                                                                                    |
| `esc(s)`                                                         | XML-escape text content. **Always** escape user/dynamic strings.                                                                                                                    |

> ⚠️ **There is no auto-wrapping.** SVG `<text>` doesn't wrap — use `wrapLines()` to split,
> then `textBlock()` to lay the lines out. If text overflows, widen the `maxChars` budget or
> shrink `size`.

---

## 4. Icon system

Icons are **Lucide-style** geometry (ISC-licensed) on a 24-unit grid centred on `(12,12)`,
rendered centred at `(cx,cy)` with a blurred cyan **glow** layer behind a crisp copy.

### Available icons (`LUCIDE` map in brand.mjs)

`target` (scoring) · `users` (groups) · `trending` (leaderboards/climb) · `award`
(badges) · `zap` (speed) · `gift` (free).

### Add a new icon

1. Grab the path data from [lucide.dev](https://lucide.dev) (or draw your own on a 24-grid
   centred at 12,12). Add it to the `LUCIDE` object in `brand.mjs`:
   ```js
   const LUCIDE = {
     // ...
     flame: `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3..."/>`,
   };
   ```
   For a **filled** glyph (like `zap`), put `fill="CURRENTGLOW"` on the shape — the loader
   swaps `CURRENTGLOW` for the icon colour. Stroke shapes need nothing.
2. Use it: `iconBadge({ name: 'flame', cx, cy, badgeR: 168, iconSize: 168 })`.

Glow strength scales with `iconSize` (`stdDeviation = iconSize * 0.045`). Set `disc:false`
to drop the background circle (used on the flyer's small stat-card icons).

---

## 5. Wordmark sizing (Orbitron is wide)

Orbitron advances ≈ `1.3em`/char, so "BANTRYX" is much wider than a normal font at the same
`size`. **Don't hardcode a font-size** — fit to a target pixel width:

```js
const wmSize = wmSizeFor(940); // largest Orbitron BANTRYX that fits in 940px
wordmark({ x: cx, y, size: wmSize, anchor: 'middle' });
```

`wmSizeFor(targetW)` (in the generator) starts at `targetW / 9.4` and trims until
`wordmarkWidth(size) <= targetW`. Rule of thumb: a hero wordmark targets ~0.85–0.9 × canvas
width.

---

## 6. Content — edit copy here

All copy lives in three arrays near the top of
[`scripts/generate-marketing-assets.mjs`](../scripts/generate-marketing-assets.mjs):

- `FEATURES` — `{ key, icon, label, headline, sub }` → drives the 4 feature graphics.
- `STATS` — `{ key, icon, big, label }` → drives the 4 stat teasers + the flyer's stat cards.
- `STEPS` — `{ n, title, body }` → drives the how-to graphics + the flyer.

Change a `headline`/`sub`/`label` string, re-run `npm run assets:marketing`, done. `key`
becomes the filename suffix (`feature-<key>-square.png`).

---

## 7. Layout renderers

Each graphic type is one function returning an SVG string. They share a **per-format layout
object** pattern — a small `L` map keyed by format holds the y-coordinates/sizes, so tuning
spacing means editing numbers in one place.

| Renderer                      | Produces                          | Notes                                                                                            |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `renderLaunch(format)`        | launch square / story / landscape | `L` map at the top holds `kickY/wmY/tagY/bodyY/ctaY/urlY`. `format==='card'` delegates to ↓      |
| `renderLaunchCard()`          | launch-card (1200×630)            | Centred wordmark; also the model for the live OG card                                            |
| `renderFeature(feat, format)` | feature square / story            | centred `topMark` + `iconBadge` + **Inter** headline (centred between icon & sub) + sub + footer |
| `renderStat(stat, format)`    | stat square / story               | Small `iconBadge` + giant Bebas number + label + footer                                          |
| `renderHowto(format)`         | howto square / story              | `STEPS` rows with Bebas numbers + `rule` dividers                                                |
| `renderFlyer()`               | flyer-a4 (2480×3508)              | async (QR via `qrcode`); stat cards + steps + QR block                                           |

### Vertical-rhythm rule

Layouts are **manually positioned** (no flexbox). When you change a font size or add a line,
check the band below it doesn't collide. The danger zones (learned the hard way): the launch
CTA vs body, the how-to last row vs footer, and the flyer "HOW IT WORKS" heading vs the
centred "02" + the QR block. Re-render and eyeball after any spacing change.

---

## 8. Recipes

**Change a colour everywhere** → edit `COLOR` in `brand.mjs`, re-run both generators.

**Reword a feature/stat/step** → edit the `FEATURES`/`STATS`/`STEPS` array, `npm run assets:marketing`.

**Add a feature graphic** → push a new object onto `FEATURES` (pick an `icon` from §4; add
one if needed). It auto-emits `feature-<key>-square/-story.png` via the `for (const feat of FEATURES)` loop in `main()`.

**Add a stat teaser** → push onto `STATS`. Auto-emits `stat-<key>-square/-story.png`.

**Add a brand-new graphic type** → write a `renderFoo(format)` returning `svgDoc(...)`, add
its dimensions to `SIZE` if it's a new aspect, then add `await emit('foo', renderFoo(...), width)`
in `main()`.

**Add a new format to an existing type** → add the size to `SIZE`, add a branch/entry to that
renderer's `L` layout map, and an `emit(...)` call.

**Change the wordmark/logo treatment** → `wordmark()` + `brandTag()` in `brand.mjs`. (Square
icon mark lives in the static pipeline, §9.)

**Adjust spacing** → edit the `L` layout object (or the inline y-values) in the renderer, then
re-render and visually check the bands below.

---

## 8b. Product mockups — [`marketing/lib/product.mjs`](lib/product.mjs)

The `product-*` graphics are **faithful SVG re-creations of the live app UI** (GameCard +
LeaderboardCard), not abstract marketing. They exist so we can show "here's what you
actually get" without screenshotting a running app + seeded DB.

**Fidelity sources** (keep these in sync if the real components change):

- **Colours** = the app's dark-theme tokens, mirrored in the `UI` object (from
  [`src/index.css`](../src/index.css) `:root`). If the app's tokens change, update `UI`.
- **Avatar colours** = `avatarColors()` re-implements the FNV-1a → HSL hash from
  [`src/components/Avatar.jsx`](../src/components/Avatar.jsx) exactly, so a fake user gets the
  same disc colour it would in-app.
- **Layout** = `gameCard()`, `leaderboardCard()` and `statsPage()` recreate
  [`src/components/GameCard.jsx`](../src/components/GameCard.jsx),
  [`LeaderboardCard.jsx`](../src/components/LeaderboardCard.jsx) +
  [`ProfileView.jsx`](../src/components/ProfileView.jsx): status pill, score tiles
  (Orbitron `.font-led`), points-allocation grid, pick buttons, winner ring, rank medals,
  profile header + 5 stat tiles + recent activity.

**Where the data lives** (in the generator): `GAMES` (3 standalone fixtures), `LIFECYCLE`
(one fixture across all 3 states), `LEADERBOARD` (fake users), and `STATS_PROFILE` (the
stats-page profile). Edit those to change the shown matches/users.

- A `gameCard({x, y, w, state, data})` returns `{ svg, h }` — it self-measures height so the
  renderers can centre it. `state` ∈ `'upcoming' | 'live' | 'final'`. `data` carries
  `home/away`, `pts` (the points-allocation grid), `pickSide/pickTeam`,
  `homeScore/awayScore`, `minute`, `result`, `points`.
- `statsPage({x, y, w, data, activityCount})` mirrors the Profile → Summary tab.
- `statsCharts({x, y, w, data, full})` recreates the StatsDashboard recharts panels
  (dual-line points-over-time, stacked per-league bars, pick-time heatmap) — pure SVG, no
  charting lib. `full: true` adds the bars + heatmap (story); `false` is the hero line chart
  only (square). Sample series live in `STATS_CHARTS` in the generator.
- Everything scales with `k = w/880`, so the same card renders crisply at any width.
- A `you: true` row renders the accent-bordered "YOU" highlight.

> ⚠️ **Win streaks are intentionally NOT shown.** An earlier mockup drew a 🔥 streak chip next
> to names, but the **live leaderboard doesn't display streaks**, so showing them
> misrepresented the product — they were removed. The `streakChip()` helper in `product.mjs`
> is kept (unused) for if/when streaks ship in-app; re-enable by calling it in
> `leaderboardCard()` and adding a `streak` field back to the `LEADERBOARD` data.

> ⚠️ Keep copy **points-framed, not money-framed** — no "payout", "cash", "pays", "paid". The
> app deliberately uses "Points allocation locks in at kickoff." (not "Payout…"); the mockups
> match. The internal data key is `pts`, not `payout`.

> ⚠️ These mockups are **illustrative** — the points numbers are hand-set in the data
> objects, not computed by the real `scorePick`. Keep them plausible: the lifecycle uses Man
> City 1–2 Aston Villa (a ~26% away win → +74, i.e. `(1 − 0.26) × 100`); the standalone cards
> use Arsenal vs Aston Villa (34% → +66). Card header formatting (uppercase date · status,
> uppercase WINNER + outcome badge, glowing score tiles) mirrors the live GameCard.

---

## 8c. Live-data assets — [`marketing/lib/livedata.mjs`](lib/livedata.mjs)

Three asset types pull from **production** instead of baked-in copy: `thankyou-*` (real user
count), `picks-vs-model-<home>-vs-<away>-*` (one per upcoming game — crowd pick split vs the
model's probabilities), and `kickoff-countdown-*` (a "get your picks in" urgency card for the
soonest fixture). See the [README → Live-data assets](README.md#live-data-assets) for the
operator workflow; this section is the maintainer view.

**Data module** — `marketing/lib/livedata.mjs`, read-only raw SQL, mirrors
[`scripts/query-teams.mjs`](../scripts/query-teams.mjs) for the connection + SSL opt-in:

- `openDb()` → `new Sequelize(process.env.DATABASE_URL)` (SSL when the URL has
  `sslmode=require`), or `null` when unset.
- `fetchUserCount(db)` → `SELECT COUNT(*) FROM users`.
- `fetchUpcomingGames(db)` → every `status='scheduled'` fixture with its model
  probabilities + a single grouped crowd query (`picks` GROUP BY `gameId`, `choice`).
  Filters out placeholder fixtures (`/^(tbd|winner|loser|group\s|placeholder)/i` — mirrors
  [`src/utils/teamNames.js`](../src/utils/teamNames.js) `isPlaceholderGame`) and the model
  sentinel `(0.50, 0.00, 0.50)`. Crowd is **winner-only** (Home/Away) because picks are.

**Render fragment** — `picksVsModelCard({x, y, w, game})` in `product.mjs`, same idiom as
the other product cards (reuses `rrect` / `txt` / `UI` tokens, self-measures height). Panel
A = a 2-segment crowd bar (cyan Home / purple Away, forced to sum to 100; empty state when
zero picks). Panel B = 3 horizontal probability bars (Home cyan / Draw amber / Away purple).

`kickoff-countdown-*` uses `renderKickoffCountdown(game, format)`: the matchup in the Bebas
display face, then a big Orbitron countdown numeral + unit from `countdownParts(kickoffAt)`
(rounds to MIN / HOUR / DAY), sized to fit via `fitOrbitron` (reuses `wordmarkWidth`). It
features `upcoming[0]` (soonest, since `fetchUpcomingGames` orders by date ASC) and falls
back to `SAMPLE_COUNTDOWN` (Mexico vs South Africa, +3h) — `main()` picks the game via
`upcoming.find((g) => g.kickoffAt instanceof Date)` so the sample-upcoming rows (no
`kickoffAt`) never reach `countdownParts`.

**Generator wiring** — `renderThankYou(format, userCount)` (big milestone number via
`roundDownToMilestone`) and `renderPicksVsModel(game, format)`. `main()` calls `openDb()`
once in a `try/finally` (always `db.close()`), and falls back to `SAMPLE_USER_COUNT` /
`SAMPLE_UPCOMING` on no-DB-or-failure so an offline run still emits example cards. The 29
core assets are untouched by this path — they stay byte-identical.

> ⚠️ **Pre-kickoff crowd divergence**: the app hides the crowd split until kickoff
> (anti-bias). This generator reads the DB directly and intentionally shows pre-kickoff
> sentiment for promo use — a deliberate, documented divergence from product behaviour.

> ⚠️ **`.env` is NOT auto-loaded** — that file points at the dev DB. The operator sets
> `DATABASE_URL` to the prod URL explicitly so the assets reflect real numbers.

---

## 9. Live brand assets (favicon / PWA / OG)

These feed the **deployed site**. Changing them updates the browser favicon, installed-app
icons, and the link-share preview after the next push + CD deploy.

### `public/logo.svg` — the square mark

- It's the **Orbitron "B" glyph as a `<path>`**, not `<text>`. It must stay path-based:
  `index.html` serves `/logo.svg` directly as an SVG favicon, so it has to render without the
  Orbitron webfont installed.
- The path was extracted from `Orbitron-Bold.ttf` with **fontTools**; the transform
  `translate(46.5 436) scale(0.5 -0.5)` flips the font's Y-up coords to SVG Y-down and centres
  the glyph on the 512 canvas.
- To re-extract (e.g. a different letter or font weight):
  ```bash
  pip install fonttools
  python -c "from fontTools.ttLib import TTFont; from fontTools.pens.svgPathPen import SVGPathPen; \
  f=TTFont('marketing/fonts/Orbitron-Bold.ttf'); gs=f.getGlyphSet(); g=gs[f.getBestCmap()[ord('B')]]; \
  p=SVGPathPen(gs); g.draw(p); print(p.getCommands())"
  ```
  Then recompute the centring transform from the glyph bbox (centre = `((xMin+xMax)/2,(yMin+yMax)/2)`).

> ⚠️ **Maskable constraint**: `generate-pwa-assets.mjs` builds the maskable icon by regex-
> wrapping the **first `<path>`** in a 70%-scale group, and expects that path's `/>` to be the
> last thing before `</svg>`. Keep `logo.svg`'s mark as a single self-closing `<path .../>` at
> the end of the file or the maskable wrap breaks.

### `public/og-template.svg` — the link-share card

- Centred Orbitron `<text>BANTRYX</text>` + kicker + tagline + url. Unlike `logo.svg` this is
  **only a raster source** (never served live), so `<text>` is fine — `generate-pwa-assets.mjs`
  now loads the bundled fonts into resvg so it renders in real Orbitron/Inter.
- Rasterized to `public/og-image-1200x630.png`, referenced by the OG/Twitter `<meta>` tags in
  `index.html`.

> ⚠️ **Social caches**: the OG image URL is stable, so Facebook/X/LinkedIn/Discord keep serving
> the **old** preview after a content change. Force a refresh via the
> [FB Sharing Debugger](https://developers.facebook.com/tools/debug/) /
> [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) after deploying.

---

## 10. Gotchas / invariants

- **resvg loads no webfonts.** Both generators pass `font.fontFiles` (the bundled TTFs). A new
  font must be added to `marketing/fonts/` AND referenced by exact family name.
- **No text wrapping** — use `wrapLines()` + `textBlock()`.
- **`dominant-baseline:central`** is used for vertically-centred text (chips, CTA, big stat
  number). resvg supports it; other text uses explicit baselines.
- **QR** (flyer) is generated from the `qrcode` dep (already a project dependency), encodes
  `https://bantryx.com`, and sits on a white card that supplies the required quiet-zone — don't
  crop into it.
- **Fonts + PNGs are committed** so the kit is grab-and-post and the build is reproducible
  offline. All fonts are SIL OFL 1.1; Lucide icons are ISC — both fine to embed/redistribute.

---

## 11. Verify after changes

```bash
npm run assets:marketing && npm run generate-pwa-assets
npx eslint scripts/generate-marketing-assets.mjs scripts/generate-pwa-assets.mjs marketing/lib/brand.mjs
```

Then open a sample of each format and confirm: wordmark in real Orbitron, icons centred with
glow, no text collisions, flyer QR scans to bantryx.com. Dimensions should match — square
1080², story 1080×1920, landscape 1600×900, card 1200×630, flyer 2480×3508.
