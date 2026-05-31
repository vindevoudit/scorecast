# Bantryx — Social Media Marketing Kit

Ready-to-post, on-brand graphics for the Bantryx launch campaign. Everything in
[`out/`](out/) is generated from committed SVG templates + the bundled brand fonts, so
you can tweak copy/colours and re-render the whole set in one command.

```bash
npm run assets:marketing       # → marketing/out/*.png
```

- **Edit copy** (headlines, features, stats, steps): the `FEATURES` / `STATS` / `STEPS`
  arrays near the top of [`scripts/generate-marketing-assets.mjs`](../scripts/generate-marketing-assets.mjs).
- **Edit colours / wordmark / icons / type**: [`marketing/lib/brand.mjs`](lib/brand.mjs)
  (`COLOR`, `FONT`, `wordmark`, `brandTag`, `iconBadge`).
- **Full maintainer guide** — how the system is built and how to modify graphics or add new
  ones (fragment API, icon system, layout renderers, the live favicon/PWA/OG pipeline):
  **[GRAPHICS.md](GRAPHICS.md)**.
- **Fonts** ([`fonts/`](fonts/)): Orbitron (BANTRYX wordmark + B mark), Bebas Neue
  (headlines + big numbers), Inter (body) — all **SIL OFL 1.1**, free to embed and
  redistribute. Fed to the rasterizer directly so type renders in the real brand faces
  (not a system fallback). Icons are clean Lucide-style geometry (ISC-licensed) with a
  cyan glow.

---

## Asset index

All squares are **1080×1080** (IG/FB feed, carousels), stories **1080×1920**
(IG/FB/TikTok stories & reels).

| File                                     | Size       | Use it for                                                    |
| ---------------------------------------- | ---------- | ------------------------------------------------------------- |
| `launch-square.png`                      | 1080×1080  | Launch-day feed hero (IG/FB)                                  |
| `launch-story.png`                       | 1080×1920  | Launch-day story/reel                                         |
| `launch-x.png`                           | 1600×900   | Launch tweet / X post image                                   |
| `launch-card.png`                        | 1200×630   | Link-preview / OG card, LinkedIn, Discord, Slack              |
| `feature-scoring-square/-story.png`      | sq + story | Probability scoring (+62 for a 38% upset)                     |
| `feature-groups-square/-story.png`       | sq + story | Private groups & friends                                      |
| `feature-leaderboards-square/-story.png` | sq + story | Live leaderboards                                             |
| `feature-badges-square/-story.png`       | sq + story | Badges & milestones                                           |
| `howto-square.png` / `howto-story.png`   | sq + story | 3-step "how it works" explainer                               |
| `stat-62-square/-story.png`              | sq + story | Teaser: **+62** points for a 38% underdog                     |
| `stat-groups-square/-story.png`          | sq + story | Teaser: **∞** private groups                                  |
| `stat-30s-square/-story.png`             | sq + story | Teaser: **30s** to first pick                                 |
| `stat-free-square/-story.png`            | sq + story | Teaser: **$0** free, no ads, no betting                       |
| `flyer-a4.png`                           | 2480×3508  | Printable A4 poster (300 dpi) with scannable QR → bantryx.com |

> **Flyer printing**: `flyer-a4.png` is 300 dpi A4. Print "actual size / 100%" (not
> "fit to page") so the QR stays crisp. The QR encodes `https://bantryx.com` and includes
> a white quiet-zone border — don't crop into the white frame.

---

## Suggested captions

Keep the voice **playful, confident, no-gambling**. Always close with the link.

**Launch**

> ⚽ Bantryx is live. Predict football, outpick your group chat, and climb the live
> leaderboard — no betting, just bragging rights. Free forever. → bantryx.com

**Feature — scoring**

> Pick smart, not safe. On Bantryx a 38% underdog upset pays **+62 points** — favourites
> pay less. The braver the call, the bigger the climb. → bantryx.com

**Feature — groups**

> Your group chat has opinions. Settle it. Spin up a private Bantryx league and race your
> mates on your own leaderboard. → bantryx.com

**Feature — leaderboards**

> Full-time whistle = instant standings. Bantryx leaderboards update the second a result
> lands. No waiting until Monday. → bantryx.com

**Feature — badges**

> Streaks. Upsets. Perfect weekends. 100-point picks. Collect the badges, collect the
> bragging rights. → bantryx.com

**How-to**

> New here? Three steps: 1) sign up free 2) pick your winners 3) climb the rankings.
> That's it. No catch, no paywall. → bantryx.com

**Stat teasers** (short, punchy — pair with the matching `stat-*` graphic)

> +62 points for backing a 38% underdog. Reward the brave call. → bantryx.com
> ∞ private groups. Build a league for every group chat. → bantryx.com
> 30 seconds from sign-up to your first pick. → bantryx.com
> $0. Free forever. No ads. No betting. Just football. → bantryx.com

---

## Hashtags

Mix a few from each row; don't dump all of them.

- **Core**: `#Bantryx` `#NoBettingJustBantryx` `#FootballPredictions` `#PredictionGame`
- **Football**: `#Football` `#Soccer` `#PremierLeague` `#MatchDay` `#FootballFans`
- **Community**: `#GroupChat` `#Leaderboard` `#BraggingRights` `#FantasyFootball`

---

## Sample 2-week launch cadence

| Day | Post                       | Asset                                                |
| --- | -------------------------- | ---------------------------------------------------- |
| 1   | Launch announcement        | `launch-square` + `launch-story` (+ `launch-x` on X) |
| 2   | How it works               | `howto-square` / `howto-story`                       |
| 4   | Hook: scoring              | `stat-62-square` + `stat-62-story`                   |
| 6   | Feature: scoring deep-dive | `feature-scoring-square/-story`                      |
| 8   | Hook: groups               | `stat-groups-*`                                      |
| 9   | Feature: groups            | `feature-groups-*`                                   |
| 11  | Feature: live leaderboards | `feature-leaderboards-*`                             |
| 12  | Hook: 30s to first pick    | `stat-30s-*`                                         |
| 13  | Feature: badges            | `feature-badges-*`                                   |
| 14  | Re-CTA / "free forever"    | `stat-free-*` + repost `launch-card` in bio link     |

Use `launch-card.png` wherever a link unfurls (X, Discord, Slack, LinkedIn, WhatsApp) — it
matches the site's OG image. Pin the flyer in real-world spots (clubhouses, campus boards,
group-chat screenshots).

---

## Regenerating

The script is deterministic — re-running produces identical PNGs. To change anything:

1. Edit copy in `scripts/generate-marketing-assets.mjs` (content arrays) or brand tokens
   in `marketing/lib/brand.mjs`.
2. `npm run assets:marketing`
3. The 23 PNGs in `out/` are overwritten in place.

To add a new format, add an entry to `SIZE` and a `renderX` layout function, then an
`emit(...)` call in `main()`.
