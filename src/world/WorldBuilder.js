import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat } from '../render/toon.js';
import { Rng } from './rng.js';
import { PlanetPainter, randomUnit } from './PlanetPainter.js';
import { accentOf, leafShades, posterize } from './ground.js';
import { SpriteBatcher } from './SpriteBatcher.js';
import { rgbOf, makeBushSprite, makeFlowerSprite, makeGrassSprite, makeMushroomSprite, makeTreeSprite } from './pixelart.js';

/**
 * Grows a mini planet from a WorldSpec — the game's WorldBuilder, minus the
 * two things an orbital view has no use for (named ruins and eye-level
 * weather) and plus one it needs: every face's centre, radius and colour,
 * handed back so the world can come apart into particles.
 *
 * Everything heavy runs inside a generator the caller pumps against a frame
 * budget, exactly as the game does it: a coarse silhouette stands in at
 * once and the planet sharpens over the following seconds.
 */

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Face-centre directions for an icosphere at a given subdivision. Shared
 * across every world, which is the whole trick behind the dissolve: two
 * worlds differ only in how far out each face sits and what colour it is,
 * so a particle's journey between them is purely radial.
 */
const dirCache = new Map();

export function faceDirs(detail) {
  const cached = dirCache.get(detail);
  if (cached) return cached;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position');
  const n = pos.count / 3;
  const dirs = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) {
    const i = f * 3;
    let x = pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2);
    let y = pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2);
    let z = pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2);
    const l = Math.hypot(x, y, z) || 1;
    dirs[f * 3] = x / l;
    dirs[f * 3 + 1] = y / l;
    dirs[f * 3 + 2] = z / l;
  }
  geo.dispose();
  dirCache.set(detail, dirs);
  return dirs;
}

export function faceCount(detail) {
  return 20 * (detail + 1) * (detail + 1);
}

// -- terrain bake ----------------------------------------------------------

