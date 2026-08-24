import * as THREE from 'three';
import { hash2 } from './rng.js';

/**
 * The game's pixel-sprite painters, ported whole: trees, bushes, mushrooms,
 * flowers and grass are hand-set pixels on a small canvas, uploaded once
 * with nearest filtering. Every colour arrives from the WorldSpec, so a
 * world's forests are made of that world's own palette.
 */

export function rgbOf(color) {
  return [
    Math.round(THREE.MathUtils.clamp(color.r, 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(color.g, 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(color.b, 0, 1) * 255),
  ];
}

export class Painter {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.img = new ImageData(w, h);
    this.data = this.img.data;
  }

  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }

  filled(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.data[(y * this.w + x) * 4 + 3] > 0;
  }

  toSprite() {
    const ctx = this.canvas.getContext('2d');
    ctx.putImageData(this.img, 0, 0);
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, width: this.w, height: this.h };
  }
}

/** Inside any blob, with a hash-jittered edge so canopies never read as circles. */
export function inBlobs(blobs, x, y, salt, jitter = 0.22, sx = 1) {
  for (const b of blobs) {
    const dx = (x - b.cx) / sx;
    const dy = y - b.cy;
    const edge = b.r * (1 - jitter / 2 + hash2(x + salt, y - salt) * jitter);
    if (dx * dx + dy * dy < edge * edge) return true;
  }
  return false;
}

// -- trees -----------------------------------------------------------------

function leafOf(rng, pal) {
  return rng.pick(pal.leaf);
}

export function makeTreeSprite(rng, shape, pal) {
  if (shape === 'pine') return makePine(rng, pal);
  if (shape === 'willow') return makeWillow(rng, pal);
  return makeBlobTree(rng, pal);
}

function canopySpan(blobs) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const b of blobs) {
    top = Math.min(top, b.cy - b.r);
    bottom = Math.max(bottom, b.cy + b.r);
  }
  return { top, bottom };
}

function paintCanopy(p, blobs, pal, leaf, salt, sx) {
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!inBlobs(blobs, x, y, salt, 0.22, sx)) continue;
      const fleck = pal.accent && hash2(x + salt * 5, y - salt * 3) < (pal.accentChance ?? 0);
      p.set(x, y, fleck ? pal.accent : leaf);
    }
  }
}

function fitBlob(p, cx, cy, r, sx) {
  const rMax = Math.min((cx - 1) / (1.12 * sx), (p.w - 2 - cx) / (1.12 * sx), (cy - 1) / 1.12);
  return { cx, cy, r: Math.min(r, rMax) };
}

function makeBlobTree(rng, pal) {
  const w = 48;
  const h = 64;
  const p = new Painter(w, h);
  const salt = rng.int(0, 10000);

  const sx = rng.range(0.85, 1.25);
  const crownY = rng.range(17, 23);
  const spread = rng.range(6.5, 10);
  const blobs = [];
  const n = rng.int(6, 11);
  for (let i = 0; i < n; i++) {
    blobs.push(fitBlob(p, w / 2 + rng.range(-spread, spread), crownY + rng.range(-6, 6), rng.range(7, 12), sx));
  }
  const { bottom: canopyBottom } = canopySpan(blobs);
  const leaf = leafOf(rng, pal);

  for (const s of [-1, 1]) {
    if (rng.chance(0.3)) continue;
    const len = rng.int(5, 10);
    const slope = rng.range(0.4, 0.8);
    for (let i = 0; i < len; i++) {
      p.set(w / 2 + s * i * slope, canopyBottom - 2 - i, pal.trunk);
    }
  }

  paintCanopy(p, blobs, pal, leaf, salt, sx);

  const lean = rng.range(-0.07, 0.07);
  const trunkTop = Math.round(canopyBottom - 4);
  for (let y = trunkTop; y < h; y++) {
    const cx = w / 2 + (y - canopyBottom) * lean;
    const t = (y - trunkTop) / Math.max(1, h - 1 - trunkTop);
    p.set(cx - 1, y, pal.trunk);
    p.set(cx, y, pal.trunk);
    p.set(cx + 1, y, pal.trunk);
    if (t > 0.55) p.set(cx - 2, y, pal.trunk);
    if (t > 0.9) {
      p.set(cx - 3, y, pal.trunk);
      p.set(cx + 2, y, pal.trunk);
    }
  }
  return p.toSprite();
}

function makeWillow(rng, pal) {
  const w = 52;
  const h = 68;
  const p = new Painter(w, h);
  const salt = rng.int(0, 10000);

  const sx = rng.range(1.1, 1.35);
  const blobs = [];
  const n = rng.int(8, 12);
  for (let i = 0; i < n; i++) {
    blobs.push(fitBlob(p, w / 2 + rng.range(-10, 10), 15 + rng.range(-5, 5), rng.range(6.5, 10), sx));
  }
  const leaf = leafOf(rng, pal);
  paintCanopy(p, blobs, pal, leaf, salt, sx);
  const { bottom: canopyBottom } = canopySpan(blobs);

  for (let x = 3; x < w - 3; x++) {
    if (hash2(x + salt, salt) > 0.62) continue;
    let yTop = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (p.filled(x, y)) {
        yTop = y;
        break;
      }
    }
    if (yTop < 0) continue;
    const mid = 1 - Math.abs(x - w / 2) / (w / 2);
    const len = Math.round((6 + hash2(x * 3 + salt, x - salt) * 16) * (0.45 + mid * 0.8));
    const drift = (hash2(x + salt * 5, salt * 3) - 0.5) * 0.22;
    for (let j = 1; j <= len; j++) p.set(x + j * drift, yTop + j, leaf);
  }

  const trunkTop = Math.round(canopyBottom - 3);
  for (let y = trunkTop; y < h; y++) {
    const t = (y - trunkTop) / Math.max(1, h - 1 - trunkTop);
    const cx = w / 2 + Math.sin((y - trunkTop) * 0.2 + salt) * 1.1;
    p.set(cx - 1, y, pal.trunk);
    p.set(cx, y, pal.trunk);
    p.set(cx + 1, y, pal.trunk);
    if (t > 0.7) {
      p.set(cx - 2, y, pal.trunk);
      p.set(cx + 2, y, pal.trunk);
    }
  }
  return p.toSprite();
}

