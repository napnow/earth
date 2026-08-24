import * as THREE from 'three';

/**
 * The finish, and most of the look.
 *
 * The scene is rendered into a small square target — a few hundred rows, no
 * antialiasing — and then blown back up with nearest sampling. That single
 * decision is what makes this read as a PlayStation-era picture: chunky
 * texels, stair-stepped edges, sprites that shimmer as they turn, and a
 * forest that averages into paint instead of confetti. It is also exactly
 * what the game this borrows its world from does.
 *
 * On top of that, the tube: ordered dither and a hard colour ladder, then
 * scanlines locked to the low-res rows, an aperture grille, barrel
 * curvature, a slow roll bar and a darkened bezel.
 */

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    // Soft knee so the bloom eases in instead of switching on.
    float s = clamp((l - uThreshold + uKnee) / (2.0 * uKnee), 0.0, 1.0);
    float w = max(s * s * uKnee, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    // Nine taps, linear-sampled in pairs: a wide, cheap gaussian.
    vec3 c = texture2D(uMap, vUv).rgb * 0.2270270270;
    c += texture2D(uMap, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(uMap, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(uMap, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(uMap, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const SCREEN_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  uniform sampler2D uBloom1;
  uniform sampler2D uBloom2;
  uniform sampler2D uBloom3;
  uniform sampler2D uDither;
  uniform vec2 uLow;         // internal resolution, in texels
  uniform float uOut;        // output resolution, in pixels
  uniform float uBloom;
  uniform float uExposure;
  uniform float uKnee;
  uniform float uSaturation;
  uniform float uLevels;
  uniform float uDitherAmt;
  uniform float uGrain;
  uniform float uAberration;
  uniform float uCurve;
  uniform float uScan;
  uniform float uMask;
  uniform float uMaskPitch;
  uniform float uRoll;
  uniform float uVignette;
  uniform float uCorner;
  uniform float uGlitch;     // 0 the picture is fine .. 1 the picture is not
  uniform float uTime;
  varying vec2 vUv;

  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055,
               step(vec3(0.0031308), c));
  }

  /**
   * A shoulder, not a tone map. The world is painted rather than lit — its
   * colours are already the colours it is meant to be — so anything that
   * rolls the midtones pushes the whole planet off its palette. Identity
   * below the knee; only what is above it gets caught.
   */
  vec3 shoulder(vec3 x) {
    vec3 over = max(x - uKnee, 0.0);
    return min(x, uKnee) + (1.0 - uKnee) * (1.0 - exp(-over / max(1.0 - uKnee, 1e-3)));
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float hash11(float x) {
    return fract(sin(x * 91.3458) * 47453.5453);
  }

  /** Barrel distortion — the glass is not flat. */
  vec2 curve(vec2 uv) {
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + uCurve * r2;
    return c * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = curve(vUv);

    // --- loss of sync -----------------------------------------------------
    // Whole bands of the picture slide sideways, the frame walks up and down,
    // and the colour guns stop agreeing. Driven by the world coming apart, so
    // the signal fails at exactly the moment the ground does.
    float g = uGlitch;
    if (g > 0.001) {
      float t = floor(uTime * 22.0);
      float band = floor(uv.y * 34.0);
      float pick = hash11(band + t * 7.3);
      float slide = (hash11(band * 3.1 + t) - 0.5) * step(0.62, pick);
      uv.x += slide * g * 0.09;
      uv.y += (hash11(t * 1.7) - 0.5) * g * 0.020;
      uv.x += sin(uv.y * 90.0 + uTime * 30.0) * g * 0.004;
    }

    // Past the edge of the tube there is only the bezel.
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // A hair of lateral colour, only out toward the corners — and a great
    // deal more of it while the signal is failing.
    vec2 off = (uv - 0.5) * uAberration * (1.0 + 14.0 * g) + vec2(g * g * 0.012, 0.0);
    vec3 c;
    c.r = texture2D(uScene, uv + off).r;
    c.g = texture2D(uScene, uv).g;
    c.b = texture2D(uScene, uv - off).b;

    vec3 b = texture2D(uBloom1, uv).rgb * 0.46
           + texture2D(uBloom2, uv).rgb * 0.32
           + texture2D(uBloom3, uv).rgb * 0.30;
    c += b * uBloom;

    c = shoulder(c * uExposure);
    // The barest S-curve. Space wants deep shadows, but the ground's own
    // palette should survive the trip.
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.07);
    // The ladder and the grille both eat a little chroma; give it back.
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(lum), c, uSaturation);
    c = toSRGB(max(c, 0.0));

    // Ordered dither in LOW-RES texel space, then the hard colour ladder.
    // One shared set of steps under everything in frame is most of why the
    // game's worlds read as painted rather than rendered.
    float bay = texture2D(uDither, uv * uLow / 8.0).r;
    c = clamp(c + (bay - 0.5) * uDitherAmt / uLevels, 0.0, 1.0);
    c = floor(c * (uLevels - 1.0) + 0.5) / (uLevels - 1.0);

    // --- the tube ---------------------------------------------------------

    // Scanlines locked to the internal rows: one dark gap per rendered line.
    float scan = 0.5 + 0.5 * cos(uv.y * uLow.y * 6.2831853);
    c *= 1.0 - uScan * scan;

    // Aperture grille: neighbouring stripes favour a different phosphor.
    float stripe = floor(mod(uv.x * uOut / uMaskPitch, 3.0));
    vec3 grille = vec3(
      stripe < 0.5 ? 1.0 : 0.62,
      (stripe > 0.5 && stripe < 1.5) ? 1.0 : 0.62,
      stripe > 1.5 ? 1.0 : 0.62);
    c *= mix(vec3(1.0), grille, uMask);

    // A slow bright roll, the way a camera pointed at a CRT never quite
    // syncs. One pass per twenty seconds — the piece's own period — so it
    // does not jump when the loop comes round.
    float rollY = fract(uv.y * 0.5 - uTime * 0.05);
    c *= 1.0 + uRoll * smoothstep(0.06, 0.0, abs(rollY - 0.5) - 0.03);

    // Corner rounding and the glass falloff.
    vec2 q = abs(uv * 2.0 - 1.0);
    float corner = length(max(q - (1.0 - uCorner), 0.0)) / max(uCorner, 1e-4);
    c *= 1.0 - smoothstep(0.75, 1.0, corner);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(uv - 0.5) * 2.0);

    // Grain last, so it survives to the buffer — and snow on top of it when
    // the picture is coming apart.
    float n = hash12(uv * uOut + vec2(uTime * 61.0, uTime * 37.0));
    c += (n - 0.5) * (uGrain + g * 0.34);
    c *= 1.0 + g * 0.22 * (hash11(floor(uTime * 26.0)) - 0.5);

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

function bayer8() {
  let m = [[0, 2], [3, 1]];
  for (let size = 2; size < 8; size *= 2) {
    const next = [];
    for (let y = 0; y < size * 2; y++) next.push(new Array(size * 2));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    }
    m = next;
  }
  const out = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) out[y * 8 + x] = Math.round((m[y][x] / 64) * 255);
  }
  return out;
}

