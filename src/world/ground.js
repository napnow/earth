import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rgbOf } from './pixelart.js';

/**
 * Expands a world's five authored hexes into the whole ground vocabulary
 * the game paints with: the beach, the wet sand, the deep-forest floor, the
 * dry uplands, the snowcaps. Ported from the game's generation/palette.ts.
 */

const _hsl = { h: 0, s: 0, l: 0 };

function shifted(base, dh, ds, dl) {
  const c = base.clone();
  c.getHSL(_hsl);
  c.setHSL(
    (_hsl.h + dh + 1) % 1,
    THREE.MathUtils.clamp(_hsl.s + ds, 0, 1),
    THREE.MathUtils.clamp(_hsl.l + dl, 0.02, 0.98),
  );
  return c;
}

function towardHue(base, hue, amount, s, l) {
  const c = base.clone();
  c.getHSL(_hsl);
  let dh = hue - _hsl.h;
  if (dh > 0.5) dh -= 1;
  if (dh < -0.5) dh += 1;
  c.setHSL(
    (_hsl.h + dh * amount + 1) % 1,
    THREE.MathUtils.clamp(THREE.MathUtils.lerp(_hsl.s, s, amount), 0, 1),
    THREE.MathUtils.clamp(THREE.MathUtils.lerp(_hsl.l, l, amount), 0.02, 0.98),
  );
  return c;
}

export function deriveGround(spec) {
  const low = new THREE.Color(spec.terrain.palette.low);
  const mid = new THREE.Color(spec.terrain.palette.mid);
  const high = new THREE.Color(spec.terrain.palette.high);
  const cliff = new THREE.Color(spec.terrain.palette.cliff);
  const water = new THREE.Color(spec.terrain.water?.color ?? spec.terrain.palette.low);

  // The beach: named, or a pale, dusty cousin of the lowland colour pulled
  // toward sand yellow, so any palette gets a shore.
  const sand = spec.terrain.palette.sand
    ? new THREE.Color(spec.terrain.palette.sand)
    : towardHue(low.clone().lerp(mid, 0.3), 0.125, 0.55, 0.5, 0.62);
  const sandWet = shifted(sand, 0, 0.06, -0.14);
  const seaFloor = shifted(sandWet.clone().lerp(water, 0.3), 0, 0, -0.06);

  // Snow: named, or the high colour lifted to pale.
  high.getHSL(_hsl);
  const snow = spec.terrain.palette.snow
    ? new THREE.Color(spec.terrain.palette.snow)
    : _hsl.l > 0.72
      ? high.clone()
      : shifted(high, 0, -0.25, 0.82 - _hsl.l);
  const snowBright = shifted(snow, 0, 0, 0.08);

  // Rock keeps a lightness floor: against black space, a mountain painted
  // too dark is a hole in the world rather than a mountain.
  const rock = cliff.clone();
  rock.getHSL(_hsl);
  if (_hsl.l < 0.32) rock.setHSL(_hsl.h, _hsl.s, 0.32);

  return {
    grass: mid.clone(),
    grassLight: shifted(mid, 0.015, 0.04, 0.08),
    grassDeep: shifted(mid, -0.02, 0.05, -0.11),
    meadow: towardHue(mid.clone().lerp(high, 0.2), 0.17, 0.35, 0.55, 0.58),
    meadowWarm: towardHue(mid.clone().lerp(high, 0.3), 0.14, 0.5, 0.6, 0.6),
    dry: towardHue(mid, 0.13, 0.45, 0.45, 0.48),
    sand,
    sandWet,
    seaFloor,
    rock,
    rockDark: shifted(rock, 0, -0.03, -0.08),
    snow,
    snowBright,
  };
}

/** Quantize a colour onto the same ladder the dither pass uses. */
export function posterize(c, steps = CONFIG.world.posterizeSteps) {
  c.r = Math.round(c.r * steps) / steps;
  c.g = Math.round(c.g * steps) / steps;
  c.b = Math.round(c.b * steps) / steps;
}

// -- zone washes -----------------------------------------------------------
// A thin unifying glaze over each zone, so the patchwork reads as provinces
// rather than as noise.

