'use strict';

import LegalLayout from './LegalLayout';

// Tier 18 Chunk 6 — Terms of Service. Plain-English. Grounded in what the
// app actually does (prediction game, no money, no gambling). T&T governing
// law. Edit LEGAL_CONTACT below if the operator email ever changes.
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

function Terms() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="May 28, 2026">
      <P>
        Welcome to Bantryx ("we", "us", "the service"). By creating an account or using the service,
        you agree to these Terms. If you do not agree, please do not use the service.
      </P>

      <H2>1. What Bantryx is</H2>
      <P>
        Bantryx is a free social prediction game for football matches. You make picks on upcoming
        fixtures, score points based on the difficulty of correctly-called outcomes, compete on
        leaderboards with friends and in groups, and earn badges for milestones. Bantryx is{' '}
        <strong>not a gambling service</strong>. No money is staked, won, or transferred between
        users.
      </P>

      <H2>2. Your account</H2>
      <UL>
        <li>You must provide a valid email address and choose a unique username.</li>
        <li>
          You are responsible for keeping your password (and TOTP recovery codes, if you enable 2FA)
          secret. Tell us at {LEGAL_CONTACT.email} if you suspect your account has been accessed by
          someone else.
        </li>
        <li>
          You may not impersonate another person, create accounts using automated tools, or run more
          than one account at a time without our written permission.
        </li>
        <li>
          You may delete your account at any time by emailing {LEGAL_CONTACT.email}; we will confirm
          and process the request within a reasonable period.
        </li>
      </UL>

      <H2>3. Acceptable use</H2>
      <P>
        You must be at least 13 years old to use Bantryx. Some jurisdictions require an older
        minimum age — you are responsible for confirming the local requirement.
      </P>
      <P>
        You agree not to use the service to post content that is unlawful, defamatory, hateful,
        harassing, infringing, or in violation of any third party&apos;s rights. You also agree not
        to:
      </P>
      <UL>
        <li>
          Probe, scan, or test the vulnerability of the service or break its security mechanisms.
        </li>
        <li>
          Automate access to the service (scrapers, bots, headless browsers) except for the
          documented public API endpoints and at reasonable rates.
        </li>
        <li>Use the service to compete with us or to build a substantially similar product.</li>
      </UL>
      <P>
        We may remove content or suspend accounts that violate these rules. Repeat or serious
        violations may result in permanent termination.
      </P>

      <H2>4. Your content</H2>
      <P>
        You retain ownership of the picks, comments, reactions, and other content you create on
        Bantryx ("Your Content"). By submitting Your Content, you grant us a worldwide,
        non-exclusive, royalty-free license to host, display, distribute, and back up Your Content
        for the purpose of operating the service (for example, showing a comment you posted to other
        users in the same group, or aggregating picks into a leaderboard row).
      </P>
      <P>
        This license ends when you delete Your Content or your account, except for copies retained
        in routine system backups for a reasonable period.
      </P>

      <H2>5. Our content</H2>
      <P>
        The Bantryx name, logo, design system, copy, and source code are owned by us. Fixture and
        result data is sourced from third-party providers (currently football-data.org) and is used
        under their terms; we make no proprietary claim to underlying match data.
      </P>
      <P>
        Football data provided by the{' '}
        <a
          href="https://www.football-data.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline hover:text-accent-fg"
        >
          Football-Data.org API
        </a>
        .
      </P>

      <H2>6. Availability and changes</H2>
      <P>
        We may modify, suspend, or discontinue any part of the service at any time without notice —
        for example, taking the site offline for maintenance, removing a feature, or shutting the
        service down entirely. We will give reasonable notice for changes likely to materially
        affect existing users where we can, and we will let you export your data if we wind the
        service down. We do not guarantee any uptime, response time, or that the service will be
        free from bugs or errors.
      </P>

      <H2>7. Disclaimers and limitation of liability</H2>
      <P>
        The service is provided "as is" and "as available". To the maximum extent permitted by law,
        we disclaim all warranties — express or implied — including the implied warranties of
        merchantability, fitness for a particular purpose, and non-infringement.
      </P>
      <P>
        To the maximum extent permitted by law, our total liability to you for any claim arising out
        of or relating to the service is limited to the total amount you have paid us in the twelve
        months preceding the claim (which, for the free tier, is zero). We are not liable for
        indirect, incidental, consequential, special, or punitive damages.
      </P>
      <P>
        Nothing in these Terms limits or excludes any liability that cannot be lawfully limited or
        excluded under the laws of {LEGAL_CONTACT.jurisdiction}.
      </P>

      <H2>8. Governing law and disputes</H2>
      <P>
        These Terms and any dispute arising out of or relating to them or the service are governed
        by the laws of the {LEGAL_CONTACT.jurisdiction}, without regard to conflict-of-laws
        principles. You and we submit to the exclusive jurisdiction of the courts of the{' '}
        {LEGAL_CONTACT.jurisdiction} for any dispute that cannot be resolved informally.
      </P>
      <P>
        Before starting any formal proceedings, please contact us at {LEGAL_CONTACT.email} so we can
        try to resolve the matter directly.
      </P>

      <H2>9. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. The "Last updated" date at the top of this page
        reflects the most recent change. For material changes, we will give reasonable notice in-app
        or by email before the change takes effect. Continued use of the service after the effective
        date constitutes acceptance of the updated Terms.
      </P>

      <H2>10. Miscellaneous</H2>
      <UL>
        <li>
          <strong>Severability.</strong> If any provision of these Terms is held unenforceable, the
          remaining provisions remain in full effect.
        </li>
        <li>
          <strong>No waiver.</strong> Our failure to enforce any right does not waive that right.
        </li>
        <li>
          <strong>Entire agreement.</strong> These Terms, together with the Privacy Policy,
          Copyright Notice, and Cookie Policy, constitute the entire agreement between you and us
          regarding the service.
        </li>
        <li>
          <strong>Contact.</strong> Questions about these Terms can be sent to {LEGAL_CONTACT.email}
          .
        </li>
      </UL>
    </LegalLayout>
  );
}

export default Terms;
