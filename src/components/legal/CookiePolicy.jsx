'use strict';

import LegalLayout from './LegalLayout';

// Tier 18 Chunk 6 — Cookie Policy. Plain-language overview. Deliberately
// avoids naming specific cookies / lifetimes / storage keys so we don't
// publish an attacker-friendly inventory of our auth surface. If we ever
// add a tracking or advertising cookie, this page MUST grow a new section
// (and we'll likely need a consent banner).
const LEGAL_CONTACT = {
  email: 'bantryx@gmail.com',
};

function H2({ children }) {
  return <h2 className="text-xl font-semibold text-fg">{children}</h2>;
}
function P({ children }) {
  return <p className="leading-relaxed text-fg">{children}</p>;
}
function UL({ children }) {
  return <ul className="ml-5 list-disc space-y-1.5 leading-relaxed text-fg">{children}</ul>;
}

function CookiePolicy() {
  return (
    <LegalLayout title="Cookie Policy" lastUpdated="May 26, 2026">
      <P>
        Bantryx uses cookies and similar browser storage only where they are strictly necessary to
        run the service. We do not use cookies for advertising, tracking, or analytics.
      </P>

      <H2>1. What we use</H2>
      <UL>
        <li>
          <strong>Authentication cookies</strong> — to keep you signed in across page loads,
          including the short-lived session token and the longer-lived refresh token that lets your
          session resume without you having to type your password every few minutes.
        </li>
        <li>
          <strong>Security cookies</strong> — to protect forms on the site against a class of attack
          called cross-site request forgery, and (if you have two-factor authentication enabled) to
          record that you have passed the password step during sign-in.
        </li>
        <li>
          <strong>Browser preferences</strong> — a few interface preferences (such as your light or
          dark theme, whether the sidebar is collapsed, whether you have dismissed the "Install app"
          prompt) are stored in your browser&apos;s local storage. These are not cookies and are not
          sent to our servers.
        </li>
      </UL>

      <H2>2. Push notifications</H2>
      <P>
        If you opt in to push notifications, your browser stores a subscription handle so we can
        deliver alerts to you. You can revoke this at any time from the Push notifications panel in
        your Profile, or by clearing notification permissions for this site in your browser
        settings.
      </P>

      <H2>3. Third-party cookies</H2>
      <P>
        We do not embed any third-party content that sets cookies in your browser. We do not run
        third-party advertising, analytics, or tracking scripts.
      </P>

      <H2>4. How to disable cookies</H2>
      <P>
        You can disable or delete cookies in your browser settings. If you disable the
        authentication or security cookies described above, you will not be able to sign in to
        Bantryx — they are required for the site to function.
      </P>

      <H2>5. Changes</H2>
      <P>
        We will update this page if we ever change how we use cookies or browser storage. The "Last
        updated" date at the top reflects the most recent change.
      </P>

      <H2>6. Contact</H2>
      <P>Questions about cookies can be sent to {LEGAL_CONTACT.email}.</P>
    </LegalLayout>
  );
}

export default CookiePolicy;
