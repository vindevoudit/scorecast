// World Cup Aftermatch (user-facing name; code keeps `wrapped`) — imperative
// share-as-image helper. Copies the
// createRoot-off-screen dance from GameCard.jsx `captureAndShare`: dynamic-
// imports react-dom/client + WrappedShareCard + the share lib (so none of it
// ships in the eager Wrapped chunk), mounts the 1080×1920 capture source
// off-screen, waits for a paint AND for Orbitron to actually download, rasters
// via html-to-image, then routes through navigator.share on mobile / a PNG
// download on desktop.

// CRITICAL: every Orbitron weight the card paints must be awaited before the
// raster, or html-to-image snapshots the Courier-New fallback (documented
// GameCard invariant). Covers weights 600/700/800/900 across the sizes used
// by WrappedShareCard.
const ORBITRON_LOAD = [
  "600 30px 'Orbitron'",
  "600 56px 'Orbitron'",
  "700 64px 'Orbitron'",
  "800 220px 'Orbitron'",
  "900 56px 'Orbitron'",
];

export async function shareWrapped({ wrapped, name }) {
  const [{ createRoot }, cardModule, shareLib] = await Promise.all([
    import('react-dom/client'),
    import('./WrappedShareCard'),
    import('../../lib/share'),
  ]);
  const WrappedShareCard = cardModule.default;
  const { captureNodeToPng, shareBlob } = shareLib;

  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; top: 0; left: -20000px; pointer-events: none; opacity: 0;';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'width: 1080px; height: 1920px;';
  host.appendChild(wrapper);
  document.body.appendChild(host);

  const root = createRoot(wrapper);
  try {
    root.render(<WrappedShareCard wrapped={wrapped} name={name} />);
    // One React commit + one browser paint frame.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (typeof document !== 'undefined' && document.fonts?.load) {
      await Promise.all(ORBITRON_LOAD.map((f) => document.fonts.load(f))).catch(() => {});
      if (document.fonts.ready) await document.fonts.ready;
    }
    const blob = await captureNodeToPng(wrapper);
    const points = wrapped?.summary?.points ?? 0;
    const text = `My World Cup 2026 Aftermatch — ${points.toLocaleString('en-US')} points on Bantryx.`;
    return shareBlob(blob, {
      filename: 'bantryx-wc-aftermatch.png',
      title: 'World Cup Aftermatch',
      text,
      url: typeof window !== 'undefined' ? window.location.origin : 'https://bantryx.com',
    });
  } finally {
    root.unmount();
    host.remove();
  }
}
