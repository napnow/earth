/**
 * Deterministic PRNG and value noise, ported verbatim from the game
 * (take-me-there/src/world/generation/rng.ts). Everything downstream —
 * terrain, forests, the placement of a single mushroom — hangs off these,
 * so they have to behave identically or the worlds come out different.
 */
export class Rng {
  constructor(seed) {
    this.state = seed >>> 0 || 1;
  }

  /** [0, 1) */
  next() {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p) {
    return this.next() < p;
  }

  /**
   * A child stream. Draw order of forks is load-bearing: every subsystem
   * gets its own stream so adding draws to one can never shift what another
   * generates for the same seed.
   */
  fork() {
    return new Rng((this.next() * 4294967296) >>> 0);
  }
}

/** Stateless 2D hash in [0, 1) — pixel jitter that never consumes a stream. */
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seeded 3D value noise in [-1, 1] — the terrain field for sphere planets. */
export function makeNoise3D(seed) {
  const offset = (seed % 1000) * 13.73;

  const hash = (ix, iy, iz) => {
    const s = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + offset) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const c000 = hash(ix, iy, iz);
    const c100 = hash(ix + 1, iy, iz);
    const c010 = hash(ix, iy + 1, iz);
    const c110 = hash(ix + 1, iy + 1, iz);
    const c001 = hash(ix, iy, iz + 1);
    const c101 = hash(ix + 1, iy, iz + 1);
    const c011 = hash(ix, iy + 1, iz + 1);
    const c111 = hash(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
  };
}

export function fbm3(noise, x, y, z, octaves = 4, lacunarity = 2.05, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(fx, fy, fz);
    fx *= lacunarity;
    fy *= lacunarity;
    fz *= lacunarity;
    amp *= gain;
  }
  return sum;
}
