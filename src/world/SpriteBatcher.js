import * as THREE from 'three';

/**
 * Instanced pixel-sprite billboards, ported from the game. "Up" is the
 * radial direction from the planet's centre, so a tree on the far side of
 * the world stands upside down relative to this one, exactly as it should.
 *
 * The game fades `uGrow` with approach distance — from orbit a forest is
 * paint on the terrain, on the low pass it stands up. This piece is ALWAYS
 * at orbit, and the forests are the point, so grow is pinned at 1 and only
 * moves when a world is coming apart.
 */

const VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec2 aScale;
attribute float aPhase;
attribute float aShade;
attribute vec3 aRegion;
uniform float uTime;
uniform float uWind;
uniform float uGrow;
varying vec2 vUv;
varying float vShade;
varying vec3 vRegion;
void main() {
  vUv = uv;
  vShade = aShade;
  vRegion = aRegion;
  vec4 base4 = modelMatrix * vec4(aOffset, 1.0);
  vec3 base = base4.xyz;
  float mScale = length(modelMatrix[0].xyz);
  vec3 center = modelMatrix[3].xyz;

  vec3 up = base - center;
  float ul = length(up);
  up = ul > 1e-4 ? up / ul : vec3(0.0, 1.0, 0.0);

  vec3 toCam = cameraPosition - base;
  vec3 right = cross(up, toCam);
  float rl = length(right);
  // Looking straight down the sprite's axis: any tangent will do.
  right = rl > 1e-4 ? right / rl : normalize(abs(up.y) < 0.9 ? cross(up, vec3(0.0, 1.0, 0.0)) : vec3(1.0, 0.0, 0.0));

  float sway = sin(uTime * 1.4 + aPhase) * uWind * position.y * abs(aScale.y) * 0.05;
  vec2 plane = position.xy * aScale * uGrow;
  vec3 world = base + (right * (plane.x + sway * uGrow) + up * plane.y) * mScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
varying vec2 vUv;
varying float vShade;
varying vec3 vRegion;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  gl_FragColor = vec4(tex.rgb * uTint * vRegion * vShade, 1.0);
}
`;

export class SpriteBatcher {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: 1 },
      uGrow: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    };
    this.base = new THREE.PlaneGeometry(1, 1);
    this.base.translate(0, 0.5, 0);
  }

  addBatch(parent, sprite, items) {
    if (items.length === 0) return;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = this.base.index;
    geo.setAttribute('position', this.base.getAttribute('position'));
    geo.setAttribute('uv', this.base.getAttribute('uv'));
    geo.instanceCount = items.length;

    const offsets = new Float32Array(items.length * 3);
    const scales = new Float32Array(items.length * 2);
    const phases = new Float32Array(items.length);
    const shades = new Float32Array(items.length);
    const regions = new Float32Array(items.length * 3);
    const aspect = sprite.width / sprite.height;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      offsets[i * 3] = it.x;
      offsets[i * 3 + 1] = it.y;
      offsets[i * 3 + 2] = it.z;
      scales[i * 2] = it.height * aspect * (it.widthMul ?? 1) * (it.flip ? -1 : 1);
      scales[i * 2 + 1] = it.height;
      phases[i] = (it.x * 13.7 + it.z * 7.3) % (Math.PI * 2);
      shades[i] = it.shade ?? 1;
      regions[i * 3] = it.region ? it.region.r : 1;
      regions[i * 3 + 1] = it.region ? it.region.g : 1;
      regions[i * 3 + 2] = it.region ? it.region.b : 1;
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(shades, 1));
    geo.setAttribute('aRegion', new THREE.InstancedBufferAttribute(regions, 3));

    const u = this.uniforms;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: sprite.texture },
        uTime: u.uTime,
        uWind: u.uWind,
        uGrow: u.uGrow,
        uTint: u.uTint,
      },
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    parent.add(mesh);
  }

  update(time, grow) {
    this.uniforms.uTime.value = time;
    this.uniforms.uGrow.value = grow;
  }
}
