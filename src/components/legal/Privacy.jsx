'use strict';

import LegalLayout from './LegalLayout';

// Tier 18 Chunk 6 — Privacy Policy. Plain-language overview; intentionally
// avoids naming specific cookies, retention windows, security mechanisms,
// or sub-processor names so we're not publishing a roadmap of our internal
// architecture. The high-level statements below cover the rights-and-
// processing disclosures required by the T&T Data Protection Act 2011.
const LEGAL_CONTACT = {
  operator: 'Bantryx',
  email: 'bantryx@gmail.com',
  jurisdiction: 'Republic of Trinidad and Tobago',
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

function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="May 26, 2026">
      <P>
        This policy explains what personal data we collect, how we use it, and what rights you have
        under the laws of the {LEGAL_CONTACT.jurisdiction} — including the Data Protection Act,
        Chapter 22:04 (2011).
      </P>

      <H2>1. Who we are</H2>
      <P>
        We are {LEGAL_CONTACT.operator}, a personal project operated from the{' '}
        {LEGAL_CONTACT.jurisdiction}. You can contact us about anything in this policy — including
        data subject requests — at {LEGAL_CONTACT.email}.
      </P>

      <H2>2. Data we collect</H2>
      <UL>
        <li>
          <strong>Account information.</strong> The username and email address you sign up with,
          plus any optional display name, bio, and profile-visibility preference you choose.
        </li>
        <li>
          <strong>Activity.</strong> The picks, comments, reactions, group memberships, friend
          connections, and badges you create as you use the service.
        </li>
        <li>
          <strong>Notifications.</strong> Your in-app and push-notification preferences. If you
          enable push, we also store the subscription handle your browser provides.
        </li>
        <li>
          <strong>Technical.</strong> Limited data used to keep the service running and secure — for
          example, your IP address (for rate limiting and abuse prevention), basic request
          information, and error logs.
        </li>
      </UL>
      <P>
        We do not knowingly collect data from children under 13. If we learn that we have, we will
        delete the account.
      </P>

      <H2>3. How we use it</H2>
      <UL>
        <li>To run your account, sign you in, and let you use the game features.</li>
        <li>To send essential transactional emails (account verification, password reset).</li>
        <li>To deliver notifications you have opted in to receive.</li>
        <li>To prevent abuse, debug errors, and keep the service secure.</li>
        <li>To comply with the law and respond to lawful requests from public authorities.</li>
      </UL>
      <P>
        We do not sell your data. We do not run advertising. We do not embed third-party tracking or
        analytics scripts.
      </P>

      <H2>4. Service providers</H2>
      <P>
        We use a small number of third-party providers to host the application, send transactional
        email, deliver push notifications, and source football fixture data. These providers process
        limited data on our behalf under their own terms. We do not share your personal data with
        any other third party except where required by law.
      </P>

      <H2>5. How long we keep it</H2>
      <P>
        We keep your personal data for as long as your account is active, and only as long as we
        need it for the purposes described above. When you delete your account, we delete your
        personal data and the content you created. Some records may be retained for a limited period
        for security, backup, or legal reasons.
      </P>

      <H2>6. Your rights</H2>
      <P>
        Under the Data Protection Act of the {LEGAL_CONTACT.jurisdiction} (and equivalent laws in
        other jurisdictions, where applicable), you have the right to:
      </P>
      <UL>
        <li>Be informed about how your personal data is used (this policy).</li>
        <li>Access the personal data we hold about you.</li>
        <li>Correct data that is inaccurate or incomplete.</li>
        <li>Have your data deleted, subject to legal limits.</li>
        <li>Object to or restrict certain uses of your data.</li>
        <li>Receive a copy of your data in a portable format.</li>
        <li>Lodge a complaint with the appropriate data protection authority.</li>
      </UL>
      <P>
        To exercise any of these rights, email {LEGAL_CONTACT.email}. We will respond within a
        reasonable period and at most within the timelines required by applicable law.
      </P>

      <H2>7. Security</H2>
      <P>
        We protect your data with industry-standard security and storage practices, including
        encryption in transit and secure handling of passwords and other credentials. No system is
        perfectly secure; if we ever become aware of a data breach affecting your personal data, we
        will notify you and the relevant authorities as required by law.
      </P>

      <H2>8. Cookies</H2>
      <P>
        We use a small number of cookies that are strictly necessary to keep you signed in and
        protect against cross-site attacks — see the{' '}
        <a href="/cookies" className="text-accent underline hover:text-accent-soft">
          Cookie Policy
        </a>{' '}
        for details. We do not use advertising or tracking cookies.
      </P>

      <H2>9. Changes to this policy</H2>
      <P>
        We may update this policy from time to time. The "Last updated" date at the top reflects the
        most recent change. For material changes we will give reasonable notice in-app or by email
        before the change takes effect.
      </P>

      <H2>10. Contact</H2>
      <P>
        For any privacy question, including data subject requests, contact {LEGAL_CONTACT.email}.
      </P>
    </LegalLayout>
  );
}

export default Privacy;
