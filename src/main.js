
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// =====================================================================
// CONFIG – tweak the feel of the game here
// =====================================================================
const CONFIG = {
  // Drop a rigged/animated GLB (e.g. from Meshy or Tripo) at this path to replace
  // the built-in runner. Clips whose names contain "run"/"walk", "jump" and
  // "roll"/"slide" are picked up automatically. Set to '' to always use the built-in runner.
  playerModel: 'assets/player.glb',
  playerModelHeight: 1.8,
  playerModelRotationY: Math.PI,

  laneWidth: 2.4,
  startSpeed: 15,
  maxSpeed: 36,
  acceleration: 0.22,
  gravity: 42,
  jumpVelocity: 13.5,
  rollDuration: 0.7,
  movingTrainSpeed: 9,
};

// =====================================================================
// Constants & helpers
// =====================================================================
const LANE_W = CONFIG.laneWidth;
const TRAIN_H = 3.0;
const TRAIN_W = 2.1;
const RAMP_LEN = 7;
const TILE_LEN = 40;
const NUM_TILES = 6;
const SPAWN_AHEAD = 170;
const DESPAWN_BEHIND = 20;
const PLAYER_HALF_W = 0.32;
const PLAYER_HALF_D = 0.3;
const STAND_H = 1.75;
const ROLL_H = 0.9;
const TOP_SNAP = 0.45;

const laneX = (l) => (l - 1) * LANE_W;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weighted(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = Math.random() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0 && weights[k] > 0) return k;
  }
  return 'low';
}

// =====================================================================
// Renderer, scene, camera, lights
// =====================================================================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const SKY = 0x9fd8ff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 55, 170);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);

// Aproximação leve da câmera
camera.position.set(0, 4.3, 7.2);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.7));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 30, bottom: -30, near: 1, far: 90 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
// Procedural textures & materials
// =====================================================================
function canvasTexture(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

function stripes(colA, colB) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = colA;
    g.fillRect(0, 0, w, h);
    g.fillStyle = colB;
    for (let x = -h; x < w + h; x += 64) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + h, 0);
      g.lineTo(x + h + 32, 0);
      g.lineTo(x + 32, h);
      g.fill();
    }
  });
}

const gravelTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#9a8f80';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    const v = 110 + Math.random() * 90;
    g.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}, 8, 6);

const windowsTex = canvasTexture(128, 256, (g, w, h) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  for (let y = 12; y < h - 10; y += 28) {
    for (let x = 10; x < w - 10; x += 30) {
      g.fillStyle = Math.random() < 0.3 ? '#fff1b8' : '#5d7088';
      g.fillRect(x, y, 18, 16);
    }
  }
});

