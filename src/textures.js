import * as THREE from 'three';

/*
 * Procedural textures for the hero bottles.
 *
 * The printed artwork is recomposed from Lavaquell's own logo files
 * (mark + wordmark, recoloured) and the copy visible on the real bottles
 * ("Quell the thirst, keep it clean", "BOTTLED DRINKING WATER", "1000 mL",
 * "Sparkling", "SAVE THIS BOTTLE"). It is a faithful approximation, not the
 * print-ready dieline; see README for what is needed for exact fidelity.
 */

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

function tint(img, color) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function canvasTexture(canvas, renderer, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * Body print. The canvas spans the full circumference horizontally and the
 * label band [y0, y1] vertically; artwork is centred at u = 0.5 (front).
 */
export async function makeLabelTexture(renderer, { variant, radius, y0, y1, scale = 1 }) {
  const [markImg, wordImg] = await Promise.all([
    loadImage(`${import.meta.env.BASE_URL}assets/mark-white.png`),
    loadImage(`${import.meta.env.BASE_URL}assets/wordmark-white.png`),
  ]);
  const W = Math.round(4096 * scale);
  const pxPerU = W / (2 * Math.PI * radius); // horizontal px per world unit
  const H = Math.round((y1 - y0) * pxPerU);
  const pxPerV = H / (y1 - y0);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const yToPx = (y) => (y1 - y) * pxPerV;
  const cx = W / 2;

  const ink = variant === 'sparkling' ? '#2f6a35' : '#1c4f9e';
  const mark = tint(markImg, ink);
  const word = tint(wordImg, ink);

  // Mark (triangle with swoosh)
  const markTop = 1.36, markBottom = 1.0;
  const mh = (markTop - markBottom) * pxPerV;
  const mw = mh * (mark.width / mark.height);
  g.drawImage(mark, cx - mw / 2, yToPx(markTop), mw, mh);

  // Wordmark
  const wTop = 0.915, wBottom = 0.795;
  const wh = (wTop - wBottom) * pxPerV;
  const ww = wh * (word.width / word.height);
  g.drawImage(word, cx - ww / 2, yToPx(wTop), ww, wh);

  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = (weight, sizeU) => `${weight} ${Math.round(sizeU * pxPerV)}px "Manrope Variable", "Manrope", system-ui, sans-serif`;

  if (variant === 'sparkling') {
    g.font = font(650, 0.058);
    g.fillText('Sparkling', cx, yToPx(0.69));
    // delicate line-art bubbles, as printed on the sparkling bottle
    g.strokeStyle = 'rgba(47,106,53,0.55)';
    g.lineWidth = Math.max(1.5, 0.0045 * pxPerV);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const x = cx + (rnd() - 0.5) * 2.1 * pxPerU * 0.55;
      const y = yToPx(0.36 + rnd() * 0.22);
      const r = (0.008 + rnd() * 0.022) * pxPerV;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    for (let x = -0.62; x <= 0.62; x += 0.01) {
      const px = cx + x * pxPerU;
      const py = yToPx(0.33 + Math.sin(x * 18) * 0.012);
      x === -0.62 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.stroke();
  } else {
    g.font = font(600, 0.046);
    g.fillText('Quell the thirst, keep it clean', cx, yToPx(0.69));
    g.font = font(700, 0.036);
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(0.004 * pxPerV)}px`;
    g.fillText('BOTTLED DRINKING WATER', cx, yToPx(0.55));
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = font(600, 0.04);
    g.fillText('1000 mL', cx, yToPx(0.28));
  }
  return canvasTexture(c, renderer);
}

/** "SAVE THIS BOTTLE" shoulder band on the sparkling bottle. */
export function makeNeckBandTexture(renderer, { radius, y0, y1 }) {
  const W = 2048;
  const pxPerU = W / (2 * Math.PI * radius);
  const H = Math.round((y1 - y0) * pxPerU);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const cx = W / 2;
  const bw = W * 0.36;
  const skew = H * 0.18;
  g.fillStyle = '#2f6a35';
  g.beginPath();
  g.moveTo(cx - bw / 2 + skew, H * 0.08);
  g.lineTo(cx + bw / 2, H * 0.08);
  g.lineTo(cx + bw / 2 - skew, H * 0.92);
  g.lineTo(cx - bw / 2, H * 0.92);
  g.closePath();
  g.fill();
  g.fillStyle = '#f4f7ef';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(H * 0.27)}px "Manrope Variable", "Manrope", system-ui, sans-serif`;
  g.fillText('SAVE', cx, H * 0.33);
  g.fillText('THIS BOTTLE', cx, H * 0.67);
  return canvasTexture(c, renderer);
}

/**
 * Condensation: a height field of droplets converted to a tangent-space
 * normal map. Denser towards the base, sparse near the shoulder.
 */
export function makeDropletNormalMap(renderer, size = 1024, count = 2600) {
  const h = new Float32Array(size * size);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const v = rnd();
    // canvas row 0 = top of bottle; keep droplets mostly on lower body
    const yN = Math.pow(v, 0.55);
    if (rnd() > 0.15 + 0.85 * yN) continue;
    const x = rnd() * size;
    const y = yN * size;
    const big = rnd() < 0.08;
    const r = big ? 5 + rnd() * 6 : 1.2 + rnd() * 3.2;
    const sy = big ? 1.25 : 1; // larger beads sag slightly
    const x0 = Math.floor(x - r), x1 = Math.ceil(x + r);
    const y0 = Math.floor(y - r * sy), y1 = Math.ceil(y + r * sy);
    for (let yy = y0; yy <= y1; yy++) {
      if (yy < 0 || yy >= size) continue;
      for (let xx = x0; xx <= x1; xx++) {
        const wx = ((xx % size) + size) % size;
        const dx = (xx - x) / r, dy = (yy - y) / (r * sy);
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const val = Math.sqrt(1 - d2) * r * 0.5;
        const idx = yy * size + wx;
        if (val > h[idx]) h[idx] = val;
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[Math.max(0, y - 1) * size + x];
      const b = h[Math.min(size - 1, y + 1) * size + x];
      let nx = (l - r) * 0.9, ny = (b - u) * 0.9, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c, renderer, { srgb: false });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Knurled ridges for the aluminium screw cap (bump map). */
export function makeKnurlMap(renderer) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 1024, 256);
  const ribs = 140;
  const band = (top, bottom) => {
    for (let i = 0; i < ribs; i++) {
      const x = (i / ribs) * 1024;
      const grd = g.createLinearGradient(x, 0, x + 1024 / ribs, 0);
      grd.addColorStop(0, '#5a5a5a');
      grd.addColorStop(0.5, '#d8d8d8');
      grd.addColorStop(1, '#5a5a5a');
      g.fillStyle = grd;
      g.fillRect(x, top, 1024 / ribs, bottom - top);
    }
  };
  // rows 0-32 land on the top disc; the side spans the rest (see cap profile)
  band(40, 96); // knurled grip band
  band(196, 226); // tamper-ring perforation band
  g.fillStyle = '#4a4a4a';
  g.fillRect(0, 178, 1024, 7);
  return canvasTexture(c, renderer, { srgb: false });
}

/**
 * Vertical print used on the LAVAQUELL aluminium cans and bottle (as in the
 * product photos): wordmark running bottom-to-top, tagline beside it, and the
 * variety + capacity set horizontally near the base. Artwork centred at u = 0.5.
 */
export async function makeVerticalPrint(renderer, { radius, height, ink, variety, capacity, scale = 1, background = '#f5f7f8' }) {
  const wordImg = await loadImage(`${import.meta.env.BASE_URL}assets/wordmark-white.png`);
  const W = Math.round(2048 * scale);
  const pxPerU = W / (2 * Math.PI * radius);
  const H = Math.round(height * pxPerU);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = background;
  g.fillRect(0, 0, W, H);
  const cx = W / 2;
  const word = tint(wordImg, ink);

  // wordmark, rotated to read bottom-to-top
  const len = H * 0.66;
  const thick = len * (word.height / word.width);
  const wx = cx - thick * 0.35;
  g.save();
  g.translate(wx, H * 0.1 + len);
  g.rotate(-Math.PI / 2);
  g.drawImage(word, 0, -thick / 2, len, thick);
  g.restore();

  // tagline beside it
  g.save();
  g.fillStyle = ink;
  g.translate(wx + thick * 0.95, H * 0.1 + len);
  g.rotate(-Math.PI / 2);
  g.textBaseline = 'middle';
  g.font = `500 ${Math.round(thick * 0.24)}px "Manrope Variable", "Manrope", system-ui, sans-serif`;
  g.fillText('Quell the thirst, Keep it clean', 0, 0);
  g.restore();

  // variety + capacity
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = Math.round(H * 0.026);
  g.font = `700 ${fs}px "Manrope Variable", "Manrope", system-ui, sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(fs * 0.12)}px`;
  g.fillText(variety, cx, H * 0.84);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.font = `500 ${Math.round(fs * 0.95)}px "Manrope Variable", "Manrope", system-ui, sans-serif`;
  g.fillText(capacity, cx, H * 0.84 + fs * 1.5);
  return canvasTexture(c, renderer);
}
