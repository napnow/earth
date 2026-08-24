import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeWorld, RADIUS } from './specs.js';
import { buildWorld, faceDirs, faceCount } from './WorldBuilder.js';

/**
 * The world, and what happens when it stops being that world.
 *
 * Each planet holds for a while, then comes apart: every face of its skin
 * lets go, drifts out into a slowly turning cloud of coloured motes, and
 * settles again as a different world. Because every world is baked on the
 * SAME icosphere, a mote's journey is purely radial — face 40,127 of the
 * old world becomes face 40,127 of the new one — so the cloud never stops
 * being a planet, it is only briefly a loose one. That shared sphere is the
 * one thing all worlds have to agree on, and it is why `specs.js` fixes the
 * radius for every world it makes.
 *
 * The worlds themselves are endless: `makeWorld(n)` invents the nth one from
 * nothing. `CONFIG.world.loopEvery` can wrap that sequence, which is only
 * ever wanted when the piece is being recorded — a video has to close on
 * itself, a window does not.
 *
 * The next world is grown quietly during the hold before it, a few
 * milliseconds a frame, so nothing ever stalls.
 */

const VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute float aFromR;
  attribute float aToR;
  attribute vec3 aFromC;
  attribute vec3 aToC;
  attribute vec4 aRand;      // xyz a random kick, w the mote's own stagger

  uniform float uU;          // 0 the old world .. 1 the new one
  uniform float uBulge;      // how far out the cloud swells, in world units
  uniform float uSwirl;      // radians of twist at full scatter
  uniform float uSize;       // mote size, in world units
  uniform float uProj;       // pixels per world unit at unit depth
  uniform float uReveal;     // dissolve threshold: 0 nothing drawn, 1 all
  uniform float uClump;      // how coarsely the crust breaks: low = big slabs
  uniform float uTumble;     // radians each slab turns about its own axis

  varying vec3 vColor;
  varying float vKeep;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  /** Rodrigues: turn v about a unit axis. */
  vec3 spin(vec3 v, vec3 axis, float ang) {
    float c = cos(ang);
    return v * c + cross(axis, v) * sin(ang) + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    // Faces that were neighbours leave as neighbours. Giving every mote its
    // own random direction only produces television snow; quantizing the
    // sphere into patches and letting a patch share a kick is what turns the
    // world into pieces of a world.
    vec3 cell = floor(aDir * uClump);
    float chunk = hash13(cell * 1.73 + 11.3);

    // A UNIFORM direction on the sphere for this chunk, used both to tilt its
    // kick and as the axis it tumbles about. Hashing straight to a vec3 gives
    // a point in a CUBE, which is biased toward its eight corners — enough
    // bias to make a whole explosion lean.
    float hz = hash13(cell * 7.1 + 2.3) * 2.0 - 1.0;
    float ha = hash13(cell * 3.9 + 8.7) * 6.2831853;
    float hr = sqrt(max(1.0 - hz * hz, 0.0));
    vec3 chunkDir = vec3(cos(ha) * hr, hz, sin(ha) * hr);

    // Stagger: whole regions let go at their own moment, but not by much —
    // a wide stagger reads as one side leaving before the other.
    float d = mix(aRand.w, chunk, 0.72) * 0.20;
    float u = clamp((uU - d) / max(1e-3, 1.0 - d), 0.0, 1.0);
    float e = u * u * (3.0 - 2.0 * u);

    float r = mix(aFromR, aToR, e);
    vec3 p = aDir * r;
    vColor = mix(aFromC, aToC, e);

    // The swell. The kick is overwhelmingly OUTWARD, with about twenty
    // degrees of wander on it. Letting the random component compete with the
    // radial one sends chunks sideways and inward, and what should be a
    // shell opening evenly becomes a lopsided spray.
    float puff = pow(sin(u * 3.14159265), 0.70);
    vec3 kick = normalize(aDir * 2.4 + chunkDir * 0.85 + aRand.xyz * 0.25);
    // A narrow spread of distances, so it stays a shell and not a smear.
    float reach = 0.80 + 0.44 * mix(fract(aRand.y * 53.7), chunk, 0.70);
    // Each slab turns about its own centre on the way across. This is the
    // difference between a cloud of dust and a world in pieces: you can see
    // that a piece has a face, and that the face is pointing somewhere else
    // now than it was.
    vec3 pivot = normalize((cell + 0.5) / uClump) * r;
    p = pivot + spin(p - pivot, chunkDir, puff * uTumble * (0.35 + 1.3 * chunk));

    p += kick * (uBulge * puff * reach);

    // ...and a twist about the world's axis, so the cloud turns as it hangs.
    float ang = puff * uSwirl * (0.4 + 1.1 * chunk);
    float ca = cos(ang);
    float sa = sin(ang);
    p = vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);

    vKeep = uReveal - fract(aRand.x * 91.7 + aRand.z * 37.3 + aRand.w * 13.1);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uProj / max(-mv.z, 1.0) * (1.0 + 0.95 * puff);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vKeep;
  void main() {
    if (vKeep <= 0.0) discard;
    // Soft-cornered squares: chips of a world, not sparks.
    vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
    if (max(q.x, q.y) > 0.92) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

/** smootherstep */
function ease(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function span(t, a, b) {
  return THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
}

export class WorldCycle {
  constructor() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(CONFIG.planet.radius / RADIUS);
    // A gentle axial tilt, so the pole is never dead centre.
    this.group.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(...CONFIG.planet.poleAxis).normalize(),
    );
    this.spin = new THREE.Group();
    this.group.add(this.spin);

    // Where in the endless sequence this run starts. A seed in the URL
    // pins it; otherwise every visit is a different set of planets.
    const q = new URLSearchParams(location.search).get('seed');
    this.seed = q !== null && q !== '' ? (parseInt(q, 10) | 0) : (Math.random() * 1e9) | 0;

    this.index = 0;
    this.time = 0;
    /** 0..1, read by the post chain: how badly the picture is holding together. */
    this.glitch = 0;
    this.phase = 'hold';
    this.phaseT = 0;
    this.current = null;
    this.next = null;

    // Live colours the rest of the scene reads. `sun` tints the key light so
    // the cloud decks warm and cool with the world under them; the other two
    // are kept because a world's own palette is the obvious place to pull an
    // accent from.
    this.sun = new THREE.Color(0xffffff);
    this.bounce = new THREE.Color(0xffffff);
    this.accent = new THREE.Color(0xffffff);
    this._a = new THREE.Color();
    this._b = new THREE.Color();

    this.buildParticles();
    this.spec = this.specFor(0);
    this.nextSpec = null;
    this.current = buildWorld(this.spec);
    this.spin.add(this.current.group);
    this.current.group.visible = true;
    this.applyColors(this.spec, this.spec, 0);
  }

  buildParticles() {
    const detail = CONFIG.world.detail;
    const n = faceCount(detail);
    const rand = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      rand[i * 4] = Math.random() * 2 - 1;
      rand[i * 4 + 1] = Math.random() * 2 - 1;
      rand[i * 4 + 2] = Math.random() * 2 - 1;
      rand[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    // `position` is unused by the shader but three needs it to count verts.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aDir', new THREE.BufferAttribute(faceDirs(detail), 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
    // Four slots, filled in place at every change. Handing the geometry a
    // fresh BufferAttribute instead would strand the old one's GL buffer.
    for (const [name, n2] of [['aFromR', 1], ['aToR', 1], ['aFromC', 3], ['aToC', 3]]) {
      const attr = new THREE.BufferAttribute(new Float32Array(n * n2), n2);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }

    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uU: { value: 0 },
        uBulge: { value: CONFIG.world.bulge },
        uSwirl: { value: CONFIG.world.swirl },
        uSize: { value: CONFIG.world.moteSize },
        uProj: { value: 1000 },
        uReveal: { value: 0 },
        uClump: { value: CONFIG.world.clump },
        uTumble: { value: CONFIG.world.tumble },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.spin.add(this.dust);
  }

  /** Pixels per world unit at unit depth — point sprites are sized in pixels. */
  setProjectionScale(pixels) {
    this.dustMat.uniforms.uProj.value = pixels;
  }

  bindSkins(from, to) {
    const geo = this.dust.geometry;
    const put = (name, src) => {
      const attr = geo.getAttribute(name);
      attr.array.set(src);
      attr.needsUpdate = true;
    };
    put('aFromR', from.skin.radius);
    put('aToR', to.skin.radius);
    put('aFromC', from.skin.color);
    put('aToC', to.skin.color);
  }

  applyColors(a, b, k) {
    this.sun.set(a.ambience.sunColor).lerp(this._a.set(b.ambience.sunColor), k);
    this.bounce.set(a.terrain.palette.mid).lerp(this._a.set(b.terrain.palette.mid), k);
    this.accent.set(a.terrain.palette.high).lerp(this._a.set(b.terrain.palette.high), k);
  }

  /** The nth world of this run. A playlist, if there is one, overrides all. */
  specFor(index) {
    const pl = CONFIG.world.playlist;
    if (pl && pl.length) return makeWorld(pl[((index % pl.length) + pl.length) % pl.length]);
    const loop = CONFIG.world.loopEvery;
    const n = loop > 0 ? ((index % loop) + loop) % loop : index;
    return makeWorld(this.seed + n * 7919);
  }

  get worldName() {
    return this.spec.name;
  }

  update(dt) {
    this.time += dt;
    this.phaseT += dt;
    this.spin.rotation.x = 0;
    this.spin.rotation.z = 0;

    const T = CONFIG.world;
    this.glitch = 0;

    if (this.phase === 'hold') {
      // Grow the next world in the background, a few milliseconds a frame —
      // but only once this one is finished, or the two share a budget and
      // neither arrives.
      if (!this.next && this.current.ready) {
        this.nextSpec = this.specFor(this.index + 1);
        this.next = buildWorld(this.nextSpec);
        this.spin.add(this.next.group);
      }
      this.current.pump(T.budgetMs);
      if (this.next) this.next.pump(T.budgetMs);
      this.current.setPresence(1);
      this.dust.visible = false;

      // The last second and a half of a hold, the world starts to shake and
      // the picture starts to lose its grip. Nothing has happened yet; the
      // announcement is the point.
      const warn = Math.max(0, this.phaseT - (T.hold - T.warn)) / T.warn;
      if (warn > 0) {
        const k = warn * warn * warn;
        this.glitch = k * 0.22;
        const q = this.time * 47.0;
        this.spin.rotation.x = Math.sin(q) * 0.010 * k;
        this.spin.rotation.z = Math.sin(q * 1.31 + 1.7) * 0.010 * k;
      }

      // The world turns while it holds, from zero.
      this.spin.rotation.y = this.phaseT * CONFIG.planet.spin;

      // Only leave once the next world is actually standing.
      if (this.phaseT >= T.hold && this.current.ready && this.next && this.next.ready) {
        this.bindSkins(this.current, this.next);
        this.phase = 'change';
        this.phaseT = 0;
      }
    } else if (this.phase === 'change') {
      const t = this.phaseT / T.change;
      const u = ease(t);

      // The turn unwinds while the world is in pieces, so the one that
      // settles starts square again. Nobody can see a cloud of rubble
      // rotate back to zero, and it is what makes the whole piece close on
      // itself every five worlds.
      this.spin.rotation.y = T.hold * CONFIG.planet.spin * (1 - u);

      this.dust.visible = true;
      this.dustMat.uniforms.uU.value = u;

      // The dust arrives as the ground lets go, and leaves as it sets.
      const inK = span(t, 0.0, 0.10);
      const outK = 1 - span(t, 0.90, 1.0);
      this.dustMat.uniforms.uReveal.value = Math.min(inK, outK);

      // Forests fold away, seas and stone switch off under the cloud.
      this.current.setPresence(1 - span(t, 0.0, 0.16));
      this.next.setPresence(span(t, 0.84, 1.0));
      this.current.group.visible = t < 0.5;
      this.next.group.visible = t >= 0.5;

      this.applyColors(this.spec, this.nextSpec, u);

      // The tube tears twice: once when the crust lets go, once when it
      // lands. In between the signal is merely unwell.
      //
      // The second tear peaks early enough, and falls off sharply enough,
      // that the picture has fully recovered by the time the change ends —
      // otherwise the loop point inherits a glitch on one side of it and a
      // clean frame on the other, which is the one seam you cannot hide.
      this.glitch = Math.min(1,
        Math.exp(-Math.pow((t - 0.07) / 0.065, 2))
        + 0.8 * Math.exp(-Math.pow((t - 0.82) / 0.05, 2))
        + 0.13 * Math.sin(t * Math.PI));

      if (t >= 1) {
        this.current.dispose();
        this.current = this.next;
        this.next = null;
        this.index += 1;
        this.spec = this.nextSpec;
        this.nextSpec = null;
        this.current.setPresence(1);
        this.current.group.visible = true;
        this.dust.visible = false;
        this.phase = 'hold';
        this.phaseT = 0;
        this.applyColors(this.spec, this.spec, 0);
      }
    }

    this.current.update(dt);
    if (this.next) this.next.update(dt);
  }
}