const std = (o) => new THREE.MeshStandardMaterial(o);
const MAT = {
  gravel: std({ map: gravelTex, roughness: 1 }),
  bed: std({ color: 0x6b5847, roughness: 1 }),
  rail: std({ color: 0xc9ced6, metalness: 0.8, roughness: 0.3 }),
  sleeper: std({ color: 0x5a4030, roughness: 0.9 }),
  wall: std({ color: 0xb9b3a8, roughness: 0.95 }),
  wallTop: std({ color: 0x8f8a80, roughness: 0.95 }),
  buildings: [0xf2c6a0, 0xd98e73, 0xa7c4d9, 0xe8dcc0, 0xc7a6d9, 0x9fd1b5, 0xf0a1a1].map(
    (c) => std({ color: c, map: windowsTex, roughness: 0.9 })
  ),
  trains: [0x2f7de1, 0xe24b3b, 0x2bb673, 0xf2a72e, 0x8e5bd6].map((c) =>
    std({ color: c, roughness: 0.45, metalness: 0.25 })
  ),
  trainDark: std({ color: 0x1d2533, roughness: 0.7 }),
  trainWindow: std({ color: 0x9fd0ff, emissive: 0x1a3550, roughness: 0.15, metalness: 0.3 }),
  headlight: new THREE.MeshBasicMaterial({ color: 0xfff3a0 }),
  headlightHot: new THREE.MeshBasicMaterial({ color: 0xff5533 }),
  ramp: std({ color: 0x8c929c, roughness: 0.8, metalness: 0.2 }),
  post: std({ color: 0x555c66, roughness: 0.6, metalness: 0.4 }),
  stripeRW: std({ map: stripes('#ffffff', '#e8262b'), roughness: 0.6 }),
  stripeYB: std({ map: stripes('#ffd21a', '#1b1b1b'), roughness: 0.6 }),
  coin: std({ color: 0xffc61a, emissive: 0xb07000, emissiveIntensity: 0.6, metalness: 0.35, roughness: 0.3 }),
  hoodie: std({ color: 0xff7a1a, roughness: 0.8 }),
  pants: std({ color: 0x2b4c8c, roughness: 0.85 }),
  skin: std({ color: 0xf1c27d, roughness: 0.7 }),
  cap: std({ color: 0xe8253b, roughness: 0.6 }),
  shoe: std({ color: 0xffffff, roughness: 0.6 }),
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function box(mat, sx, sy, sz, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// =====================================================================
// World tiles (ground, rails, walls, buildings) – recycled endlessly
// =====================================================================
const SLEEPERS_PER_LANE = 20;
const sleeperGeo = new THREE.BoxGeometry(1.9, 0.1, 0.35);
const groundGeo = new THREE.PlaneGeometry(70, TILE_LEN).rotateX(-Math.PI / 2);
const tiles = [];

function makeTile() {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(groundGeo, MAT.gravel);
  ground.receiveShadow = true;
  g.add(ground);
  g.add(box(MAT.bed, LANE_W * 3 + 0.6, 0.04, TILE_LEN, 0, 0.02, 0, false));

  const sleepers = new THREE.InstancedMesh(sleeperGeo, MAT.sleeper, 3 * SLEEPERS_PER_LANE);
  const m = new THREE.Matrix4();
  let i = 0;

  for (let l = 0; l < 3; l++) {
    g.add(box(MAT.rail, 0.1, 0.14, TILE_LEN, laneX(l) - 0.72, 0.1, 0, false));
    g.add(box(MAT.rail, 0.1, 0.14, TILE_LEN, laneX(l) + 0.72, 0.1, 0, false));

    for (let k = 0; k < SLEEPERS_PER_LANE; k++) {
      m.makeTranslation(laneX(l), 0.05, -TILE_LEN / 2 + (k + 0.5) * (TILE_LEN / SLEEPERS_PER_LANE));
      sleepers.setMatrixAt(i++, m);
    }
  }

  sleepers.receiveShadow = true;
  g.add(sleepers);

  const wallX = LANE_W * 1.5 + 0.9;

  for (const s of [-1, 1]) {
    g.add(box(MAT.wall, 0.5, 1.4, TILE_LEN, s * wallX, 0.7, 0));
    g.add(box(MAT.wallTop, 0.7, 0.15, TILE_LEN, s * wallX, 1.45, 0));
  }

  g.userData.buildings = [];

  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const b = box(MAT.buildings[0], 1, 1, 1, 0, 0, 0, false);
      b.userData = { side: s, slot: k };
      g.add(b);
      g.userData.buildings.push(b);
    }
  }

  randomizeBuildings(g);
  scene.add(g);
  return g;
}

function randomizeBuildings(tile) {
  for (const b of tile.userData.buildings) {
    const w = rand(6, 11);
    const h = rand(7, 24);
    const d = rand(7, 9.5);
    b.material = pick(MAT.buildings);
    b.scale.set(w, h, d);
    b.position.set(b.userData.side * (6.2 + w / 2 + rand(0, 2.5)), h / 2, -TILE_LEN / 2 + b.userData.slot * 10 + 5);
  }
}

for (let i = 0; i < NUM_TILES; i++) tiles.push(makeTile());

// =====================================================================
// Obstacles: trains, ramps, barriers
// =====================================================================
const rampShape = new THREE.Shape();
rampShape.moveTo(0, 0);
rampShape.lineTo(0, TRAIN_H);
rampShape.lineTo(RAMP_LEN, 0);
rampShape.closePath();

const rampGeo = new THREE.ExtrudeGeometry(rampShape, { depth: TRAIN_W - 0.1, bevelEnabled: false });
rampGeo.rotateY(-Math.PI / 2);
rampGeo.translate((TRAIN_W - 0.1) / 2, 0, 0);

