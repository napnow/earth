import * as THREE from 'three';
import { fbm3, makeNoise3D } from './rng.js';
import { deriveGround, posterize, Washes } from './ground.js';

/**
 * The analytic planet, ported from the game: height, slope, forest, meadow,
 * provinces and paint, all pure functions of direction on the unit sphere.
 *
 * Everything is seeded through forked streams in a fixed order, so the same
 * spec always grows the same world, and the palette is expanded into the
 * same layered painting: shore bands around the waterline, patchworked
 * grass, deep-wood floors, warm meadows, rock creeping onto cliffs,
 * wobbling snowlines, and a thin glaze of zone washes over it all.
 */

function forkSeed(rng) {
  return (rng.next() * 4294967296) >>> 0;
}

const _tanA = new THREE.Vector3();
const _tanB = new THREE.Vector3();
const _perp = new THREE.Vector3();

export class PlanetPainter {
  constructor(rng, spec, approachDir) {
    this.spec = spec;
    this.R = spec.terrain.radius;
    this.maxH = spec.terrain.maxHeight;
    this.waterR = spec.terrain.water ? this.R + spec.terrain.water.level * this.maxH : null;
    this.regions = [];
    this.features = [];
    this.craterDirs = [];
    this.siteGrounds = [];

    // Noise draw order is load-bearing: same seed, same world, forever.
    this.heightNoise = makeNoise3D(forkSeed(rng));
    this.warpNoise = makeNoise3D(forkSeed(rng));
    this.forestNoise = makeNoise3D(forkSeed(rng));
    this.meadowNoise = makeNoise3D(forkSeed(rng));
    this.regionWarpNoise = makeNoise3D(forkSeed(rng));
    const paintRng = rng.fork();
    this.tintNoise = makeNoise3D(forkSeed(paintRng));
    this.edgeNoise = makeNoise3D(forkSeed(paintRng));
    for (let i = 0; i < 7; i++) {
      this.craterDirs.push(randomUnit(rng, new THREE.Vector3()));
    }
    for (const r of spec.terrain.regions) {
      this.regions.push({
        dir: randomUnit(rng, new THREE.Vector3()),
        colorA: new THREE.Color(r.colorA),
        colorB: new THREE.Color(r.colorB),
        radius: 0.35 + r.size * 0.75,
      });
    }

    // Landforms last, so adding them never shifts the streams above.
    this.featureNoise = makeNoise3D(forkSeed(rng));
    for (const f of spec.terrain.features) {
      const dir = new THREE.Vector3();
      if (f.placement === 'center') {
        dir.copy(approachDir);
      } else if (f.placement === 'edge') {
        perpendicularTo(approachDir, rng, dir).applyAxisAngle(approachDir, rng.range(0, Math.PI * 2));
      } else {
        randomUnit(rng, dir);
      }
      const angle = f.size * Math.PI * 0.85;
      const cosEdge = Math.cos(angle);
      this.features.push({
        kind: f.kind,
        dir,
        normal: perpendicularTo(dir, rng, new THREE.Vector3()),
        cosEdge,
        invDen: 1 / Math.max(1 - cosEdge, 1e-6),
        halfW: Math.sin(Math.max(f.size, 0.08) * Math.PI * 0.12),
        strength: f.strength,
        salt: rng.range(0, 40),
      });
    }

    this.freq = 2.3 * (0.7 + spec.terrain.roughness * 0.9);
    this.octaves = 4 + Math.round(spec.terrain.roughness * 2);
    this.su = Math.max(1.5, this.maxH * 0.03);
    this.ground = deriveGround(spec);
    this.washes = new Washes(this.ground, spec.terrain.snowline);

    this.c2 = new THREE.Color();
    this.tmp = new THREE.Color();
    this.zone = { hf: 0, forest: 0, meadow: 0 };
  }

  // -- fields --------------------------------------------------------------

