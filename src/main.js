import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Sky } from './sky.js';
import { WorldCycle } from './world/WorldCycle.js';
import { Post } from './render/post.js';

/**
 * The Circling — a single fixed-camera artwork, 1:1.
 *
 * One world, turning, grown by the game's own world builder: an unlit
 * patchwork of painted faces, seas, cloud banks and pixel-sprite forests.
 * Every few seconds it lets go of itself, drifts apart into a cloud of
 * coloured motes, and settles as a different world.
 *
 * Everything reaches the screen through a small target and a cathode ray
 * tube. The camera never moves.
 */

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,          // the whole point is that it is NOT antialiased
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);   // the backing store is sized by hand below
renderer.toneMapping = THREE.NoToneMapping;   // the grade pass does its own
// Flat, and the only ground this picture has. No gradient in the space.
renderer.setClearColor(0x02030a, 1);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far,
);
camera.position.set(...CONFIG.camera.position);
camera.lookAt(new THREE.Vector3(...CONFIG.camera.lookAt));
camera.updateMatrixWorld(true);

// ---------------------------------------------------------------- pieces

const sky = new Sky();
scene.add(sky.group);

const worlds = new WorldCycle();
scene.add(worlds.group);

// ---------------------------------------------------------------- light

// The ground is painted, not lit. These reach only what stands on and above
// it — the cloud decks, the crystal, the rock — so they are here to give
// those things a lit side and a shaded one, and nothing else.
const sunDir = new THREE.Vector3(...CONFIG.sun).normalize();

const key = new THREE.DirectionalLight(0xfff3de, 2.6);
key.position.copy(sunDir).multiplyScalar(1000);
scene.add(key);

const fill = new THREE.DirectionalLight(0x6a86c8, 0.55);
fill.position.copy(sunDir).multiplyScalar(-800).add(new THREE.Vector3(0, 300, 400));
scene.add(fill);

const ambient = new THREE.AmbientLight(0x4a5a84, 1.05);
scene.add(ambient);

// ---------------------------------------------------------------- output

/**
 * The artwork is square. The page letterboxes it with CSS; this decides how
 * many device pixels that square is presented at. What it is DRAWN at is
 * `render.lowRows`, and that never changes.
 */
function measure() {
  const css = Math.min(window.innerWidth, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.max(360, Math.min(Math.round(css * dpr), CONFIG.render.maxPixels));
}

let size = measure();
const post = new Post(size, CONFIG.render);

function apply() {
  renderer.setSize(size, size, false);
  post.setSize(size);
  // Point sprites are sized in the pixels of the target they are drawn into,
  // which is the small one — not the canvas.
  const low = post.lowRes;
  sky.setPixelScale(low / 1000);
  worlds.setProjectionScale(low / (2 * Math.tan((CONFIG.camera.fov * Math.PI) / 360)));
}
apply();

window.addEventListener('resize', () => {
  const next = measure();
  if (next === size) return;
  size = next;
  apply();
});

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
let time = 0;
let frames = 0;
const curtain = document.getElementById('curtain');

/** Simulation and drawing are split so the piece can be driven by hand. */
function advance(dt) {
  time += dt;
  sky.update(time);
  worlds.update(dt);
  key.color.copy(worlds.sun);
  post.setGlitch(worlds.glitch);
  // The plaque types in when a new world has settled (hold begins), and
  // fades out as the world starts to come apart.
  const settled = worlds.phase === 'hold' && worlds.phaseT > 0.5 && frames > 90;
  const plq = document.getElementById('plaque');
  if (settled && worlds._plaquedFor !== worlds.index) {
    worlds._plaquedFor = worlds.index;
    plq.classList.add('show');
    plq.classList.remove('typed');
    window.__plaque(
      worlds.index,
      worlds.worldName,
      Boolean(worlds.spec.civilization),
    );
    setTimeout(() => plq.classList.add('typed'), 1400);
  } else if (worlds.phase === 'change') {
    plq.classList.remove('show', 'typed');
    worlds._plaquedFor = undefined;
  }
}

function draw() {
  post.render(renderer, scene, camera, time);
  // Hold the curtain until the first world has grown in — the coarse
  // silhouette it starts as is not the first thing anyone should see. The
  // frame count is a floor under it in case a build ever stalls.
  frames++;
  if (worlds.current.ready || frames > 240) curtain.classList.add('lifted');
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (document.hidden) return;
  advance(dt);
  draw();
});

// A hand-hold for tuning the composition from the console.
window.__art = {
  CONFIG, renderer, scene, camera, worlds, sky, post, advance, draw,
  get world() { return worlds.worldName; },
};