function makeTrain(L, withRamp, moving) {
  const g = new THREE.Group();
  const body = pick(MAT.trains);
  const bodyH = TRAIN_H - 0.35;

  g.add(box(body, TRAIN_W, bodyH, L, 0, 0.35 + bodyH / 2, -L / 2));
  g.add(box(MAT.trainDark, TRAIN_W - 0.3, 0.35, L - 0.6, 0, 0.175, -L / 2));

  for (const s of [-1, 1]) {
    g.add(box(MAT.trainWindow, 0.04, 0.7, L - 1.6, s * (TRAIN_W / 2 + 0.01), 2.05, -L / 2, false));
    g.add(box(MAT.trainDark, 0.04, 0.12, L - 0.4, s * (TRAIN_W / 2 + 0.01), 1.1, -L / 2, false));
  }

  g.add(box(MAT.trainWindow, TRAIN_W - 0.5, 0.8, 0.04, 0, 2.1, 0.01, false));
  g.add(box(MAT.trainDark, TRAIN_W - 0.4, 0.05, L - 0.4, 0, TRAIN_H + 0.02, -L / 2, false));

  const lightMat = moving ? MAT.headlightHot : MAT.headlight;

  for (const s of [-1, 1]) {
    g.add(box(lightMat, 0.32, 0.22, 0.05, s * 0.65, 0.9, 0.02, false));
  }

  if (withRamp) {
    const ramp = new THREE.Mesh(rampGeo, MAT.ramp);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    g.add(ramp);
  }

  return g;
}

function makeLowBarrier() {
  const g = new THREE.Group();

  for (const s of [-1, 1]) {
    g.add(box(MAT.post, 0.12, 1.0, 0.12, s * 0.95, 0.5, 0));
  }

  g.add(box(MAT.stripeRW, 2.0, 0.42, 0.12, 0, 0.78, 0));
  g.add(box(MAT.post, 2.0, 0.1, 0.1, 0, 0.25, 0));

  return g;
}

function makeHighBarrier() {
  const g = new THREE.Group();

  for (const s of [-1, 1]) {
    g.add(box(MAT.post, 0.14, 2.9, 0.14, s * 1.05, 1.45, 0));
  }

  g.add(box(MAT.stripeYB, 2.0, 1.35, 0.1, 0, 2.05, 0));

  return g;
}

const coinGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.09, 24).rotateX(Math.PI / 2);

// =====================================================================
// Player
// =====================================================================
function makeRunner() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  body.add(box(MAT.hoodie, 0.7, 0.72, 0.42, 0, 1.17, 0));
  body.add(box(MAT.skin, 0.44, 0.44, 0.42, 0, 1.78, 0));
  body.add(box(MAT.cap, 0.48, 0.14, 0.46, 0, 2.0, 0));
  body.add(box(MAT.cap, 0.4, 0.05, 0.25, 0, 1.95, 0.3));

  const limb = (mat, w, h, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(box(mat, w, h, w, 0, -h / 2, 0));
    body.add(pivot);
    return pivot;
  };

  const armL = limb(MAT.hoodie, 0.18, 0.66, -0.45, 1.5);
  const armR = limb(MAT.hoodie, 0.18, 0.66, 0.45, 1.5);
  const legL = limb(MAT.pants, 0.24, 0.8, -0.18, 0.82);
  const legR = limb(MAT.pants, 0.24, 0.8, 0.18, 0.82);

  legL.add(box(MAT.shoe, 0.28, 0.14, 0.38, 0, -0.78, -0.05));
  legR.add(box(MAT.shoe, 0.28, 0.14, 0.38, 0, -0.78, -0.05));

  scene.add(root);

  return { root, body, armL, armR, legL, legR };
}

const runner = makeRunner();

// Optional GLB character
let glb = null;