  /** Terrain height above the base sphere for a unit direction. */
  heightAt = (dx, dy, dz) => {
    const freq = this.freq;
    const n = fbm3(this.heightNoise, dx * freq, dy * freq, dz * freq, this.octaves);
    let h;
    switch (this.spec.terrain.style) {
      case 'mountains': {
        const ridge = this.ridged(dx * freq, dy * freq, dz * freq);
        const massif = Math.max(0, fbm3(this.warpNoise, dx * 1.6 + 13.7, dy * 1.6 - 4.1, dz * 1.6 + 7.9, 3));
        h = Math.pow(Math.max(ridge + 0.35, 0), 1.5) + massif * 0.45;
        break;
      }
      case 'islands': {
        // Broad continents from a low-frequency field, hills riding on top.
        // Biased well above the sea: worlds are mostly land, with seas and
        // lakes where the field dips — not ocean planets.
        const cont = fbm3(this.warpNoise, dx * 1.7 + 13.7, dy * 1.7 - 4.1, dz * 1.7 + 7.9, 3);
        h = cont * 0.95 + n * 0.45 + 0.3;
        break;
      }
      case 'dunes': {
        const warp = fbm3(this.warpNoise, dx * 2.2, dy * 2.2, dz * 2.2, 2);
        h = 0.3 * (0.5 + 0.5 * Math.sin(dy * 14 + warp * 2.4 + n * 3.2)) + 0.12 * n + 0.1;
        break;
      }
      case 'crater': {
        h = n * 0.18 + 0.2;
        for (const c of this.craterDirs) {
          const d = Math.acos(THREE.MathUtils.clamp(dx * c.x + dy * c.y + dz * c.z, -1, 1));
          h += Math.exp(-Math.pow((d - 0.22) / 0.06, 2)) * 0.55; // rim
          h -= Math.exp(-Math.pow(d / 0.16, 2)) * 0.5; // bowl
        }
        break;
      }
      case 'plains':
      default:
        h = (n * 0.5 + 0.5) * 0.28 + 0.05;
        break;
    }
    // Great landforms are cut into the noise, not laid on top of it, so the
    // shore bands, snowline and slope shading all follow them for free.
    if (this.features.length > 0) h += this.featureAt(dx, dy, dz);
    // Room above and below the plain noise range: mesas rise past the old
    // ceiling, basins and rifts dig below the waterline into inland seas.
    return THREE.MathUtils.clamp(h, -0.5, 1.4) * this.maxH;
  };

  /**
   * Summed landform profiles, in the same normalized units as the base
   * noise. Each feature is a spherical cap: points outside it cost one dot
   * product. `t` runs 0 at the heart to 1 at the rim, wobbled by noise so
   * nothing reads as a drawn circle.
   */
  featureAt(dx, dy, dz) {
    let sum = 0;
    for (const f of this.features) {
      const cosT = dx * f.dir.x + dy * f.dir.y + dz * f.dir.z;
      if (cosT <= f.cosEdge) continue;
      // cosT can exceed 1 by a float epsilon dead on the axis, and a
      // negative under the root would NaN the whole height field.
      let t = Math.sqrt(Math.max(0, 1 - cosT) * f.invDen);
      t = Math.max(0, t + this.featureNoise(dx * 3.2 + f.salt, dy * 3.2 - f.salt, dz * 3.2 + f.salt) * 0.09);

      let v = 0;
      switch (f.kind) {
        case 'plateau':
          v = 1 - THREE.MathUtils.smoothstep(t, 0.62, 1);
          break;
        case 'mesa':
          // Steep-walled and taller: a table standing off the plain.
          v = (1 - THREE.MathUtils.smoothstep(t, 0.72, 1)) * 1.3;
          break;
        case 'basin':
          v = -(1 - THREE.MathUtils.smoothstep(t, 0.5, 1));
          break;
        case 'caldera': {
          // Wide transitions on purpose: a wall steeper than the mesh's
          // triangles aliases into a sawtooth.
          const rim = Math.exp(-Math.pow((t - 0.78) / 0.21, 2));
          const bowl = 1 - THREE.MathUtils.smoothstep(t, 0.28, 0.8);
          v = (rim * 1.05 - bowl * 0.8) * (1 - THREE.MathUtils.smoothstep(t, 0.94, 1.06));
          break;
        }
        case 'rift':
        case 'ridge': {
          // Distance from the great circle the landform runs along; `t`
          // still windows it, so this is a segment, not a belt.
          const w = Math.abs(dx * f.normal.x + dy * f.normal.y + dz * f.normal.z);
          const win = 1 - THREE.MathUtils.smoothstep(t, 0.62, 1);
          if (win <= 0) break;
          if (f.kind === 'rift') {
            const groove = 1 - THREE.MathUtils.smoothstep(w, 0, f.halfW);
            const shoulder =
              THREE.MathUtils.smoothstep(w, f.halfW * 0.7, f.halfW * 1.4) *
              (1 - THREE.MathUtils.smoothstep(w, f.halfW * 1.4, f.halfW * 2.8));
            v = (shoulder * 0.4 - groove * 1.2) * win;
          } else {
            v = (1 - THREE.MathUtils.smoothstep(w, 0, f.halfW * 2.4)) * win;
          }
          break;
        }
      }
      sum += v * f.strength;
    }
    return sum;
  }

  ridged(x, y, z) {
    let sum = 0;
    let amp = 0.55;
    let fx = x;
    let fy = y;
    let fz = z;
    for (let i = 0; i < 4; i++) {
      sum += amp * (1 - Math.abs(this.heightNoise(fx, fy, fz)));
      fx *= 2.1;
      fy *= 2.1;
      fz *= 2.1;
      amp *= 0.48;
    }
    return sum - 0.55;
  }

