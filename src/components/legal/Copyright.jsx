'use strict';

import LegalLayout from './LegalLayout';

// Tier 18 Chunk 6 — Copyright notice + DMCA-style takedown procedure.
const LEGAL_CONTACT = {
  operator: 'Bantryx',
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
function OL({ children }) {
  return <ol className="ml-5 list-decimal space-y-1.5 leading-relaxed text-fg">{children}</ol>;
}

function Copyright() {
  return (
    <LegalLayout title="Copyright Notice" lastUpdated="May 26, 2026">
      <H2>1. Our copyright</H2>
      <P>
        The Bantryx name, logo, design system, user interface, written copy, page layouts, icons,
        and source code are the copyrighted work of {LEGAL_CONTACT.operator}. All rights reserved.
        Nothing on this site grants you any right to reproduce, distribute, or create derivative
        works from these materials except as expressly allowed in our{' '}
        <a href="/terms" className="text-accent underline hover:text-accent-soft">
          Terms of Service
        </a>
        .
      </P>

      <H2>2. User-submitted content</H2>
      <P>
        You retain copyright in the picks, comments, and reactions you post on Bantryx. You grant us
        the license described in section 4 ("Your content") of the Terms of Service so that we can
        display your content as part of operating the service.
      </P>

      <H2>3. Third-party data</H2>
      <P>
        Fixture lists, match results, team names, and other football-related data shown in Bantryx
        are sourced from third-party providers (currently football-data.org). We make no proprietary
        claim to that data; it is shown to you under the licensing arrangements between{' '}
        {LEGAL_CONTACT.operator} and those providers.
      </P>

      <H2>4. Reporting infringement</H2>
      <P>
        If you believe that material on Bantryx infringes a copyright you own or control, please
        send a written notice to {LEGAL_CONTACT.email} that includes:
      </P>
      <OL>
        <li>
          A clear identification of the copyrighted work you claim has been infringed (a link or
          description is fine).
        </li>
        <li>
          A clear identification of the material on Bantryx that you say is infringing — ideally a
          link to the comment, pick, or page in question.
        </li>
        <li>Your contact information (email address at minimum).</li>
        <li>
          A statement that you have a good-faith belief that the use is not authorized by the
          copyright owner, its agent, or the law.
        </li>
        <li>
          A statement, under penalty of perjury, that the information in your notice is accurate and
          that you are the copyright owner or are authorized to act on behalf of the owner.
        </li>
        <li>Your physical or electronic signature.</li>
      </OL>
      <P>
        We will review valid notices promptly. If we conclude that the material is infringing, we
        will remove or disable access to it and notify the user who posted it. Repeat infringers may
        have their accounts terminated.
      </P>

      <H2>5. Counter-notice</H2>
      <P>
        If you believe material you posted was removed or disabled in error, you can send a
        counter-notice to {LEGAL_CONTACT.email} that includes:
      </P>
      <UL>
        <li>
          Identification of the material that was removed and where it appeared before removal.
        </li>
        <li>
          A statement, under penalty of perjury, that you have a good-faith belief that the material
          was removed as a result of mistake or misidentification.
        </li>
        <li>
          Your name, contact information, and a statement that you consent to the jurisdiction of
          the courts of the Republic of Trinidad and Tobago.
        </li>
        <li>Your physical or electronic signature.</li>
      </UL>
      <P>
        We may forward valid counter-notices to the original complainant. If the complainant does
        not file legal action within a reasonable period, we may restore the material at our
        discretion.
      </P>

      <H2>6. False claims</H2>
      <P>
        Making a knowingly false copyright claim may expose you to legal liability. Please make sure
        your claim is accurate before submitting it.
      </P>

      <H2>7. Contact</H2>
      <P>Copyright questions and notices can be sent to {LEGAL_CONTACT.email}.</P>
    </LegalLayout>
  );
}

export default Copyright;
