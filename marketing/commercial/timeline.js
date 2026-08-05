// marketing/commercial/timeline.js
//
// The director: a single clock drives ~5 beats over ~42s (then loops). Each
// frame it computes the active beat + local time, moves the camera, advances
// the WebGL world (scene.js setters), and syncs the DOM caption overlay. All
// on-screen numbers come from commercial-data.json (real production data).

const TOTAL = 42; // seconds per loop

// eases
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => clamp01((x - a) / (b - a));

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function rotateAroundY(px, pz, cx, cz, ang) {
  const dx = px - cx;
  const dz = pz - cz;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [cx + dx * c - dz * s, cz + dx * s + dz * c];
}

// ---------------------------------------------------------------------------
// DOM overlay construction — leaderboard + fixture card are built here so the
// HTML stays lean; simple captions are static markup toggled via `.on`.
// ---------------------------------------------------------------------------
function buildOverlay(data) {
  const el = {
    wordmark: document.getElementById('cap-wordmark'),
    kicker: document.getElementById('cap-kicker'),
    sub: document.getElementById('cap-sub'),
    stat: document.getElementById('cap-stat'),
    statNum: document.querySelector('#cap-stat .num'),
    statLabel: document.querySelector('#cap-stat .label'),
    lead: document.getElementById('cap-lead'),
    fixture: document.getElementById('cap-fixture'),
    cta: document.getElementById('cap-cta'),
    ctaMark: document.querySelector('#cap-cta .mark'),
    ctaTag: document.querySelector('#cap-cta .tag'),
    ctaUrl: document.querySelector('#cap-cta .url'),
  };

  // Leaderboard rows (top 8 by Elo)
  const leadTeams = data.topTeams.slice(0, 8);
  el.lead.innerHTML = '<div class="lead-head">WORLD RANKING · LIVE</div>';
  const rows = leadTeams.map((t, i) => {
    const row = document.createElement('div');
    row.className = 'lead-row';
    row.style.setProperty('--i', String(i));
    row.innerHTML = `
      <span class="rk rk-${i + 1 <= 3 ? i + 1 : 'n'}">${t.rank}</span>
      <span class="nm">${t.name}</span>
      <span class="elo led">0</span>`;
    el.lead.appendChild(row);
    return { row, num: row.querySelector('.elo'), target: t.elo };
  });

  // Fixture card
  const fx = data.featuredFixture;
  el.fixture.innerHTML = `
    <div class="fx-eyebrow">WORLD CUP · SEMI-FINAL</div>
    <div class="fx-match">
      <span class="fx-team">${fx.home}</span>
      <span class="fx-vs">VS</span>
      <span class="fx-team">${fx.away}</span>
    </div>
    <div class="fx-bars">
      <div class="fx-bar"><span class="fx-lab">${fx.home}</span><div class="fx-track"><i class="fx-fill home"></i></div><span class="fx-pct home">0%</span></div>
      <div class="fx-bar"><span class="fx-lab">Draw</span><div class="fx-track"><i class="fx-fill draw"></i></div><span class="fx-pct draw">0%</span></div>
      <div class="fx-bar"><span class="fx-lab">${fx.away}</span><div class="fx-track"><i class="fx-fill away"></i></div><span class="fx-pct away">0%</span></div>
    </div>
    <div class="fx-chips"><span>104 FIXTURES</span><span>NEUTRAL VENUE</span><span class="k">K&#215;3.0</span></div>`;
  const fxEl = {
    fills: {
      home: el.fixture.querySelector('.fx-fill.home'),
      draw: el.fixture.querySelector('.fx-fill.draw'),
      away: el.fixture.querySelector('.fx-fill.away'),
    },
    pcts: {
      home: el.fixture.querySelector('.fx-pct.home'),
      draw: el.fixture.querySelector('.fx-pct.draw'),
      away: el.fixture.querySelector('.fx-pct.away'),
    },
  };

  return { el, rows, fx, fxEl };
}