  /** Approximate slope (radial height change per unit tangent distance). */
  slopeAt = (dir) => {
    const e = 0.02;
    const t1 = Math.abs(dir.y) < 0.9 ? _tanA.set(-dir.z, 0, dir.x).normalize() : _tanA.set(1, 0, 0);
    const t2 = _tanB.crossVectors(dir, t1);
    const h0 = this.heightAt(dir.x, dir.y, dir.z);
    const h1 = this.heightAt(dir.x + t1.x * e, dir.y + t1.y * e, dir.z + t1.z * e);
    const h2 = this.heightAt(dir.x + t2.x * e, dir.y + t2.y * e, dir.z + t2.z * e);
    return (Math.abs(h1 - h0) + Math.abs(h2 - h0)) / (e * this.R);
  };

  forestAt(dir) {
    return THREE.MathUtils.clamp(
      fbm3(this.forestNoise, dir.x * 3.6 + 3.1, dir.y * 3.6 - 8.7, dir.z * 3.6 + 5.3, 3) * 1.3 + 0.5,
      0,
      1,
    );
  }

  meadowAt(dir) {
    return THREE.MathUtils.clamp(
      fbm3(this.meadowNoise, dir.x * 4.4 - 11.3, dir.y * 4.4 + 5.9, dir.z * 4.4 - 2.7, 3) * 0.9 + 0.5,
      0,
      1,
    );
  }

  /** Patch noise for colour patchwork, 0..1. */
  patch(dir, scale, salt) {
    return THREE.MathUtils.clamp(
      fbm3(this.tintNoise, dir.x * scale + salt, dir.y * scale - salt, dir.z * scale + salt * 0.5, 2) * 0.8 + 0.5,
      0,
      1,
    );
  }

  /** Edge noise in [-1, 1] for wobbling lines (shore, snow). */
  edge(dir, scale, salt) {
    return fbm3(this.edgeNoise, dir.x * scale + salt, dir.y * scale + salt, dir.z * scale - salt, 2);
  }