function target(w, h, nearest, extra = {}) {
  const f = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: f,
    magFilter: f,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    ...extra,
  });
}

class Quad {
  constructor(material) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(renderer, to) {
    renderer.setRenderTarget(to ?? null);
    renderer.render(this.scene, this.camera);
  }
}

export class Post {
  constructor(size, opts) {
    this.opts = opts;
    this.low = opts.lowRows;

    const dither = new THREE.DataTexture(bayer8(), 8, 8, THREE.RedFormat, THREE.UnsignedByteType);
    dither.magFilter = THREE.NearestFilter;
    dither.minFilter = THREE.NearestFilter;
    dither.wrapS = dither.wrapT = THREE.RepeatWrapping;
    dither.needsUpdate = true;

    // Nearest on the scene target: the upscale must stair-step, not smear.
    this.sceneRT = target(this.low, this.low, true, { depthBuffer: true });
    this.levels = [];

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.sceneRT.texture },
        uThreshold: { value: opts.bloomThreshold },
        uKnee: { value: 0.35 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uStep: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.screenMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: this.sceneRT.texture },
        uBloom1: { value: null },
        uBloom2: { value: null },
        uBloom3: { value: null },
        uDither: { value: dither },
        uLow: { value: new THREE.Vector2(this.low, this.low) },
        uOut: { value: size },
        uBloom: { value: opts.bloomStrength },
        uExposure: { value: opts.exposure },
        uKnee: { value: opts.knee },
        uSaturation: { value: opts.saturation },
        uLevels: { value: opts.levels },
        uDitherAmt: { value: opts.dither },
        uGrain: { value: opts.grain },
        uAberration: { value: opts.aberration },
        uCurve: { value: opts.curve },
        uScan: { value: opts.scanlines },
        uMask: { value: opts.grille },
        uMaskPitch: { value: opts.grillePitch },
        uRoll: { value: opts.roll },
        uVignette: { value: opts.vignette },
        uCorner: { value: opts.corner },
        uGlitch: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: SCREEN_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.bright = new Quad(this.brightMat);
    this.blur = new Quad(this.blurMat);
    this.screen = new Quad(this.screenMat);

