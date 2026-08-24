import * as THREE from 'three';

/**
 * Deep space: a still field of stars and a handful of hero stars with faint
 * diffraction glints. Nothing else. There is no gradient and no nebula —
 * the ground of this picture is one flat near-black (the renderer's clear
 * colour), and everything that reads as depth out here is a star.
 *
 * The stars write no depth and draw first in the transparent pass, so the
 * planet and its weather layer over them correctly.
 */

/** How far out the star field sits. Well inside the far plane. */
const SKY_RADIUS = 8000;

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // A slow shimmer, never a blink: 0.80 .. 1.00 over ten-second breaths.
    // Two whole shimmers per twenty seconds, so the field is where it
    // started when the piece comes round again.
    float tw = 0.90 + 0.10 * sin(uTime * 0.6283185 + aPhase * 6.2831);
    vColor = aColor;
    vBright = tw;
    gl_PointSize = aSize * uScale * (0.92 + 0.08 * tw);
  }
`;

const STAR_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    float m = texture2D(uMap, gl_PointCoord).r;
    if (m < 0.004) discard;
    gl_FragColor = vec4(vColor * vBright, m);
  }
`;

/**
 * Sprite masks are painted as OPAQUE grayscale, not as white-with-alpha:
 * the shaders read the red channel, and a canvas gradient that fades only
 * its alpha comes back with red pinned at 1.0 everywhere it is not fully
 * transparent — which turns every star into a hard disc.
 */
function maskTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function blobTexture() {
  return maskTexture(64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0.00, '#ffffff');
    g.addColorStop(0.18, '#c8c8c8');
    g.addColorStop(0.42, '#3c3c3c');
    g.addColorStop(0.70, '#0c0c0c');
    g.addColorStop(1.00, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

/** The blob again, with four faint rays — only the brightest stars get one. */
function glintTexture() {
  return maskTexture(128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 30);
    g.addColorStop(0.00, '#ffffff');
    g.addColorStop(0.16, '#b4b4b4');
    g.addColorStop(0.45, '#2a2a2a');
    g.addColorStop(1.00, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);

    ctx.save();
    ctx.translate(64, 64);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      const ray = ctx.createLinearGradient(0, 0, 60, 0);
      ray.addColorStop(0.00, '#8a8a8a');
      ray.addColorStop(0.22, '#242424');
      ray.addColorStop(1.00, '#000000');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(0, -2.6);
      ctx.lineTo(60, 0);
      ctx.lineTo(0, 2.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  });
}

/** Deterministic little PRNG so the star field is the same every visit. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HERO_TINTS = [
  [1.00, 0.90, 0.68],
  [0.70, 0.84, 1.00],
  [1.00, 1.00, 1.00],
  [1.00, 0.78, 0.84],
  [0.82, 1.00, 0.94],
];

export class Sky {
  constructor() {
    this.group = new THREE.Group();

    const blob = blobTexture();
    const glint = glintTexture();

    // Sizes and brightnesses are tuned for the soft masks above: a sprite
    // whose falloff eats most of its own disc needs both to be generous.
    this.starMat = this.field(rng(20240823), 5400, blob, {
      radius: SKY_RADIUS * 0.93,
      size: [2.4, 7.6],
      brightness: [1.30, 3.60],
      bandShare: 0.42,
      order: -999,
    });
    this.heroMat = this.field(rng(77123), 62, glint, {
      radius: SKY_RADIUS * 0.92,
      size: [12.0, 26.0],
      brightness: [3.20, 6.50],
      bandShare: 0.12,
      hero: true,
      order: -998,
    });
  }

  /** Builds one Points layer and returns its material (for the time uniform). */
  field(rand, count, map, opts) {
    // The plane the Milky Way runs along. Crowding part of the field onto
    // it is the only structure left in this sky, and it is made of stars
    // rather than of a wash, which is the point.
    const band = new THREE.Vector3(0.86, -0.38, 0.34).normalize();
    const u1 = new THREE.Vector3(1, 0, 0).cross(band).normalize();
    const u2 = new THREE.Vector3().crossVectors(band, u1);
    const dir = new THREE.Vector3();

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      if (rand() < opts.bandShare) {
        // Crowd part of the field into the galaxy band.
        const a = rand() * Math.PI * 2;
        dir.copy(u1).multiplyScalar(Math.cos(a))
          .addScaledVector(u2, Math.sin(a))
          .addScaledVector(band, (rand() + rand() + rand() - 1.5) * 0.62);
      } else {
        const z = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(Math.max(1 - z * z, 0));
        dir.set(Math.cos(a) * rr, z, Math.sin(a) * rr);
      }
      dir.normalize().multiplyScalar(opts.radius);
      pos[i * 3 + 0] = dir.x;
      pos[i * 3 + 1] = dir.y;
      pos[i * 3 + 2] = dir.z;

      // Small stars skew tiny; a few get to be noticeably larger.
      const s = rand();
      size[i] = THREE.MathUtils.lerp(opts.size[0], opts.size[1], opts.hero ? s : s * s * s);
      phase[i] = rand();

      const b = THREE.MathUtils.lerp(opts.brightness[0], opts.brightness[1], rand());
      let tint;
      if (opts.hero) {
        tint = HERO_TINTS[Math.floor(rand() * HERO_TINTS.length)];
      } else {
        // Mostly white, faintly cast warm or cool.
        const w = (rand() - 0.5) * 0.24;
        tint = [1 + w, 1, 1 - w * 0.8];
      }
      col[i * 3 + 0] = tint[0] * b;
      col[i * 3 + 1] = tint[1] * b;
      col[i * 3 + 2] = tint[2] * b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uMap: { value: map },
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = opts.order;
    this.group.add(points);
    return mat;
  }

  /** Point sprites are sized in device pixels, so they track the backing store. */
  setPixelScale(scale) {
    this.starMat.uniforms.uScale.value = scale;
    this.heroMat.uniforms.uScale.value = scale;
  }

  update(time) {
    this.starMat.uniforms.uTime.value = time;
    this.heroMat.uniforms.uTime.value = time;
  }
}