  /** Weight of region `i` at a direction, edges warped by noise. */
  regionWeight(dir, i) {
    const rg = this.regions[i];
    const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(rg.dir), -1, 1));
    const soft = 0.16;
    if (ang > rg.radius + soft + 0.3) return 0;
    const warp = fbm3(this.regionWarpNoise, dir.x * 3.1 + 31.7, dir.y * 3.1 - 17.3, dir.z * 3.1 + 9.1, 2) * 0.3;
    return 1 - THREE.MathUtils.smoothstep(ang + warp, rg.radius - soft, rg.radius + soft);
  }

  /** The strongest region at a direction, or -1. */
  dominantRegion(dir) {
    let index = -1;
    let w = 0;
    for (let i = 0; i < this.regions.length; i++) {
      const wi = this.regionWeight(dir, i);
      if (wi > w) {
        w = wi;
        index = i;
      }
    }
    return { index, w };
  }

  // -- sites (this piece plants none, but the hooks keep the port honest) ---

  setSites(grounds) {
    this.siteGrounds = grounds;
  }

  siteMask(g, dir) {
    const cosT = dir.dot(g.dir);
    if (cosT <= g.cosEdge) return 0;
    const t = Math.sqrt(Math.max(0, 1 - cosT) * g.invDen) + this.edge(dir, 11, g.salt) * 0.1;
    return 1 - THREE.MathUtils.smoothstep(t, 0.45, 1);
  }

  clearingAt(dir) {
    let m = 0;
    for (const g of this.siteGrounds) {
      if (g.treatment === 'none') continue;
      const w = this.siteMask(g, dir);
      if (w > m) m = w;
    }
    return m;
  }

  barrenAt(dir) {
    let m = 0;
    for (const g of this.siteGrounds) {
      if (g.treatment !== 'paved' && g.treatment !== 'scorched') continue;
      const w = this.siteMask(g, dir);
      if (w > m) m = w;
    }
    return m;
  }

  // -- painting ------------------------------------------------------------

  /**
   * The colour of one terrain face. `h` is height above the base sphere; the
   * layering is the game's faceColor with the water plane as its sea level.
   */
  faceColor(out, dir, h) {
    const g = this.ground;
    const su = this.su;
    const slope = this.slopeAt(dir);
    const forest = this.forestAt(dir);
    const meadow = this.meadowAt(dir);
    const hf = h / this.maxH;
    // Height relative to the waterline; dry planets paint from the ground up.
    const y = this.waterR !== null ? this.R + h - this.waterR : h + su;

    if (this.waterR !== null && y < -0.4 * su) {
      out.copy(g.seaFloor).lerp(this.c2.copy(g.sandWet), THREE.MathUtils.clamp(y / (-6 * su) + 1, 0, 1));
    } else if (this.waterR !== null && y < 0.35 * su) {
      out.copy(g.sandWet).lerp(this.c2.copy(g.sand), THREE.MathUtils.clamp((y + 0.4 * su) / (0.75 * su), 0, 1));
    } else {
      const line = this.waterR !== null ? su * (1.25 + this.edge(dir, 14, 3.7) * 0.75) : -Infinity;
      if (y < line) {
        out.copy(g.sand);
      } else {
        // Grass patchwork, deepened by woods, warmed by meadows, dried on high.
        out.copy(g.grass).lerp(this.c2.copy(g.grassLight), this.patch(dir, 7.5, 0));
        if (forest > 0.55) out.lerp(this.c2.copy(g.grassDeep), (forest - 0.55) * 1.5);
        if (meadow > 0.55) {
          out.lerp(this.c2.copy(g.meadow), (meadow - 0.55) * 1.5);
          if (meadow > 0.72) out.lerp(this.c2.copy(g.meadowWarm), (meadow - 0.72) * 1.4);
        }
        if (hf > 0.5) out.lerp(this.c2.copy(g.dry), Math.min(0.55, (hf - 0.5) * 1.6));
      }
    }

    // Provinces: the ground drinks the region's two colours, patched.
    if (y > 0.3 * su) {
      for (let i = 0; i < this.regions.length; i++) {
        const w = this.regionWeight(dir, i);
        if (w <= 0.001) continue;
        const rg = this.regions[i];
        this.tmp.copy(rg.colorA).lerp(this.c2.copy(rg.colorB), this.patch(dir, 6, 17 + i * 11));
        out.lerp(this.tmp, w * 0.78);
      }
    }

    // Rock creeps onto steep faces and high ground.
    const rockiness =
      THREE.MathUtils.clamp((slope - 0.45) * 2.4, 0, 1) + THREE.MathUtils.clamp((hf - 0.55) * 1.4, 0, 0.7);
    if (rockiness > 0) {
      this.tmp.copy(g.rock).lerp(this.c2.copy(g.rockDark), this.patch(dir, 12, 91) * 0.85);
      out.lerp(this.tmp, Math.min(1, rockiness));
    }

    // Snowline wobbles; cliffs shed their snow.
    const snowF = this.spec.terrain.snowline + this.edge(dir, 14, 7) * 0.06;
    if (hf > snowF) {
      const cliff = THREE.MathUtils.clamp((slope - 0.45) * 2.4, 0, 1);
      this.tmp.copy(g.snow).lerp(this.c2.copy(g.snowBright), THREE.MathUtils.clamp((hf - snowF) * 4, 0, 1));
      out.lerp(this.tmp, 1 - cliff * 0.8);
    }

    this.zone.hf = hf;
    this.zone.forest = forest;
    this.zone.meadow = meadow;
    this.washes.apply(out, this.zone);

    for (const sg of this.siteGrounds) {
      if (!sg.paint) continue;
      const w = this.siteMask(sg, dir);
      if (w <= 0.001) continue;
      out.lerp(this.c2.copy(sg.paint), Math.min(1, w * sg.amount));
    }

    if (slope > 0.5) {
      out.multiplyScalar(1 - THREE.MathUtils.clamp((slope - 0.5) * 0.55, 0, 0.14));
    }

    posterize(out);
  }

  /** Brightness-preserving wash for a sprite standing at a spot. */
  spriteTint(out, dir, h) {
    this.zone.hf = h / this.maxH;
    this.zone.forest = this.forestAt(dir);
    this.zone.meadow = this.meadowAt(dir);
    this.washes.tint(out, this.zone);
    const { index, w } = this.dominantRegion(dir);
    if (index >= 0 && w > 0.001) {
      this.tmp.copy(this.regions[index].colorA);
      const l = this.tmp.r * 0.3 + this.tmp.g * 0.59 + this.tmp.b * 0.11;
      if (l > 0.02) this.tmp.multiplyScalar(1 / l);
      out.lerp(this.tmp, w * 0.4);
    }
  }
}

/** A random unit vector perpendicular to `axis`. */
export function perpendicularTo(axis, rng, target) {
  randomUnit(rng, target);
  target.addScaledVector(axis, -target.dot(axis));
  if (target.lengthSq() < 1e-8) {
    target.crossVectors(axis, Math.abs(axis.y) < 0.9 ? _perp.set(0, 1, 0) : _perp.set(1, 0, 0));
  }
  return target.normalize();
}

export function randomUnit(rng, target) {
  const z = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(Math.max(1 - z * z, 0));
  return target.set(Math.cos(a) * r, z, Math.sin(a) * r);
}
