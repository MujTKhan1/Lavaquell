import * as THREE from 'three';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const range = (p, a, b) => clamp01((p - a) / (b - a));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function webgl2() {
  try {
    return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

export function createRenderer(container, { lowPower, alpha = false }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !lowPower, alpha, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.35 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.transmissionResolutionScale = lowPower ? 0.5 : 0.8;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);
  return renderer;
}

export async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('500 60px "Manrope Variable"'),
    document.fonts.load('600 60px "Manrope Variable"'),
    document.fonts.load('700 60px "Manrope Variable"'),
  ]).catch(() => {});
}

/** Studio environment: tall strip softboxes for long, clean highlights. */
export function makeEnvironment(renderer, { bright = false, studio = false } = {}) {
  const env = new THREE.Scene();
  if (studio) {
    // Product-photography studio for glass: mid-dark surround so edges read,
    // tall strip boxes for the long vertical highlights, a soft top light,
    // a back panel that rims the silhouette, and an aqua bounce from the pool.
    env.background = new THREE.Color(0x26343c);
    const add = (w, h, color, k, pos, look) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(...look);
      env.add(m);
    };
    add(1.4, 12, 0xffffff, 9, [-4.5, 2, 3], [0, 2, 0]);
    add(0.7, 12, 0xeaf6ff, 7, [4.5, 2, 2.2], [0, 2, 0]);
    add(0.3, 12, 0xffffff, 5, [-1.6, 2, 6], [0, 2, 0]);
    add(6, 6, 0xffffff, 2.2, [0, 9, 0], [0, 0, 0]);
    add(10, 7, 0xdff1f7, 1.3, [0, 2.5, -8], [0, 2, 0]);
    add(20, 3, 0x6fc6dc, 1.4, [0, -2.5, 4], [0, 0, 0]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.015).texture;
    pmrem.dispose();
    return tex;
  }
  env.background = new THREE.Color(bright ? 0x3a5566 : 0x020812);
  const panel = (w, h, color, k, pos, look) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  panel(1.2, 10, 0xffffff, 8, [-5, 2, 2.5], [0, 1.5, 0]);
  panel(0.6, 10, 0xd8efff, 6, [5, 2, 1.5], [0, 1.5, 0]);
  panel(0.35, 10, 0xffffff, 4, [-2.2, 2, 5], [0, 1.5, 0]);
  panel(8, 3, 0xffffff, bright ? 4 : 2.2, [0, 8, 0.5], [0, 0, 0]);
  panel(18, 3, bright ? 0x8fd3ea : 0x0b5a9a, bright ? 2.2 : 1.4, [0, -1.5, -7], [0, 0, 0]);
  panel(18, 2, 0x8ad0f1, bright ? 2.0 : 1.0, [0, -2.5, 7], [0, 0, 0]);
  if (bright) panel(20, 6, 0xeaf6fb, 1.6, [0, 2, -9], [0, 1, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/* Tileable animated caustic pattern (after the well-known "water turbulence"
 * shader); cheap enough to evaluate per-pixel on the platform and pool. */
export const CAUSTICS_GLSL = /* glsl */ `
  float lavCaustic(vec2 uv, float t) {
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }`;