if (CONFIG.playerModel) {
  new GLTFLoader().load(
    CONFIG.playerModel,
    (gltf) => {
      const model = gltf.scene;

      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      const inner = new THREE.Group();
      inner.add(model);

      let bb = new THREE.Box3().setFromObject(model);
      const size = bb.getSize(new THREE.Vector3());

      model.scale.setScalar(CONFIG.playerModelHeight / (size.y || 1));

      bb = new THREE.Box3().setFromObject(model);
      const c = bb.getCenter(new THREE.Vector3());

      model.position.set(-c.x, -bb.min.y, -c.z);

      const pivot = new THREE.Group();
      pivot.add(inner);
      inner.rotation.y = CONFIG.playerModelRotationY;

      runner.root.add(pivot);
      runner.body.visible = false;

      const mixer = new THREE.AnimationMixer(model);
      const clips = gltf.animations || [];

      const find = (...names) => clips.find((cl) =>
        names.some((n) => cl.name.toLowerCase().includes(n))
      );

      const actions = {};
      const runClip = find('run', 'sprint', 'jog', 'walk') || clips[0];
      const jumpClip = find('jump');
      const rollClip = find('roll', 'slide', 'crouch');

      if (runClip) actions.run = mixer.clipAction(runClip);
      if (jumpClip) actions.jump = mixer.clipAction(jumpClip);
      if (rollClip) actions.roll = mixer.clipAction(rollClip);

      if (actions.run) actions.run.play();

      glb = { pivot, mixer, actions, current: actions.run || null };

      console.info(`[runner] Loaded ${CONFIG.playerModel} with clips:`, clips.map((cl) => cl.name));
    },
    undefined,
    () => console.info(`[runner] No model at ${CONFIG.playerModel} – using the built-in runner.`)
  );
}

function playGlbAction(name) {
  if (!glb) return;

  const next = glb.actions[name] || glb.actions.run;

  if (!next || next === glb.current) return;

  next.reset().fadeIn(0.12).play();

  if (glb.current) glb.current.fadeOut(0.12);

  glb.current = next;
}

// =====================================================================
// Audio
// =====================================================================
let actx = null;

function ensureAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {
    actx = null;
  }
}

