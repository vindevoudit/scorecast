// Campaign: World Cup knockout-stage pick reminder (sent July 2026).
//
// Kept as the reference template — it populates every supported field. Copy this
// file, change the copy, send. See scripts/broadcast-email.mjs for the full
// field list, the plaintext/HTML rendering rules, and the send modes.
//
// Write real characters (apostrophes, em-dashes, emoji): everything here is
// HTML-escaped by the renderer and the plaintext part is generated from the
// same fields, so there is no second copy to keep in sync.

export default {
  subject: 'The knockouts are here — lock in your picks ⚽',

  // Hidden line most inbox clients show next to the subject.
  preheader: 'One bad result and a team is gone. Every pick counts more from here.',

  heading: 'The knockout stage is here ⚽',

  paragraphs: [
    'Group stage is done and the bracket is set. From here on, one bad result and a team is gone — so every pick counts more than ever.',
    "Get your knockout picks in before each match kicks off. The bolder the call, the bigger the payout: back an underdog that pulls off the upset and you'll bank serious points.",
  ],

  // Amber callout under the body copy.
  highlight: '⏱️ Remember: picks lock at kickoff. No late entries.',

  // path is app-relative; the script prefixes PUBLIC_APP_URL.
  cta: { label: 'Make my picks', path: '/?view=games' },
};
