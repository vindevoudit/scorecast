// Tier 11 Chunk 2 — UserMenu rebuilt on the DropdownMenu primitive (Radix).
// Trigger keeps `aria-haspopup="menu"` (set by Radix automatically); items
// render with `role="menuitem"` so the Playwright selectors that pick the
// "Sign out" menuitem still resolve.

import Avatar from './Avatar';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/DropdownMenu';

function CaretIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5 text-fg-muted transition-transform duration-150 data-[state=open]:rotate-180"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function UserMenu() {
  const { user, setConfirmingLogout } = useAuth();
  const { setView } = useData();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-3xl border border-default bg-elevated/80 px-3 py-2 text-sm font-semibold text-fg transition-colors duration-200 hover:border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar username={user.username} displayName={user.displayName} size={28} />
          <span className="hidden max-w-[10rem] truncate sm:inline">{user.username}</span>
          <CaretIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
            Signed in as
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-fg">
            {user.username}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setView('profile')}>View profile</DropdownMenuItem>
        <DropdownMenuItem
          className="font-semibold text-accent"
          onSelect={() => setConfirmingLogout(true)}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default UserMenu;