function beep(freq, dur = 0.08, type = 'square', vol = 0.04, slide = 1) {
  if (!actx) return;

  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();

  o.type = type;
  o.frequency.setValueAtTime(freq, t);

  if (slide !== 1) {
    o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  }

  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// =====================================================================
// Game state
// =====================================================================
const ui = {
  score: document.getElementById('score-hud'),
  coins: document.getElementById('coins-hud'),
  best: document.getElementById('best-hud'),
  menu: document.getElementById('menu'),
  over: document.getElementById('over'),
  finalScore: document.getElementById('final-score'),
  finalCoins: document.getElementById('final-coins'),
  finalBest: document.getElementById('final-best'),
  newBest: document.getElementById('new-best'),
  flash: document.getElementById('flash'),
  loading: document.getElementById('loading'),
};

function loadBest() {
  try {
    return Number(localStorage.getItem('subwayRushBest')) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem('subwayRushBest', String(v));
  } catch {
    // Keep best in memory only.
  }
}

const G = {
  state: 'menu',
  px: 0, py: 0, pz: 0, vy: 0,
  lane: 1, prevLane: 1,
  speed: CONFIG.startSpeed,
  grounded: true,
  rollTimer: 0,
  stumbleTimer: 0,
  crashTimer: 0,
  shake: 0,
  phase: 0,
  coins: 0,
  score: 0,
  best: loadBest(),
  nextRowZ: -45,
  laneEnd: [Infinity, Infinity, Infinity],
  overAt: 0,
};

const obstacles = [];
const coins = [];

ui.best.textContent = `BEST ${G.best}`;

function resetGame() {
  for (const o of obstacles) scene.remove(o.mesh);
  obstacles.length = 0;

  for (const c of coins) scene.remove(c.mesh);
  coins.length = 0;

  Object.assign(G, {
    px: 0, py: 0, pz: 0, vy: 0, lane: 1, prevLane: 1,
    speed: CONFIG.startSpeed, grounded: true, rollTimer: 0, stumbleTimer: 0,
    crashTimer: 0, shake: 0, phase: 0, coins: 0, score: 0, nextRowZ: -45,
    laneEnd: [Infinity, Infinity, Infinity],
  });

  tiles.forEach((t, i) => {
    t.position.z = TILE_LEN - i * TILE_LEN;
    randomizeBuildings(t);
  });

  runner.root.rotation.set(0, 0, 0);
  runner.root.position.set(0, 0, 0);
  runner.body.scale.set(1, 1, 1);

  if (glb) glb.pivot.scale.set(1, 1, 1);

  playGlbAction('run');
  spawnAhead();
}

function startGame() {
  ensureAudio();
  resetGame();
  G.state = 'playing';
  ui.menu.classList.add('hidden');
  ui.over.classList.add('hidden');
  beep(520, 0.1, 'square', 0.04, 1.5);
}

function gameOver() {
  G.state = 'over';
  G.overAt = performance.now();

  const isBest = G.score > G.best;

  if (isBest) {
    G.best = G.score;
    saveBest(G.best);
  }

  ui.finalScore.textContent = G.score;
  ui.finalCoins.textContent = G.coins;
  ui.finalBest.textContent = G.best;
  ui.best.textContent = `BEST ${G.best}`;
  ui.newBest.classList.toggle('hidden', !isBest);
  ui.over.classList.remove('hidden');
}

function flash(opacity = 0.45) {
  ui.flash.style.transition = 'none';
  ui.flash.style.opacity = opacity;

  requestAnimationFrame(() => {
    ui.flash.style.transition = 'opacity .35s';
    ui.flash.style.opacity = 0;
  });
}

function crash() {
  if (G.state !== 'playing') return;

  G.state = 'crashed';
  G.crashTimer = 0.9;
  G.shake = 0.6;

  flash(0.55);
  beep(160, 0.45, 'sawtooth', 0.07, 0.35);
}

function stumble() {
  if (G.stumbleTimer > 0) {
    crash();
    return;
  }

  G.stumbleTimer = 3.5;
  G.shake = 0.35;

  flash(0.3);
  beep(220, 0.2, 'triangle', 0.06, 0.6);
}

// =====================================================================
// Spawning
// =====================================================================
function addCoin(x, y, z) {
  const mesh = new THREE.Mesh(coinGeo, MAT.coin);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  coins.push({ mesh, taken: false, lane: Math.round(x / LANE_W) + 1 });
}

function movingTrainAllowed(lane, z) {
  return !obstacles.some((o) =>
    (o.lane === lane && o.zMax > z - 1) || (o.hard && o.zMin > z)
  );
}

function spawnObstacle(type, lane, z) {
  const x = laneX(lane);
  let o;

  if (type === 'low') {
    o = {
      type, lane, x, w: 2.0,
      y0: 0, y1: 1.0,
      zMin: z - 0.15, zMax: z + 0.15,
      hard: false,
      mesh: makeLowBarrier()
    };

    o.mesh.position.set(x, 0, z);

  } else if (type === 'high') {
    o = {
      type, lane, x, w: 2.0,
      y0: 1.35, y1: 2.75,
      zMin: z - 0.1, zMax: z + 0.1,
      hard: false,
      mesh: makeHighBarrier()
    };

    o.mesh.position.set(x, 0, z);

  } else {
    const L = Math.round(rand(14, 26));
    const ramp = type === 'ramp';
    const moving = type === 'moving';
    const front = ramp ? z - RAMP_LEN : z;

    o = {
      type, lane, x, w: TRAIN_W,
      y0: 0, y1: TRAIN_H - TOP_SNAP,
      zMin: front - L, zMax: front,
      walkTop: TRAIN_H,
      ramp, train: true,
      vz: moving ? CONFIG.movingTrainSpeed : 0,
      hard: !ramp,
      mesh: makeTrain(L, ramp, moving),
    };

    o.mesh.position.set(x, 0, front);

    if (moving) {
      for (const c of coins) {
        if (c.lane === lane && c.mesh.position.z > z - 1) {
          c.taken = true;
          c.mesh.visible = false;
        }
      }
    }
  }

  o.prevZMax = o.zMax;
  scene.add(o.mesh);
  obstacles.push(o);
  G.laneEnd[lane] = Math.min(G.laneEnd[lane], o.zMin);

  return o;
}

function spawnRow(z) {
  const dist = -z;
  const diff = Math.min(1, dist / 1800);
  const free = [0, 1, 2].map((l) => z <= G.laneEnd[l] - 5);
  const lanes = shuffle([0, 1, 2].filter((l) => free[l]));

  if (!lanes.length) return;

  let hardCount = free.filter((f) => !f).length;
  const middleBusy = !free[1];
  const r = Math.random();
  const wanted = r < 0.38 - 0.12 * diff ? 1 : r < 0.85 ? 2 : 3;

  const placed = [];

  for (const lane of lanes.slice(0, wanted)) {
    const canHard = !middleBusy && hardCount < 2;

    const type = weighted({
      low: 0.26,
      high: 0.24,
      ramp: 0.2,
      train: canHard ? 0.2 + 0.1 * diff : 0,
      moving: canHard && dist > 250 && movingTrainAllowed(lane, z) ? 0.05 + 0.12 * diff : 0,
    });

    if (type === 'train' || type === 'moving') hardCount++;

    placed.push(spawnObstacle(type, lane, z));
  }

  placeCoins(z, placed, free);
}

function placeCoins(z, placed, free) {
  if (Math.random() < 0.2) return;

  const options = [];

  for (let l = 0; l < 3; l++) {
    const o = placed.find((p) => p.lane === l);

    if (!o) {
      if (free[l]) options.push({ l, kind: 'line' });
    } else if (o.type === 'low') {
      options.push({ l, kind: 'arc', o });
    } else if (o.type === 'high') {
      options.push({ l, kind: 'under', o });
    } else if (o.type === 'ramp') {
      options.push({ l, kind: 'ramp', o }, { l, kind: 'ramp', o });
    }
  }

  if (!options.length) return;

  const { l, kind, o } = pick(options);
  const x = laneX(l);

  if (kind === 'line') {
    for (let i = 0; i < 7; i++) addCoin(x, 1.0, z + 3 - i * 2.2);

  } else if (kind === 'arc') {
    for (let i = 0; i < 7; i++) {
      const dz = (i - 3) * 1.6;
      addCoin(x, 1.0 + 1.3 * (1 - (dz / 4.8) ** 2), z + dz);
    }

  } else if (kind === 'under') {
    for (let i = 0; i < 5; i++) addCoin(x, 0.55, z + 4 - i * 2);

  } else if (kind === 'ramp') {
    for (const u of [5.6, 4, 2.4, 0.8]) {
      addCoin(x, TRAIN_H * (1 - u / RAMP_LEN) + 1, o.zMax + u);
    }

    for (let zz = o.zMax - 1.5; zz > o.zMin + 1; zz -= 2.4) {
      addCoin(x, TRAIN_H + 1, zz);
    }
  }
}

function spawnAhead() {
  while (G.nextRowZ > G.pz - SPAWN_AHEAD) {
    spawnRow(G.nextRowZ);
    G.nextRowZ -= rand(17, 25) + G.speed * 0.35;
  }
}

// =====================================================================
// Physics helpers
// =====================================================================
function groundAt(px, pz, py) {
  let g = 0;

  for (const o of obstacles) {
    if (!o.train || Math.abs(px - o.x) > o.w / 2) continue;

    if (pz <= o.zMax + 0.2 && pz >= o.zMin - 0.2 && py >= o.walkTop - TOP_SNAP) {
      g = Math.max(g, o.walkTop);
    }

    if (o.ramp) {
      const u = pz - o.zMax;

      if (u >= 0 && u <= RAMP_LEN) {
        const h = o.walkTop * (1 - u / RAMP_LEN);

        if (py >= h - 0.7) g = Math.max(g, h);
      }
    }
  }

  return g;
}

function overlaps(o, px, py, pz, h) {
  return (
    px + PLAYER_HALF_W > o.x - o.w / 2 &&
    px - PLAYER_HALF_W < o.x + o.w / 2 &&
    py + h > o.y0 &&
    py < o.y1 &&
    pz + PLAYER_HALF_D > o.zMin &&
    pz - PLAYER_HALF_D < o.zMax
  );
}

// =====================================================================
// Input
// =====================================================================
function move(dir) {
  if (G.state !== 'playing') return;

  const nl = clamp(G.lane + dir, 0, 2);

  if (nl === G.lane) return;

  G.prevLane = G.lane;
  G.lane = nl;

  beep(380, 0.05, 'triangle', 0.03);
}

function jump() {
  if (G.state !== 'playing' || !G.grounded) return;

  G.vy = CONFIG.jumpVelocity;
  G.grounded = false;
  G.rollTimer = 0;

  beep(440, 0.12, 'square', 0.035, 1.8);
}

function roll() {
  if (G.state !== 'playing') return;

  if (!G.grounded) G.vy = -28;

  G.rollTimer = CONFIG.rollDuration;

  beep(300, 0.12, 'triangle', 0.04, 0.5);
}

window.addEventListener('keydown', (e) => {
  const k = e.code;

  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) {
    e.preventDefault();
  }

  if (G.state === 'menu' || (G.state === 'over' && performance.now() - G.overAt > 400)) {
    if (k === 'Enter' || k === 'Space') startGame();
    return;
  }

  if (k === 'ArrowLeft' || k === 'KeyA') move(-1);
  else if (k === 'ArrowRight' || k === 'KeyD') move(1);
  else if (k === 'ArrowUp' || k === 'KeyW' || k === 'Space') jump();
  else if (k === 'ArrowDown' || k === 'KeyS') roll();
});

