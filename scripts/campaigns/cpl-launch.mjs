// Campaign: Caribbean Premier League / T20 cricket launch announcement (Tier 34).
//
// This one uses the `html` + `text` escape hatch rather than the standard
// heading/paragraphs renderer, because the scoring explainer needs a real table
// (three legs adding to 250) and the opener needs a fixture card — neither is
// expressible in the stock template. Everything below is hand-written
// email-safe HTML: tables for layout, inline styles only, no flex/grid, no
// external CSS, no web fonts. Palette matches the stock renderer so this sits
// in the same family as every other Bantryx email
// (#0b1220 page / #111a2e card / #22d3ee accent).
//
// Content facts are all verified against the repo, not recalled:
//   - 39 matches, 7 franchises, 8 territories   -> data/cpl-2026-fixtures.json
//   - opener 7 Aug, Arnos Vale, St Vincent      -> same file, first fixture
//   - final 20 Sep, Kensington Oval, Barbados   -> same file, last fixture
//   - +50 winner / up to +100 per runs leg / 250 max, runs legs optional,
//     short innings prorated to a 20-over equivalent unless the side was
//     bowled out                                -> lib/scoring.js scoreCricketPick
//
// Since `html` is verbatim, nothing here is auto-escaped — write entities
// (&amp;) by hand in the HTML part. The `text` part is plain and takes real
// characters.

const HEADING = 'Cricket has landed.';

