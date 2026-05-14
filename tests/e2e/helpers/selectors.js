'use strict';

// Anchor → closest "card root" ancestor. Several components (GameCard,
// GroupCard, etc.) nest inner panels that also carry the `rounded-3xl`
// class, so matching on rounded-3xl alone can resolve to an inner panel.
// The card roots additionally carry `border-slate-800`; intersecting both
// pins the outer card without coupling to the full Tailwind class soup.
function closestCard(anchorLocator) {
  return anchorLocator.locator(
    'xpath=ancestor::*[contains(@class,"rounded-3xl") and contains(@class,"border-slate-800")][1]',
  );
}

module.exports = { closestCard };
