// Tier 30 Phase 3 A4 — Share-as-image modal.
//
// Mounted lazily from GameCard (React.lazy in the consumer) so the
// html-to-image bundle only loads when a user actually opens the
// share UI. Inside: format toggle (Square 1:1 / Story 9:16), an
// off-screen capture-source ShareableCard at full 1080x{1080,1920},
// a small in-modal preview at 25% scale, and a Share button that
// routes through src/lib/share.shareImageFromNode (native share sheet
// on mobile, PNG download on desktop / when share fails).
//
// `localStorage.sc_shared_<gameId>` stamps on first successful capture
// — reserved for a future "still haven't shared this great win?"
// auto-prompt (A4 surface only writes; nothing reads it yet).

import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, Button } from './ui';
import ShareableCard from './ShareableCard';
import { shareImageFromNode } from '../lib/share';
import { useNotifications } from '../hooks/useNotifications';

const FORMATS = {
  square: { width: 1080, height: 1080, label: 'Square 1:1' },
  story: { width: 1080, height: 1920, label: 'Story 9:16' },
};

// Display-time scale for the in-modal preview. 25% keeps a 1080x1080
// source at a 270x270 thumbnail (Square) and a 1080x1920 source at
// 270x480 (Story) — both fit comfortably in the dialog's max-w-md.
const PREVIEW_SCALE = 0.25;

function FormatToggle({ value, onChange }) {
  return (
    <div className="mt-4 inline-flex rounded-full border border-default bg-overlay/50 p-1">
      {Object.entries(FORMATS).map(([key, fmt]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
            value === key ? 'bg-accent/20 text-accent shadow-led' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {fmt.label}
        </button>
      ))}
    </div>
  );
}

function ShareSheet({ open, onOpenChange, game, choice, points }) {
  const [ratio, setRatio] = useState('square');
  const [busy, setBusy] = useState(false);
  const captureRef = useRef(null);
  const { showStatus } = useNotifications();

  const fmt = FORMATS[ratio];
  const previewWidth = Math.round(fmt.width * PREVIEW_SCALE);
  const previewHeight = Math.round(fmt.height * PREVIEW_SCALE);

  const handleShare = async () => {
    if (busy || !captureRef.current) return;
    setBusy(true);
    try {
      const pickedTeam = choice === 'home' ? game.homeTeam : game.awayTeam;
      const text = choice
        ? `I picked ${pickedTeam} for ${game.homeTeam} vs ${game.awayTeam} on Bantryx.`
        : 'Bantryx — predict, compete, climb.';
      const result = await shareImageFromNode(captureRef.current, {
        filename: `bantryx-${game.id}-${ratio}.png`,
        title: 'Bantryx pick',
        text,
        url: typeof window !== 'undefined' ? window.location.origin : 'https://bantryx.com',
      });
      try {
        window.localStorage.setItem(`sc_shared_${game.id}`, '1');
      } catch {
        /* private mode / quota — best-effort flag, ignore */
      }
      if (result.method === 'shared') showStatus('Shared');
      else if (result.method === 'downloaded') showStatus('Image saved');
      // cancelled → no toast (user chose to back out)
      if (result.method !== 'cancelled') onOpenChange(false);
    } catch (err) {
      showStatus("Couldn't generate the image — try again");
      console.error('share failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Share your pick</DialogTitle>
        <p className="mt-2 text-sm text-fg-muted">
          Generates a {fmt.label.toLowerCase()} image. On mobile we'll open the share sheet; on
          desktop the PNG downloads.
        </p>

        <FormatToggle value={ratio} onChange={setRatio} />

        {/* Off-screen capture source at FULL 1080x{1080,1920}. Position
            fixed + far off-screen so it renders but doesn't displace
            modal content. Pointer-events disabled so it can't intercept
            taps. html-to-image walks DOWN from captureRef, so ancestor
            offsets don't affect the captured raster. */}
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: '-20000px',
            pointerEvents: 'none',
            opacity: 0,
          }}
          aria-hidden="true"
        >
          <div ref={captureRef} style={{ width: fmt.width, height: fmt.height }}>
            <ShareableCard game={game} choice={choice} points={points} ratio={ratio} />
          </div>
        </div>

        {/* Visible preview — a separate render of the same component at
            scaled-down dimensions inside an overflow-hidden frame. */}
        <div className="mt-4 flex justify-center">
          <div
            className="overflow-hidden rounded-2xl border border-default bg-base"
            style={{ width: previewWidth, height: previewHeight }}
          >
            <div
              style={{
                width: fmt.width,
                height: fmt.height,
                transform: `scale(${PREVIEW_SCALE})`,
                transformOrigin: 'top left',
              }}
            >
              <ShareableCard game={game} choice={choice} points={points} ratio={ratio} />
            </div>
          </div>
        </div>

        <Button onClick={handleShare} disabled={busy} className="mt-5 w-full">
          {busy ? 'Generating…' : 'Share'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export default ShareSheet;
