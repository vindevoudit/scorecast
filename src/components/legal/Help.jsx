'use strict';

import LegalLayout from './LegalLayout';

const CONTACT_EMAIL = 'bantryx@gmail.com';

function H2({ id, children }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-xl font-semibold text-fg">
      {children}
    </h2>
  );
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
function TocLink({ href, children }) {
  return (
    <a
      href={href}
      className="text-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </a>
  );
}

function Help() {
  return (
    <LegalLayout title="Getting started">
      <P>
        Bantryx is a football prediction game. You make picks on real matches, earn points based on
        how unlikely your pick was, and climb leaderboards — solo or with friends in private groups.
        This guide walks you through everything you need to know.
      </P>

      <nav
        aria-label="On this page"
        className="rounded-2xl border border-default bg-overlay/40 p-4"
      >
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-fg-muted">
          On this page
        </p>
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          <li>
            <TocLink href="#quick-start">Quick start</TocLink>
          </li>
          <li>
            <TocLink href="#install">Install on your phone</TocLink>
          </li>
          <li>
            <TocLink href="#picks">Making your first pick</TocLink>
          </li>
          <li>
            <TocLink href="#scoring">How scoring works</TocLink>
          </li>
          <li>
            <TocLink href="#leaderboards">Leaderboards</TocLink>
          </li>
          <li>
            <TocLink href="#groups">Groups</TocLink>
          </li>
          <li>
            <TocLink href="#friends">Friends</TocLink>
          </li>
          <li>
            <TocLink href="#comments">Comments and reactions</TocLink>
          </li>
          <li>
            <TocLink href="#notifications">Notifications</TocLink>
          </li>
          <li>
            <TocLink href="#badges">Badges</TocLink>
          </li>
          <li>
            <TocLink href="#profile">Profile and privacy</TocLink>
          </li>
          <li>
            <TocLink href="#browse">Browsing without an account</TocLink>
          </li>
          <li>
            <TocLink href="#help">Help and feedback</TocLink>
          </li>
        </ul>
      </nav>

      <H2 id="quick-start">Quick start</H2>
      <OL>
        <li>
          Visit <strong>bantryx.com</strong>.
        </li>
        <li>
          Click <strong>Get started</strong> and create an account, or{' '}
          <strong>Or just browse as a guest →</strong> to explore first.
        </li>
        <li>
          (Optional) Install Bantryx as an app on your phone — see{' '}
          <TocLink href="#install">Install on your phone</TocLink>.
        </li>
        <li>
          Open the <strong>Games</strong> tab, tap a team to make your pick, and you&apos;re in.
        </li>
      </OL>
      <P>
        You must be at least 13 years old to use Bantryx. You&apos;ll be asked to accept the Terms
        and confirm your age at sign-up.
      </P>

      <H2 id="install">Install on your phone</H2>
      <P>
        Bantryx works in any modern browser, but installing it as an app gives you a home-screen
        icon, a full-screen experience, and the option to receive push notifications.
      </P>

      <h3 className="text-lg font-semibold text-fg">
        Android (Chrome, Edge, Brave, Samsung Internet)
      </h3>
      <OL>
        <li>
          Open <strong>bantryx.com</strong> in your browser.
        </li>
        <li>
          Look for the <strong>Install app</strong> button in the Bantryx UI, or open your
          browser&apos;s menu (⋮) and tap <strong>Install app</strong> or{' '}
          <strong>Add to Home screen</strong>.
        </li>
        <li>Confirm — Bantryx will appear on your home screen and in your app drawer.</li>
      </OL>

      <h3 className="text-lg font-semibold text-fg">iPhone / iPad (Safari, iOS 16.4 or newer)</h3>
      <P>
        iOS only supports installing web apps from <strong>Safari</strong>. Chrome and other iOS
        browsers will not work for this step.
      </P>
      <OL>
        <li>
          Open <strong>bantryx.com</strong> in <strong>Safari</strong>.
        </li>
        <li>
          Tap the <strong>Share</strong> button (the square with an arrow pointing up) at the bottom
          of the screen.
        </li>
        <li>
          Scroll down in the share sheet and tap <strong>Add to Home Screen</strong>.
        </li>
        <li>
          Tap <strong>Add</strong> in the top-right.
        </li>
      </OL>
      <P>
        Open Bantryx from the new home-screen icon. Push notifications on iOS only work when the app
        is launched this way, not from inside Safari.
      </P>

      <H2 id="picks">Making your first pick</H2>
      <OL>
        <li>
          Open the <strong>Games</strong> tab from the sidebar.
        </li>
        <li>
          Use the calendar strip to find a match. The strip shows 7 days at a time — use the arrows
          to scroll, or tap <strong>Back to today</strong> to return.
        </li>
        <li>
          Tap the <strong>home team</strong> or <strong>away team</strong> on the match card to lock
          in your pick.
        </li>
        <li>
          Your pick is saved automatically. You can change it any time before kickoff by tapping
          again or using the <strong>Undo</strong> button.
        </li>
      </OL>
      <P>You cannot pick after kickoff. Picks lock when the match starts.</P>

      <h3 id="draws" className="scroll-mt-24 text-lg font-semibold text-fg">
        A note on draws
      </h3>
      <P>
        You pick <strong>home or away</strong> — there&apos;s no &ldquo;pick the draw&rdquo; option.
        If the match ends in a draw, you still earn <strong>partial credit</strong> based on the
        model&apos;s draw probability, so a pick on a drawn match is never a total loss.
      </P>

      <H2 id="scoring">How scoring works</H2>
      <P>
        Every match has three probabilities — home win, draw, away win — that sum to 100%. Your
        payout depends on how unlikely the outcome you picked was at <strong>kickoff</strong>.
      </P>
      <UL>
        <li>
          <strong>Your pick wins</strong>: <em>(1 − your team&apos;s win probability) × 100</em>.
          Pick a 30% underdog and they win → <strong>+70 points</strong>. Pick a 70% favourite and
          they win → <strong>+30 points</strong>.
        </li>
        <li>
          <strong>Match drawn</strong>: a smaller partial-credit payout based on the draw
          probability and the opposite team&apos;s strength.
        </li>
        <li>
          <strong>Your pick loses</strong>: <strong>0 points</strong>.
        </li>
      </UL>
      <P>
        The probabilities you score against are <strong>locked at kickoff</strong> — every player
        who picked the same team on the same match scores the same payout, no matter when in the
        week they picked.
      </P>
      <P>You can see the potential payout for each outcome on the match card&apos;s payout grid.</P>

      <H2 id="leaderboards">Leaderboards</H2>
      <P>
        Open the <strong>Rankings</strong> tab to see how you stack up.
      </P>
      <UL>
        <li>
          <strong>Overall</strong>: every Bantryx player.
        </li>
        <li>
          <strong>Per-group</strong>: a separate board for each group you&apos;re in.
        </li>
        <li>
          <strong>Filter by league and season</strong>: use the filter bar at the top to scope the
          rankings to, say, Premier League 2025/26 only. The same filter also scopes your{' '}
          <strong>Picks</strong> stats.
        </li>
      </UL>
      <P>
        Rankings are sorted by total points. Ties break on <strong>win rate</strong> (correct picks
        ÷ total picks).
      </P>

      <H2 id="groups">Groups</H2>
      <P>Groups are private (or public) competitions with friends or strangers.</P>

      <h3 className="text-lg font-semibold text-fg">Join a group</h3>
      <UL>
        <li>
          <strong>Public groups</strong>: open the <strong>Groups</strong> tab →{' '}
          <strong>Discover</strong> to browse, then click <strong>Join</strong>.
        </li>
        <li>
          <strong>Password-protected groups</strong>: the group owner shares a password; click{' '}
          <strong>Join with password</strong>.
        </li>
        <li>
          <strong>Invite-only groups</strong>: you&apos;ll see invites in your notifications bell
          and in the Groups tab.
        </li>
      </UL>

      <h3 className="text-lg font-semibold text-fg">Create a group</h3>
      <OL>
        <li>
          Open the <strong>Groups</strong> tab → <strong>Create a new group</strong>.
        </li>
        <li>
          Choose a name, visibility (public / password / invite-only), and an optional join message.
        </li>
        <li>Invite friends by username, or share the password if you set one.</li>
      </OL>
      <P>
        Groups can have up to <strong>2000 members</strong>. Each group has its own running comment
        thread for trash talk.
      </P>

      <H2 id="friends">Friends</H2>
      <P>
        The <strong>Groups</strong> tab also handles friends.
      </P>
      <UL>
        <li>
          <strong>Send a request</strong>: use the search bar at the top, find someone, and click{' '}
          <strong>Add friend</strong>.
        </li>
        <li>
          <strong>Accept / decline</strong>: incoming requests show up in your Friends list.
        </li>
        <li>
          <strong>See their picks</strong>: open any match card or the{' '}
          <strong>Picks → Friends</strong> tab to see what your friends picked on each game.
        </li>
      </UL>
      <P>Friend requests work even if the other person has a private profile.</P>

      <H2 id="comments">Comments and reactions</H2>
      <P>Every match has a comment thread. You can also post in your groups&apos; threads.</P>
      <UL>
        <li>
          <strong>Post a comment</strong>: type in the box and hit send. 280 characters max.
        </li>
        <li>
          <strong>React</strong>: tap an existing comment to add 👍 ❤️ 😂 😮 🔥.
        </li>
        <li>
          <strong>Edit / delete</strong>: tap your own comment to edit or delete it.
        </li>
      </UL>
      <P>
        Be respectful — Bantryx automatically filters profanity from comments, usernames, and group
        names.
      </P>

      <H2 id="notifications">Notifications</H2>
      <P>
        The <strong>bell icon</strong> in the top bar shows in-app notifications:
      </P>
      <UL>
        <li>Your pick was scored.</li>
        <li>A friend sent you a request, or accepted yours.</li>
        <li>Someone invited you to a group.</li>
        <li>A badge you unlocked.</li>
        <li>Match odds shifted on a game you picked.</li>
        <li>A kickoff is coming up.</li>
        <li>Someone commented in one of your groups.</li>
      </UL>
      <P>Click any notification to jump straight to the relevant match, group, or profile.</P>

      <h3 className="text-lg font-semibold text-fg">Push notifications (mobile + desktop)</h3>
      <P>
        If you&apos;ve <TocLink href="#install">installed Bantryx</TocLink>, you can also receive
        native push notifications.
      </P>
      <OL>
        <li>
          Open your <strong>Profile</strong> tab → <strong>Settings</strong> →{' '}
          <strong>Push notifications</strong>.
        </li>
        <li>Toggle the master switch on (your browser will ask for permission).</li>
        <li>Choose which notification types you want delivered as push.</li>
      </OL>
      <P>
        On iOS, push only works after you&apos;ve added Bantryx to your home screen and opened it
        from that icon.
      </P>

      <H2 id="badges">Badges</H2>
      <P>
        You earn badges for milestones — your first pick, your first correct pick, win streaks,
        group participation, and more. Open your <strong>Profile</strong> tab to see what
        you&apos;ve unlocked and what&apos;s still locked.
      </P>

      <H2 id="profile">Profile and privacy</H2>
      <P>
        Open the <strong>Profile</strong> tab to manage your account.
      </P>

      <h3 className="text-lg font-semibold text-fg">Display name and bio</h3>
      <P>
        You can set a display name (different from your username) and a short bio. Both are visible
        to other players based on your privacy setting.
      </P>

      <h3 className="text-lg font-semibold text-fg">Privacy</h3>
      <P>
        In <strong>Settings → Privacy</strong>, choose who can see your full profile:
      </P>
      <UL>
        <li>
          <strong>Public</strong> (default): anyone can view your profile.
        </li>
        <li>
          <strong>Friends only</strong>: only accepted friends see your profile; everyone else sees
          a masked entry on leaderboards.
        </li>
        <li>
          <strong>Private</strong>: only you and admins can see your profile.
        </li>
      </UL>
      <P>
        Inside a group you&apos;re a member of, other members always see you unmasked regardless of
        your setting — that&apos;s the implicit social contract of joining a group.
      </P>

      <h3 className="text-lg font-semibold text-fg">Password and email</h3>
      <P>
        Change your password or email address in <strong>Settings</strong>. Changing your password
        signs you out everywhere else.
      </P>

      <h3 className="text-lg font-semibold text-fg">Theme</h3>
      <P>
        Bantryx ships in dark mode by default. Switch to light mode any time from{' '}
        <strong>Settings → Appearance</strong>.
      </P>

      <H2 id="browse">Browsing without an account</H2>
      <P>You can explore most of Bantryx without signing up:</P>
      <UL>
        <li>Browse the Games tab and see match probabilities.</li>
        <li>View the Rankings tab and public group leaderboards.</li>
        <li>Read comments on matches.</li>
        <li>View public profiles.</li>
      </UL>
      <P>
        To make picks, post comments, react, join groups, or send friend requests, you&apos;ll need
        an account. Bantryx will prompt you to sign in when you try.
      </P>

      <H2 id="help">Help and feedback</H2>
      <UL>
        <li>
          <strong>Forgot your password?</strong> Use the <strong>Forgot password?</strong> link on
          the sign-in screen.
        </li>
        <li>
          <strong>Stuck or found a bug?</strong> Email us at {CONTACT_EMAIL} — include a screenshot
          if you can.
        </li>
      </UL>
      <P>Welcome to Bantryx — good luck with your picks.</P>
    </LegalLayout>
  );
}

export default Help;