let gesture = null;

window.addEventListener('pointerdown', (e) => {
  ensureAudio();
  gesture = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointermove', (e) => {
  if (!gesture || G.state !== 'playing') return;

  const dx = e.clientX - gesture.x;
  const dy = e.clientY - gesture.y;

  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;

  gesture = null;

  if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx));
  else if (dy < 0) jump();
  else roll();
});

window.addEventListener('pointerup', () => (gesture = null));
window.addEventListener('pointercancel', () => (gesture = null));

ui.menu.addEventListener('click', startGame);

ui.over.addEventListener('click', () => {
  if (performance.now() - G.overAt > 400) startGame();
});

// =====================================================================
// Update
// =====================================================================
const tmpLook = new THREE.Vector3();

function updatePlaying(dt) {
  G.speed = Math.min(CONFIG.maxSpeed, G.speed + CONFIG.acceleration * dt);

  const prevPz = G.pz;

  G.pz -= G.speed * dt;
  G.px += (laneX(G.lane) - G.px) * damp(16, dt);
  G.rollTimer = Math.max(0, G.rollTimer - dt);
  G.stumbleTimer = Math.max(0, G.stumbleTimer - dt);

  // moving trains
  for (const o of obstacles) {
    o.prevZMax = o.zMax;

    if (o.vz) {
      const d = o.vz * dt;
      o.zMax += d;
      o.zMin += d;
      o.mesh.position.z += d;
    }
  }

  // vertical physics
  const g = groundAt(G.px, G.pz, G.py);

  if (G.vy > 0 || G.py > g + 0.02) {
    G.vy -= CONFIG.gravity * dt;
    G.py += G.vy * dt;

    if (G.py <= g) {
      G.py = g;
      G.vy = 0;
      G.grounded = true;
    } else {
      G.grounded = false;
    }
  } else {
    G.py = g;
    G.vy = 0;
    G.grounded = true;
  }

  // collisions
  const h = G.rollTimer > 0 ? ROLL_H : STAND_H;

  for (const o of obstacles) {
    if (!overlaps(o, G.px, G.py, G.pz, h)) continue;

    const wasInFront = prevPz - PLAYER_HALF_D >= o.prevZMax - 0.25;

    if (o.train && !wasInFront) {
      const side = Math.sign(G.px - o.x) || 1;
      G.px = o.x + side * (o.w / 2 + PLAYER_HALF_W + 0.02);
      G.lane = G.prevLane;
      stumble();
    } else {
      crash();
    }

    if (G.state !== 'playing') return;
  }

  // coins
  for (const c of coins) {
    if (c.taken) continue;

    const p = c.mesh.position;

    if (
      Math.abs(p.x - G.px) < 0.85 &&
      Math.abs(p.z - G.pz) < 0.9 &&
      Math.abs(p.y - (G.py + h / 2)) < 1.15
    ) {
      c.taken = true;
      c.mesh.visible = false;
      G.coins++;

      beep(1320, 0.07, 'square', 0.025, 1.3);
    }
  }

  G.score = Math.floor(-G.pz);

  spawnAhead();
  recycle();
}

