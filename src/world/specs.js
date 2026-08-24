import * as THREE from 'three';
import { Rng } from './rng.js';

/**
 * Worlds, made up on the spot.
 *
 * The game has a language model dream its WorldSpecs; this makes them from a
 * seed instead, in exactly the same JSON shape, so the builder cannot tell
 * the difference. `makeWorld(n)` is pure — the same n is always the same
 * world — which is what lets the piece run forever and still be recordable.
 *
 * The whole job here is to be random without being ugly. Rolling five hex
 * codes independently gives you mud. Everything below is instead derived
 * from ONE root hue and a handful of relationships that hold at any hue:
 * the sea is dark and saturated, the land is lighter and a little way round
 * the wheel, the cliffs are nearly grey, the shore is warm, the woods are
 * darker than the grass they stand in.
 */

/** Every world is built on the same sphere — see WorldCycle for why. */
export const RADIUS = 900;

const _c = new THREE.Color();

/** Author in sRGB HSL, emit the hex string the spec format wants. */
function hex(h, s, l) {
  _c.setHSL(
    ((h % 1) + 1) % 1,
    THREE.MathUtils.clamp(s, 0, 1),
    THREE.MathUtils.clamp(l, 0.02, 0.98),
    THREE.SRGBColorSpace,
  );
  return '#' + _c.getHexString(THREE.SRGBColorSpace);
}

/**
 * 'crater' is deliberately absent. Its rim-and-bowl pairs are donuts, and a
 * planet covered in donuts reads as a planet full of holes.
 */
/**
 * 'crater' makes donuts and 'dunes' makes latitude stripes — neither reads
 * as a planet with land and sea on it from out here. These two do.
 */
const STYLES = [
  'islands', 'islands', 'islands', 'islands', 'islands', 'islands', 'islands',
  'mountains', 'mountains', 'mountains',
];

/**
 * Waterlines, per style's own height distribution. These are the single
 * most important numbers in this file: set them low and the world is one
 * unbroken slab of grass with a puddle on it, and no amount of good colour
 * saves it. A world wants a real sea.
 */
const WATER = {
  islands: [0.26, 0.33],
  mountains: [0.19, 0.27],
};

const RELIEF_BY_STYLE = {
  islands: [118, 152],
  mountains: [150, 192],
};

/**
 * 'mesa' is absent: it is the tall one, and a flat top standing above the
 * snowline paints as one big white disc — a bald patch, not a mountain.
 * Ridges and rifts have no flat top to catch it.
 */
const LANDFORMS = ['ridge', 'ridge', 'rift', 'rift', 'basin', 'plateau'];
const PLACEMENTS = ['center', 'random', 'random', 'edge'];

const ADJECTIVES = [
  'Aurora', 'Ember', 'Orchid', 'Amber', 'Glass', 'Hollow', 'Quiet', 'Salt',
  'Lantern', 'Cinder', 'Verdant', 'Drowned', 'Gilded', 'First', 'Long',
  'Pale', 'Thistle', 'Marrow', 'Sable', 'Coral', 'Vellum', 'Tessera',
];
const NOUNS = [
  'Isles', 'Reach', 'Deep', 'Steppe', 'Winter', 'Shelf', 'Basin', 'Coast',
  'Meridian', 'Terraces', 'Shallows', 'Fields', 'Expanse', 'Crown', 'Wake',
  'Hollows', 'Bight', 'Verge', 'Marches', 'Strand',
];

/**
 * The nth world. Deterministic: the same n always grows the same planet.
 */