function makePine(rng, pal) {
  const w = 30;
  const h = 56;
  const p = new Painter(w, h);
  const leaf = leafOf(rng, pal);
  const salt = rng.int(0, 10000);
  const apex = 2;
  const base = rng.int(44, 48);
  const maxHw = rng.range(9.5, 13);
  const tierH = rng.int(9, 13);

  for (let y = apex; y <= base; y++) {
    const f = (y - apex) / (base - apex);
    let hw = maxHw * f;
    const tier = (y - apex) % tierH;
    if (tier < 3) hw *= 0.55 + tier * 0.15;
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - w / 2);
      const edge = hw * (0.9 + hash2(x + salt, y + salt) * 0.2);
      if (dx > edge) continue;
      const fleck = pal.accent && hash2(x + salt * 7, y * 3 - salt) < (pal.accentChance ?? 0);
      p.set(x, y, fleck ? pal.accent : leaf);
    }
  }
  p.set(w / 2, apex - 1, leaf);
  p.set(w / 2, apex - 2, leaf);
  for (let y = base; y < h; y++) {
    p.set(w / 2 - 1, y, pal.trunk);
    p.set(w / 2, y, pal.trunk);
    if ((y - base) / Math.max(1, h - 1 - base) > 0.6) {
      p.set(w / 2 + 1, y, pal.trunk);
    }
  }
  return p.toSprite();
}

// -- undergrowth -----------------------------------------------------------

export function makeBushSprite(rng, leaves, berry) {
  const w = 28;
  const h = 18;
  const p = new Painter(w, h);
  const salt = rng.int(0, 10000);
  const sx = rng.range(1.0, 1.4);
  const blobs = [];
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const cx = w / 2 + rng.range(-8, 8);
    const cy = h - 6 + rng.range(-3, 2);
    const r = Math.min(rng.range(4, 7), (cx - 1) / (1.12 * sx), (w - 2 - cx) / (1.12 * sx), (cy - 1) / 1.12);
    blobs.push({ cx, cy, r });
  }
  const fruit = berry && rng.chance(0.4) ? berry : null;
  const leaf = rng.pick(leaves);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inBlobs(blobs, x, y, salt, 0.22, sx)) continue;
      const dot = fruit && y < h - 3 && hash2(x * 7 + salt, y * 3 - salt) < 0.05;
      p.set(x, y, dot ? fruit : leaf);
    }
  }
  return p.toSprite();
}

export function makeMushroomSprite(rng, cap, stem, fleck) {
  const w = 14;
  const h = 10;
  const p = new Painter(w, h);
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const cx = 2 + Math.round(((i + 0.5) * (w - 4)) / n) + rng.int(-1, 2);
    const capHw = rng.int(2, 4);
    const capBase = h - rng.int(4, 7);
    for (let y = capBase; y < h - 1; y++) {
      p.set(cx, y, stem);
      if (capHw > 2) p.set(cx - 1, y, stem);
    }
    const capH = 3;
    for (let dy = 0; dy < capH; dy++) {
      const rw = Math.max(1, Math.round(capHw * Math.sqrt((dy + 0.6) / capH)));
      for (let dx = -rw; dx <= rw; dx++) {
        const flecked = (dx * 3 + dy * 7 + cx * 5) % 7 === 0;
        p.set(cx + dx, capBase - capH + dy, flecked ? fleck : cap);
      }
    }
  }
  return p.toSprite();
}

export function makeFlowerSprite(rng, head, center, stem) {
  const w = 10;
  const h = 14;
  const p = new Painter(w, h);
  const cx = 4 + rng.int(0, 2);
  const top = 3 + rng.int(0, 2);
  for (let y = top + 2; y < h; y++) p.set(cx + (y % 3 === 0 ? 1 : 0) - (y % 5 === 0 ? 1 : 0), y, stem);
  p.set(cx, top, head);
  p.set(cx - 1, top + 1, head);
  p.set(cx + 1, top + 1, head);
  p.set(cx, top + 2, head);
  p.set(cx - 2, top + 1, head);
  p.set(cx + 2, top + 1, head);
  p.set(cx, top + 1, center);
  return p.toSprite();
}

export function makeGrassSprite(rng, palette) {
  const w = 12;
  const h = 8;
  const p = new Painter(w, h);
  const c = rng.pick(palette);
  const clumps = rng.int(1, 2);
  for (let b = 0; b < clumps; b++) {
    const x0 = 3 + rng.int(0, w - 7);
    const tall = rng.int(3, h - 1);
    for (let i = 0; i < tall; i++) {
      const y = h - 1 - i;
      const half = Math.max(1, Math.floor((1 - i / tall) * 2.2));
      for (let dx = -half; dx <= half; dx++) p.set(x0 + dx, y, c);
      if (i < tall * 0.5) p.set(x0 + half + 1, y, c);
    }
  }
  return p.toSprite();
}
