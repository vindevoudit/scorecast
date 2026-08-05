// marketing/commercial/scene.js
//
// The Three.js "world" for the Bantryx rating-engine commercial. Builds the
// arena-grid floor, the drifting nation particle-field, the Elo ranking bars,
// and the cyan bloom post-processing. Exposes granular setters the timeline
// director drives frame-by-frame — this module owns geometry + rendering, the
// timeline owns choreography. All type/copy lives in the DOM overlay so it
// stays razor-sharp and pixel-identical to the brand.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Brand palette (mirrors src/index.css tokens + marketing/lib/brand.mjs).
export const C = {
  navy0: 0x020617,
  navy1: 0x0f172a,
  cyan: 0x22d3ee,
  cyanDeep: 0x06b6d4,
  cyanSoft: 0x67e8f9,
  amber: 0xf59e0b,
  violet: 0xa855f7,
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Grid floor — cyan lines on navy, fading with distance (the app's arena grid
// rendered in 3D). Reveal uniform slides it in from black.
// ---------------------------------------------------------------------------
function makeGrid() {
  const geo = new THREE.PlaneGeometry(320, 320, 1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uReveal: { value: 0 },
      uColor: { value: new THREE.Color(C.cyan) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vWorld = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vWorld;
      uniform float uReveal;
      uniform float uTime;
      uniform vec3 uColor;
      void main() {
        vec2 coord = vWorld / 7.0;
        vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        float line = min(g.x, g.y);
        float grid = 1.0 - min(line, 1.0);
        float dist = length(vWorld);
        float fade = smoothstep(110.0, 6.0, dist);
        // a soft travelling pulse ring for life
        float pulse = 0.5 + 0.5 * sin(dist * 0.06 - uTime * 1.2);
        float a = grid * fade * uReveal * (0.2 + 0.08 * pulse);
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  return mesh;
}

// ---------------------------------------------------------------------------
// Nation particle-field — one glowing point per rated nation, drifting in a
// dome above the grid. uSpread expands from a tight core to the full field;
// per-point phase gives a scoreboard twinkle.
// ---------------------------------------------------------------------------
function makeField(count) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    // spherical-ish shell, biased above the grid
    const r = 18 + Math.pow(Math.random(), 0.6) * 46;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(lerp(-0.15, 1, Math.random())); // upper hemisphere bias
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = 6 + Math.abs(r * Math.cos(phi)) * 0.85;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 10;
    phases[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSpread: { value: 0.12 },
      uSize: { value: 2.4 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(C.cyanSoft) },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime, uSpread, uSize;
      varying float vTw;
      void main() {
        vec3 p = position * mix(0.12, 1.0, uSpread);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase * 6.2831);
        vTw = tw;
        gl_PointSize = uSize * (0.6 + 0.7 * tw) * (320.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * uOpacity * vTw);
      }
    `,
  });
  return new THREE.Points(geo, mat);
}

// ---------------------------------------------------------------------------
// Elo ranking bars — one box per displayed nation, heights ∝ normalized Elo.
// InstancedMesh; per-instance color lets us dim all-but-featured later. Bloom
// turns the bright cyan tops into the signature glow.
// ---------------------------------------------------------------------------
function makeBars(teams) {
  const n = teams.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // anchor base at y=0
  const mat = new THREE.MeshBasicMaterial({ transparent: true });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const elos = teams.map((t) => t.elo);
  const min = Math.min(...elos);
  const max = Math.max(...elos);
  const MIN_H = 2.5;
  const MAX_H = 30;
  const spacing = 3.0;
  const width = 1.7;
  const depth = 1.7;

  const meta = teams.map((t, i) => {
    const norm = (t.elo - min) / Math.max(1, max - min);
    return {
      x: (i - (n - 1) / 2) * spacing,
      targetH: MIN_H + Math.pow(norm, 0.9) * (MAX_H - MIN_H),
      width,
      depth,
      // top-3 get the brightest cyan; the rest step toward the deep tone
      baseColor: new THREE.Color(i === 0 ? C.cyanSoft : i < 3 ? C.cyan : C.cyanDeep),
      dimColor: new THREE.Color(0x0a2436),
    };
  });

  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i += 1) {
    dummy.position.set(meta[i].x, 0, 0);
    dummy.scale.set(width, 0.001, depth);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, meta[i].baseColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;

  return { mesh, meta, dummy, count: n, spanX: ((n - 1) / 2) * spacing };
}

export function createWorld(canvas, data) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.navy0);
  scene.fog = new THREE.FogExp2(C.navy0, 0.0075);

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(0, 10, 60);

  const grid = makeGrid();
  scene.add(grid);

  const field = makeField(Math.min(data.nations || 333, 380));
  scene.add(field);

  const barData = (data.topTeams || []).slice(0, 14);
  const bars = makeBars(barData);
  bars.mesh.position.z = -4;
  scene.add(bars.mesh);

  // A faint ground reflection glow disc under the bars for grounding.
  const discGeo = new THREE.CircleGeometry(bars.spanX + 8, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: C.cyanDeep,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0.02, -4);
  scene.add(disc);

  // Post-processing: cyan bloom is what sells the brand.
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55, // strength
    0.55, // radius
    0.42, // threshold — only the brightest cores bloom
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const world = {
    THREE,
    renderer,
    scene,
    camera,
    composer,
    bloom,
    grid,
    field,
    bars,
    disc,
    barData,

    setTime(t) {
      grid.material.uniforms.uTime.value = t;
      field.material.uniforms.uTime.value = t;
    },

    setGridReveal(v) {
      grid.material.uniforms.uReveal.value = clamp01(v);
    },

    setField(spread, opacity) {
      field.material.uniforms.uSpread.value = clamp01(spread);
      field.material.uniforms.uOpacity.value = clamp01(opacity);
    },

    setDisc(opacity) {
      discMat.opacity = clamp01(opacity) * 0.5;
    },

    // progress: overall 0..1; bars rise left→right with a per-bar stagger.
    setBars(progress, { stagger = 0.5 } = {}) {
      const n = bars.count;
      for (let i = 0; i < n; i += 1) {
        const delay = (i / Math.max(1, n - 1)) * stagger;
        const local = clamp01((progress - delay) / (1 - stagger + 1e-3));
        const eased = 1 - Math.pow(1 - local, 3);
        const h = Math.max(0.001, bars.meta[i].targetH * eased);
        bars.dummy.position.set(bars.meta[i].x, 0, 0);
        bars.dummy.scale.set(bars.meta[i].width, h, bars.meta[i].depth);
        bars.dummy.updateMatrix();
        bars.mesh.setMatrixAt(i, bars.dummy.matrix);
      }
      bars.mesh.instanceMatrix.needsUpdate = true;
    },

    // Fade every bar except those in keepSet toward navy (t: 0 none dimmed → 1 fully).
    dimBarsExcept(keepSet, t) {
      const amt = clamp01(t);
      for (let i = 0; i < bars.count; i += 1) {
        const keep = keepSet.has(i);
        const col = bars.meta[i].baseColor.clone();
        if (!keep) col.lerp(bars.meta[i].dimColor, amt);
        bars.mesh.setColorAt(i, col);
      }
      bars.mesh.instanceColor.needsUpdate = true;
    },

    setBarsOpacity(o) {
      bars.mesh.material.opacity = clamp01(o);
    },

    setBloom(strength) {
      bloom.strength = strength;
    },

    // camera helper: position + look target with a subtle roll-free aim.
    aim(px, py, pz, tx, ty, tz) {
      camera.position.set(px, py, pz);
      camera.lookAt(tx, ty, tz);
    },

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    },

    render() {
      composer.render();
    },
  };

  // sensible initial state (pre-play)
  world.setGridReveal(0);
  world.setField(0.12, 0);
  world.setBars(0);
  world.setBarsOpacity(1);
  world.setDisc(0);

  return world;
}
