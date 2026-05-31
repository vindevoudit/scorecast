'use strict';

// Tier 30 Phase 3 A4 follow-up — preview the original (restored)
// ShareableCard design at the new 9:16 default ratio. Loads the real
// app so the prod bundle's @fontsource Orbitron weights are in scope,
// then injects a synthetic mirror of the component's inline-styled DOM
// into <body> and screenshots it into docs/.
//
// Synthetic HTML must stay in lockstep with src/components/ShareableCard.jsx
// — if the component drifts, refresh this scaffold.

const path = require('node:path');
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

test('share card preview — restored design at 9:16', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });

  await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    document.body.innerHTML = `
      <div id="card" style="
        width: 1080px; height: 1920px; position: relative; overflow: hidden;
        background: radial-gradient(ellipse at top, #1E293B 0%, #0F172A 60%);
        color: #F8FAFC; box-sizing: border-box;
        padding: 100px 80px 100px;
        display: flex; flex-direction: column; justify-content: space-between;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;">

        <div style="position: absolute; top: -260px; left: 50%; transform: translateX(-50%);
          width: 900px; height: 600px;
          background: radial-gradient(ellipse, #22D3EE33 0%, #22D3EE00 60%); pointer-events: none;"></div>

        <div style="display: flex; align-items: center; justify-content: center;">
          <div style="font-size: 56px; font-weight: 900; color: #22D3EE; letter-spacing: 0.32em;
            font-family: 'Orbitron', 'JetBrains Mono', 'Courier New', monospace;
            text-shadow: 0 0 24px #22D3EE66;">BANTRYX</div>
        </div>

        <div style="text-align: center; font-size: 28px; font-weight: 600;
          color: #67E8F9; letter-spacing: 0.32em;
          font-family: 'Orbitron', 'JetBrains Mono', 'Courier New', monospace;">31 MAY 2026 · 18:00</div>

        <div style="display: flex; align-items: center; justify-content: space-between; gap: 48px;">
          <div style="flex: 1; text-align: center; padding: 32px 24px;
            background: #22D3EE1F; border: 2px solid #22D3EE66; border-radius: 32px;">
            <div style="font-size: 56px; font-weight: 700; color: #F8FAFC; line-height: 1.15;
              overflow-wrap: break-word; word-break: normal; hyphens: manual;">Liverpool</div>
          </div>
          <div style="font-size: 40px; font-weight: 700; color: #94A3B8; letter-spacing: 0.2em;">VS</div>
          <div style="flex: 1; text-align: center; padding: 32px 24px;
            background: transparent; border: 2px solid transparent; border-radius: 32px;">
            <div style="font-size: 56px; font-weight: 700; color: #F8FAFC; line-height: 1.15;
              overflow-wrap: break-word; word-break: normal; hyphens: manual;">Manchester United</div>
          </div>
        </div>

        <div style="text-align: center;">
          <div style="font-size: 38px; font-weight: 500; color: #94A3B8; letter-spacing: 0.28em;
            font-family: 'Orbitron', 'JetBrains Mono', 'Courier New', monospace;">I picked</div>
          <div style="margin-top: 24px; font-size: 88px; font-weight: 800; color: #22D3EE;
            line-height: 1.1; letter-spacing: 0.02em;
            font-family: 'Orbitron', 'JetBrains Mono', 'Courier New', monospace;
            text-shadow: 0 0 24px #22D3EE80, 0 0 48px #22D3EE55;
            overflow-wrap: break-word; word-break: normal;">Liverpool</div>
        </div>

        <div style="text-align: center; font-family: 'Orbitron', 'JetBrains Mono', 'Courier New', monospace;
          font-weight: 600; letter-spacing: 0.36em; color: #67E8F9; font-size: 36px; line-height: 1.4;
          text-shadow: 0 0 16px #22D3EE55, 0 0 32px #22D3EE33;">
          <div>NO BETTING</div>
          <div>JUST BANTRYX</div>
        </div>

        <div style="font-size: 28px; color: #94A3B8; text-align: center; letter-spacing: 0.04em;">
          Predict · Compete · Climb · <span style="font-weight: 700; color: #67E8F9;">bantryx.com</span>
        </div>
      </div>`;
  });
  await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(500);

  const node = page.locator('#card');
  const out = path.join(__dirname, '..', '..', 'docs', 'share-card-9x16-preview.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await node.screenshot({ path: out });
  expect(fs.existsSync(out)).toBe(true);
});