    this.buildLevels();
    this.setSize(size);
  }

  /** The internal square resolution everything is actually drawn at. */
  get lowRes() {
    return this.low;
  }

  buildLevels() {
    for (const lv of this.levels) {
      lv.a.dispose();
      lv.b.dispose();
    }
    this.levels = [];
    for (let i = 1; i <= 3; i++) {
      const s = Math.max(4, Math.round(this.low / Math.pow(2, i)));
      this.levels.push({ size: s, a: target(s, s, false), b: target(s, s, false) });
    }
    this.screenMat.uniforms.uBloom1.value = this.levels[0].a.texture;
    this.screenMat.uniforms.uBloom2.value = this.levels[1].a.texture;
    this.screenMat.uniforms.uBloom3.value = this.levels[2].a.texture;
  }

  /** How badly the picture is holding together, 0..1. */
  setGlitch(v) {
    this.screenMat.uniforms.uGlitch.value = v;
  }

  /** Only the OUTPUT size changes with the window; the internal one is fixed. */
  setSize(size) {
    this.size = size;
    this.screenMat.uniforms.uOut.value = size;
  }

  render(renderer, scene, camera, time) {
    renderer.setRenderTarget(this.sceneRT);
    renderer.render(scene, camera);

    // Level 1 takes the bright pass; every level after it blurs the level
    // above at half the size. Each ping-pongs a -> b -> a twice, ending in a.
    let source = this.sceneRT.texture;
    for (let i = 0; i < this.levels.length; i++) {
      const lv = this.levels[i];
      if (i === 0) {
        this.brightMat.uniforms.uMap.value = source;
        this.bright.render(renderer, lv.a);
      } else {
        this.blurMat.uniforms.uMap.value = source;
        this.blurMat.uniforms.uStep.value.set(1 / this.levels[i - 1].size, 0);
        this.blur.render(renderer, lv.a);
      }
      for (let pass = 0; pass < 2; pass++) {
        this.blurMat.uniforms.uMap.value = lv.a.texture;
        this.blurMat.uniforms.uStep.value.set(1 / lv.size, 0);
        this.blur.render(renderer, lv.b);
        this.blurMat.uniforms.uMap.value = lv.b.texture;
        this.blurMat.uniforms.uStep.value.set(0, 1 / lv.size);
        this.blur.render(renderer, lv.a);
      }
      source = lv.a.texture;
    }

    this.screenMat.uniforms.uTime.value = time;
    this.screen.render(renderer, null);
  }
}
