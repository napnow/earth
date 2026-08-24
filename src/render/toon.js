import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Cel shading, carried over from the game: a stepped gradient map for
 * MeshToonMaterial. The ground of a world is unlit — it is painted rather
 * than shaded — so this is only for the things standing on and above it:
 * cloud banks, moons, crystal and rock.
 */

const gradientCache = new Map();

export function toonGradient(steps = CONFIG.toon.steps) {
  const cached = gradientCache.get(steps);
  if (cached) return cached;

  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    // Bias the ramp so shadows stay rich instead of pitch black.
    const t = i / (steps - 1);
    const v = Math.round(70 + 185 * Math.pow(t, 0.82));
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  gradientCache.set(steps, tex);
  return tex;
}

export function toonMat(color, opts = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(opts.steps),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  // Faceted shading: every low-poly face reads as a flat plane.
  mat.flatShading = true;
  return mat;
}