function runToEnd(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/**
 * Bake the painted sphere a slice at a time. Icosahedron faces are already
 * non-indexed, so each face takes one flat colour — the patchwork. Colouring
 * is the expensive half (slope and field samples per face), which is why
 * this is a generator.
 *
 * When `skin` is supplied it is filled with the per-face radius and colour:
 * the same numbers the mesh is built from, so the particle cloud and the
 * solid planet are the same object seen two ways.
 */
function* bakeTerrain(painter, detail, material, skin) {
  const R = painter.R;
  const relief = CONFIG.world.relief;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position');
  const dirs = faceDirs(detail);
  const faces = pos.count / 3;

  // Vertices ride their own height, so cliffs stay cliffs.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = R + painter.heightAt(x, y, z) * relief;
    pos.setXYZ(i, x * r, y * r, z * r);
    if ((i & 2047) === 2047) yield;
  }
  yield;

  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const dir = new THREE.Vector3();
  for (let f = 0; f < faces; f++) {
    dir.set(dirs[f * 3], dirs[f * 3 + 1], dirs[f * 3 + 2]);
    const h = painter.heightAt(dir.x, dir.y, dir.z);
    painter.faceColor(c, dir, h);
    const i = f * 3;
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r;
      colors[(i + v) * 3 + 1] = c.g;
      colors[(i + v) * 3 + 2] = c.b;
    }
    if (skin) {
      skin.radius[f] = R + h * relief;
      skin.color[f * 3] = c.r;
      skin.color[f * 3 + 1] = c.g;
      skin.color[f * 3 + 2] = c.b;
    }
    if ((f & 511) === 511) yield;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

// -- clouds ----------------------------------------------------------------

const _cloudDelta = new THREE.Quaternion();

/**
 * A cloud blob painted the way the ground is painted: unlit, one flat colour
 * per face, quantized onto the same ladder. Lighting them instead would put
 * a different rendering model in the same picture as the terrain — the
 * ground says its colours ARE its colours, and a lit cloud disagrees.
 *
 * The only shading is baked in: a face is the cloud's colour where it looks
 * away from the planet and a darker version of it underneath, which is
 * exactly what the game's 2D cloud sprites do with their `body` and `under`.
 */
function cloudGeometry(body) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position');
  const under = body.clone().multiplyScalar(0.58);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let v = 0; v < 3; v++) {
      x += pos.getX(i + v);
      y += pos.getY(i + v);
      z += pos.getZ(i + v);
    }
    const len = Math.hypot(x, y, z) || 1;
    c.copy(under).lerp(body, THREE.MathUtils.smoothstep(y / len, -0.6, 0.5));
    posterize(c);
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r;
      colors[(i + v) * 3 + 1] = c.g;
      colors[(i + v) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Chunky puff clusters lying tangent to the planet, FIXED in world
 * orientation — they belong to the world, not the camera. Each hangs off a
 * pivot at the planet's centre and drifts as the pivot turns.
 */
function buildClouds(group, rng, spec, R, maxH) {
  const cover = spec.clouds?.cover ?? 0.4;
  const out = [];
  if (cover <= 0.02) return out;

  const base = new THREE.Color(spec.clouds?.color ?? '#fffcf8');
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  // Three castings of the same cloud, so a bank is not one shade repeated.
  // Held a little under white on purpose: the snowline is already near
  // white, and a cloud that matches it stops being a cloud.
  const geos = [0.88, 0.80, 0.72].map((k) => cloudGeometry(base.clone().multiplyScalar(k)));
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();

  const n = Math.round(5 + cover * 34);
  for (let i = 0; i < n; i++) {
    const pivot = new THREE.Object3D();
    pivot.quaternion.setFromUnitVectors(up, randomUnit(rng, dir));

    const cluster = new THREE.Group();
    // The game hangs its cloud decks at 1.05-1.6 x maxHeight, which is the
    // right gap when you are flying among them. Seen whole from outside,
    // that reads as a ring of lozenges in orbit rather than as weather, so
    // out here they sit just clear of the (compressed) peaks.
    cluster.position.y = R + maxH * CONFIG.world.relief * rng.range(1.2, 2.1);
    cluster.rotation.y = rng.range(0, Math.PI * 2);

    const span = R * rng.range(0.05, 0.1);
    const blobs = rng.int(4, 8);
    for (let b = 0; b < blobs; b++) {
      const blob = new THREE.Mesh(rng.pick(geos), mat);
      const bx = (b / (blobs - 1) - 0.5) * span * 2 + rng.range(-span, span) * 0.2;
      const mid = 1 - Math.abs(b / (blobs - 1) - 0.5) * 1.4;
      const s = R * rng.range(0.02, 0.032) * (0.7 + mid * 0.6);
      blob.position.set(bx, rng.range(-0.2, 0.4) * s, rng.range(-0.5, 0.5) * span * 0.5);
      blob.scale.set(s * rng.range(1.1, 1.5), s * 0.6, s * rng.range(0.9, 1.3));
      blob.rotation.y = rng.range(0, Math.PI);
      cluster.add(blob);
    }
    pivot.add(cluster);
    group.add(pivot);
    out.push({
      pivot,
      cluster,
      axis: randomUnit(rng, new THREE.Vector3()),
      speed: rng.range(0.0015, 0.004) * (rng.chance(0.5) ? -1 : 1),
    });
  }
  return out;
}

// -- sprite vegetation -----------------------------------------------------

function treePalette(rng, leafBase, trunk, emissive) {
  const leaf = leafBase.clone();
  if (emissive) {
    const hsl = { h: 0, s: 0, l: 0 };
    leaf.getHSL(hsl);
    leaf.setHSL(hsl.h, Math.min(1, hsl.s + 0.12), Math.min(0.92, hsl.l + 0.16));
  }
  return {
    leaf: leafShades(rng, leaf),
    trunk: rgbOf(trunk),
    accent: emissive || rng.chance(0.3) ? accentOf(leaf) : undefined,
    accentChance: emissive ? 0.05 : 0.025,
  };
}

function treeShapes(rng, n) {
  const shapes = [];
  for (let i = 0; i < n; i++) {
    const roll = rng.next();
    shapes.push(roll < 0.6 ? 'round' : roll < 0.85 ? 'pine' : 'willow');
  }
  return shapes;
}

/**
 * Plant the planet: pixel-sprite forests from every "tree" entry (region
 * provinces re-species their share), an understory of bushes, grass and
 * mushrooms from their entries, and meadow flowers the world grows on its
 * own — the game's planting passes, bent around the sphere.
 */
function* plantSprites(group, spec, painter, rng, sprites, textures) {
  const R = painter.R;
  const relief = CONFIG.world.relief;
  const maxH = painter.maxH;
  const waterR = painter.waterR;
  const su = painter.su;
  const dir = new THREE.Vector3();

  const minSurface = waterR !== null ? waterR - R + su * 0.55 : maxH * 0.015;
  // Spec counts are authored at island scale (~300 u of land); a planet is
  // many islands of surface, so density scales with area.
  const areaScale = (R / 300) ** 2;

  const commit = (batches) => {
    for (const b of batches) {
      if (b.items.length === 0) continue;
      textures.push(b.sprite.texture);
      sprites.addBatch(group, b.sprite, b.items);
    }
  };

  const place = (h, height, tint) => ({
    x: dir.x * (R + h * relief - 0.25),
    y: dir.y * (R + h * relief - 0.25),
    z: dir.z * (R + h * relief - 0.25),
    height,
    flip: rng.chance(0.5),
    widthMul: rng.range(0.9, 1.14),
    shade: rng.range(0.94, 1.06),
    region: tint,
  });

  // -- trees ---------------------------------------------------------------
  for (const s of spec.scatter) {
    if (s.kind !== 'tree' || s.count <= 0) continue;
    const leafBase = new THREE.Color(s.primary);
    const trunk = new THREE.Color(s.secondary);

    const nv = 4;
    const baseBatches = [];
    const shapes = treeShapes(rng, nv);
    for (let v = 0; v < nv; v++) {
      baseBatches.push({
        sprite: makeTreeSprite(rng, shapes[v], treePalette(rng, leafBase, trunk, s.emissive === true)),
        items: [],
      });
    }
    // Provinces re-species their trees from the region's own colours.
    const regionBatches = painter.regions.map((rg) => {
      const shapes2 = treeShapes(rng, 2);
      return shapes2.map((shape) => ({
        sprite: makeTreeSprite(rng, shape, treePalette(rng, rg.colorA, trunk, false)),
        items: [],
      }));
    });
    yield;

    const treeTarget = Math.min(24000, Math.round(s.count * areaScale));
    let placed = 0;
    let attempts = 0;
    const maxAttempts = treeTarget * 30;
    while (placed < treeTarget && attempts < maxAttempts) {
      attempts++;
      if ((attempts & 255) === 0) yield;
      randomUnit(rng, dir);
      const forest = painter.forestAt(dir);
      if (rng.next() > (forest - 0.5) * 3.4) continue;
      const h = painter.heightAt(dir.x, dir.y, dir.z);
      if (h < minSurface || h > maxH * (spec.terrain.snowline - 0.04)) continue;
      if (painter.slopeAt(dir) > 0.5) continue;

      const height = rng.range(s.minScale, s.maxScale) * 6;
      const tint = new THREE.Color();
      painter.spriteTint(tint, dir, h);
      const p = place(h, height, tint);

      const dom = painter.dominantRegion(dir);
      if (dom.index >= 0 && dom.w > 0.45 && regionBatches[dom.index].length > 0) {
        regionBatches[dom.index][placed % regionBatches[dom.index].length].items.push(p);
      } else {
        baseBatches[placed % nv].items.push(p);
      }
      placed++;
    }
    commit(baseBatches);
    for (const rb of regionBatches) commit(rb);
    yield;

    // A forest keeps an understory: bushes from the same palette, darker.
    const bushLeaf = leafShades(rng, leafBase.clone().multiplyScalar(0.82), 3);
    const bushBatches = [0, 1].map(() => ({
      sprite: makeBushSprite(rng, bushLeaf, rng.chance(0.5) ? accentOf(leafBase) : null),
      items: [],
    }));
    const bushTarget = Math.min(9000, Math.floor(placed * 0.45));
    let bushes = 0;
    for (let i = 0; i < bushTarget * 18 && bushes < bushTarget; i++) {
      if ((i & 255) === 0) yield;
      randomUnit(rng, dir);
      const forest = painter.forestAt(dir);
      if (forest < 0.48 || forest > 0.9) continue;
      if (rng.next() > forest * 0.55) continue;
      const h = painter.heightAt(dir.x, dir.y, dir.z);
      if (h < minSurface || h > maxH * 0.6) continue;
      if (painter.slopeAt(dir) > 0.55) continue;
      const tint = new THREE.Color();
      painter.spriteTint(tint, dir, h);
      bushBatches[bushes % 2].items.push(place(h, rng.range(1.4, 2.6), tint));
      bushes++;
    }
    commit(bushBatches);
    yield;
  }

  // -- grass + mushrooms from their entries --------------------------------
  for (const s of spec.scatter) {
    if (s.count <= 0) continue;
    if (s.kind === 'grass') {
      const grassPalette = leafShades(rng, new THREE.Color(s.primary), 3);
      const batches = [0, 1].map(() => ({ sprite: makeGrassSprite(rng, grassPalette), items: [] }));
      const target = Math.min(30000, Math.round(s.count * areaScale));
      let placed = 0;
      for (let i = 0; i < target * 14 && placed < target; i++) {
        if ((i & 255) === 0) yield;
        randomUnit(rng, dir);
        if (rng.next() > painter.meadowAt(dir) * 0.85) continue;
        const h = painter.heightAt(dir.x, dir.y, dir.z);
        if (h < minSurface || h > maxH * 0.7) continue;
        if (painter.slopeAt(dir) > 0.45) continue;
        const tint = new THREE.Color();
        painter.spriteTint(tint, dir, h);
        batches[placed % 2].items.push(place(h, rng.range(s.minScale, s.maxScale) * 1.3, tint));
        placed++;
      }
      commit(batches);
      yield;
    } else if (s.kind === 'mushroom') {
      const cap = rgbOf(new THREE.Color(s.primary));
      const stem = rgbOf(new THREE.Color(s.secondary));
      const fleck = accentOf(new THREE.Color(s.primary));
      const batches = [0, 1].map(() => ({ sprite: makeMushroomSprite(rng, cap, stem, fleck), items: [] }));
      const target = Math.min(8000, Math.round(s.count * areaScale));
      let placed = 0;
      for (let i = 0; i < target * 16 && placed < target; i++) {
        if ((i & 255) === 0) yield;
        randomUnit(rng, dir);
        if (painter.forestAt(dir) < 0.52) continue;
        const h = painter.heightAt(dir.x, dir.y, dir.z);
        if (h < minSurface || h > maxH * 0.55) continue;
        if (painter.slopeAt(dir) > 0.5) continue;
        const tint = new THREE.Color();
        painter.spriteTint(tint, dir, h);
        batches[placed % 2].items.push(place(h, rng.range(s.minScale, s.maxScale) * 1.1, tint));
        placed++;
      }
      commit(batches);
      yield;
    }
  }

  // -- flowers the world grows on its own ----------------------------------
  const g = painter.ground;
  const flowerColors = [
    { head: rgbOf(g.meadowWarm.clone().offsetHSL(0, 0.1, 0.22)), center: rgbOf(g.snowBright) },
    { head: rgbOf(g.snowBright), center: rgbOf(g.meadowWarm) },
    { head: rgbOf(new THREE.Color(spec.terrain.palette.high).offsetHSL(0, 0.12, 0.08)), center: rgbOf(g.snowBright) },
  ];
  for (const rg of painter.regions) {
    flowerColors.push({ head: rgbOf(rg.colorA.clone().offsetHSL(0, 0.05, 0.28)), center: rgbOf(g.snowBright) });
  }
  const stem = rgbOf(g.grassDeep);
  const flowerBatches = flowerColors.map((fc) => ({
    sprite: makeFlowerSprite(rng, fc.head, fc.center, stem),
    items: [],
  }));
  const flowerTarget = Math.round(2400 * (R / 800) * (R / 800)) + 400;
  let flowers = 0;
  for (let i = 0; i < flowerTarget * 14 && flowers < flowerTarget; i++) {
    if ((i & 255) === 0) yield;
    randomUnit(rng, dir);
    const meadow = painter.meadowAt(dir);
    if (rng.next() > (meadow - 0.6) * 3) continue;
    if (painter.forestAt(dir) > 0.6) continue;
    const h = painter.heightAt(dir.x, dir.y, dir.z);
    if (h < minSurface || h > maxH * 0.55) continue;
    if (painter.slopeAt(dir) > 0.4) continue;
    const tint = new THREE.Color();
    painter.spriteTint(tint, dir, h);
    flowerBatches[flowers % flowerBatches.length].items.push(place(h, rng.range(0.9, 1.5), tint));
    flowers++;
  }
  commit(flowerBatches);
}

// -- geometric scatter (chunky toon shapes) --------------------------------

function part(geo, mat, x, y, z) {
  return { geo, mat, local: new THREE.Matrix4().makeTranslation(x, y, z) };
}

function archetypeParts(s, pulsing) {
  const glow = s.emissive ? 0.85 : 0;
  const primary = toonMat(s.primary, glow ? { emissive: s.primary, emissiveIntensity: glow } : {});
  const secondary = toonMat(s.secondary);
  // Seeded off the spec, not Math.random(): the same world built twice has
  // to glow the same, or a loop shows a step in the crystal light.
  if (glow) pulsing.push({ mat: primary, base: glow, phase: (s.count * 0.618) % 6.283 });

  switch (s.kind) {
    case 'crystal': {
      const g = new THREE.OctahedronGeometry(1, 0);
      const tall = g.clone().scale(0.7, 2.3, 0.7);
      const small = g.clone().scale(0.4, 1.1, 0.4);
      const smallLocal = new THREE.Matrix4().makeRotationZ(0.5).setPosition(0.8, 0.7, 0.2);
      return [part(tall, primary, 0, 1.7, 0), { geo: small, mat: primary, local: smallLocal }];
    }
    case 'spire':
      return [part(new THREE.ConeGeometry(0.9, 6.5, 5), primary, 0, 3.1, 0)];
    case 'rock':
    default: {
      const g = new THREE.DodecahedronGeometry(1.15, 0);
      return [
        part(g.clone().scale(1, 0.72, 1), primary, 0, 0.55, 0),
        part(g.clone().scale(0.5, 0.4, 0.5), secondary, 1.2, 0.28, 0.4),
      ];
    }
  }
}

function* buildScatterGeometry(s, group, rng, painter, R, waterR, pulsing) {
  if (s.count <= 0) return;
  const parts = archetypeParts(s, pulsing);

  // Same area scaling the sprites use, gentler: big 3D shapes crowd faster.
  const target = Math.min(8000, Math.round(s.count * Math.min(6, Math.max(1, (R / 500) ** 2))));
  const placements = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const posV = new THREE.Vector3();
  const d = new THREE.Vector3();
  let attempts = 0;
  while (placements.length < target && attempts < target * 12) {
    attempts++;
    if ((attempts & 255) === 0) yield;
    randomUnit(rng, d);
    const h = painter.heightAt(d.x, d.y, d.z);
    // The waterline test is in the painter's units; the placement is not.
    if (waterR !== null && R + h < waterR + 1.2) continue;
    const surf = R + h * CONFIG.world.relief;
    if (h <= 0.5) continue;
    if (painter.slopeAt(d) > 0.6) continue;
    const sc = rng.range(s.minScale, s.maxScale);
    q.setFromUnitVectors(UP, d);
    spin.setFromAxisAngle(d, rng.next() * Math.PI * 2);
    q.premultiply(spin);
    placements.push(m.clone().compose(posV.copy(d).multiplyScalar(surf - 0.2), q, scale.setScalar(sc)));
  }

  for (const p of parts) {
    const instanced = new THREE.InstancedMesh(p.geo, p.mat, placements.length);
    for (let i = 0; i < placements.length; i++) {
      instanced.setMatrixAt(i, m.multiplyMatrices(placements[i], p.local));
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.frustumCulled = false;
    group.add(instanced);
  }
  yield;
}

// -- the world -------------------------------------------------------------

export function buildWorld(spec) {
  const detail = CONFIG.world.detail;
  const relief = CONFIG.world.relief;
  const group = new THREE.Group();
  group.visible = false;

  // The approach direction decides where 'center' landforms sit. This piece
  // has no rider coming in, so it uses the world's own seed to pick one —
  // deterministic, and different per world.
  const approach = new THREE.Vector3();

  // Stream order is load-bearing: every subsystem forks its own rng here,
  // in this order, forever.
  const rng = new Rng(spec.seed);
  randomUnit(new Rng(spec.seed ^ 0x9e3779b9), approach);
  const painter = new PlanetPainter(rng.fork(), spec, approach);
  const vegRng = rng.fork();
  const scatterRng = rng.fork();
  rng.fork(); // (sites, which this piece does not plant)
  const cloudRng = rng.fork();
  const moonRng = rng.fork();

  const R = spec.terrain.radius;
  const maxH = spec.terrain.maxHeight;
  const waterR = painter.waterR;
  const textures = [];
  const sprites = new SpriteBatcher();
  const pulsingMats = [];
  const lightMats = [];
  const cityLights = [];
  painter.setSites([]);

  const terrainMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // Ground, sea and standing stone go in one subgroup: when the world comes
  // apart, the particles stand in for exactly these and this is switched off
  // in a single stroke. The forests and the weather fade by their own means.
  const solid = new THREE.Group();
  group.add(solid);

  // A coarse silhouette, synchronously: the world is never a hole.
  const farMesh = runToEnd(bakeTerrain(painter, 10, terrainMat, null));
  solid.add(farMesh);

  // -- ocean ---------------------------------------------------------------
  const waterColor = new THREE.Color(spec.terrain.water?.color ?? '#2f9c84');
  // The painter reasons about the waterline at full height; the sphere that
  // stands in for it has to sit on the compressed ground.
  const waterRd = waterR === null ? null : R + (waterR - R) * relief;
  if (waterR !== null && spec.terrain.water) {
    // Lifted toward light so a grazing view reads as sea surface, not murk;
    // the painted shallows still glow through from above.
    const hsl = { h: 0, s: 0, l: 0 };
    waterColor.getHSL(hsl);
    waterColor.setHSL(hsl.h, Math.min(1, hsl.s + 0.05), Math.min(0.8, hsl.l + 0.14));
    posterize(waterColor);
    const water = new THREE.Mesh(
      new THREE.IcosahedronGeometry(waterRd, 24),
      new THREE.MeshBasicMaterial({ color: waterColor, transparent: true, opacity: 0.68 }),
    );
    water.frustumCulled = false;
    solid.add(water);
  }

  // (No atmosphere shell: worlds meet space with a crisp limb.)

  const clouds = buildClouds(group, cloudRng, spec, R, maxH);

  // Moons, pulled in much closer and sped up much further than the game
  // flies them. In the game they are scenery a rider glances at; here they
  // are the only thing that moves while a world is holding, so they have to
  // cross the frame, tumble as they go, and take steeply crossed orbits so
  // no two of them ever agree.
  const moons = [];
  for (let i = 0; i < (spec.planet?.moons ?? 0); i++) {
    const pivot = new THREE.Object3D();
    pivot.rotation.set(
      moonRng.range(-1.2, 1.2),
      moonRng.range(0, Math.PI * 2),
      moonRng.range(-1.2, 1.2),
    );
    const moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(R * moonRng.range(0.045, 0.085), 0),
      toonMat(spec.terrain.palette.high),
    );
    moon.scale.set(1, moonRng.range(0.7, 1.0), moonRng.range(0.8, 1.15));
    moon.position.x = R * moonRng.range(1.30, 1.62);
    pivot.add(moon);
    group.add(pivot);
    moons.push({
      pivot,
      mesh: moon,
      speed: moonRng.range(0.16, 0.40) * (moonRng.next() < 0.5 ? -1 : 1),
      tumble: moonRng.range(0.25, 0.8),
    });
  }


  // The per-face skin: what the dissolve flies apart into.
  const n = faceCount(detail);
  const skin = { radius: new Float32Array(n), color: new Float32Array(n * 3) };
  // -- civilization --------------------------------------------------------


  let time = 0;
  let presence = 1;
  let done = false;
  let steps = (function* grow() {
    const fullMesh = yield* bakeTerrain(painter, detail, terrainMat, skin);
    solid.add(fullMesh);
    farMesh.visible = false;
    for (const s of spec.scatter) {
      if (s.kind === 'crystal' || s.kind === 'rock' || s.kind === 'spire') {
        yield* buildScatterGeometry(s, solid, scatterRng, painter, R, waterR, pulsingMats);
      }
    }
    yield* plantSprites(group, spec, painter, vegRng, sprites, textures);
    // Sink the ocean colour into the skin so a dissolving world keeps its
    // seas: below the waterline a particle IS the sea surface, not the bed.
    if (waterR !== null) {
      for (let f = 0; f < n; f++) {
        if (skin.radius[f] >= waterRd) continue;
        skin.radius[f] = waterRd;
        const i = f * 3;
        skin.color[i] += (waterColor.r - skin.color[i]) * 0.85;
        skin.color[i + 1] += (waterColor.g - skin.color[i + 1]) * 0.85;
        skin.color[i + 2] += (waterColor.b - skin.color[i + 2]) * 0.85;
      }
    }

    // -- civilization lights -------------------------------------------------
    // Placed last, when the skin is fully baked: land faces on the night
    // side, clustered into towns. Two or three neighbouring lights read as
    // one town; five spread evenly would read as five mistakes.
    if (spec.civilization && spec.civilization.settlements > 0) {
      const lightRng = rng.fork();
      const sunDir = new THREE.Vector3(0.55, 0.35, 0.75).normalize();
      const dirs = faceDirs(detail);
      const candidates = [];
      for (let f = 0; f < n; f++) {
        const i = f * 3;
        const d = new THREE.Vector3(dirs[i], dirs[i + 1], dirs[i + 2]);
        if (d.dot(sunDir) > -0.15) continue;                      // night side
        if (skin.radius[f] < waterRd + 2) continue;               // land only
        candidates.push({ dir: d, faceR: skin.radius[f] });
      }
      for (let s = 0; s < Math.min(spec.civilization.settlements, 5); s++) {
        if (!candidates.length) break;
        const pick = candidates[lightRng.int(0, candidates.length - 1)];
        for (let k = 0; k < lightRng.int(2, 4); k++) {
          cityLights.push({
            dir: pick.dir.clone().add(new THREE.Vector3(
              lightRng.range(-0.05, 0.05),
              lightRng.range(-0.05, 0.05),
              lightRng.range(-0.05, 0.05),
            )).normalize(),
            r: pick.faceR + 1.5,
            phase: lightRng.next() * Math.PI * 2,
          });
        }
      }

      if (cityLights.length) {
        const pos = new Float32Array(cityLights.length * 3);
        const phase = new Float32Array(cityLights.length);
        cityLights.forEach((l, i) => {
          pos[i * 3] = l.dir.x * l.r;
          pos[i * 3 + 1] = l.dir.y * l.r;
          pos[i * 3 + 2] = l.dir.z * l.r;
          phase[i] = l.phase;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        const lightMat = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uProj: { value: 1000 } },
          vertexShader: /* glsl */ `
            attribute float aPhase;
            uniform float uTime;
            uniform float uProj;
            varying float vTwinkle;
            void main() {
              vTwinkle = 0.62 + 0.38 * sin(uTime * (1.7 + fract(aPhase) * 2.3) + aPhase);
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = clamp(uProj / max(-mv.z, 1.0) * 2.6, 1.5, 4.0);
            }
          `,
          fragmentShader: /* glsl */ `
            precision highp float;
            varying float vTwinkle;
            void main() {
              vec2 q = gl_PointCoord - 0.5;
              float d = length(q) * 2.0;
              float glow = smoothstep(1.0, 0.15, d);
              // Sodium-vapour warm: every city seen from a cruising plane.
              gl_FragColor = vec4(vec3(1.0, 0.78, 0.42) * glow * vTwinkle, glow * vTwinkle);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geo, lightMat);
        points.frustumCulled = false;
        lightMats.push(lightMat);
        solid.add(points);
      }
    }

    done = true;
  })();

  return {
    spec,
    group,
    painter,
    radius: R,
    waterRadius: waterR,
    skin,
    get ready() {
      return done;
    },
    /** Advance the build for at most `budgetMs`. Safe to call when done. */
    pump(budgetMs) {
      if (!steps) return;
      const until = performance.now() + budgetMs;
      do {
        if (steps.next().done) {
          steps = null;
          return;
        }
      } while (performance.now() < until);
    },
    /** 1 a whole world, 0 nothing left standing. */
    setPresence(p) {
      presence = p;
      solid.visible = p > 0.02;
      for (const c of clouds) c.cluster.scale.setScalar(Math.max(p, 0.0001));
      for (const mn of moons) mn.pivot.scale.setScalar(Math.max(p, 0.0001));
    },
    update(dt) {
      time += dt;
      sprites.update(time, presence);
      for (const lm of lightMats) lm.uniforms.uTime.value = time;
      for (const c of clouds) {
        _cloudDelta.setFromAxisAngle(c.axis, c.speed * dt);
        c.pivot.quaternion.premultiply(_cloudDelta);
      }
      for (const p of pulsingMats) {
        p.mat.emissiveIntensity = p.base * (0.75 + 0.25 * Math.sin(time * 1.6 + p.phase));
      }
      for (const mn of moons) {
        mn.pivot.rotation.y += dt * mn.speed;
        mn.mesh.rotation.x += dt * mn.tumble;
        mn.mesh.rotation.z += dt * mn.tumble * 0.6;
      }
    },
    dispose() {
      steps = null;
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const material = o.material;
        if (material) {
          for (const m of Array.isArray(material) ? material : [material]) m.dispose();
        }
      });
      for (const t of textures) t.dispose();
      group.removeFromParent();
    },
  };
}