function shiftWood(deep) {
  const c = deep.clone();
  c.getHSL(_hsl);
  c.setHSL(_hsl.h, THREE.MathUtils.clamp(_hsl.s + 0.08, 0, 1), THREE.MathUtils.clamp(_hsl.l - 0.04, 0.02, 0.98));
  return c;
}

function ramp(x, a, b) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Washes {
  constructor(g, snowlineF) {
    this.snowlineF = snowlineF;
    this.w = new Float64Array(5);
    this.tmp = new THREE.Color();
    this.zones = [
      { wash: g.sand.clone().lerp(g.meadow, 0.3), amt: 0.14 }, // shore
      { wash: g.meadowWarm.clone(), amt: 0.2 }, // meadow
      { wash: shiftWood(g.grassDeep), amt: 0.26 }, // wood
      { wash: g.dry.clone().lerp(g.rock, 0.4), amt: 0.2 }, // upland
      { wash: g.snow.clone(), amt: 0.28 }, // snow
    ];
  }

  weights(s) {
    const w = this.w;
    const low = 1 - ramp(s.hf, 0.03, 0.12);
    w[0] = low;
    w[1] = ramp(s.meadow, 0.56, 0.82) * (1 - ramp(s.forest, 0.5, 0.75));
    w[2] = ramp(s.forest, 0.5, 0.82);
    w[3] = ramp(s.hf, 0.42, 0.75) * (1 - ramp(s.hf, this.snowlineF - 0.08, this.snowlineF + 0.1));
    w[4] = ramp(s.hf, this.snowlineF - 0.08, this.snowlineF + 0.1);
    return w;
  }

  /** Glaze `out` toward the blended zone wash. */
  apply(out, s, scale = 1) {
    const w = this.weights(s);
    let total = 0;
    let amt = 0;
    const mix = this.tmp.setRGB(0, 0, 0);
    for (let i = 0; i < this.zones.length; i++) {
      if (w[i] <= 0.0001) continue;
      const z = this.zones[i];
      mix.r += z.wash.r * w[i];
      mix.g += z.wash.g * w[i];
      mix.b += z.wash.b * w[i];
      total += w[i];
      amt += z.amt * w[i];
    }
    if (total <= 0.0001) return;
    mix.multiplyScalar(1 / total);
    out.lerp(mix, (amt / Math.max(1, total)) * scale);
  }

  /**
   * A brightness-preserving tint for sprites standing in a zone, so a wood's
   * trees drink a little of the wood's glaze without going muddy.
   */
  tint(out, s, scale = 0.85) {
    out.setRGB(1, 1, 1);
    const w = this.weights(s);
    let total = 0;
    let amt = 0;
    const mix = this.tmp.setRGB(0, 0, 0);
    for (let i = 0; i < this.zones.length; i++) {
      if (w[i] <= 0.0001) continue;
      const z = this.zones[i];
      mix.r += z.wash.r * w[i];
      mix.g += z.wash.g * w[i];
      mix.b += z.wash.b * w[i];
      total += w[i];
      amt += z.amt * w[i];
    }
    if (total <= 0.0001) return;
    mix.multiplyScalar(1 / total);
    const l = mix.r * 0.3 + mix.g * 0.59 + mix.b * 0.11;
    if (l > 0.02) mix.multiplyScalar(1 / l);
    out.lerp(mix, (amt / Math.max(1, total)) * scale);
  }
}

// -- sprite palettes -------------------------------------------------------

/** 4-5 sibling shades of a base colour, the way species tables vary leaves. */
export function leafShades(rng, base, n = 5) {
  const out = [rgbOf(base)];
  for (let i = 1; i < n; i++) {
    out.push(rgbOf(shifted(base, rng.range(-0.018, 0.018), rng.range(-0.08, 0.08), rng.range(-0.07, 0.07))));
  }
  return out;
}

/** A pale accent for blossom flecks and pine caps, from a leaf colour. */
export function accentOf(base) {
  return rgbOf(shifted(base, 0, -0.15, 0.3));
}