function recycle() {
  const camZ = G.pz + 8;

  for (const t of tiles) {
    if (t.position.z - TILE_LEN / 2 > camZ) {
      t.position.z -= NUM_TILES * TILE_LEN;
      randomizeBuildings(t);
    }
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (obstacles[i].zMin > G.pz + DESPAWN_BEHIND) {
      scene.remove(obstacles[i].mesh);
      obstacles.splice(i, 1);
    }
  }

  for (let i = coins.length - 1; i >= 0; i--) {
    if (coins[i].mesh.position.z > G.pz + DESPAWN_BEHIND) {
      scene.remove(coins[i].mesh);
      coins.splice(i, 1);
    }
  }
}

function animateRunner(dt, t) {
  const r = runner;
  r.root.position.set(G.px, G.py, G.pz);

  const rolling = G.rollTimer > 0;
  const k = damp(18, dt);

  if (G.state === 'crashed' || G.state === 'over') {
    r.root.rotation.x += (1.25 - r.root.rotation.x) * damp(6, dt);

    if (glb) glb.mixer.update(0);

    return;
  }

  r.root.rotation.z = clamp((G.px - laneX(G.lane)) * 0.12, -0.35, 0.35);

  if (G.state === 'menu') {
    G.phase += dt * 3;
  } else {
    G.phase += dt * (6 + G.speed * 0.6);
  }

  const s = Math.sin(G.phase);

  // built-in runner pose
  if (rolling) {
    r.body.scale.y += (0.5 - r.body.scale.y) * k;
    r.legL.rotation.x = r.legR.rotation.x = -1.4;
    r.armL.rotation.x = r.armR.rotation.x = -2.2;

  } else if (!G.grounded) {
    r.body.scale.y += (1 - r.body.scale.y) * k;
    r.legL.rotation.x = -1.0;
    r.legR.rotation.x = 0.5;
    r.armL.rotation.x = r.armR.rotation.x = -2.6;

  } else {
    r.body.scale.y += (1 - r.body.scale.y) * k;

    const amp = G.state === 'menu' ? 0.15 : 0.95;

    r.legL.rotation.x = s * amp;
    r.legR.rotation.x = -s * amp;
    r.armL.rotation.x = -s * amp * 0.9;
    r.armR.rotation.x = s * amp * 0.9;
  }

  r.body.position.y = G.grounded && !rolling ? Math.abs(s) * 0.07 : 0;

  // GLB character
  if (glb) {
    const want = rolling ? 'roll' : !G.grounded ? 'jump' : 'run';

    playGlbAction(want);

    if (glb.actions.run) {
      glb.actions.run.timeScale = G.state === 'menu' ? 0.4 : G.speed / CONFIG.startSpeed;
    }

    const sy = rolling && !glb.actions.roll ? 0.55 : 1;

    glb.pivot.scale.y += (sy - glb.pivot.scale.y) * k;

    glb.mixer.update(dt);
  }
}