export default {
  subject: 'New on Bantryx: the Caribbean Premier League 🏏',

  preheader:
    'T20 cricket picks are live. Call the winner, call the runs — up to 250 points a match.',

  // Kept so operator stdout and any future re-render have something sane.
  heading: HEADING,
  paragraphs: [
    'Bantryx is no longer football-only. The Caribbean Premier League is live in the app, with all 39 matches of the 2026 season ready to pick.',
  ],
  cta: { label: 'Make my first cricket pick', path: '/?view=games' },

  html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <meta name="supported-color-schemes" content="dark light" />
    <title>New on Bantryx: the Caribbean Premier League</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0b1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">T20 cricket picks are live. Call the winner, call the runs &mdash; up to 250 points a match.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1220" style="background-color:#0b1220;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#111a2e;border:1px solid #1e293b;border-radius:20px;overflow:hidden;">

            <!-- wordmark + new-sport pill -->
            <tr>
              <td align="center" style="padding:36px 32px 6px;">
                <div style="font-size:28px;font-weight:800;letter-spacing:0.12em;color:#22d3ee;text-transform:uppercase;">BANTRYX</div>
                <div style="margin-top:12px;">
                  <span style="display:inline-block;background-color:#0b1220;border:1px solid #22d3ee;border-radius:9999px;color:#22d3ee;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:6px 14px;">New sport</span>
                </div>
              </td>
            </tr>

            <!-- heading -->
            <tr>
              <td align="center" style="padding:18px 32px 4px;">
                <div style="font-size:26px;font-weight:700;color:#f8fafc;line-height:1.3;">
                  Cricket has landed. &#127951;
                </div>
                <div style="margin-top:8px;font-size:15px;color:#94a3b8;line-height:1.5;">
                  The Caribbean Premier League is live on Bantryx.
                </div>
              </td>
            </tr>

            <!-- body -->
            <tr>
              <td style="padding:22px 32px 4px;color:#cbd5e1;font-size:16px;line-height:1.6;">
                <p style="margin:0 0 16px;">
                  Bantryx is no longer football-only. All <strong style="color:#f8fafc;">39 matches</strong> of the 2026 CPL season are in the app &mdash; seven franchises, eight Caribbean territories, from the opening night in St Vincent to the final at Kensington Oval.
                </p>
                <p style="margin:0 0 20px;">
                  Cricket picks work differently to football. There are no odds to weigh up: every winner pays the same. The points are in how well you read the game.
                </p>
              </td>
            </tr>

            <!-- scoring breakdown -->
            <tr>
              <td style="padding:0 32px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b1220;border:1px solid #1e293b;border-radius:14px;">
                  <tr>
                    <td colspan="2" style="padding:16px 18px 10px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;">
                      How a CPL match scores
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 18px 12px;color:#cbd5e1;font-size:15px;line-height:1.45;">
                      <strong style="color:#f8fafc;">Call the winner</strong><br />
                      <span style="color:#94a3b8;font-size:13px;">Flat rate, every match</span>
                    </td>
                    <td align="right" style="padding:0 18px 12px;color:#22d3ee;font-size:19px;font-weight:800;white-space:nowrap;">+50</td>
                  </tr>
                  <tr>
                    <td style="padding:0 18px 12px;color:#cbd5e1;font-size:15px;line-height:1.45;">
                      <strong style="color:#f8fafc;">Predict each side&rsquo;s runs</strong><br />
                      <span style="color:#94a3b8;font-size:13px;">Two optional legs &mdash; 100 minus however many runs you&rsquo;re off by</span>
                    </td>
                    <td align="right" style="padding:0 18px 12px;color:#22d3ee;font-size:19px;font-weight:800;white-space:nowrap;">+100<br /><span style="font-size:12px;font-weight:600;color:#64748b;">each</span></td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding:0 18px;">
                      <div style="border-top:1px solid #1e293b;"></div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 18px 16px;color:#f8fafc;font-size:15px;font-weight:700;">
                      Perfect match
                    </td>
                    <td align="right" style="padding:12px 18px 16px;color:#22d3ee;font-size:22px;font-weight:800;white-space:nowrap;">250</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- callout -->
            <tr>
              <td style="padding:16px 32px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:12px 16px;background-color:#1c1707;border-left:3px solid #fbbf24;border-radius:8px;color:#fcd34d;font-size:14px;line-height:1.55;">
                      <strong>Nail the runs and it pays more than the result.</strong> Both runs legs are optional &mdash; skip them and you&rsquo;re still playing for the +50. A rain-shortened or early-finished innings is scaled to its 20-over equivalent before scoring, so it&rsquo;s run rate you&rsquo;re really calling.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- opener fixture card -->
            <tr>
              <td style="padding:20px 32px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b1220;border:1px solid #1e293b;border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:16px 18px 6px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#22d3ee;">
                      First ball &middot; Friday 7 August
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:2px 18px 6px;color:#f8fafc;font-size:17px;font-weight:700;line-height:1.45;">
                      Jamaica Kingsmen<br />
                      <span style="color:#64748b;font-size:13px;font-weight:600;">v</span><br />
                      Antigua &amp; Barbuda Falcons
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 18px 16px;color:#94a3b8;font-size:13px;line-height:1.5;">
                      Arnos Vale Stadium, St Vincent &middot; 7:00pm local
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- cta -->
            <tr>
              <td align="center" style="padding:24px 32px 10px;">
                <a href="https://bantryx.com/?view=games" style="display:inline-block;background-color:#22d3ee;color:#0b1220;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:9999px;">
                  Make my first cricket pick &rarr;
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 26px;color:#64748b;font-size:13px;line-height:1.5;">
                Picks lock at the first ball. The final is 20 September at Kensington Oval, Barbados.
              </td>
            </tr>

            <!-- footer -->
            <tr>
              <td style="padding:0 32px;">
                <div style="border-top:1px solid #1e293b;"></div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 32px 32px;color:#64748b;font-size:13px;line-height:1.5;">
                <div style="font-weight:600;color:#94a3b8;margin-bottom:6px;">No betting. Just Bantryx.</div>
                <div>You&rsquo;re receiving this because you have a Bantryx account.</div>
                <div style="margin-top:8px;">
                  <a href="https://bantryx.com" style="color:#22d3ee;text-decoration:none;">bantryx.com</a>
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,

  text: `CRICKET HAS LANDED.
The Caribbean Premier League is live on Bantryx.

Bantryx is no longer football-only. All 39 matches of the 2026 CPL
season are in the app -- seven franchises, eight Caribbean
territories, from the opening night in St Vincent to the final at
Kensington Oval.

Cricket picks work differently to football. There are no odds to
weigh up: every winner pays the same. The points are in how well you
read the game.

HOW A CPL MATCH SCORES
  Call the winner ......................................... +50
    Flat rate, every match
  Predict each side's runs ...................... up to +100 each
    Two optional legs -- 100 minus however many runs you're off by
  -----------------------------------------------------------
  Perfect match ........................................... 250

Nail the runs and it pays more than the result. Both runs legs are
optional -- skip them and you're still playing for the +50. A
rain-shortened or early-finished innings is scaled to its 20-over
equivalent before scoring, so it's run rate you're really calling.

FIRST BALL -- FRIDAY 7 AUGUST
  Jamaica Kingsmen v Antigua & Barbuda Falcons
  Arnos Vale Stadium, St Vincent -- 7:00pm local

Make my first cricket pick -> https://bantryx.com/?view=games

Picks lock at the first ball. The final is 20 September at
Kensington Oval, Barbados.

--
No betting. Just Bantryx.
You're receiving this because you have a Bantryx account.
https://bantryx.com`,
};