// Toggle only the listed caption containers on.
function only(el, ...ids) {
  ['wordmark', 'kicker', 'sub', 'stat', 'lead', 'fixture', 'cta'].forEach((k) => {
    el[k].classList.toggle('on', ids.includes(k));
  });
}

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------
export function runCommercial(world, data, opts = {}) {
  const dom = buildOverlay(data);
  const { el, rows, fx, fxEl } = dom;
  const reduced = opts.reducedMotion;

  // featured bar indices (rank 1 + 2 → Spain, France = InstancedMesh idx 0,1)
  const keep = new Set([0, 1]);
  const featX = (world.bars.meta[0].x + world.bars.meta[1].x) / 2;

  const beats = [
    // 0 — COLD OPEN: grid rises from black, BANTRYX ignites.
    {
      name: 'open',
      start: 0,
      dur: 4.5,
      enter() {
        only(el, 'wordmark', 'kicker');
        el.kicker.textContent = 'PREDICT ◆ COMPETE ◆ CLIMB';
        el.wordmark.classList.remove('mega');
      },
      update(lt) {
        world.setGridReveal(easeOut(smooth(0.15, 0.9, lt)));
        world.setField(0.12, easeOut(smooth(0.4, 1, lt)) * 0.35);
        world.setBars(0);
        world.setDisc(0);
        world.setBloom(lerp(0.95, 0.5, smooth(0.1, 0.6, lt)));
        // low push-in
        const p = easeInOut(clamp01(lt));
        world.aim(0, lerp(3.5, 6, p), lerp(40, 30, p), 0, 7, -8);
        // wordmark ignition
        el.wordmark.style.setProperty('--ignite', String(easeOut(smooth(0.28, 0.85, lt))));
        el.kicker.style.setProperty('--fade', String(smooth(0.55, 0.95, lt)));
      },
    },

    // 1 — SCALE: pull back over the nation field; three headline stats.
    {
      name: 'scale',
      start: 4.5,
      dur: 7.5,
      enter() {
        only(el, 'stat', 'sub');
        el.sub.textContent = 'THE RATING ENGINE';
        this._stage = -1;
      },
      update(lt, gt, dur) {
        const p = easeInOut(clamp01(lt));
        world.setField(lerp(0.5, 1, p), 0.5);
        world.setGridReveal(1);
        world.setBloom(0.52);
        // dolly up & back
        const [px, pz] = [0, lerp(34, 86, p)];
        world.aim(px, lerp(6, 30, p), pz, 0, lerp(7, 14, p), -12);

        // three sequential stats
        const seg = dur / 3;
        const stage = Math.min(2, Math.floor((lt * dur) / seg));
        const within = ((lt * dur) % seg) / seg;
        if (stage !== this._stage) {
          this._stage = stage;
          el.stat.classList.remove('pop');
          void el.stat.offsetWidth;
          el.stat.classList.add('pop');
        }
        const specs = [
          { to: data.archiveMatches, label: 'MATCHES REPLAYED · SINCE 1872' },
          { to: data.nations, label: 'NATIONS RATED' },
          { to: 1, label: 'RATING ENGINE', word: 'ONE' },
        ];
        const s = specs[stage];
        el.statNum.textContent = s.word ? s.word : fmt(s.to * easeOut(clamp01(within * 1.4)));
        el.statLabel.textContent = s.label;
      },
    },

    // 2 — RANKING: bars rise, leaderboard slides in, Elo counts up, slow orbit.
    {
      name: 'rank',
      start: 12,
      dur: 15,
      enter() {
        only(el, 'lead', 'sub');
        el.sub.textContent = 'RATED BY ELO · WORLD CUP WEIGHTED';
        world.dimBarsExcept(new Set([...Array(world.bars.count).keys()]), 0);
      },
      update(lt) {
        world.setField(1, lerp(0.5, 0.26, smooth(0, 0.5, lt)));
        world.setDisc(easeOut(smooth(0.05, 0.5, lt)));
        world.setBars(easeOut(smooth(0.05, 0.75, lt)), { stagger: 0.55 });
        world.setBloom(0.58);

        // camera: settle in front, then a gentle orbit
        const settle = easeInOut(smooth(0, 0.35, lt));
        const baseX = lerp(0, 0, 1);
        let px = baseX;
        let pz = lerp(78, 60, settle);
        const py = lerp(28, 16, settle);
        const orbit = Math.sin(lt * Math.PI * 1.1) * 0.22 * settle;
        [px, pz] = rotateAroundY(px, pz, 0, -4, orbit);
        world.aim(px, py, pz, 0, 8, -4);

        // reveal rows + count up Elo
        rows.forEach((r, i) => {
          const delay = 0.1 + i * 0.045;
          const rp = easeOut(smooth(delay, delay + 0.28, lt));
          r.row.style.setProperty('--on', String(rp));
          r.num.textContent = fmt(r.target * easeOut(smooth(delay, delay + 0.35, lt)));
        });
      },
    },

    // 3 — WEIGHTING: dim to the featured pair; fixture card with real odds.
    {
      name: 'weight',
      start: 27,
      dur: 8,
      enter() {
        only(el, 'fixture', 'sub');
        el.sub.textContent = 'NEUTRAL PITCH · ORDER-INDEPENDENT ODDS';
      },
      update(lt) {
        world.setField(1, 0.16);
        world.setBars(1);
        world.setDisc(0.6);
        world.dimBarsExcept(keep, easeInOut(smooth(0, 0.5, lt)));
        world.setBloom(lerp(0.58, 0.78, smooth(0.4, 1, lt)));

        // dolly toward the featured pair on the left
        const p = easeInOut(clamp01(lt));
        const px = lerp(0, featX + 6, p);
        world.aim(px, lerp(16, 11, p), lerp(60, 40, p), featX, 9, -4);

        // grow probability bars + percentages
        const gp = easeOut(smooth(0.15, 0.85, lt));
        const set = (k, v) => {
          fxEl.fills[k].style.width = `${(v * 100 * gp).toFixed(1)}%`;
          fxEl.pcts[k].textContent = `${Math.round(v * 100 * gp)}%`;
        };
        set('home', fx.homeP);
        set('draw', fx.drawP);
        set('away', fx.awayP);
      },
    },

    // 4 — CLOSE: bloom surge, wordmark re-forms, tagline + CTA.
    {
      name: 'close',
      start: 35,
      dur: 7,
      enter() {
        only(el, 'wordmark', 'cta');
        el.wordmark.classList.add('mega');
        el.kicker.classList.remove('on');
        el.ctaMark.textContent = 'NO BETTING ◆ JUST BANTRYX';
        el.ctaTag.textContent = 'Predict · Compete · Climb';
        el.ctaUrl.textContent = 'bantryx.com';
      },
      update(lt) {
        world.setField(lerp(0.16, 0.5, smooth(0, 0.4, lt)), lerp(0.16, 0.45, smooth(0, 0.5, lt)));
        world.setBars(lerp(1, 0.25, smooth(0.05, 0.45, lt)));
        world.dimBarsExcept(new Set(), 0);
        world.setDisc(lerp(0.6, 0, smooth(0, 0.4, lt)));
        // bloom surge then settle
        const surge = Math.sin(clamp01(lt * 3) * Math.PI);
        world.setBloom(0.5 + surge * 0.7 + smooth(0.5, 1, lt) * 0.15);

        const p = easeOutExpo(clamp01(lt * 1.1));
        world.aim(0, lerp(12, 10, p), lerp(50, 42, p), 0, 8, -6);

        el.wordmark.style.setProperty('--ignite', String(easeOut(smooth(0.05, 0.5, lt))));
        el.cta.style.setProperty('--on', String(easeOut(smooth(0.45, 0.95, lt))));
      },
    },
  ];

  let startT = null;
  let lastBeat = -1;
  let raf = 0;
  let running = true;

  function frame(now) {
    if (!running) return;
    if (startT === null) startT = now;
    let gt = (now - startT) / 1000;
    if (gt >= TOTAL) {
      startT = now;
      gt = 0;
      lastBeat = -1;
    }
    world.setTime(gt);

    // find active beat
    let bi = 0;
    for (let i = 0; i < beats.length; i += 1) {
      if (gt >= beats[i].start) bi = i;
    }
    const b = beats[bi];
    if (bi !== lastBeat) {
      lastBeat = bi;
      b.enter();
    }
    const lt = clamp01((gt - b.start) / b.dur);
    b.update.call(b, reduced ? 1 : lt, gt, b.dur);

    world.render();
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => world.resize());
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      startT = null; // resync clock without a time jump
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
    }
  });

  raf = requestAnimationFrame(frame);

  return {
    replay() {
      startT = null;
      lastBeat = -1;
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