function updateCamera(dt, t) {
  const tx = G.px * 0.8;
  const ty = 4.3 + G.py * 0.6;

  camera.position.x += (tx - camera.position.x) * damp(8, dt);
  camera.position.y += (ty - camera.position.y) * damp(6, dt);

  // Aproximação leve da câmera durante a partida
  camera.position.z = G.pz + 7.2;

  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt);
    camera.position.x += (Math.random() - 0.5) * G.shake;
    camera.position.y += (Math.random() - 0.5) * G.shake;
  }

  tmpLook.set(G.px * 0.85, 1.4 + G.py * 0.5, G.pz - 8);

  camera.lookAt(tmpLook);

  const portraitBoost = camera.aspect < 1 ? (1 - camera.aspect) * 30 : 0;
  const fov = 62 + portraitBoost + (G.speed - CONFIG.startSpeed) * 0.35;

  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  sun.position.set(G.px + 8, 22, G.pz + 6);
  sun.target.position.set(G.px, 0, G.pz - 12);
}

let lastScore = -1;
let lastCoins = -1;

function updateHud() {
  if (G.score !== lastScore) ui.score.textContent = (lastScore = G.score);
  if (G.coins !== lastCoins) ui.coins.textContent = (lastCoins = G.coins);
}

const timer = new THREE.Timer();

function frame(timestamp) {
  timer.update(timestamp);

  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();

  if (G.state === 'playing') {
    updatePlaying(dt);
  } else if (G.state === 'crashed') {
    G.crashTimer -= dt;

    if (G.crashTimer <= 0) gameOver();
  }

  for (const c of coins) {
    if (!c.taken) c.mesh.rotation.y += dt * 3;
  }

  animateRunner(dt, t);
  updateCamera(dt, t);
  updateHud();

  renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

resetGame();
ui.loading.remove();
requestAnimationFrame(frame);

// Small debug handle
window.__game = { G, obstacles, coins, start: startGame, move, jump, roll, CONFIG };
