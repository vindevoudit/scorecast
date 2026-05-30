// Tier 30 Phase 1 Chunk 1.1 — SettingsView. New top-level surface reached
// via UserMenu → "Settings". Lifts five panels out of ProfileView so the
// profile becomes a read-mostly "who you are" surface and Settings owns
// "how the account is configured":
//
//   Account       → ChangeEmailPanel + ChangePasswordPanel
//   Appearance    → ThemeToggle
//   Notifications → PushSettingsPanel (iOS install-gate handled inside)
//   Privacy       → profileVisibility radio (the same control ProfileView
//                   used to render; saves immediately via PUT /api/me)
//
// Sub-tab choice persists in the URL via `?tab=<account|appearance|
// notifications|privacy>` through the shared SubTabs primitive.

import SubTabs from '../components/SubTabs';
import ChangeEmailPanel from '../components/ChangeEmailPanel';
import ChangePasswordPanel from '../components/ChangePasswordPanel';
import ThemeToggle from '../components/ThemeToggle';
import PushSettingsPanel from '../components/PushSettingsPanel';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { Radio } from '../components/ui';

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can view your profile, picks, and badges.',
  },
  {
    value: 'friends',
    label: 'Friends only',
    description: 'Only accepted friends see your profile. Leaderboard rank stays visible.',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Only you (and admins) see your profile. Leaderboard rank stays visible.',
  },
];

function AccountSection() {
  const { user, handleChangePassword, handleChangeEmail, handleResendVerification } = useAuth();
  return (
    <div className="space-y-4">
      <ChangeEmailPanel
        currentEmail={user?.email}
        verified={Boolean(user?.emailVerifiedAt)}
        lastVerificationSentAt={user?.lastVerificationSentAt}
        onChangeEmail={handleChangeEmail}
        onResendVerification={handleResendVerification}
      />
      <ChangePasswordPanel onChangePassword={handleChangePassword} />
    </div>
  );
}

function AppearanceSection() {
  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">Theme</h3>
          <p className="mt-1 text-sm text-fg">Pick the theme that suits your eyes.</p>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}

function NotificationsSection() {
  // PushSettingsPanel self-handles every state (iOS install-gate, browser
  // unsupported, permission denied, default / unsubscribed master, subscribed
  // master + per-type checkboxes), so the wrapper here is purely structural.
  return <PushSettingsPanel />;
}

function PrivacySection({ currentVisibility, onSaveProfile }) {
  // Mirrors ProfileView's pre-strip layout. Edits flush immediately (no
  // explicit Save button) so the surface stays one-tap. Reads from
  // `user.profileVisibility` (carried on /api/me) so Settings works
  // even when the user hasn't visited Profile yet — ownProfile only
  // hydrates on view==='profile'.
  return (
    <div className="rounded-3xl border border-default bg-elevated/70 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-fg-muted">
        Profile visibility
      </h3>
      <p className="mt-1 text-sm text-fg">Who can see your profile?</p>
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Profile visibility</legend>
        {VISIBILITY_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            htmlFor={`settings-visibility-${opt.value}`}
            className="flex cursor-pointer items-start gap-3 rounded-2xl bg-overlay/70 p-3 hover:bg-overlay"
          >
            <Radio
              id={`settings-visibility-${opt.value}`}
              name="profileVisibility"
              value={opt.value}
              checked={(currentVisibility || 'public') === opt.value}
              onChange={() => onSaveProfile?.({ profileVisibility: opt.value }).catch(() => {})}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-fg">{opt.label}</span>
              <span className="text-xs text-fg-muted">{opt.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function SettingsView() {
  const { user } = useAuth();
  const { handleSaveProfile } = useData();

  if (!user) return null;

  // Privacy radio doesn't gate on a busy state — `handleSaveProfile`
  // already swallows errors and surfaces a toast, and user.profileVisibility
  // updates optimistically through the existing setUser path inside
  // DataContext.handleSaveProfile.
  const tabs = [
    { value: 'account', label: 'Account', content: <AccountSection /> },
    { value: 'appearance', label: 'Appearance', content: <AppearanceSection /> },
    { value: 'notifications', label: 'Notifications', content: <NotificationsSection /> },
    {
      value: 'privacy',
      label: 'Privacy',
      content: (
        <PrivacySection
          currentVisibility={user.profileVisibility}
          onSaveProfile={handleSaveProfile}
        />
      ),
    },
  ];

  return (
    <div className="rounded-3xl border border-default bg-elevated/85 p-6 shadow-glow motion-safe:duration-180 motion-safe:ease-out-expo motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <div className="mb-5 flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.25em] text-accent/80">You</p>
        <h2 className="text-2xl font-semibold text-fg">Settings</h2>
        <p className="text-sm text-fg-muted">
          Manage your account, appearance, notifications, and privacy.
        </p>
      </div>
      <SubTabs tabs={tabs} defaultValue="account" ariaLabel="Settings sections" />
    </div>
  );
}

export default SettingsView;