export function makeWorld(n) {
  const r = new Rng((Math.imul(n | 0, 0x9e3779b1) ^ 0x5f356495) >>> 0);

  // -- the root hue, and where the land sits relative to the sea ----------
  const seaH = r.next();
  const away = r.chance(0.3) ? r.range(0.22, 0.42) : r.range(0.05, 0.20);
  const landH = seaH + away * (r.chance(0.5) ? 1 : -1);

  const seaS = r.range(0.46, 0.78);
  const seaL = r.range(0.17, 0.27);

  // A cold world takes a pale shore instead of a warm one.
  const cold = r.chance(0.28);
  const sand = cold
    ? hex(seaH + r.range(-0.04, 0.04), r.range(0.06, 0.18), r.range(0.72, 0.84))
    : hex(r.range(0.07, 0.15), r.range(0.32, 0.55), r.range(0.62, 0.76));

  // Land is held well below full chroma. A saturated `mid` covers most of
  // the disc and flattens everything else into it.
  const landS = r.range(0.20, 0.40);
  const palette = {
    low: hex(landH + r.range(-0.03, 0.03), landS + r.range(0.04, 0.14), r.range(0.17, 0.26)),
    mid: hex(landH, landS, r.range(0.34, 0.46)),
    high: hex(landH + r.range(-0.06, 0.06), landS * r.range(0.45, 0.75), r.range(0.58, 0.72)),
    // Cliffs are nearly grey, and opposite the sea: rock should never read
    // as one more shade of the water.
    cliff: hex(seaH + 0.5 + r.range(-0.12, 0.12), r.range(0.05, 0.20), r.range(0.25, 0.38)),
    sand,
    snow: hex(seaH + r.range(-0.06, 0.06), r.range(0.03, 0.13), r.range(0.87, 0.96)),
  };

  const style = r.pick(STYLES);
  const [wLo, wHi] = WATER[style];
  const [hLo, hHi] = RELIEF_BY_STYLE[style];

  // -- provinces: two moods laid across the ground -----------------------
  const regions = [];
  for (let i = 0; i < 2; i++) {
    const rh = landH + r.range(0.24, 0.62) * (r.chance(0.5) ? 1 : -1);
    const rs = r.range(0.22, 0.46);
    const rl = r.range(0.33, 0.50);
    regions.push({
      colorA: hex(rh, rs, rl),
      colorB: hex(rh + r.range(0.02, 0.07), rs * 1.12, rl + r.range(0.05, 0.12)),
      size: r.range(0.22, 0.48),
    });
  }

  // -- great landforms ---------------------------------------------------
  const features = [];
  const nFeatures = r.int(2, 3);
  for (let i = 0; i < nFeatures; i++) {
    features.push({
      kind: r.pick(LANDFORMS),
      placement: r.pick(PLACEMENTS),
      size: r.range(0.13, 0.38),
      // Tamed on purpose: at this distance a strong landform stops reading
      // as terrain and starts reading as a dent.
      strength: r.range(0.38, 0.80),
    });
  }

  // -- what grows and what stands ----------------------------------------
  // Most forests are a darker shade of the ground they stand in — a wood
  // lighter than its grass reads as measles. Some are in blossom instead,
  // and those are the ones worth remembering: a pale hue well away from the
  // land's, on the same dark trunks.
  const blossom = r.chance(0.3);
  const leaf = blossom
    ? hex(landH + r.range(0.34, 0.66), r.range(0.34, 0.56), r.range(0.56, 0.72))
    : hex(landH + r.range(-0.04, 0.04), r.range(0.30, 0.50), r.range(0.22, 0.31));

  const scatter = [
    {
      kind: 'tree',
      count: r.int(850, 1200),
      minScale: r.range(1.9, 2.3),
      maxScale: r.range(3.8, 4.6),
      primary: leaf,
      secondary: hex(r.range(0.05, 0.11), r.range(0.28, 0.45), r.range(0.10, 0.18)),
    },
    {
      kind: 'grass',
      count: r.int(900, 1500),
      minScale: r.range(0.8, 1.0),
      maxScale: r.range(1.7, 2.2),
      primary: hex(landH + r.range(-0.03, 0.03), r.range(0.28, 0.50), r.range(0.30, 0.42)),
      secondary: hex(landH, 0.3, 0.35),
    },
    {
      kind: 'rock',
      count: r.int(360, 560),
      minScale: r.range(1.1, 1.4),
      maxScale: r.range(4.0, 5.2),
      primary: hex(seaH + 0.5 + r.range(-0.1, 0.1), r.range(0.05, 0.18), r.range(0.24, 0.36)),
      secondary: hex(seaH + 0.5, r.range(0.05, 0.15), r.range(0.16, 0.24)),
    },
  ];
  if (r.chance(0.45)) {
    const gh = landH + 0.5 + r.range(-0.12, 0.12);
    scatter.push({
      kind: 'crystal',
      count: r.int(220, 360),
      minScale: r.range(1.3, 1.6),
      maxScale: r.range(4.2, 5.4),
      primary: hex(gh, r.range(0.45, 0.75), r.range(0.62, 0.78)),
      secondary: palette.cliff,
      emissive: true,
    });
  }
  if (r.chance(0.3)) {
    scatter.push({
      kind: 'mushroom',
      count: r.int(450, 750),
      minScale: r.range(1.5, 1.9),
      maxScale: r.range(3.4, 4.2),
      primary: hex(landH + 0.42 + r.range(-0.1, 0.1), r.range(0.40, 0.62), r.range(0.55, 0.70)),
      secondary: hex(landH, 0.10, 0.86),
    });
  }

  // -- civilization --------------------------------------------------------
  // Some worlds are inhabited. Nobody planned this; it is just what a
  // habitable world eventually does. The lights only show on the night
  // side, so most of the time you cannot tell — and that is the point.
  const civilization = r.chance(0.34)
    ? { settlements: r.int(2, 5) }
    : null;

  return {
    name: `The ${r.pick(ADJECTIVES)} ${r.pick(NOUNS)}`,
    seed: (Math.imul(n + 1, 0x27d4eb2d) ^ 0x165667b1) >>> 0,
    civilization,
    ambience: {
      sunColor: hex(seaH + 0.5, r.range(0.04, 0.14), r.range(0.90, 0.97)),
      sunIntensity: 1.5,
    },
    terrain: {
      style,
      radius: RADIUS,
      maxHeight: r.range(hLo, hHi),
      roughness: r.range(0.46, 0.86),
      palette,
      // Low enough that most worlds get some white on the high ground —
      // it is the cheapest contrast a planet has.
      snowline: cold ? r.range(0.56, 0.70) : r.range(0.70, 0.88),
      water: { level: r.range(wLo, wHi), color: hex(seaH, seaS, seaL) },
      regions,
      features,
    },
    clouds: {
      cover: r.range(0.22, 0.55),
      color: hex(seaH + r.range(-0.08, 0.08), r.range(0.04, 0.16), r.range(0.90, 0.97)),
    },
    scatter,
    planet: { moons: 0 },
  };
}
